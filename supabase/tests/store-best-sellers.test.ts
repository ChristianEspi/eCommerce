// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * El ranking de más vendidos de una tienda.
 *
 * ## Lo que este archivo defiende
 *
 * La portada decía «Lo más vendido» sobre una lista que salía del orden por
 * RELEVANCIA del buscador. Aquí se fija la otra mitad del arreglo: que el
 * ranking real cuente lo que tiene que contar, que no cuente lo que no, y que
 * no se lleve por delante ni un dato de nadie.
 *
 * ## Las tres cosas que no pueden pasar
 *
 *  1. **Que cuente un pedido que no es una venta.** Un cancelado, un devuelto o
 *     uno que nunca se cobró.
 *  2. **Que cruce tiendas.** El ranking de una tienda no puede llevar productos
 *     que se vendieron en otra, ni siquiera de la misma sociedad.
 *  3. **Que se escape un dato.** `anon` sigue sin GRANT sobre `orders` y sobre
 *     `order_items`, y la función no devuelve correos, nombres, importes ni
 *     unidades: solo qué producto y en qué puesto.
 */

let db: PGlite

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function comoAnon<T>(run: () => Promise<T>): Promise<T> {
  return asRole(db, 'anon', null, run)
}

let tiendaA = ''
let tiendaB = ''
/** Cinco productos publicados en A y uno en B, para el caso cruzado. */
const productos = new Map<string, string>()

async function ranking(slug: string, limite?: number) {
  return comoAnon(() =>
    svc<{ product_id: string; sort_order: number }>(
      `select product_id, sort_order from public.store_best_sellers_for_slug($1, $2) order by sort_order`,
      [slug, limite ?? null],
    ),
  )
}

/** Un pedido con una línea de `producto`, en el estado y la fecha que se pidan. */
async function pedido(input: {
  tenant: typeof TENANT_A
  tienda: string
  producto: string
  cantidad: number
  estado: string
  diasAtras?: number
  numero: string
}) {
  const [orden] = await svc<{ id: string }>(
    // `channel_id` sale del canal por defecto de la tienda, como en el resto de
    // bancos de prueba: es NOT NULL desde la migración de canales.
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, customer_email, currency,
        subtotal, tax_total, shipping_total, discount_total, grand_total, channel_id, placed_at)
     values ($1, $2, $3, $4, $5::public.order_status, 'comprador@ejemplo.com', 'PEN',
             10, 0, 0, 0, 10,
             (select c.id from public.channels c where c.store_id = $3 and c.is_default),
             now() - make_interval(days => $6))
     returning id`,
    [
      input.tenant.organizationId,
      input.tenant.companyId,
      input.tienda,
      input.numero,
      input.estado,
      input.diasAtras ?? 1,
    ],
  )
  await svc(
    `insert into public.order_items
       (organization_id, company_id, store_id, order_id, product_id, sku, name, unit_price, quantity)
     values ($1, $2, $3, $4, $5, 'SKU', 'Linea', 10, $6)`,
    [
      input.tenant.organizationId,
      input.tenant.companyId,
      input.tienda,
      orden?.id,
      input.producto,
      input.cantidad,
    ],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
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
  await svc(`update public.stores set status = 'active'`)

  const tiendas = await svc<{ id: string; slug: string }>(`select id, slug from public.stores`)
  tiendaA = String(tiendas.find((t) => t.slug === TENANT_A.storeSlug)?.id)
  tiendaB = String(tiendas.find((t) => t.slug === TENANT_B.storeSlug)?.id)

  async function publicar(tenant: typeof TENANT_A, tienda: string, sku: string) {
    const [producto] = await svc<{ id: string }>(
      `insert into public.products (organization_id, company_id, sku, name)
       values ($1, $2, $3, $3) returning id`,
      [tenant.organizationId, tenant.companyId, sku],
    )
    await svc(
      `insert into public.store_products
         (organization_id, company_id, store_id, product_id, slug, status, published_at, price, currency)
       values ($1, $2, $3, $4, $5, 'published', now() - interval '1 day', 10, 'PEN')`,
      [tenant.organizationId, tenant.companyId, tienda, producto?.id, sku.toLowerCase()],
    )
    productos.set(sku, String(producto?.id))
  }

  for (const sku of ['A-UNO', 'A-DOS', 'A-TRES', 'A-CUATRO', 'A-CINCO']) {
    await publicar(TENANT_A, tiendaA, sku)
  }
  await publicar(TENANT_B, tiendaB, 'B-UNO')
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.order_items`)
  await svc(`delete from public.orders`)
  await svc(`update public.store_products set status = 'published'`)
})

const id = (sku: string) => String(productos.get(sku))

// ---------------------------------------------------------------------------
// A · Sin ventas no hay ranking
// ---------------------------------------------------------------------------

describe('A · una tienda sin ventas', () => {
  it('devuelve CERO filas, no una lista cualquiera', async () => {
    // Es lo que permite que la vitrina deje de decir «lo más vendido». Si aquí
    // se devolviera «algo» para que la sección no quedara vacía, volveríamos al
    // problema que P08 arregla.
    expect(await ranking(TENANT_A.storeSlug)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// B · Qué cuenta como venta
// ---------------------------------------------------------------------------

describe('B · qué cuenta y qué no', () => {
  it('ordena por unidades vendidas, de más a menos', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 2, estado: 'paid', numero: 'O-1' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-DOS'), cantidad: 9, estado: 'fulfilled', numero: 'O-2' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-TRES'), cantidad: 5, estado: 'paid', numero: 'O-3' })

    const filas = await ranking(TENANT_A.storeSlug)
    expect(filas.map((f) => f.product_id)).toEqual([id('A-DOS'), id('A-TRES'), id('A-UNO')])
    expect(filas.map((f) => f.sort_order)).toEqual([1, 2, 3])
  })

  it('suma las unidades de VARIOS pedidos del mismo producto', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 4, estado: 'paid', numero: 'O-1' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 4, estado: 'paid', numero: 'O-2' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-DOS'), cantidad: 7, estado: 'paid', numero: 'O-3' })

    const filas = await ranking(TENANT_A.storeSlug)
    expect(filas[0]?.product_id).toBe(id('A-UNO'))
  })

  it('un pedido CANCELADO no cuenta', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 50, estado: 'cancelled', numero: 'O-1' })
    expect(await ranking(TENANT_A.storeSlug)).toEqual([])
  })

  it('un pedido DEVUELTO tampoco: se vendió y se deshizo', async () => {
    // Sumarlo diría que el producto que todos devuelven es el que más se vende.
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 50, estado: 'refunded', numero: 'O-1' })
    expect(await ranking(TENANT_A.storeSlug)).toEqual([])
  })

  it('un pedido PENDIENTE tampoco: puede no cobrarse nunca', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 50, estado: 'pending', numero: 'O-1' })
    expect(await ranking(TENANT_A.storeSlug)).toEqual([])
  })

  it('lo vendido hace más de noventa días no cuenta', async () => {
    // «Lo más vendido» es una afirmación sobre el presente: con todo el
    // histórico, un producto descatalogado que arrasó hace años encabezaría la
    // lista de una tienda que ya no lo vende.
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 99, estado: 'paid', diasAtras: 120, numero: 'O-1' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-DOS'), cantidad: 1, estado: 'paid', diasAtras: 10, numero: 'O-2' })

    const filas = await ranking(TENANT_A.storeSlug)
    expect(filas.map((f) => f.product_id)).toEqual([id('A-DOS')])
  })

  it('un producto DESPUBLICADO sale del ranking', async () => {
    // Un ranking con ids que la vitrina no puede pintar deja huecos, y lo que
    // se despublicó no se está vendiendo.
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 9, estado: 'paid', numero: 'O-1' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-DOS'), cantidad: 1, estado: 'paid', numero: 'O-2' })

    await svc(`update public.store_products set status = 'draft' where product_id = $1`, [id('A-UNO')])

    const filas = await ranking(TENANT_A.storeSlug)
    expect(filas.map((f) => f.product_id)).toEqual([id('A-DOS')])
  })

  it('el orden es ESTABLE con empates', async () => {
    // Sin desempate, dos productos con las mismas unidades se alternan entre
    // dos cargas de la misma portada y la fila parece barajarse sola.
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 3, estado: 'paid', numero: 'O-1' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-DOS'), cantidad: 3, estado: 'paid', numero: 'O-2' })

    const una = await ranking(TENANT_A.storeSlug)
    const otra = await ranking(TENANT_A.storeSlug)
    expect(una.map((f) => f.product_id)).toEqual(otra.map((f) => f.product_id))
  })
})

// ---------------------------------------------------------------------------
// C · Aislamiento
// ---------------------------------------------------------------------------

describe('C · el ranking no cruza tiendas', () => {
  it('lo vendido en B no aparece en el ranking de A', async () => {
    await pedido({ tenant: TENANT_B, tienda: tiendaB, producto: id('B-UNO'), cantidad: 99, estado: 'paid', numero: 'O-B1' })
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 1, estado: 'paid', numero: 'O-A1' })

    expect((await ranking(TENANT_A.storeSlug)).map((f) => f.product_id)).toEqual([id('A-UNO')])
    expect((await ranking(TENANT_B.storeSlug)).map((f) => f.product_id)).toEqual([id('B-UNO')])
  })

  it('una tienda SUSPENDIDA no tiene ranking', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 9, estado: 'paid', numero: 'O-1' })

    let filas: unknown[] = []
    try {
      await svc(`update public.stores set status = 'suspended' where id = $1`, [tiendaA])
      filas = await ranking(TENANT_A.storeSlug)
    } finally {
      await svc(`update public.stores set status = 'active' where id = $1`, [tiendaA])
    }
    expect(filas).toEqual([])
  })

  it.each([['un slug que no existe', 'no-existe'], ['vacío', ''], ['nulo', null]])(
    '%s devuelve cero filas, nunca el ranking de otra',
    async (_caso, slug) => {
      await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 9, estado: 'paid', numero: 'O-1' })
      const filas = await comoAnon(() =>
        svc(`select product_id from public.store_best_sellers_for_slug($1, 12)`, [slug]),
      )
      expect(filas).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// D · Lo que no se escapa
// ---------------------------------------------------------------------------

describe('D · ni un dato de nadie', () => {
  it('la función devuelve SOLO producto y puesto', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 9, estado: 'paid', numero: 'O-1' })

    const [fila] = await comoAnon(() =>
      svc<Record<string, unknown>>(`select * from public.store_best_sellers_for_slug($1, 12)`, [
        TENANT_A.storeSlug,
      ]),
    )
    // Ni correo, ni nombre, ni importe, ni las UNIDADES: son volumen de negocio
    // del comercio y el comprador no las necesita para ver una fila.
    expect(Object.keys(fila ?? {}).sort()).toEqual(['product_id', 'sort_order'])
  })

  it('`anon` sigue sin poder leer pedidos ni sus líneas', async () => {
    // La función es una PUERTA con una respuesta concreta, no un permiso nuevo.
    for (const tabla of ['orders', 'order_items']) {
      const error = await expectFailure(() =>
        comoAnon(() => svc(`select * from public.${tabla} limit 1`)),
      )
      expect(error, tabla).toMatch(/permission denied/i)
    }
  })

  it('un miembro de otra sociedad tampoco lee los pedidos de A', async () => {
    await pedido({ tenant: TENANT_A, tienda: tiendaA, producto: id('A-UNO'), cantidad: 9, estado: 'paid', numero: 'O-1' })

    const vistos = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      svc(`select id from public.orders`),
    )
    expect(vistos).toEqual([])
  })

  it('el tope se acota en la base: un límite enorme no vuelca el catálogo', async () => {
    for (const [i, sku] of ['A-UNO', 'A-DOS', 'A-TRES', 'A-CUATRO', 'A-CINCO'].entries()) {
      await pedido({
        tenant: TENANT_A,
        tienda: tiendaA,
        producto: id(sku),
        cantidad: i + 1,
        estado: 'paid',
        numero: `O-${i}`,
      })
    }

    // Pedir 100000 devuelve como mucho 24; pedir 2 devuelve 2; pedir 0 o menos
    // no devuelve cero filas, se acota al mínimo de 1.
    expect((await ranking(TENANT_A.storeSlug, 100_000)).length).toBeLessThanOrEqual(24)
    expect(await ranking(TENANT_A.storeSlug, 2)).toHaveLength(2)
    expect(await ranking(TENANT_A.storeSlug, 0)).toHaveLength(1)
    expect(await ranking(TENANT_A.storeSlug, -5)).toHaveLength(1)
  })
})
