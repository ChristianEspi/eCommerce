// @vitest-environment node
/**
 * Bandeja de aprobaciones del comprador B2B sobre Postgres REAL (PGlite).
 *
 * Migracion 20260914110000. Lo que se prueba es lo que la pantalla da por
 * hecho y no puede comprobar desde el navegador:
 *
 *  · el doble clic y el reintento: la MISMA decision repetida responde bien,
 *    no reescribe la firma, no publica dos veces el hecho ni ensucia la linea
 *    de tiempo; la decision CONTRARIA sigue negandose;
 *  · el reintento no es un oraculo: quien no puede decidir recibe
 *    `SIN_PERMISO` tambien sobre un pedido ya decidido;
 *  · aislamiento entre CUENTAS del mismo tenant y entre TENANTS: el aprobador
 *    de una cuenta no ve ni decide lo de otra;
 *  · comprador y lector no deciden ni llamando a la RPC a mano;
 *  · el detalle devuelve `can_decide` resuelto por el servidor y los ids de
 *    producto que necesita «volver a comprar».
 *  · y documenta, sin cambiarla, la politica actual de auto-aprobacion.
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

const BUYER = '0e000000-0000-4000-8000-0000000000b1'
const APPROVER = '0e000000-0000-4000-8000-0000000000b2'
const ADMIN = '0e000000-0000-4000-8000-0000000000b3'
const VIEWER = '0e000000-0000-4000-8000-0000000000b4'
const APPROVER_BETA = '0e000000-0000-4000-8000-0000000000c2'
const APPROVER_GAMMA = '0e000000-0000-4000-8000-0000000000d2'
const OUTSIDER = '0e000000-0000-4000-8000-0000000000f9'

const EMAIL: Record<string, string> = {
  [BUYER]: 'compras@acme.test',
  [APPROVER]: 'gerencia@acme.test',
  [ADMIN]: 'admin@acme.test',
  [VIEWER]: 'lector@acme.test',
  [APPROVER_BETA]: 'gerencia@beta.test',
  [APPROVER_GAMMA]: 'gerencia@gamma.test',
  [OUTSIDER]: 'ajeno@otra.test',
}

let db: PGlite
let productA = ''
let productB = ''
let cuentaAcme = ''
let cuentaBeta = ''
let cuentaGamma = ''
let compradorSeq = 0

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

/** Un usuario B2B NO es miembro del tenant: sus claims no llevan sociedad. */
const b2b = (sub: string) => ({
  sub,
  email: EMAIL[sub] ?? `${sub}@test.test`,
  org_id: '00000000-0000-4000-8000-000000000000',
  companies: [],
  active_company: '00000000-0000-4000-8000-000000000000',
  apps: ['ecommerce'],
})

async function as<T = Row>(
  claims: ReturnType<typeof b2b> | ReturnType<typeof claimsFor>,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
  await svc(
    `select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`,
    [tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug],
  )
  const [store] = await svc(`update public.stores set status = 'active' where slug = $1 returning id`, [
    tenant.storeSlug,
  ])
  return String(store?.id)
}

async function newProduct(tenant: typeof TENANT_A, storeId: string, sku: string): Promise<string> {
  const [row] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, $4, $5, '200.00', 'PEN', 500, 'published', now())
     returning id`,
    [tenant.organizationId, tenant.companyId, storeId, sku, `Nombre ${sku}`],
  )
  return String(row?.id)
}

async function newAccount(
  tenant: typeof TENANT_A,
  code: string,
  users: Array<[string, 'admin' | 'buyer' | 'approver' | 'viewer']>,
): Promise<string> {
  const [customer] = await svc(
    `insert into public.customers (organization_id, company_id, kind, code, name, legal_name, tax_id)
       values ($1, $2, 'company', $3, $3, $3, '20123456789') returning id`,
    [tenant.organizationId, tenant.companyId, code],
  )
  const [account] = await svc(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, code, name, requires_approval, approval_threshold)
     values ($1, $2, $3, $4, $4, true, '150.00') returning id`,
    [tenant.organizationId, tenant.companyId, String(customer?.id), code],
  )
  for (const [userId, role] of users) {
    await svc(
      `insert into public.business_account_users
         (organization_id, company_id, business_account_id, user_id, email, role, status)
       values ($1, $2, $3, $4, $5, $6, 'active')`,
      [tenant.organizationId, tenant.companyId, String(account?.id), userId, EMAIL[userId], role],
    )
  }
  return String(account?.id)
}

/** Un pedido B2B de 200 contra una cuenta con umbral 150: nace `pending`. */
async function pending(tenant: typeof TENANT_A, productId: string, accountId: string, email?: string) {
  compradorSeq += 1
  const [row] = await svc(
    `select public.create_order_for_slug(
        $1, $2, $3::jsonb, 'Compradora', '+51 999 111 222',
        '{"address":"Av. Primavera 120"}'::jsonb, null, null, 'storefront', $4, null, null) as result`,
    [
      tenant.storeSlug,
      email ?? `compradora${compradorSeq}@correo.test`,
      JSON.stringify([{ product_id: productId, quantity: 1 }]),
      accountId,
    ],
  )
  const orderId = String((row?.result as Row).order_id)
  const [check] = await svc(`select approval_status from public.orders where id = $1`, [orderId])
  expect(check?.approval_status).toBe('pending')
  return orderId
}

const decide = (claims: Parameters<typeof as>[0], orderId: string, approve: boolean, reason: string | null) =>
  as(claims, `select public.order_approval_decide($1, $2, $3) as r`, [orderId, approve, reason]).then(
    (rows) => rows[0]?.r as Row,
  )

const detail = (sub: string, orderId: string) =>
  as(b2b(sub), `select public.my_business_order_detail($1) as d`, [orderId]).then((rows) => rows[0]?.d as Row)

const queue = (sub: string, onlyPending = true) =>
  as(b2b(sub), `select public.my_business_orders($1) as r`, [onlyPending]).then(
    (rows) => (rows[0]?.r ?? []) as Row[],
  )

async function footprint(orderId: string) {
  const [order] = await svc(
    `select approval_status, status, approval_decided_at::text as decided_at,
            approval_decided_by, approval_decided_email, approval_reason
       from public.orders where id = $1`,
    [orderId],
  )
  const [facts] = await svc<{ n: number }>(
    `select count(*)::int as n from public.domain_events
      where aggregate_id = $1 and event_type = 'order.approval_decided'`,
    [orderId],
  )
  const [timeline] = await svc<{ n: number }>(
    `select count(*)::int as n from public.order_events where order_id = $1`,
    [orderId],
  )
  return { order, facts: facts?.n, timeline: timeline?.n }
}

beforeAll(async () => {
  db = await createTestDatabase()
  const storeA = await bootstrap(TENANT_A)
  const storeB = await bootstrap(TENANT_B)
  productA = await newProduct(TENANT_A, storeA, 'sku-acme')
  productB = await newProduct(TENANT_B, storeB, 'sku-gamma')

  cuentaAcme = await newAccount(TENANT_A, 'ACME', [
    [BUYER, 'buyer'],
    [APPROVER, 'approver'],
    [ADMIN, 'admin'],
    [VIEWER, 'viewer'],
  ])
  cuentaBeta = await newAccount(TENANT_A, 'BETA', [[APPROVER_BETA, 'approver']])
  cuentaGamma = await newAccount(TENANT_B, 'GAMMA', [[APPROVER_GAMMA, 'approver']])
}, 240_000)

afterAll(async () => {
  await db?.close()
})

// ===========================================================================
// IDEMPOTENCIA
// ===========================================================================
describe('order_approval_decide — la misma decision dos veces es UNA firma', () => {
  it('aprobar dos veces responde bien, sin reescribir la firma ni duplicar el hecho', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)

    const primera = await decide(b2b(APPROVER), orderId, true, 'Presupuesto disponible')
    expect(primera).toMatchObject({ approval_status: 'approved', already_decided: false })
    const antes = await footprint(orderId)
    expect(antes.facts).toBe(1)

    // El reintento, incluso de OTRO actor autorizado, no cambia al autor.
    const segunda = await decide(b2b(APPROVER), orderId, true, 'Presupuesto disponible')
    expect(segunda).toMatchObject({ approval_status: 'approved', already_decided: true })
    expect(segunda.decided_at).toEqual(primera.decided_at)
    const tercera = await decide(b2b(ADMIN), orderId, true, null)
    expect(tercera).toMatchObject({ approval_status: 'approved', already_decided: true })

    const despues = await footprint(orderId)
    expect(despues).toEqual(antes)
    expect(despues.order?.approval_decided_email).toBe('gerencia@acme.test')
  })

  it('rechazar dos veces tambien, y el pedido sigue cancelado una sola vez', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)

    await decide(b2b(APPROVER), orderId, false, 'Fuera de presupuesto')
    const antes = await footprint(orderId)
    expect(antes.order).toMatchObject({ approval_status: 'rejected', status: 'cancelled' })

    const replay = await decide(b2b(APPROVER), orderId, false, 'Fuera de presupuesto')
    expect(replay).toMatchObject({ approval_status: 'rejected', already_decided: true })
    expect(await footprint(orderId)).toEqual(antes)
  })

  it('la decision CONTRARIA sigue negandose en los dos sentidos', async () => {
    const aprobado = await pending(TENANT_A, productA, cuentaAcme)
    await decide(b2b(APPROVER), aprobado, true, null)
    const antesAprobado = await footprint(aprobado)
    expect(
      await expectFailure(() => decide(b2b(APPROVER), aprobado, false, 'Me arrepiento')),
    ).toMatch(/APROBACION_NO_APLICA/)
    expect(await footprint(aprobado)).toEqual(antesAprobado)

    const rechazado = await pending(TENANT_A, productA, cuentaAcme)
    await decide(b2b(APPROVER), rechazado, false, 'No')
    expect(await expectFailure(() => decide(b2b(APPROVER), rechazado, true, null))).toMatch(
      /APROBACION_NO_APLICA/,
    )
  })

  it('el reintento no es un oraculo: sin permiso, SIN_PERMISO aunque ya este decidido', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)
    await decide(b2b(APPROVER), orderId, true, null)

    for (const sub of [BUYER, VIEWER, OUTSIDER, APPROVER_BETA, APPROVER_GAMMA]) {
      const message = await expectFailure(() => decide(b2b(sub), orderId, true, null))
      expect(`${sub}: ${message}`).toMatch(/SIN_PERMISO/)
    }
  })

  it('rechazar en el reintento sigue exigiendo motivo', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)
    await decide(b2b(APPROVER), orderId, false, 'Duplicado')
    expect(await expectFailure(() => decide(b2b(APPROVER), orderId, false, null))).toMatch(
      /MOTIVO_REQUERIDO/,
    )
  })
})

// ===========================================================================
// AUTORIZACION Y AISLAMIENTO
// ===========================================================================
describe('quien decide y quien ve', () => {
  let pedidoAcme = ''
  let pedidoBeta = ''
  let pedidoGamma = ''

  beforeAll(async () => {
    pedidoAcme = await pending(TENANT_A, productA, cuentaAcme)
    pedidoBeta = await pending(TENANT_A, productA, cuentaBeta)
    pedidoGamma = await pending(TENANT_B, productB, cuentaGamma)
  })

  it('comprador y lector de la cuenta NO deciden, ni llamando a la RPC a mano', async () => {
    for (const sub of [BUYER, VIEWER]) {
      for (const approve of [true, false]) {
        const message = await expectFailure(() => decide(b2b(sub), pedidoAcme, approve, 'motivo'))
        expect(`${sub}/${approve}: ${message}`).toMatch(/SIN_PERMISO/)
      }
    }
    const [row] = await svc(`select approval_status from public.orders where id = $1`, [pedidoAcme])
    expect(row?.approval_status).toBe('pending')
  })

  it('el aprobador de OTRA cuenta del mismo tenant no ve ni decide', async () => {
    const colaBeta = await queue(APPROVER_BETA, false)
    expect(colaBeta.map((o) => o.order_id)).toEqual([pedidoBeta])

    expect(await expectFailure(() => decide(b2b(APPROVER_BETA), pedidoAcme, true, null))).toMatch(
      /SIN_PERMISO/,
    )
    expect(await expectFailure(() => detail(APPROVER_BETA, pedidoAcme))).toMatch(/PEDIDO_NO_ENCONTRADO/)

    // Y a la inversa.
    const colaAcme = await queue(APPROVER, true)
    expect(colaAcme.map((o) => o.order_id)).not.toContain(pedidoBeta)
    expect(await expectFailure(() => decide(b2b(APPROVER), pedidoBeta, true, null))).toMatch(
      /SIN_PERMISO/,
    )
  })

  it('entre tenants tampoco: ni el aprobador de otro tenant ni su personal', async () => {
    expect(await expectFailure(() => decide(b2b(APPROVER_GAMMA), pedidoAcme, true, null))).toMatch(
      /SIN_PERMISO/,
    )
    expect((await queue(APPROVER_GAMMA, false)).map((o) => o.order_id)).toEqual([pedidoGamma])
    expect(await expectFailure(() => detail(APPROVER_GAMMA, pedidoAcme))).toMatch(/PEDIDO_NO_ENCONTRADO/)

    // El admin del tenant B tiene rol en SU sociedad, no en la del pedido.
    expect(await expectFailure(() => decide(claimsFor(TENANT_B), pedidoAcme, true, null))).toMatch(
      /SIN_PERMISO/,
    )
    // Y el aprobador de A no alcanza el pedido de B.
    expect(await expectFailure(() => decide(b2b(APPROVER), pedidoGamma, true, null))).toMatch(
      /SIN_PERMISO/,
    )
  })

  it('la cola lleva orden de compra y, solo para quien decide, el correo del comprador', async () => {
    // La orden de compra es inmutable desde N05 y este pedido nacio sin ella:
    // lo que se comprueba es que la clave VIAJE en la cola.
    const [pedido] = await svc(`select customer_email from public.orders where id = $1`, [pedidoAcme])

    const delAprobador = (await queue(APPROVER, true)).find((o) => o.order_id === pedidoAcme)
    expect(delAprobador).toMatchObject({ can_decide: true, buyer_email: pedido?.customer_email })
    expect(delAprobador).toHaveProperty('purchase_order_number')
    expect(delAprobador).not.toHaveProperty('organization_id')

    const delComprador = (await queue(BUYER, true)).find((o) => o.order_id === pedidoAcme)
    expect(delComprador).toMatchObject({ can_decide: false, buyer_email: null })
    const delLector = (await queue(VIEWER, true)).find((o) => o.order_id === pedidoAcme)
    expect(delLector).toMatchObject({ can_decide: false, buyer_email: null })
  })
})

// ===========================================================================
// DETALLE
// ===========================================================================
describe('my_business_order_detail — contexto de firma y productos', () => {
  it('can_decide lo resuelve el servidor por rol en la cuenta del pedido', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)

    expect(await detail(APPROVER, orderId)).toMatchObject({ approval_status: 'pending', can_decide: true })
    expect(await detail(ADMIN, orderId)).toMatchObject({ can_decide: true })
    expect(await detail(BUYER, orderId)).toMatchObject({ approval_status: 'pending', can_decide: false })
    expect(await detail(VIEWER, orderId)).toMatchObject({ can_decide: false })
  })

  it('trae product_id y variant_id por linea, y ningun uuid de tenant', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)
    const d = await detail(BUYER, orderId)
    const items = d.items as Row[]

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ product_id: productA, variant_id: null, quantity: 1 })
    expect(d).not.toHaveProperty('organization_id')
    expect(d).not.toHaveProperty('company_id')
    // Lo que ya habia sigue ahi.
    expect(d).toHaveProperty('purchase_order_number')
    expect(d).toHaveProperty('grand_total')
  })

  it('tras decidir, el detalle dice quien firmo y por que', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme)
    await decide(b2b(APPROVER), orderId, false, 'Sin presupuesto este mes')

    const d = await detail(BUYER, orderId)
    expect(d).toMatchObject({
      approval_status: 'rejected',
      approval_decided_email: 'gerencia@acme.test',
      approval_reason: 'Sin presupuesto este mes',
      status: 'cancelled',
    })
    expect(d.approval_decided_at).toBeTruthy()
  })
})

// ===========================================================================
// HALLAZGO DOCUMENTADO, NO CAMBIADO
// ===========================================================================
describe('auto-aprobacion (politica vigente, documentada)', () => {
  /**
   * Hoy NO hay segregacion de funciones: el `admin` de la cuenta que compro un
   * pedido lo puede aprobar el mismo. Es una decision de negocio y no se toca
   * aqui; este test existe para que, el dia que cambie, se cambie a proposito
   * y se note en la suite.
   */
  it('el admin de la cuenta que hizo el pedido puede aprobarlo el mismo', async () => {
    const orderId = await pending(TENANT_A, productA, cuentaAcme, EMAIL[ADMIN])
    await svc(
      `insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id)
       select o.id, o.organization_id, o.company_id, o.store_id, $2 from public.orders o where o.id = $1`,
      [orderId, ADMIN],
    )

    const r = await decide(b2b(ADMIN), orderId, true, null)
    expect(r).toMatchObject({ approval_status: 'approved', already_decided: false })
    const { order } = await footprint(orderId)
    expect(order?.approval_decided_by).toBe(ADMIN)
  })
})
