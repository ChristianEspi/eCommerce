// @vitest-environment node
/**
 * Limpieza del catálogo (2026-11-22) · `catalog_cleanup_rows`.
 *
 * Lo que se fija: devuelve los productos no archivados de la tienda pedida con
 * sus huecos (foto, descripción, categoría); el owner de otro tenant no ve nada
 * aunque pida la tienda ajena; anon no puede llamarla; sin precios.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

let db: PGlite
const store: Record<string, string> = {}

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function filas(tenant: typeof TENANT_A, storeId: string) {
  return asRole(db, 'authenticated', claimsFor(tenant), async () =>
    (await db.query<Record<string, unknown>>(`select * from public.catalog_cleanup_rows($1)`, [storeId])).rows,
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
    store[tenant.slug] = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [tenant.storeSlug]))[0]!.id
  }
  for (const [sku, nombre, descripcion, estado] of [
    ['LEJ-1', 'Lejía 1 L', 'Lejía de uso doméstico', 'published'],
    ['LEJ-5', 'Lejía 5 L', null, 'draft'],
    ['VIEJO', 'Producto viejo', null, 'archived'],
  ] as const) {
    await svc(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, description, price, currency, stock, status, published_at)
       values ($1, $2, $3, $4, lower($4), $5, $6, '10.00', 'PEN', 10, $7::public.product_status, now())`,
      [TENANT_A.organizationId, TENANT_A.companyId, store[TENANT_A.slug], sku, nombre, descripcion, estado],
    )
  }
})

afterAll(async () => {
  await db?.close()
})

describe('catalog_cleanup_rows', () => {
  it('lista lo no archivado de la tienda con sus huecos, sin precios', async () => {
    const r = await filas(TENANT_A, store[TENANT_A.slug]!)
    expect(r.map((x) => x.sku)).toEqual(['LEJ-1', 'LEJ-5'])
    expect(r[1]).toMatchObject({ has_description: false, has_image: false })
    expect(r[0]).toMatchObject({ has_description: true })
    expect(Object.keys(r[0]!)).not.toContain('price')
  })

  it('otro tenant no ve la tienda ajena; anon no puede llamarla', async () => {
    expect(await filas(TENANT_B, store[TENANT_A.slug]!)).toEqual([])
    const mensaje = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query(`select * from public.catalog_cleanup_rows($1)`, [store[TENANT_A.slug]])),
    )
    expect(mensaje).toMatch(/permission denied/)
  })
})
