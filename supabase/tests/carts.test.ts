// @vitest-environment node
/**
 * P07-SaaS · El carrito de servidor, contra Postgres REAL.
 *
 * Lo que se compra aqui:
 *
 *  · **el dueño no se declara** — o una sesion o un secreto de 256 bits, y un
 *    token de invitado no puede apoderarse del carrito de nadie;
 *  · **un carrito no mezcla tiendas ni canales**, y no porque el codigo se
 *    acuerde: porque la FK compuesta y la fusion lo impiden;
 *  · **la fusion al iniciar sesion toma el MAXIMO**, no la suma;
 *  · **el precio guardado es informativo** y la deteccion de "esto subio" la
 *    hace el servidor contra su propio snapshot;
 *  · **nadie escribe una linea desde el navegador**: ni `anon` ni
 *    `authenticated` tienen un solo GRANT de escritura sobre las dos tablas;
 *  · **el AISLAMIENTO se sostiene**: el carrito de otro tenant no se lee ni con
 *    membresia de la casa.
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

type Row = Record<string, unknown>

let db: PGlite

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'

/** Comprador con sesion que NO es miembro de ningun tenant: el caso B2B de P05. */
const BUYER = {
  sub: '0c000000-0000-4000-8000-0000000000d1',
  email: 'compradora@empresa.com',
  org_id: '0c000000-0000-4000-8000-000000000003',
  companies: [] as Array<{ id: string; role: string }>,
  active_company: '0c000000-0000-4000-8000-0000000000c3',
}
const OTHER_BUYER = { ...BUYER, sub: '0c000000-0000-4000-8000-0000000000d2' }

let storeA: string
let storeB: string
let silla: string
let mesa: string
let borrador: string
let productoB: string

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

/** El comprador anonimo de la vitrina. */
async function anon(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'anon', null, () => sql(query, params))
}

/** El comprador CON sesion. Sus claims no le dan membresia de ningun tenant. */
async function asBuyer(
  buyer: typeof BUYER,
  query: string,
  params: unknown[] = [],
): Promise<Row[]> {
  return asRole(db, 'authenticated', buyer, () => sql(query, params))
}

async function openCart(
  slug: string,
  token: string | null = null,
  buyer: typeof BUYER | null = null,
): Promise<Row> {
  const query = `select public.cart_open($1, $2) as result`
  const rows = buyer
    ? await asBuyer(buyer, query, [slug, token])
    : await anon(query, [slug, token])
  return rows[0]?.result as Row
}

async function replaceLines(
  slug: string,
  token: string,
  lines: Array<Record<string, unknown>>,
  buyer: typeof BUYER | null = null,
): Promise<Row> {
  const query = `select public.cart_replace_lines($1, $2, $3::jsonb) as result`
  const params = [slug, token, JSON.stringify(lines)]
  const rows = buyer ? await asBuyer(buyer, query, params) : await anon(query, params)
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
  await svc(`update public.store_settings set tax_rate = 0`)

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
  storeB = String(stores.find((s) => s.slug === STORE_B_SLUG)?.id)

  const insertProduct = `
    insert into public.products
      (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status,
       published_at)
    values ($1, $2, $3, $4, $5, $6, $7, 'PEN', $8, $9::public.product_status,
            case when $9::text = 'published' then now() else null end)
    returning id`

  silla = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-SILLA', 'silla', 'Silla',
    '100.00', 50, 'published',
  ])
  mesa = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-MESA', 'mesa', 'Mesa',
    '250.00', 20, 'published',
  ])
  borrador = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-BORRADOR', 'borrador', 'Borrador',
    '10.00', 5, 'draft',
  ])
  productoB = await id(insertProduct, [
    TENANT_B.organizationId, TENANT_B.companyId, storeB, 'B-LAMPARA', 'lampara', 'Lámpara',
    '55.00', 4, 'published',
  ])
})

beforeEach(async () => {
  await svc(`delete from public.cart_items`)
  await svc(`delete from public.carts`)
  await svc(`update public.products set price = '100.00' where id = $1`, [silla])
})

// ---------------------------------------------------------------------------
describe('el modelo', () => {
  it('las dos tablas nacen con RLS forzada', async () => {
    const rows = await svc(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relname in ('carts', 'cart_items')
        order by relname`,
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.relrowsecurity, String(row.relname)).toBe(true)
      expect(row.relforcerowsecurity, String(row.relname)).toBe(true)
    }
  })

  /**
   * La propiedad que hace que el resto de este archivo tenga sentido: si el
   * navegador pudiera escribir una fila directamente, ninguna validacion de las
   * funciones serviria de nada.
   */
  it('ni anon ni authenticated pueden escribir una sola linea', async () => {
    // `has_table_privilege` y no `information_schema`: las vistas del catalogo
    // estandar solo enseñan los privilegios de los roles habilitados para quien
    // pregunta, asi que devolverian vacio aunque el GRANT existiera — un test
    // que pasa por no ver nada no prueba nada.
    const [row] = await svc(
      `select
         has_table_privilege('anon', 'public.carts', 'INSERT') as anon_carts_insert,
         has_table_privilege('anon', 'public.cart_items', 'INSERT') as anon_items_insert,
         has_table_privilege('authenticated', 'public.carts', 'INSERT') as auth_carts_insert,
         has_table_privilege('authenticated', 'public.carts', 'UPDATE') as auth_carts_update,
         has_table_privilege('authenticated', 'public.carts', 'DELETE') as auth_carts_delete,
         has_table_privilege('authenticated', 'public.cart_items', 'INSERT') as auth_items_insert,
         has_table_privilege('authenticated', 'public.cart_items', 'UPDATE') as auth_items_update,
         has_table_privilege('authenticated', 'public.cart_items', 'DELETE') as auth_items_delete`,
    )
    expect(Object.entries(row ?? {}).filter(([, value]) => value === true)).toEqual([])
  })

  /**
   * `revoke select (columna)` NO anula un `grant select` de tabla entera
   * (leccion de 140000), asi que el grant se hace por columna y `token` se
   * queda fuera. El comercio ve el carrito abandonado; no el secreto con el
   * que operarlo.
   */
  it('el token no entra en el GRANT del backoffice', async () => {
    const [row] = await svc(
      `select
         has_column_privilege('authenticated', 'public.carts', 'status', 'SELECT') as ve_estado,
         has_column_privilege('authenticated', 'public.carts', 'token',  'SELECT') as ve_token`,
    )
    expect(row?.ve_estado).toBe(true)
    expect(row?.ve_token).toBe(false)
  })

  it('un carrito convertido sin pedido no cabe en la tabla', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.carts
           (organization_id, company_id, store_id, channel_id, currency, status)
         select $1, $2, $3, c.id, 'PEN', 'converted'
           from public.channels c where c.store_id = $3 and c.is_default`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(message).toMatch(/carts_converted_has_order/)
  })

  it('el canal tiene que ser de la MISMA tienda', async () => {
    const [otherChannel] = await svc(
      `select id from public.channels where store_id = $1 and is_default`,
      [storeB],
    )
    const message = await expectFailure(() =>
      svc(
        `insert into public.carts
           (organization_id, company_id, store_id, channel_id, currency)
         values ($1, $2, $3, $4, 'PEN')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, otherChannel?.id],
      ),
    )
    expect(message).toMatch(/carts_channel_fk/)
  })
})

// ---------------------------------------------------------------------------
describe('abrir el carrito', () => {
  it('el invitado recibe un carrito con su secreto de 256 bits', async () => {
    const cart = await openCart(STORE_A_SLUG)
    expect(String(cart.token)).toHaveLength(64)
    expect(cart.status).toBe('active')
    expect(cart.owned).toBe(false)
    expect(cart.lines).toEqual([])
  })

  it('presentar el token recupera EL MISMO carrito', async () => {
    const first = await openCart(STORE_A_SLUG)
    const again = await openCart(STORE_A_SLUG, String(first.token))
    expect(again.cart_id).toBe(first.cart_id)
  })

  /**
   * Un token viejo no puede dejar a nadie sin comprar. Fallar obligaria al
   * comprador a saber que tiene que borrar su `localStorage`, que es una
   * instruccion que ninguna tienda deberia tener que dar.
   */
  it('un token que no corresponde a nada abre uno nuevo, no falla', async () => {
    const cart = await openCart(STORE_A_SLUG, 'f'.repeat(64))
    expect(String(cart.token)).toHaveLength(64)
    expect(cart.token).not.toBe('f'.repeat(64))
  })

  it('la tienda la resuelve el servidor, y solo si esta activa', async () => {
    await svc(`update public.stores set status = 'suspended' where id = $1`, [storeB])
    const message = await expectFailure(() => openCart(STORE_B_SLUG))
    expect(message).toMatch(/TIENDA_NO_DISPONIBLE/)
    await svc(`update public.stores set status = 'active' where id = $1`, [storeB])
  })

  it('el comprador con sesion tiene UN carrito, el mismo en cualquier dispositivo', async () => {
    const first = await openCart(STORE_A_SLUG, null, BUYER)
    const second = await openCart(STORE_A_SLUG, null, BUYER)
    expect(second.cart_id).toBe(first.cart_id)
    expect(first.owned).toBe(true)
  })

  /**
   * Cierre · certificación (20260914191000). Dos `cart_open` a la vez de un
   * comprador sin carrito activo —el estado justo después de pagar— veían «no
   * hay» y los dos insertaban; el perdedor abortaba con el índice único y la
   * vitrina recibía un 409. Reproducido en Postgres 17.6 con 20 llamadas
   * simultáneas (hasta 19 fallaban).
   *
   * PGlite no tiene concurrencia real, así que se SIMULA la ganadora: un trigger
   * inserta el carrito rival justo en el instante en que `cart_open` inserta el
   * suyo. Sin el arreglo, esto aborta con `carts_one_active_per_user`.
   */
  it('si otra llamada crea el carrito a la vez, se devuelve ESE, sin fallar', async () => {
    const RACER = { ...BUYER, sub: '0c000000-0000-4000-8000-0000000000d9' }
    await sql(`
      create or replace function public.test_cart_rival() returns trigger language plpgsql as $$
      begin
        if pg_trigger_depth() = 1 and new.user_id = '${RACER.sub}'::uuid and new.status = 'active' then
          insert into public.carts (organization_id, company_id, store_id, channel_id, user_id, currency, expires_at)
          values (new.organization_id, new.company_id, new.store_id, new.channel_id, new.user_id, new.currency, new.expires_at);
        end if;
        return new;
      end $$`)
    await sql(`create trigger test_cart_rival before insert on public.carts
                 for each row execute function public.test_cart_rival()`)
    try {
      const abierto = await openCart(STORE_A_SLUG, null, RACER)
      const activos = await svc(
        `select id from public.carts where user_id = $1 and status = 'active'`,
        [RACER.sub],
      )
      // Uno solo, y es el que devolvió la llamada que «perdió».
      expect(activos).toHaveLength(1)
      expect(abierto.cart_id).toBe(activos[0]?.id)
      expect(abierto.owned).toBe(true)
    } finally {
      await sql(`drop trigger test_cart_rival on public.carts`)
      await sql(`drop function public.test_cart_rival()`)
    }
  })

  it('el carrito vacio de un invitado dura dos horas, no un mes', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const [row] = await svc(
      `select (expires_at - now() < interval '3 hours') as corto from public.carts where id = $1`,
      [cart.cart_id],
    )
    expect(row?.corto).toBe(true)
  })

  it('en cuanto tiene lineas, la caducidad se estira', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 1 }])
    const [row] = await svc(
      `select (expires_at - now() > interval '3 days') as largo from public.carts where id = $1`,
      [cart.cart_id],
    )
    expect(row?.largo).toBe(true)
  })

  it('lo caducado se suelta solo al abrir, sin depender de ningun planificador', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await svc(`update public.carts set expires_at = now() - interval '1 hour' where id = $1`, [
      cart.cart_id,
    ])
    await openCart(STORE_A_SLUG)
    const [row] = await svc(`select status from public.carts where id = $1`, [cart.cart_id])
    expect(row?.status).toBe('abandoned')
  })
})

// ---------------------------------------------------------------------------
describe('el titulo de propiedad', () => {
  it('un carrito CON dueño no se abre solo con el token', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    // El invitado presenta el token de un carrito de alguien con sesion: no lo
    // recibe, y ademas no se le dice que existe — se le abre uno nuevo.
    const guest = await openCart(STORE_A_SLUG, String(owned.token))
    expect(guest.cart_id).not.toBe(owned.cart_id)
  })

  it('otra sesion con el token ajeno tampoco escribe en el', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    const message = await expectFailure(() =>
      replaceLines(STORE_A_SLUG, String(owned.token), [{ product_id: silla, quantity: 1 }], OTHER_BUYER),
    )
    // No distingue "no existe" de "no es tuyo": dos mensajes serian un oraculo.
    expect(message).toMatch(/CARRITO_NO_ENCONTRADO/)
  })

  it('el dueño si escribe en el suyo', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    const result = await replaceLines(
      STORE_A_SLUG,
      String(owned.token),
      [{ product_id: silla, quantity: 3 }],
      BUYER,
    )
    expect((result.lines as Row[])[0]?.quantity).toBe(3)
  })

  it('el token de la tienda A no vale en la tienda B', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const message = await expectFailure(() =>
      replaceLines(STORE_B_SLUG, String(cart.token), [{ product_id: productoB, quantity: 1 }]),
    )
    expect(message).toMatch(/CARRITO_NO_ENCONTRADO/)
  })
})

// ---------------------------------------------------------------------------
describe('las lineas se validan contra el catalogo real', () => {
  it('un producto publicado entra, con su nombre y su precio resuelto', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const result = await replaceLines(STORE_A_SLUG, String(cart.token), [
      { product_id: silla, quantity: 2 },
    ])
    const lines = result.lines as Row[]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.name).toBe('Silla')
    expect(lines[0]?.unit_price).toBe('100.00')
    expect((result.quote as Row)?.subtotal).toBe('200.00')
  })

  it('un borrador no entra, con el mismo codigo que usaria el pedido', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const message = await expectFailure(() =>
      replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: borrador, quantity: 1 }]),
    )
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })

  it('un producto de otra tienda tampoco, aunque se conozca su uuid', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const message = await expectFailure(() =>
      replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: productoB, quantity: 1 }]),
    )
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })

  it('un precio dentro de una linea se RECHAZA, no se descarta en silencio', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const message = await expectFailure(() =>
      replaceLines(STORE_A_SLUG, String(cart.token), [
        { product_id: silla, quantity: 1, unit_price: '1.00' },
      ]),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('una cantidad fuera de rango se rechaza', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const message = await expectFailure(() =>
      replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 99999 }]),
    )
    expect(message).toMatch(/CANTIDAD_INVALIDA/)
  })

  it('la misma terna repetida se agrupa en una linea', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const result = await replaceLines(STORE_A_SLUG, String(cart.token), [
      { product_id: silla, quantity: 1 },
      { product_id: silla, quantity: 2 },
    ])
    const lines = result.lines as Row[]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.quantity).toBe(3)
  })

  it('reemplaza y no acumula: lo que no viene, se va', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [
      { product_id: silla, quantity: 1 },
      { product_id: mesa, quantity: 1 },
    ])
    const result = await replaceLines(STORE_A_SLUG, String(cart.token), [
      { product_id: mesa, quantity: 4 },
    ])
    const lines = result.lines as Row[]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.product_id).toBe(mesa)
    expect(lines[0]?.quantity).toBe(4)
  })
})

// ---------------------------------------------------------------------------
describe('el precio guardado es un snapshot, y el cambio lo detecta el servidor', () => {
  it('el snapshot se escribe al tocar el carrito', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 1 }])
    const [row] = await svc(
      `select unit_price_snapshot::text as price, quoted_at is not null as fechado
         from public.cart_items where cart_id = $1`,
      [cart.cart_id],
    )
    expect(row?.price).toBe('100.00')
    expect(row?.fechado).toBe(true)
  })

  /**
   * Esta es la pieza que permite avisar de un cambio de precio SIN que el
   * navegador mande un solo importe en la peticion de compra.
   */
  it('subir el precio del catalogo produce una desviacion, con el antes y el despues', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 1 }])

    await svc(`update public.products set price = '130.00' where id = $1`, [silla])

    const [row] = await anon(`select public.cart_price_drift($1, $2) as result`, [
      STORE_A_SLUG,
      cart.token,
    ])
    const changed = (row?.result as Row)?.changed as Row[]
    expect(changed).toHaveLength(1)
    expect(changed[0]?.was).toBe('100.00')
    expect(changed[0]?.now).toBe('130.00')
  })

  it('sin cambio no hay desviacion', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 1 }])
    const [row] = await anon(`select public.cart_price_drift($1, $2) as result`, [
      STORE_A_SLUG,
      cart.token,
    ])
    expect((row?.result as Row)?.changed).toEqual([])
  })

  it('el carrito avisa linea a linea de que el precio cambio', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 1 }])
    await svc(`update public.products set price = '130.00' where id = $1`, [silla])

    const again = await openCart(STORE_A_SLUG, String(cart.token))
    const lines = again.lines as Row[]
    expect(lines[0]?.price_changed).toBe(true)
    // Y el precio que se PINTA es el vigente, no el viejo.
    expect(lines[0]?.unit_price).toBe('130.00')
    expect(lines[0]?.unit_price_snapshot).toBe('100.00')
  })

  /**
   * Un carrito con una linea que dejo de estar publicada no puede reventar
   * entero: el comprador tiene que poder verlo para arreglarlo.
   */
  it('si la cotizacion no se puede hacer, el carrito sigue viniendo con su motivo', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: mesa, quantity: 1 }])
    await svc(`update public.products set status = 'draft' where id = $1`, [mesa])

    const again = await openCart(STORE_A_SLUG, String(cart.token))
    expect(again.quote).toBeNull()
    expect(again.quote_error).toBe('PRODUCTO_NO_DISPONIBLE')
    expect((again.lines as Row[])).toHaveLength(1)

    await svc(`update public.products set status = 'published' where id = $1`, [mesa])
  })
})

// ---------------------------------------------------------------------------
describe('la fusion al iniciar sesion', () => {
  it('el carrito del invitado pasa al del usuario y el de origen queda marcado', async () => {
    const guest = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(guest.token), [{ product_id: silla, quantity: 2 }])

    const merged = await openCart(STORE_A_SLUG, String(guest.token), BUYER)

    expect(merged.cart_id).not.toBe(guest.cart_id)
    expect(merged.owned).toBe(true)
    expect((merged.lines as Row[])[0]?.product_id).toBe(silla)

    const [origin] = await svc(`select status, merged_into from public.carts where id = $1`, [
      guest.cart_id,
    ])
    expect(origin?.status).toBe('merged')
    expect(origin?.merged_into).toBe(merged.cart_id)
  })

  /**
   * La decision incomoda de la fase: 2 en el movil y 2 en el portatil son 2, no
   * 4. Sumar inventa unidades que nadie eligio y se descubre en la caja.
   */
  it('gana el MAXIMO de cada linea, no la suma', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    await replaceLines(STORE_A_SLUG, String(owned.token), [{ product_id: silla, quantity: 2 }], BUYER)

    const guest = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(guest.token), [{ product_id: silla, quantity: 2 }])

    const merged = await openCart(STORE_A_SLUG, String(guest.token), BUYER)
    const lines = merged.lines as Row[]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.quantity).toBe(2)
  })

  it('lo que solo estaba en uno de los dos, entra', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    await replaceLines(STORE_A_SLUG, String(owned.token), [{ product_id: silla, quantity: 1 }], BUYER)

    const guest = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(guest.token), [{ product_id: mesa, quantity: 5 }])

    const merged = await openCart(STORE_A_SLUG, String(guest.token), BUYER)
    const lines = merged.lines as Row[]
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.product_id).sort()).toEqual([silla, mesa].sort())
  })

  it('la cantidad mayor del invitado si sube la del usuario', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    await replaceLines(STORE_A_SLUG, String(owned.token), [{ product_id: silla, quantity: 1 }], BUYER)

    const guest = await openCart(STORE_A_SLUG)
    await replaceLines(STORE_A_SLUG, String(guest.token), [{ product_id: silla, quantity: 7 }])

    const merged = await openCart(STORE_A_SLUG, String(guest.token), BUYER)
    expect((merged.lines as Row[])[0]?.quantity).toBe(7)
  })

  it('un carrito CON dueño no se puede absorber', async () => {
    const owned = await openCart(STORE_A_SLUG, null, BUYER)
    const other = await openCart(STORE_A_SLUG, null, OTHER_BUYER)

    const message = await expectFailure(() =>
      svc(`select ebim.merge_cart_lines($1, $2)`, [owned.cart_id, other.cart_id]),
    )
    expect(message).toMatch(/CARRITO_CON_DUENO/)
  })

  it('dos canales no se fusionan', async () => {
    // Canal interno de la misma tienda: existe, exige sesion y tiene su propio
    // precio. Fusionar contra el publico seria conceder un descuento.
    const interno = await id(
      `insert into public.channels
         (organization_id, company_id, store_id, code, name, kind, is_default, requires_auth)
       values ($1, $2, $3, 'interno', 'Interno', 'internal', false, true) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    const guest = await openCart(STORE_A_SLUG)
    const otro = await id(
      `insert into public.carts
         (organization_id, company_id, store_id, channel_id, currency)
       values ($1, $2, $3, $4, 'PEN') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, interno],
    )

    const message = await expectFailure(() =>
      svc(`select ebim.merge_cart_lines($1, $2)`, [guest.cart_id, otro]),
    )
    expect(message).toMatch(/CARRITO_DE_OTRO_CANAL/)

    await svc(`delete from public.carts where id = $1`, [otro])
    await svc(`delete from public.channels where id = $1`, [interno])
  })

  it('dos tiendas tampoco', async () => {
    const enA = await openCart(STORE_A_SLUG)
    const enB = await openCart(STORE_B_SLUG)
    const message = await expectFailure(() =>
      svc(`select ebim.merge_cart_lines($1, $2)`, [enA.cart_id, enB.cart_id]),
    )
    expect(message).toMatch(/CARRITO_DE_OTRA_TIENDA/)
  })
})

// ---------------------------------------------------------------------------
describe('aislamiento entre tenants', () => {
  it('el backoffice de A no ve un carrito de B', async () => {
    const enB = await openCart(STORE_B_SLUG)
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id from public.carts`),
    )
    expect(rows.map((row) => row.id)).not.toContain(enB.cart_id)
  })

  it('y tampoco sus lineas', async () => {
    const enB = await openCart(STORE_B_SLUG)
    await replaceLines(STORE_B_SLUG, String(enB.token), [{ product_id: productoB, quantity: 1 }])

    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select cart_id from public.cart_items`),
    )
    expect(rows.map((row) => row.cart_id)).not.toContain(enB.cart_id)
  })

  it('el comprador con sesion no ve NINGUN carrito por la tabla: su puerta es la funcion', async () => {
    await openCart(STORE_A_SLUG, null, BUYER)
    const rows = await asBuyer(BUYER, `select id from public.carts`)
    expect(rows).toEqual([])
  })

  it('anon no lee la tabla en absoluto', async () => {
    await openCart(STORE_A_SLUG)
    const message = await expectFailure(() => anon(`select id from public.carts`))
    expect(message).toMatch(/permission denied|no existe|does not exist/i)
  })
})

// ---------------------------------------------------------------------------
describe('abandonar', () => {
  it('cierra el carrito y deja de ser el activo', async () => {
    const cart = await openCart(STORE_A_SLUG)
    const [row] = await anon(`select public.cart_abandon($1, $2) as result`, [
      STORE_A_SLUG,
      cart.token,
    ])
    expect((row?.result as Row)?.status).toBe('abandoned')

    const again = await openCart(STORE_A_SLUG, String(cart.token))
    expect(again.cart_id).not.toBe(cart.cart_id)
  })

  it('un carrito cerrado no admite lineas nuevas', async () => {
    const cart = await openCart(STORE_A_SLUG)
    await anon(`select public.cart_abandon($1, $2)`, [STORE_A_SLUG, cart.token])
    const message = await expectFailure(() =>
      replaceLines(STORE_A_SLUG, String(cart.token), [{ product_id: silla, quantity: 1 }]),
    )
    expect(message).toMatch(/CARRITO_NO_VIGENTE/)
  })
})
