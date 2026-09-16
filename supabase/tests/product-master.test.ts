// @vitest-environment node
/**
 * Producto maestro de sociedad + publicación por tienda (Stores + Product Master, fase 03).
 *
 * Esta suite NO parte de una base vacía: aplica las migraciones hasta justo antes
 * de `20260917110000`, siembra datos con la forma LEGACY (un producto por
 * tienda, SKU repetido en dos tiendas de la misma sociedad) y solo entonces
 * aplica el resto. Es la única forma de probar el relleno de verdad.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  applyMigrations,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
  type JwtClaims,
} from './harness.ts'

type Row = Record<string, unknown>

const EXPAND = '20260917110000'

let db: PGlite
let storeA1: string
let storeA2: string
let storeB1: string
let categoryA1: string
let categoryA2: string

const ID = {
  p1: '0a000000-0000-4000-8000-00000000f001',
  p2: '0a000000-0000-4000-8000-00000000f002',
  pv: '0a000000-0000-4000-8000-00000000f003',
  v1: '0a000000-0000-4000-8000-00000000f004',
  pb: '0b000000-0000-4000-8000-00000000f001',
  companyC: '0a000000-0000-4000-8000-0000000000cc',
  storeC: '0a000000-0000-4000-8000-00000000a0cc',
  catalog: '0a000000-0000-4000-8000-0000000000f7',
  viewer: '0a000000-0000-4000-8000-0000000000f8',
}

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))
const anon = (query: string, params: unknown[] = []) => asRole(db, 'anon', null, () => sql(query, params))
const as = (claims: JwtClaims, query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claims, () => sql(query, params))

const member = (sub: string, role: string) =>
  claimsFor(TENANT_A, { sub, email: `${role}@tenant-a.com`, companies: [{ id: TENANT_A.companyId, role }] })

beforeAll(async () => {
  db = await createTestDatabase({ before: EXPAND })

  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
    storeA1 = String((await sql(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
    storeB1 = String((await sql(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)
    storeA2 = String(
      (await sql(
        `insert into public.stores (organization_id, company_id, slug, name, status, currency)
         values ($1, $2, 'tienda-a2', 'Tienda A2', 'active', 'PEN') returning id`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ))[0]?.id,
    )
    await sql(`update public.stores set status = 'active'`)
    // Otra sociedad de la MISMA organización, con su tienda.
    await sql(
      `insert into public.stores (id, organization_id, company_id, slug, name, status, currency)
       values ($1, $2, $3, 'tienda-c', 'Tienda C', 'active', 'PEN')`,
      [ID.storeC, TENANT_A.organizationId, ID.companyC],
    )
    for (const [sub, role] of [[ID.catalog, 'catalog'], [ID.viewer, 'viewer']] as const) {
      await sql(
        `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
         values ($1, $2, $3, $4, $5, 'active')`,
        [TENANT_A.organizationId, TENANT_A.companyId, sub, `${role}@tenant-a.com`, role],
      )
    }
    categoryA1 = String((await sql(
      `insert into public.categories (organization_id, company_id, store_id, slug, name)
       values ($1, $2, $3, 'polos', 'Polos') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
    ))[0]?.id)
    categoryA2 = String((await sql(
      `insert into public.categories (organization_id, company_id, store_id, slug, name)
       values ($1, $2, $3, 'polos-outlet', 'Polos outlet') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    ))[0]?.id)

    // Forma LEGACY: un producto por tienda.
    const insert = `
      insert into public.products
        (id, organization_id, company_id, store_id, category_id, sku, slug, name, price, compare_at_price,
         currency, stock, status, published_at, kind)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PEN', $11, $12, $13, $14)`
    await sql(insert, [ID.p1, TENANT_A.organizationId, TENANT_A.companyId, storeA1, categoryA1,
      'SKU-1', 'polo', 'Polo base', '50.00', '65.00', 10, 'published', '2026-09-01T00:00:00Z', 'simple'])
    // Mismo SKU, otra tienda, MISMA sociedad: el conflicto heredado.
    await sql(insert, [ID.p2, TENANT_A.organizationId, TENANT_A.companyId, storeA2, null,
      'sku-1 ', 'polo-outlet', 'Polo outlet', '40.00', null, 3, 'draft', null, 'simple'])
    await sql(insert, [ID.pv, TENANT_A.organizationId, TENANT_A.companyId, storeA1, null,
      'SKU-V', 'vestido', 'Vestido', '100.00', null, 0, 'published', '2026-09-01T00:00:00Z', 'variant'])
    // El mismo SKU en OTRA sociedad no es conflicto.
    await sql(insert, [ID.pb, TENANT_B.organizationId, TENANT_B.companyId, storeB1, null,
      'SKU-1', 'polo', 'Polo de B', '30.00', null, 1, 'published', '2026-09-01T00:00:00Z', 'simple'])

    await sql(
      `insert into public.product_variants
         (id, organization_id, company_id, store_id, product_id, sku, name, price, compare_at_price, stock, is_default)
       values ($1, $2, $3, $4, $5, 'SKU-V-M', 'Vestido M', '120.00', '150.00', 4, true)`,
      [ID.v1, TENANT_A.organizationId, TENANT_A.companyId, storeA1, ID.pv],
    )
  })

  await applyMigrations(db, { from: EXPAND })
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------
describe('relleno legacy', () => {
  it('cada producto legacy tiene su publicación en su tienda, con su mismo id y sus datos', async () => {
    const rows = await svc(
      `select sp.product_id, sp.store_id, sp.slug, sp.category_id, sp.status::text, sp.price::text,
              sp.compare_at_price::text, sp.currency::text
         from public.store_products sp order by sp.slug, sp.product_id`,
    )
    expect(rows).toEqual([
      { product_id: ID.p1, store_id: storeA1, slug: 'polo', category_id: categoryA1, status: 'published', price: '50.00', compare_at_price: '65.00', currency: 'PEN' },
      { product_id: ID.pb, store_id: storeB1, slug: 'polo', category_id: null, status: 'published', price: '30.00', compare_at_price: null, currency: 'PEN' },
      { product_id: ID.p2, store_id: storeA2, slug: 'polo-outlet', category_id: null, status: 'draft', price: '40.00', compare_at_price: null, currency: 'PEN' },
      { product_id: ID.pv, store_id: storeA1, slug: 'vestido', category_id: null, status: 'published', price: '100.00', compare_at_price: null, currency: 'PEN' },
    ])
    expect(await svc(`select count(*)::int as n from public.products`)).toEqual([{ n: 4 }])
  })

  it('el precio propio de la variante pasa a la tienda', async () => {
    expect(
      await svc(`select store_id, variant_id, price::text, compare_at_price::text from public.store_price_overrides`),
    ).toEqual([{ store_id: storeA1, variant_id: ID.v1, price: '120.00', compare_at_price: '150.00' }])
  })
})

// ---------------------------------------------------------------------------
describe('SKU por sociedad', () => {
  it('el conflicto heredado se marca y se conserva; otra sociedad no cuenta', async () => {
    expect(
      await svc(`select id, legacy_sku_conflict from public.products where id = any($1) order by sku, id`, [[ID.p1, ID.p2, ID.pb]]),
    ).toEqual(
      expect.arrayContaining([
        { id: ID.p1, legacy_sku_conflict: true },
        { id: ID.p2, legacy_sku_conflict: true },
        { id: ID.pb, legacy_sku_conflict: false },
      ]),
    )
  })

  it('no se crean duplicados nuevos, ni contra una variante; en otra sociedad sí vale', async () => {
    const nuevo = (org: string, company: string, sku: string) =>
      svc(
        `insert into public.products (organization_id, company_id, sku, name, kind) values ($1, $2, $3, 'Nuevo', 'simple')`,
        [org, company, sku],
      )
    expect(await expectFailure(() => nuevo(TENANT_A.organizationId, TENANT_A.companyId, 'SKU-1'))).toMatch(/SKU_DUPLICADO/)
    expect(await expectFailure(() => nuevo(TENANT_A.organizationId, TENANT_A.companyId, 'sku-v-m'))).toMatch(/SKU_DUPLICADO/)
    await expect(nuevo(TENANT_A.organizationId, ID.companyC, 'SKU-1')).resolves.toBeDefined()
  })

  it('renombrar el SKU en conflicto lo desmarca', async () => {
    await svc(`update public.products set sku = 'SKU-1-OUT' where id = $1`, [ID.p2])
    expect(await svc(`select legacy_sku_conflict from public.products where id = $1`, [ID.p2])).toEqual([
      { legacy_sku_conflict: false },
    ])
  })
})

// ---------------------------------------------------------------------------
describe('un maestro, varias tiendas', () => {
  it('se publica en otra tienda de la sociedad sin duplicar el maestro', async () => {
    await as(
      member(ID.catalog, 'catalog'),
      `insert into public.store_products
         (organization_id, company_id, store_id, product_id, category_id, slug, status, published_at, price, currency)
       values ($1, $2, $3, $4, $5, 'polo-a2', 'published', now() - interval '1 day', '45.00', 'PEN')`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2, ID.p1, categoryA2],
    )
    expect(await svc(`select count(*)::int as n from public.products where id = $1`, [ID.p1])).toEqual([{ n: 1 }])
    expect(await svc(`select count(*)::int as n from public.store_products where product_id = $1`, [ID.p1])).toEqual([{ n: 2 }])
  })

  it('no se publica en una tienda de otra sociedad, ni de la misma organización', async () => {
    for (const store of [storeB1, ID.storeC]) {
      const message = await expectFailure(() =>
        svc(
          `insert into public.store_products (organization_id, company_id, store_id, product_id, slug, price, currency)
           values ($1, $2, $3, $4, 'intruso', '1.00', 'PEN')`,
          [TENANT_A.organizationId, TENANT_A.companyId, store, ID.p1],
        ),
      )
      expect(message).toMatch(/store_products_store_fk|foreign key/)
    }
  })

  it('la categoría de una publicación es de SU tienda', async () => {
    expect(
      await expectFailure(() =>
        svc(`update public.store_products set category_id = $1 where product_id = $2 and store_id = $3`, [categoryA1, ID.p1, storeA2]),
      ),
    ).toMatch(/store_products_category_fk|foreign key/)
  })

  it('cada tienda ve su slug y su precio; cambiar el maestro se ve en las dos', async () => {
    const vitrina = (store: string) =>
      anon(`select product_id, slug, name, price::text, category_slug from public.public_products where store_id = $1 and product_id = $2`, [store, ID.p1])

    expect(await vitrina(storeA1)).toEqual([{ product_id: ID.p1, slug: 'polo', name: 'Polo base', price: '50.00', category_slug: 'polos' }])
    expect(await vitrina(storeA2)).toEqual([{ product_id: ID.p1, slug: 'polo-a2', name: 'Polo base', price: '45.00', category_slug: 'polos-outlet' }])

    await svc(`update public.products set name = 'Polo base clásico' where id = $1`, [ID.p1])
    expect((await vitrina(storeA1))[0]?.name).toBe('Polo base clásico')
    expect((await vitrina(storeA2))[0]?.name).toBe('Polo base clásico')
  })

  it('despublicar en A1 no toca A2 ni el maestro', async () => {
    await svc(`update public.store_products set status = 'draft' where product_id = $1 and store_id = $2`, [ID.p1, storeA1])

    expect(await anon(`select store_id from public.public_products where product_id = $1`, [ID.p1])).toEqual([{ store_id: storeA2 }])
    expect(await svc(`select count(*)::int as n from public.products where id = $1`, [ID.p1])).toEqual([{ n: 1 }])
    // Transición: la columna legacy de la tienda de origen sigue a su publicación.
    expect(await svc(`select status::text from public.products where id = $1`, [ID.p1])).toEqual([{ status: 'draft' }])

    await svc(`update public.store_products set status = 'published' where product_id = $1 and store_id = $2`, [ID.p1, storeA1])
  })

  it('la vitrina solo enseña publicaciones publicadas, con fecha y de tienda activa', async () => {
    await svc(
      `insert into public.store_products (organization_id, company_id, store_id, product_id, slug, status, published_at, price, currency)
       values ($1, $2, $3, $4, 'vestido-futuro', 'published', now() + interval '10 days', '90.00', 'PEN')`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2, ID.pv],
    )
    expect(await anon(`select 1 from public.public_products where store_id = $1 and product_id = $2`, [storeA2, ID.pv])).toEqual([])

    await svc(`update public.stores set status = 'suspended' where id = $1`, [storeA1])
    expect(await anon(`select 1 from public.public_products where store_id = $1`, [storeA1])).toEqual([])
    await svc(`update public.stores set status = 'active' where id = $1`, [storeA1])
  })

  it('la variante cobra el precio propio de cada tienda, o el de su publicación', async () => {
    await svc(`update public.store_products set published_at = now() - interval '1 day' where product_id = $1 and store_id = $2`, [ID.pv, storeA2])
    const precios = await anon(
      `select store_id, price::text, compare_at_price::text from public.public_product_variants where variant_id = $1 order by price::numeric`,
      [ID.v1],
    )
    expect(precios).toEqual([
      { store_id: storeA2, price: '90.00', compare_at_price: null },
      { store_id: storeA1, price: '120.00', compare_at_price: '150.00' },
    ])
  })
})

// ---------------------------------------------------------------------------
describe('RLS del maestro y la publicación', () => {
  it('otro tenant no ve las publicaciones de A; el viewer de A no publica', async () => {
    expect(await as(claimsFor(TENANT_B), `select product_id from public.store_products where store_id = $1`, [storeA1])).toEqual([])
    expect(
      await expectFailure(() =>
        as(
          member(ID.viewer, 'viewer'),
          `insert into public.store_products (organization_id, company_id, store_id, product_id, slug, price, currency)
           values ($1, $2, $3, $4, 'viewer', '1.00', 'PEN')`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA2, ID.pv],
        ),
      ),
    ).toMatch(/row-level security/)
  })

  it('anónimo no ve borradores ni maestros sin publicación pública', async () => {
    expect(await anon(`select product_id from public.store_products where product_id = $1`, [ID.p2])).toEqual([])
    expect(await anon(`select id from public.products where id = $1`, [ID.p2])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('disponibilidad por los almacenes de CADA tienda', () => {
  it('el mismo maestro está disponible donde lo sirve su almacén', async () => {
    const [wA1] = await svc(
      `insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'alm-a1', 'A1') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const [wA2] = await svc(
      `insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'alm-a2', 'A2') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(
      `insert into public.store_warehouses (organization_id, company_id, store_id, warehouse_id) values ($1, $2, $3, $4), ($1, $2, $5, $6)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1, wA1?.id, storeA2, wA2?.id],
    )
    await svc(
      `insert into public.inventory_levels (organization_id, company_id, warehouse_id, store_id, product_id, on_hand_qty)
       values ($1, $2, $3, $4, $5, 5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, wA2?.id, storeA1, ID.p1],
    )

    const disponible = (store: string) =>
      anon(`select in_stock from public.public_products where store_id = $1 and product_id = $2`, [store, ID.p1])
    expect(await disponible(storeA2)).toEqual([{ in_stock: true }])
    expect(await disponible(storeA1)).toEqual([{ in_stock: false }])
  })
})

// ---------------------------------------------------------------------------
describe('transición: la forma antigua sigue escribiendo', () => {
  it('insertar con tienda crea su publicación; editar cualquiera de los dos lados se refleja', async () => {
    const [nuevo] = await svc(
      `insert into public.products (organization_id, company_id, store_id, sku, slug, name, price, status, published_at)
       values ($1, $2, $3, 'LEG-1', 'legacy', 'Legacy', '12.00', 'published', now()) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    )
    expect(await svc(`select slug, price::text from public.store_products where product_id = $1`, [nuevo?.id])).toEqual([
      { slug: 'legacy', price: '12.00' },
    ])

    await svc(`update public.store_products set price = '15.00' where product_id = $1`, [nuevo?.id])
    expect(await svc(`select price::text from public.products where id = $1`, [nuevo?.id])).toEqual([{ price: '15.00' }])

    await svc(`update public.products set slug = 'legacy-2' where id = $1`, [nuevo?.id])
    expect(await svc(`select slug from public.store_products where product_id = $1`, [nuevo?.id])).toEqual([{ slug: 'legacy-2' }])
  })

  it('el precio legacy de una variante sigue a su tienda de origen', async () => {
    await svc(`update public.product_variants set price = '130.00' where id = $1`, [ID.v1])
    expect(await svc(`select price::text from public.store_price_overrides where variant_id = $1 and store_id = $2`, [ID.v1, storeA1])).toEqual([
      { price: '130.00' },
    ])
    await svc(`update public.product_variants set price = null where id = $1`, [ID.v1])
    expect(await svc(`select 1 from public.store_price_overrides where variant_id = $1 and store_id = $2`, [ID.v1, storeA1])).toEqual([])
  })
})
