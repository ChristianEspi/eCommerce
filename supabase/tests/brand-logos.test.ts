// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * El logo de una marca: referencia, Storage y lectura pública.
 *
 * ## Lo que hay que entender antes de tocar esto
 *
 * Una marca es de la SOCIEDAD, no de una tienda. `public.brands` no tiene
 * `store_id` y es deliberado desde el PIM: la misma marca se vende en la
 * mayorista y en la minorista de la misma sociedad, y tenerla dos veces
 * significa que un día el logo se cambia en una y no en la otra.
 *
 * Eso rompe el mecanismo de autorización de `store-assets`, que saca la tienda
 * del SEGUNDO segmento de la ruta y la contrasta contra `public.stores`.
 * Reutilizarlo habría exigido elegir una tienda como dueña del archivo: o el
 * logo se duplica —el problema que el PIM evitó— o cuelga de una tienda que
 * mañana se cierra y se lleva un logo que la otra seguía usando.
 *
 * Así que hay una segunda familia de rutas en el mismo bucket:
 *
 *     {organization_id}/company/{company_id}/brands/{uuid}.{ext}
 *
 * Este archivo comprueba que esa familia autoriza con el MISMO rigor que la de
 * tienda, y que no abrió de paso ninguna puerta a la de al lado.
 */

let db: PGlite

const LECTOR = '0a000000-0000-4000-8000-0000000000d1'

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
let marcaA = ''
let marcaB = ''

/** La ruta canónica de un logo de la sociedad indicada. */
const rutaDe = (tenant: typeof TENANT_A, nombre = 'logo.webp') =>
  `${tenant.organizationId}/company/${tenant.companyId}/brands/${nombre}`

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
     values ($1, $2, $3, 'lector-logo@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, LECTOR],
  )

  // Una marca por sociedad, con un producto publicado en su tienda para que
  // `public_brands` y la policy anónima de `brands` tengan de qué tirar.
  for (const [tenant, tienda] of [
    [TENANT_A, () => tiendaA],
    [TENANT_B, () => tiendaB],
  ] as const) {
    const [marca] = await svc<{ id: string }>(
      `insert into public.brands (organization_id, company_id, code, name)
       values ($1, $2, 'marca-propia', $3) returning id`,
      [tenant.organizationId, tenant.companyId, `Marca ${tenant.slug}`],
    )
    const [producto] = await svc<{ id: string }>(
      `insert into public.products (organization_id, company_id, sku, name, brand_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [tenant.organizationId, tenant.companyId, `SKU-${tenant.slug}`, `Producto ${tenant.slug}`, marca?.id],
    )
    await svc(
      `insert into public.store_products
         (organization_id, company_id, store_id, product_id, slug, status, published_at, price, currency)
       values ($1, $2, $3, $4, 'producto', 'published', now() - interval '1 day', 10, 'PEN')`,
      [tenant.organizationId, tenant.companyId, tienda(), producto?.id],
    )
    if (tenant === TENANT_A) marcaA = String(marca?.id)
    else marcaB = String(marca?.id)
  }
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`update public.brands set logo_url = null`)
  await svc(`delete from storage.objects where bucket_id = 'store-assets'`)
})

// ---------------------------------------------------------------------------
// A · A qué puede apuntar `logo_url`
// ---------------------------------------------------------------------------

async function guardarLogo(valor: string | null, marca = marcaA, tenant = TENANT_A) {
  return comoAdmin(tenant, () =>
    svc<{ id: string }>(`update public.brands set logo_url = $1 where id = $2 returning id`, [
      valor,
      marca,
    ]),
  )
}

describe('A · la referencia del logo', () => {
  it('acepta el nulo: una marca sin logo es lo normal', async () => {
    expect(await guardarLogo(null)).toHaveLength(1)
  })

  it('acepta una ruta del bucket bajo el prefijo de la PROPIA sociedad', async () => {
    expect(await guardarLogo(rutaDe(TENANT_A))).toHaveLength(1)
  })

  it('acepta una URL https externa (contrato §4.3)', async () => {
    expect(await guardarLogo('https://cdn.ejemplo.com/marca.png')).toHaveLength(1)
  })

  const FUERA: Array<[string, string]> = [
    // El prefijo de OTRA sociedad. Es el caso que da sentido al CHECK: sin él,
    // una marca podría apuntar a un objeto del vecino y servirlo como suyo.
    ['el prefijo de otra sociedad', `${TENANT_B.organizationId}/company/${TENANT_B.companyId}/brands/x.webp`],
    ['la organización correcta con otra sociedad', `${TENANT_A.organizationId}/company/${TENANT_B.companyId}/brands/x.webp`],
    // La familia de rutas de TIENDA. No es un ataque: es el error que comete
    // quien copia el código del branding de la tienda. Y no vale, porque esas
    // rutas las autoriza otra policy y nadie garantiza que la tienda siga
    // existiendo cuando la marca se venda en otra.
    ['una ruta de tienda', `${TENANT_A.organizationId}/00000000-0000-4000-8000-000000000001/branding/x.webp`],
    ['sin el literal company', `${TENANT_A.organizationId}/${TENANT_A.companyId}/brands/x.webp`],
    ['sin la carpeta brands', `${TENANT_A.organizationId}/company/${TENANT_A.companyId}/x.webp`],
    ['solo el prefijo, sin archivo', `${TENANT_A.organizationId}/company/${TENANT_A.companyId}/brands/`],
    // Travesía de directorios: el prefijo autoriza, y un `..` detrás saca el
    // objeto de la carpeta que el prefijo defiende.
    ['travesía de directorios', `${TENANT_A.organizationId}/company/${TENANT_A.companyId}/brands/../../otro/x.webp`],
    // `http://` degrada la vitrina a contenido mixto y el navegador lo bloquea
    // igual: mejor no guardarlo que guardar algo que no se va a ver.
    ['http sin cifrar', 'http://cdn.ejemplo.com/marca.png'],
    ['un javascript:', 'javascript:alert(1)'],
    ['un data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['una ruta relativa', '../../etc/passwd'],
    ['texto suelto', 'marca.png'],
  ]

  it.each(FUERA)('rechaza %s', async (_caso, valor) => {
    const error = await expectFailure(() => guardarLogo(valor))
    expect(error).toMatch(/brands_logo_ref|violates/i)
  })

  it('el CHECK valida contra las columnas de la FILA, no contra un argumento', async () => {
    // Es la diferencia entre comprobar y preguntar. Con el tenant por
    // parámetro, quien escribe elegiría contra qué validarse.
    const [fila] = await svc<{ valido: boolean }>(
      `select ebim.is_brand_logo_ref($1, $2, $3) as valido`,
      [rutaDe(TENANT_A), TENANT_B.organizationId, TENANT_B.companyId],
    )
    expect(fila?.valido).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// B · Storage: la familia de rutas de sociedad
// ---------------------------------------------------------------------------

describe('B · quién escribe en el espacio de una sociedad', () => {
  it('el admin de la sociedad sube su logo', async () => {
    const filas = await comoAdmin(TENANT_A, () =>
      svc<{ id: string }>(
        `insert into storage.objects (bucket_id, name) values ('store-assets', $1) returning id`,
        [rutaDe(TENANT_A)],
      ),
    )
    expect(filas).toHaveLength(1)
  })

  it('no puede subir al espacio de otra sociedad', async () => {
    const error = await comoAdmin(TENANT_A, () =>
      expectFailure(() =>
        svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
          rutaDe(TENANT_B),
        ]),
      ),
    )
    expect(error).toMatch(/row-level security/i)
  })

  it('un miembro sin rol de catálogo tampoco sube', async () => {
    const claimsLector = claimsFor(TENANT_A, {
      sub: LECTOR,
      email: 'lector-logo@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
    })

    const error = await asRole(db, 'authenticated', claimsLector, () =>
      expectFailure(() =>
        svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
          rutaDe(TENANT_A, 'colado.webp'),
        ]),
      ),
    )
    expect(error).toMatch(/row-level security/i)
  })

  it('`anon` NUNCA escribe', async () => {
    const error = await comoAnon(() =>
      expectFailure(() =>
        svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
          rutaDe(TENANT_A, 'anonimo.webp'),
        ]),
      ),
    )
    expect(error).toMatch(/row-level security|permission denied/i)
  })

  it('el admin ve sus objetos y no los de la sociedad de al lado', async () => {
    await svc(
      `insert into storage.objects (bucket_id, name) values ('store-assets', $1), ('store-assets', $2)`,
      [rutaDe(TENANT_A), rutaDe(TENANT_B)],
    )

    const vistos = await comoAdmin(TENANT_A, () =>
      svc<{ name: string }>(`select name from storage.objects where bucket_id = 'store-assets'`),
    )
    expect(vistos.map((o) => o.name)).toEqual([rutaDe(TENANT_A)])
  })

  it('la ruta de sociedad NO se autoriza por el mecanismo de tienda', async () => {
    // `ebim.storage_store` saca el segundo segmento; en una ruta de sociedad ese
    // segmento es el literal `company`, que no es un uuid. Si devolviera algo,
    // las policies de tienda decidirían sobre objetos que no son de ninguna.
    const [fila] = await svc<{ tienda: string | null; sociedad: string | null; es: boolean }>(
      `select ebim.storage_store($1) as tienda,
              ebim.storage_company($1) as sociedad,
              ebim.storage_is_company_path($1) as es`,
      [rutaDe(TENANT_A)],
    )
    expect(fila?.tienda).toBeNull()
    expect(fila?.sociedad).toBe(TENANT_A.companyId)
    expect(fila?.es).toBe(true)
  })

  it('y una ruta de tienda no se cuela como de sociedad', async () => {
    const [fila] = await svc<{ es: boolean; sociedad: string | null }>(
      `select ebim.storage_is_company_path($1) as es, ebim.storage_company($1) as sociedad`,
      [`${TENANT_A.organizationId}/${tiendaA}/branding/logo.webp`],
    )
    expect(fila?.es).toBe(false)
    expect(fila?.sociedad).toBeNull()
  })
})

describe('C · qué logo puede LEER el comprador anónimo', () => {
  it('el de una sociedad con vitrina activa', async () => {
    await svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
      rutaDe(TENANT_A),
    ])

    const vistos = await comoAnon(() =>
      svc<{ name: string }>(`select name from storage.objects where bucket_id = 'store-assets'`),
    )
    expect(vistos.map((o) => o.name)).toContain(rutaDe(TENANT_A))
  })

  it('y ninguno si la sociedad no tiene tienda que lo publique', async () => {
    // Es el equivalente de `store_object_visible` un nivel más arriba: el logo
    // de una marca se ve porque hay una vitrina donde verlo.
    await svc(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
      rutaDe(TENANT_A),
    ])

    // `finally` y no dos líneas seguidas: si la lectura falla, la tienda tiene
    // que volver a quedar activa igual. Sin esto, un fallo aquí deja el resto
    // del archivo mirando una tienda suspendida y los errores salen en cadena,
    // señalando a cualquier sitio menos al que falló.
    let vistos: { name: string }[] = []
    try {
      await svc(`update public.stores set status = 'suspended' where id = $1`, [tiendaA])
      vistos = await comoAnon(() =>
        svc<{ name: string }>(`select name from storage.objects where bucket_id = 'store-assets'`),
      )
    } finally {
      await svc(`update public.stores set status = 'active' where id = $1`, [tiendaA])
    }

    expect(vistos.map((o) => o.name)).not.toContain(rutaDe(TENANT_A))
  })
})

// ---------------------------------------------------------------------------
// D · public_brands
// ---------------------------------------------------------------------------

describe('D · public_brands', () => {
  it('trae la marca de la tienda con su logo, en una consulta', async () => {
    await guardarLogo(rutaDe(TENANT_A))

    const filas = await comoAnon(() =>
      svc<{ code: string; name: string; logo_url: string | null; store_id: string }>(
        `select store_id, code, name, logo_url from public.public_brands where store_id = $1`,
        [tiendaA],
      ),
    )

    expect(filas).toHaveLength(1)
    expect(filas[0]?.code).toBe('marca-propia')
    expect(filas[0]?.logo_url).toBe(rutaDe(TENANT_A))
  })

  it('devuelve la marca sin logo igual: la vitrina cae al monograma', async () => {
    const filas = await comoAnon(() =>
      svc<{ logo_url: string | null }>(
        `select logo_url from public.public_brands where store_id = $1`,
        [tiendaA],
      ),
    )
    expect(filas).toHaveLength(1)
    expect(filas[0]?.logo_url).toBeNull()
  })

  it('no cruza tiendas: la marca de B no sale en A', async () => {
    const filas = await comoAnon(() =>
      svc<{ store_id: string; name: string }>(
        `select store_id, name from public.public_brands order by name`,
      ),
    )

    const porTienda = new Map(filas.map((f) => [f.store_id, f.name]))
    expect(porTienda.get(tiendaA)).toBe(`Marca ${TENANT_A.slug}`)
    expect(porTienda.get(tiendaB)).toBe(`Marca ${TENANT_B.slug}`)
    expect(filas).toHaveLength(2)
  })

  it('NO publica el tenant ni la descripción', async () => {
    const [fila] = await comoAnon(() =>
      svc<Record<string, unknown>>(`select * from public.public_brands limit 1`),
    )

    expect(Object.keys(fila ?? {}).sort()).toEqual(['brand_id', 'code', 'logo_url', 'name', 'store_id'])
  })

  it('una marca apagada desaparece', async () => {
    await svc(`update public.brands set is_active = false where id = $1`, [marcaA])
    const filas = await comoAnon(() =>
      svc(`select code from public.public_brands where store_id = $1`, [tiendaA]),
    )
    await svc(`update public.brands set is_active = true where id = $1`, [marcaA])

    expect(filas).toHaveLength(0)
  })

  it('una publicación en borrador no saca la marca a la vitrina', async () => {
    await svc(`update public.store_products set status = 'draft' where store_id = $1`, [tiendaA])
    const filas = await comoAnon(() =>
      svc(`select code from public.public_brands where store_id = $1`, [tiendaA]),
    )
    await svc(`update public.store_products set status = 'published' where store_id = $1`, [tiendaA])

    expect(filas).toHaveLength(0)
  })

  it('una publicación programada para mañana tampoco', async () => {
    await svc(
      `update public.store_products set published_at = now() + interval '1 day' where store_id = $1`,
      [tiendaA],
    )
    const filas = await comoAnon(() =>
      svc(`select code from public.public_brands where store_id = $1`, [tiendaA]),
    )
    await svc(
      `update public.store_products set published_at = now() - interval '1 day' where store_id = $1`,
      [tiendaA],
    )

    expect(filas).toHaveLength(0)
  })

  it('una tienda suspendida saca su marca de la vitrina', async () => {
    await svc(`update public.stores set status = 'suspended' where id = $1`, [tiendaA])
    const filas = await comoAnon(() =>
      svc(`select code from public.public_brands where store_id = $1`, [tiendaA]),
    )
    await svc(`update public.stores set status = 'active' where id = $1`, [tiendaA])

    expect(filas).toHaveLength(0)
  })

  it('sigue siendo security_invoker: las policies mandan, la vista no las tapa', async () => {
    const [opciones] = await svc<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'public_brands'`,
    )
    expect(opciones?.reloptions ?? []).toContain('security_invoker=on')
  })

  it('anon no puede ESCRIBIR una marca, solo leerla', async () => {
    const error = await expectFailure(() =>
      comoAnon(() =>
        svc(`update public.brands set logo_url = $1 where id = $2`, [rutaDe(TENANT_A), marcaA]),
      ),
    )
    expect(error).toMatch(/permission denied|denegado|row-level security/i)
  })

  it('el admin de B no cambia el logo de una marca de A, ni al revés', async () => {
    // Las dos direcciones, porque una policy mal escrita puede filtrar en un
    // sentido y no en el otro — y con una sola prueba se ve la mitad.
    expect(await guardarLogo(rutaDe(TENANT_B), marcaA, TENANT_B)).toHaveLength(0)
    expect(await guardarLogo(rutaDe(TENANT_A), marcaB, TENANT_A)).toHaveLength(0)

    const logos = await svc<{ id: string; logo_url: string | null }>(
      `select id, logo_url from public.brands`,
    )
    expect(logos.every((fila) => fila.logo_url === null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E · La familia de producto no heredó nada
// ---------------------------------------------------------------------------

describe('E · una familia de producto sigue sin logo', () => {
  it('`product_families` no tiene columna de logo, y no debe tenerla', async () => {
    // Una familia clasifica («Calzado», «Bebidas») y no se enseña al comprador:
    // no hay dónde pintar su logo. El día que aparezca esta columna, alguien
    // habrá copiado el esquema de la marca sin mirar para qué sirve cada una.
    const filas = await svc<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'product_families'
          and column_name = 'logo_url'`,
    )
    expect(filas).toHaveLength(0)
  })

  it('y las marcas de B no se ven desde A ni con service_role de por medio', async () => {
    const vistas = await comoAdmin(TENANT_A, () =>
      svc<{ id: string }>(`select id from public.brands`),
    )
    expect(vistas.map((b) => b.id)).toEqual([marcaA])
  })
})
