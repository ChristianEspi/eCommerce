// @vitest-environment node
/**
 * Contrato de integración v1 (2026-11-24) contra Postgres real.
 *
 * Lo que un ERP necesita para cerrar el ciclo sin nadie en el backoffice:
 *
 *  - devolver el estado del pedido (pago, entrega, estado) con SUS referencias,
 *    con origen `api` en la línea de tiempo y un reintento que no falla;
 *  - crear y actualizar clientes por código, con su código de ERP;
 *  - fijar el saldo por almacén, solo en almacenes que lleva el ERP;
 *  - llenar una lista de precios;
 *  - leer solo lo que cambió (`updated_since`);
 *  - y, como siempre, nada de esto cruza de tenant ni funciona sin su scope.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { INTEGRATION_SCHEMAS } from '../functions/_shared/api/integrationSchemas.ts'
import { API_ROUTES } from '../functions/_shared/api/routes.ts'

type Row = Record<string, unknown>
interface Report {
  dry_run: boolean
  applied: boolean
  errors: number
  rows: Row[]
  [key: string]: unknown
}

let db: PGlite
const ENTITLEMENT = 'ecommerce.integrations.enterprise'

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function credential(tenant: typeof TENANT_A, scopes: string[]): Promise<string> {
  const [row] = await asRole(db, 'authenticated', claimsFor(tenant), async () =>
    (await db.query<{ data: { id: string } }>(`select public.api_client_create($1, $2) as data`, ['erp', scopes])).rows,
  )
  return String(row?.data.id)
}

async function call<T = Row>(fn: string, args: string, params: unknown[]): Promise<T> {
  const [row] = await svc<{ data: T }>(`select public.${fn}(${args}) as data`, params)
  return row?.data as T
}

let storeA = ''
let productA = ''
let orderNumber = ''
let orderId = ''

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId,
        tenant.companyId,
        tenant.slug,
        `Cuenta ${tenant.slug}`,
        tenant.adminEmail,
        tenant.ownerId,
        tenant.storeSlug,
        `Tienda ${tenant.slug}`,
      ])
    }
  })
  await svc(`update public.stores set status = 'active'`)
  const stores = await svc<{ id: string; slug: string }>(`select id, slug from public.stores`)
  storeA = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)

  const [product] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'ERP-001', 'erp-001', 'Artículo ERP', 100.00, 'PEN', 50, 'published', now())
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  productA = String(product?.id)

  const [order] = await svc<{ data: { order_id?: string; id?: string; order_number: string } }>(
    `select public.create_order($1, 'erp@test.com',
       jsonb_build_array(jsonb_build_object('product_id', $2::uuid, 'quantity', 1))) as data`,
    [storeA, productA],
  )
  const [created] = await svc<{ id: string; order_number: string }>(
    `select id, order_number from public.orders where store_id = $1 order by created_at desc limit 1`,
    [storeA],
  )
  void order
  orderId = String(created?.id)
  orderNumber = String(created?.order_number)

  await svc(
    `insert into public.warehouses (organization_id, company_id, code, name, source)
     values ($1, $2, 'ALM-ERP', 'Almacén del ERP', 'erp'), ($1, $2, 'ALM-TIENDA', 'Almacén de la tienda', 'local')`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  await svc(
    `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency)
     values ($1, $2, $3, 'mayorista', 'Mayorista', 'PEN')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
}, 180_000)

beforeEach(async () => {
  await svc(`delete from public.api_clients`)
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      tenant.organizationId,
      tenant.companyId,
      [ENTITLEMENT],
    ])
  }
})

afterAll(async () => {
  await db?.close()
})

describe('POST /v1/orders/{number}/status', () => {
  it('los valores que publica el OpenAPI son los de la base, y el ejemplo los respeta', async () => {
    const props = INTEGRATION_SCHEMAS.OrderStatusUpdate?.properties as Record<string, { enum: string[] }>
    const example = API_ROUTES.find((r) => r.operationId === 'updateOrderStatus')?.requestExample ?? {}
    for (const [field, type] of [
      ['status', 'order_status'],
      ['payment_status', 'payment_status'],
      ['fulfillment_status', 'fulfillment_status'],
    ] as const) {
      const [row] = await svc<{ labels: string[] }>(`select enum_range(null::public.${type})::text[] as labels`)
      expect(props[field]?.enum).toEqual(row?.labels)
      if (field in example) expect(row?.labels).toContain(example[field])
    }
  })

  it('cambia pago y entrega con origen `api` y guarda las referencias del ERP', async () => {
    const id = await credential(TENANT_A, ['order.update'])
    const out = await call<Row & { changes: Row }>('api_order_update', '$1, $2, null, $3::jsonb', [
      id,
      orderNumber,
      JSON.stringify({
        payment_status: 'paid',
        fulfillment_status: 'in_progress',
        reason: 'Facturado en el ERP',
        external_refs: [
          { system: 'sap', id: '4500012345' },
          { system: 'sap', type: 'invoice', id: 'F001-000123' },
        ],
      }),
    ])
    expect(out.changes).toMatchObject({
      changed: ['fulfillment_status', 'payment_status'],
      unchanged: [],
      external_refs: 2,
    })

    const events = await svc<{ axis: string; source: string; note: string | null }>(
      `select axis::text, source::text, note from public.order_events
        where order_id = $1 and axis::text in ('payment_status', 'fulfillment_status')`,
      [orderId],
    )
    expect(events.length).toBe(2)
    expect(events.every((e) => e.source === 'api')).toBe(true)

    const refs = await svc<{ ref_type: string; external_id: string }>(
      `select ref_type, external_id from public.order_external_refs where order_id = $1 order by ref_type`,
      [orderId],
    )
    expect(refs).toEqual([
      { ref_type: 'invoice', external_id: 'F001-000123' },
      { ref_type: 'order', external_id: '4500012345' },
    ])
  })

  it('un reintento con los mismos valores no falla: se informa como unchanged', async () => {
    const id = await credential(TENANT_A, ['order.update'])
    const out = await call<{ changes: Row }>('api_order_update', '$1, $2, null, $3::jsonb', [
      id,
      orderNumber,
      JSON.stringify({ payment_status: 'paid', external_refs: [{ system: 'sap', id: '4500099999' }] }),
    ])
    expect(out.changes).toMatchObject({ changed: [], unchanged: ['payment_status'], external_refs: 1 })
    const [ref] = await svc<{ external_id: string }>(
      `select external_id from public.order_external_refs where order_id = $1 and ref_type = 'order'`,
      [orderId],
    )
    expect(ref?.external_id).toBe('4500099999')
  })

  it('campos desconocidos, estados inventados y cuerpos vacíos se rechazan con su código', async () => {
    const id = await credential(TENANT_A, ['order.update'])
    const cases: Array<[Row, RegExp]> = [
      [{ total: 1 }, /CAMPO_NO_PERMITIDO/],
      [{ reason: 'solo motivo' }, /CAMBIOS_REQUERIDOS/],
      [{ status: 'volando' }, /ESTADO_NO_VALIDO/],
      [{ external_refs: [{ system: 'SAP MAYUS', id: 'x' }] }, /REFERENCIA_INVALIDA/],
    ]
    for (const [body, code] of cases) {
      const message = await expectFailure(() =>
        svc(`select public.api_order_update($1, $2, null, $3::jsonb)`, [id, orderNumber, JSON.stringify(body)]),
      )
      expect(message).toMatch(code)
    }
    const missing = await expectFailure(() =>
      svc(`select public.api_order_update($1, 'NO-EXISTE', null, '{"status":"paid"}'::jsonb)`, [id]),
    )
    expect(missing).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })

  it('sin order.update no escribe; otra sociedad no encuentra el pedido', async () => {
    const lector = await credential(TENANT_A, ['order.read'])
    expect(
      await expectFailure(() =>
        svc(`select public.api_order_update($1, $2, null, '{"status":"paid"}'::jsonb)`, [lector, orderNumber]),
      ),
    ).toMatch(/SCOPE_INSUFICIENTE/)

    const ajeno = await credential(TENANT_B, ['order.update'])
    expect(
      await expectFailure(() =>
        svc(`select public.api_order_update($1, $2, null, '{"status":"paid"}'::jsonb)`, [ajeno, orderNumber]),
      ),
    ).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })
})

describe('POST /v1/customers:batch', () => {
  it('crea por código con el código del ERP; un segundo lote actualiza sin borrar', async () => {
    const id = await credential(TENANT_A, ['customer.write', 'customer.read'])
    const first = await call<Report>('api_customers_upsert', '$1, false, $2::jsonb', [
      id,
      JSON.stringify({
        system: 'sap',
        customers: [{ code: 'C-0001', kind: 'company', name: 'Clínica', email: 'compras@clinica.test', external_id: '100045' }],
      }),
    ])
    expect(first).toMatchObject({ applied: true, errors: 0, created: 1 })

    const second = await call<Report>('api_customers_upsert', '$1, false, $2::jsonb', [
      id,
      JSON.stringify({ customers: [{ code: 'C-0001', phone: '+51999000111' }] }),
    ])
    expect(second).toMatchObject({ applied: true, updated: 1 })

    const list = await call<{ data: Row[] }>('api_customers_list', '$1', [id])
    const cliente = list.data.find((c) => c.code === 'C-0001')
    expect(cliente).toMatchObject({ email: 'compras@clinica.test', phone: '+51999000111' })
    expect(cliente?.external_ids).toEqual({ sap: '100045' })
  })

  it('todo o nada: una fila mala no deja escribir las buenas; simular no escribe', async () => {
    const id = await credential(TENANT_A, ['customer.write'])
    const bad = await call<Report>('api_customers_upsert', '$1, false, $2::jsonb', [
      id,
      JSON.stringify({
        customers: [
          { code: 'C-0100', kind: 'person', name: 'Buena' },
          { code: 'C-0101', kind: 'person', name: 'Mala', email: 'no-es-correo' },
        ],
      }),
    ])
    expect(bad.applied).toBe(false)
    expect(bad.errors).toBe(1)
    const dry = await call<Report>('api_customers_upsert', '$1, true, $2::jsonb', [
      id,
      JSON.stringify({ customers: [{ code: 'C-0102', kind: 'person', name: 'Simulada' }] }),
    ])
    expect(dry).toMatchObject({ dry_run: true, applied: false, errors: 0 })
    expect(await svc(`select 1 from public.customers where code in ('C-0100', 'C-0102')`)).toEqual([])
  })

  it('un campo que no es del contrato rechaza el lote: el tenant no viaja en el cuerpo', async () => {
    const id = await credential(TENANT_A, ['customer.write'])
    const message = await expectFailure(() =>
      svc(`select public.api_customers_upsert($1, false, $2::jsonb)`, [
        id,
        JSON.stringify({ customers: [{ code: 'C-0200', kind: 'person', name: 'X', organization_id: TENANT_B.organizationId }] }),
      ]),
    )
    expect(message).toMatch(/^CAMPO_NO_PERMITIDO: .*organization_id/)
    expect(await svc(`select 1 from public.customers where code = 'C-0200'`)).toEqual([])
  })
})

describe('POST /v1/stock:batch', () => {
  it('fija el saldo absoluto en un almacén del ERP; dos envíos distintos aplican los dos', async () => {
    const id = await credential(TENANT_A, ['stock.write'])
    for (const qty of [40, 25]) {
      const out = await call<Report>('api_stock_set', '$1, false, $2::jsonb', [
        id,
        JSON.stringify({ items: [{ sku: 'ERP-001', warehouse: 'alm-erp', on_hand: qty }] }),
      ])
      expect(out).toMatchObject({ applied: true, errors: 0, updated: 1 })
      const [level] = await svc<{ qty: string }>(
        `select l.on_hand_qty::text as qty from public.inventory_levels l
           join public.warehouses w on w.id = l.warehouse_id
          where w.code = 'ALM-ERP' and l.product_id = $1`,
        [productA],
      )
      expect(Number(level?.qty)).toBe(qty)
    }
    const same = await call<Report>('api_stock_set', '$1, false, $2::jsonb', [
      id,
      JSON.stringify({ items: [{ sku: 'ERP-001', warehouse: 'ALM-ERP', on_hand: 25 }] }),
    ])
    expect(same).toMatchObject({ applied: true, unchanged: 1 })
  })

  it('el almacén de la tienda no lo pisa el ERP, y el lote entero no se aplica', async () => {
    const id = await credential(TENANT_A, ['stock.write'])
    const out = await call<Report>('api_stock_set', '$1, false, $2::jsonb', [
      id,
      JSON.stringify({
        items: [
          { sku: 'ERP-001', warehouse: 'ALM-ERP', on_hand: 99 },
          { sku: 'ERP-001', warehouse: 'ALM-TIENDA', on_hand: 1 },
          { sku: 'NO-EXISTE', warehouse: 'ALM-ERP', on_hand: 1 },
          { sku: 'ERP-001', warehouse: 'NO-EXISTE', on_hand: 1 },
          { sku: 'ERP-001', warehouse: 'ALM-ERP', on_hand: -1 },
        ],
      }),
    ])
    expect(out.applied).toBe(false)
    expect(Object.fromEntries(out.rows.map((r) => [r.row, r.reason ?? r.status]))).toMatchObject({
      2: 'ALMACEN_NO_ERP',
      3: 'SKU_NO_ENCONTRADO',
      4: 'ALMACEN_NO_ENCONTRADO',
      5: 'VALOR_INVALIDO',
    })
    const [level] = await svc<{ qty: string }>(
      `select l.on_hand_qty::text as qty from public.inventory_levels l
         join public.warehouses w on w.id = l.warehouse_id
        where w.code = 'ALM-ERP' and l.product_id = $1`,
      [productA],
    )
    expect(Number(level?.qty)).toBe(25)
  })

  it('otra sociedad no ve los almacenes ni los SKU de esta', async () => {
    const ajeno = await credential(TENANT_B, ['stock.write'])
    const out = await call<Report>('api_stock_set', '$1, false, $2::jsonb', [
      ajeno,
      JSON.stringify({ items: [{ sku: 'ERP-001', warehouse: 'ALM-ERP', on_hand: 1 }] }),
    ])
    expect(out.applied).toBe(false)
    expect(out.rows[0]?.reason).toBe('ALMACEN_NO_ENCONTRADO')
  })
})

describe('POST /v1/price-lists/{code}/items:batch', () => {
  it('crea, actualiza y quita precios de la lista', async () => {
    const id = await credential(TENANT_A, ['price.write'])
    const created = await call<Report>('api_price_list_upsert', '$1, $2, null, false, $3::jsonb', [
      id,
      'mayorista',
      JSON.stringify({
        items: [
          { sku: 'ERP-001', price: '90.00', compare_at_price: '100.00' },
          { sku: 'ERP-001', price: 85, min_quantity: 12 },
        ],
      }),
    ])
    expect(created).toMatchObject({ applied: true, created: 2, errors: 0 })

    const updated = await call<Report>('api_price_list_upsert', '$1, $2, null, false, $3::jsonb', [
      id,
      'MAYORISTA',
      JSON.stringify({ items: [{ sku: 'ERP-001', price: '88.50' }, { sku: 'ERP-001', min_quantity: 12, active: false }] }),
    ])
    expect(updated).toMatchObject({ applied: true, updated: 2 })
    const items = await svc<{ unit_price: string; min_quantity: string }>(
      `select unit_price::text, min_quantity::text from public.price_list_items it
         join public.price_lists l on l.id = it.price_list_id where l.code = 'mayorista'`,
    )
    expect(items).toHaveLength(1)
    expect(Number(items[0]?.unit_price)).toBe(88.5)
  })

  it('moneda distinta, tachado menor y SKU ajeno son errores de fila; la lista tiene que existir', async () => {
    const id = await credential(TENANT_A, ['price.write'])
    const out = await call<Report>('api_price_list_upsert', '$1, $2, null, false, $3::jsonb', [
      id,
      'mayorista',
      JSON.stringify({
        items: [
          { sku: 'ERP-001', price: 10, currency: 'USD' },
          { sku: 'ERP-001', price: 10, compare_at_price: 5 },
          { sku: 'NO-EXISTE', price: 10 },
        ],
      }),
    ])
    expect(out.applied).toBe(false)
    expect(out.rows.map((r) => r.reason)).toEqual(['MONEDA_DISTINTA', 'VALOR_INVALIDO', 'SKU_NO_ENCONTRADO'])
    expect(
      await expectFailure(() =>
        svc(`select public.api_price_list_upsert($1, 'no-hay', null, false, '{"items":[]}'::jsonb)`, [id]),
      ),
    ).toMatch(/LISTA_NO_ENCONTRADA/)
    const ajeno = await credential(TENANT_B, ['price.write'])
    expect(
      await expectFailure(() =>
        svc(`select public.api_price_list_upsert($1, 'mayorista', null, false, '{"items":[]}'::jsonb)`, [ajeno]),
      ),
    ).toMatch(/LISTA_NO_ENCONTRADA/)
  })
})

describe('lecturas incrementales y catálogo por publicación', () => {
  it('updated_since filtra y la respuesta trae server_time', async () => {
    const id = await credential(TENANT_A, ['order.read', 'product.read', 'customer.read'])
    const futuro = '2999-01-01T00:00:00Z'
    for (const [fn, args] of [
      ['api_orders_list', '$1, 50, null, null, null, $2::timestamptz'],
      ['api_products_list', '$1, 50, null, null, $2::timestamptz'],
      ['api_customers_list', '$1, 50, null, $2::timestamptz'],
    ] as const) {
      const vacio = await call<{ data: Row[]; server_time: string }>(fn, args, [id, futuro])
      expect(`${fn}: ${vacio.data.length}`).toBe(`${fn}: 0`)
      expect(vacio.server_time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      const todo = await call<{ data: Row[] }>(fn, args, [id, '2000-01-01T00:00:00Z'])
      expect(todo.data.length).toBeGreaterThan(0)
    }
  })

  it('el catálogo de una tienda que no es la de origen sale con SU precio', async () => {
    const owner = claimsFor(TENANT_A)
    await asRole(db, 'authenticated', owner, async () =>
      db.query(`select public.create_store('segunda', 'Segunda tienda', 'PEN', null)`),
    )
    const [second] = await svc<{ id: string }>(`select id from public.stores where slug = 'segunda'`)
    await svc(
      `insert into public.store_products (organization_id, company_id, store_id, product_id, slug, status, price, currency, published_at)
       values ($1, $2, $3, $4, 'erp-001', 'published', 77.00, 'PEN', now())
       on conflict do nothing`,
      [TENANT_A.organizationId, TENANT_A.companyId, second?.id, productA],
    )
    await svc(`update public.store_products set price = 77.00 where store_id = $1 and product_id = $2`, [
      second?.id,
      productA,
    ])
    const id = await credential(TENANT_A, ['product.read'])
    const out = await call<{ data: Row[] }>('api_products_list', '$1, 50, null, $2', [id, 'segunda'])
    expect(out.data).toHaveLength(1)
    expect(out.data[0]).toMatchObject({ sku: 'ERP-001', price: '77.00', status: 'published' })
  })

  it('ninguna de las funciones nuevas la puede llamar anon ni un usuario con sesión', async () => {
    const id = await credential(TENANT_A, ['order.update'])
    for (const role of ['anon', 'authenticated'] as const) {
      const message = await expectFailure(() =>
        asRole(db, role, role === 'anon' ? null : claimsFor(TENANT_A), async () =>
          db.query(`select public.api_stock_set($1, true, '{"items":[]}'::jsonb)`, [id]),
        ),
      )
      expect(message).toMatch(/permission denied/i)
    }
    const internas = await svc<{ granted: boolean }>(
      `select has_function_privilege('authenticated', 'ebim.order_apply_transition(uuid, text, text, text, text)', 'execute')
           or has_function_privilege('authenticated', 'ebim.import_customers_core(uuid, uuid, boolean, jsonb, boolean)', 'execute') as granted`,
    )
    expect(internas[0]?.granted).toBe(false)
  })
})
