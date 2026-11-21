// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'
import { actionUrl, renderEmail } from '../functions/_shared/notifications/templates.ts'

/**
 * Facturación · fase 4 (2026-11-20): el comprador ve su comprobante.
 *
 *  · `my_order_invoice` responde a quien compró y a nadie más (mismo mensaje);
 *  · solo https en el PDF;
 *  · el correo «Tu boleta» sale UNA vez al emitirse, con el PDF; sin PDF, no.
 */

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let channelA = ''
let seq = 0

const COMPRADOR = '0f000000-0000-4000-8000-00000000f001'
const OTRO = '0f000000-0000-4000-8000-00000000f002'

async function sql<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}
const shopper = (sub: string): JwtClaims =>
  ({ sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }) as unknown as JwtClaims
async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}
async function fallo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return String((error as Error).message)
  }
  throw new Error('se esperaba un error')
}

async function pedidoConComprobante(): Promise<{ order: string; invoice: string }> {
  seq += 1
  const [o] = await sql<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, currency,
        subtotal, tax_total, grand_total, customer_email, customer_name, channel_id, billing_address)
     values ($1, $2, $3, $4, 'pending', 'pending', 'PEN', 100, 18, 118, 'ana@cliente.pe', 'Ana', $5,
             '{"document_type":"receipt","id_type":"dni","tax_id":"74705043","legal_name":"Ana Torres"}'::jsonb)
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, `CB-${seq}`, channelA],
  )
  await sql(
    `insert into public.order_items
       (organization_id, company_id, store_id, order_id, sku, name, quantity, unit_price, tax_rate, tax_amount, tax_inclusive)
     values ($1, $2, $3, $4, 'S', 'Jabón', 1, 100, 0.18, 18, false)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, o?.id],
  )
  await sql(
    `insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id) values ($1, $2, $3, $4, $5)`,
    [o?.id, TENANT_A.organizationId, TENANT_A.companyId, storeA, COMPRADOR],
  )
  const [inv] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [o?.id])
  return { order: String(o?.id), invoice: String(inv?.id) }
}

let numero = 0
async function emitir(invoice: string, pdf: string | null): Promise<string> {
  numero += 1
  const n = String(numero).padStart(8, '0')
  await sql(`update public.invoices set number = $2 where id = $1`, [invoice, n])
  await asRole(db, 'service_role', null, async () =>
    db.query(`select public.invoice_record_provider_result($1, $2::jsonb)`, [
      invoice,
      JSON.stringify({ status: 'issued', ...(pdf ? { pdf_url: pdf } : {}) }),
    ]),
  )
  return n
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await sql(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
    ])
  }
  storeA = String((await sql(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  channelA = String((await sql(`select id from public.channels where store_id = $1 and is_default`, [storeA]))[0]?.id)
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('my_order_invoice', () => {
  it('el comprador ve su comprobante; otro usuario recibe «no encontrado»', async () => {
    const { order, invoice } = await pedidoConComprobante()
    const [antes] = await as<{ r: Row }>(shopper(COMPRADOR), `select public.my_order_invoice($1) as r`, [order])
    expect(antes?.r).toMatchObject({ document_type: 'receipt', series: 'B001', number: null, status: 'pending', pdf_url: null })

    const n = await emitir(invoice, 'https://www.nubefact.com/cpe/abc.pdf')
    const [despues] = await as<{ r: Row }>(shopper(COMPRADOR), `select public.my_order_invoice($1) as r`, [order])
    expect(despues?.r).toMatchObject({ number: n, status: 'issued', pdf_url: 'https://www.nubefact.com/cpe/abc.pdf' })

    expect(await fallo(() => as(shopper(OTRO), `select public.my_order_invoice($1)`, [order]))).toMatch(/PEDIDO_NO_ENCONTRADO/)
    expect(
      await fallo(() => asRole(db, 'anon', null, async () => db.query(`select public.my_order_invoice($1)`, [order]))),
    ).toMatch(/permission denied/)
  })
})

describe('correo «Tu boleta»', () => {
  it('sale una vez al emitirse, con el PDF y la marca de la tienda', async () => {
    const { invoice } = await pedidoConComprobante()
    const n = await emitir(invoice, 'https://www.nubefact.com/cpe/xyz.pdf')
    // Una consulta posterior (aceptada) no lo repite.
    await asRole(db, 'service_role', null, async () =>
      db.query(`select public.invoice_record_provider_result($1, '{"status":"accepted"}'::jsonb)`, [invoice]),
    )
    const correos = await sql<{ to_address: string; params: Row }>(
      `select to_address, params from public.notification_emails where kind = 'invoice.issued' and params->>'pdf_url' = $1`,
      ['https://www.nubefact.com/cpe/xyz.pdf'],
    )
    expect(correos).toHaveLength(1)
    expect(correos[0]?.to_address).toBe('ana@cliente.pe')
    expect(correos[0]?.params).toMatchObject({ document_type: 'receipt', invoice_number: `B001-${n}`, currency: 'PEN' })

    const correo = renderEmail('invoice.issued', 'es', correos[0]?.params ?? {}, '')
    expect(correo?.subject).toMatch(new RegExp(`^Tu boleta B001-${n} del pedido CB-`))
    expect(correo?.html).toContain('href="https://www.nubefact.com/cpe/xyz.pdf"')
  })

  it('sin PDF no hay correo; un enlace que no es https no da botón', async () => {
    const { invoice } = await pedidoConComprobante()
    await emitir(invoice, null)
    const [n] = await sql<{ n: number }>(
      `select count(*)::int as n from public.notification_emails where kind = 'invoice.issued' and dedupe_key like $1`,
      [`invoice.issued:${invoice}%`],
    )
    expect(n?.n).toBe(0)
    expect(actionUrl('invoice.issued', { pdf_url: 'javascript:alert(1)' }, '')).toBeNull()
    expect(actionUrl('invoice.issued', { pdf_url: 'http://x.pe/a.pdf' }, '')).toBeNull()
  })
})
