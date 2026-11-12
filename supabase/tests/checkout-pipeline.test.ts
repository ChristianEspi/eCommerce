// @vitest-environment node
/**
 * P07-SaaS · El pipeline de checkout contra Postgres REAL.
 *
 * El orquestador de TypeScript se prueba aparte y con puertos falsos
 * (`checkout-orchestrator.test.ts`). Lo que se compra AQUI es lo que solo la
 * base puede garantizar:
 *
 *  · **repetir la peticion no crea dos pedidos** — y la garantia es un indice
 *    unico, no una comprobacion previa que pueda perder una carrera;
 *  · **la misma clave con otra peticion es un error explicito**, nunca una
 *    segunda compra silenciosa;
 *  · **pedido, intento, carrito y hechos van en la MISMA transaccion**: si algo
 *    falla, no queda ninguno de los cuatro;
 *  · **el outbox es del dominio y no de un proveedor**: publica aunque el
 *    tenant no tenga ni una integracion contratada;
 *  · **el AISLAMIENTO se sostiene** en las dos tablas nuevas, y `anon` no puede
 *    ni reclamar un intento;
 *  · **el vocabulario de etapas no se desincroniza** del que usa el borde.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'
import { CHECKOUT_STAGES } from '../functions/_shared/checkout/stages.ts'

type Row = Record<string, unknown>

let db: PGlite

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'

let storeA: string
let storeB: string
let silla: string
let escaso: string
let productoB: string

let contador = 0
/** Una clave de idempotencia distinta por test, con el formato que exige la base. */
function newKey(prefix = 'k'): string {
  contador += 1
  return `${prefix}${'0'.repeat(30)}${contador}`.slice(0, 40)
}
const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}

async function id(query: string, params: unknown[] = []): Promise<string> {
  const rows = await svc(query, params)
  return String(rows[0]?.id)
}

async function begin(
  slug: string,
  key: string,
  hash = HASH,
  cartToken: string | null = null,
): Promise<Row> {
  const rows = await svc(`select public.checkout_begin($1, $2, $3, $4) as result`, [
    slug,
    key,
    hash,
    cartToken,
  ])
  return rows[0]?.result as Row
}

async function place(
  intentId: string,
  items: Array<Record<string, unknown>>,
  options: { email?: string; reservationToken?: string | null; payment?: Row | null } = {},
): Promise<Row> {
  const rows = await svc(
    `select public.checkout_place_order(
        $1, $2, $3::jsonb, 'Ana Compradora', '+51 999 111 222',
        '{"address": "Av. Primavera 120"}'::jsonb, null, $4, $5::jsonb) as result`,
    [
      intentId,
      options.email ?? 'ana@compradora.com',
      JSON.stringify(items),
      options.reservationToken ?? null,
      options.payment ? JSON.stringify(options.payment) : null,
    ],
  )
  return rows[0]?.result as Row
}

async function openCart(slug: string): Promise<Row> {
  const rows = await asRole(db, 'anon', null, () =>
    sql(`select public.cart_open($1, null) as result`, [slug]),
  )
  return rows[0]?.result as Row
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const [tenant, storeSlug] of [
    [TENANT_A, STORE_A_SLUG],
    [TENANT_B, STORE_B_SLUG],
  ] as const) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.slug,
      tenant.adminEmail, tenant.ownerId, storeSlug,
    ])
  }
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = '0.1800'`)
  // El limite de tasa del checkout tiene su propio test; en los demas estorba,
  // asi que se apaga con el escape explicito que la propia funcion documenta
  // (`0` = sin limite) en vez de tocando la funcion.
  await svc(
    `update public.store_settings
        set config = jsonb_build_object('checkout_rate_limit',
              jsonb_build_object('per_email_hour', 0, 'per_store_hour', 0))`,
  )

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
  storeB = String(stores.find((s) => s.slug === STORE_B_SLUG)?.id)

  const insertProduct = `
    insert into public.products
      (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status,
       published_at)
    values ($1, $2, $3, $4, $5, $6, $7, 'PEN', $8, 'published', now())
    returning id`

  silla = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-SILLA', 'silla', 'Silla',
    '100.00', 500,
  ])
  escaso = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-ESCASO', 'escaso', 'Escaso',
    '20.00', 1,
  ])
  productoB = await id(insertProduct, [
    TENANT_B.organizationId, TENANT_B.companyId, storeB, 'B-LAMPARA', 'lampara', 'Lámpara',
    '55.00', 10,
  ])

  // El tenant A trabaja con almacen (P06): es lo que hace que la reserva del
  // pipeline sea la de verdad y no una simulacion. El B se queda sin el, asi
  // que el mismo checkout recorre tambien el camino de `products.stock`.
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [TENANT_A.organizationId, TENANT_A.companyId, ['ecommerce.inventory.multiwarehouse']],
  )
  await id(
    `insert into public.warehouses (organization_id, company_id, code, name)
     values ($1, $2, 'LIMA', 'Lima') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
    sql(`select public.seed_inventory_from_catalog(
           (select id from public.warehouses where code = 'LIMA'), $1)`, [storeA]),
  )
})

beforeEach(async () => {
  await svc(`delete from public.checkout_attempts`)
})

// ---------------------------------------------------------------------------
describe('el vocabulario de etapas', () => {
  /**
   * La lista de TypeScript esta DUPLICADA a proposito —el borde no puede leer
   * un enum de Postgres— y este test es lo unico que impide que las dos copias
   * se separen. Mismo patron que `ORDER_TRANSITIONS` desde P02.
   */
  it('el enum de la base dice exactamente lo mismo, y en el mismo orden', async () => {
    const rows = await svc(
      `select e.enumlabel
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'checkout_stage'
        order by e.enumsortorder`,
    )
    expect(rows.map((row) => String(row.enumlabel))).toEqual([...CHECKOUT_STAGES])
  })
})

// ---------------------------------------------------------------------------
describe('reclamar el intento', () => {
  it('la primera vez es tuyo', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    expect(claim.replay).toBe(false)
    expect(claim.status).toBe('running')
    expect(claim.attempt).toBe(1)
  })

  it('un intento vivo no se atiende dos veces', async () => {
    const key = newKey()
    await begin(STORE_A_SLUG, key)
    const message = await expectFailure(() => begin(STORE_A_SLUG, key))
    expect(message).toMatch(/CHECKOUT_EN_CURSO/)
  })

  /**
   * Sin esto, un cliente con un error de programacion podria reusar la clave
   * para OTRA compra y recibir el pedido anterior como si fuera el suyo. Y
   * quien adivinara una clave ajena obtendria su resultado —que lleva dentro el
   * token de acceso al pedido—.
   */
  it('la misma clave con otra peticion es un error, no una compra', async () => {
    const key = newKey()
    await begin(STORE_A_SLUG, key)
    const message = await expectFailure(() => begin(STORE_A_SLUG, key, OTHER_HASH))
    expect(message).toMatch(/IDEMPOTENCIA_EN_CONFLICTO/)
  })

  it('una clave corta no se admite: seria adivinable', async () => {
    const message = await expectFailure(() => begin(STORE_A_SLUG, 'corta'))
    expect(message).toMatch(/IDEMPOTENCIA_INVALIDA/)
  })

  it('sin resumen de la peticion tampoco se empieza', async () => {
    const message = await expectFailure(() => begin(STORE_A_SLUG, newKey(), 'no-es-un-hash'))
    expect(message).toMatch(/IDEMPOTENCIA_INVALIDA/)
  })

  it('la misma clave en OTRA tienda es otro intento: la clave es del comprador', async () => {
    const key = newKey()
    const a = await begin(STORE_A_SLUG, key)
    const b = await begin(STORE_B_SLUG, key)
    expect(b.intent_id).not.toBe(a.intent_id)
  })

  it('un intento fallido se retoma con la misma clave y suma un intento', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)
    await svc(`select public.checkout_fail($1, 'reserve_inventory', 'STOCK_INSUFICIENTE', 'no hay')`, [
      claim.intent_id,
    ])

    const retry = await begin(STORE_A_SLUG, key)
    expect(retry.intent_id).toBe(claim.intent_id)
    expect(retry.replay).toBe(false)
    expect(retry.attempt).toBe(2)

    const [row] = await svc(`select status, error_code from public.checkout_intents where id = $1`, [
      claim.intent_id,
    ])
    expect(row?.status).toBe('running')
    expect(row?.error_code).toBeNull()
  })

  /**
   * Un proceso que muere a mitad no puede dejar al comprador sin poder comprar
   * nunca mas con esa clave. Se retoma pasados dos minutos.
   */
  it('un intento parado hace rato se retoma', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)
    // `sql` y no `svc`: el trigger `checkout_intents_updated_at` pisa la fecha
    // que se le mande, y solo el dueño de la tabla puede desactivarlo. Es la
    // prueba, de paso, de que ese `updated_at` no lo puede falsear nadie.
    await sql(`alter table public.checkout_intents disable trigger checkout_intents_updated_at`)
    await svc(`update public.checkout_intents set updated_at = now() - interval '5 minutes' where id = $1`, [
      claim.intent_id,
    ])
    await sql(`alter table public.checkout_intents enable trigger checkout_intents_updated_at`)
    const retry = await begin(STORE_A_SLUG, key)
    expect(retry.intent_id).toBe(claim.intent_id)
    expect(retry.attempt).toBe(2)
  })

  /**
   * Y al retomarlo suelta lo que el intento anterior habia apartado: sin esto,
   * el reintento competiria contra su propia reserva y diria «no hay stock»
   * sobre unidades que ya son suyas.
   */
  it('al retomarlo, la reserva del intento anterior se suelta', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)

    const [held] = await svc(
      `select public.reserve_inventory_for_slug($1, $2, $3::jsonb, 900) as result`,
      [STORE_A_SLUG, key, JSON.stringify([{ product_id: silla, quantity: 1 }])],
    )
    const token = String((held?.result as Row)?.token)
    await svc(`select public.checkout_mark_stage($1, 'reserve_inventory', $2)`, [
      claim.intent_id,
      token,
    ])
    await svc(`select public.checkout_fail($1, 'authorize_payment', 'PAGO_RECHAZADO', 'x')`, [
      claim.intent_id,
    ])

    const [antes] = await svc(`select status from public.inventory_reservations where token = $1`, [
      token,
    ])
    expect(antes?.status).toBe('held')

    await begin(STORE_A_SLUG, key)

    const [despues] = await svc(
      `select status from public.inventory_reservations where token = $1`,
      [token],
    )
    expect(despues?.status).toBe('released')
  })
})

// ---------------------------------------------------------------------------
describe('la transaccion que cierra la compra', () => {
  it('crea el pedido, cierra el intento y publica los dos hechos', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)
    const order = await place(String(claim.intent_id), [{ product_id: silla, quantity: 2 }])

    expect(order.order_number).toMatch(/^EC-\d{8}-\d{5}$/)
    expect(order.subtotal).toBe('200.00')
    expect(order.tax_total).toBe('36.00')
    expect(order.grand_total).toBe('236.00')
    expect(order.replay).toBe(false)

    const [intent] = await svc(
      `select status, order_id, reservation_token from public.checkout_intents where id = $1`,
      [claim.intent_id],
    )
    expect(intent?.status).toBe('succeeded')
    expect(intent?.order_id).toBe(order.order_id)
    // El secreto de la reserva se borra al cerrar: ya no abre nada.
    expect(intent?.reservation_token).toBeNull()

    const events = await svc(
      `select event_type, aggregate_id, status from public.domain_events
        where aggregate_id = $1 order by event_type`,
      [order.order_id],
    )
    expect(events.map((row) => row.event_type)).toEqual([
      'notification.order_confirmation',
      'order.created',
    ])
    expect(events.every((row) => row.status === 'pending')).toBe(true)
  })

  /**
   * Compra real en QAS (2026-11-12): el cobro salió por un total y el pedido
   * por otro. Con el total cobrado delante, la base no crea un pedido que
   * sume distinto: aborta TODO (ni pedido, ni intento cerrado) y el pipeline
   * anula el cobro.
   */
  it('si el pedido no suma lo cobrado, no se crea', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    const items = JSON.stringify([{ product_id: silla, quantity: 2 }])
    const call = (expected: string) =>
      svc(
        `select public.checkout_place_order(
            $1, 'ana@compradora.com', $2::jsonb, 'Ana Compradora', null,
            '{"address": "Av. Primavera 120"}'::jsonb,
            p_expected_total => $3::numeric) as result`,
        [claim.intent_id, items, expected],
      )

    const message = await expectFailure(() => call('250.00'))
    expect(message).toMatch(/TOTAL_DESCUADRADO/)

    const [intent] = await svc(`select status, order_id from public.checkout_intents where id = $1`, [
      claim.intent_id,
    ])
    expect(intent).toEqual({ status: 'running', order_id: null })

    // Con lo que de verdad suma (200 + 18 %), entra.
    const [ok] = await call('236.00')
    expect((ok?.result as Row).grand_total).toBe('236.00')
  })

  /**
   * LA propiedad de la fase. Se llama dos veces a la funcion que crea el pedido
   * con el mismo intento: la segunda devuelve el primero.
   */
  it('llamarla dos veces NO crea dos pedidos', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)
    const items = [{ product_id: silla, quantity: 1 }]

    const first = await place(String(claim.intent_id), items)
    const second = await place(String(claim.intent_id), items)

    expect(second.order_id).toBe(first.order_id)
    expect(second.order_number).toBe(first.order_number)
    expect(second.replay).toBe(true)

    // Se cuentan los pedidos de ESTE intento, no los de la tienda: los tests
    // anteriores dejaron los suyos y contarlos todos mediria otra cosa.
    const [count] = await svc(
      `select count(*)::int as n from public.checkout_intents
        where id = $1 and order_id is not null`,
      [claim.intent_id],
    )
    expect(count?.n).toBe(1)
    const [orders] = await svc(`select count(*)::int as n from public.orders where id = $1`, [
      first.order_id,
    ])
    expect(orders?.n).toBe(1)
  })

  it('y tampoco publica los hechos dos veces', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)
    const items = [{ product_id: silla, quantity: 1 }]
    const order = await place(String(claim.intent_id), items)
    await place(String(claim.intent_id), items)

    const [count] = await svc(
      `select count(*)::int as n from public.domain_events where aggregate_id = $1`,
      [order.order_id],
    )
    expect(count?.n).toBe(2)
  })

  it('reclamar el intento despues del exito devuelve la respuesta guardada', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)
    const order = await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const replay = await begin(STORE_A_SLUG, key)
    expect(replay.replay).toBe(true)
    expect(replay.status).toBe('succeeded')
    expect((replay.result as Row)?.order_number).toBe(order.order_number)
  })

  it('el carrito se marca convertido, y solo entonces', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await asRole(db, 'anon', null, () =>
      sql(`select public.cart_replace_lines($1, $2, $3::jsonb)`, [
        STORE_A_SLUG,
        cart.token,
        JSON.stringify([{ product_id: silla, quantity: 1 }]),
      ]),
    )

    const claim = await begin(STORE_A_SLUG, newKey(), HASH, String(cart.token))
    const [before] = await svc(`select status from public.carts where id = $1`, [cart.cart_id])
    expect(before?.status).toBe('active')

    const order = await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const [after] = await svc(`select status, order_id from public.carts where id = $1`, [
      cart.cart_id,
    ])
    expect(after?.status).toBe('converted')
    expect(after?.order_id).toBe(order.order_id)
  })

  /**
   * Los cuatro efectos van juntos o no va ninguno. Si el pedido revienta por
   * falta de existencia, no puede quedar un evento diciendo que se creo.
   */
  it('si el pedido falla, no queda ni intento cerrado ni hecho publicado', async () => {
    const key = newKey()
    const claim = await begin(STORE_A_SLUG, key)

    const message = await expectFailure(() =>
      place(String(claim.intent_id), [{ product_id: escaso, quantity: 99 }]),
    )
    expect(message).toMatch(/STOCK_INSUFICIENTE/)

    const [intent] = await svc(`select status from public.checkout_intents where id = $1`, [
      claim.intent_id,
    ])
    expect(intent?.status).toBe('running')

    const [events] = await svc(
      `select count(*)::int as n from public.domain_events where dedupe_key like $1`,
      [`%${key}`],
    )
    expect(events?.n).toBe(0)
  })

  it('un producto de otra tienda no se cuela aunque se conozca su uuid', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    const message = await expectFailure(() =>
      place(String(claim.intent_id), [{ product_id: productoB, quantity: 1 }]),
    )
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })

  it('el rastro del cobro se guarda sin tocar el medio de pago', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    const order = await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }], {
      payment: {
        status: 'authorized',
        provider_code: 'proveedor-de-prueba',
        provider_reference: 'ref-123',
        // Lo que NO puede acabar guardado, aunque alguien lo mande.
        card_number: '4111111111111111',
      },
    })

    const [event] = await svc(
      `select payload from public.domain_events
        where aggregate_id = $1 and event_type = 'order.created'`,
      [order.order_id],
    )
    const payment = (event?.payload as Row)?.payment as Row
    expect(payment?.status).toBe('authorized')
    expect(payment?.provider_reference).toBe('ref-123')
    // La funcion recompone el objeto clave a clave: lo que no esta en la lista
    // no entra, y por eso un numero de tarjeta no puede colarse al outbox.
    expect(Object.keys(payment ?? {}).sort()).toEqual([
      'provider_code',
      'provider_reference',
      'status',
    ])
  })

  it('un intento que ya se cerro con fallo no crea pedido', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await svc(`select public.checkout_fail($1, 'create_order', 'ERROR_INTERNO', 'x')`, [
      claim.intent_id,
    ])
    const message = await expectFailure(() =>
      place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }]),
    )
    expect(message).toMatch(/INTENTO_NO_VIGENTE/)
  })

  it('el limite de tasa del checkout sigue aplicando a traves del pipeline', async () => {
    await svc(
      `update public.store_settings
          set config = jsonb_build_object('checkout_rate_limit',
                jsonb_build_object('per_email_hour', 1, 'per_store_hour', 0))
        where store_id = $1`,
      [storeA],
    )

    const primero = await begin(STORE_A_SLUG, newKey())
    await place(String(primero.intent_id), [{ product_id: silla, quantity: 1 }], {
      email: 'insistente@compradora.com',
    })

    const segundo = await begin(STORE_A_SLUG, newKey())
    const message = await expectFailure(() =>
      place(String(segundo.intent_id), [{ product_id: silla, quantity: 1 }], {
        email: 'insistente@compradora.com',
      }),
    )
    expect(message).toMatch(/LIMITE_DE_PEDIDOS/)

    await svc(
      `update public.store_settings
          set config = jsonb_build_object('checkout_rate_limit',
                jsonb_build_object('per_email_hour', 0, 'per_store_hour', 0))
        where store_id = $1`,
      [storeA],
    )
  })
})

// ---------------------------------------------------------------------------
describe('la etapa se guarda, y por eso el fallo es auditable', () => {
  it('avanzar de etapa se anota en el intento', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await svc(`select public.checkout_mark_stage($1, 'resolve_prices', null)`, [claim.intent_id])
    const [row] = await svc(`select stage from public.checkout_intents where id = $1`, [
      claim.intent_id,
    ])
    expect(row?.stage).toBe('resolve_prices')
  })

  it('el fallo guarda etapa, codigo y detalle', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await svc(
      `select public.checkout_fail($1, 'reserve_inventory', 'STOCK_INSUFICIENTE', 'faltaban 3')`,
      [claim.intent_id],
    )
    const [row] = await svc(
      `select status, error_stage, error_code, error_detail
         from public.checkout_intents where id = $1`,
      [claim.intent_id],
    )
    expect(row?.status).toBe('failed')
    expect(row?.error_stage).toBe('reserve_inventory')
    expect(row?.error_code).toBe('STOCK_INSUFICIENTE')
    expect(row?.error_detail).toBe('faltaban 3')
  })

  it('un intento ya cerrado no se puede marcar', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await svc(`select public.checkout_fail($1, 'create_order', 'ERROR_INTERNO', null)`, [
      claim.intent_id,
    ])
    const message = await expectFailure(() =>
      svc(`select public.checkout_mark_stage($1, 'notify', null)`, [claim.intent_id]),
    )
    expect(message).toMatch(/INTENTO_NO_VIGENTE/)
  })
})

// ---------------------------------------------------------------------------
describe('el outbox de dominio', () => {
  // Los hechos de los tests anteriores siguen pendientes y competirian por el
  // reclamo. Se vacia la cola antes de cada uno para medir lo que dice el test
  // y no el orden en que corrieron.
  beforeEach(async () => {
    await svc(`delete from public.domain_events`)
  })

  it('publica aunque el tenant no tenga NINGUNA integracion contratada', async () => {
    const [integraciones] = await svc(
      `select count(*)::int as n from public.tenant_integrations where organization_id = $1`,
      [TENANT_A.organizationId],
    )
    expect(integraciones?.n).toBe(0)

    const claim = await begin(STORE_A_SLUG, newKey())
    const order = await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const [count] = await svc(
      `select count(*)::int as n from public.domain_events where aggregate_id = $1`,
      [order.order_id],
    )
    // Si esto se hubiera encolado en `integration_outbox`, la primera tienda
    // sin conectores habria visto fallar su checkout con INTEGRACION_NO_ACTIVA.
    expect(count?.n).toBe(2)
  })

  it('reclamar y completar: un hecho no se entrega dos veces', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    const order = await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const claimed = await svc(
      `select id, event_type, attempts from public.claim_domain_events('worker-1', 10, null)`,
    )
    expect(claimed.length).toBeGreaterThanOrEqual(2)

    const again = await svc(`select id from public.claim_domain_events('worker-2', 10, null)`)
    expect(again).toEqual([])

    for (const row of claimed) {
      await svc(`select public.complete_domain_event($1)`, [row.id])
    }

    const [pending] = await svc(
      `select count(*)::int as n from public.domain_events
        where aggregate_id = $1 and status <> 'processed'`,
      [order.order_id],
    )
    expect(pending?.n).toBe(0)
  })

  it('el fallo reprograma con backoff y no se pierde', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const [event] = await svc(`select id from public.claim_domain_events('worker-1', 1, null)`)
    await svc(`select public.fail_domain_event($1, 'el proveedor no contesto')`, [event?.id])

    const [row] = await svc(
      `select status, attempts, last_error, next_retry_at > now() as pospuesto
         from public.domain_events where id = $1`,
      [event?.id],
    )
    expect(row?.status).toBe('pending')
    expect(row?.attempts).toBe(1)
    expect(row?.last_error).toBe('el proveedor no contesto')
    expect(row?.pospuesto).toBe(true)
  })

  it('agotados los intentos, va a la cola muerta y deja de estorbar', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const [event] = await svc(`select id from public.claim_domain_events('worker-1', 1, null)`)
    await svc(`update public.domain_events set attempts = max_attempts where id = $1`, [event?.id])
    await svc(`select public.fail_domain_event($1, 'no hay manera')`, [event?.id])

    const [row] = await svc(`select status from public.domain_events where id = $1`, [event?.id])
    expect(row?.status).toBe('dead')
  })

  it('un worker que muere no pierde el hecho: se rescata', async () => {
    const claim = await begin(STORE_A_SLUG, newKey())
    await place(String(claim.intent_id), [{ product_id: silla, quantity: 1 }])

    const [event] = await svc(`select id from public.claim_domain_events('worker-1', 1, null)`)
    await svc(`update public.domain_events set claimed_at = now() - interval '1 hour' where id = $1`, [
      event?.id,
    ])

    const [rescued] = await svc(`select public.reclaim_stale_domain_events() as n`)
    expect(Number(rescued?.n)).toBeGreaterThanOrEqual(1)

    const [row] = await svc(`select status, claimed_by from public.domain_events where id = $1`, [
      event?.id,
    ])
    expect(row?.status).toBe('pending')
    expect(row?.claimed_by).toBeNull()
  })

  it('el mismo hecho con la misma clave no se duplica', async () => {
    const id1 = await svc(
      `select ebim.publish_event($1, $2, $3, 'order.created', 'order', null, '{}'::jsonb, $4) as id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, 'duplicado-de-prueba'],
    )
    const id2 = await svc(
      `select ebim.publish_event($1, $2, $3, 'order.created', 'order', null, '{}'::jsonb, $4) as id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, 'duplicado-de-prueba'],
    )
    expect(id2[0]?.id).toBe(id1[0]?.id)
  })
})

// ---------------------------------------------------------------------------
describe('contexto y autorizacion', () => {
  it('checkout_context responde moneda, canal e impuesto, y nada interno', async () => {
    const [row] = await asRole(db, 'anon', null, () =>
      sql(`select public.checkout_context($1) as result`, [STORE_A_SLUG]),
    )
    const context = row?.result as Row
    expect(context.currency).toBe('PEN')
    expect(context.channel).toBe('b2c')
    expect(context.requires_auth).toBe(false)
    // P18 · La regla de la TIENDA, distinta de la del canal. Apagada por
    // defecto: encenderla cambia quien puede comprar, y eso no se le hace a una
    // tienda ya en produccion por una migracion.
    expect(context.requires_account).toBe(false)
    expect(Object.keys(context).sort()).toEqual([
      'channel',
      'channel_kind',
      'currency',
      'requires_account',
      'requires_auth',
      'store_name',
      'store_slug',
      'tax_inclusive',
    ])
  })

  it('una tienda suspendida no da contexto', async () => {
    await svc(`update public.stores set status = 'suspended' where id = $1`, [storeB])
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () =>
        sql(`select public.checkout_context($1) as result`, [STORE_B_SLUG]),
      ),
    )
    expect(message).toMatch(/TIENDA_NO_DISPONIBLE/)
    await svc(`update public.stores set status = 'active' where id = $1`, [storeB])
  })

  /**
   * Las funciones del pipeline son de SERVIDOR. Si `anon` pudiera reclamar un
   * intento, cualquiera podria consumir claves ajenas y —peor— provocar que un
   * intento vivo se retomara.
   */
  it('ni anon ni authenticated pueden reclamar un intento ni crear el pedido', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const claims = role === 'authenticated' ? claimsFor(TENANT_A) : null
      const begins = await expectFailure(() =>
        asRole(db, role, claims, () =>
          sql(`select public.checkout_begin($1, $2, $3, null)`, [STORE_A_SLUG, newKey(), HASH]),
        ),
      )
      expect(begins, role).toMatch(/permission denied/i)

      const places = await expectFailure(() =>
        asRole(db, role, claims, () =>
          sql(
            `select public.checkout_place_order($1, 'x@y.com', '[]'::jsonb, null, null, '{}'::jsonb, null, null, null)`,
            ['00000000-0000-4000-8000-000000000000'],
          ),
        ),
      )
      expect(places, role).toMatch(/permission denied/i)
    }
  })

  it('el secreto de la reserva no sale al backoffice', async () => {
    const [row] = await svc(
      `select
         has_column_privilege('authenticated', 'public.checkout_intents', 'stage', 'SELECT') as ve_etapa,
         has_column_privilege('authenticated', 'public.checkout_intents', 'reservation_token', 'SELECT') as ve_token,
         has_column_privilege('authenticated', 'public.checkout_intents', 'result', 'SELECT') as ve_result`,
    )
    expect(row?.ve_etapa).toBe(true)
    // El token abre existencia apartada; `result` lleva dentro el token de
    // acceso del comprador a su pedido, que ya tiene su propia puerta.
    expect(row?.ve_token).toBe(false)
    expect(row?.ve_result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('aislamiento entre tenants', () => {
  it('el backoffice de A no ve los intentos de B', async () => {
    const claim = await begin(STORE_B_SLUG, newKey())
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id from public.checkout_intents`),
    )
    expect(rows.map((row) => row.id)).not.toContain(claim.intent_id)
  })

  it('ni los hechos de B', async () => {
    const claim = await begin(STORE_B_SLUG, newKey())
    const order = await place(String(claim.intent_id), [{ product_id: productoB, quantity: 1 }], {
      email: 'compradora@tienda-b.com',
    })

    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select aggregate_id from public.domain_events`),
    )
    expect(rows.map((row) => row.aggregate_id)).not.toContain(order.order_id)
  })

  it('anon no lee ni una de las dos tablas', async () => {
    for (const table of ['checkout_intents', 'domain_events']) {
      const message = await expectFailure(() =>
        asRole(db, 'anon', null, () => sql(`select 1 from public.${table}`)),
      )
      expect(message, table).toMatch(/permission denied/i)
    }
  })
})
