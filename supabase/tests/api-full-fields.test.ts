// @vitest-environment node
/**
 * API de integración v1 · campos COMPLETOS (2026-11-24) contra Postgres real.
 *
 * El operador: «necesito que la integración tenga todos los campos completos,
 * tanto lo que envía como lo que recibe». Se fija aquí:
 *
 *  - un ERP crea el cliente con su ficha entera (documento, direcciones,
 *    contactos, cuenta de empresa con crédito) y la LEE igual de completa;
 *  - crea el producto con viñetas, peso y presentaciones, y lo LEE con
 *    variantes, unidades, marca, categoría…;
 *  - crea el pedido a nombre de esa cuenta, con facturación, OC y sus
 *    referencias, y lo LEE con cliente, direcciones y detalle fiscal de línea;
 *  - asigna la guía de despacho;
 *  - el stock sale desglosado por almacén;
 *  - el webhook lleva el pedido completo;
 *  - y nada de esto cruza de sociedad.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { RESOURCE_SCHEMAS } from '../functions/_shared/api/resourceSchemas.ts'

type Row = Record<string, unknown>

let db: PGlite
const ENTITLEMENT = 'ecommerce.integrations.enterprise'

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function credential(tenant: typeof TENANT_A, scopes: string[]): Promise<string> {
  const [row] = await asRole(db, 'authenticated', claimsFor(tenant), async () =>
    (await db.query<{ data: { id: string } }>(`select public.api_client_create($1, $2) as data`, ['erp-full', scopes])).rows,
  )
  return String(row?.data.id)
}

async function call<T = Row>(fn: string, args: string, params: unknown[]): Promise<T> {
  const [row] = await svc<{ data: T }>(`select public.${fn}(${args}) as data`, params)
  return row?.data as T
}

const ALL = [
  'order.read', 'order.create', 'order.update', 'product.read', 'stock.read',
  'customer.read', 'customer.write', 'catalog.write',
]
let clientA = ''
let clientB = ''

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
  })
  await svc(`update public.stores set status = 'active'`)
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      tenant.organizationId, tenant.companyId, [ENTITLEMENT],
    ])
  }
  clientA = await credential(TENANT_A, ALL)
  clientB = await credential(TENANT_B, ALL)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('clientes: ficha completa de ida y vuelta', () => {
  it('crea con documento, direcciones, contactos y cuenta de empresa, y lo lee igual', async () => {
    const report = await call<Row>('api_customers_upsert', '$1, false, $2::jsonb', [clientA, JSON.stringify({
      system: 'sap',
      customers: [{
        code: 'CLI-900', kind: 'company', name: 'Botica Central', legal_name: 'Botica Central S.A.C.',
        tax_id: '20123456789', tax_id_type: 'ruc', email: 'compras@botica.pe', phone: '014445555',
        external_id: 'C000900', tier: 'a', visit_frequency: 'weekly', geo: { lat: -12.05, lng: -77.04 },
        addresses: [
          { external_ref: 'D1', label: 'Almacén', line1: 'Av. Argentina 123', city: 'Lima', region: 'Lima',
            country: 'PE', is_shipping: true, is_default_shipping: true },
          { external_ref: 'F1', label: 'Fiscal', line1: 'Jr. Lampa 456', city: 'Lima', country: 'PE',
            is_shipping: false, is_billing: true, is_default_billing: true },
        ],
        contacts: [{ name: 'Ana Compras', email: 'ana@botica.pe', role_title: 'Jefa de compras', is_primary: true }],
        business_account: { code: 'BA-900', credit_limit: '15000.00', payment_terms_days: 30,
                            purchase_order_required: true },
      }],
    })])
    expect(report).toMatchObject({ applied: true, errors: 0 })

    const customer = await call<Row>('api_customer_get', '$1, $2', [clientA, 'CLI-900'])
    expect(customer).toMatchObject({
      code: 'CLI-900', tax_id: '20123456789', tax_id_type: 'ruc', tier: 'a', visit_frequency: 'weekly',
      geo: { lat: -12.05, lng: -77.04 }, external_ids: { sap: 'C000900' },
      contacts: [expect.objectContaining({ name: 'Ana Compras', is_primary: true })],
      business_account: expect.objectContaining({
        code: 'BA-900', credit_limit: '15000.00', payment_terms_days: 30, purchase_order_required: true,
      }),
    })
    expect(customer.addresses).toEqual(expect.arrayContaining([
      expect.objectContaining({ external_ref: 'D1', is_default_shipping: true }),
      expect.objectContaining({ external_ref: 'F1', is_default_billing: true, is_billing: true }),
    ]))
    // También por el id del ERP.
    expect(await call<Row>('api_customer_get', '$1, $2', [clientA, 'C000900'])).toMatchObject({ code: 'CLI-900' })
  })

  it('un segundo envío actualiza la dirección por su external_ref, sin duplicarla', async () => {
    await call('api_customers_upsert', '$1, false, $2::jsonb', [clientA, JSON.stringify({
      customers: [{ code: 'CLI-900', addresses: [{ external_ref: 'D1', line1: 'Av. Argentina 999' }] }],
    })])
    const customer = await call<{ addresses: Row[] }>('api_customer_get', '$1, $2', [clientA, 'CLI-900'])
    expect(customer.addresses.filter((a) => a.external_ref === 'D1')).toEqual([
      expect.objectContaining({ line1: 'Av. Argentina 999' }),
    ])
  })

  it('un dato malo en la ficha extendida rechaza el lote entero; simular no escribe', async () => {
    const bad = await call<{ applied: boolean; errors: number; rows: Row[] }>(
      'api_customers_upsert', '$1, false, $2::jsonb', [clientA, JSON.stringify({
        customers: [
          { code: 'CLI-901', kind: 'person', name: 'Bueno' },
          { code: 'CLI-902', kind: 'person', name: 'Malo', tax_id: '12345678', tax_id_type: 'pasaporte-x' },
        ],
      })])
    expect(bad).toMatchObject({ applied: false, errors: 1 })
    expect(bad.rows.find((r) => r.row === 2)).toMatchObject({ status: 'error' })

    const dry = await call<Row>('api_customers_upsert', '$1, true, $2::jsonb', [clientA, JSON.stringify({
      customers: [{ code: 'CLI-903', kind: 'person', name: 'Simulado', contacts: [{ name: 'X', phone: '999888777' }] }],
    })])
    expect(dry).toMatchObject({ dry_run: true, applied: false, errors: 0 })
    const rows = await svc(`select code from public.customers where code in ('CLI-901', 'CLI-902', 'CLI-903')`)
    expect(rows).toEqual([])
  })

  it('una persona no puede tener cuenta de empresa', async () => {
    const out = await call<{ applied: boolean; rows: Row[] }>('api_customers_upsert', '$1, false, $2::jsonb', [
      clientA, JSON.stringify({ customers: [{ code: 'CLI-904', kind: 'person', name: 'Persona', business_account: {} }] }),
    ])
    expect(out.applied).toBe(false)
    expect(JSON.stringify(out.rows)).toMatch(/CUENTA_SOLO_EMPRESA/)
  })

  it('otra sociedad no encuentra el cliente', async () => {
    expect(await expectFailure(() => call('api_customer_get', '$1, $2', [clientB, 'CLI-900']))).toMatch(/CLIENTE_NO_ENCONTRADO/)
  })
})

describe('productos: ficha completa', () => {
  it('crea con viñetas, peso y presentaciones, y lo lee con todo', async () => {
    const report = await call<Row>('api_catalog_upsert', '$1, $2::jsonb, false', [clientA, JSON.stringify({
      products: [{
        sku: 'FULL-001', name: 'Paracetamol 500 mg', description: 'Analgésico', kind: 'simple', stock: 40,
        highlights: ['Alivia el dolor', 'Caja x 100'], shipping_weight: 0.25,
        custom_fields: { laboratorio: 'Genfar' },
        units: [
          { code: 'UND', name: 'Unidad', factor: 1, is_base: true },
          { code: 'CJ100', name: 'Caja x 100', factor: 100, price: '45.00', barcode: '7750000001001' },
        ],
        publications: [{ store: TENANT_A.storeSlug, status: 'published', price: '0.50' }],
      }],
    })])
    expect(report).toMatchObject({ applied: true })

    const product = await call<Row>('api_product_get', '$1, $2, null', [clientA, 'FULL-001'])
    expect(product).toMatchObject({
      sku: 'FULL-001', description: 'Analgésico', highlights: ['Alivia el dolor', 'Caja x 100'],
      shipping_weight: 0.25, custom_fields: { laboratorio: 'Genfar' }, price: '0.50', status: 'published',
      variants: [], attributes: [], images: [],
    })
    expect(product.units).toEqual([
      expect.objectContaining({ code: 'UND', factor: 1, is_base: true }),
      expect.objectContaining({ code: 'CJ100', factor: 100, price: '45.00', barcode: '7750000001001' }),
    ])

    const list = await call<{ data: Row[] }>('api_products_list', '$1, 50, null, null, null', [clientA])
    expect(list.data.find((p) => p.sku === 'FULL-001')).toMatchObject({ units: expect.any(Array), highlights: expect.any(Array) })
  })

  it('un dato malo en lo nuevo rechaza el lote y simular no escribe', async () => {
    const bad = await call<{ applied: boolean; items: Row[] }>('api_catalog_upsert', '$1, $2::jsonb, false', [
      clientA, JSON.stringify({ products: [{ sku: 'FULL-002', name: 'Malo', kind: 'simple', shipping_weight: -1 }] }),
    ])
    expect(bad.applied).toBe(false)
    expect(bad.items[0]).toMatchObject({ status: 'rejected', product_id: null })

    const dry = await call<{ applied: boolean; dry_run: boolean }>('api_catalog_upsert', '$1, $2::jsonb, true', [
      clientA, JSON.stringify({ products: [{ sku: 'FULL-003', name: 'Simulado', kind: 'simple', highlights: ['a'] }] }),
    ])
    expect(dry).toMatchObject({ applied: false, dry_run: true })
    expect(await svc(`select sku from public.products where sku in ('FULL-002', 'FULL-003')`)).toEqual([])
  })

  it('el stock sale con el desglose por almacén', async () => {
    const stock = await call<Row>('api_stock_read', '$1, $2, null', [clientA, 'FULL-001'])
    expect(stock).toMatchObject({ sku: 'FULL-001', warehouses: expect.any(Array) })
    expect(stock).toHaveProperty('unknown')
  })

  it('otra sociedad no ve el producto', async () => {
    expect(await expectFailure(() => call('api_product_get', '$1, $2, null', [clientB, 'FULL-001']))).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })
})

describe('pedidos: completos de ida y vuelta', () => {
  let number = ''

  it('crea a nombre de la cuenta de empresa con facturación, OC y referencias', async () => {
    const order = await call<Row & { number: string; items: Row[] }>('api_order_create', '$1, $2::jsonb', [
      clientA, JSON.stringify({
        customer: { email: 'ana@botica.pe', name: 'Ana Compras', code: 'CLI-900' },
        items: [{ sku: 'FULL-001', quantity: 10 }],
        shipping_address: { address: 'Av. Argentina 999', city: 'Lima', country: 'PE' },
        billing_address: { legal_name: 'Botica Central S.A.C.', tax_id: '20123456789', address: 'Jr. Lampa 456',
                           country: 'PE', document_type: 'invoice' },
        purchase_order_number: 'OC-2026-0042',
        notes: 'Entregar por la mañana',
        external_refs: [{ system: 'sap', type: 'sales_order', id: '4500012345' }],
      }),
    ])
    number = order.number
    expect(order).toMatchObject({
      source: 'api',
      purchase_order_number: 'OC-2026-0042',
      notes: 'Entregar por la mañana',
      customer: expect.objectContaining({ email: 'ana@botica.pe', code: 'CLI-900', tax_id: '20123456789',
                                          external_ids: { sap: 'C000900' } }),
      business_account: expect.objectContaining({ code: 'BA-900', payment_terms_days: 30 }),
      billing_address: expect.objectContaining({ tax_id: '20123456789', document_type: 'invoice' }),
      shipping_address: expect.objectContaining({ address: 'Av. Argentina 999' }),
      external_refs: [expect.objectContaining({ system: 'sap', type: 'sales_order', id: '4500012345' })],
      payments: [], fulfillments: [],
    })
    expect(order.items[0]).toMatchObject({
      sku: 'FULL-001', product_sku: 'FULL-001', quantity: 10,
    })
    for (const key of ['tax_rate', 'tax_amount', 'discount_amount', 'uom_code', 'price_source', 'line_total']) {
      expect(order.items[0]).toHaveProperty(key)
    }

    // El listado trae el pedido con sus líneas.
    const list = await call<{ data: Row[] }>('api_orders_list', '$1, 50, null, null, null, null', [clientA])
    expect(list.data.find((o) => o.number === number)).toMatchObject({ items: [expect.any(Object)] })
  })

  it('el precio lo pone la tienda: una línea con importe se rechaza', async () => {
    expect(await expectFailure(() => call('api_order_create', '$1, $2::jsonb', [clientA, JSON.stringify({
        customer: { email: 'x@y.pe' }, items: [{ sku: 'FULL-001', quantity: 1, unit_price: '0.01' }],
      })]))).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('una cuenta o un cliente de otra sociedad no se pueden usar', async () => {
    expect(await expectFailure(() => call('api_order_create', '$1, $2::jsonb', [clientB, JSON.stringify({
        customer: { email: 'x@y.pe', code: 'CLI-900' }, items: [{ sku: 'FULL-001', quantity: 1 }],
      })]))).toMatch(/CLIENTE_NO_ENCONTRADO/)
    expect(await expectFailure(() => call('api_order_create', '$1, $2::jsonb', [clientB, JSON.stringify({
        customer: { email: 'x@y.pe' }, business_account: 'BA-900', items: [{ sku: 'FULL-001', quantity: 1 }],
      })]))).toMatch(/CUENTA_NO_ENCONTRADA/)
  })

  it('la guía de despacho necesita una entrega; con ella, queda en el pedido', async () => {
    expect(await expectFailure(() => call('api_order_update', '$1, $2, null, $3::jsonb', [clientA, number, JSON.stringify({
        shipment: { tracking_number: 'GR-001-123' },
      })]))).toMatch(/ENTREGA_INEXISTENTE/)

    const [order] = await svc<{ id: string; organization_id: string; company_id: string; store_id: string }>(
      `select id, organization_id, company_id, store_id from public.orders where order_number = $1`, [number])
    await svc(
      `insert into public.fulfillments (organization_id, company_id, store_id, order_id, sequence, method_code,
                                        method_name, strategy, currency, shipping_cost)
       values ($1, $2, $3, $4, 1, 'courier', 'Courier', 'ship', 'PEN', 0)`,
      [order?.organization_id, order?.company_id, order?.store_id, order?.id],
    )

    const out = await call<{ fulfillments: { shipments: Row[] }[]; changes: Row }>(
      'api_order_update', '$1, $2, null, $3::jsonb', [clientA, number, JSON.stringify({
        shipment: { tracking_number: 'GR-001-123', carrier: 'Olva', tracking_url: 'https://olva.pe/t/GR-001-123',
                    estimated_delivery: '2026-11-30' },
        external_refs: [{ system: 'sap', type: 'delivery', id: '80001234' }],
      })])
    expect(out.changes).toMatchObject({ shipment: true, external_refs: 1 })
    expect(out.fulfillments[0]?.shipments).toEqual([
      expect.objectContaining({ tracking_number: 'GR-001-123', service: 'olva', estimated_delivery: '2026-11-30' }),
    ])

    // Reenviar la misma guía no la duplica.
    const again = await call<{ fulfillments: { shipments: Row[] }[] }>(
      'api_order_update', '$1, $2, null, $3::jsonb', [clientA, number, JSON.stringify({
        shipment: { tracking_number: 'GR-001-123' },
      })])
    expect(again.fulfillments[0]?.shipments).toHaveLength(1)
  })

  it('el webhook lleva el mismo pedido completo que GET /v1/orders/{number}', async () => {
    const order = await call<{ items: Row[] }>('api_order_get', '$1, $2, null', [clientA, number])
    expect(order.items).toHaveLength(1)
    const [def] = await svc<{ d: string }>(
      `select pg_get_functiondef('ebim.webhook_fanout(uuid,uuid,uuid,text,jsonb)'::regprocedure) as d`)
    expect(def?.d).toContain(`'order', ebim.api_order_json(v_order_id, true)`)
  })
})

describe('la documentación no miente', () => {
  const keysOf = (name: string) =>
    Object.keys((RESOURCE_SCHEMAS[name]?.properties ?? {}) as Record<string, unknown>).sort()

  it('pedido, línea, producto, cliente y stock publican exactamente las claves que devuelve la base', async () => {
    const [o] = await svc<{ number: string }>(`select order_number as number from public.orders where source_channel = 'api' limit 1`)
    const order = await call<Row & { items: Row[] }>('api_order_get', '$1, $2, null', [clientA, o?.number])
    expect(Object.keys(order).sort()).toEqual(keysOf('Order'))
    expect(Object.keys(order.items[0] ?? {}).sort()).toEqual(keysOf('OrderItem'))

    const product = await call<Row>('api_product_get', '$1, $2, null', [clientA, 'FULL-001'])
    expect(Object.keys(product).sort()).toEqual(keysOf('Product'))

    const customer = await call<Row>('api_customer_get', '$1, $2', [clientA, 'CLI-900'])
    expect(Object.keys(customer).sort()).toEqual(keysOf('Customer'))

    const stock = await call<Row>('api_stock_read', '$1, $2, null', [clientA, 'FULL-001'])
    expect(Object.keys(stock).sort()).toEqual(keysOf('Stock'))
  })
})

describe('permisos', () => {
  it('las funciones nuevas solo las ejecuta el servidor', async () => {
    for (const fn of [
      'public.api_product_get(uuid, text, text)',
      'public.api_customer_get(uuid, text)',
      'ebim.api_order_json(uuid, boolean)',
      'ebim.api_product_json(uuid, uuid)',
      'ebim.api_customer_json(uuid)',
      'ebim.api_customer_apply_extras(uuid, jsonb)',
      'ebim.api_product_apply_extras(uuid, jsonb, text)',
      'ebim.api_order_update_core(uuid, text, text, jsonb)',
      'ebim.api_catalog_upsert_core(uuid, jsonb, boolean)',
    ]) {
      const [row] = await svc<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth`, [fn])
      expect(row, fn).toEqual({ anon: false, auth: false })
    }
  })
})
