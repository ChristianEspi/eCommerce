// @vitest-environment node
/**
 * R01 · La entrega que cotiza el checkout es la que cobra el pedido, también
 * para Trade, Enterprise y multi-cuenta. Sobre Postgres real.
 *
 * ## El hueco
 *
 * `delivery_options_for_slug` recalcula el subtotal con `ebim.build_quote`, que
 * resuelve el precio comercial desde la SESIÓN (`ebim.pricing_actor`). Pero la
 * etapa 7 del checkout la llamaba con `service_role`: sin sesión, el subtotal
 * salía a precio PÚBLICO. Con un umbral de envío gratis entre medio, el
 * checkout daba el envío por gratis (y autorizaba el cobro, el tope por persona
 * y la aprobación con ese total) mientras `create_order`, con el precio
 * comercial, cobraba el envío.
 *
 * ## Qué se fija
 *
 * Para invitado, consumidor, comercio, empresa y las dos cuentas de una persona:
 * el importe de entrega de `validateDelivery` (adaptador de producción sobre
 * esta base) es el `shipping_total` del pedido que crea `runCheckout` con la
 * misma sesión. Y la petición sigue sin precio, cliente, segmento, cuenta ni
 * tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'
import type { CheckoutContext } from '../functions/_shared/checkout/ports.ts'

type Row = Record<string, unknown>

const ENTITLEMENTS = ['ecommerce.pricing.lists', 'ecommerce.inventory.multiwarehouse', 'ecommerce.fulfillment']
const COMERCIO = '0f600000-0000-4000-8000-0000000000c1'
const EMPRESA = '0f600000-0000-4000-8000-0000000000e1'
const DOS_CUENTAS = '0f600000-0000-4000-8000-0000000000d1'
const CONSUMIDOR = '0f600000-0000-4000-8000-0000000000f1'

const DIRECCION = { address: 'Av. Industrial 450', city: 'Lima', region: 'Lima', postal_code: '15001', country: 'PE' }

let db: PGlite
let storeA = ''
let producto = ''
let cuentaA = ''
let cuentaB = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }
}

interface Llamada {
  readonly quien: 'service' | 'caller'
  readonly fn: string
  readonly args: Record<string, unknown>
}

function pgCaller(role: 'authenticated' | 'service_role' | 'anon', sub: string | null, log?: Llamada[]): RpcCaller {
  return async (fn, args) => {
    log?.push({ quien: role === 'service_role' ? 'service' : 'caller', fn, args })
    return asRole(db, role, sub ? shopper(sub) : null, async () => {
      const keys = Object.keys(args)
      const values = keys.map((key) => {
        const value = args[key]
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
      })
      const call = keys.map((key, index) => `${key} => $${index + 1}`).join(', ')
      const { rows } = await db.query<{ r: unknown }>(`select public.${fn}(${call}) as r`, values)
      return rows[0]?.r ?? null
    })
  }
}

/** Los puertos de producción, como los arma la Edge Function: `caller` con la sesión (o anónimo). */
function ports(sub: string | null, log?: Llamada[]) {
  return createDbPorts({
    service: pgCaller('service_role', null, log),
    caller: sub ? pgCaller('authenticated', sub, log) : pgCaller('anon', null, log),
    hasSession: sub !== null,
  })
}

const CONTEXTO: CheckoutContext = {
  storeSlug: TENANT_A.storeSlug,
  storeName: 'Tienda',
  currency: 'PEN',
  channelCode: 'b2c',
  channelKind: 'b2c',
  requiresAuth: false,
  requiresAccount: false,
  taxInclusive: false,
}

/** Lo que el checkout cree que cuesta la entrega (etapa 7). */
async function entregaCotizada(sub: string | null, log?: Llamada[]): Promise<string> {
  const delivery = await ports(sub, log).validateDelivery({
    context: CONTEXTO,
    address: DIRECCION,
    account: { hasSession: sub !== null, userId: null, accountId: null, role: null, spendingLimit: null },
    choice: { methodCode: 'estandar', pickupPointId: null, window: null },
    items: [{ product_id: producto, quantity: 2 }],
  })
  expect(delivery.deliverable).toBe(true)
  return delivery.amount
}

let compras = 0
/** Lo que el pedido COBRA de entrega, con la misma sesión. */
async function entregaCobrada(sub: string | null): Promise<string> {
  compras += 1
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody({
    store_slug: TENANT_A.storeSlug,
    idempotency_key: `r01-entrega-${compras}-${'e'.repeat(24)}`,
    customer_email: `r01-${compras}@compras.test`,
    customer_name: 'Compras R01',
    customer_phone: '+51 999 000 444',
    shipping_address: DIRECCION,
    items: [{ product_id: producto, quantity: 2 }],
    delivery: { method_code: 'estandar' },
  })
  const result = await runCheckout(ports(sub), input)
  const [order] = await svc<{ shipping_total: string }>(
    `select shipping_total::text from public.orders where id = $1`,
    [result.order.orderId],
  )
  return String(order?.shipping_total)
}

async function cliente(code: string, segment: string | null): Promise<string> {
  return id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email, segment_id)
     values ($1, $2, 'company', $3, $3, $4, $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `${code.toLowerCase()}@cliente.test`, segment],
  )
}

async function cuenta(customerId: string, code: string, createdAt: string, extra = ''): Promise<string> {
  const accountId = await id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name, created_at)
     values ($1, $2, $3, $4, $4, $5::timestamptz) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customerId, code, createdAt],
  )
  if (extra) await svc(`update public.business_accounts set ${extra} where id = $1`, [accountId])
  return accountId
}

async function vincular(accountId: string, userId: string) {
  await svc(
    `insert into public.business_account_users (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, accountId, userId, `${userId}@compras.test`],
  )
}

async function lista(code: string, scope: 'segment' | 'customer', target: string, price: string) {
  const listId = await id(
    `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from)
     values ($1, $2, $3, $4, $4, 'PEN', now() - interval '1 day') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, code],
  )
  await svc(
    `insert into public.price_list_assignments (organization_id, company_id, store_id, price_list_id, scope, segment_id, customer_id)
     values ($1, $2, $3, $4, $5::public.price_scope, $6, $7)`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, listId, scope,
      scope === 'segment' ? target : null, scope === 'customer' ? target : null,
    ],
  )
  await svc(
    `insert into public.price_list_items (organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price)
     values ($1, $2, $3, $4, $5, 1, $6)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, listId, producto, price],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.slug, TENANT_A.adminEmail, TENANT_A.ownerId, TENANT_A.storeSlug,
  ])
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId, TENANT_A.companyId, ENTITLEMENTS,
  ])
  storeA = await id(`update public.stores set status = 'active' where slug = $1 returning id`, [TENANT_A.storeSlug])
  await svc(`update public.store_settings set tax_rate = 0`)

  // Precio público 100: con 2 unidades el invitado (200) supera el umbral de
  // envío gratis (150); el comercio (60 → 120) y la empresa (70 → 140) no.
  producto = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'R01-GUANTES', 'r01-guantes', 'Guantes', '100.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(`insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'LIMA', 'Lima')`, [
    TENANT_A.organizationId, TENANT_A.companyId,
  ])
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
    db.query(`select public.seed_inventory_from_catalog((select id from public.warehouses where code = 'LIMA'), $1)`, [storeA]),
  )

  const [zona] = await svc<{ id: string }>(
    `insert into public.delivery_zones (organization_id, company_id, store_id, code, name, country, regions, postal_prefixes)
     values ($1, $2, $3, 'lima', 'Lima', 'PE', array['Lima'], array['150']) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  const [metodo] = await svc<{ id: string }>(
    `insert into public.delivery_methods (organization_id, company_id, store_id, code, strategy, display_name,
        lead_time_min_days, lead_time_max_days, is_active)
     values ($1, $2, $3, 'estandar', 'ship', 'Envio estandar', 1, 3, true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(
    `insert into public.delivery_rates (organization_id, company_id, store_id, delivery_method_id, zone_id, currency,
        base_amount, free_over_subtotal)
     values ($1, $2, $3, $4, $5, 'PEN', 15.00, 150.00)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, metodo?.id, zona?.id],
  )

  const mayorista = await id(
    `insert into public.customer_segments (organization_id, company_id, code, name) values ($1, $2, 'mayorista', 'Mayorista') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  await lista('mayorista', 'segment', mayorista, '60.00')

  // Comercio: segmento mayorista, sin controles.
  await vincular(await cuenta(await cliente('BODEGA', mayorista), 'BODEGA', '2026-01-01T00:00:00Z'), COMERCIO)

  // Empresa: convenio de cliente a 70 y crédito a 30 días.
  const clienteEmpresa = await cliente('CORP', null)
  await lista('convenio-corp', 'customer', clienteEmpresa, '70.00')
  await vincular(await cuenta(clienteEmpresa, 'CORP', '2026-01-01T00:00:00Z', 'credit_limit = 5000, payment_terms_days = 30'), EMPRESA)

  // Una persona con dos cuentas: A (mayorista, 60 → paga envío) y B (convenio a 90 → envío gratis).
  cuentaA = await cuenta(await cliente('MULTI-A', mayorista), 'MULTI-A', '2026-01-01T00:00:00Z')
  const clienteB = await cliente('MULTI-B', null)
  await lista('convenio-multi-b', 'customer', clienteB, '90.00')
  cuentaB = await cuenta(clienteB, 'MULTI-B', '2026-02-01T00:00:00Z')
  await vincular(cuentaA, DOS_CUENTAS)
  await vincular(cuentaB, DOS_CUENTAS)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('entrega del checkout = entrega del pedido', () => {
  it('invitado: precio público (200 ≥ 150) → envío gratis en los dos', async () => {
    expect(await entregaCotizada(null)).toBe('0.00')
    expect(await entregaCobrada(null)).toBe('0.00')
  })

  it('consumidor con sesión: igual que el invitado', async () => {
    expect(await entregaCotizada(CONSUMIDOR)).toBe('0.00')
    expect(await entregaCobrada(CONSUMIDOR)).toBe('0.00')
  })

  it('comercio: el umbral se evalúa con SU precio (120 < 150) → paga envío en los dos', async () => {
    const cotizada = await entregaCotizada(COMERCIO)
    expect(cotizada).toBe('15.00')
    expect(await entregaCobrada(COMERCIO)).toBe(cotizada)
  })

  it('empresa: el umbral se evalúa con el precio de su cuenta efectiva (140 < 150)', async () => {
    const cotizada = await entregaCotizada(EMPRESA)
    expect(cotizada).toBe('15.00')
    expect(await entregaCobrada(EMPRESA)).toBe(cotizada)
  })

  it('multi-cuenta: A paga envío; al elegir B (180 ≥ 150) pasa a gratis, en cotización y pedido', async () => {
    const elegir = (accountId: string) =>
      asRole(db, 'authenticated', shopper(DOS_CUENTAS), async () =>
        db.query(`select public.select_store_business_account($1, $2)`, [TENANT_A.storeSlug, accountId]),
      )

    await elegir(cuentaA)
    expect(await entregaCotizada(DOS_CUENTAS)).toBe('15.00')
    expect(await entregaCobrada(DOS_CUENTAS)).toBe('15.00')

    await elegir(cuentaB)
    expect(await entregaCotizada(DOS_CUENTAS)).toBe('0.00')
    expect(await entregaCobrada(DOS_CUENTAS)).toBe('0.00')
  })
})

describe('la cotización de entrega no lleva identidad ni dinero', () => {
  it('va con la sesión del comprador, no con service_role', async () => {
    const log: Llamada[] = []
    await entregaCotizada(COMERCIO, log)
    const llamada = log.find((c) => c.fn === 'delivery_options_for_slug')
    expect(llamada?.quien).toBe('caller')
  })

  it('solo tienda, dirección y qué se compra: sin precio, cliente, segmento, cuenta ni tenant', async () => {
    const log: Llamada[] = []
    await entregaCotizada(EMPRESA, log)
    const { args } = log.find((c) => c.fn === 'delivery_options_for_slug')!
    expect(Object.keys(args).sort()).toEqual(['p_address', 'p_items', 'p_store_slug'])
    expect(args.p_items).toEqual([{ product_id: producto, quantity: 2 }])
    const texto = JSON.stringify(args)
    for (const prohibida of [
      'price', 'unit_price', 'subtotal', 'total', 'discount', 'customer_id', 'segment_id',
      'price_list_id', 'business_account_id', 'organization_id', 'company_id', 'user_id',
    ]) {
      expect(texto, prohibida).not.toContain(`"${prohibida}"`)
    }
  })

  it('la función pública conserva su firma: no hay dónde escribir una identidad', async () => {
    const [row] = await svc<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'delivery_options_for_slug'`,
    )
    expect(row?.args).toBe('p_store_slug text, p_address jsonb, p_items jsonb')
  })
})
