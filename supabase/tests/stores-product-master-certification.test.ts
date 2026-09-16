// @vitest-environment node
/**
 * CERTIFICACIÓN Stores + Product Master (fase 06).
 *
 * Una sola base que recorre la historia completa: se siembra la forma LEGACY
 * (un producto por tienda, SKU repetido entre tiendas de una sociedad) antes de
 * la migración de expansión, se aplican TODAS las migraciones hasta la
 * contracción, y sobre el resultado se demuestran:
 *
 * - los 7 casos de aceptación del encargo;
 * - los invariantes de tiendas, producto maestro y comercio;
 * - la migración legacy sin pérdidas ni ids mutados ni SKU fusionados;
 * - la prueba funcional mínima (P publicado en A y B con slug y categoría
 *   propios, backoffice, vitrina, pedido y aislamiento).
 *
 * Cada `it` nombra el invariante que certifica; el informe
 * `docs/STORES_PRODUCT_MASTER_CERTIFICATION.md` enlaza aquí.
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
const COMPANY_A2 = '0a000000-0000-4000-8000-0000000000c2'

const USERS = {
  catalog: '0a000000-0000-4000-8000-0000000000d2',
  orders: '0a000000-0000-4000-8000-0000000000d3',
  viewer: '0a000000-0000-4000-8000-0000000000d4',
} as const

const LEGACY = {
  a1: '0c000000-0000-4000-8000-00000000c001',
  a1Dup: '0c000000-0000-4000-8000-00000000c002',
  b1: '0c000000-0000-4000-8000-00000000c003',
}

let db: PGlite
let storeA1: string
let storeA2: string
let storeB1: string
let legacyStoreA2: string
let catA: string
let catB: string
let productX: string

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))
const anon = (query: string, params: unknown[] = []) => asRole(db, 'anon', null, () => sql(query, params))
const as = (claims: JwtClaims, query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claims, () => sql(query, params))
const ownerA = () => claimsFor(TENANT_A)
const ownerB = () => claimsFor(TENANT_B)
const memberA = (role: keyof typeof USERS): JwtClaims =>
  claimsFor(TENANT_A, { sub: USERS[role], email: `${role}@tenant-a.com`, companies: [{ id: TENANT_A.companyId, role }] })

async function checkout(slug: string, items: Row[], email: string): Promise<Row> {
  const rows = await svc(
    `select public.create_order_for_slug($1, $2, $3::jsonb, 'Cliente', '+51 999 000 000',
       '{"address": "Av. Siempre Viva 742"}'::jsonb, null, null) as r`,
    [slug, email, JSON.stringify(items)],
  )
  return rows[0]?.r as Row
}

beforeAll(async () => {
  db = await createTestDatabase({ before: EXPAND })

  // ---- Forma LEGACY -------------------------------------------------------
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
    storeA1 = String((await sql(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
    storeB1 = String((await sql(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)
    // Segunda tienda legacy de A, creada «a mano» como se hacía antes.
    legacyStoreA2 = String((await sql(
      `insert into public.stores (organization_id, company_id, slug, name, status, currency)
       values ($1, $2, 'legacy-a2', 'Legacy A2', 'active', 'PEN') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    ))[0]?.id)
    await sql(`update public.stores set status = 'active'`)
    await sql(`update public.store_settings set tax_rate = 0`)
    for (const role of Object.keys(USERS) as Array<keyof typeof USERS>) {
      await sql(
        `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
         values ($1, $2, $3, $4, $5, 'active')`,
        [TENANT_A.organizationId, TENANT_A.companyId, USERS[role], `${role}@tenant-a.com`, role],
      )
    }
    const insert = `
      insert into public.products (id, organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'PEN', 5, 'published', now() - interval '1 day')`
    await sql(insert, [LEGACY.a1, TENANT_A.organizationId, TENANT_A.companyId, storeA1, 'LEG-001', 'legado', 'Legado A1', '10.00'])
    // Mismo SKU en otra tienda de la MISMA sociedad: conflicto heredado.
    await sql(insert, [LEGACY.a1Dup, TENANT_A.organizationId, TENANT_A.companyId, legacyStoreA2, 'LEG-001', 'legado', 'Legado A2', '9.00'])
    await sql(insert, [LEGACY.b1, TENANT_B.organizationId, TENANT_B.companyId, storeB1, 'LEG-001', 'legado', 'Legado B1', '20.00'])
  })

  // ---- Todas las migraciones, hasta la contracción ------------------------
  await applyMigrations(db, { from: EXPAND })
}, 300_000)

afterAll(async () => {
  await db?.close()
})

// ===========================================================================
describe('B · migración legacy', () => {
  it('ningún producto perdido ni id mutado; cada uno con su publicación inicial', async () => {
    expect(await svc(`select id from public.products order by id`)).toEqual(
      [LEGACY.a1, LEGACY.a1Dup, LEGACY.b1].sort().map((id) => ({ id })),
    )
    expect(
      await svc(`select product_id, store_id, slug, price::text from public.store_products order by product_id`),
    ).toEqual([
      { product_id: LEGACY.a1, store_id: storeA1, slug: 'legado', price: '10.00' },
      { product_id: LEGACY.a1Dup, store_id: legacyStoreA2, slug: 'legado', price: '9.00' },
      { product_id: LEGACY.b1, store_id: storeB1, slug: 'legado', price: '20.00' },
    ])
  })

  it('el SKU repetido en la sociedad se conserva marcado, sin fusionar; el de otra sociedad no es conflicto', async () => {
    expect(
      await svc(`select id, legacy_sku_conflict from public.products order by id`),
    ).toEqual([
      { id: LEGACY.a1, legacy_sku_conflict: true },
      { id: LEGACY.a1Dup, legacy_sku_conflict: true },
      { id: LEGACY.b1, legacy_sku_conflict: false },
    ].sort((x, y) => x.id.localeCompare(y.id)))
  })

  it('no hay claves ajenas sin validar ni columnas de publicación con datos en el maestro', async () => {
    expect(await svc(`select conname from pg_constraint where contype = 'f' and not convalidated`)).toEqual([])
    expect(
      await svc(
        `select count(*)::int as n from public.products
          where slug is not null or price is not null or status is not null or currency is not null
             or category_id is not null or published_at is not null or compare_at_price is not null`,
      ),
    ).toEqual([{ n: 0 }])
  })
})

// ===========================================================================
describe('A · tiendas (casos 1, 2, 6 y 7)', () => {
  it('caso 6 · se crea una tienda nueva después del onboarding, sin tenant duplicado', async () => {
    const before = await svc(`select count(*)::int as n from public.tenants`)
    const created = (await as(ownerA(), `select public.create_store('tienda-a2', 'Tienda A2', 'PEN') as r`))[0]?.r as Row
    storeA2 = String(created.id)
    expect(created).toMatchObject({ organization_id: TENANT_A.organizationId, company_id: TENANT_A.companyId, status: 'draft' })
    expect(await svc(`select count(*)::int as n from public.tenants`)).toEqual(before)
    await as(ownerA(), `select public.set_store_status($1, 'active')`, [storeA2])
  })

  it('caso 1 · Company A opera N tiendas: ningún UNIQUE limita a una por sociedad', async () => {
    const uniques = await svc(
      `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'stores' and indexdef ilike '%unique%'`,
    )
    expect(uniques.map((row) => String(row.indexdef)).filter((def) => /\(company_id\)|\(organization_id, company_id\)/.test(def))).toEqual([])
    expect(await svc(`select count(*)::int as n from public.stores where company_id = $1`, [TENANT_A.companyId])).toEqual([
      { n: 3 },
    ])
  })

  it('caso 2 · Company B tiene su tienda B1, fuera del alcance de A', async () => {
    expect(await as(ownerA(), `select id from public.stores where id = $1`, [storeB1])).toEqual([])
    expect(
      await expectFailure(() => as(ownerA(), `select public.update_store($1, 'Robada')`, [storeB1])),
    ).toMatch(/TIENDA_NO_ENCONTRADA/)
  })

  it('la tienda nace coherente: store_settings 1:1 y canal por defecto', async () => {
    expect(await svc(`select count(*)::int as n from public.store_settings where store_id = $1`, [storeA2])).toEqual([{ n: 1 }])
    expect(
      await svc(`select count(*)::int as n from public.channels where store_id = $1 and is_default`, [storeA2]),
    ).toEqual([{ n: 1 }])
  })

  it('el tenant de la tienda sale del JWT: no hay parámetro para declararlo', async () => {
    const args = await svc(
      `select pg_get_function_identity_arguments('public.create_store(text, text, text, text)'::regprocedure) as a`,
    )
    expect(String(args[0]?.a)).not.toMatch(/organization|company/)
  })

  it('caso 7 · catalog, orders y viewer no crean tiendas ni llamando al RPC directamente', async () => {
    for (const role of ['catalog', 'orders', 'viewer'] as const) {
      expect(
        await expectFailure(() => as(memberA(role), `select public.create_store($1, 'No', 'PEN')`, [`intento-${role}`])),
        role,
      ).toMatch(/SIN_PERMISO/)
    }
    expect(await svc(`select count(*)::int as n from public.stores where slug like 'intento-%'`)).toEqual([{ n: 0 }])
  })

  it('una sociedad de la MISMA organización no administra la tienda de otra', async () => {
    const otherCompany = claimsFor(TENANT_A, {
      companies: [{ id: COMPANY_A2, role: 'admin' }],
      active_company: COMPANY_A2,
    })
    expect(
      await expectFailure(() => as(otherCompany, `select public.set_store_status($1, 'suspended')`, [storeA1])),
    ).toMatch(/TIENDA_NO_ENCONTRADA|TIENDA_FUERA_DE_SOCIEDAD_ACTIVA|SIN_PERMISO/)
  })
})

// ===========================================================================
describe('A/D · producto maestro y publicación (casos 3, 4 y 5)', () => {
  beforeAll(async () => {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      TENANT_A.organizationId, TENANT_A.companyId, ['ecommerce.pricing.lists', 'ecommerce.promotions'],
    ])
    catA = String((await svc(
      `insert into public.categories (organization_id, company_id, store_id, slug, name) values ($1, $2, $3, 'hogar', 'Hogar') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
    ))[0]?.id)
    catB = String((await svc(
      `insert into public.categories (organization_id, company_id, store_id, slug, name) values ($1, $2, $3, 'liquidacion', 'Liquidación') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    ))[0]?.id)
    productX = String((await as(
      memberA('catalog'),
      `insert into public.products (organization_id, company_id, sku, name, stock, kind)
       values (ebim.org_id(), ebim.active_company(), 'X-001', 'Lámpara X', 30, 'simple') returning id`,
    ))[0]?.id)
  })

  it('products es de la sociedad: store_id no es obligatorio y la publicación es única por (tienda, producto)', async () => {
    expect(
      await svc(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'store_id'`),
    ).toEqual([{ is_nullable: 'YES' }])
    const unique = await svc(
      `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'store_products_publication_key'`,
    )
    expect(String(unique[0]?.d)).toMatch(/UNIQUE \(product_id, store_id\)/)
  })

  it('caso 3 · X de A se publica en A1 y A2 con el MISMO id, y nunca en B1', async () => {
    await as(memberA('catalog'), `select public.publish_product($1, $2, 'lampara-x', 120, $3, 'published')`, [productX, storeA1, catA])
    await as(memberA('catalog'), `select public.publish_product($1, $2, 'lampara-x-outlet', 95, $3, 'draft')`, [productX, storeA2, catB])
    expect(await svc(`select count(*)::int as n from public.products where sku = 'X-001'`)).toEqual([{ n: 1 }])
    expect(await svc(`select count(*)::int as n from public.store_products where product_id = $1`, [productX])).toEqual([{ n: 2 }])

    expect(await expectFailure(() => as(ownerA(), `select public.publish_product($1, $2, 'x', 1)`, [productX, storeB1]))).toMatch(
      /TIENDA_NO_ENCONTRADA/,
    )
    expect(await expectFailure(() => as(ownerB(), `select public.publish_product($1, $2, 'x', 1)`, [productX, storeB1]))).toMatch(
      /PRODUCTO_NO_ENCONTRADO/,
    )
    await expectFailure(() =>
      svc(
        `insert into public.store_products (organization_id, company_id, store_id, product_id, slug, price, currency)
         values ($1, $2, $3, $4, 'forzado', 1, 'PEN')`,
        [TENANT_B.organizationId, TENANT_B.companyId, storeB1, productX],
      ),
    )
    expect(await svc(`select count(*)::int as n from public.store_products where store_id = $1 and product_id = $2`, [storeB1, productX]))
      .toEqual([{ n: 0 }])
  })

  it('caso 4 · publicado solo en A1 (A2 en borrador) no aparece en la vitrina de A2', async () => {
    expect(await anon(`select store_id, slug from public.public_products where product_id = $1`, [productX])).toEqual([
      { store_id: storeA1, slug: 'lampara-x' },
    ])
    expect(await expectFailure(() => checkout('tienda-a2', [{ product_id: productX, quantity: 1 }], 'a2@c.test'))).toMatch(
      /PRODUCTO_NO_DISPONIBLE/,
    )
  })

  it('el modelo público nunca expone un maestro no publicado', async () => {
    const hidden = String((await as(
      ownerA(),
      `insert into public.products (organization_id, company_id, sku, name, stock) values (ebim.org_id(), ebim.active_company(), 'OCULTO', 'Oculto', 1) returning id`,
    ))[0]?.id)
    expect(await anon(`select id from public.products where id = $1`, [hidden])).toEqual([])
    expect(await anon(`select product_id from public.public_products where product_id = $1`, [hidden])).toEqual([])
  })

  it('caso 5 · A1 y A2 tienen configuración comercial distinta para el mismo producto', async () => {
    await as(ownerA(), `select public.update_product_publication($1, $2, p_status => 'published')`, [productX, storeA2])
    const rows = await anon(
      `select store_id, slug, price::text as price, category_slug from public.public_products where product_id = $1 order by price::numeric`,
      [productX],
    )
    expect(rows).toEqual([
      { store_id: storeA2, slug: 'lampara-x-outlet', price: '95.00', category_slug: 'liquidacion' },
      { store_id: storeA1, slug: 'lampara-x', price: '120.00', category_slug: 'hogar' },
    ])
  })

  it('D · el backoffice lista X una vez y el editor muestra A1 y A2', async () => {
    expect(await as(ownerA(), `select id, publication_count, published_count from public.admin_product_masters where id = $1`, [productX]))
      .toEqual([{ id: productX, publication_count: 2, published_count: 2 }])
    const pubs = await as(ownerA(), `select store_id, slug from public.product_store_publications($1) where slug is not null order by slug`, [productX])
    expect(pubs).toEqual([
      { store_id: storeA1, slug: 'lampara-x' },
      { store_id: storeA2, slug: 'lampara-x-outlet' },
    ])
  })

  it('D · cambiar el nombre del maestro se refleja en ambas vitrinas; cambiar slug/categoría de A1 no toca A2', async () => {
    await as(memberA('catalog'), `update public.products set name = 'Lámpara X Pro' where id = $1`, [productX])
    expect(await anon(`select distinct name from public.public_products where product_id = $1`, [productX])).toEqual([{ name: 'Lámpara X Pro' }])

    await as(memberA('catalog'), `select public.update_product_publication($1, $2, p_slug => 'lampara-x-pro', p_clear_category => true)`, [productX, storeA1])
    expect(
      await svc(`select store_id, slug, category_id from public.store_products where product_id = $1 order by slug`, [productX]),
    ).toEqual([
      { store_id: storeA2, slug: 'lampara-x-outlet', category_id: catB },
      { store_id: storeA1, slug: 'lampara-x-pro', category_id: null },
    ])
  })

  it('el PIM es del maestro: una variante no se duplica por publicar en otra tienda', async () => {
    const pimTables = ['product_variants', 'product_uoms', 'product_attribute_values', 'product_images', 'bundle_items', 'product_relations']
    for (const table of pimTables) {
      const fks = await svc(
        `select pg_get_constraintdef(c.oid) as d from pg_constraint c
          where c.conrelid = $1::regclass and c.contype = 'f' and c.confrelid = 'public.products'::regclass`,
        [`public.${table}`],
      )
      expect(fks.some((row) => /\(\w+, organization_id, company_id\)/.test(String(row.d))), table).toBe(true)
      expect(fks.some((row) => /\(\w+, store_id\)/.test(String(row.d))), table).toBe(false)
    }
  })
})

// ===========================================================================
describe('A/D · comercio', () => {
  it('D · el pedido de A1 usa el contexto de A1: su precio y su tienda, aunque el navegador mande otro precio', async () => {
    let order: Row
    try {
      order = await checkout(TENANT_A.storeSlug, [{ product_id: productX, quantity: 1, unit_price: '0.01' }], 'a1@c.test')
    } catch (error) {
      // Rechazar el campo es tan válido como ignorarlo: lo que no puede pasar es cobrar 0.01.
      expect(String((error as Error).message)).toMatch(/CAMPO_NO_PERMITIDO|DATOS_INVALIDOS|CAMPO_INVALIDO/)
      order = await checkout(TENANT_A.storeSlug, [{ product_id: productX, quantity: 1 }], 'a1@c.test')
    }
    expect(
      await svc(`select store_id, unit_price::text as unit_price from public.order_items where order_id = $1`, [order.order_id]),
    ).toEqual([{ store_id: storeA1, unit_price: '120.00' }])
  })

  it('los históricos sobreviven a la despublicación', async () => {
    const before = await svc(`select count(*)::int as n from public.order_items where product_id = $1`, [productX])
    expect(before[0]?.n).toBeGreaterThan(0)
    await as(ownerA(), `select public.unpublish_product($1, $2)`, [productX, storeA1])
    expect(await svc(`select count(*)::int as n from public.order_items where product_id = $1`, [productX])).toEqual(before)
    expect(await expectFailure(() => as(ownerA(), `select public.delete_product_master($1)`, [productX]))).toMatch(
      /PRODUCTO_PUBLICADO|PRODUCTO_CON_HISTORIA/,
    )
    await as(ownerA(), `select public.publish_product($1, $2, 'lampara-x-pro', 120, null, 'published')`, [productX, storeA1])
  })

  it('el inventario no depende del navegador: la existencia se mueve solo por funciones del servidor', async () => {
    const grants = await svc(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'inventory_levels' and grantee in ('anon', 'authenticated')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
    )
    expect(grants).toEqual([])
  })

  it('pedido rápido y promociones no cruzan tiendas', async () => {
    const buyer: JwtClaims = { sub: '0c000000-0000-4000-8000-00000000b0b0', email: 'b@c.test', org_id: '', companies: [], active_company: '' }
    const soloA1 = String((await as(
      ownerA(),
      `insert into public.products (organization_id, company_id, sku, name, stock) values (ebim.org_id(), ebim.active_company(), 'SOLO-A1', 'Solo A1', 5) returning id`,
    ))[0]?.id)
    await as(ownerA(), `select public.publish_product($1, $2, 'solo-a1', 10, null, 'published')`, [soloA1, storeA1])
    const resolve = async (slug: string) => {
      const rows = await as(buyer, `select public.resolve_order_lines_for_slug($1, $2::jsonb) as r`, [
        slug, JSON.stringify([{ sku: 'SOLO-A1', quantity: 1 }]),
      ])
      return ((rows[0]?.r as Row).lines as Row[])[0]
    }
    expect(await resolve(TENANT_A.storeSlug)).toMatchObject({ status: 'ok' })
    expect(await resolve('tienda-a2')).toMatchObject({ status: 'rejected', reason: 'SKU_NO_ENCONTRADO' })

    const promo = String((await svc(
      `insert into public.promotions (organization_id, company_id, store_id, code, name, kind, status, value_percent, valid_from)
       values ($1, $2, $3, 'solo-a2', 'Solo A2', 'percentage', 'active', 50, now() - interval '1 day') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    ))[0]?.id)
    await svc(
      `insert into public.promotion_scopes (organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, product_id)
       values ($1, $2, $3, $4, 'percentage', 'product', $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2, promo, productX],
    )
    const applied = async (slug: string) => {
      const rows = await anon(`select public.promotion_quote_for_slug($1, $2::jsonb, null) as q`, [
        slug, JSON.stringify([{ product_id: productX, quantity: 1 }]),
      ])
      const promotions = ((rows[0]?.q as Row).promotions ?? {}) as Row
      return ((promotions.applied ?? []) as Row[]).map((entry) => entry.code)
    }
    expect(await applied('tienda-a2')).toContain('solo-a2')
    expect(await applied(TENANT_A.storeSlug)).not.toContain('solo-a2')
  })

  it('D · no hay fuga a otro tenant: B no ve el maestro, las publicaciones ni los pedidos de A', async () => {
    expect(await as(ownerB(), `select id from public.products where id = $1`, [productX])).toEqual([])
    expect(await as(ownerB(), `select id from public.store_products where product_id = $1`, [productX])).toEqual([])
    expect(await as(ownerB(), `select id from public.admin_product_masters where id = $1`, [productX])).toEqual([])
    expect(await as(ownerB(), `select id from public.order_items where product_id = $1`, [productX])).toEqual([])
    expect(await expectFailure(() => as(ownerB(), `select * from public.product_store_publications($1)`, [productX]))).toMatch(
      /PRODUCTO_NO_ENCONTRADO/,
    )
  })
})
