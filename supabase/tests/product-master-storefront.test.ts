// @vitest-environment node
/**
 * Vitrina, B2B y engagement sobre la publicación por tienda
 * (Stores + Product Master, fase 05 · paso C).
 *
 * El MISMO maestro P se publica en A1 y A2 con dirección y categoría distintas;
 * D se publica en A1 y queda en borrador en A2; S solo en A1. Lo que queda
 * fijado: cada vitrina busca con SU dirección y SU categoría; lo que está en
 * borrador en una tienda no se encuentra allí; el favorito es de la tienda y
 * sale de la lista al despublicar sin borrar el maestro; la reseña sobrevive a
 * la despublicación; el pedido rápido de A2 no resuelve un SKU publicado solo en
 * A1; y los relacionados se muestran solo si están publicados en esa tienda.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure, type JwtClaims } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA1: string
let storeA2: string
let productP: string
let productD: string
let productS: string

const SLUG_A1 = TENANT_A.storeSlug
const SLUG_A2 = 'tienda-a2-vitrina'
const BUYER = '0a000000-0000-4000-8000-00000000b001'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))
const owner = (query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claimsFor(TENANT_A), () => sql(query, params))
const anon = (query: string, params: unknown[] = []) => asRole(db, 'anon', null, () => sql(query, params))
const shopper = (): JwtClaims => ({ sub: BUYER, email: 'comprador@compras.test', org_id: '', companies: [], active_company: '' })
const buyer = (query: string, params: unknown[] = []) => asRole(db, 'authenticated', shopper(), () => sql(query, params))

async function master(sku: string, name: string): Promise<string> {
  return String((await owner(
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), $1, $2, 10, 'simple') returning id`,
    [sku, name],
  ))[0]?.id)
}

async function category(store: string, slug: string, name: string): Promise<string> {
  return String((await svc(
    `insert into public.categories (organization_id, company_id, store_id, slug, name)
     values ($1, $2, $3, $4, $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, slug, name],
  ))[0]?.id)
}

async function publish(product: string, store: string, slug: string, category: string | null, status = 'published') {
  await owner(`select public.publish_product($1, $2, $3, 20, $4, $5::public.product_status)`, [
    product, store, slug, category, status,
  ])
}

async function search(slug: string, term: string): Promise<Row[]> {
  const rows = await anon(`select public.catalog_search_for_slug($1, $2, '{}'::jsonb, 'relevance', 24, 0) as r`, [
    slug, term,
  ])
  return (((rows[0]?.r as Row).items ?? []) as Row[])
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda A1', 'PEN')`, [
    TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.slug, TENANT_A.slug,
    TENANT_A.adminEmail, TENANT_A.ownerId, SLUG_A1,
  ])
  storeA1 = String((await svc(`select id from public.stores where slug = $1`, [SLUG_A1]))[0]?.id)
  const created = await owner(`select public.create_store($1, 'Tienda A2', 'PEN') as r`, [SLUG_A2])
  storeA2 = String((created[0]?.r as Row).id)
  await svc(`update public.stores set status = 'active'`)

  const zapatosA1 = await category(storeA1, 'zapatos', 'Zapatos')
  const outletA2 = await category(storeA2, 'outlet', 'Outlet')

  productP = await master('ZAP-1', 'Zapatilla urbana')
  productD = await master('ZAP-2', 'Zapatilla borrador')
  productS = await master('ZAP-3', 'Zapatilla solo A1')
  await publish(productP, storeA1, 'zapatilla-urbana', zapatosA1)
  await publish(productP, storeA2, 'zapatilla-urbana-outlet', outletA2)
  await publish(productD, storeA1, 'zapatilla-borrador', null)
  await publish(productD, storeA2, 'zapatilla-borrador', null, 'draft')
  await publish(productS, storeA1, 'zapatilla-solo-a1', null)
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('búsqueda por tienda', () => {
  it('cada vitrina encuentra el mismo maestro con SU dirección y SU categoría', async () => {
    const a1 = (await search(SLUG_A1, 'zapatilla')).find((item) => item.product_id === productP || item.id === productP)
    const a2 = (await search(SLUG_A2, 'zapatilla')).find((item) => item.product_id === productP || item.id === productP)
    expect(a1).toMatchObject({ slug: 'zapatilla-urbana', category_slug: 'zapatos' })
    expect(a2).toMatchObject({ slug: 'zapatilla-urbana-outlet', category_slug: 'outlet' })
  })

  it('lo que está en borrador o no publicado en A2 no se encuentra en A2', async () => {
    const a2 = (await search(SLUG_A2, 'zapatilla')).map((item) => String(item.name))
    expect(a2).toContain('Zapatilla urbana')
    expect(a2).not.toContain('Zapatilla borrador')
    expect(a2).not.toContain('Zapatilla solo A1')
    const a1 = (await search(SLUG_A1, 'zapatilla')).map((item) => String(item.name))
    expect(a1).toEqual(expect.arrayContaining(['Zapatilla urbana', 'Zapatilla borrador', 'Zapatilla solo A1']))
  })
})

describe('favoritos por tienda', () => {
  it('guardar en A1 no lo guarda en A2, y despublicar A1 lo saca de la lista sin borrar el maestro', async () => {
    expect((await buyer(`select public.toggle_product_favorite($1, $2) as s`, [productP, storeA1]))[0]?.s).toBe(true)
    const inA1 = async () => (await buyer(`select product_id from public.my_product_favorites($1)`, [storeA1])).map((r) => r.product_id)
    const inA2 = async () => (await buyer(`select product_id from public.my_product_favorites($1)`, [storeA2])).map((r) => r.product_id)
    expect(await inA1()).toEqual([productP])
    expect(await inA2()).toEqual([])

    expect((await buyer(`select public.toggle_product_favorite($1, $2) as s`, [productP, storeA2]))[0]?.s).toBe(true)
    expect(await inA2()).toEqual([productP])

    await owner(`select public.unpublish_product($1, $2)`, [productP, storeA1])
    expect(await inA1()).toEqual([])
    expect(await inA2()).toEqual([productP])
    expect(await svc(`select count(*)::int as n from public.products where id = $1`, [productP])).toEqual([{ n: 1 }])
    // Republicar: vuelve a estar publicado en A1 para el resto de pruebas.
    await publish(productP, storeA1, 'zapatilla-urbana', null)
  })

  it('no se guarda en una tienda donde no está publicado', async () => {
    const message = await expectFailure(() => buyer(`select public.toggle_product_favorite($1, $2)`, [productS, storeA2]))
    expect(message).toMatch(/PRODUCTO_NO_ENCONTRADO/)
  })
})

describe('reseñas', () => {
  it('una reseña de A1 sobrevive a la despublicación y reaparece al republicar', async () => {
    await buyer(`select public.submit_product_review($1, $2::uuid, $3::jsonb) as r`, [
      SLUG_A1, productS, JSON.stringify({ rating: 5, body: 'Muy cómodas para caminar', display_name: 'Ana' }),
    ])
    expect(
      await svc(`select store_id from public.product_reviews where product_id = $1`, [productS]),
    ).toEqual([{ store_id: storeA1 }])

    // En A2 no está publicado: no se puede opinar allí.
    expect(
      await expectFailure(() =>
        buyer(`select public.submit_product_review($1, $2::uuid, $3::jsonb)`, [
          SLUG_A2, productS, JSON.stringify({ rating: 4, body: 'Otra tienda', display_name: 'Ana' }),
        ]),
      ),
    ).toMatch(/PRODUCTO_NO_DISPONIBLE/)

    await owner(`select public.unpublish_product($1, $2)`, [productS, storeA1])
    expect(await svc(`select count(*)::int as n from public.product_reviews where product_id = $1`, [productS])).toEqual([
      { n: 1 },
    ])
    await publish(productS, storeA1, 'zapatilla-solo-a1', null)
  })
})

describe('pedido rápido y relacionados', () => {
  it('el pedido rápido de A2 no resuelve un SKU publicado solo en A1', async () => {
    const resolve = async (slug: string) =>
      (await buyer(`select public.resolve_order_lines_for_slug($1, $2::jsonb) as r`, [
        slug, JSON.stringify([{ sku: 'ZAP-3', quantity: 1 }]),
      ]))[0]?.r as Row
    const a1 = resolve(SLUG_A1)
    expect(((await a1).lines as Row[])[0]).toMatchObject({ status: 'ok', product_id: productS, slug: 'zapatilla-solo-a1' })
    expect(((await resolve(SLUG_A2)).lines as Row[])[0]).toMatchObject({ status: 'rejected', reason: 'SKU_NO_ENCONTRADO' })
  })

  it('un relacionado solo se muestra en la tienda donde está publicado', async () => {
    await owner(
      `insert into public.product_relations (organization_id, company_id, product_id, related_product_id, relation_kind)
       values (ebim.org_id(), ebim.active_company(), $1, $2, 'cross_sell')`,
      [productP, productS],
    )
    const related = async (slug: string) =>
      (await anon(`select related_product_id from public.product_relations_for_slug($1, $2, null, 10)`, [slug, productP]))
        .map((row) => row.related_product_id)
    expect(await related(SLUG_A1)).toEqual([productS])
    expect(await related(SLUG_A2)).toEqual([])
  })

  it('los KPIs y el uso de categoría cuentan publicaciones de la tienda', async () => {
    const kpiA2 = (await owner(`select public.dashboard_kpis($1) as k`, [storeA2]))[0]?.k as Row
    expect(Number(kpiA2.products)).toBe(2) // P y D (en borrador)
    expect(Number(kpiA2.published_products ?? kpiA2.published)).toBe(1)
  })
})
