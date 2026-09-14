// @vitest-environment node
/**
 * La cuenta del consumidor registrado (H02-H04), sobre Postgres real.
 *
 * Lo que no puede fallar:
 *  - un comprador ve SUS pedidos y ninguno más: ni los de otro usuario, ni los
 *    de invitado con su mismo correo, ni los de otra tienda u otro tenant;
 *  - el vínculo pedido↔usuario solo lo escribe el servidor, y no cambia de dueño;
 *  - el detalle devuelve los importes GUARDADOS, no una recotización;
 *  - ninguna función del comprador acepta una identidad por parámetro.
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

const ANA = '0e000000-0000-4000-8000-00000000a001'
const BETO = '0e000000-0000-4000-8000-00000000b001'

let db: PGlite
let productoA = ''
let productoB = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@consumidor.test`, org_id: '', companies: [], active_company: '' }
}

async function as<T = Row>(sub: string, query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'authenticated', shopper(sub), async () => (await db.query<T>(query, params)).rows)
}

async function bootstrap(tenant: typeof TENANT_A): Promise<{ store: string; product: string }> {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId,
    tenant.companyId,
    tenant.slug,
    tenant.adminEmail,
    tenant.ownerId,
    tenant.storeSlug,
  ])
  const [store] = await svc(`update public.stores set status = 'active' where slug = $1 returning id`, [
    tenant.storeSlug,
  ])
  const [product] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'JABON-1', 'jabon-1', 'Jabón', '12.50', 'PEN', 500, 'published', now())
     returning id`,
    [tenant.organizationId, tenant.companyId, store?.id],
  )
  return { store: String(store?.id), product: String(product?.id) }
}

/** Un pedido como lo crea el checkout. Devuelve su id. */
async function pedido(
  slug: string,
  product: string,
  email: string,
  address = 'Av. Primavera 120',
  quantity = 2,
): Promise<string> {
  await svc(`delete from public.checkout_attempts`)
  const [row] = await svc(
    `select public.create_order_for_slug(
        $1, $2, jsonb_build_array(jsonb_build_object('product_id', $3::text, 'quantity', $5::int)),
        'Ana Consumidora', '+51 999 111 222',
        jsonb_build_object('address', $4::text, 'city', 'Lima', 'country', 'PE'), null) as result`,
    [slug, email, product, address, quantity],
  )
  const result = row?.result as Row
  // El número es único POR TIENDA: dos tiendas empiezan por el mismo.
  const [order] = await svc(
    `select o.id from public.orders o join public.stores s on s.id = o.store_id
      where o.order_number = $1 and s.slug = $2`,
    [result.order_number, slug],
  )
  return String(order?.id)
}

async function vincular(orderId: string, userId: string): Promise<boolean> {
  const [row] = await svc<{ ok: boolean }>(
    `select public.checkout_link_order_buyer($1, $2) as ok`,
    [orderId, userId],
  )
  return row?.ok === true
}

async function misPedidos(sub: string, slug = TENANT_A.storeSlug): Promise<Row[]> {
  const [row] = await as<{ r: Row[] }>(sub, `select public.my_consumer_orders($1) as r`, [slug])
  return row?.r ?? []
}

let pedidoAna = ''
let pedidoAna2 = ''
let pedidoBeto = ''
let pedidoInvitadoConCorreoDeAna = ''
let pedidoAnaEnB = ''

beforeAll(async () => {
  db = await createTestDatabase()
  productoA = (await bootstrap(TENANT_A)).product
  productoB = (await bootstrap(TENANT_B)).product

  pedidoAna = await pedido(TENANT_A.storeSlug, productoA, `${ANA}@consumidor.test`, 'Av. Primavera 120', 2)
  pedidoAna2 = await pedido(TENANT_A.storeSlug, productoA, `${ANA}@consumidor.test`, 'Jr. Lampa 55', 1)
  pedidoBeto = await pedido(TENANT_A.storeSlug, productoA, `${BETO}@consumidor.test`)
  // Mismo correo que Ana, pero comprado SIN sesión: no se vincula.
  pedidoInvitadoConCorreoDeAna = await pedido(TENANT_A.storeSlug, productoA, `${ANA}@consumidor.test`, 'Calle Falsa 1')
  pedidoAnaEnB = await pedido(TENANT_B.storeSlug, productoB, `${ANA}@consumidor.test`)

  expect(await vincular(pedidoAna, ANA)).toBe(true)
  expect(await vincular(pedidoAna2, ANA)).toBe(true)
  expect(await vincular(pedidoBeto, BETO)).toBe(true)
  expect(await vincular(pedidoAnaEnB, ANA)).toBe(true)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('el vínculo lo escribe solo el servidor', () => {
  it('es idempotente para el mismo usuario', async () => {
    expect(await vincular(pedidoAna, ANA)).toBe(true)
    const [row] = await svc<{ n: number }>(
      `select count(*)::int as n from public.order_buyers where order_id = $1`,
      [pedidoAna],
    )
    expect(row?.n).toBe(1)
  })

  it('no cambia de dueño: el primero que vincula gana', async () => {
    expect(await vincular(pedidoAna, BETO)).toBe(false)
    const [row] = await svc<{ user_id: string }>(
      `select user_id from public.order_buyers where order_id = $1`,
      [pedidoAna],
    )
    expect(row?.user_id).toBe(ANA)
  })

  it('no vincula pedidos antiguos ni ids que no existen', async () => {
    const viejo = await pedido(TENANT_A.storeSlug, productoA, 'viejo@consumidor.test')
    // El pedido es inmutable por disparador; envejecerlo es preparación del
    // escenario, no algo que la aplicación pueda hacer, así que se hace como
    // superusuario y sin disparadores.
    await db.exec(`set session_replication_role = replica`)
    try {
      await db.query(`update public.orders set placed_at = now() - interval '2 days' where id = $1`, [viejo])
    } finally {
      await db.exec(`set session_replication_role = origin`)
    }
    expect(await vincular(viejo, ANA)).toBe(false)
    expect(await vincular('0f000000-0000-4000-8000-000000000000', ANA)).toBe(false)
  })

  it('`authenticated` no puede ejecutar la función de vínculo', async () => {
    const message = await expectFailure(() =>
      as(ANA, `select public.checkout_link_order_buyer($1, $2)`, [pedidoInvitadoConCorreoDeAna, ANA]),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('`authenticated` no puede escribir la tabla directamente', async () => {
    for (const sentencia of [
      [`insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id)
        select id, organization_id, company_id, store_id, $1 from public.orders where id = $2`, [ANA, pedidoInvitadoConCorreoDeAna]],
      [`update public.order_buyers set user_id = $1 where order_id = $2`, [ANA, pedidoBeto]],
      [`delete from public.order_buyers where order_id = $1`, [pedidoBeto]],
    ] as const) {
      const message = await expectFailure(() => as(ANA, sentencia[0], [...sentencia[1]]))
      expect(message).toMatch(/permission denied/i)
    }
  })

  it('`anon` no ve la tabla ni ejecuta ninguna de las funciones', async () => {
    for (const consulta of [
      `select * from public.order_buyers`,
      `select public.my_consumer_orders('${TENANT_A.storeSlug}')`,
      `select public.my_consumer_order_detail('${TENANT_A.storeSlug}', '${pedidoAna}')`,
      `select public.my_checkout_profile('${TENANT_A.storeSlug}')`,
      `select public.checkout_link_order_buyer('${pedidoAna}', '${ANA}')`,
    ]) {
      const message = await expectFailure(() =>
        asRole(db, 'anon', null, async () => (await db.query(consulta)).rows),
      )
      expect(message).toMatch(/permission denied/i)
    }
  })
})

describe('Mis pedidos', () => {
  it('Ana ve sus dos pedidos de esta tienda, el más reciente primero', async () => {
    const pedidos = await misPedidos(ANA)
    expect(pedidos.map((p) => p.order_id)).toEqual([pedidoAna2, pedidoAna])
    expect(pedidos[0]).toMatchObject({ currency: 'PEN', status: 'pending', item_count: 1 })
    expect(typeof pedidos[0]?.grand_total).toBe('string')
  })

  it('no ve el pedido de invitado hecho con su mismo correo', async () => {
    const ids = (await misPedidos(ANA)).map((p) => p.order_id)
    expect(ids).not.toContain(pedidoInvitadoConCorreoDeAna)
  })

  it('Beto ve solo el suyo', async () => {
    expect((await misPedidos(BETO)).map((p) => p.order_id)).toEqual([pedidoBeto])
  })

  it('en la tienda del otro tenant se ven solo los de ESA tienda', async () => {
    expect((await misPedidos(ANA, TENANT_B.storeSlug)).map((p) => p.order_id)).toEqual([pedidoAnaEnB])
    expect(await misPedidos(BETO, TENANT_B.storeSlug)).toEqual([])
  })

  it('una tienda suspendida deja de servir la lista', async () => {
    await svc(`update public.stores set status = 'suspended' where slug = $1`, [TENANT_B.storeSlug])
    try {
      expect(await misPedidos(ANA, TENANT_B.storeSlug)).toEqual([])
    } finally {
      await svc(`update public.stores set status = 'active' where slug = $1`, [TENANT_B.storeSlug])
    }
  })

  it('sin sesión de usuario la función rechaza', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', { sub: '', email: '', org_id: '', companies: [], active_company: '' }, async () =>
        (await db.query(`select public.my_consumer_orders($1)`, [TENANT_A.storeSlug])).rows,
      ),
    )
    expect(message).toMatch(/NO_AUTENTICADO/)
  })
})

describe('el detalle del pedido', () => {
  async function detalle(sub: string, orderId: string, slug = TENANT_A.storeSlug): Promise<Row> {
    const [row] = await as<{ d: Row }>(sub, `select public.my_consumer_order_detail($1, $2) as d`, [slug, orderId])
    return row?.d ?? {}
  }

  it('devuelve las líneas y el desglose GUARDADOS', async () => {
    const d = await detalle(ANA, pedidoAna)
    const [guardado] = await svc<Row>(
      `select subtotal::text, discount_total::text, tax_total::text, shipping_total::text, grand_total::text
         from public.orders where id = $1`,
      [pedidoAna],
    )
    expect(d).toMatchObject(guardado ?? {})

    const items = d.items as Row[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ product_id: productoA, quantity: 2, name: 'Jabón' })

    // Cambiar hoy el precio del producto NO cambia lo que dice el pedido.
    await svc(`update public.products set price = '99.00' where id = $1`, [productoA])
    try {
      const otraVez = await detalle(ANA, pedidoAna)
      expect((otraVez.items as Row[])[0]?.unit_price).toBe(items[0]?.unit_price)
      expect(otraVez.grand_total).toBe(d.grand_total)
    } finally {
      await svc(`update public.products set price = '12.50' where id = $1`, [productoA])
    }
  })

  it('no filtra ids de tenant, correo ni token', async () => {
    const d = await detalle(ANA, pedidoAna)
    for (const campo of ['organization_id', 'company_id', 'store_id', 'customer_email', 'access_token', 'token']) {
      expect(`${campo}: ${campo in d}`).toBe(`${campo}: false`)
    }
  })

  it('el pedido de otro, el de invitado o el de otra tienda dan el mismo «no encontrado»', async () => {
    for (const [sub, id, slug] of [
      [ANA, pedidoBeto, TENANT_A.storeSlug],
      [ANA, pedidoInvitadoConCorreoDeAna, TENANT_A.storeSlug],
      [ANA, pedidoAnaEnB, TENANT_A.storeSlug],
      [BETO, pedidoAna, TENANT_A.storeSlug],
    ] as const) {
      const message = await expectFailure(() => detalle(sub, id, slug))
      expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
    }
  })
})

describe('el perfil de checkout', () => {
  async function perfil(sub: string, slug = TENANT_A.storeSlug): Promise<Row> {
    const [row] = await as<{ p: Row }>(sub, `select public.my_checkout_profile($1) as p`, [slug])
    return row?.p ?? {}
  }

  it('devuelve el contacto del último pedido y sus direcciones distintas, la reciente primero', async () => {
    const p = await perfil(ANA)
    expect(p.contact).toEqual({ name: 'Ana Consumidora', phone: '+51 999 111 222' })
    const direcciones = (p.addresses as Row[]).map((a) => a.address)
    expect(direcciones).toEqual(['Jr. Lampa 55', 'Av. Primavera 120'])
    // La del pedido de invitado con su correo NO aparece.
    expect(direcciones).not.toContain('Calle Falsa 1')
  })

  it('sin pedidos vinculados no inventa nada', async () => {
    const p = await perfil('0e000000-0000-4000-8000-00000000c001')
    expect(p).toEqual({ contact: null, addresses: [] })
  })
})

describe('aislamiento del backoffice', () => {
  it('el administrador de A ve los vínculos de A y no los de B', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
      (await db.query<Row>(`select order_id from public.order_buyers`)).rows,
    )
    const ids = rows.map((r) => r.order_id)
    expect(ids).toContain(pedidoAna)
    expect(ids).not.toContain(pedidoAnaEnB)
  })

  it('el administrador de B ve solo el de B', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_B), async () =>
      (await db.query<Row>(`select order_id from public.order_buyers`)).rows,
    )
    expect(rows.map((r) => r.order_id)).toEqual([pedidoAnaEnB])
  })
})

describe('ninguna función del comprador recibe una identidad', () => {
  it('las firmas solo llevan slug, id de pedido y límite', async () => {
    const rows = await svc<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('my_consumer_orders', 'my_consumer_order_detail', 'my_checkout_profile')
        order by p.proname`,
    )
    expect(rows).toEqual([
      { name: 'my_checkout_profile', args: 'p_store_slug text' },
      { name: 'my_consumer_order_detail', args: 'p_store_slug text, p_order_id uuid' },
      { name: 'my_consumer_orders', args: 'p_store_slug text, p_limit integer' },
    ])
  })
})
