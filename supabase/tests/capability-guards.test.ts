// @vitest-environment node
/**
 * Cierre D3 · candado de SERVIDOR de `catalog.advanced`, `payments` y
 * `fulfillment`, probado por la puerta de atrás (migraciones 20260914180000–
 * 180300).
 *
 * `capability-enforcement.test.ts` demuestra que el candado EXISTE leyendo el
 * catálogo. Este archivo demuestra que FUNCIONA: un miembro legítimo, con rol
 * suficiente y claims válidos, que habla con la base directamente —PostgREST
 * con su propio token, sin pasar por el router— queda fuera si su sociedad no
 * tiene el módulo.
 *
 * Los cuatro estados de sociedad que importan, por módulo:
 *
 *   · **sin el módulo** — el hub sincronizó la sociedad y no lo devolvió: se
 *     deniega (policy o `MODULO_NO_CONTRATADO`);
 *   · **con el módulo** — el mismo intento pasa;
 *   · **nunca sincronizada** — el fallback legado documentado en 180000: pasa,
 *     que es lo que impide que cerrar el candado apague el módulo a todos;
 *   · **la sociedad de al lado** — con el módulo contratado no abre nada ajeno,
 *     y el rechazo es de PERMISO, no de módulo (no aprende nada del otro).
 *
 * Y la mitad que no se puede romper: el camino del comprador (checkout con
 * entrega, intención de cobro, aviso del proveedor, pedir una devolución) sigue
 * funcionando sin el módulo, por decisión escrita en 180200 y 180300.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'

type Row = Record<string, unknown>
type Tenant = typeof TENANT_A

let db: PGlite
let storeA: string
let storeB: string
let productA: string
let productA2: string
let productB: string
let brandA: string
let methodA: string
let deliveryMethodA: string
let fulfillmentA: string
let fulfillmentB: string
let shipmentA: string
let paymentA: string
let reconciliationA: string
let returnA: string
let orderForReturnA: string
let orderItemForReturnA: string

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000e3'
const CATALOG_USER = '0a000000-0000-4000-8000-0000000000e4'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d3'

const LIMA = {
  address: 'Av. Primavera 120',
  city: 'Lima',
  region: 'Lima',
  postal_code: '15023',
  country: 'PE',
}

const RLS = /row-level security policy/i
const MODULO = /MODULO_NO_CONTRATADO/

let buyerSeq = 0

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function asUser<T = Row>(
  claims: ReturnType<typeof claimsFor>,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

async function asAnon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => (await db.query<T>(query, params)).rows)
}

const adminA = () => claimsFor(TENANT_A)
const adminB = () => claimsFor(TENANT_B)
const ordersA = () =>
  claimsFor(TENANT_A, {
    sub: ORDERS_USER,
    email: 'pedidos@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'orders' }],
  })
const catalogA = () =>
  claimsFor(TENANT_A, {
    sub: CATALOG_USER,
    email: 'catalogo@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'catalog' }],
  })
const viewerA = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

// --- Los estados de la sociedad ------------------------------------------------

/** El hub sincroniza la sociedad con exactamente estos addons. */
async function syncWith(tenant: Tenant, entitlements: string[]): Promise<void> {
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [tenant.organizationId, tenant.companyId, entitlements],
  )
  await svc(`delete from public.tenant_feature_flags where organization_id = $1 and company_id = $2`, [
    tenant.organizationId,
    tenant.companyId,
  ])
}

/**
 * Simula una sociedad que el hub NUNCA sincronizó. Solo el servidor puede
 * borrar estas filas (160000): es un atajo de prueba, no algo que un tenant
 * pueda hacer para volver al fallback.
 */
async function neverSynced(tenant: Tenant): Promise<void> {
  for (const table of ['tenant_entitlements', 'tenant_platform_context', 'tenant_feature_flags']) {
    await svc(`delete from public.${table} where organization_id = $1 and company_id = $2`, [
      tenant.organizationId,
      tenant.companyId,
    ])
  }
}

// --- Fixtures -------------------------------------------------------------------

async function bootstrap(tenant: Tenant): Promise<string> {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId,
    tenant.companyId,
    tenant.slug,
    tenant.adminEmail,
    tenant.ownerId,
    tenant.storeSlug,
  ])
  const [store] = await svc(`select id from public.stores where slug = $1`, [tenant.storeSlug])
  const storeId = String(store?.id)
  await svc(`update public.stores set status = 'active' where id = $1`, [storeId])
  return storeId
}

async function newProduct(tenant: Tenant, storeId: string, sku: string): Promise<string> {
  const [row] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at, shipping_weight)
     values ($1, $2, $3, $4, $4, $4, 100.00, 'PEN', 500, 'published', now(), 1.000)
     returning id`,
    [tenant.organizationId, tenant.companyId, storeId, sku],
  )
  return String(row?.id)
}

async function deliveryNetwork(tenant: Tenant, storeId: string): Promise<string> {
  const [zone] = await svc(
    `insert into public.delivery_zones
       (organization_id, company_id, store_id, code, name, country, regions, postal_prefixes)
     values ($1, $2, $3, 'lima', 'Lima', 'PE', array['Lima'], array['150']) returning id`,
    [tenant.organizationId, tenant.companyId, storeId],
  )
  const [method] = await svc(
    `insert into public.delivery_methods
       (organization_id, company_id, store_id, code, strategy, display_name,
        lead_time_min_days, lead_time_max_days, is_active)
     values ($1, $2, $3, 'estandar', 'ship', 'Envio estandar', 1, 3, true) returning id`,
    [tenant.organizationId, tenant.companyId, storeId],
  )
  await svc(
    `insert into public.delivery_rates
       (organization_id, company_id, store_id, delivery_method_id, zone_id, currency, base_amount)
     values ($1, $2, $3, $4, $5, 'PEN', 15.00)`,
    [tenant.organizationId, tenant.companyId, storeId, method?.id, zone?.id],
  )
  return String(method?.id)
}

/** Checkout por la puerta del servidor, con o sin entrega. */
async function place(
  tenant: Tenant,
  productId: string,
  delivery: Record<string, unknown> | null,
): Promise<Row> {
  buyerSeq += 1
  const [row] = await svc(
    `select public.create_order_for_slug(
       $1, $2, $3::jsonb, null, null, $4::jsonb, null, null,
       'storefront', null, null, null, null, $5::jsonb) as result`,
    [
      tenant.storeSlug,
      `guardas${buyerSeq}@correo.test`,
      JSON.stringify([{ product_id: productId, quantity: 1 }]),
      JSON.stringify(LIMA),
      delivery === null ? null : JSON.stringify(delivery),
    ],
  )
  return row?.result as Row
}

async function capturedPayment(tenant: Tenant, key: string): Promise<string> {
  const order = await place(tenant, productA, null)
  const [intent] = await svc<{ result: Row }>(
    `select public.payment_intent_open($1, 'tarjeta', 100.00::numeric, 'PEN', $2) as result`,
    [tenant.storeSlug, `${key}-intent`],
  )
  const intentId = String(intent?.result.intent_id)
  await svc(`select public.payment_intent_attach_order($1, $2)`, [intentId, order.order_id])
  await svc(
    `select public.payment_apply_outcome(
        $1, 'payment.authorize', $2, 'succeeded', 'captured', 100.00::numeric, $3,
        null, null, null, null, 'provider_response', null, false, '{}'::jsonb)`,
    [intentId, `${key}-attempt`, `sbx-${key}`],
  )
  const [payment] = await svc(`select id from public.payments where payment_intent_id = $1`, [intentId])
  return String(payment?.id)
}

beforeAll(async () => {
  db = await createTestDatabase()

  storeA = await bootstrap(TENANT_A)
  storeB = await bootstrap(TENANT_B)

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'pedidos@tenant-a.com',  'orders',  'active'),
            ($1, $2, $4, 'catalogo@tenant-a.com', 'catalog', 'active'),
            ($1, $2, $5, 'lector@tenant-a.com',   'viewer',  'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, ORDERS_USER, CATALOG_USER, VIEWER_USER],
  )

  productA = await newProduct(TENANT_A, storeA, 'guarda-a')
  productA2 = await newProduct(TENANT_A, storeA, 'guarda-a2')
  productB = await newProduct(TENANT_B, storeB, 'guarda-b')

  const [brand] = await svc(
    `insert into public.brands (organization_id, company_id, code, name)
     values ($1, $2, 'marca-a', 'Marca A') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  brandA = String(brand?.id)

  const [method] = await svc(
    `insert into public.payment_methods
       (organization_id, company_id, store_id, code, kind, display_name, provider_code,
        capture_mode, is_active)
     values ($1, $2, $3, 'tarjeta', 'card', 'Tarjeta', 'sandbox', 'automatic', true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  methodA = String(method?.id)

  deliveryMethodA = await deliveryNetwork(TENANT_A, storeA)
  await deliveryNetwork(TENANT_B, storeB)

  await svc(
    `insert into public.return_reasons
       (organization_id, company_id, store_id, code, label, requires_evidence, restock_default)
     values ($1, $2, $3, 'no-me-gusto', 'No era lo que esperaba', false, true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )

  // Todo lo que sigue se crea con las dos sociedades SIN sincronizar: el
  // fallback legado es lo que deja al operador preparar los objetos.
  const withDeliveryA = await place(TENANT_A, productA, { method_code: 'estandar' })
  const [fulA] = await svc(`select id from public.fulfillments where order_id = $1`, [
    withDeliveryA.order_id,
  ])
  fulfillmentA = String(fulA?.id)

  const withDeliveryB = await place(TENANT_B, productB, { method_code: 'estandar' })
  const [fulB] = await svc(`select id from public.fulfillments where order_id = $1`, [
    withDeliveryB.order_id,
  ])
  fulfillmentB = String(fulB?.id)

  const [ship] = await asUser<{ result: Row }>(
    ordersA(),
    `select public.shipment_open($1, 'guarda-envio-0001') as result`,
    [fulfillmentA],
  )
  shipmentA = String(ship?.result.shipment_id)

  paymentA = await capturedPayment(TENANT_A, 'guarda-cobro-a')

  await asUser(
    ordersA(),
    `select public.payment_reconciliation_import('sandbox', $1::jsonb)`,
    [
      JSON.stringify([
        { settlement_date: '2026-09-01', external_reference: 'extracto-suelto-1', gross_amount: '10.00' },
      ]),
    ],
  )
  const [record] = await svc(
    `select id from public.reconciliation_records where external_reference = 'extracto-suelto-1'`,
  )
  reconciliationA = String(record?.id)

  const forReturn = await place(TENANT_A, productA, null)
  orderForReturnA = String(forReturn.order_id)
  const [item] = await svc(`select id from public.order_items where order_id = $1`, [orderForReturnA])
  orderItemForReturnA = String(item?.id)
  const [ret] = await asAnon<{ result: Row }>(
    `select public.return_request_for_slug($1, $2, $3, 'no-me-gusto', $4::jsonb) as result`,
    [
      TENANT_A.storeSlug,
      forReturn.order_number,
      forReturn.access_token,
      JSON.stringify([{ order_item_id: orderItemForReturnA, quantity: 1 }]),
    ],
  )
  returnA = String(ret?.result.return_request_id)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ===========================================================================
describe('el guard central y el fallback legado', () => {
  it('solo las tres capacidades de ADR 017 llevan fallback legado', async () => {
    const rows = await svc<{ code: string }>(
      `select code from public.app_capabilities where legacy_until_synced order by code`,
    )
    expect(rows.map((r) => r.code)).toEqual(['catalog.advanced', 'fulfillment', 'payments'])
  })

  it('nunca sincronizada: las tres cuentan; otra vendible no', async () => {
    await neverSynced(TENANT_A)
    const [row] = await svc<Row>(
      `select ebim.company_is_entitled($1, $2, 'payments')         as payments,
              ebim.company_is_entitled($1, $2, 'fulfillment')      as fulfillment,
              ebim.company_is_entitled($1, $2, 'catalog.advanced') as pim,
              ebim.company_is_entitled($1, $2, 'promotions')       as promotions`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(row).toEqual({ payments: true, fulfillment: true, pim: true, promotions: false })
  })

  it('una sincronizacion sin el addon lo cierra, aunque sea la primera', async () => {
    await syncWith(TENANT_A, [])
    const [row] = await svc<{ ok: boolean }>(
      `select ebim.company_is_entitled($1, $2, 'payments') as ok`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(row?.ok).toBe(false)
  })

  it('un corte tecnico apaga tambien lo concedido por el fallback', async () => {
    await neverSynced(TENANT_A)
    await svc(
      `insert into public.tenant_feature_flags (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'payments', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const [row] = await svc<{ ok: boolean }>(
      `select ebim.company_is_entitled($1, $2, 'payments') as ok`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(row?.ok).toBe(false)
    await neverSynced(TENANT_A)
  })

  /**
   * `company_is_entitled` es SECURITY INVOKER: para una sociedad ajena el
   * miembro no ve su fila de contexto y no puede distinguir «sin sincronizar»
   * de «no me dejan verla». El fallback NO se aplica a ciegas ahí.
   */
  it('preguntar por la sociedad de al lado sigue devolviendo false', async () => {
    await neverSynced(TENANT_B)
    await syncWith(TENANT_A, ['ecommerce.payments'])
    const [row] = await asUser<{ ok: boolean }>(
      adminA(),
      `select ebim.company_is_entitled($1, $2, 'payments') as ok`,
      [TENANT_B.organizationId, TENANT_B.companyId],
    )
    expect(row?.ok).toBe(false)
  })

  it('nadie fuera del servidor ejecuta el guard directamente', async () => {
    const message = await expectFailure(() =>
      asUser(adminA(), `select ebim.assert_capability($1, $2, 'payments')`, [
        TENANT_A.organizationId,
        TENANT_A.companyId,
      ]),
    )
    expect(message).toMatch(/permission denied/i)
  })
})

// ===========================================================================
describe('catalog.advanced — el PIM por PostgREST directo', () => {
  const insertBrand = (claims: ReturnType<typeof claimsFor>, tenant: Tenant, code: string) =>
    asUser(
      claims,
      `insert into public.brands (organization_id, company_id, code, name)
       values ($1, $2, $3, $3) returning id`,
      [tenant.organizationId, tenant.companyId, code],
    )

  it('sin el addon: marca, atributo, unidad y relacion se DENIEGAN en la base', async () => {
    await syncWith(TENANT_A, [])
    const attempts: Array<[string, unknown[]]> = [
      [
        `insert into public.brands (organization_id, company_id, code, name) values ($1, $2, 'sin-pim', 'x')`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ],
      [
        `insert into public.attributes (organization_id, company_id, code, name, data_type)
         values ($1, $2, 'sin_pim', 'x', 'text')`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ],
      [
        `insert into public.units_of_measure (organization_id, company_id, code, name)
         values ($1, $2, 'SINPIM', 'x')`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ],
      [
        `insert into public.product_relations
           (organization_id, company_id, store_id, product_id, related_product_id, relation_kind, position)
         values ($1, $2, $3, $4, $5, 'related', 0)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, productA, productA2],
      ],
    ]
    for (const [query, params] of attempts) {
      const message = await expectFailure(() => asUser(catalogA(), query, params))
      expect(`${query.slice(0, 40)}: ${message}`).toMatch(RLS)
    }
  })

  it('sin el addon: editar una marca activa se deniega; apagarla y borrarla no', async () => {
    await syncWith(TENANT_A, [])
    const renamed = await expectFailure(() =>
      asUser(adminA(), `update public.brands set name = 'Otra' where id = $1 returning id`, [brandA]),
    )
    expect(renamed).toMatch(RLS)

    const off = await asUser(
      adminA(),
      `update public.brands set is_active = false where id = $1 returning id`,
      [brandA],
    )
    expect(off).toHaveLength(1)

    const reactivate = await expectFailure(() =>
      asUser(adminA(), `update public.brands set is_active = true where id = $1 returning id`, [brandA]),
    )
    expect(reactivate).toMatch(RLS)

    const [temp] = await svc(
      `insert into public.brands (organization_id, company_id, code, name)
       values ($1, $2, 'temporal', 'Temporal') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const deleted = await asUser(adminA(), `delete from public.brands where id = $1 returning id`, [
      temp?.id,
    ])
    expect(deleted).toHaveLength(1)
  })

  it('con el addon: el mismo alta pasa', async () => {
    await syncWith(TENANT_A, ['ecommerce.catalog.advanced'])
    const rows = await insertBrand(catalogA(), TENANT_A, 'con-pim')
    expect(rows).toHaveLength(1)
    await asUser(adminA(), `update public.brands set is_active = true where id = $1`, [brandA])
  })

  it('nunca sincronizada: el fallback legado deja escribir', async () => {
    await neverSynced(TENANT_A)
    const rows = await insertBrand(catalogA(), TENANT_A, 'legado-pim')
    expect(rows).toHaveLength(1)
  })

  it('el addon de B no abre el PIM de A, y el de A no deja escribir en B', async () => {
    await syncWith(TENANT_A, [])
    await syncWith(TENANT_B, ['ecommerce.catalog.advanced'])
    expect(await expectFailure(() => insertBrand(adminB(), TENANT_A, 'b-en-a'))).toMatch(RLS)

    await syncWith(TENANT_A, ['ecommerce.catalog.advanced'])
    expect(await expectFailure(() => insertBrand(adminA(), TENANT_B, 'a-en-b'))).toMatch(RLS)
  })
})

// ===========================================================================
describe('payments — configuracion y comandos del operador', () => {
  const insertMethod = (claims: ReturnType<typeof claimsFor>, tenant: Tenant, store: string, code: string) =>
    asUser(
      claims,
      `insert into public.payment_methods
         (organization_id, company_id, store_id, code, kind, display_name, is_active)
       values ($1, $2, $3, $4, 'bank_transfer', $4, true) returning id`,
      [tenant.organizationId, tenant.companyId, store, code],
    )

  const refund = (claims: ReturnType<typeof claimsFor>, key: string) =>
    asUser<{ result: Row }>(
      claims,
      `select public.payment_refund_request($1, 1::numeric, $2) as result`,
      [paymentA, key],
    )

  const importStatement = (claims: ReturnType<typeof claimsFor>) =>
    asUser<{ result: Row }>(
      claims,
      `select public.payment_reconciliation_import('sandbox', '[]'::jsonb) as result`,
    )

  it('sin el addon: dar de alta un medio de pago activo se deniega', async () => {
    await syncWith(TENANT_A, [])
    expect(await expectFailure(() => insertMethod(adminA(), TENANT_A, storeA, 'sin-pagos'))).toMatch(RLS)
  })

  it('sin el addon: apagar el medio que ya existe SI se puede; encenderlo no', async () => {
    await syncWith(TENANT_A, [])
    const off = await asUser(
      adminA(),
      `update public.payment_methods set is_active = false where id = $1 returning id`,
      [methodA],
    )
    expect(off).toHaveLength(1)
    const on = await expectFailure(() =>
      asUser(adminA(), `update public.payment_methods set is_active = true where id = $1 returning id`, [
        methodA,
      ]),
    )
    expect(on).toMatch(RLS)
    await svc(`update public.payment_methods set is_active = true where id = $1`, [methodA])
  })

  it('sin el addon: devolver, importar y cuadrar se rechazan con MODULO_NO_CONTRATADO', async () => {
    await syncWith(TENANT_A, [])
    expect(await expectFailure(() => refund(ordersA(), 'guarda-refund-sin-01'))).toMatch(MODULO)
    expect(await expectFailure(() => importStatement(ordersA()))).toMatch(MODULO)
    expect(
      await expectFailure(() =>
        asUser(ordersA(), `select public.payment_reconciliation_match($1, $2)`, [
          reconciliationA,
          paymentA,
        ]),
      ),
    ).toMatch(MODULO)
  })

  it('el rol se comprueba ANTES que el modulo: un lector recibe SIN_PERMISO', async () => {
    await syncWith(TENANT_A, [])
    expect(await expectFailure(() => refund(viewerA(), 'guarda-refund-lector'))).toMatch(/SIN_PERMISO/)
  })

  it('con el addon: la devolucion y la importacion pasan', async () => {
    await syncWith(TENANT_A, ['ecommerce.payments'])
    const [row] = await refund(ordersA(), 'guarda-refund-con-01')
    expect(row?.result.status).toBe('requested')
    const [imported] = await importStatement(ordersA())
    expect(imported?.result.imported).toBe(0)
  })

  it('nunca sincronizada: el fallback legado deja devolver', async () => {
    await neverSynced(TENANT_A)
    const [row] = await refund(ordersA(), 'guarda-refund-legado')
    expect(row?.result.status).toBe('requested')
  })

  it('B con el addon no devuelve el cobro de A: SIN_PERMISO, no «modulo»', async () => {
    await syncWith(TENANT_A, [])
    await syncWith(TENANT_B, ['ecommerce.payments'])
    const message = await expectFailure(() => refund(adminB(), 'guarda-refund-ajeno'))
    expect(message).toMatch(/SIN_PERMISO/)
    expect(message).not.toMatch(MODULO)
    expect(await expectFailure(() => insertMethod(adminB(), TENANT_A, storeA, 'b-en-a'))).toMatch(RLS)
  })

  it('sin el addon el camino del comprador y del proveedor NO se corta', async () => {
    await syncWith(TENANT_A, [])
    const paymentId = await capturedPayment(TENANT_A, 'guarda-cobro-sin-addon')
    const [payment] = await svc<{ status: string }>(`select status from public.payments where id = $1`, [
      paymentId,
    ])
    expect(payment?.status).toBeTruthy()

    // La devolución ya pedida la liquida el proveedor aunque el addon caducara.
    await syncWith(TENANT_A, ['ecommerce.payments'])
    const [requested] = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 5::numeric, 'guarda-refund-prov-1') as result`,
      [paymentId],
    )
    await syncWith(TENANT_A, [])
    const [settled] = await svc<{ result: Row }>(
      `select public.payment_refund_settle($1, 'succeeded', 'sbx-guarda-ref') as result`,
      [requested?.result.refund_id],
    )
    expect(settled?.result.status).toBe('succeeded')
  })
})

// ===========================================================================
describe('fulfillment — red de entrega, despacho y devoluciones del backoffice', () => {
  const insertZone = (claims: ReturnType<typeof claimsFor>, tenant: Tenant, store: string, code: string) =>
    asUser(
      claims,
      `insert into public.delivery_zones
         (organization_id, company_id, store_id, code, name, country, regions)
       values ($1, $2, $3, $4, $4, 'PE', array['Cusco']) returning id`,
      [tenant.organizationId, tenant.companyId, store, code],
    )

  const transition = (claims: ReturnType<typeof claimsFor>, id: string, to: string) =>
    asUser<{ result: Row }>(claims, `select public.fulfillment_transition($1, $2) as result`, [id, to])

  it('sin el addon: dar de alta una zona activa se deniega; apagar un metodo no', async () => {
    await syncWith(TENANT_A, [])
    expect(await expectFailure(() => insertZone(adminA(), TENANT_A, storeA, 'sin-entregas'))).toMatch(RLS)

    const off = await asUser(
      adminA(),
      `update public.delivery_methods set is_active = false where id = $1 returning id`,
      [deliveryMethodA],
    )
    expect(off).toHaveLength(1)
    const on = await expectFailure(() =>
      asUser(
        adminA(),
        `update public.delivery_methods set is_active = true where id = $1 returning id`,
        [deliveryMethodA],
      ),
    )
    expect(on).toMatch(RLS)
    await svc(`update public.delivery_methods set is_active = true where id = $1`, [deliveryMethodA])
  })

  it('sin el addon: los siete comandos del operador se rechazan con MODULO_NO_CONTRATADO', async () => {
    await syncWith(TENANT_A, [])
    const order = await place(TENANT_A, productA, null)
    const [item] = await svc(`select id from public.order_items where order_id = $1`, [order.order_id])

    const commands: Array<[string, unknown[]]> = [
      [`select public.fulfillment_create($1, 'estandar')`, [order.order_id]],
      [`select public.fulfillment_assign($1)`, [fulfillmentA]],
      [`select public.fulfillment_transition($1, 'allocated')`, [fulfillmentA]],
      [`select public.shipment_open($1, 'guarda-envio-sin-01')`, [fulfillmentA]],
      [`select public.shipment_track_note($1, 'in_transit', 'llamada')`, [shipmentA]],
      [
        `select public.return_open($1, 'no-me-gusto', $2::jsonb)`,
        [order.order_id, JSON.stringify([{ order_item_id: item?.id, quantity: 1 }])],
      ],
      [`select public.return_decide($1, 'approve', 'Procede')`, [returnA]],
    ]
    for (const [query, params] of commands) {
      const message = await expectFailure(() => asUser(ordersA(), query, params))
      expect(`${query}: ${message}`).toMatch(MODULO)
    }
  })

  it('el rol se comprueba ANTES que el modulo: un lector recibe SIN_PERMISO', async () => {
    await syncWith(TENANT_A, [])
    expect(await expectFailure(() => transition(viewerA(), fulfillmentA, 'allocated'))).toMatch(
      /SIN_PERMISO/,
    )
  })

  it('con el addon: mover la entrega, decidir la devolucion y dar de alta una zona pasan', async () => {
    await syncWith(TENANT_A, ['ecommerce.fulfillment'])
    const [moved] = await transition(ordersA(), fulfillmentA, 'allocated')
    expect(moved?.result.state).toBe('allocated')

    const [decided] = await asUser<{ result: Row }>(
      ordersA(),
      `select public.return_decide($1, 'approve', 'Procede') as result`,
      [returnA],
    )
    expect(decided?.result).toBeTruthy()

    expect(await insertZone(adminA(), TENANT_A, storeA, 'con-entregas')).toHaveLength(1)
  })

  it('nunca sincronizada: el fallback legado deja operar', async () => {
    await neverSynced(TENANT_A)
    const [moved] = await transition(ordersA(), fulfillmentA, 'picking')
    expect(moved?.result.state).toBe('picking')
  })

  it('B con el addon no mueve la entrega de A: SIN_PERMISO, no «modulo»', async () => {
    await syncWith(TENANT_A, [])
    await syncWith(TENANT_B, ['ecommerce.fulfillment'])
    const message = await expectFailure(() => transition(adminB(), fulfillmentA, 'packed'))
    expect(message).toMatch(/SIN_PERMISO/)
    expect(message).not.toMatch(MODULO)

    // Y su propia entrega sí la mueve: el candado es por sociedad, no global.
    const [own] = await transition(adminB(), fulfillmentB, 'allocated')
    expect(own?.result.state).toBe('allocated')

    expect(await expectFailure(() => insertZone(adminB(), TENANT_A, storeA, 'b-en-a'))).toMatch(RLS)
  })

  it('sin el addon el checkout con entrega y la devolucion del comprador siguen funcionando', async () => {
    await syncWith(TENANT_A, [])
    const order = await place(TENANT_A, productA, { method_code: 'estandar' })
    const [ful] = await svc(`select id from public.fulfillments where order_id = $1`, [order.order_id])
    expect(ful?.id).toBeTruthy()

    const [item] = await svc(`select id from public.order_items where order_id = $1`, [order.order_id])
    const [ret] = await asAnon<{ result: Row }>(
      `select public.return_request_for_slug($1, $2, $3, 'no-me-gusto', $4::jsonb) as result`,
      [
        TENANT_A.storeSlug,
        order.order_number,
        order.access_token,
        JSON.stringify([{ order_item_id: item?.id, quantity: 1 }]),
      ],
    )
    expect(ret?.result.state).toBe('requested')
  })
})
