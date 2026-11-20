// @vitest-environment node
/**
 * P11-SaaS · La búsqueda del catálogo contra Postgres REAL.
 *
 * Lo que se prueba es lo que hace que un buscador sea usable y no un peligro:
 *
 *  · **encuentra** — por nombre, por descripción, por marca y por categoría, y
 *    sin importar acentos ni mayúsculas;
 *  · **tolera erratas** — pero solo como PLAN B: primero la coincidencia
 *    exacta, y el modo lo dice para que la vitrina pueda advertirlo;
 *  · **ordena** — el nombre pesa más que la descripción, y lo disponible sube;
 *  · **filtra y cuenta en el SERVIDOR** — categoría, marca, atributos,
 *    disponibilidad y precio, con las facetas ya contadas: el navegador nunca
 *    recibe el catálogo entero;
 *  · **aísla** — la tienda de al lado no aparece jamás, ni por término, ni por
 *    faceta, ni en el autocompletado;
 *  · **se configura sin desplegar** — un sinónimo es una fila, y a partir de
 *    ella «tenis» encuentra la zapatilla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>
type Json = Record<string, unknown>

let db: PGlite

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'

let storeA: string
let storeB: string
let catCalzado: string
let catHogar: string
let brandAcme: string
let atributoColor: string
let valorRojo: string
let zapatilla: string
let borrador: string

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

/** La puerta ANÓNIMA de la vitrina. */
async function search(
  term: string | null,
  filters: Json = {},
  options: { slug?: string; sort?: string; limit?: number; offset?: number } = {},
): Promise<Json> {
  const rows = await asRole(db, 'anon', null, () =>
    sql(`select public.catalog_search_for_slug($1, $2, $3::jsonb, $4, $5, $6) as r`, [
      options.slug ?? STORE_A_SLUG,
      term,
      JSON.stringify(filters),
      options.sort ?? 'relevance',
      options.limit ?? 24,
      options.offset ?? 0,
    ]),
  )
  return rows[0]?.r as Json
}

function names(result: Json): string[] {
  return ((result.items ?? []) as Json[]).map((item) => String(item.name))
}

function facet(result: Json, group: string): Json[] {
  return (((result.facets ?? {}) as Json)[group] ?? []) as Json[]
}

async function suggest(term: string, slug = STORE_A_SLUG): Promise<Json[]> {
  const rows = await asRole(db, 'anon', null, () =>
    sql(`select public.catalog_suggest_for_slug($1, $2, 8) as r`, [slug, term]),
  )
  return (rows[0]?.r ?? []) as Json[]
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

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
  storeB = String(stores.find((s) => s.slug === STORE_B_SLUG)?.id)

  const insertCategory = `
    insert into public.categories (organization_id, company_id, store_id, slug, name)
    values ($1, $2, $3, $4, $5) returning id`
  catCalzado = await id(insertCategory, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'calzado', 'Calzado',
  ])
  catHogar = await id(insertCategory, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'hogar', 'Hogar',
  ])

  brandAcme = await id(
    `insert into public.brands (organization_id, company_id, code, name)
     values ($1, $2, 'acme', 'Acme') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )

  const insertProduct = `
    insert into public.products
      (organization_id, company_id, store_id, sku, slug, name, description, price, currency,
       stock, status, published_at, category_id, brand_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8, 'PEN', $9, $10, $11, $12, $13)
    returning id`

  const hace = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

  zapatilla = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-ZAP', 'zapatilla-runner',
    'Zapatilla Runner', 'Para correr en asfalto.', '199.90', 20, 'published', hace(60),
    catCalzado, brandAcme,
  ])
  await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-BOTA', 'bota-montana',
    'Bota de montaña', 'Impermeable, con suela de agarre.', '349.00', 5, 'published', hace(50),
    catCalzado, null,
  ])
  // Agotado a propósito: sirve para el filtro de disponibilidad y para
  // comprobar que lo disponible sube en el ranking.
  await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-SAND', 'sandalia',
    'Sandalia de verano', 'Zapatilla ligera para la playa.', '89.00', 0, 'published', hace(40),
    catCalzado, null,
  ])
  await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-LAMP', 'lampara-mesa',
    'Lámpara de mesa', 'Luz cálida regulable.', '120.00', 8, 'published', hace(30),
    catHogar, brandAcme,
  ])
  borrador = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-SECRETA', 'zapatilla-secreta',
    'Zapatilla sin publicar', 'Todavía no sale.', '99.00', 10, 'draft', null,
    catCalzado, null,
  ])
  await id(insertProduct, [
    TENANT_B.organizationId, TENANT_B.companyId, storeB, 'B-ZAP', 'zapatilla-de-b',
    'Zapatilla de B', 'Del tenant vecino.', '150.00', 10, 'published', hace(20),
    null, null,
  ])

  // Atributo de filtro: color.
  atributoColor = await id(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, is_filterable)
     values ($1, $2, 'color', 'Color', 'option', true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  valorRojo = await id(
    `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
     values ($1, $2, $3, 'rojo', 'Rojo') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, atributoColor],
  )
  // El valor «azul» existe en el vocabulario pero NO se asigna a ningun
  // producto: es lo que permite comprobar que filtrar por el devuelve vacio en
  // vez de ignorarse.
  await svc(
    `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
     values ($1, $2, $3, 'azul', 'Azul')`,
    [TENANT_A.organizationId, TENANT_A.companyId, atributoColor],
  )
  await svc(
    `insert into public.product_attribute_values
       (organization_id, company_id, store_id, product_id, attribute_id, value_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, zapatilla, atributoColor, valorRojo],
  )
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('encontrar', () => {
  it('encuentra por nombre, en singular y en plural', async () => {
    expect(names(await search('zapatilla'))).toContain('Zapatilla Runner')
    expect(names(await search('zapatillas'))).toContain('Zapatilla Runner')
  })

  it('ignora acentos y mayusculas, en el dato y en la consulta', async () => {
    expect(names(await search('LAMPARA'))).toContain('Lámpara de mesa')
    expect(names(await search('lámpara'))).toContain('Lámpara de mesa')
    expect(names(await search('montana'))).toContain('Bota de montaña')
    expect(names(await search('MONTAÑA'))).toContain('Bota de montaña')
  })

  it('encuentra por descripcion, pero el NOMBRE pesa mas', async () => {
    const result = await search('zapatilla')
    // «Zapatilla Runner» lo lleva en el nombre; «Sandalia de verano» solo en la
    // descripción. Sin pesos, la descripción podría ganar y la única búsqueda
    // que el comprador esperaba que funcionara sería la que falla.
    expect(names(result)[0]).toBe('Zapatilla Runner')
    expect(names(result)).toContain('Sandalia de verano')
  })

  it('encuentra por marca y por categoria, que viven en otras tablas', async () => {
    expect(names(await search('acme')).sort()).toEqual(['Lámpara de mesa', 'Zapatilla Runner'])
    expect(names(await search('calzado'))).toContain('Bota de montaña')
  })

  it('varias palabras se combinan con Y, no con O — tambien en el plan B', async () => {
    expect(names(await search('bota montana'))).toEqual(['Bota de montaña'])
    // Cada palabra existe en un producto distinto. Sin la regla de que TODOS
    // los terminos tienen que parecerse, el plan B habria devuelto los dos y
    // convertido el Y en un O silencioso.
    const cruzada = await search('bota lampara')
    expect(names(cruzada)).toEqual([])
    expect(cruzada.mode).toBe('empty')
  })

  it('lo NO publicado no sale por la puerta publica', async () => {
    const result = await search('zapatilla')
    expect(names(result)).not.toContain('Zapatilla sin publicar')
  })

  it('un termino vacio es NAVEGAR el catalogo, y lo dice el modo', async () => {
    const result = await search(null)
    expect(result.mode).toBe('browse')
    expect(Number(result.total)).toBe(4)
  })
})

describe('tolerancia a erratas: plan B, no plan A', () => {
  it('una errata dentro de la palabra encuentra igual, y el modo avisa', async () => {
    // «zapatolla»: la vocal cambiada esta ANTES del final, asi que la busqueda
    // por prefijo no la salva y hace falta el plan B.
    const result = await search('zapatolla')
    expect(names(result)).toContain('Zapatilla Runner')
    expect(result.mode).toBe('fuzzy')
  })

  it('una letra de menos AL FINAL la salva ya el prefijo, sin trigramas', async () => {
    // «zapatila» lematiza a un prefijo que sigue casando: el plan A basta, y
    // por eso el modo NO es `fuzzy`. Es la propiedad que hace barato el
    // buscador: los trigramas solo corren cuando el texto no encontro nada.
    expect((await search('zapatila')).mode).toBe('fts')
  })

  it('una coincidencia exacta NO pasa por trigramas: el modo es `fts`', async () => {
    expect((await search('zapatilla')).mode).toBe('fts')
  })

  it('lo que no se parece a nada devuelve vacio, no el catalogo entero', async () => {
    const result = await search('bicicleta')
    expect(names(result)).toEqual([])
    expect(result.mode).toBe('empty')
    expect(Number(result.total)).toBe(0)
  })
})

describe('ordenacion', () => {
  it('lo disponible sube por delante de lo agotado con la misma coincidencia', async () => {
    const result = await search('zapatilla')
    const items = (result.items ?? []) as Json[]
    const runner = items.findIndex((item) => item.name === 'Zapatilla Runner')
    const sandalia = items.findIndex((item) => item.name === 'Sandalia de verano')
    expect(runner).toBeLessThan(sandalia)
  })

  it('los cuatro ordenes explicitos hacen lo que dicen', async () => {
    expect(names(await search(null, {}, { sort: 'price-asc' }))[0]).toBe('Sandalia de verano')
    expect(names(await search(null, {}, { sort: 'price-desc' }))[0]).toBe('Bota de montaña')
    expect(names(await search(null, {}, { sort: 'name' }))[0]).toBe('Bota de montaña')
    expect(names(await search(null, {}, { sort: 'recent' }))[0]).toBe('Lámpara de mesa')
  })

  it('un orden desconocido cae a relevancia en vez de fallar', async () => {
    const result = await search(null, {}, { sort: 'ni-idea' })
    expect(result.sort).toBe('relevance')
  })
})

describe('filtros y facetas, contados en el SERVIDOR', () => {
  it('filtra por categoria', async () => {
    const result = await search(null, { category: 'hogar' })
    expect(names(result)).toEqual(['Lámpara de mesa'])
  })

  it('filtra por marca', async () => {
    expect(names(await search(null, { brands: ['acme'] })).sort()).toEqual([
      'Lámpara de mesa',
      'Zapatilla Runner',
    ])
  })

  it('filtra por disponibilidad', async () => {
    const result = await search(null, { availability: 'in-stock' })
    expect(names(result)).not.toContain('Sandalia de verano')
    expect(Number(result.total)).toBe(3)
  })

  it('filtra por rango de precio, con los importes como TEXTO', async () => {
    const result = await search(null, { price_min: '100.00', price_max: '200.00' })
    expect(names(result).sort()).toEqual(['Lámpara de mesa', 'Zapatilla Runner'])
  })

  it('un rango de precio que no es un numero se ignora en vez de reventar', async () => {
    const result = await search(null, { price_min: 'mucho' })
    expect(Number(result.total)).toBe(4)
  })

  it('filtra por atributo del PIM', async () => {
    expect(names(await search(null, { attributes: { color: ['rojo'] } }))).toEqual([
      'Zapatilla Runner',
    ])
    expect(names(await search(null, { attributes: { color: ['azul'] } }))).toEqual([])
  })

  it('las facetas llegan CONTADAS: el navegador no cuenta nada', async () => {
    const result = await search(null)

    const categorias = facet(result, 'categories')
    expect(categorias.find((c) => c.slug === 'calzado')?.count).toBe(3)
    expect(categorias.find((c) => c.slug === 'hogar')?.count).toBe(1)

    const marcas = facet(result, 'brands')
    expect(marcas.find((b) => b.code === 'acme')?.count).toBe(2)

    const atributos = facet(result, 'attributes')
    const color = atributos.find((a) => a.code === 'color')
    expect(((color?.values ?? []) as Json[])[0]).toMatchObject({ code: 'rojo', count: 1 })

    const precio = ((result.facets ?? {}) as Json).price as Json
    expect(precio.min).toBe('89.00')
    expect(precio.max).toBe('349.00')

    const disponibilidad = ((result.facets ?? {}) as Json).availability as Json
    expect(disponibilidad).toMatchObject({ in_stock: 3, total: 4 })
  })

  it('la respuesta es una PAGINA: `total` no depende de `limit`', async () => {
    const result = await search(null, {}, { limit: 2 })
    expect(((result.items ?? []) as Json[]).length).toBe(2)
    expect(Number(result.total)).toBe(4)
    expect(Number(result.limit)).toBe(2)
  })

  it('el `offset` avanza sin repetir', async () => {
    const primera = names(await search(null, {}, { sort: 'name', limit: 2, offset: 0 }))
    const segunda = names(await search(null, {}, { sort: 'name', limit: 2, offset: 2 }))
    expect(primera).toHaveLength(2)
    expect(segunda).toHaveLength(2)
    expect(primera.some((name) => segunda.includes(name))).toBe(false)
  })
})

describe('sinonimos: mejorar el discovery sin desplegar', () => {
  it('sin sinonimo, «tenis» no encuentra la zapatilla; con el, si', async () => {
    expect(names(await search('tenis'))).toEqual([])

    const synonym = await id(
      `insert into public.search_synonyms
         (organization_id, company_id, store_id, term, expansions)
       values ($1, $2, $3, 'tenis', array['zapatilla']) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )

    expect(names(await search('tenis'))).toContain('Zapatilla Runner')

    // Apagarlo lo deshace sin borrar la fila: la configuración se revierte, no
    // se pierde.
    await svc(`update public.search_synonyms set is_active = false where id = $1`, [synonym])
    expect(names(await search('tenis'))).toEqual([])

    await svc(`delete from public.search_synonyms where id = $1`, [synonym])
  })

  it('el termino se normaliza en el DATO: «Tenis » y «tenis» son el mismo', async () => {
    const first = await id(
      `insert into public.search_synonyms
         (organization_id, company_id, store_id, term, expansions)
       values ($1, $2, $3, 'Tenis ', array['zapatilla']) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )

    const message = await expectFailure(() =>
      svc(
        `insert into public.search_synonyms
           (organization_id, company_id, store_id, term, expansions)
         values ($1, $2, $3, 'tenis', array['otra'])`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(message).toMatch(/duplicate key|search_synonyms_term_key/i)

    await svc(`delete from public.search_synonyms where id = $1`, [first])
  })

  it('una expansion vacia o demasiado corta no entra', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.search_synonyms
           (organization_id, company_id, store_id, term, expansions)
         values ($1, $2, $3, 'algo', array['---'])`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(message).toMatch(/search_synonyms_expansions_shape|violates check/i)
  })

  it('un sinonimo de A no afecta a la busqueda de B', async () => {
    const synonym = await id(
      `insert into public.search_synonyms
         (organization_id, company_id, store_id, term, expansions)
       values ($1, $2, $3, 'tenis', array['zapatilla']) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )

    expect(names(await search('tenis', {}, { slug: STORE_B_SLUG }))).toEqual([])

    await svc(`delete from public.search_synonyms where id = $1`, [synonym])
  })
})

describe('autocompletado', () => {
  it('sugiere primero lo que EMPIEZA por lo tecleado', async () => {
    const suggestions = await suggest('zapa')
    expect(String(suggestions[0]?.label)).toBe('Zapatilla Runner')
    expect(suggestions.every((s) => s.kind !== undefined)).toBe(true)
  })

  it('sugiere tambien categorias y marcas, con su tipo', async () => {
    const kinds = new Set((await suggest('acme')).map((s) => String(s.kind)))
    expect(kinds.has('brand')).toBe(true)

    const cats = (await suggest('calza')).map((s) => String(s.kind))
    expect(cats).toContain('category')
  })

  it('con un solo caracter no sugiere nada: seria el catalogo entero', async () => {
    expect(await suggest('z')).toEqual([])
  })

  it('no sugiere lo NO publicado', async () => {
    const labels = (await suggest('zapatilla')).map((s) => String(s.label))
    expect(labels).not.toContain('Zapatilla sin publicar')
  })
})

describe('aislamiento entre tenants', () => {
  it('la busqueda de A nunca devuelve el producto de B', async () => {
    expect(names(await search('zapatilla'))).not.toContain('Zapatilla de B')
    expect(names(await search('zapatilla', {}, { slug: STORE_B_SLUG }))).toEqual(['Zapatilla de B'])
  })

  it('el autocompletado tampoco cruza tiendas', async () => {
    const labels = (await suggest('zapatilla')).map((s) => String(s.label))
    expect(labels).not.toContain('Zapatilla de B')
  })

  it('una tienda inactiva no responde', async () => {
    await svc(`update public.stores set status = 'suspended' where id = $1`, [storeB])
    const message = await asRole(db, 'anon', null, () =>
      expectFailure(() =>
        sql(`select public.catalog_search_for_slug($1, 'zapatilla') as r`, [STORE_B_SLUG]),
      ),
    )
    expect(message).toMatch(/TIENDA_NO_DISPONIBLE/)
    await svc(`update public.stores set status = 'active' where id = $1`, [storeB])
  })

  it('`anon` no lee el vector de busqueda: es el catalogo deshecho en lexemas', async () => {
    const rows = await sql(`
      select privilege_type
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'products'
        and column_name = 'search_vector' and grantee in ('anon', 'PUBLIC')
    `)
    expect(rows).toEqual([])
  })

  it('`anon` no puede llamar a la busqueda del BACKOFFICE', async () => {
    const rows = await sql(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.rolname = 'anon'
      where n.nspname = 'public' and p.proname = 'catalog_search'
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(rows).toEqual([])
  })
})

describe('la busqueda del backoffice es OTRA pregunta, no la misma con otro token', () => {
  it('incluye lo NO publicado y lo marca', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.catalog_search($1, 'zapatilla') as r`, [storeA]),
    )
    const result = rows[0]?.r as Json
    const items = (result.items ?? []) as Json[]
    const secreta = items.find((item) => item.name === 'Zapatilla sin publicar')
    expect(secreta).toBeDefined()
    expect(secreta?.published).toBe(false)
    expect(items.find((item) => item.name === 'Zapatilla Runner')?.published).toBe(true)
  })

  it('exige membresia: la tienda de otro responde SIN_PERMISO', async () => {
    const message = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      expectFailure(() => sql(`select public.catalog_search($1) as r`, [storeB])),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('el borrador sigue sin salir por la puerta publica', async () => {
    expect(names(await search('zapatilla'))).not.toContain('Zapatilla sin publicar')
    expect(borrador).toBeTruthy()
  })
})

describe('el indice no puede desincronizarse', () => {
  it('`search_vector` es una columna GENERADA: no se puede escribir a mano', async () => {
    const message = await expectFailure(() =>
      svc(`update public.products set search_vector = null where id = $1`, [zapatilla]),
    )
    expect(message).toMatch(/generated column|can only be updated to DEFAULT/i)
  })

  it('renombrar el producto cambia lo que encuentra, sin tocar nada mas', async () => {
    await svc(`update public.products set name = 'Zapatilla Trail' where id = $1`, [zapatilla])
    expect(names(await search('trail'))).toEqual(['Zapatilla Trail'])
    await svc(`update public.products set name = 'Zapatilla Runner' where id = $1`, [zapatilla])
    expect(names(await search('trail'))).toEqual([])
  })
})

describe('2026-11-20 · los productos de UNA campaña (filtro promotion)', () => {
  async function campana(code: string, store: string, tenant: typeof TENANT_A, status: string, productName: string | null) {
    const promo = await id(
      `insert into public.promotions
         (organization_id, company_id, store_id, code, name, kind, value_percent, status, valid_from)
       values ($1, $2, $3, $4, 'Liquidación', 'percentage', 15, $5::public.promotion_status, now() - interval '1 day')
       returning id`,
      [tenant.organizationId, tenant.companyId, store, code, status],
    )
    if (productName) {
      const [prod] = await svc(`select id from public.products where name = $1 and store_id = $2`, [productName, store])
      await svc(
        `insert into public.promotion_scopes
           (organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, product_id)
         values ($1, $2, $3, $4, 'percentage', 'product', $5)`,
        [tenant.organizationId, tenant.companyId, store, promo, prod?.id],
      )
    }
    return promo
  }

  it('enseña solo los productos de la campaña, y la portada sabe que los tiene', async () => {
    const promo = await campana('liq-activa', storeA, TENANT_A, 'active', 'Bota de montaña')
    expect(names(await search(null, { promotion: promo }))).toEqual(['Bota de montaña'])

    const rows = await asRole(db, 'anon', null, () =>
      sql(`select public.store_promotions_for_slug($1) as r`, [STORE_A_SLUG]),
    )
    const promos = ((rows[0]?.r as Json).promotions ?? []) as Json[]
    expect(promos.find((p) => p.id === promo)?.has_products).toBe(true)
  })

  it('un borrador, una campaña de otra tienda o un id roto no enseñan nada', async () => {
    const borradorPromo = await campana('liq-borrador', storeA, TENANT_A, 'draft', 'Bota de montaña')
    expect(names(await search(null, { promotion: borradorPromo }))).toEqual([])

    const ajena = await campana('liq-ajena', storeB, TENANT_B, 'active', null)
    expect(names(await search(null, { promotion: ajena }))).toEqual([])

    expect(names(await search(null, { promotion: 'no-es-un-uuid' }))).toEqual([])
  })
})
