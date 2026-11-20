// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Facturación Perú · fase 1 (2026-11-20).
 *
 *  · la serie sale de la configuración de la tienda, no del código;
 *  · el envío cobrado lleva su IGV dentro y el total sigue siendo lo cobrado;
 *  · el comprobante guarda el tipo de documento y la dirección del cliente;
 *  · el correlativo se asigna al encolar, es consecutivo y nunca retrocede;
 *  · boleta de S/ 700+ sin documento y factura sin RUC no se emiten;
 *  · con `auto_issue`, el cobro genera Y pide la emisión;
 *  · configurar: solo administración y solo en su sociedad.
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
const VENDEDOR = '0f000000-0000-4000-8000-00000000d001'

/** Pedido con una línea y, si se pide, envío. Precios sin IGV (como miquimica). */
async function pedido(options: {
  billing?: Row
  shipping?: string
  net?: string
  tax?: string
  paid?: boolean
} = {}): Promise<string> {
  seq += 1
  const net = options.net ?? '100.00'
  const tax = options.tax ?? '18.00'
  const ship = options.shipping ?? '0'
  const grand = (Number(net) + Number(tax) + Number(ship)).toFixed(2)
  const [o] = await sql<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, currency,
        subtotal, tax_total, shipping_total, grand_total, customer_email, customer_name, channel_id,
        billing_address, shipping_address, tax_inclusive)
     values ($1, $2, $3, $4, 'pending', 'pending', 'PEN', $5, $6, $7, $8, 'c@cli.pe', 'Ana Torres', $9,
             $10::jsonb, '{"address":"Av. Entrega 1","city":"Lima"}'::jsonb, false)
     returning id`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, `FAC-${seq}`, net, tax, ship, grand, channelA,
      JSON.stringify(options.billing ?? {}),
    ],
  )
  await sql(
    `insert into public.order_items
       (organization_id, company_id, store_id, order_id, sku, name, quantity, unit_price,
        tax_rate, tax_amount, tax_inclusive)
     values ($1, $2, $3, $4, 'SKU-1', 'Jabón', 2, $5::numeric / 2, 0.18, $6, false)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, o?.id, net, tax],
  )
  return String(o?.id)
}

async function comprobanteDe(orderId: string) {
  const [inv] = await sql<Row>(
    `select id, series, number, document_type, customer_doc_type, customer_tax_id, customer_address,
            net_total::text as net, tax_total::text as tax, gross_total::text as gross
       from public.invoices where order_id = $1`,
    [orderId],
  )
  return inv as Row
}

async function generar(orderId: string) {
  const [r] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [orderId])
  return String(r?.id)
}

async function emitir(invoiceId: string) {
  const [r] = await as<{ r: Row }>(ownerA, `select public.invoice_request_issue($1) as r`, [invoiceId])
  return r?.r as Row
}

const configurar = (claims: JwtClaims, store: string, over: Partial<Record<string, unknown>> = {}) =>
  as(
    claims,
    `select public.invoice_settings_configure($1::uuid, $2, $3, $4::numeric, $5, $6, $7, $8)`,
    [
      store,
      over.receipt ?? 'B002',
      over.invoice ?? 'F002',
      over.rate ?? 0.18,
      over.zero ?? 'exonerado',
      over.auto ?? false,
      over.receiptLast ?? null,
      over.invoiceLast ?? null,
    ],
  )

async function activarProveedor() {
  await sql(
    `insert into public.tenant_integrations (organization_id, company_id, provider_code, is_active)
     values ($1, $2, $3, true)
     on conflict (organization_id, company_id, provider_code) do update set is_active = true`,
    [TENANT_A.organizationId, TENANT_A.companyId, provider],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await sql(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
  }
  storeA = String((await sql(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  channelA = String((await sql(`select id from public.channels where store_id = $1 and is_default`, [storeA]))[0]?.id)
  await sql(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'v@tenant-a.com', 'sales_rep')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR],
  )
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
}, 240_000)

beforeEach(async () => {
  await sql(`delete from public.tenant_integrations where provider_code = $1`, [provider])
  await sql(`delete from public.invoice_settings`)
  await sql(`delete from public.invoice_sequences`)
})

afterAll(async () => {
  await db?.close()
})

describe('generar el comprobante', () => {
  it('sin configuración: B001 y el envío cobrado lleva su IGV; el total es lo cobrado', async () => {
    const order = await pedido({
      shipping: '27.00',
      billing: { document_type: 'receipt', id_type: 'dni', tax_id: '74705043', legal_name: 'Ana Torres', address: 'Jr. Uno 2' },
    })
    await generar(order)
    const inv = await comprobanteDe(order)
    expect(inv).toMatchObject({
      series: 'B001',
      number: null,
      document_type: 'receipt',
      customer_doc_type: 'dni',
      customer_tax_id: '74705043',
      customer_address: 'Jr. Uno 2',
      // 100 + 18 de la línea; 27 de envío = 22.88 + 4.12.
      net: '122.88',
      tax: '22.12',
      gross: '145.00',
    })
    const lineas = await sql(
      `select line_kind, tax_affectation, net_amount::text as net, tax_amount::text as tax, tax_rate::text as rate
         from public.invoice_items where invoice_id = $1 order by position`,
      [inv.id],
    )
    expect(lineas).toEqual([
      { line_kind: 'item', tax_affectation: 'gravado', net: '100.00', tax: '18.00', rate: '0.1800' },
      { line_kind: 'shipping', tax_affectation: 'gravado', net: '22.88', tax: '4.12', rate: '0.1800' },
    ])
  })

  it('factura: serie de la tienda, RUC y dirección fiscal', async () => {
    await configurar(ownerA, storeA, { invoice: 'F007' })
    const order = await pedido({
      billing: { document_type: 'invoice', id_type: 'ruc', tax_id: '20123456789', legal_name: 'Cliente SAC', address: 'Av. Fiscal 9' },
    })
    await generar(order)
    expect(await comprobanteDe(order)).toMatchObject({
      series: 'F007',
      document_type: 'invoice',
      customer_doc_type: 'ruc',
      customer_address: 'Av. Fiscal 9',
    })
  })

  it('tienda que no grava el envío: el envío sale con su afectación, sin IGV', async () => {
    await configurar(ownerA, storeA, { rate: 0, zero: 'inafecto' })
    const order = await pedido({ shipping: '10.00', billing: { document_type: 'receipt', id_type: 'dni', tax_id: '12345678' } })
    await generar(order)
    const inv = await comprobanteDe(order)
    expect(inv).toMatchObject({ net: '110.00', tax: '18.00', gross: '128.00' })
    const [envio] = await sql(
      `select tax_affectation, tax_amount::text as tax from public.invoice_items where invoice_id = $1 and line_kind = 'shipping'`,
      [inv.id],
    )
    expect(envio).toEqual({ tax_affectation: 'inafecto', tax: '0.00' })
  })
})

describe('correlativo y emisión', () => {
  it('sin emisor no gasta número; con emisor, consecutivo por serie y en el mensaje v2', async () => {
    const boleta = () =>
      pedido({ billing: { document_type: 'receipt', id_type: 'dni', tax_id: '74705043', legal_name: 'Ana Torres' } })
    const a = await generar(await boleta())
    expect(await emitir(a)).toMatchObject({ state: 'pending_configuration' })
    expect((await sql(`select number from public.invoices where id = $1`, [a]))[0]?.number).toBeNull()

    await activarProveedor()
    const ra = await emitir(a)
    const b = await generar(await boleta())
    await emitir(b)
    const numeros = await sql(`select number from public.invoices where id in ($1, $2) order by number`, [a, b])
    expect(numeros.map((n) => n.number)).toEqual(['00000001', '00000002'])

    const [msg] = await sql<{ payload: Row }>(`select payload from public.integration_outbox where id = $1`, [ra.outbox_id])
    expect(msg?.payload).toMatchObject({
      schema_version: 2,
      document_type: 'receipt',
      series: 'B001',
      number: '00000001',
      customer: { tax_id: '74705043', doc_type: 'dni' },
    })
    // Reintentar no gasta otro número.
    await emitir(a)
    expect((await sql(`select last_number from public.invoice_sequences where series = 'B001'`))[0]?.last_number).toBe(2)
  })

  it('el correlativo inicial se fija desde la configuración y nunca retrocede', async () => {
    await configurar(ownerA, storeA, { receipt: 'B003', receiptLast: 120 })
    await activarProveedor()
    const inv = await generar(
      await pedido({ billing: { document_type: 'receipt', id_type: 'dni', tax_id: '74705043' } }),
    )
    await emitir(inv)
    expect((await sql(`select series, number from public.invoices where id = $1`, [inv]))[0]).toEqual({
      series: 'B003',
      number: '00000121',
    })
    expect(await fallo(() => configurar(ownerA, storeA, { receipt: 'B003', receiptLast: 50 }))).toMatch(
      /CORRELATIVO_NO_RETROCEDE/,
    )
  })

  it('una serie con números de antes sigue después del más alto, nunca repite', async () => {
    const viejo = await generar(
      await pedido({ billing: { document_type: 'invoice', tax_id: '20123456789', legal_name: 'Viejo SAC' } }),
    )
    await sql(`update public.invoices set number = '00012345' where id = $1`, [viejo])
    await activarProveedor()
    const nuevo = await generar(
      await pedido({ billing: { document_type: 'invoice', tax_id: '20123456789', legal_name: 'Nuevo SAC' } }),
    )
    await emitir(nuevo)
    expect((await sql(`select number from public.invoices where id = $1`, [nuevo]))[0]?.number).toBe('00012346')
    expect(await fallo(() => configurar(ownerA, storeA, { invoice: 'F001', invoiceLast: 100 }))).toMatch(
      /CORRELATIVO_NO_RETROCEDE/,
    )
  })

  it('boleta de S/ 700+ sin documento y factura sin RUC: no se emiten', async () => {
    await activarProveedor()
    const grande = await generar(await pedido({ net: '700.00', tax: '126.00' }))
    expect(await fallo(() => emitir(grande))).toMatch(/BOLETA_REQUIERE_DOCUMENTO/)
    const chica = await generar(await pedido({ net: '50.00', tax: '9.00' }))
    expect(await emitir(chica)).toMatchObject({ state: 'enqueued' })

    const factura = await generar(await pedido({ billing: { document_type: 'invoice', legal_name: 'Sin RUC SAC' } }))
    expect(await fallo(() => emitir(factura))).toMatch(/FACTURA_REQUIERE_RUC/)
  })

  it('con emisión automática, cobrar genera y pide la emisión', async () => {
    await configurar(ownerA, storeA, { auto: true })
    await activarProveedor()
    const order = await pedido({ billing: { document_type: 'receipt', id_type: 'dni', tax_id: '74705043' } })
    await sql(`update public.orders set payment_status = 'paid' where id = $1`, [order])
    const inv = await comprobanteDe(order)
    expect(inv).toMatchObject({ series: 'B002', number: '00000001' })
    const [req] = await sql(`select state from public.invoice_issue_requests where invoice_id = $1`, [inv.id])
    expect(req).toEqual({ state: 'enqueued' })
  })
})

describe('migración sobre datos existentes', () => {
  it('volver a aplicarla con un comprobante ACEPTADO no falla ni lo toca', async () => {
    const inv = await generar(
      await pedido({ billing: { document_type: 'invoice', tax_id: '20123456789', legal_name: 'Aceptado SAC' } }),
    )
    await sql(`update public.invoices set document_type = null where id = $1`, [inv])
    await sql(`update public.invoices set status = 'accepted', number = '00000999' where id = $1`, [inv])
    const { readFileSync } = await import('node:fs')
    const migracion = readFileSync('supabase/migrations/20261120110000_invoicing_peru_fiscal_data.sql', 'utf8')
    await db.exec(migracion)
    expect((await sql(`select document_type, status from public.invoices where id = $1`, [inv]))[0]).toEqual({
      document_type: null,
      status: 'accepted',
    })
  })
})

describe('configuración: permisos y aislamiento', () => {
  it('series y tasas inválidas se rechazan', async () => {
    expect(await fallo(() => configurar(ownerA, storeA, { receipt: 'F001' }))).toMatch(/SERIE_INVALIDA/)
    expect(await fallo(() => configurar(ownerA, storeA, { invoice: 'X1' }))).toMatch(/SERIE_INVALIDA/)
    expect(await fallo(() => configurar(ownerA, storeA, { rate: 1.5 }))).toMatch(/TASA_INVALIDA/)
  })

  it('solo administración configura; otra sociedad ni ve ni escribe', async () => {
    const vendedor = claimsFor(TENANT_A, {
      sub: VENDEDOR,
      email: 'v@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'sales_rep' }],
    })
    expect(await fallo(() => configurar(vendedor, storeA))).toMatch(/SIN_PERMISO/)
    expect(await fallo(() => configurar(ownerB, storeA))).toMatch(/TIENDA_NO_DISPONIBLE/)

    await configurar(ownerA, storeA, { receiptLast: 5 })
    expect(await as(ownerA, `select receipt_series from public.invoice_settings`)).toEqual([{ receipt_series: 'B002' }])
    expect(await as(ownerB, `select 1 from public.invoice_settings`)).toEqual([])
    expect(await as(ownerB, `select 1 from public.invoice_sequences`)).toEqual([])
    expect(await as(vendedor, `select 1 from public.invoice_settings`)).toEqual([])
  })

  it('sin escritura directa en configuración ni correlativo', async () => {
    expect(await fallo(() => as(ownerA, `update public.invoice_sequences set last_number = 0`))).toMatch(/permission denied/)
    expect(
      await fallo(() =>
        as(
          ownerA,
          `insert into public.invoice_settings (store_id, organization_id, company_id) values ($1, $2, $3)`,
          [storeA, TENANT_A.organizationId, TENANT_A.companyId],
        ),
      ),
    ).toMatch(/permission denied/)
  })
})
