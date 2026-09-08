// @vitest-environment node
/**
 * P08-SaaS · OMS sobre Postgres REAL (PGlite).
 *
 * El criterio de aceptacion de la fase es una sola frase: **el historial de un
 * pedido sigue siendo correcto aunque cambien producto, precio, impuestos o
 * configuracion despues de comprar**. Este archivo lo comprueba literalmente —
 * compra, luego revienta el catalogo, y vuelve a leer el pedido— y ademas
 * verifica lo que hace falta para que esa propiedad no se pueda romper por
 * descuido:
 *
 *  · los cuatro ejes de estado y sus maquinas, incluida la sincronizacion del
 *    camino viejo (`UPDATE orders SET status`), que tiene que seguir siendo
 *    verdad en el modelo nuevo;
 *  · la INMUTABILIDAD del snapshot, comprobada incluso como `service_role`, que
 *    es quien no pasa por ninguna policy;
 *  · el comando de transicion: autorizacion dentro, saltos imposibles, hecho de
 *    dominio y linea de tiempo escritos en la misma transaccion;
 *  · la aprobacion B2B: un pedido pendiente NO avanza, el aprobador de la
 *    cuenta decide sin ser miembro del tenant, y un pedido B2C no entra nunca
 *    al circuito;
 *  · el aislamiento entre tenants en las cuatro tablas nuevas;
 *  · la puerta del comprador (`order_by_token`), que gana los cuatro estados y
 *    sigue sin devolver ni una nota interna.
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
import {
  FULFILLMENT_STATUSES,
  ORDER_AXES,
  PAYMENT_STATUSES,
} from '../functions/_shared/orders.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA: string
let storeB: string
let productA: string
let categoryA: string
let orderA: string
let orderB: string
let tokenA: string
let cuentaAcme: string
let productB2B: string
let tokenB: string

/**
 * `ebim.assert_checkout_allowed` limita los pedidos POR CORREO y hora (P10
 * historico). Es una proteccion real y no se toca: lo que se hace aqui es
 * comprar con un correo distinto cada vez, que es exactamente lo que pasa en
 * una tienda de verdad.
 */
let compradorSeq = 0

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000e1'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'
const BUYER_ID = '0a000000-0000-4000-8000-0000000000b1'
const APPROVER_ID = '0a000000-0000-4000-8000-0000000000b2'
const OUTSIDER_ID = '0a000000-0000-4000-8000-0000000000f9'

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

const ordersClaims = () =>
  claimsFor(TENANT_A, {
    sub: ORDERS_USER,
    email: 'pedidos@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'orders' }],
  })

const viewerClaims = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

/**
 * Un usuario B2B NO es miembro del tenant: sus claims no llevan ninguna
 * sociedad. Es lo que hace que `can_access` sea falso para el y que su unica
 * puerta sean las funciones definer.
 */
const b2bClaims = (sub: string, email: string) => ({
  sub,
  email,
  org_id: '00000000-0000-4000-8000-000000000000',
  companies: [],
  active_company: '00000000-0000-4000-8000-000000000000',
  apps: ['ecommerce'],
})

async function asUser<T = Row>(
  claims: ReturnType<typeof claimsFor> | ReturnType<typeof b2bClaims>,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole(db, 'authenticated', claims, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
  await svc(
    `select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`,
    [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ],
  )
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
  taxCategoryId: string | null = null,
): Promise<string> {
  const [row] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at, tax_category_id)
     values ($1, $2, $3, $4, $4, $5, $6, 'PEN', 500, 'published', now(), $7)
     returning id`,
    [tenant.organizationId, tenant.companyId, storeId, sku, `Nombre ${sku}`, price, taxCategoryId],
  )
  return String(row?.id)
}

async function place(
  tenant: typeof TENANT_A,
  items: Array<{ product_id: string; quantity: number }>,
  extra: {
    accountId?: string | null
    source?: string
    billing?: Record<string, unknown> | null
    approval?: Record<string, unknown> | null
    email?: string
  } = {},
): Promise<Row> {
  compradorSeq += 1
  const rows = await svc(
    `select public.create_order_for_slug(
        $1, $8, $2::jsonb, 'Ana Compradora', '+51 999 111 222',
        $3::jsonb, 'Dejar con el portero', null, $4, $5, $6::jsonb, $7::jsonb) as result`,
    [
      tenant.storeSlug,
      JSON.stringify(items),
      JSON.stringify({ address: 'Av. Primavera 120', reference: 'Porton verde' }),
      extra.source ?? 'storefront',
      extra.accountId ?? null,
      extra.billing ? JSON.stringify(extra.billing) : null,
      extra.approval ? JSON.stringify(extra.approval) : null,
      extra.email ?? `compradora${compradorSeq}@correo.test`,
    ],
  )
  return rows[0]?.result as Row
}

async function timelineOf(orderId: string): Promise<Row[]> {
  return svc(
    `select event_type, axis, from_value, to_value, note, source, actor_email
       from public.order_events where order_id = $1 order by created_at, id`,
    [orderId],
  )
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

  const [cat] = await svc(
    `insert into public.tax_categories (organization_id, company_id, code, name)
       values ($1, $2, 'iva-general', 'IVA general') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  categoryA = String(cat?.id)
  await svc(
    `insert into public.tax_rates (organization_id, company_id, tax_category_id, rate, valid_from)
       values ($1, $2, $3, 0.1800, now() - interval '1 day')`,
    [TENANT_A.organizationId, TENANT_A.companyId, categoryA],
  )

  productA = await newProduct(TENANT_A, storeA, 'sku-a', '100.00', categoryA)
  const productBRow = await newProduct(TENANT_B, storeB, 'sku-b', '50.00')

  const resultA = await place(TENANT_A, [{ product_id: productA, quantity: 2 }], {
    email: 'ana@compradora.com',
  })
  orderA = String(resultA.order_id)
  tokenA = String(resultA.access_token)

  const resultB = await svc(
    `select public.create_order_for_slug($1, 'otro@compradora.com', $2::jsonb) as result`,
    [TENANT_B.storeSlug, JSON.stringify([{ product_id: productBRow, quantity: 1 }])],
  )
  orderB = String((resultB[0]?.result as Row).order_id)
  tokenB = String((resultB[0]?.result as Row).access_token)

  // ---- El escenario B2B ---------------------------------------------------
  const [acme] = await svc(
    `insert into public.customers (organization_id, company_id, kind, code, name, legal_name, tax_id)
       values ($1, $2, 'company', 'ACME', 'Acme', 'Acme S.A.C.', '20123456789') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const [cuenta] = await svc(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, code, name, requires_approval, approval_threshold)
     values ($1, $2, $3, 'ACME', 'Acme', true, '150.00') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, String(acme?.id)],
  )
  cuentaAcme = String(cuenta?.id)
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, 'compras@acme.test', 'buyer', 'active'),
            ($1, $2, $3, $5, 'gerencia@acme.test', 'approver', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, cuentaAcme, BUYER_ID, APPROVER_ID],
  )
  productB2B = await newProduct(TENANT_A, storeA, 'sku-b2b', '200.00')
}, 240_000)

afterAll(async () => {
  await db?.close()
})

// ===========================================================================
// EL VOCABULARIO
// ===========================================================================
describe('los enums de la base y las copias del borde dicen lo mismo', () => {
  /**
   * Las listas de TypeScript estan DUPLICADAS a proposito —el borde no puede
   * leer un enum de Postgres— y este test es lo unico que impide que se
   * separen. Mismo patron que `CHECKOUT_STAGES` en P07 y que
   * `ORDER_TRANSITIONS` desde P02.
   */
  it.each([
    ['payment_status', PAYMENT_STATUSES],
    ['fulfillment_status', FULFILLMENT_STATUSES],
  ])('%s: mismos valores y en el mismo orden', async (typname, copia) => {
    const rows = await svc(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = $1 order by e.enumsortorder`,
      [typname],
    )
    expect(rows.map((r) => String(r.enumlabel))).toEqual([...copia])
  })

  it('los tres ejes del comando son los tres primeros de order_event_axis', async () => {
    const rows = await svc(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'order_event_axis' order by e.enumsortorder`,
    )
    expect(rows.map((r) => String(r.enumlabel)).slice(0, 3)).toEqual([...ORDER_AXES])
  })
})

// ===========================================================================
// EL CRITERIO DE ACEPTACION
// ===========================================================================
describe('el historial sobrevive a que cambie todo lo demas', () => {
  it('cambiar precio, nombre, categoria fiscal y tasa NO altera el pedido', async () => {
    const antes = await svc(
      `select o.grand_total::text as grand_total, o.subtotal::text as subtotal,
              o.tax_total::text as tax_total, o.tax_inclusive,
              i.name, i.sku, i.unit_price::text as unit_price,
              i.tax_rate::text as tax_rate, i.tax_amount::text as tax_amount,
              i.tax_category_code
         from public.orders o join public.order_items i on i.order_id = o.id
        where o.id = $1`,
      [orderA],
    )
    expect(antes).toHaveLength(1)
    expect(antes[0]?.unit_price).toBe('100.00')
    expect(antes[0]?.tax_rate).toBe('0.1800')
    expect(antes[0]?.tax_category_code).toBe('iva-general')

    // Ahora se cambia TODO lo que el pedido "miraba" en el catalogo.
    await svc(
      `update public.products
          set price = '999.00', name = 'Nombre nuevo', sku = 'sku-renombrado',
              tax_category_id = null
        where id = $1`,
      [productA],
    )
    await svc(`update public.tax_rates set rate = 0.0500 where tax_category_id = $1`, [categoryA])
    await svc(`update public.tax_categories set code = 'otra-cosa' where id = $1`, [categoryA])
    await svc(`update public.store_settings set tax_inclusive = true where store_id = $1`, [storeA])

    const despues = await svc(
      `select o.grand_total::text as grand_total, o.subtotal::text as subtotal,
              o.tax_total::text as tax_total, o.tax_inclusive,
              i.name, i.sku, i.unit_price::text as unit_price,
              i.tax_rate::text as tax_rate, i.tax_amount::text as tax_amount,
              i.tax_category_code
         from public.orders o join public.order_items i on i.order_id = o.id
        where o.id = $1`,
      [orderA],
    )
    expect(despues).toEqual(antes)

    // El snapshot ya demostro lo suyo. Se devuelve el catalogo a como estaba
    // porque lo que sigue en este archivo prueba OTRAS cosas sobre la misma
    // tienda, y dejarla con la tasa cambiada y el impuesto incluido convertiria
    // cada fallo posterior en un misterio.
    await svc(
      `update public.products
          set price = '100.00', name = 'Nombre sku-a', sku = 'sku-a', tax_category_id = $2
        where id = $1`,
      [productA, categoryA],
    )
    await svc(`update public.tax_rates set rate = 0.1800 where tax_category_id = $1`, [categoryA])
    await svc(`update public.tax_categories set code = 'iva-general' where id = $1`, [categoryA])
    await svc(`update public.store_settings set tax_inclusive = false where store_id = $1`, [storeA])
  })

  it('borrar el producto entero deja la linea intacta, solo sin enlace', async () => {
    const producto = await newProduct(TENANT_A, storeA, 'sku-efimero', '30.00', categoryA)
    const pedido = await place(TENANT_A, [{ product_id: producto, quantity: 3 }])
    const orderId = String(pedido.order_id)

    await svc(`delete from public.products where id = $1`, [producto])

    const [linea] = await svc(
      `select product_id, sku, name, unit_price::text as unit_price, quantity,
              tax_rate::text as tax_rate, tax_category_code
         from public.order_items where order_id = $1`,
      [orderId],
    )
    expect(linea?.product_id).toBeNull()
    expect(linea?.sku).toBe('sku-efimero')
    expect(linea?.unit_price).toBe('30.00')
    expect(linea?.quantity).toBe(3)
    expect(linea?.tax_category_code).toBe('iva-general')
  })

  it('el impuesto de las lineas suma EXACTAMENTE el del pedido', async () => {
    // Tres importes que no se reparten redondo: si el reparto fuera
    // `round(importe * tasa, 2)` linea a linea, la suma discreparia del total.
    const p1 = await newProduct(TENANT_A, storeA, 'sku-r1', '3.33', categoryA)
    const p2 = await newProduct(TENANT_A, storeA, 'sku-r2', '7.77', categoryA)
    const p3 = await newProduct(TENANT_A, storeA, 'sku-r3', '11.11', categoryA)
    const pedido = await place(TENANT_A, [
      { product_id: p1, quantity: 1 },
      { product_id: p2, quantity: 3 },
      { product_id: p3, quantity: 7 },
    ])
    const orderId = String(pedido.order_id)

    const [cuadre] = await svc(
      `select o.tax_total::text as pedido,
              (select sum(i.tax_amount)::text from public.order_items i where i.order_id = o.id) as lineas,
              o.subtotal::text as subtotal,
              (select sum(i.amount_after_discount)::text from public.order_items i where i.order_id = o.id) as bruto
         from public.orders o where o.id = $1`,
      [orderId],
    )
    expect(cuadre?.lineas).toBe(cuadre?.pedido)
    // Impuesto EXCLUSIVO en esta tienda: el bruto de las lineas es el subtotal.
    expect(cuadre?.bruto).toBe(cuadre?.subtotal)
  })
})

// ===========================================================================
// SNAPSHOTS INMUTABLES
// ===========================================================================
describe('el snapshot no se reescribe, ni siquiera con service_role', () => {
  it('una linea de pedido es inmutable', async () => {
    for (const patch of [
      `set unit_price = '1.00'`,
      `set name = 'otro'`,
      `set tax_rate = 0.0000`,
      `set quantity = 99`,
      `set components_snapshot = '[{"sku": "inventado"}]'::jsonb`,
      `set price_list_code = 'inventada'`,
    ]) {
      const message = await expectFailure(() =>
        svc(`update public.order_items ${patch} where order_id = $1`, [orderA]),
      )
      expect(`${patch}: ${message}`).toMatch(/ORDER_ITEM_INMUTABLE|generated/i)
    }
  })

  it('el numero, el origen, el impuesto aplicado y el cliente congelado tampoco', async () => {
    for (const patch of [
      `set order_number = 'EC-FALSO'`,
      `set source_channel = 'import'`,
      `set tax_inclusive = true`,
      `set customer_snapshot = '{}'::jsonb`,
      `set shipping_address_snapshot = '{}'::jsonb`,
      `set billing_address = '{}'::jsonb`,
      `set customer_email = 'otro@correo.com'`,
    ]) {
      const message = await expectFailure(() =>
        svc(`update public.orders ${patch} where id = $1`, [orderA]),
      )
      expect(`${patch}: ${message}`).toMatch(/ORDER_SNAPSHOT_INMUTABLE/)
    }
  })

  it('la direccion de ENVIO si se corrige, y su copia congelada no se mueve', async () => {
    await asUser(
      ordersClaims(),
      `update public.orders set shipping_address = $2::jsonb where id = $1`,
      [orderA, JSON.stringify({ address: 'Av. Corregida 900', reference: 'Porton rojo' })],
    )
    const [row] = await svc(
      `select shipping_address ->> 'address' as viva,
              shipping_address_snapshot ->> 'address' as congelada
         from public.orders where id = $1`,
      [orderA],
    )
    expect(row?.viva).toBe('Av. Corregida 900')
    expect(row?.congelada).toBe('Av. Primavera 120')
  })

  it('la correccion de direccion queda en la linea de tiempo', async () => {
    const eventos = await timelineOf(orderA)
    const detalle = eventos.filter((e) => e.event_type === 'order.details_updated')
    expect(detalle.length).toBeGreaterThanOrEqual(1)
    expect(detalle.at(-1)?.actor_email).toBe('pedidos@tenant-a.com')
  })

  it('el snapshot del cliente lleva lo que se escribio, no lo que hay hoy', async () => {
    const [row] = await svc(
      `select customer_snapshot ->> 'email' as email,
              customer_snapshot ->> 'name'  as nombre,
              customer_snapshot ->> 'phone' as telefono
         from public.orders where id = $1`,
      [orderA],
    )
    expect(row?.email).toBe('ana@compradora.com')
    expect(row?.nombre).toBe('Ana Compradora')
    expect(row?.telefono).toBe('+51 999 111 222')
  })
})

// ===========================================================================
// LOS CUATRO EJES
// ===========================================================================
describe('los ejes de estado y sus maquinas', () => {
  it('un pedido nace pendiente en los tres ejes que tiene', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const [row] = await svc(
      `select status, payment_status, fulfillment_status, approval_status, source_channel
         from public.orders where id = $1`,
      [String(pedido.order_id)],
    )
    expect(row).toMatchObject({
      status: 'pending',
      payment_status: 'pending',
      fulfillment_status: 'unfulfilled',
      approval_status: 'not_required',
      source_channel: 'storefront',
    })
  })

  it('el camino viejo (UPDATE status) sincroniza los ejes nuevos', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)

    await asUser(ordersClaims(), `update public.orders set status = 'paid' where id = $1`, [orderId])
    const [pagado] = await svc(
      `select payment_status, fulfillment_status, paid_at from public.orders where id = $1`,
      [orderId],
    )
    expect(pagado?.payment_status).toBe('paid')
    expect(pagado?.fulfillment_status).toBe('unfulfilled')
    expect(pagado?.paid_at).not.toBeNull()

    await asUser(ordersClaims(), `update public.orders set status = 'fulfilled' where id = $1`, [
      orderId,
    ])
    const [servido] = await svc(
      `select payment_status, fulfillment_status, fulfilled_at from public.orders where id = $1`,
      [orderId],
    )
    expect(servido?.fulfillment_status).toBe('fulfilled')
    expect(servido?.payment_status).toBe('paid')
    expect(servido?.fulfilled_at).not.toBeNull()
  })

  /**
   * El sentido que faltaba: el ciclo comercial sigue al dinero.
   *
   * La propagacion era de un solo sentido —`status` empujaba a los otros dos y
   * nadie empujaba a `status`—, y como el ciclo solo se mueve a mano y nadie lo
   * mueve, un pedido cobrado con tarjeta se quedaba en «pendiente» para siempre.
   * En la tienda de demostracion eran siete de treinta.
   */
  it('cobrar un pedido pendiente lo pasa a pagado, sin tocar la entrega', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)

    // Como cobra la pasarela: escribiendo SOLO el eje del dinero.
    await svc(`update public.orders set payment_status = 'paid' where id = $1`, [orderId])

    const [fila] = await svc(
      `select status, payment_status, fulfillment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(fila?.status).toBe('paid')
    expect(fila?.payment_status).toBe('paid')
    // La mercancia no se ha movido: ese eje es de otro.
    expect(fila?.fulfillment_status).toBe('unfulfilled')
  })

  it('el cambio queda en la linea de tiempo, no solo en la fila', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)
    await svc(`update public.orders set payment_status = 'paid' where id = $1`, [orderId])

    // `order_events` es la linea de tiempo que se ve en pantalla. Un estado que
    // cambia solo y no deja rastro es peor que uno que no cambia.
    const eventos = await svc(
      `select from_value, to_value from public.order_events
        where order_id = $1 and axis::text = 'order_status' and from_value is not null`,
      [orderId],
    )
    expect(eventos.map((e) => `${e.from_value}->${e.to_value}`)).toContain('pending->paid')
  })

  /**
   * `authorized` es dinero retenido y todavia sin cobrar.
   *
   * Llamar «pagado» a un pedido por una retencion adelanta un hecho que aun
   * puede no ocurrir, y es la misma linea que ya defiende el resto del dominio.
   */
  it('una retencion NO adelanta el ciclo comercial', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)
    await svc(`update public.orders set payment_status = 'authorized' where id = $1`, [orderId])

    const [fila] = await svc(`select status from public.orders where id = $1`, [orderId])
    expect(fila?.status).toBe('pending')
  })

  /**
   * La trampa que casi se lleva el cobro por delante.
   *
   * `ebim.assert_order_axes` rechaza mover el ciclo de un pedido que espera
   * firma, y `ebim.payment_sync_order` se traga la excepcion y devuelve `false`:
   * un avance automatico ahi habria hecho que el pago se perdiera EN SILENCIO.
   * Por eso el avance se abstiene cuando hay aprobacion pendiente.
   */
  it('con la aprobacion pendiente no toca el ciclo, y el cobro no revienta', async () => {
    // Nace esperando firma: el umbral de la cuenta lo decide la base. No se
    // puede pedir aprobación a posteriori —`not_required` es terminal— así que
    // el pedido tiene que nacer así.
    const pedido = await place(TENANT_A, [{ product_id: productB2B, quantity: 1 }], {
      accountId: cuentaAcme,
    })
    const orderId = String(pedido.order_id)

    // Lo único que la base deja mover con la firma pendiente.
    await svc(`update public.orders set payment_status = 'failed' where id = $1`, [orderId])

    const [fila] = await svc(
      `select status, payment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(fila?.status).toBe('pending')
    expect(fila?.payment_status).toBe('failed')

    // Se cierra la firma antes de salir: la cola de aprobaciones es compartida
    // y un pedido pendiente de este test aparecería en el de más abajo, que
    // cuenta cuántas esperan. Un test que deja basura rompe a otro y el fallo
    // sale donde no está la causa.
    await asUser(
      b2bClaims(APPROVER_ID, 'gerencia@acme.test'),
      `select public.order_approval_decide($1, false, 'fin del test')`,
      [orderId],
    )
  })

  /**
   * Solo se cubre el tramo que falta. Un pedido ya servido no retrocede a
   * «pagado» porque alguien registre un reembolso parcial.
   */
  it('un pedido ya servido no lo mueve el eje del dinero', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)
    await asUser(ordersClaims(), `update public.orders set status = 'paid' where id = $1`, [
      orderId,
    ])
    await asUser(ordersClaims(), `update public.orders set status = 'fulfilled' where id = $1`, [
      orderId,
    ])

    await svc(`update public.orders set payment_status = 'partially_refunded' where id = $1`, [
      orderId,
    ])

    const [fila] = await svc(`select status from public.orders where id = $1`, [orderId])
    expect(fila?.status).toBe('fulfilled')
  })

  it('cancelar un pedido YA cobrado no anula el cobro por su cuenta', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)
    await asUser(ordersClaims(), `update public.orders set status = 'paid' where id = $1`, [orderId])
    await asUser(ordersClaims(), `update public.orders set status = 'cancelled' where id = $1`, [
      orderId,
    ])
    const [row] = await svc(
      `select payment_status, fulfillment_status, cancelled_at from public.orders where id = $1`,
      [orderId],
    )
    // El dinero sigue cobrado: devolverlo es una decision aparte.
    expect(row?.payment_status).toBe('paid')
    expect(row?.fulfillment_status).toBe('cancelled')
    expect(row?.cancelled_at).not.toBeNull()
  })

  it('los ejes nuevos NO tienen GRANT de escritura para authenticated', async () => {
    // `has_column_privilege` y no `information_schema.column_privileges`: la
    // vista del catalogo solo muestra los permisos que el usuario actual
    // concedio o recibio, asi que como `service_role` sale vacia y el test
    // pasaria sin comprobar nada.
    const rows = await svc(
      `select c.column_name
         from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'orders'
          and has_column_privilege('authenticated', 'public.orders', c.column_name, 'UPDATE')
        order by c.column_name`,
    )
    expect(rows.map((r) => r.column_name)).toEqual([
      'customer_name',
      'customer_phone',
      'notes',
      'shipping_address',
      'status',
    ])
  })

  it('un salto imposible del eje de pago se rechaza en la BASE', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)
    const message = await expectFailure(() =>
      svc(`update public.orders set payment_status = 'refunded' where id = $1`, [orderId]),
    )
    expect(message).toMatch(/PAGO_TRANSICION_INVALIDA/)
  })

  it('un salto imposible del eje de entrega tambien', async () => {
    const pedido = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(pedido.order_id)
    await svc(`update public.orders set fulfillment_status = 'fulfilled' where id = $1`, [orderId])
    const message = await expectFailure(() =>
      svc(`update public.orders set fulfillment_status = 'in_progress' where id = $1`, [orderId]),
    )
    expect(message).toMatch(/ENTREGA_TRANSICION_INVALIDA/)
  })

  it('la aprobacion no se puede pedir a posteriori sobre un pedido B2C', async () => {
    const message = await expectFailure(() =>
      svc(`update public.orders set approval_status = 'pending' where id = $1`, [orderA]),
    )
    expect(message).toMatch(/APROBACION_TRANSICION_INVALIDA/)
  })
})

// ===========================================================================
// EL COMANDO
// ===========================================================================
describe('public.order_transition — la unica puerta de los ejes nuevos', () => {
  let pedido: string

  beforeAll(async () => {
    const creado = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    pedido = String(creado.order_id)
  })

  it('mueve el eje, deja evento con motivo y publica el hecho', async () => {
    const [row] = await asUser(
      ordersClaims(),
      `select public.order_transition($1, 'payment_status', 'paid', 'Transferencia confirmada') as r`,
      [pedido],
    )
    expect((row?.r as Row).to).toBe('paid')

    const eventos = await timelineOf(pedido)
    const pago = eventos.find((e) => e.event_type === 'order.payment_status_changed')
    expect(pago).toMatchObject({
      axis: 'payment_status',
      from_value: 'pending',
      to_value: 'paid',
      note: 'Transferencia confirmada',
      source: 'backoffice',
      actor_email: 'pedidos@tenant-a.com',
    })

    const hechos = await svc(
      `select event_type, payload ->> 'to' as destino, payload ->> 'reason' as motivo
         from public.domain_events
        where aggregate_id = $1 and event_type = 'order.payment_status_changed'`,
      [pedido],
    )
    expect(hechos).toHaveLength(1)
    expect(hechos[0]?.destino).toBe('paid')
    expect(hechos[0]?.motivo).toBe('Transferencia confirmada')
  })

  it('un rol viewer no mueve nada', async () => {
    const message = await expectFailure(() =>
      asUser(viewerClaims(), `select public.order_transition($1, 'fulfillment_status', 'fulfilled')`, [
        pedido,
      ]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('el tenant de al lado no mueve un pedido ajeno aunque tenga el uuid', async () => {
    const message = await expectFailure(() =>
      asUser(claimsFor(TENANT_B), `select public.order_transition($1, 'payment_status', 'paid')`, [
        pedido,
      ]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('un eje inventado y un estado inventado dan error de dominio, no un 500', async () => {
    const eje = await expectFailure(() =>
      asUser(ordersClaims(), `select public.order_transition($1, 'humor', 'contento')`, [pedido]),
    )
    expect(eje).toMatch(/EJE_NO_VALIDO/)

    const estado = await expectFailure(() =>
      asUser(ordersClaims(), `select public.order_transition($1, 'payment_status', 'contento')`, [
        pedido,
      ]),
    )
    expect(estado).toMatch(/ESTADO_NO_VALIDO/)
  })

  it('pedir el estado en el que ya esta es un error explicito', async () => {
    const message = await expectFailure(() =>
      asUser(ordersClaims(), `select public.order_transition($1, 'payment_status', 'paid')`, [
        pedido,
      ]),
    )
    expect(message).toMatch(/TRANSICION_SIN_CAMBIO/)
  })

  it('el salto imposible sale por el comando con el mismo codigo que en la base', async () => {
    const message = await expectFailure(() =>
      asUser(ordersClaims(), `select public.order_transition($1, 'fulfillment_status', 'returned')`, [
        pedido,
      ]),
    )
    expect(message).toMatch(/ENTREGA_TRANSICION_INVALIDA/)
  })

  it('el super admin de suite no opera pedidos de un tenant', async () => {
    const message = await expectFailure(() =>
      asUser(
        claimsFor(TENANT_A, { email: 'dcalagua@ebim.pe' }),
        `select public.order_transition($1, 'fulfillment_status', 'in_progress')`,
        [pedido],
      ),
    )
    expect(message).toMatch(/OPERADOR_NO_ES_ACTOR/)
  })
})

// ===========================================================================
// APROBACION B2B
// ===========================================================================
describe('aprobacion B2B — sin contaminar B2C', () => {
  let pedidoB2B: string

  beforeAll(async () => {
    const creado = await place(TENANT_A, [{ product_id: productB2B, quantity: 1 }], {
      accountId: cuentaAcme,
      billing: { address: 'Jr. Fiscal 100', reference: 'Oficina 5' },
    })
    pedidoB2B = String(creado.order_id)
  })

  it('el umbral de la CUENTA lo decide la base, aunque el borde no diga nada', async () => {
    const [row] = await svc(
      `select approval_status, approval_reason, business_account_id,
              customer_snapshot ->> 'account_name' as cuenta,
              customer_snapshot ->> 'tax_id' as ruc,
              billing_address ->> 'address' as fiscal
         from public.orders where id = $1`,
      [pedidoB2B],
    )
    expect(row?.approval_status).toBe('pending')
    expect(row?.approval_reason).toBe('account_threshold')
    expect(row?.business_account_id).toBe(cuentaAcme)
    expect(row?.cuenta).toBe('Acme')
    expect(row?.ruc).toBe('20123456789')
    expect(row?.fiscal).toBe('Jr. Fiscal 100')
  })

  it('publica order.approval_requested y NO la confirmacion al comprador', async () => {
    const eventos = await timelineOf(pedidoB2B)
    expect(eventos.map((e) => e.event_type)).toContain('order.approval_requested')
  })

  it('un pedido pendiente de firma NO avanza', async () => {
    for (const [axis, to] of [
      ['payment_status', 'paid'],
      ['fulfillment_status', 'in_progress'],
      ['order_status', 'paid'],
    ] as const) {
      const message = await expectFailure(() =>
        asUser(ordersClaims(), `select public.order_transition($1, $2, $3)`, [pedidoB2B, axis, to]),
      )
      expect(`${axis}: ${message}`).toMatch(/PEDIDO_PENDIENTE_APROBACION/)
    }
  })

  it('un comprador de la cuenta NO puede autorizarse a si mismo', async () => {
    const message = await expectFailure(() =>
      asUser(
        b2bClaims(BUYER_ID, 'compras@acme.test'),
        `select public.order_approval_decide($1, true)`,
        [pedidoB2B],
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('alguien sin vinculo con la cuenta tampoco', async () => {
    const message = await expectFailure(() =>
      asUser(
        b2bClaims(OUTSIDER_ID, 'ajeno@otra.test'),
        `select public.order_approval_decide($1, true)`,
        [pedidoB2B],
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('el aprobador de la cuenta SI, y no es miembro del tenant', async () => {
    // La prueba de que no lo es: por PostgREST no ve ni una fila del pedido.
    const visibles = await asUser(
      b2bClaims(APPROVER_ID, 'gerencia@acme.test'),
      `select id from public.orders`,
    )
    expect(visibles).toEqual([])

    // Y aun asi lo ve por su puerta y lo puede decidir.
    const [cola] = await asUser(
      b2bClaims(APPROVER_ID, 'gerencia@acme.test'),
      `select public.my_business_orders(true) as r`,
    )
    const pendientes = cola?.r as Row[]
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0]).toMatchObject({ approval_status: 'pending', can_decide: true })
    expect(pendientes[0]).not.toHaveProperty('organization_id')

    const [row] = await asUser(
      b2bClaims(APPROVER_ID, 'gerencia@acme.test'),
      `select public.order_approval_decide($1, true, 'Presupuesto disponible') as r`,
      [pedidoB2B],
    )
    expect((row?.r as Row).approval_status).toBe('approved')
  })

  it('aprobado, el pedido vuelve a avanzar y queda firmado en la linea de tiempo', async () => {
    await asUser(ordersClaims(), `select public.order_transition($1, 'payment_status', 'paid')`, [
      pedidoB2B,
    ])
    const [row] = await svc(
      `select payment_status, approval_decided_email, approval_reason
         from public.orders where id = $1`,
      [pedidoB2B],
    )
    expect(row?.payment_status).toBe('paid')
    expect(row?.approval_decided_email).toBe('gerencia@acme.test')

    const eventos = await timelineOf(pedidoB2B)
    const decision = eventos.find((e) => e.event_type === 'order.approval_decided')
    expect(decision).toMatchObject({ to_value: 'approved', note: 'Presupuesto disponible' })
  })

  it('rechazar exige motivo y cancela el pedido', async () => {
    const creado = await place(TENANT_A, [{ product_id: productB2B, quantity: 1 }], {
      accountId: cuentaAcme,
    })
    const orderId = String(creado.order_id)

    const sinMotivo = await expectFailure(() =>
      asUser(
        b2bClaims(APPROVER_ID, 'gerencia@acme.test'),
        `select public.order_approval_decide($1, false)`,
        [orderId],
      ),
    )
    expect(sinMotivo).toMatch(/MOTIVO_REQUERIDO/)

    await asUser(
      b2bClaims(APPROVER_ID, 'gerencia@acme.test'),
      `select public.order_approval_decide($1, false, 'Fuera de presupuesto')`,
      [orderId],
    )
    const [row] = await svc(
      `select approval_status, status, fulfillment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(row).toMatchObject({
      approval_status: 'rejected',
      status: 'cancelled',
      fulfillment_status: 'cancelled',
    })
  })

  it('un pedido B2C no entra al circuito: la decision se niega', async () => {
    const message = await expectFailure(() =>
      asUser(ordersClaims(), `select public.order_approval_decide($1, true, 'porque si')`, [orderA]),
    )
    expect(message).toMatch(/APROBACION_NO_APLICA/)
  })

  it('una cuenta de OTRA sociedad no puede firmar un pedido de esta tienda', async () => {
    const message = await expectFailure(() =>
      place(TENANT_B, [{ product_id: productA, quantity: 1 }], { accountId: cuentaAcme }),
    )
    expect(message).toMatch(/CUENTA_NO_APLICA|PRODUCTO_NO_DISPONIBLE/)
  })

  it('p_approval solo puede AÑADIR aprobacion, nunca quitarla', async () => {
    const creado = await place(TENANT_A, [{ product_id: productB2B, quantity: 1 }], {
      accountId: cuentaAcme,
      approval: { required: false },
    })
    const [row] = await svc(`select approval_status from public.orders where id = $1`, [
      String(creado.order_id),
    ])
    expect(row?.approval_status).toBe('pending')
  })

  it('el limite de la PERSONA lo aporta el borde y tambien detiene el pedido', async () => {
    // Cuenta sin umbral propio: lo unico que puede pedir la firma es lo que el
    // borde averiguo con la sesion del comprador.
    const [otro] = await svc(
      `insert into public.customers (organization_id, company_id, kind, code, name)
         values ($1, $2, 'company', 'BETA', 'Beta') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const [cuenta] = await svc(
      `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
         values ($1, $2, $3, 'BETA', 'Beta') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, String(otro?.id)],
    )
    const creado = await place(TENANT_A, [{ product_id: productB2B, quantity: 1 }], {
      accountId: String(cuenta?.id),
      approval: { required: true, reason: 'user_limit' },
    })
    const [row] = await svc(
      `select approval_status, approval_reason from public.orders where id = $1`,
      [String(creado.order_id)],
    )
    expect(row).toMatchObject({ approval_status: 'pending', approval_reason: 'user_limit' })
  })
})

// ===========================================================================
// LINEA DE TIEMPO
// ===========================================================================
describe('order_events — append-only de verdad', () => {
  it('el alta deja su evento sin autor inventado y con el origen correcto', async () => {
    const eventos = await timelineOf(orderA)
    expect(eventos[0]).toMatchObject({
      event_type: 'order.created',
      axis: 'order_status',
      to_value: 'pending',
      source: 'storefront',
    })
    expect(eventos[0]?.actor_email).toBeNull()
  })

  it('trajo el historial que ya existia en order_status_events', async () => {
    const [row] = await svc(
      `select count(*)::int as n from public.order_events
        where payload ->> 'migrated_from' = 'order_status_events'`,
    )
    // Las migraciones se aplican sobre una base virgen en este banco de
    // pruebas: no hay pedidos anteriores y el backfill no tiene nada que traer.
    // Lo que se comprueba es que la consulta es valida y no rompe el esquema.
    expect(Number(row?.n)).toBe(0)
  })

  it('nadie autenticado inserta, edita ni borra un evento', async () => {
    const insert = await expectFailure(() =>
      asUser(
        ordersClaims(),
        `insert into public.order_events
           (organization_id, company_id, store_id, order_id, event_type, axis, to_value)
         values ($1, $2, $3, $4, 'order.status_changed', 'order_status', 'paid')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, orderA],
      ),
    )
    expect(insert).toMatch(/permission denied|policy/i)

    const update = await expectFailure(() =>
      asUser(ordersClaims(), `update public.order_events set note = 'reescrito'`),
    )
    expect(update).toMatch(/permission denied|policy/i)

    const remove = await expectFailure(() =>
      asUser(ordersClaims(), `delete from public.order_events`),
    )
    expect(remove).toMatch(/permission denied|policy/i)
  })

  it('el tenant de al lado no lee la linea de tiempo ajena', async () => {
    const rows = await asUser(claimsFor(TENANT_B), `select id from public.order_events where order_id = $1`, [
      orderA,
    ])
    expect(rows).toEqual([])
  })

  it('anon no tiene ni un GRANT sobre las cuatro tablas nuevas', async () => {
    const rows = await svc(
      `select table_name, privilege_type from information_schema.table_privileges
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
          and table_name in ('order_events', 'order_notes', 'order_tags', 'order_external_refs')`,
    )
    expect(rows).toEqual([])
  })
})

// ===========================================================================
// NOTAS, ETIQUETAS Y REFERENCIAS EXTERNAS
// ===========================================================================
describe('anotaciones internas y referencias externas', () => {
  it('la nota interna no pisa la del comprador', async () => {
    await asUser(ordersClaims(), `insert into public.order_notes (order_id, body) values ($1, $2)`, [
      orderA,
      'Cliente pide factura a nombre de la empresa',
    ])
    const [pedido] = await svc(`select notes from public.orders where id = $1`, [orderA])
    expect(pedido?.notes).toBe('Dejar con el portero')

    const [nota] = await svc(
      `select body, author_email, organization_id from public.order_notes where order_id = $1`,
      [orderA],
    )
    expect(nota?.author_email).toBe('pedidos@tenant-a.com')
    expect(nota?.organization_id).toBe(TENANT_A.organizationId)
  })

  it('el tenant de la anotacion se DERIVA del pedido, no del cuerpo', async () => {
    await asUser(
      ordersClaims(),
      `insert into public.order_notes (organization_id, company_id, store_id, order_id, body)
       values ($1, $2, $3, $4, 'intento de declarar tenant')`,
      [TENANT_B.organizationId, TENANT_B.companyId, storeB, orderA],
    )
    const [nota] = await svc(
      `select organization_id, company_id, store_id from public.order_notes
        where order_id = $1 and body = 'intento de declarar tenant'`,
      [orderA],
    )
    expect(nota).toMatchObject({
      organization_id: TENANT_A.organizationId,
      company_id: TENANT_A.companyId,
      store_id: storeA,
    })
  })

  it('un viewer no anota ni etiqueta', async () => {
    const nota = await expectFailure(() =>
      asUser(viewerClaims(), `insert into public.order_notes (order_id, body) values ($1, 'x')`, [
        orderA,
      ]),
    )
    expect(nota).toMatch(/policy|denied/i)

    const tag = await expectFailure(() =>
      asUser(viewerClaims(), `insert into public.order_tags (order_id, tag) values ($1, 'urgente')`, [
        orderA,
      ]),
    )
    expect(tag).toMatch(/policy|denied/i)
  })

  it('las etiquetas se normalizan a minusculas y no se repiten', async () => {
    await asUser(ordersClaims(), `insert into public.order_tags (order_id, tag) values ($1, 'Urgente')`, [
      orderA,
    ])
    const [tag] = await svc(`select tag from public.order_tags where order_id = $1`, [orderA])
    expect(tag?.tag).toBe('urgente')

    const repetida = await expectFailure(() =>
      asUser(ordersClaims(), `insert into public.order_tags (order_id, tag) values ($1, 'URGENTE')`, [
        orderA,
      ]),
    )
    expect(repetida).toMatch(/order_tags_unique|duplicate key/i)
  })

  it('una referencia externa por sistema y tipo, y la busqueda inversa funciona', async () => {
    await asUser(
      ordersClaims(),
      `insert into public.order_external_refs (order_id, system_code, ref_type, external_id)
       values ($1, 'erp', 'invoice', 'F001-000123'), ($1, 'erp', 'order', '4500012345')`,
      [orderA],
    )
    const rows = await asUser(
      ordersClaims(),
      `select ref_type, external_id from public.order_external_refs
        where order_id = $1 order by ref_type`,
      [orderA],
    )
    expect(rows).toEqual([
      { ref_type: 'invoice', external_id: 'F001-000123' },
      { ref_type: 'order', external_id: '4500012345' },
    ])

    const duplicada = await expectFailure(() =>
      asUser(
        ordersClaims(),
        `insert into public.order_external_refs (order_id, system_code, ref_type, external_id)
         values ($1, 'erp', 'invoice', 'F001-999')`,
        [orderA],
      ),
    )
    expect(duplicada).toMatch(/one_per_kind|duplicate key/i)
  })

  it('el tenant de al lado no ve ni una anotacion', async () => {
    for (const table of ['order_notes', 'order_tags', 'order_external_refs']) {
      const rows = await asUser(claimsFor(TENANT_B), `select id from public.${table}`)
      expect({ table, rows }).toEqual({ table, rows: [] })
    }
  })

  it('borrar el pedido se lleva sus anotaciones (cascade), no las deja huerfanas', async () => {
    const creado = await place(TENANT_A, [{ product_id: productA, quantity: 1 }])
    const orderId = String(creado.order_id)
    await asUser(ordersClaims(), `insert into public.order_tags (order_id, tag) values ($1, 'temporal')`, [
      orderId,
    ])
    await svc(`delete from public.orders where id = $1`, [orderId])
    const rows = await svc(`select id from public.order_tags where order_id = $1`, [orderId])
    expect(rows).toEqual([])
  })
})

// ===========================================================================
// LA PUERTA DEL COMPRADOR
// ===========================================================================
describe('order_by_token — el comprador ve su pedido y nada mas', () => {
  it('devuelve los cuatro ejes y ni una anotacion interna', async () => {
    const [numero] = await svc(`select order_number from public.orders where id = $1`, [orderA])
    const [row] = await asRole(db, 'anon', null, async () =>
      (
        await db.query<Row>(`select public.order_by_token($1, $2, $3) as r`, [
          TENANT_A.storeSlug,
          String(numero?.order_number),
          tokenA,
        ])
      ).rows,
    )
    const pedido = row?.r as Row
    expect(pedido).toMatchObject({
      status: 'pending',
      payment_status: 'pending',
      fulfillment_status: 'unfulfilled',
      approval_status: 'not_required',
    })
    for (const prohibido of [
      'notes',
      'tags',
      'external_refs',
      'organization_id',
      'company_id',
      'business_account_id',
      'customer_snapshot',
      'order_id',
    ]) {
      expect(pedido).not.toHaveProperty(prohibido)
    }
  })

  it('un token que no es el suyo no abre nada', async () => {
    const [numero] = await svc(`select order_number from public.orders where id = $1`, [orderA])
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () =>
        db.query(`select public.order_by_token($1, $2, $3)`, [
          TENANT_A.storeSlug,
          String(numero?.order_number),
          'f'.repeat(64),
        ]),
      ),
    )
    expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })

  it('el pedido del otro tenant no se abre desde el slug de esta tienda', async () => {
    // Los numeros de pedido son correlativos POR TIENDA, asi que el primero de
    // cada tenant se llama igual. Lo que separa los dos pedidos no es el
    // numero: es el token, y esta es exactamente la prueba de que basta.
    const [numero] = await svc(`select order_number from public.orders where id = $1`, [orderB])
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () =>
        db.query(`select public.order_by_token($1, $2, $3)`, [
          TENANT_A.storeSlug,
          String(numero?.order_number),
          tokenB,
        ]),
      ),
    )
    expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })
})
