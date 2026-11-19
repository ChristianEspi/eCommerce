// @vitest-environment node
/**
 * Confirmar el cobro de un medio SIN pasarela (QAS, 2026-11-17).
 *
 * Yape o transferencia: una persona confirma que el dinero llegó. Antes no
 * había con qué, y «Marcar pagado» en Pedidos dejaba el cobro «Abierto» para
 * siempre. Aquí se comprueba que las dos puertas escriben el COBRO de verdad,
 * que una pasarela no se da por cobrada a mano, y que un cobro sin pedido caduca.
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
  vaciarPagosYEntregas,
} from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA: string
let productA: string

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000e2'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d2'
let compradorSeq = 0
let keySeq = 0

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

const ordersA = () =>
  claimsFor(TENANT_A, {
    sub: ORDERS_USER,
    email: 'pedidos@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'orders' }],
  })
const viewerA = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })
const adminB = () => claimsFor(TENANT_B)

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
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

/** Un pedido con su cobro abierto por `metodo` (sin atar si `atar` es false). */
async function pedidoConCobro(metodo: string, atar = true): Promise<{ orderId: string; intentId: string }> {
  compradorSeq += 1
  keySeq += 1
  const [pedido] = await svc<{ r: Row }>(
    `select public.create_order_for_slug($1, $2, $3::jsonb) as r`,
    [TENANT_A.storeSlug, `offline${compradorSeq}@correo.test`, JSON.stringify([
      { product_id: productA, quantity: 1 },
    ])],
  )
  const [intento] = await svc<{ r: Row }>(
    `select public.payment_intent_open($1, $2, 100.00, 'PEN', $3) as r`,
    [TENANT_A.storeSlug, metodo, `offline-key-${String(keySeq).padStart(6, '0')}`],
  )
  const orderId = String(pedido?.r.order_id)
  const intentId = String(intento?.r.intent_id)
  if (atar) await svc(`select public.payment_intent_attach_order($1, $2)`, [intentId, orderId])
  return { orderId, intentId }
}

async function estado(intentId: string) {
  const [row] = await svc<{ status: string; captured: string; ref: string | null; pagos: number; pedido: string | null }>(
    `select i.status::text, i.amount_captured::text as captured, i.provider_reference as ref,
            (select count(*)::int from public.payments p where p.payment_intent_id = i.id) as pagos,
            (select o.payment_status::text from public.orders o where o.id = i.order_id) as pedido
       from public.payment_intents i where i.id = $1`,
    [intentId],
  )
  return row
}

beforeAll(async () => {
  db = await createTestDatabase()
  storeA = await bootstrap(TENANT_A)
  const storeB = await bootstrap(TENANT_B)
  await vaciarPagosYEntregas(db, [storeA, storeB])

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'pedidos@tenant-a.com', 'orders', 'active'),
            ($1, $2, $4, 'lector@tenant-a.com',  'viewer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, ORDERS_USER, VIEWER_USER],
  )

  const [producto] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at)
     values ($1, $2, $3, 'sku-offline', 'sku-offline', 'Producto', 100.00, 'PEN', 500,
             'published', now())
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  productA = String(producto?.id)

  await svc(
    `insert into public.payment_methods
       (organization_id, company_id, store_id, code, kind, display_name, provider_code,
        capture_mode, is_active)
     values ($1, $2, $3, 'yape', 'bank_transfer', 'Yape', null, 'manual', true),
            ($1, $2, $3, 'tarjeta', 'card', 'Tarjeta', 'sandbox', 'automatic', true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('«Confirmar cobro» en Pagos', () => {
  it('el rol de pedidos lo confirma: queda el cobro, el número de operación y el pedido pagado', async () => {
    const { intentId } = await pedidoConCobro('yape')
    const [r] = await asUser<{ r: Row }>(
      ordersA(),
      `select public.payment_confirm_offline($1, 'OP-778812', 'Visto en el banco') as r`,
      [intentId],
    )
    expect(r?.r.to).toBe('captured')
    expect(await estado(intentId)).toMatchObject({
      status: 'captured',
      captured: '100.00',
      ref: 'OP-778812',
      pagos: 1,
      pedido: 'paid',
    })

    const [evento] = await svc<{ source: string; payload: Row }>(
      `select source::text, payload from public.payment_events
        where payment_intent_id = $1 and event_type = 'payment.captured'`,
      [intentId],
    )
    expect(evento?.source).toBe('operator')
    expect(evento?.payload.confirmed_by).toBe('pedidos@tenant-a.com')
  })

  it('confirmar dos veces es una sola: no duplica el cobro', async () => {
    const { intentId } = await pedidoConCobro('yape')
    await asUser(ordersA(), `select public.payment_confirm_offline($1)`, [intentId])
    const [r] = await asUser<{ r: Row }>(ordersA(), `select public.payment_confirm_offline($1) as r`, [intentId])
    expect(r?.r.replay).toBe(true)
    expect((await estado(intentId))?.pagos).toBe(1)
  })

  it('un cobro de pasarela no se da por cobrado a mano', async () => {
    const { intentId } = await pedidoConCobro('tarjeta')
    expect(await expectFailure(() =>
      asUser(ordersA(), `select public.payment_confirm_offline($1)`, [intentId])),
    ).toMatch(/COBRO_CON_PASARELA/)
    expect((await estado(intentId))?.status).toBe('open')
  })

  it('un lector no puede, ni un miembro de otro tenant', async () => {
    const { intentId } = await pedidoConCobro('yape')
    expect(await expectFailure(() =>
      asUser(viewerA(), `select public.payment_confirm_offline($1)`, [intentId])),
    ).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() =>
      asUser(adminB(), `select public.payment_confirm_offline($1)`, [intentId])),
    ).toMatch(/SIN_PERMISO|INTENTO_NO_ENCONTRADO/)
    expect((await estado(intentId))?.status).toBe('open')
  })

  it('un cobro anulado ya no se confirma', async () => {
    const { orderId, intentId } = await pedidoConCobro('yape')
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [orderId])
    expect(await expectFailure(() =>
      asUser(ordersA(), `select public.payment_confirm_offline($1)`, [intentId])),
    ).toMatch(/COBRO_NO_PENDIENTE/)
  })

  it('un número de tarjeta no entra como número de operación', async () => {
    const { intentId } = await pedidoConCobro('yape')
    expect(await expectFailure(() =>
      asUser(ordersA(), `select public.payment_confirm_offline($1, '4111111111111111')`, [intentId])),
    ).toMatch(/REFERENCIA_NO_VALIDA/)
  })
})

describe('«Marcar pagado» en Pedidos', () => {
  it('captura el cobro offline pendiente del pedido', async () => {
    const { orderId, intentId } = await pedidoConCobro('yape')
    await asUser(
      ordersA(),
      `select public.order_transition($1, 'payment_status', 'paid', 'Transferencia confirmada')`,
      [orderId],
    )
    expect(await estado(intentId)).toMatchObject({
      status: 'captured',
      captured: '100.00',
      pagos: 1,
      pedido: 'paid',
    })
  })

  it('no toca un cobro de pasarela: ese lo confirma la pasarela', async () => {
    const { orderId, intentId } = await pedidoConCobro('tarjeta')
    await asUser(ordersA(), `select public.order_transition($1, 'payment_status', 'paid')`, [orderId])
    expect(await estado(intentId)).toMatchObject({ status: 'open', pagos: 0, pedido: 'paid' })
  })
})

describe('cobros sin pedido', () => {
  it('caducan pasadas 24 h; los recientes y los que tienen pedido se quedan', async () => {
    const viejo = await pedidoConCobro('yape', false)
    const reciente = await pedidoConCobro('yape', false)
    const conPedido = await pedidoConCobro('yape')
    await svc(
      `update public.payment_intents set created_at = now() - interval '2 days' where id = any($1::uuid[])`,
      [[viejo.intentId, conPedido.intentId]],
    )

    // Lo corre pg_cron como dueño de la base: ni `service_role` tiene EXECUTE.
    const { rows } = await db.query<{ n: number }>(`select ebim.expire_orphan_payment_intents() as n`)
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1)

    expect((await estado(viejo.intentId))?.status).toBe('expired')
    expect((await estado(reciente.intentId))?.status).toBe('open')
    expect((await estado(conPedido.intentId))?.status).toBe('open')
  })
})
