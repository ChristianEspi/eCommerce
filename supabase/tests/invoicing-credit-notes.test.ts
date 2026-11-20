// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Facturación · fase 5 (2026-11-20): nota de crédito.
 *
 *  · se anula con nota solo lo ya emitido; una sola nota vigente;
 *  · la nota lleva su serie, su correlativo, las mismas líneas y la referencia;
 *  · el mensaje v3 lleva `reference` y `credit_note`;
 *  · nota aceptada ⇒ el original queda anulado;
 *  · cancelar el pedido: con emisión automática la nota sale sola; si no, aviso;
 *  · cancelar con el comprobante encolado retira el mensaje;
 *  · un comprobante anulado que el emisor igual emitió avisa, no revive callado;
 *  · solo administración y solo en su sociedad.
 */

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let channelA = ''
let provider = ''
let seq = 0

async function sql<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}
async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}
async function svc<T = Row>(query: string, params: unknown[] = []) {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}
async function fallo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return String((error as Error).message)
  }
  throw new Error('se esperaba un error')
}

const ownerA = claimsFor(TENANT_A)
const ownerB = claimsFor(TENANT_B)

async function pedido(): Promise<string> {
  seq += 1
  const [o] = await sql<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, currency,
        subtotal, tax_total, shipping_total, grand_total, customer_email, customer_name, channel_id, billing_address)
     values ($1, $2, $3, $4, 'pending', 'pending', 'PEN', 100, 18, 27, 145, 'ana@cliente.pe', 'Ana', $5,
             '{"document_type":"receipt","id_type":"dni","tax_id":"74705043","legal_name":"Ana Torres"}'::jsonb)
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, `NC-${seq}`, channelA],
  )
  await sql(
    `insert into public.order_items
       (organization_id, company_id, store_id, order_id, sku, name, quantity, unit_price, tax_rate, tax_amount, tax_inclusive)
     values ($1, $2, $3, $4, 'S', 'Jabón', 1, 100, 0.18, 18, false)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, o?.id],
  )
  return String(o?.id)
}

/** Pedido con su boleta ya emitida (aceptada) por el emisor. */
async function emitida(): Promise<{ order: string; invoice: string }> {
  const order = await pedido()
  const [inv] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [order])
  const invoice = String(inv?.id)
  await as(ownerA, `select public.invoice_request_issue($1)`, [invoice])
  await svc(`select public.invoice_record_provider_result($1, '{"status":"accepted"}'::jsonb)`, [invoice])
  return { order, invoice }
}

const anular = (claims: JwtClaims, invoice: string, motivo = 'Cliente devolvió todo') =>
  as<{ r: Row }>(claims, `select public.invoice_request_credit_note($1, $2) as r`, [invoice, motivo])

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
    `insert into public.tenant_entitlements (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, 'invoicing', true, 'hub')
     on conflict (organization_id, company_id, entitlement_code) do update set is_active = true`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const [p] = await sql<{ code: string }>(
    `select code from public.integration_providers
      where kind = 'invoicing' and 'invoice.issue' = any (capabilities) and is_active order by code limit 1`,
  )
  provider = String(p?.code)
  await sql(
    `insert into public.tenant_integrations (organization_id, company_id, provider_code, is_active)
     values ($1, $2, $3, true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, provider],
  )
}, 240_000)

beforeEach(async () => {
  await sql(`delete from public.invoice_settings`)
})

afterAll(async () => {
  await db?.close()
})

describe('nota de crédito', () => {
  it('se crea con su serie, las mismas líneas y la referencia; sale en el mensaje v3', async () => {
    const { invoice } = await emitida()
    const [r] = await anular(ownerA, invoice)
    expect(r?.r).toMatchObject({ state: 'enqueued', schema_version: 3 })
    const nota = String(r?.r?.credit_note_id)
    const [n] = await sql(
      `select series, number, document_type, reference_invoice_id, credit_note_type, gross_total::text as gross,
              (select count(*)::int from public.invoice_items where invoice_id = i.id) as lineas
         from public.invoices i where id = $1`,
      [nota],
    )
    expect(n).toMatchObject({
      series: 'BC01', number: '00000001', document_type: 'credit_note', reference_invoice_id: invoice,
      credit_note_type: 1, gross: '145.00', lineas: 2,
    })
    const [orig] = await sql<{ series: string; number: string }>(`select series, number from public.invoices where id = $1`, [invoice])
    const [msg] = await sql<{ payload: Row }>(`select payload from public.integration_outbox where id = $1`, [r?.r?.outbox_id])
    expect(msg?.payload).toMatchObject({
      schema_version: 3,
      document_type: 'credit_note',
      reference: { document_type: 'receipt', series: orig?.series, number: orig?.number },
      credit_note: { type: 1, reason: 'Cliente devolvió todo' },
    })
  })

  it('una sola nota vigente; no se anula lo no emitido ni una nota', async () => {
    const { invoice } = await emitida()
    const [r] = await anular(ownerA, invoice)
    expect(await fallo(() => anular(ownerA, invoice))).toMatch(/NOTA_YA_EXISTE/)
    expect(await fallo(() => anular(ownerA, String(r?.r?.credit_note_id)))).toMatch(/NOTA_DE_NOTA|COMPROBANTE_NO_EMITIDO/)
    const [pend] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [await pedido()])
    expect(await fallo(() => anular(ownerA, String(pend?.id)))).toMatch(/COMPROBANTE_NO_EMITIDO/)
    expect(await fallo(() => anular(ownerA, invoice, 'x'))).toMatch(/NOTA_YA_EXISTE|MOTIVO_REQUERIDO/)
  })

  it('nota aceptada: el original queda anulado', async () => {
    const { invoice } = await emitida()
    const [r] = await anular(ownerA, invoice)
    await svc(`select public.invoice_record_provider_result($1, '{"status":"accepted"}'::jsonb)`, [r?.r?.credit_note_id])
    expect((await sql(`select status::text from public.invoices where id = $1`, [invoice]))[0]?.status).toBe('cancelled')
  })

  it('solo administración y solo su sociedad', async () => {
    const { invoice } = await emitida()
    await sql(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, '0f000000-0000-4000-8000-00000000a0a1', 'v@tenant-a.com', 'sales_rep')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const vendedor = claimsFor(TENANT_A, {
      sub: '0f000000-0000-4000-8000-00000000a0a1',
      email: 'v@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'sales_rep' }],
    })
    expect(await fallo(() => anular(vendedor, invoice))).toMatch(/SIN_PERMISO/)
    expect(await fallo(() => anular(ownerB, invoice))).toMatch(/COMPROBANTE_NO_ENCONTRADO/)
    expect(await fallo(() => as(ownerA, `select ebim.invoice_credit_note_for($1, 'x', 1::smallint)`, [invoice]))).toMatch(
      /permission denied/,
    )
  })
})

describe('cancelar el pedido', () => {
  it('con emisión automática, la nota sale sola', async () => {
    await as(ownerA, `select public.invoice_settings_configure($1::uuid, 'B001', 'F001', 0.18, 'exonerado', true)`, [storeA])
    const { order, invoice } = await emitida()
    await sql(`update public.orders set status = 'cancelled' where id = $1`, [order])
    const [n] = await sql(`select document_type, status::text from public.invoices where reference_invoice_id = $1`, [invoice])
    expect(n).toEqual({ document_type: 'credit_note', status: 'pending' })
    const [req] = await sql(
      `select r.state from public.invoice_issue_requests r join public.invoices i on i.id = r.invoice_id
        where i.reference_invoice_id = $1`,
      [invoice],
    )
    expect(req).toEqual({ state: 'enqueued' })
  })

  it('sin emisión automática: aviso de nota pendiente, sin nota', async () => {
    const { order, invoice } = await emitida()
    await sql(`update public.orders set status = 'cancelled' where id = $1`, [order])
    expect(await sql(`select 1 from public.invoices where reference_invoice_id = $1`, [invoice])).toEqual([])
    const [ev] = await sql(`select code from public.ops_events where dedupe_key = $1`, [`invoice.credit_note:${invoice}`])
    expect(ev).toEqual({ code: 'NOTA_DE_CREDITO_PENDIENTE' })
  })

  it('con el comprobante encolado y sin salir: se anula y el mensaje se retira', async () => {
    const order = await pedido()
    const [inv] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [order])
    const [r] = await as<{ r: Row }>(ownerA, `select public.invoice_request_issue($1) as r`, [inv?.id])
    await sql(`update public.orders set status = 'cancelled' where id = $1`, [order])
    expect((await sql(`select status::text from public.invoices where id = $1`, [inv?.id]))[0]?.status).toBe('cancelled')
    expect((await sql(`select status::text from public.integration_outbox where id = $1`, [r?.r?.outbox_id]))[0]?.status).toBe('dead')
  })

  it('si el emisor igual lo emitió estando anulado: queda emitido y avisa', async () => {
    const order = await pedido()
    const [inv] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [order])
    await as(ownerA, `select public.invoice_request_issue($1)`, [inv?.id])
    await sql(`update public.orders set status = 'cancelled' where id = $1`, [order])
    await svc(`select public.invoice_record_provider_result($1, '{"status":"issued"}'::jsonb)`, [inv?.id])
    expect((await sql(`select status::text from public.invoices where id = $1`, [inv?.id]))[0]?.status).toBe('issued')
    const [ev] = await sql(`select code from public.ops_events where dedupe_key = $1`, [`invoice.credit_note:${inv?.id}`])
    expect(ev).toEqual({ code: 'NOTA_DE_CREDITO_PENDIENTE' })
  })
})

describe('configuración y «Mi cuenta»', () => {
  it('series de nota: B/F y distintas de la del comprobante', async () => {
    expect(
      await fallo(() =>
        as(ownerA, `select public.invoice_settings_configure($1::uuid, 'B001', 'F001', 0.18, 'exonerado', false, null, null, 'B001', 'FC01')`, [storeA]),
      ),
    ).toMatch(/SERIE_INVALIDA/)
    await as(ownerA, `select public.invoice_settings_configure($1::uuid, 'B001', 'F001', 0.18, 'exonerado', false, null, null, 'BN01', 'FN01')`, [storeA])
    expect((await as(ownerA, `select credit_note_receipt_series as s from public.invoice_settings`))[0]?.s).toBe('BN01')
  })

  it('«Mi cuenta» muestra el comprobante (anulado), nunca su nota', async () => {
    const { order, invoice } = await emitida()
    const buyer = '0f000000-0000-4000-8000-00000000c0c1'
    await sql(
      `insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id) values ($1, $2, $3, $4, $5)`,
      [order, TENANT_A.organizationId, TENANT_A.companyId, storeA, buyer],
    )
    const [r] = await anular(ownerA, invoice)
    await svc(`select public.invoice_record_provider_result($1, '{"status":"accepted"}'::jsonb)`, [r?.r?.credit_note_id])
    const shopper = { sub: buyer, email: 'b@x.pe', org_id: '', companies: [], active_company: '' } as unknown as JwtClaims
    const [mi] = await as<{ r: Row }>(shopper, `select public.my_order_invoice($1) as r`, [order])
    expect(mi?.r).toMatchObject({ document_type: 'receipt', status: 'cancelled' })
  })
})
