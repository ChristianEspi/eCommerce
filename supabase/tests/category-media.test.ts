// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * La foto opcional de una categoría: referencia, alt y lectura pública.
 *
 * ## La regla que gobierna el archivo
 *
 * **La ausencia de imagen NO invalida la categoría.** Es lo primero que se
 * comprueba y lo que más importa: todo lo que existía antes de esta fase sigue
 * funcionando igual, y nadie tiene que subir nada para que su tienda se vea
 * como se veía.
 *
 * ## Y la que gobierna el CHECK
 *
 * Una categoría SÍ cuelga de una tienda —a diferencia de una marca, que es de
 * la sociedad—, así que la ruta usa el prefijo de siempre
 * `{organization_id}/{store_id}/` y la autoriza `ebim.can_write_store_object`,
 * la función que ya existía. Lo único nuevo es la carpeta `categories/`, y el
 * CHECK la exige: sin ella no se distinguiría una foto de categoría del logo de
 * la tienda mirando el bucket.
 */

let db: PGlite

const LECTOR = '0a000000-0000-4000-8000-0000000000c1'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function comoAdmin<T>(tenant: typeof TENANT_A, run: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claimsFor(tenant), run)
}

async function comoAnon<T>(run: () => Promise<T>): Promise<T> {
  return asRole(db, 'anon', null, run)
}

let tiendaA = ''
let tiendaB = ''
let raizA = ''
let hijaA = ''
let raizB = ''

const rutaDe = (org: string, tienda: () => string, nombre = 'foto.webp') =>
  `${org}/${tienda()}/categories/${nombre}`

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

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector-cat@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, LECTOR],
  )

  async function categoria(
    tenant: typeof TENANT_A,
    tienda: string,
    slug: string,
    parent: string | null,
  ) {
    const [fila] = await svc<{ id: string }>(
      `insert into public.categories (organization_id, company_id, store_id, parent_id, slug, name)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [tenant.organizationId, tenant.companyId, tienda, parent, slug, slug],
    )
    return String(fila?.id)
  }

  raizA = await categoria(TENANT_A, tiendaA, 'abrigos', null)
  hijaA = await categoria(TENANT_A, tiendaA, 'abrigos-largos', raizA)
  raizB = await categoria(TENANT_B, tiendaB, 'zapatillas', null)
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`update public.categories set image_url = null, image_alt = null, is_active = true`)
})

async function guardar(
  campos: { url?: string | null; alt?: string | null },
  categoria = raizA,
  tenant = TENANT_A,
) {
  return comoAdmin(tenant, () =>
    svc<{ id: string }>(
      `update public.categories set image_url = $1, image_alt = $2 where id = $3 returning id`,
      [campos.url ?? null, campos.alt ?? null, categoria],
    ),
  )
}

// ---------------------------------------------------------------------------
// A · Sin foto todo sigue igual
// ---------------------------------------------------------------------------

describe('A · la ausencia de imagen no invalida la categoría', () => {
  it('una categoría nueva nace sin foto y sin alt', async () => {
    const [fila] = await svc<{ image_url: string | null; image_alt: string | null }>(
      `select image_url, image_alt from public.categories where id = $1`,
      [raizA],
    )
    expect(fila?.image_url).toBeNull()
    expect(fila?.image_alt).toBeNull()
  })

  it('sin foto, la categoría se publica igual en la vitrina', async () => {
    const filas = await comoAnon(() =>
      svc<{ slug: string; image_url: string | null }>(
        `select slug, image_url from public.public_categories where store_id = $1 order by slug`,
        [tiendaA],
      ),
    )
    expect(filas.map((f) => f.slug)).toEqual(['abrigos', 'abrigos-largos'])
    expect(filas.every((f) => f.image_url === null)).toBe(true)
  })

  it('se puede dar de alta una categoría sin mencionar la foto', async () => {
    // Es el `insert` de cualquier pantalla anterior a esta fase: si las columnas
    // fueran obligatorias, el alta de categorías se habría roto.
    const filas = await comoAdmin(TENANT_A, () =>
      svc<{ id: string }>(
        `insert into public.categories (organization_id, company_id, store_id, slug, name)
         values ($1, $2, $3, 'sin-foto', 'Sin foto') returning id`,
        [TENANT_A.organizationId, TENANT_A.companyId, tiendaA],
      ),
    )
    expect(filas).toHaveLength(1)
    await svc(`delete from public.categories where slug = 'sin-foto'`)
  })
})

// ---------------------------------------------------------------------------
// B · A qué puede apuntar la foto
// ---------------------------------------------------------------------------

describe('B · la referencia de la foto', () => {
  it('acepta una ruta bajo el prefijo de la PROPIA tienda', async () => {
    expect(await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA) })).toHaveLength(1)
  })

  it('acepta una URL https externa', async () => {
    expect(await guardar({ url: 'https://cdn.ejemplo.com/abrigos.webp' })).toHaveLength(1)
  })

  it('rechaza el prefijo de otra tienda', async () => {
    // El caso que da sentido al CHECK: sin él, una categoría podría apuntar a
    // un objeto de la tienda de al lado y servirlo como suyo.
    const error = await expectFailure(() =>
      guardar({ url: rutaDe(TENANT_B.organizationId, () => tiendaB) }),
    )
    expect(error).toMatch(/categories_image_ref|violates/i)
  })

  it('rechaza la carpeta del branding de la tienda', async () => {
    // No es un ataque: es el error que comete quien copia el código del logo.
    // Y no vale, porque entonces el bucket no dejaría distinguir una foto de
    // categoría del logo de la tienda.
    const error = await expectFailure(() =>
      guardar({ url: `${TENANT_A.organizationId}/${tiendaA}/branding/abrigos.webp` }),
    )
    expect(error).toMatch(/categories_image_ref|violates/i)
  })

  it.each([
    ['sin carpeta', (org: string, t: string) => `${org}/${t}/abrigos.webp`],
    ['solo el prefijo', (org: string, t: string) => `${org}/${t}/categories/`],
    [
      'travesía de directorios',
      (org: string, t: string) => `${org}/${t}/categories/../../otra/x.webp`,
    ],
  ])('rechaza %s', async (_caso, construir) => {
    const error = await expectFailure(() =>
      guardar({ url: construir(TENANT_A.organizationId, tiendaA) }),
    )
    expect(error).toMatch(/categories_image_ref|violates/i)
  })

  it.each([
    ['http sin cifrar', 'http://cdn.ejemplo.com/x.webp'],
    ['un javascript:', 'javascript:alert(1)'],
    ['un data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['texto suelto', 'abrigos.webp'],
  ])('rechaza %s', async (_caso, valor) => {
    const error = await expectFailure(() => guardar({ url: valor }))
    expect(error).toMatch(/categories_image_ref|categories_image_len|violates/i)
  })

  it('rechaza una referencia más larga de 1024', async () => {
    const larga = `${TENANT_A.organizationId}/${tiendaA}/categories/${'a'.repeat(1100)}.webp`
    const error = await expectFailure(() => guardar({ url: larga }))
    expect(error).toMatch(/categories_image_len|violates/i)
  })

  it('el CHECK valida contra las columnas de la FILA, no contra un argumento', async () => {
    const [fila] = await svc<{ valido: boolean }>(
      `select ebim.is_category_image_ref($1, $2, $3) as valido`,
      [rutaDe(TENANT_A.organizationId, () => tiendaA), TENANT_B.organizationId, tiendaB],
    )
    expect(fila?.valido).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// C · El texto alternativo
// ---------------------------------------------------------------------------

describe('C · el texto alternativo', () => {
  it('es opcional: una foto sin alt es válida', async () => {
    expect(
      await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA), alt: null }),
    ).toHaveLength(1)
  })

  it('acepta una descripción normal y el límite exacto', async () => {
    expect(await guardar({ alt: 'Un abrigo de lana sobre un fondo claro' })).toHaveLength(1)
    expect(await guardar({ alt: 'a'.repeat(160) })).toHaveLength(1)
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['desbordado', 'a'.repeat(161)],
    // Un salto de línea en un alt lo lee un lector de pantalla como una frase
    // partida, y vacía de sentido el tope de 160 caracteres.
    ['con salto de línea', 'Un abrigo\nde lana'],
    ['con tabulador', 'Un abrigo\tde lana'],
  ])('rechaza el alt %s', async (_caso, valor) => {
    const error = await expectFailure(() => guardar({ alt: valor }))
    expect(error).toMatch(/categories_image_alt_len|violates/i)
  })
})

// ---------------------------------------------------------------------------
// D · Quién escribe
// ---------------------------------------------------------------------------

describe('D · aislamiento y permisos', () => {
  it('el admin de otra sociedad no pone foto en esta categoría', async () => {
    const filas = await guardar(
      { url: rutaDe(TENANT_B.organizationId, () => tiendaB) },
      raizA,
      TENANT_B,
    )
    expect(filas).toHaveLength(0)
  })

  it('cada tienda conserva la suya', async () => {
    await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA), alt: 'Abrigos' }, raizA, TENANT_A)
    await guardar({ url: rutaDe(TENANT_B.organizationId, () => tiendaB), alt: 'Zapatillas' }, raizB, TENANT_B)

    const filas = await svc<{ id: string; image_alt: string | null }>(
      `select id, image_alt from public.categories where image_alt is not null`,
    )
    const porId = new Map(filas.map((f) => [f.id, f.image_alt]))
    expect(porId.get(raizA)).toBe('Abrigos')
    expect(porId.get(raizB)).toBe('Zapatillas')
  })

  it('un miembro sin rol de catálogo no pone foto', async () => {
    const claimsLector = claimsFor(TENANT_A, {
      sub: LECTOR,
      email: 'lector-cat@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
    })

    const filas = await asRole(db, 'authenticated', claimsLector, () =>
      svc(`update public.categories set image_url = $1 where id = $2 returning id`, [
        rutaDe(TENANT_A.organizationId, () => tiendaA),
        raizA,
      ]),
    )
    expect(filas).toHaveLength(0)
  })

  it('`anon` puede LEER la foto y no escribirla', async () => {
    await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA) })

    const leidas = await comoAnon(() =>
      svc<{ image_url: string | null }>(
        `select image_url from public.public_categories where category_id = $1`,
        [raizA],
      ),
    )
    expect(leidas[0]?.image_url).toBe(rutaDe(TENANT_A.organizationId, () => tiendaA))

    const error = await expectFailure(() =>
      comoAnon(() =>
        svc(`update public.categories set image_url = null where id = $1`, [raizA]),
      ),
    )
    expect(error).toMatch(/permission denied|denegado|row-level security/i)
  })
})

// ---------------------------------------------------------------------------
// E · public_categories
// ---------------------------------------------------------------------------

describe('E · public_categories', () => {
  it('publica la foto y su alt', async () => {
    await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA), alt: 'Un abrigo de lana' })

    const [fila] = await comoAnon(() =>
      svc<{ image_url: string | null; image_alt: string | null }>(
        `select image_url, image_alt from public.public_categories where category_id = $1`,
        [raizA],
      ),
    )
    expect(fila?.image_url).toBe(rutaDe(TENANT_A.organizationId, () => tiendaA))
    expect(fila?.image_alt).toBe('Un abrigo de lana')
  })

  it('NO publica el tenant ni las marcas de tiempo', async () => {
    const [fila] = await comoAnon(() =>
      svc<Record<string, unknown>>(`select * from public.public_categories limit 1`),
    )
    expect(Object.keys(fila ?? {}).sort()).toEqual([
      'category_id',
      'image_alt',
      'image_url',
      'name',
      'parent_id',
      'position',
      'slug',
      'store_id',
    ])
  })

  /**
   * La prueba que hay que NO romper al ampliar esta vista.
   *
   * `public_categories` no es un `where is_active`: desde `20260901130000` es un
   * CTE recursivo que solo enseña las categorías con TODO su camino activo. Al
   * añadir las dos columnas de la foto, reescribirla desde su versión original
   * habría deshecho esa corrección en silencio — la vista existiría, el SQL se
   * aplicaría, y apagar una madre dejaría a sus hijas en la vitrina como si
   * fueran raíces. Lo cazó `category-tree.test.ts`; esto lo fija también aquí,
   * junto a la foto, porque es donde se va a volver a tocar.
   */
  it('apagar una madre sigue apagando a sus hijas, con foto o sin ella', async () => {
    await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA) }, raizA)
    await guardar({ url: rutaDe(TENANT_A.organizationId, () => tiendaA, 'hija.webp') }, hijaA)

    const antes = await comoAnon(() =>
      svc(`select category_id from public.public_categories where store_id = $1`, [tiendaA]),
    )
    expect(antes).toHaveLength(2)

    await svc(`update public.categories set is_active = false where id = $1`, [raizA])
    const despues = await comoAnon(() =>
      svc(`select category_id from public.public_categories where store_id = $1`, [tiendaA]),
    )
    expect(despues).toHaveLength(0)
  })

  it('sigue siendo security_invoker', async () => {
    const [opciones] = await svc<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'public_categories'`,
    )
    expect(opciones?.reloptions ?? []).toContain('security_invoker=on')
  })

  it('la categoría de una tienda suspendida no se publica', async () => {
    let filas: unknown[] = []
    try {
      await svc(`update public.stores set status = 'suspended' where id = $1`, [tiendaA])
      filas = await comoAnon(() =>
        svc(`select category_id from public.public_categories where store_id = $1`, [tiendaA]),
      )
    } finally {
      await svc(`update public.stores set status = 'active' where id = $1`, [tiendaA])
    }
    expect(filas).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// F · Storage: la carpeta nueva usa la autorización que ya había
// ---------------------------------------------------------------------------

describe('F · el objeto en el bucket', () => {
  beforeEach(async () => {
    await svc(`delete from storage.objects where bucket_id = 'store-assets'`)
  })

  it('el admin de la tienda sube a su carpeta de categorías', async () => {
    const filas = await comoAdmin(TENANT_A, () =>
      svc<{ id: string }>(
        `insert into storage.objects (bucket_id, name) values ('store-assets', $1) returning id`,
        [rutaDe(TENANT_A.organizationId, () => tiendaA)],
      ),
    )
    expect(filas).toHaveLength(1)
  })

  it('no sube a la carpeta de otra tienda', async () => {
    const error = await comoAdmin(TENANT_A, () =>
      expectFailure(() =>
        svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
          rutaDe(TENANT_B.organizationId, () => tiendaB),
        ]),
      ),
    )
    expect(error).toMatch(/row-level security/i)
  })

  it('el comprador anónimo puede leer el objeto de una tienda activa', async () => {
    // La carpeta es nueva; la autorización no. `ebim.store_object_visible` mira
    // los dos primeros segmentos de la ruta, así que esto funciona sin haber
    // añadido ni una policy.
    await svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
      rutaDe(TENANT_A.organizationId, () => tiendaA),
    ])

    const vistos = await comoAnon(() =>
      svc<{ name: string }>(`select name from storage.objects where bucket_id = 'store-assets'`),
    )
    expect(vistos.map((o) => o.name)).toContain(rutaDe(TENANT_A.organizationId, () => tiendaA))
  })
})
