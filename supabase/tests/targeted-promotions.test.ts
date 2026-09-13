// @vitest-environment node
/**
 * N04 · Promociones dirigidas: la cotización del carrito dice lo mismo que el
 * pedido, sobre Postgres real.
 *
 * Para cada audiencia (`all`, `segment`, `customer`, `business_account`) se
 * compara el descuento y el total de `promotion_quote_for_slug` —con la sesión
 * del comprador, como la vitrina— contra el pedido que crea el checkout de
 * producción (`runCheckout` + `createDbPorts`) con esa misma sesión. Y los
 * negativos: usuario equivocado, invitado, y la cuenta elegida en N01
 * cambiando qué campaña aplica.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const ENTITLEMENTS = ['ecommerce.pricing.lists', 'ecommerce.promotions', 'ecommerce.inventory.multiwarehouse']
const DOS_CUENTAS = '0f300000-0000-4000-8000-00000000e001'
const OTRA_PERSONA = '0f300000-0000-4000-8000-00000000e002'
const CONSUMIDOR = '0f300000-0000-4000-8000-00000000e003'

let db: PGlite
let storeA = ''
let jabon = ''
let segmento = ''
let clienteA = ''
let clienteB = ''
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

function pgCaller(role: 'authenticated' | 'service_role', sub: string | null): RpcCaller {
  return async (fn, args) =>
    asRole(db, role, sub ? shopper(sub) : null, async () => {
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

/** Lo que el comprador VE: la cotización con su sesión (o anónima). */
async function preview(sub: string | null): Promise<{ discount: string; total: string }> {
  const run = async () =>
    (
      await db.query<{ q: Row }>(`select public.promotion_quote_for_slug($1, $2::jsonb) as q`, [
        TENANT_A.storeSlug,
        JSON.stringify([{ product_id: jabon, quantity: 2 }]),
      ])
    ).rows
  const [row] = sub ? await asRole(db, 'authenticated', shopper(sub), run) : await asRole(db, 'anon', null, run)
  return { discount: String(row?.q.discount_total), total: String(row?.q.grand_total) }
}

let compras = 0
/** Lo que se COBRA: el checkout de producción con la misma sesión. */
async function pedido(sub: string | null): Promise<{ discount: string; total: string; account: string | null }> {
  compras += 1
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody({
    store_slug: TENANT_A.storeSlug,
    idempotency_key: `n04-promos-${compras}-${'y'.repeat(24)}`,
    customer_email: `compra${compras}@empresa.test`,
    customer_name: 'Compras Empresa',
    customer_phone: '+51 999 000 222',
    shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
    items: [{ product_id: jabon, quantity: 2 }],
  })
  const result = await runCheckout(
    createDbPorts({ service: pgCaller('service_role', null), caller: pgCaller('authenticated', sub), hasSession: sub !== null }),
    input,
  )
  const [order] = await svc<{ discount_total: string; grand_total: string; business_account_id: string | null }>(
    `select discount_total::text, grand_total::text, business_account_id from public.orders where id = $1`,
    [result.order.orderId],
  )
  return { discount: String(order?.discount_total), total: String(order?.grand_total), account: order?.business_account_id ?? null }
}

async function elegir(sub: string, accountId: string) {
  await asRole(db, 'authenticated', shopper(sub), async () =>
    db.query(`select public.select_store_business_account($1, $2)`, [TENANT_A.storeSlug, accountId]),
  )
}

const promos: string[] = []
/** Una campaña del 10 % sobre todo, dirigida a UNA audiencia. */
async function campana(code: string, percent: string, audience: Record<string, string | null> | null) {
  const promo = await id(
    `insert into public.promotions
       (organization_id, company_id, store_id, code, name, kind, status, value_percent, valid_from)
     values ($1, $2, $3, $4, $4, 'percentage', 'active', $5, now() - interval '1 day') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, code.toLowerCase(), percent],
  )
  await svc(
    `insert into public.promotion_scopes (organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind)
     values ($1, $2, $3, $4, 'percentage', 'all')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, promo],
  )
  if (audience) {
    await svc(
      `insert into public.promotion_audiences
         (organization_id, company_id, store_id, promotion_id, audience_kind, segment_id, customer_id, business_account_id)
       values ($1, $2, $3, $4, $5::public.promotion_audience_kind, $6, $7, $8)`,
      [
        TENANT_A.organizationId, TENANT_A.companyId, storeA, promo, audience.kind,
        audience.segment ?? null, audience.customer ?? null, audience.account ?? null,
      ],
    )
  }
  promos.push(promo)
  return promo
}

async function cliente(code: string, segment: string | null): Promise<string> {
  return id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email, segment_id)
     values ($1, $2, 'company', $3, $3, $4, $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `${code.toLowerCase()}@cliente.test`, segment],
  )
}

async function cuenta(customerId: string, code: string, createdAt: string) {
  return id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name, created_at)
     values ($1, $2, $3, $4, $4, $5::timestamptz) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customerId, code, createdAt],
  )
}

async function vincular(accountId: string, userId: string) {
  await svc(
    `insert into public.business_account_users (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, accountId, userId, `${userId}@compras.test`],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
    ])
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      tenant.organizationId, tenant.companyId, ENTITLEMENTS,
    ])
  }
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0`)
  storeA = await id(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug])

  jabon = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'N04-JABON', 'n04-jabon', 'Jabón', '50.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(`insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'LIMA', 'Lima')`, [
    TENANT_A.organizationId, TENANT_A.companyId,
  ])
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
    db.query(`select public.seed_inventory_from_catalog((select id from public.warehouses where code = 'LIMA'), $1)`, [storeA]),
  )

  segmento = await id(
    `insert into public.customer_segments (organization_id, company_id, code, name) values ($1, $2, 'clinicas', 'Clínicas') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  // A: cliente del segmento, la cuenta más antigua. B: otro cliente, sin segmento.
  clienteA = await cliente('CLINICA-A', segmento)
  clienteB = await cliente('EMPRESA-B', null)
  cuentaA = await cuenta(clienteA, 'CUENTA-A', '2026-01-01T00:00:00Z')
  cuentaB = await cuenta(clienteB, 'CUENTA-B', '2026-02-01T00:00:00Z')
  await vincular(cuentaA, DOS_CUENTAS)
  await vincular(cuentaB, DOS_CUENTAS)
  // Otra persona con su propia cuenta, sin segmento.
  const clienteC = await cliente('OTRA-C', null)
  await vincular(await cuenta(clienteC, 'CUENTA-C', '2026-01-15T00:00:00Z'), OTRA_PERSONA)
}, 180_000)

afterEach(async () => {
  for (const promo of promos.splice(0)) await svc(`delete from public.promotions where id = $1`, [promo])
})

afterAll(async () => {
  await db?.close()
})

describe('preview = pedido, audiencia por audiencia', () => {
  it('1 · `all`: invitado y empresa ven y pagan el mismo descuento', async () => {
    await campana('TODOS-5', '5', { kind: 'all' })
    await elegir(DOS_CUENTAS, cuentaA)
    for (const sub of [null, DOS_CUENTAS, CONSUMIDOR]) {
      const visto = await preview(sub)
      expect(visto).toEqual({ discount: '5.00', total: '95.00' })
      expect(await pedido(sub)).toMatchObject(visto)
    }
  })

  it('2 · `segment`: la cuenta A (segmento clínicas) lo ve en el carrito y lo paga', async () => {
    await campana('CLINICAS-10', '10', { kind: 'segment', segment: segmento })
    await elegir(DOS_CUENTAS, cuentaA)
    const visto = await preview(DOS_CUENTAS)
    expect(visto).toEqual({ discount: '10.00', total: '90.00' })
    expect(await pedido(DOS_CUENTAS)).toEqual({ ...visto, account: cuentaA })
  })

  it('3 · `customer`: la cuenta B (su cliente) lo ve y lo paga', async () => {
    await campana('CLIENTE-B-20', '20', { kind: 'customer', customer: clienteB })
    await elegir(DOS_CUENTAS, cuentaB)
    const visto = await preview(DOS_CUENTAS)
    expect(visto).toEqual({ discount: '20.00', total: '80.00' })
    expect(await pedido(DOS_CUENTAS)).toEqual({ ...visto, account: cuentaB })
  })

  it('4 · `business_account`: la cuenta A la ve y la paga', async () => {
    await campana('CUENTA-A-15', '15', { kind: 'business_account', account: cuentaA })
    await elegir(DOS_CUENTAS, cuentaA)
    const visto = await preview(DOS_CUENTAS)
    expect(visto).toEqual({ discount: '15.00', total: '85.00' })
    expect(await pedido(DOS_CUENTAS)).toEqual({ ...visto, account: cuentaA })
  })
})

describe('a quién NO le llega', () => {
  it('5 · el usuario equivocado: ni en el carrito ni en el pedido', async () => {
    await campana('CLIENTE-B-20', '20', { kind: 'customer', customer: clienteB })
    await campana('CUENTA-A-15', '15', { kind: 'business_account', account: cuentaA })
    await campana('CLINICAS-10', '10', { kind: 'segment', segment: segmento })
    const visto = await preview(OTRA_PERSONA)
    expect(visto).toEqual({ discount: '0.00', total: '100.00' })
    expect(await pedido(OTRA_PERSONA)).toMatchObject(visto)
  })

  it('6 · el invitado y el consumidor: ninguna campaña dirigida', async () => {
    await campana('CLINICAS-10', '10', { kind: 'segment', segment: segmento })
    await campana('CUENTA-A-15', '15', { kind: 'business_account', account: cuentaA })
    for (const sub of [null, CONSUMIDOR]) {
      const visto = await preview(sub)
      expect(visto).toEqual({ discount: '0.00', total: '100.00' })
      expect(await pedido(sub)).toMatchObject(visto)
    }
  })

  it('7 · la cuenta elegida (N01) decide qué campaña aplica, en carrito y pedido', async () => {
    await campana('CUENTA-A-15', '15', { kind: 'business_account', account: cuentaA })

    await elegir(DOS_CUENTAS, cuentaA)
    const conA = await preview(DOS_CUENTAS)
    expect(conA).toEqual({ discount: '15.00', total: '85.00' })
    expect(await pedido(DOS_CUENTAS)).toEqual({ ...conA, account: cuentaA })

    await elegir(DOS_CUENTAS, cuentaB)
    const conB = await preview(DOS_CUENTAS)
    expect(conB).toEqual({ discount: '0.00', total: '100.00' })
    expect(await pedido(DOS_CUENTAS)).toEqual({ ...conB, account: cuentaB })
  })
})

describe('la superficie no cambia', () => {
  it('la cotización pública sigue sin dónde recibir una identidad', async () => {
    const [row] = await svc<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'promotion_quote_for_slug'`,
    )
    expect(row?.args).toBe('p_store_slug text, p_items jsonb, p_coupon_codes text[]')
  })
})
