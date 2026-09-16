// @vitest-environment node
/**
 * Aislamiento multitenant sobre Postgres REAL.
 *
 * Las migraciones se aplican tal cual y las consultas corren con
 * `SET ROLE anon|authenticated` + los claims en `request.jwt.claims`: el mismo
 * mecanismo de Supabase. Aquí no se comprueba que el SQL "parezca" correcto,
 * se comprueba que la base efectivamente deniegue.
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

let db: PGlite
let storeA: string
let storeB: string
let publishedA: string
let draftA: string
let publishedB: string
let orderA: string

const CATALOG_USER = '0a000000-0000-4000-8000-0000000000c9'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d9'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  const result = await db.query<Row>(query, params)
  return result.rows
}

/** Siembra como `service_role` (bypassrls), igual que lo haría el aprovisionamiento. */
async function seed(): Promise<void> {
  await asRole(db, 'service_role', null, async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await sql(
        `select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`,
        [
          t.organizationId,
          t.companyId,
          t.slug,
          `Cuenta ${t.slug}`,
          t.adminEmail,
          t.ownerId,
          t.storeSlug,
          `Tienda ${t.slug}`,
        ],
      )
    }

    await sql(`update public.stores set status = 'active'`)

    const stores = await sql(`select id, slug from public.stores order by slug`)
    storeA = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
    storeB = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)

    // Miembros extra en A para probar el gating por rol.
    await sql(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'catalogo@tenant-a.com', 'catalog'),
              ($1, $2, $4, 'lector@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, CATALOG_USER, VIEWER_USER],
    )

    const insertProduct = `
      insert into public.products
        (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
      values ($1, $2, $3, $4, $5, $6, $7, 'PEN', $8, $9, $10)
      returning id`

    publishedA = String(
      (
        await sql(insertProduct, [
          TENANT_A.organizationId, TENANT_A.companyId, storeA,
          'A-PUB-1', 'silla-a', 'Silla A', '199.90', 25, 'published', new Date().toISOString(),
        ])
      )[0]?.id,
    )
    draftA = String(
      (
        await sql(insertProduct, [
          TENANT_A.organizationId, TENANT_A.companyId, storeA,
          'A-DRAFT-1', 'mesa-a', 'Mesa A (borrador)', '499.00', 5, 'draft', null,
        ])
      )[0]?.id,
    )
    publishedB = String(
      (
        await sql(insertProduct, [
          TENANT_B.organizationId, TENANT_B.companyId, storeB,
          'B-PUB-1', 'lampara-b', 'Lampara B', '80.00', 10, 'published', new Date().toISOString(),
        ])
      )[0]?.id,
    )

    await sql(
      `insert into public.product_images
         (organization_id, company_id, store_id, product_id, storage_path, is_primary)
       values ($1, $2, $3, $4, $5, true), ($1, $2, $3, $6, $7, true)`,
      [
        TENANT_A.organizationId, TENANT_A.companyId, storeA,
        publishedA, `${TENANT_A.organizationId}/${storeA}/pub-1.webp`,
        draftA, `${TENANT_A.organizationId}/${storeA}/draft-1.webp`,
      ],
    )

    await sql(
      `insert into storage.objects (bucket_id, name) values
        ('product-images', $1), ('product-images', $2), ('store-assets', $3)`,
      [
        `${TENANT_A.organizationId}/${storeA}/pub-1.webp`,
        `${TENANT_A.organizationId}/${storeA}/draft-1.webp`,
        `${TENANT_A.organizationId}/${storeA}/logo.svg`,
      ],
    )

    const created = await sql(
      `select public.create_order($1, 'comprador@ejemplo.com',
              jsonb_build_array(jsonb_build_object('product_id', $2::text, 'quantity', 2))) as result`,
      [storeA, publishedA],
    )
    orderA = String((created[0]?.result as Row).order_id)
  })
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('tenant A no ve ni toca datos de tenant B', () => {
  it('cada tenant solo ve su propia tienda', async () => {
    const seenByA = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id, slug from public.stores order by slug`),
    )
    const seenByB = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select id, slug from public.stores order by slug`),
    )

    expect(seenByA.map((r) => r.slug)).toEqual([TENANT_A.storeSlug])
    expect(seenByB.map((r) => r.slug)).toEqual([TENANT_B.storeSlug])
  })

  it('cada tenant solo ve su propio catalogo, incluidos borradores propios', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select sku from public.products order by sku`),
    )
    expect(rows.map((r) => r.sku)).toEqual(['A-DRAFT-1', 'A-PUB-1'])
  })

  it('un select directo del producto de B devuelve cero filas para A', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id from public.products where id = $1`, [publishedB]),
    )
    expect(rows).toHaveLength(0)
  })

  it('A no puede insertar producto declarando el organization_id de B', async () => {
    const message = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      expectFailure(() =>
        sql(
          `insert into public.products
             (organization_id, company_id, store_id, sku, slug, name, price, currency)
           values ($1, $2, $3, 'ROBO-1', 'robo', 'Producto intruso', '1.00', 'PEN')`,
          [TENANT_B.organizationId, TENANT_B.companyId, storeB],
        ),
      ),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('A no puede actualizar el producto de B: cero filas afectadas', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`update public.products set price = '0.01' where id = $1 returning id`, [publishedB]),
    )
    expect(rows).toHaveLength(0)

    // ADR 018: el precio vive en la publicación; la escritura legacy de A no
    // la alcanzó.
    const [check] = await asRole(db, 'service_role', null, () =>
      sql(`select price from public.store_products where product_id = $1`, [publishedB]),
    )
    expect(check?.price).toBe('80.00')
  })

  it('A no puede borrar el producto de B', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`delete from public.products where id = $1 returning id`, [publishedB]),
    )
    expect(rows).toHaveLength(0)
  })

  it('A no ve pedidos ni lineas de B, ni B los de A', async () => {
    const ordersForB = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select id from public.orders`),
    )
    const itemsForB = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select id from public.order_items`),
    )
    expect(ordersForB).toHaveLength(0)
    expect(itemsForB).toHaveLength(0)

    const ordersForA = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id from public.orders`),
    )
    expect(ordersForA).toHaveLength(1)
  })

  it('A no ve las membresias de B', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select email from public.tenant_members order by email`),
    )
    expect(rows.map((r) => r.email)).toEqual([
      TENANT_A.adminEmail,
      'catalogo@tenant-a.com',
      'lector@tenant-a.com',
    ])
  })
})

describe('el JWT no basta: hace falta membresia activa', () => {
  it('un token que declara el org_id de B sin membresia no ve nada', async () => {
    const forged = claimsFor(TENANT_A, {
      org_id: TENANT_B.organizationId,
      companies: [{ id: TENANT_B.companyId, role: 'admin' }],
      active_company: TENANT_B.companyId,
    })
    const stores = await asRole(db, 'authenticated', forged, () =>
      sql(`select id from public.stores`),
    )
    const products = await asRole(db, 'authenticated', forged, () =>
      sql(`select id from public.products`),
    )
    expect(stores).toHaveLength(0)
    expect(products).toHaveLength(0)
  })

  it('una membresia revocada deja de ver el tenant', async () => {
    await asRole(db, 'service_role', null, () =>
      sql(`update public.tenant_members set status = 'revoked' where user_id = $1`, [
        TENANT_A.ownerId,
      ]),
    )
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id from public.stores`),
    )
    expect(rows).toHaveLength(0)

    await asRole(db, 'service_role', null, () =>
      sql(`update public.tenant_members set status = 'active' where user_id = $1`, [
        TENANT_A.ownerId,
      ]),
    )
  })

  it('un tenant suspendido deja de ser accesible aunque la membresia siga activa', async () => {
    await asRole(db, 'service_role', null, () =>
      sql(`update public.tenants set status = 'suspended' where organization_id = $1`, [
        TENANT_A.organizationId,
      ]),
    )
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select id from public.products`),
    )
    expect(rows).toHaveLength(0)

    await asRole(db, 'service_role', null, () =>
      sql(`update public.tenants set status = 'active' where organization_id = $1`, [
        TENANT_A.organizationId,
      ]),
    )
  })

  it('sin claims (token vacio) no hay acceso a ninguna tabla de negocio', async () => {
    const rows = await asRole(db, 'authenticated', null, () =>
      sql(`select id from public.stores`),
    )
    expect(rows).toHaveLength(0)
  })

  it('una sociedad fuera de companies[] no da acceso', async () => {
    const claims = claimsFor(TENANT_A, { companies: [] })
    const rows = await asRole(db, 'authenticated', claims, () =>
      sql(`select id from public.stores`),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('roles: quien puede escribir que', () => {
  const catalogClaims = claimsFor(TENANT_A, {
    sub: CATALOG_USER,
    email: 'catalogo@tenant-a.com',
  })
  const viewerClaims = claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
  })

  it('el rol catalog escribe catalogo', async () => {
    const rows = await asRole(db, 'authenticated', catalogClaims, () =>
      sql(
        `insert into public.products
           (organization_id, company_id, store_id, sku, slug, name, price, currency)
         values ($1, $2, $3, 'A-CAT-1', 'cat-1', 'Alta por rol catalog', '10.00', 'PEN')
         returning id`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(rows).toHaveLength(1)
  })

  it('el rol viewer lee pero no escribe catalogo', async () => {
    const visible = await asRole(db, 'authenticated', viewerClaims, () =>
      sql(`select id from public.products`),
    )
    expect(visible.length).toBeGreaterThan(0)

    const message = await asRole(db, 'authenticated', viewerClaims, () =>
      expectFailure(() =>
        sql(
          `insert into public.products
             (organization_id, company_id, store_id, sku, slug, name, price, currency)
           values ($1, $2, $3, 'A-VIEW-1', 'view-1', 'No deberia entrar', '10.00', 'PEN')`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA],
        ),
      ),
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('el rol catalog no cambia el estado de un pedido', async () => {
    const rows = await asRole(db, 'authenticated', catalogClaims, () =>
      sql(`update public.orders set status = 'paid' where id = $1 returning id`, [orderA]),
    )
    expect(rows).toHaveLength(0)
  })

  it('nadie puede escalar a owner desde la app', async () => {
    const message = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      expectFailure(() =>
        sql(
          `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
           values ($1, $2, gen_random_uuid(), 'nuevo@tenant-a.com', 'owner')`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        ),
      ),
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('el GRANT por columna impide tocar columnas comerciales de tenants', async () => {
    const message = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      expectFailure(() =>
        sql(`update public.tenants set status = 'closed' where organization_id = $1`, [
          TENANT_A.organizationId,
        ]),
      ),
    )
    expect(message).toMatch(/permission denied|no permitido/i)
  })
})

describe('storefront publico (anon)', () => {
  it('ve solo la tienda activa y solo columnas publicables', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(`select slug, name from public.stores order by slug`),
    )
    expect(rows.map((r) => r.slug).sort()).toEqual([TENANT_A.storeSlug, TENANT_B.storeSlug])

    const message = await asRole(db, 'anon', null, () =>
      expectFailure(() => sql(`select organization_id from public.stores`)),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('una tienda en borrador desaparece del storefront', async () => {
    await asRole(db, 'service_role', null, () =>
      sql(`update public.stores set status = 'draft' where id = $1`, [storeB]),
    )
    const rows = await asRole(db, 'anon', null, () => sql(`select slug from public.stores`))
    expect(rows.map((r) => r.slug)).toEqual([TENANT_A.storeSlug])

    await asRole(db, 'service_role', null, () =>
      sql(`update public.stores set status = 'active' where id = $1`, [storeB]),
    )
  })

  it('ve solo productos publicados, nunca borradores', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(`select product_id, name, price from public.public_products order by name`),
    )
    expect(rows.map((r) => r.name)).toEqual(['Lampara B', 'Silla A'])
    expect(rows.map((r) => r.product_id)).not.toContain(draftA)
  })

  it('no accede a sku ni a stock', async () => {
    const message = await asRole(db, 'anon', null, () =>
      expectFailure(() => sql(`select sku, stock from public.products`)),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('no ve pedidos, ni lineas, ni tenants, ni membresias', async () => {
    for (const table of ['orders', 'order_items', 'tenants', 'tenant_members']) {
      const message = await asRole(db, 'anon', null, () =>
        expectFailure(() => sql(`select * from public.${table}`)),
      )
      expect(message, `tabla ${table}`).toMatch(/permission denied/i)
    }
  })

  it('no puede escribir nada', async () => {
    const message = await asRole(db, 'anon', null, () =>
      expectFailure(() =>
        sql(
          `insert into public.products
             (organization_id, company_id, store_id, sku, slug, name, price, currency)
           values ($1, $2, $3, 'ANON-1', 'anon-1', 'Intruso anonimo', '1.00', 'PEN')`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA],
        ),
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })

  /**
   * El test de arriba cubre un INSERT en `products`. El comprador anónimo
   * tampoco puede EDITAR ni BORRAR nada del catálogo publicado, ni tocar las
   * otras tablas que lo componen: sin GRANT no hay policy que valga, así que
   * las doce puertas se comprueban una por una en vez de darlas por buenas.
   */
  it('tampoco edita ni borra el catalogo publicado', async () => {
    const writes: Array<[string, string, unknown[]]> = [
      ['products/update precio', `update public.products set price = '0.01' where id = $1`, [publishedA]],
      ['products/update stock', `update public.products set stock = 9999 where id = $1`, [publishedA]],
      ['products/publish', `update public.products set status = 'published' where id = $1`, [draftA]],
      ['products/delete', `delete from public.products where id = $1`, [publishedA]],
      [
        'categories/insert',
        `insert into public.categories (organization_id, company_id, store_id, slug, name)
         values ($1, $2, $3, 'anon-cat', 'Categoria intrusa')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ],
      ['categories/update', `update public.categories set name = 'Secuestrada'`, []],
      ['categories/delete', `delete from public.categories`, []],
      ['stores/update', `update public.stores set slug = 'secuestrada' where id = $1`, [storeA]],
      ['stores/delete', `delete from public.stores where id = $1`, [storeA]],
      ['store_settings/update', `update public.store_settings set tax_rate = 0`, []],
      [
        'product_images/insert',
        `insert into public.product_images
           (organization_id, company_id, store_id, product_id, storage_path)
         values ($1, $2, $3, $4, $5)`,
        [
          TENANT_A.organizationId,
          TENANT_A.companyId,
          storeA,
          publishedA,
          `${TENANT_A.organizationId}/${storeA}/intrusa.webp`,
        ],
      ],
      ['product_images/delete', `delete from public.product_images`, []],
    ]

    for (const [label, query, params] of writes) {
      const message = await asRole(db, 'anon', null, () =>
        expectFailure(() => sql(query, params)),
      )
      expect(message, label).toMatch(/permission denied/i)
    }

    // Y el catálogo sigue exactamente como estaba.
    const rows = await asRole(db, 'service_role', null, () =>
      // ADR 018: precio y estado de la publicación; stock del maestro.
      sql(
        `select p.id, sp.price::text as price, p.stock, sp.status
           from public.products p join public.store_products sp on sp.product_id = p.id
          where p.id = $1`,
        [publishedA],
      ),
    )
    expect(rows[0]).toMatchObject({ price: '199.90', status: 'published' })
  })

  /** Las vistas públicas son de LECTURA: escribir a través de ellas tampoco. */
  it('no escribe a traves de las vistas publicas', async () => {
    for (const view of ['public_products', 'public_stores']) {
      const message = await asRole(db, 'anon', null, () =>
        expectFailure(() => sql(`delete from public.${view}`)),
      )
      expect(message, view).toMatch(/permission denied|cannot delete|not updatable|no se puede/i)
    }
  })

  it('la vista publica de tiendas no filtra el tenant', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(`select * from public.public_stores limit 1`),
    )
    const columns = Object.keys(rows[0] ?? {})
    expect(columns).not.toContain('organization_id')
    expect(columns).not.toContain('company_id')
    expect(columns).toContain('accent_color')
  })

  it('la vista de branding sirve los nombres estandar del contrato §4.3', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(`select * from public.public_store_branding order by brand_slug`),
    )
    const columns = Object.keys(rows[0] ?? {}).sort()

    // Los cinco nombres del contrato son OBLIGATORIOS y no cambian: es el
    // contrato el que los fija, no este proyecto.
    for (const required of ['accent_color', 'brand_slug', 'logo_url', 'name', 'white_label']) {
      expect(columns, required).toContain(required)
    }
    // P11-SaaS anade los tokens de white-label de esta app. La lista se
    // comprueba entera —y no solo "contiene"— para que una columna nueva sea
    // una decision y no un descuido: esta vista la lee `anon`.
    expect(columns).toEqual([
      'accent_color',
      'brand_slug',
      'business_display_name',
      'favicon_url',
      'font_family',
      'logo_url',
      'name',
      'ui_density',
      'ui_radius',
      'white_label',
    ])
    expect(rows.map((r) => r.brand_slug)).toEqual([TENANT_A.storeSlug, TENANT_B.storeSlug])
  })

  it('el impuesto y la config interna de la tienda no salen al storefront', async () => {
    const message = await asRole(db, 'anon', null, () =>
      expectFailure(() => sql(`select tax_rate, config from public.store_settings`)),
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('Storage: aislamiento por path {organization_id}/{store_id}/', () => {
  it('A escribe en su propio path', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(
        `insert into storage.objects (bucket_id, name) values ('product-images', $1) returning id`,
        [`${TENANT_A.organizationId}/${storeA}/nueva.webp`],
      ),
    )
    expect(rows).toHaveLength(1)
  })

  it('A no puede escribir en el path de B', async () => {
    const message = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      expectFailure(() =>
        sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [
          `${TENANT_B.organizationId}/${storeB}/intruso.webp`,
        ]),
      ),
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('A no ve los objetos de B', async () => {
    await asRole(db, 'service_role', null, () =>
      sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [
        `${TENANT_B.organizationId}/${storeB}/de-b.webp`,
      ]),
    )
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select name from storage.objects where name like $1`, [
        `${TENANT_B.organizationId}/%`,
      ]),
    )
    expect(rows).toHaveLength(0)
  })

  it('anon lee la imagen de un producto publicado y no la de un borrador', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(`select name from storage.objects where bucket_id = 'product-images' order by name`),
    )
    const names = rows.map((r) => String(r.name))
    expect(names).toContain(`${TENANT_A.organizationId}/${storeA}/pub-1.webp`)
    expect(names).not.toContain(`${TENANT_A.organizationId}/${storeA}/draft-1.webp`)
  })

  it('anon no sube objetos', async () => {
    const message = await asRole(db, 'anon', null, () =>
      expectFailure(() =>
        sql(`insert into storage.objects (bucket_id, name) values ('store-assets', $1)`, [
          `${TENANT_A.organizationId}/${storeA}/hack.svg`,
        ]),
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('los buckets no son publicos: la lectura pasa siempre por policy', async () => {
    const rows = await asRole(db, 'service_role', null, () =>
      sql(`select id, public from storage.buckets order by id`),
    )
    // La lista es EXHAUSTIVA a proposito: un bucket nuevo tiene que aparecer
    // aqui, y quien lo anade tiene que mirar su `public`. `return-evidence`
    // (P12-SaaS) entra con la misma regla que los otros dos —privado, lectura
    // por policy— y ademas sin ninguna policy `to anon`: la foto de una
    // devolucion es un dato personal de un comprador.
    expect(rows).toEqual([
      { id: 'product-images', public: false },
      { id: 'return-evidence', public: false },
      { id: 'store-assets', public: false },
    ])
  })
})
