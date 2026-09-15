// @vitest-environment node
/**
 * P12-SaaS · el dominio LOGISTICO sobre Postgres REAL (PGlite).
 *
 * El criterio de la fase tiene dos mitades:
 *
 *   «PASS si se puede conectar un operador logistico nuevo mediante adapter y
 *    el ciclo de entrega/devolucion conserva trazabilidad.»
 *
 * La primera es una propiedad del CODIGO y se comprueba en
 * `fulfillment-provider.test.ts`, que registra un operador inventado y recorre
 * el ciclo entero con el. Esta suite comprueba la segunda —la trazabilidad— y
 * las cinco reglas que la hacen posible:
 *
 *  · el coste y la disponibilidad de entrega se resuelven en el SERVIDOR, y el
 *    navegador no puede leer la tabla de tarifas ni declarar un subtotal;
 *  · el despacho PARCIAL existe y no se puede despachar de mas;
 *  · el seguimiento se deduplica por el id de evento del operador, y un aviso
 *    sin firma verificada se registra pero NO mueve nada;
 *  · las transiciones invalidas se rechazan en la base, no en la pantalla;
 *  · y ninguna de las cinco tablas nuevas deja ver una fila de otro tenant.
 *
 * Ademas se comprueba la propiedad estructural que la fase promete: `orders` NO
 * gano ni una columna de logistica, y las claves ajenas van todas del despacho
 * al pedido y ninguna al reves.
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

let db: PGlite
let storeA: string
let storeB: string
let productA: string
let productB: string
let zonaLima: string
let metodoEstandar: string
let puntoCentro: string

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000e1'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'

/** `ebim.assert_checkout_allowed` limita por correo y hora: uno nuevo cada vez. */
let compradorSeq = 0

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function asUser<T = Row>(
  claims: ReturnType<typeof claimsFor>,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole(db, 'authenticated', claims, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function asAnon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

const adminA = () => claimsFor(TENANT_A)
const adminB = () => claimsFor(TENANT_B)
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
const superAdmin = () => claimsFor(TENANT_A, { email: 'dcalagua@ebim.pe' })

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

async function newProduct(
  tenant: typeof TENANT_A,
  storeId: string,
  sku: string,
  price: string,
  weight: string | null = '1.000',
): Promise<string> {
  const [row] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at, shipping_weight)
     values ($1, $2, $3, $4, $4, $5, $6, 'PEN', 500, 'published', now(), $7::numeric)
     returning id`,
    [tenant.organizationId, tenant.companyId, storeId, sku, `Nombre ${sku}`, price, weight],
  )
  return String(row?.id)
}

/** Direccion completa de Lima: la que cae dentro de la zona sembrada. */
const LIMA = { address: 'Av. Primavera 120', city: 'Lima', region: 'Lima', postal_code: '15023', country: 'PE' }

interface PlaceArgs {
  productId?: string
  quantity?: number
  address?: Record<string, string>
  delivery?: Record<string, unknown> | null
  tenant?: typeof TENANT_A
  /**
   * Cuenta corporativa del comprador. Va en el alta y no despues: el snapshot
   * del pedido es inmutable, asi que un `update` posterior lo rechaza la base.
   */
  accountId?: string | null
}

async function place(args: PlaceArgs = {}): Promise<Row> {
  const tenant = args.tenant ?? TENANT_A
  compradorSeq += 1
  const rows = await svc(
    `select public.create_order_for_slug(
       $1, $2, $3::jsonb, null, null, $4::jsonb, null, null,
       'storefront', $6, null, null, null, $5::jsonb) as result`,
    [
      tenant.storeSlug,
      `compradora${compradorSeq}@correo.test`,
      JSON.stringify([
        { product_id: args.productId ?? productA, quantity: args.quantity ?? 1 },
      ]),
      JSON.stringify(args.address ?? LIMA),
      args.delivery === undefined
        ? JSON.stringify({ method_code: 'estandar' })
        : args.delivery === null
          ? null
          : JSON.stringify(args.delivery),
      args.accountId ?? null,
    ],
  )
  return rows[0]?.result as Row
}

beforeAll(async () => {
  db = await createTestDatabase()

  storeA = await bootstrap(TENANT_A)
  storeB = await bootstrap(TENANT_B)

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'pedidos@tenant-a.com', 'orders', 'active'),
            ($1, $2, $4, 'lector@tenant-a.com',  'viewer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, ORDERS_USER, VIEWER_USER],
  )

  productA = await newProduct(TENANT_A, storeA, 'sku-a', '100.00')
  productB = await newProduct(TENANT_B, storeB, 'sku-b', '100.00')

  // --- La oferta de entrega de la tienda A ---------------------------------
  const [zona] = await svc(
    `insert into public.delivery_zones
       (organization_id, company_id, store_id, code, name, country, regions, postal_prefixes)
     values ($1, $2, $3, 'lima', 'Lima metropolitana', 'PE',
             array['Lima'], array['150'])
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  zonaLima = String(zona?.id)

  const [estandar] = await svc(
    `insert into public.delivery_methods
       (organization_id, company_id, store_id, code, strategy, display_name,
        lead_time_min_days, lead_time_max_days, is_active)
     values ($1, $2, $3, 'estandar', 'ship', 'Envio estandar', 1, 3, true)
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  metodoEstandar = String(estandar?.id)

  await svc(
    `insert into public.delivery_rates
       (organization_id, company_id, store_id, delivery_method_id, zone_id, currency,
        base_amount, free_over_subtotal)
     values ($1, $2, $3, $4, $5, 'PEN', 15.00, 200.00)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, metodoEstandar, zonaLima],
  )

  await svc(
    `insert into public.delivery_methods
       (organization_id, company_id, store_id, code, strategy, display_name, is_active)
     values ($1, $2, $3, 'recojo', 'pickup', 'Recojo en tienda', true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )

  const [punto] = await svc(
    `insert into public.pickup_points
       (organization_id, company_id, store_id, code, name, address, is_active)
     values ($1, $2, $3, 'centro', 'Local Centro', $4::jsonb, true)
     returning id`,
    [
      TENANT_A.organizationId,
      TENANT_A.companyId,
      storeA,
      JSON.stringify({ address: 'Jr. de la Union 100', city: 'Lima' }),
    ],
  )
  puntoCentro = String(punto?.id)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('la estructura: el pedido no sabe que existe un transportista', () => {
  it('orders no gana ni una columna de logistica', async () => {
    const rows = await svc(`
      select a.attname as column_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relname = 'orders'
        and (a.attname like '%carrier%' or a.attname like '%tracking%'
             or a.attname like '%shipment%' or a.attname like '%delivery%'
             or a.attname like '%fulfillment_id%' or a.attname like '%pickup%')
    `)
    expect(rows).toEqual([])
  })

  it('las claves ajenas van del despacho al pedido y NINGUNA al reves', async () => {
    const desdeDespacho = await svc(`
      select count(*)::int as total
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class dst on dst.oid = con.confrelid
      where con.contype = 'f' and dst.relname = 'orders'
        and src.relname in ('fulfillments', 'return_requests')
    `)
    expect(Number(desdeDespacho[0]?.total)).toBeGreaterThanOrEqual(2)

    const desdePedido = await svc(`
      select src.relname as source, dst.relname as target
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class dst on dst.oid = con.confrelid
      where con.contype = 'f' and src.relname in ('orders', 'order_items')
        and dst.relname in ('fulfillments', 'shipments', 'return_requests',
                            'delivery_methods', 'pickup_points')
    `)
    expect(desdePedido).toEqual([])
  })
})

describe('la cotizacion se resuelve en el servidor', () => {
  it('anon NO puede leer la tabla de tarifas', async () => {
    const message = await asAnon(`select 1`).then(() =>
      expectFailure(() => asAnon(`select base_amount from public.delivery_rates`)),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('cotiza con cobertura, plazo y franja sin que el navegador diga un importe', async () => {
    const [row] = await asAnon(
      `select public.delivery_options_for_slug($1, $2::jsonb, $3::jsonb) as result`,
      [TENANT_A.storeSlug, JSON.stringify(LIMA), JSON.stringify([{ product_id: productA, quantity: 1 }])],
    )
    const result = row?.result as Row
    expect((result.zone as Row).code).toBe('lima')

    const options = result.options as Row[]
    const estandar = options.find((o) => o.code === 'estandar')
    expect(estandar?.available).toBe(true)
    expect(estandar?.amount).toBe('15.00')
    expect(estandar?.promised_from).toBeTruthy()
  })

  it('el umbral de envio gratis lo decide el SUBTOTAL que calcula el servidor', async () => {
    const [row] = await asAnon(
      `select public.delivery_options_for_slug($1, $2::jsonb, $3::jsonb) as result`,
      [TENANT_A.storeSlug, JSON.stringify(LIMA), JSON.stringify([{ product_id: productA, quantity: 3 }])],
    )
    const options = (row?.result as Row).options as Row[]
    const estandar = options.find((o) => o.code === 'estandar')
    expect(estandar?.amount).toBe('0.00')
    expect(estandar?.free).toBe(true)
  })

  it('una direccion fuera de cobertura sale como NO disponible, con motivo', async () => {
    const [row] = await asAnon(
      `select public.delivery_options_for_slug($1, $2::jsonb, $3::jsonb) as result`,
      [
        TENANT_A.storeSlug,
        JSON.stringify({ ...LIMA, country: 'CL', region: 'Santiago', postal_code: '8320000' }),
        JSON.stringify([{ product_id: productA, quantity: 1 }]),
      ],
    )
    const options = (row?.result as Row).options as Row[]
    const estandar = options.find((o) => o.code === 'estandar')
    expect(estandar?.available).toBe(false)
    expect(estandar?.reason).toBe('FUERA_DE_COBERTURA')
    // El recojo NO depende de la direccion del comprador: sigue disponible.
    expect(options.find((o) => o.code === 'recojo')?.available).toBe(true)
  })

  it('la zona mas ESPECIFICA gana a la general', async () => {
    await svc(
      `insert into public.delivery_zones
         (organization_id, company_id, store_id, code, name, country, priority)
       values ($1, $2, $3, 'nacional', 'Todo el pais', 'PE', 10)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    const [row] = await svc(
      `select (ebim.delivery_zone_for($1, 'PE', 'Lima', '15023')).code as code`,
      [storeA],
    )
    // `nacional` tiene mejor `priority` (10 < 100) y aun asi pierde: el prefijo
    // postal es mas especifico. Sin esa regla, la tarifa nacional se cobraria
    // dentro de la ciudad.
    expect(row?.code).toBe('lima')

    const [fuera] = await svc(
      `select (ebim.delivery_zone_for($1, 'PE', 'Cusco', '08000')).code as code`,
      [storeA],
    )
    expect(fuera?.code).toBe('nacional')
  })
})

describe('el pedido nace con su transporte y su promesa de entrega', () => {
  it('cobra el envio y planifica el fulfillment en la misma transaccion', async () => {
    const order = await place({ quantity: 1 })
    expect(order.shipping_total).toBe('15.00')
    // 100 + 18% + 15 de envio
    expect(order.grand_total).toBe('133.00')

    const delivery = order.delivery as Row
    expect(delivery.method_code).toBe('estandar')
    expect(delivery.fulfillment_id).toBeTruthy()

    const [ful] = await svc(`select * from public.fulfillments where id = $1`, [
      delivery.fulfillment_id,
    ])
    expect(ful?.state).toBe('pending')
    expect(ful?.sequence).toBe(1)
    expect(ful?.shipping_cost).toBe('15.00')
    expect(ful?.method_code).toBe('estandar')
  })

  it('sin eleccion de entrega el pedido nace EXACTAMENTE como antes de P12', async () => {
    const order = await place({ delivery: null })
    expect(order.shipping_total).toBe('0.00')
    expect(order.grand_total).toBe('118.00')
    expect(order.delivery).toBeNull()

    const rows = await svc(`select count(*)::int as total from public.fulfillments where order_id = $1`, [
      order.order_id,
    ])
    expect(rows[0]?.total).toBe(0)
  })

  it('una direccion fuera de cobertura detiene la compra', async () => {
    const message = await expectFailure(() =>
      place({ address: { ...LIMA, country: 'CL', region: 'Santiago', postal_code: '8320000' } }),
    )
    expect(message).toMatch(/DIRECCION_NO_ENTREGABLE/)
  })

  it('el recojo congela la direccion del PUNTO, no la del comprador', async () => {
    const order = await place({
      delivery: { method_code: 'recojo', pickup_point_id: puntoCentro },
    })
    const [ful] = await svc(`select * from public.fulfillments where order_id = $1`, [
      order.order_id,
    ])
    expect(ful?.strategy).toBe('pickup')
    expect(ful?.pickup_point_id).toBe(puntoCentro)
    expect((ful?.address as Row).address).toBe('Jr. de la Union 100')
    expect(ful?.shipping_cost).toBe('0.00')
  })

  it('un recojo SIN punto no se puede pedir', async () => {
    const message = await expectFailure(() => place({ delivery: { method_code: 'recojo' } }))
    expect(message).toMatch(/PUNTO_DE_RECOJO_REQUERIDO/)
  })

  it('un metodo que no existe no se puede elegir', async () => {
    const message = await expectFailure(() => place({ delivery: { method_code: 'inventado' } }))
    expect(message).toMatch(/ENTREGA_NO_DISPONIBLE/)
  })
})

describe('despacho parcial', () => {
  let orderId: string
  let itemId: string

  beforeAll(async () => {
    const order = await place({ quantity: 4, delivery: null })
    orderId = String(order.order_id)
    const [item] = await svc(`select id from public.order_items where order_id = $1`, [orderId])
    itemId = String(item?.id)
  })

  it('crea una entrega con PARTE de las unidades', async () => {
    const [row] = await asUser(
      ordersA(),
      `select public.fulfillment_create($1, 'estandar', $2::jsonb) as result`,
      [orderId, JSON.stringify([{ order_item_id: itemId, quantity: 3 }])],
    )
    const created = row?.result as Row
    const [items] = await svc(
      `select coalesce(sum(quantity), 0)::int as total from public.fulfillment_items
        where fulfillment_id = $1`,
      [created.fulfillment_id],
    )
    expect(items?.total).toBe(3)
  })

  it('la segunda entrega NO vuelve a cobrar transporte', async () => {
    const [row] = await asUser(
      ordersA(),
      `select public.fulfillment_create($1, 'estandar', $2::jsonb) as result`,
      [orderId, JSON.stringify([{ order_item_id: itemId, quantity: 1 }])],
    )
    const created = row?.result as Row
    const [ful] = await svc(`select shipping_cost, sequence from public.fulfillments where id = $1`, [
      created.fulfillment_id,
    ])
    expect(ful?.shipping_cost).toBe('0.00')
    expect(ful?.sequence).toBe(2)

    // La suma de las entregas SIEMPRE es el transporte del pedido.
    const [suma] = await svc(
      `select coalesce(sum(f.shipping_cost), 0)::text as total, o.shipping_total::text as pedido
         from public.orders o
         left join public.fulfillments f on f.order_id = o.id and f.state <> 'cancelled'
        where o.id = $1 group by o.shipping_total`,
      [orderId],
    )
    expect(suma?.total).toBe(suma?.pedido)
  })

  it('no se puede despachar mas de lo que se compro', async () => {
    const message = await expectFailure(() =>
      asUser(
        ordersA(),
        `select public.fulfillment_create($1, 'estandar', $2::jsonb) as result`,
        [orderId, JSON.stringify([{ order_item_id: itemId, quantity: 1 }])],
      ),
    )
    expect(message).toMatch(/ENTREGA_CANTIDAD_EXCEDIDA/)
  })

  it('entregar una de las dos deja el pedido PARCIALMENTE entregado', async () => {
    const fuls = await svc(
      `select id from public.fulfillments where order_id = $1 order by sequence`,
      [orderId],
    )
    const first = String(fuls[0]?.id)

    for (const to of ['allocated', 'picking', 'packed', 'ready', 'in_transit', 'delivered']) {
      await asUser(ordersA(), `select public.fulfillment_transition($1, $2) as result`, [first, to])
    }

    const [order] = await svc(`select fulfillment_status from public.orders where id = $1`, [orderId])
    expect(order?.fulfillment_status).toBe('partially_fulfilled')
  })

  it('entregar la segunda lo deja ENTREGADO', async () => {
    const fuls = await svc(
      `select id from public.fulfillments where order_id = $1 order by sequence`,
      [orderId],
    )
    const second = String(fuls[1]?.id)
    for (const to of ['allocated', 'packed', 'ready', 'delivered']) {
      await asUser(ordersA(), `select public.fulfillment_transition($1, $2) as result`, [second, to])
    }
    const [order] = await svc(`select fulfillment_status from public.orders where id = $1`, [orderId])
    expect(order?.fulfillment_status).toBe('fulfilled')
  })

  it('la linea de tiempo del pedido cuenta el despacho entero', async () => {
    const rows = await svc(
      `select event_type from public.order_events where order_id = $1 order by created_at, id`,
      [orderId],
    )
    const types = rows.map((r) => String(r.event_type))
    expect(types).toContain('fulfillment.created')
    expect(types).toContain('fulfillment.state_changed')
    expect(types).toContain('order.fulfillment_status_changed')
  })
})

/**
 * P19 · La tienda que no entrega sin cobrar.
 *
 * Apagado por defecto: encenderlo para todos habria roto la operacion de
 * cualquier tenant que vende a credito. Y frena la ENTREGA, no la preparacion:
 * preparar mientras llega la transferencia es trabajo util y sin riesgo; lo que
 * no se recupera es la mercancia que ya salio.
 */
/**
 * P19 · La tienda que no entrega sin cobrar.
 *
 * Apagado por defecto: encenderlo para todos habria roto la operacion de
 * cualquier tenant que vende a credito. Y frena la ENTREGA, no la preparacion —
 * preparar mientras llega la transferencia es trabajo util y sin riesgo; lo que
 * no se recupera es la mercancia que ya salio.
 */
describe('exigir el cobro antes de entregar', () => {
  /** Deja la entrega LISTA. `ready` no sale de `pending`: pasa por asignada. */
  async function dejarLista(entrega: string) {
    for (const paso of ['allocated', 'ready']) {
      await asUser(ordersA(), `select public.fulfillment_transition($1, $2) as result`, [
        entrega,
        paso,
      ])
    }
  }

  /** Un pedido nuevo con su entrega, opcionalmente de una cuenta corporativa. */
  async function nueva(accountId: string | null = null) {
    const order = await place({ delivery: null, accountId })
    const [row] = await asUser(
      ordersA(),
      `select public.fulfillment_create($1, 'estandar') as result`,
      [order.order_id],
    )
    return {
      pedido: String(order.order_id),
      entrega: String((row?.result as Row).fulfillment_id),
    }
  }

  /** Una cuenta corporativa con su cliente, para las dos pruebas de credito. */
  async function cuentaConCredito(codigo: string, estado: 'ok' | 'blocked') {
    const [cliente] = await svc(
      `insert into public.customers (organization_id, company_id, kind, code, name)
       values ($1, $2, 'company', $3, $3) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, `CLI-${codigo}`],
    )
    const [cuenta] = await svc(
      `insert into public.business_accounts
         (organization_id, company_id, customer_id, code, name, credit_limit, credit_status)
       values ($1, $2, $3, $4, $4, '10000.00', $5::public.credit_status) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, String(cliente?.id), codigo, estado],
    )
    return String(cuenta?.id)
  }

  beforeEach(async () => {
    await svc(`update public.store_settings set require_payment_before_dispatch = true`)
  })

  afterAll(async () => {
    await svc(`update public.store_settings set require_payment_before_dispatch = false`)
  })

  it('preparar SI se puede: el candado esta en la entrega, no en el almacen', async () => {
    const { entrega } = await nueva()
    for (const paso of ['allocated', 'picking', 'packed', 'ready']) {
      await asUser(ordersA(), `select public.fulfillment_transition($1, $2) as result`, [
        entrega,
        paso,
      ])
    }
    const [fila] = await svc(`select state::text from public.fulfillments where id = $1`, [entrega])
    expect(fila?.state).toBe('ready')
  })

  it('entregar sin cobrar se rechaza', async () => {
    const { entrega } = await nueva()
    await dejarLista(entrega)

    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [entrega]),
    )
    expect(message).toMatch(/PAGO_PENDIENTE/)
  })

  it('salir en camino tampoco: el paquete ya no vuelve', async () => {
    const { entrega } = await nueva()
    await dejarLista(entrega)

    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'in_transit') as result`, [entrega]),
    )
    expect(message).toMatch(/PAGO_PENDIENTE/)
  })

  it('cobrado, entrega sin problema', async () => {
    const { entrega, pedido } = await nueva()
    await dejarLista(entrega)
    await svc(`update public.orders set payment_status = 'paid' where id = $1`, [pedido])

    await asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [
      entrega,
    ])
    const [fila] = await svc(`select state::text from public.fulfillments where id = $1`, [entrega])
    expect(fila?.state).toBe('delivered')
  })

  /**
   * El medio con el que se va a cobrar ESTE pedido. Es lo que distingue una
   * venta a credito de una que simplemente todavia no se ha pagado.
   */
  async function conMedio(pedido: string, codigo: string, familia: 'credit' | 'wallet') {
    const [store] = await svc(`select store_id, organization_id, company_id from public.orders where id = $1`, [pedido])
    const [metodo] = await svc(
      `insert into public.payment_methods
         (organization_id, company_id, store_id, code, kind, display_name, capture_mode, is_active)
       values ($1, $2, $3, $4, $5::public.payment_method_kind, $4, 'manual', true)
       returning id`,
      [store?.organization_id, store?.company_id, store?.store_id, codigo, familia],
    )
    await svc(
      `insert into public.payment_intents
         (organization_id, company_id, store_id, order_id, payment_method_id,
          currency, amount, idempotency_key)
       values ($1, $2, $3, $4, $5, 'PEN', '10.00', $6)`,
      [store?.organization_id, store?.company_id, store?.store_id, pedido, metodo?.id, `int-${codigo}-${pedido}`],
    )
  }

  /**
   * Sin esta excepcion la regla estorbaria justo en el caso para el que existe
   * una linea de credito, y una regla que estorba se apaga entera el primer dia:
   * se habria cambiado un control por ninguno.
   */
  it('el pedido VENDIDO a credito entrega sin cobrar', async () => {
    const cuenta = await cuentaConCredito('CRED', 'ok')
    const { entrega, pedido } = await nueva(cuenta)
    await conMedio(pedido, 'credito-test', 'credit')
    await dejarLista(entrega)

    await asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [
      entrega,
    ])
    const [fila] = await svc(`select state::text from public.fulfillments where id = $1`, [entrega])
    expect(fila?.state).toBe('delivered')
  })

  /**
   * La exencion es del PEDIDO, no de la cuenta.
   *
   * Tener credito disponible no es estar usandolo: quien elige Yape esta
   * diciendo que paga ahora. Mirando solo la cuenta, el control quedaba apagado
   * para todos sus pedidos por el solo hecho de que existiera una linea — que
   * es como salio `EC-20260909-00031` sin cobrar y con la mercancia fuera.
   */
  it('la misma cuenta pagando con billetera NO entrega sin cobrar', async () => {
    const cuenta = await cuentaConCredito('CRED-YAPE', 'ok')
    const { entrega, pedido } = await nueva(cuenta)
    await conMedio(pedido, 'yape-test', 'wallet')
    await dejarLista(entrega)

    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [entrega]),
    )
    expect(message).toMatch(/PAGO_PENDIENTE/)
  })

  /**
   * Y una cuenta con el credito BLOQUEADO no es una cuenta a credito.
   *
   * El pedido se crea con la cuenta AL DIA y el bloqueo llega despues. Desde A1
   * no puede ser de otra forma —una cuenta bloqueada ya no puede crear pedidos—,
   * y es ademas el caso real que esta prueba vigila: un pedido vivo de una
   * cuenta a la que cobranzas acaba de retener.
   */
  it('con el credito bloqueado, la excepcion no aplica', async () => {
    const cuenta = await cuentaConCredito('BLOQ', 'ok')
    const { entrega, pedido } = await nueva(cuenta)
    await svc(`update public.business_accounts set credit_status = 'blocked' where id = $1`, [cuenta])
    await conMedio(pedido, 'credito-bloq', 'credit')
    await dejarLista(entrega)

    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [entrega]),
    )
    expect(message).toMatch(/PAGO_PENDIENTE/)
  })

  it('con el ajuste apagado, todo sigue como antes', async () => {
    const { entrega } = await nueva()
    await dejarLista(entrega)
    await svc(`update public.store_settings set require_payment_before_dispatch = false`)

    await asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [
      entrega,
    ])
    const [fila] = await svc(`select state::text from public.fulfillments where id = $1`, [entrega])
    expect(fila?.state).toBe('delivered')
  })

  // -------------------------------------------------------------------------
  // Cierre · D2 (20260914190000). Abrir el envío es entregar el bulto al
  // transportista: sin este candado, el seguimiento movía la entrega a «en
  // camino» sin haber pasado nunca por la regla.
  // -------------------------------------------------------------------------
  it('abrir el ENVÍO sin cobrar también se rechaza, y no deja envío a medias', async () => {
    const { entrega } = await nueva()
    await dejarLista(entrega)

    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.shipment_open($1, 'envio-sin-cobro-001') as result`, [entrega]),
    )
    expect(message).toMatch(/PAGO_PENDIENTE/)
    const envios = await svc(`select 1 from public.shipments where fulfillment_id = $1`, [entrega])
    expect(envios).toHaveLength(0)
  })

  it('cobrado, el envío se abre', async () => {
    const { entrega, pedido } = await nueva()
    await dejarLista(entrega)
    await svc(`update public.orders set payment_status = 'paid' where id = $1`, [pedido])

    const [row] = await asUser(ordersA(), `select public.shipment_open($1, 'envio-cobrado-0001') as result`, [
      entrega,
    ])
    expect((row?.result as Row).replay).toBe(false)
  })

  it('un envío YA abierto se reintenta sin chocar con la regla encendida después', async () => {
    const { entrega } = await nueva()
    await dejarLista(entrega)
    await svc(`update public.store_settings set require_payment_before_dispatch = false`)
    await asUser(ordersA(), `select public.shipment_open($1, 'envio-previo-00001') as result`, [entrega])

    await svc(`update public.store_settings set require_payment_before_dispatch = true`)
    const [row] = await asUser(ordersA(), `select public.shipment_open($1, 'envio-previo-00001') as result`, [
      entrega,
    ])
    expect((row?.result as Row).replay).toBe(true)
  })
})

describe('transiciones', () => {
  let fulId: string

  beforeAll(async () => {
    const order = await place({ delivery: null })
    const [row] = await asUser(
      ordersA(),
      `select public.fulfillment_create($1, 'estandar') as result`,
      [order.order_id],
    )
    fulId = String((row?.result as Row).fulfillment_id)
  })

  it('un salto que la maquina no permite se rechaza', async () => {
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'delivered') as result`, [fulId]),
    )
    expect(message).toMatch(/ENTREGA_TRANSICION_INVALIDA/)
  })

  it('un estado inventado se rechaza con codigo de dominio', async () => {
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'volando') as result`, [fulId]),
    )
    expect(message).toMatch(/ESTADO_NO_VALIDO/)
  })

  it('cancelar exige motivo', async () => {
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_transition($1, 'cancelled') as result`, [fulId]),
    )
    expect(message).toMatch(/MOTIVO_REQUERIDO/)
  })

  it('un rol sin permiso de pedidos no mueve nada', async () => {
    const message = await expectFailure(() =>
      asUser(viewerA(), `select public.fulfillment_transition($1, 'allocated') as result`, [fulId]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('el super admin de suite no opera entregas de un tenant', async () => {
    const message = await expectFailure(() =>
      asUser(superAdmin(), `select public.fulfillment_transition($1, 'allocated') as result`, [
        fulId,
      ]),
    )
    expect(message).toMatch(/OPERADOR_NO_ES_ACTOR/)
  })

  it('el importe cobrado de una entrega no se reescribe ni con service_role', async () => {
    const message = await expectFailure(() =>
      svc(`update public.fulfillments set shipping_cost = 999 where id = $1`, [fulId]),
    )
    expect(message).toMatch(/ENTREGA_IMPORTE_INMUTABLE/)
  })
})

describe('envios y seguimiento', () => {
  let fulId: string
  let shipmentId: string

  beforeAll(async () => {
    const order = await place({ delivery: null })
    const [row] = await asUser(
      ordersA(),
      `select public.fulfillment_create($1, 'estandar') as result`,
      [order.order_id],
    )
    fulId = String((row?.result as Row).fulfillment_id)
    await asUser(ordersA(), `select public.fulfillment_transition($1, 'allocated') as result`, [fulId])
  })

  it('abrir el mismo envio dos veces con la misma clave devuelve el mismo', async () => {
    const [first] = await asUser(
      ordersA(),
      `select public.shipment_open($1, 'idem-envio-0001') as result`,
      [fulId],
    )
    const [second] = await asUser(
      ordersA(),
      `select public.shipment_open($1, 'idem-envio-0001') as result`,
      [fulId],
    )
    shipmentId = String((first?.result as Row).shipment_id)
    expect((second?.result as Row).shipment_id).toBe(shipmentId)
    expect((second?.result as Row).replay).toBe(true)
  })

  it('el resultado del operador solo lo puede escribir el servidor', async () => {
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.shipment_apply_outcome($1, 'created') as result`, [shipmentId]),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('registra la guia que devolvio el operador', async () => {
    await svc(
      `select public.shipment_apply_outcome($1, 'created', 'GUIA-0001',
              'https://operador.invalid/GUIA-0001', null, 9.90, 'PEN') as result`,
      [shipmentId],
    )
    const [ship] = await svc(`select * from public.shipments where id = $1`, [shipmentId])
    expect(ship?.state).toBe('created')
    expect(ship?.tracking_number).toBe('GUIA-0001')
    // El coste del OPERADOR (9.90) no es el que se le cobro al comprador.
    expect(ship?.cost).toBe('9.90')
  })

  it('el mismo aviso dos veces es UNA sola fila', async () => {
    const evento = JSON.stringify([
      {
        external_event_id: 'evt-001',
        status: 'in_transit',
        provider_status: 'EN RUTA',
        occurred_at: '2026-08-28T10:00:00Z',
        description: 'Salio del centro',
      },
    ])

    const [first] = await svc(
      `select public.shipment_track_ingest($1, $2::jsonb, 'provider_webhook', true) as result`,
      [shipmentId, evento],
    )
    const [second] = await svc(
      `select public.shipment_track_ingest($1, $2::jsonb, 'provider_webhook', true) as result`,
      [shipmentId, evento],
    )

    expect((first?.result as Row).accepted).toBe(1)
    expect((second?.result as Row).accepted).toBe(0)
    expect((second?.result as Row).duplicated).toBe(1)
    expect((second?.result as Row).replay).toBe(true)

    const [count] = await svc(
      `select count(*)::int as total from public.tracking_events where shipment_id = $1`,
      [shipmentId],
    )
    expect(count?.total).toBe(1)
  })

  it('el aviso movio el envio Y la entrega', async () => {
    const [ship] = await svc(`select state from public.shipments where id = $1`, [shipmentId])
    expect(ship?.state).toBe('in_transit')
    const [ful] = await svc(`select state from public.fulfillments where id = $1`, [fulId])
    expect(ful?.state).toBe('in_transit')
  })

  it('el estado del operador se guarda SIN traducir, al lado del canonico', async () => {
    const [event] = await svc(
      `select status, provider_status from public.tracking_events where shipment_id = $1`,
      [shipmentId],
    )
    expect(event?.status).toBe('in_transit')
    expect(event?.provider_status).toBe('EN RUTA')
  })

  it('un aviso SIN firma verificada se registra pero NO mueve nada', async () => {
    await svc(
      `select public.shipment_track_ingest($1, $2::jsonb, 'provider_webhook', false) as result`,
      [
        shipmentId,
        JSON.stringify([
          { external_event_id: 'evt-falso', status: 'delivered', occurred_at: '2026-08-28T18:00:00Z' },
        ]),
      ],
    )
    const [event] = await svc(
      `select signature_verified from public.tracking_events
        where shipment_id = $1 and external_event_id = 'evt-falso'`,
      [shipmentId],
    )
    expect(event?.signature_verified).toBe(false)

    const [ship] = await svc(`select state from public.shipments where id = $1`, [shipmentId])
    expect(ship?.state).toBe('in_transit')
  })

  it('un aviso DESORDENADO se guarda y no tumba la ingesta', async () => {
    // `label_created` despues de `in_transit` no es un camino valido de la
    // maquina. Se registra como hecho y no mueve el envio, en vez de fallar y
    // condenar al operador a reintentar para siempre.
    const [row] = await svc(
      `select public.shipment_track_ingest($1, $2::jsonb, 'provider_webhook', true) as result`,
      [
        shipmentId,
        JSON.stringify([
          { external_event_id: 'evt-tarde', status: 'label_created', occurred_at: '2026-08-28T07:00:00Z' },
        ]),
      ],
    )
    expect((row?.result as Row).accepted).toBe(1)
    const [ship] = await svc(`select state from public.shipments where id = $1`, [shipmentId])
    expect(ship?.state).toBe('in_transit')
  })

  it('la bitacora de seguimiento no se edita ni se borra, ni con service_role', async () => {
    const update = await expectFailure(() =>
      svc(`update public.tracking_events set description = 'otra cosa' where shipment_id = $1`, [
        shipmentId,
      ]),
    )
    expect(update).toMatch(/BITACORA_INMUTABLE/)

    const remove = await expectFailure(() =>
      svc(`delete from public.tracking_events where shipment_id = $1`, [shipmentId]),
    )
    expect(remove).toMatch(/BITACORA_INMUTABLE/)
  })

  it('la entrega llega y el pedido queda entregado', async () => {
    await svc(
      `select public.shipment_track_ingest($1, $2::jsonb, 'provider_webhook', true) as result`,
      [
        shipmentId,
        JSON.stringify([
          { external_event_id: 'evt-fin', status: 'delivered', occurred_at: '2026-08-28T19:00:00Z' },
        ]),
      ],
    )
    const [ful] = await svc(`select state, order_id from public.fulfillments where id = $1`, [fulId])
    expect(ful?.state).toBe('delivered')
    const [order] = await svc(`select fulfillment_status from public.orders where id = $1`, [
      ful?.order_id,
    ])
    expect(order?.fulfillment_status).toBe('fulfilled')
  })
})

describe('aislamiento entre tenants', () => {
  const TABLAS = [
    'delivery_zones',
    'delivery_methods',
    'delivery_rates',
    'pickup_points',
    'delivery_windows',
    'fulfillments',
    'fulfillment_items',
    'shipments',
    'shipment_items',
    'tracking_events',
  ]

  it('un miembro de B no ve ni una fila de A en ninguna tabla del dominio', async () => {
    for (const tabla of TABLAS) {
      const rows = await asUser(adminB(), `select count(*)::int as total from public.${tabla}`)
      expect(`${tabla}: ${rows[0]?.total}`).toBe(`${tabla}: 0`)
    }
  })

  it('un miembro de A si ve lo suyo', async () => {
    const rows = await asUser(adminA(), `select count(*)::int as total from public.fulfillments`)
    expect(Number(rows[0]?.total)).toBeGreaterThan(0)
  })

  it('B no puede mover una entrega de A aunque conozca su identificador', async () => {
    const [ful] = await svc(`select id from public.fulfillments limit 1`)
    const message = await expectFailure(() =>
      asUser(adminB(), `select public.fulfillment_transition($1, 'allocated') as result`, [ful?.id]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('B no puede sembrar una zona con el tenant de A', async () => {
    const message = await expectFailure(() =>
      asUser(
        adminB(),
        `insert into public.delivery_zones
           (organization_id, company_id, store_id, code, name, country)
         values ($1, $2, $3, 'robada', 'Zona ajena', 'PE')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('la cotizacion de B no ve los metodos de A', async () => {
    const [row] = await asAnon(
      `select public.delivery_options_for_slug($1, $2::jsonb, $3::jsonb) as result`,
      [TENANT_B.storeSlug, JSON.stringify(LIMA), JSON.stringify([{ product_id: productB, quantity: 1 }])],
    )
    expect((row?.result as Row).options).toEqual([])
  })
})

describe('el almacen del que sale la mercancia', () => {
  let warehouseId: string
  let puntoConAlmacen: string

  beforeAll(async () => {
    const [w] = await svc(
      `insert into public.warehouses (organization_id, company_id, code, name, city, country)
       values ($1, $2, 'ALM-CENTRO', 'Almacen Centro', 'Lima', 'PE') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    warehouseId = String(w?.id)

    const [p] = await svc(
      `insert into public.pickup_points
         (organization_id, company_id, store_id, code, name, warehouse_id, is_active)
       values ($1, $2, $3, 'centro-almacen', 'Local con almacen', $4, true)
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, warehouseId],
    )
    puntoConAlmacen = String(p?.id)
  })

  it('el punto de recojo MANDA sobre la regla de abastecimiento', async () => {
    const [row] = await svc(
      `select ebim.select_warehouse($1, 'store_priority', $2, '[]'::jsonb) as warehouse`,
      [storeA, puntoConAlmacen],
    )
    expect(row?.warehouse).toBe(warehouseId)
  })

  it('sin punto, la regla del metodo elige el primero del orden declarado', async () => {
    const [row] = await svc(
      `select ebim.select_warehouse($1, 'store_priority', null, '[]'::jsonb) as warehouse`,
      [storeA],
    )
    expect(row?.warehouse).toBe(warehouseId)
  })

  it('un almacen de otra sociedad no se puede imponer a una entrega', async () => {
    const [wb] = await svc(
      `insert into public.warehouses (organization_id, company_id, code, name)
       values ($1, $2, 'ALM-B', 'Almacen de B') returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId],
    )
    const [ful] = await svc(`select id from public.fulfillments limit 1`)
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.fulfillment_assign($1, $2) as result`, [ful?.id, wb?.id]),
    )
    expect(message).toMatch(/ALMACEN_NO_ENCONTRADO/)
  })
})
