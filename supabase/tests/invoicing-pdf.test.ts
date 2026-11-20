// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * El PDF del comprobante para el visor de la web (2026-11-20).
 *
 *  · `invoice_pdf_source` da el enlace al personal que ya lee comprobantes y al
 *    comprador del pedido; a nadie más (mismo mensaje);
 *  · solo enlaces https del emisor: la Edge Function no es un proxy abierto;
 *  · `my_order_invoice` devuelve el id para abrir el visor.
 */

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let channelA = ''
let seq = 0

const COMPRADOR = '0f000000-0000-4000-8000-00000000d0d1'
const OTRO = '0f000000-0000-4000-8000-00000000d0d2'
const VENDEDOR = '0f000000-0000-4000-8000-00000000d0d3'

async function sql<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}
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
const shopper = (sub: string): JwtClaims =>
  ({ sub, email: `${sub}@x.pe`, org_id: '', companies: [], active_company: '' }) as unknown as JwtClaims

async function comprobante(pdf: string | null): Promise<{ order: string; invoice: string }> {
  seq += 1
  const [o] = await sql<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, currency,
        subtotal, tax_total, grand_total, customer_email, customer_name, channel_id)
     values ($1, $2, $3, $4, 'pending', 'pending', 'PEN', 100, 18, 118, 'a@x.pe', 'Ana', $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, `PDF-${seq}`, channelA],
  )
  await sql(
    `insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id) values ($1, $2, $3, $4, $5)`,
    [o?.id, TENANT_A.organizationId, TENANT_A.companyId, storeA, COMPRADOR],
  )
  const [i] = await sql<{ id: string }>(
    `insert into public.invoices
       (organization_id, company_id, store_id, order_id, series, number, status, currency, customer_name,
        net_total, tax_total, gross_total, document_type, pdf_url)
     values ($1, $2, $3, $4, 'BBB1', $5, 'pending', 'PEN', 'Ana', 100, 18, 118, 'receipt', $6) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, o?.id, String(seq).padStart(8, '0'), pdf],
  )
  return { order: String(o?.id), invoice: String(i?.id) }
}

const fuente = (claims: JwtClaims, invoice: string) =>
  as<{ r: Row }>(claims, `select public.invoice_pdf_source($1) as r`, [invoice])

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await sql(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
    ])
  }
  storeA = String((await sql(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  channelA = String((await sql(`select id from public.channels where store_id = $1 and is_default`, [storeA]))[0]?.id)
  await sql(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'v@tenant-a.com', 'sales_rep')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('invoice_pdf_source', () => {
  it('el personal de la sociedad y el comprador lo obtienen; con nombre de archivo', async () => {
    const { invoice } = await comprobante('https://www.nubefact.com/cpe/abc-123.pdf')
    const [staff] = await fuente(claimsFor(TENANT_A), invoice)
    expect(staff?.r).toMatchObject({ pdf_url: 'https://www.nubefact.com/cpe/abc-123.pdf', document_type: 'receipt' })
    expect(String(staff?.r?.filename)).toMatch(/^BBB1-\d{8}\.pdf$/)
    const [buyer] = await fuente(shopper(COMPRADOR), invoice)
    expect(buyer?.r).toMatchObject({ pdf_url: 'https://www.nubefact.com/cpe/abc-123.pdf' })
  })

  it('otra persona, otra sociedad o un rol sin acceso a comprobantes: «no encontrado»', async () => {
    const { invoice } = await comprobante('https://www.nubefact.com/cpe/abc-124.pdf')
    expect(await fallo(() => fuente(shopper(OTRO), invoice))).toMatch(/COMPROBANTE_NO_ENCONTRADO/)
    expect(await fallo(() => fuente(claimsFor(TENANT_B), invoice))).toMatch(/COMPROBANTE_NO_ENCONTRADO/)
    const vendedor = claimsFor(TENANT_A, { sub: VENDEDOR, email: 'v@tenant-a.com', companies: [{ id: TENANT_A.companyId, role: 'sales_rep' }] })
    expect(await fallo(() => fuente(vendedor, invoice))).toMatch(/COMPROBANTE_NO_ENCONTRADO/)
    expect(
      await fallo(() => asRole(db, 'anon', null, async () => db.query(`select public.invoice_pdf_source($1)`, [invoice]))),
    ).toMatch(/permission denied/)
  })

  it('sin PDF o con un enlace que no es del emisor: no hay PDF', async () => {
    // (`http://` ni siquiera se puede guardar: `invoices_provider_urls` exige https.)
    for (const pdf of [null, 'https://evil.com/a.pdf', 'https://www.nubefact.com.evil.com/a.pdf', 'https://www.nubefact.com/cpe/a.exe']) {
      const { invoice } = await comprobante(pdf)
      expect(await fallo(() => fuente(claimsFor(TENANT_A), invoice))).toMatch(/PDF_NO_DISPONIBLE/)
    }
    const { invoice } = await comprobante('https://demo.pse.pe/cpe/x.pdf')
    const [ok] = await fuente(claimsFor(TENANT_A), invoice)
    expect(ok?.r).toMatchObject({ pdf_url: 'https://demo.pse.pe/cpe/x.pdf' })
  })

  it('«Mi cuenta» recibe el id del comprobante para abrir el visor', async () => {
    const { order, invoice } = await comprobante('https://www.nubefact.com/cpe/abc-125.pdf')
    const [r] = await as<{ r: Row }>(shopper(COMPRADOR), `select public.my_order_invoice($1) as r`, [order])
    expect(r?.r).toMatchObject({ id: invoice })
  })
})
