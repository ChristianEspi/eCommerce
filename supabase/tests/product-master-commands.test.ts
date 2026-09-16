// @vitest-environment node
/**
 * Comandos del producto maestro y de su publicación por tienda (Stores + Product Master, fase 04).
 *
 * Lo que queda fijado sobre Postgres REAL: un maestro se publica en varias
 * tiendas de su sociedad sin duplicar su id; cada tienda edita y quita SU
 * publicación sin tocar la de al lado ni el maestro; la tienda y la categoría
 * tienen que ser de la sociedad activa; el rol catalog publica pero no crea
 * tiendas; el borrado del maestro lo niega el servidor mientras siga publicado;
 * y la importación en una segunda tienda publica el maestro existente en vez de
 * duplicarlo.
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
  type JwtClaims,
} from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA1: string
let storeA2: string
let storeB1: string
let categoryA1: string
let categoryA2: string
let master: string

const USERS = {
  catalog: '0a000000-0000-4000-8000-0000000000e2',
  viewer: '0a000000-0000-4000-8000-0000000000e4',
} as const

const COMPANY_C = '0a000000-0000-4000-8000-0000000000c9'
const STORE_C = '0a000000-0000-4000-8000-00000000a0c9'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))
const anon = (query: string, params: unknown[] = []) => asRole(db, 'anon', null, () => sql(query, params))
const as = (claims: JwtClaims, query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claims, () => sql(query, params))

const ownerA = () => claimsFor(TENANT_A)
const ownerB = () => claimsFor(TENANT_B)
const member = (role: keyof typeof USERS): JwtClaims =>
  claimsFor(TENANT_A, {
    sub: USERS[role],
    email: `${role}@tenant-a.com`,
    companies: [{ id: TENANT_A.companyId, role }],
  })

const publish = (
  claims: JwtClaims,
  productId: string,
  storeId: string,
  slug: string,
  price: string,
  categoryId: string | null = null,
  status = 'published',
) =>
  as(claims, `select public.publish_product($1, $2, $3, $4::numeric, $5, $6::public.product_status) as r`, [
    productId, storeId, slug, price, categoryId, status,
  ]).then((rows) => rows[0]?.r as Row)

async function createMaster(claims: JwtClaims, sku: string, name: string): Promise<string> {
  // La misma escritura que hace la Edge Function `catalog-product` para un alta
  // sin tienda: el tenant del token, sin slug ni precio.
  const rows = await as(
    claims,
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), $1, $2, 5, 'simple') returning id`,
    [sku, name],
  )
  return String(rows[0]?.id)
}

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
    const stores = await sql(`select id, slug from public.stores order by slug`)
    storeA1 = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
    storeB1 = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)
    await sql(`update public.stores set status = 'active'`)
    for (const role of Object.keys(USERS) as Array<keyof typeof USERS>) {
      await sql(
        `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
         values ($1, $2, $3, $4, $5, 'active')`,
        [TENANT_A.organizationId, TENANT_A.companyId, USERS[role], `${role}@tenant-a.com`, role],
      )
    }
    // Otra sociedad de la MISMA organización, con su tienda.
    await sql(
      `insert into public.stores (id, organization_id, company_id, slug, name, status, currency)
       values ($1, $2, $3, 'tienda-c', 'Tienda C', 'active', 'PEN')`,
      [STORE_C, TENANT_A.organizationId, COMPANY_C],
    )
  })

  // La segunda tienda nace DESPUÉS del alta del tenant, por el comando de autoservicio.
  const created = await as(ownerA(), `select public.create_store('tienda-a2', 'Tienda A2', 'PEN') as r`)
  storeA2 = String((created[0]?.r as Row).id)
  await as(ownerA(), `select public.set_store_status($1, 'active')`, [storeA2])

  await asRole(db, 'service_role', null, async () => {
    categoryA1 = String((await sql(
      `insert into public.categories (organization_id, company_id, store_id, slug, name)
       values ($1, $2, $3, 'polos', 'Polos') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
    ))[0]?.id)
    categoryA2 = String((await sql(
      `insert into public.categories (organization_id, company_id, store_id, slug, name)
       values ($1, $2, $3, 'outlet', 'Outlet') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    ))[0]?.id)
  })

  master = await createMaster(member('catalog'), 'POLO-X', 'Polo X')
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------
describe('publicar un maestro en varias tiendas', () => {
  it('un maestro sin tienda no tiene publicaciones ni aparece en la vitrina', async () => {
    expect(await svc(`select store_id from public.products where id = $1`, [master])).toEqual([{ store_id: null }])
    expect(await svc(`select count(*)::int as n from public.store_products where product_id = $1`, [master]))
      .toEqual([{ n: 0 }])
    const listed = await as(ownerA(), `select publication_count, publication_state::text from public.admin_product_masters where id = $1`, [master])
    expect(listed).toEqual([{ publication_count: 0, publication_state: 'draft' }])
  })

  it('catalog publica en A1 con la categoría de A1 y la moneda de la tienda', async () => {
    const row = await publish(member('catalog'), master, storeA1, 'polo-x', '50.00', categoryA1)
    expect(row).toMatchObject({ store_id: storeA1, product_id: master, slug: 'polo-x', price: '50.00', currency: 'PEN', status: 'published' })
    expect(row.published_at).not.toBeNull()
    // La primera tienda donde se publica pasa a ser la de origen (ancla
    // informativa); el maestro no guarda datos de publicación.
    expect(await svc(`select store_id, slug, price from public.products where id = $1`, [master]))
      .toEqual([{ store_id: storeA1, slug: null, price: null }])
  })

  it('publicar en A2 no duplica el producto: mismo id, otra publicación con su propio precio', async () => {
    await publish(member('catalog'), master, storeA2, 'polo-x-outlet', '39.90', categoryA2)
    expect(await svc(`select count(*)::int as n from public.products where sku = 'POLO-X'`)).toEqual([{ n: 1 }])
    expect(
      await svc(
        `select store_id, slug, price::text from public.store_products where product_id = $1 order by price`,
        [master],
      ),
    ).toEqual([
      { store_id: storeA2, slug: 'polo-x-outlet', price: '39.90' },
      { store_id: storeA1, slug: 'polo-x', price: '50.00' },
    ])
  })

  it('el listado de maestros lo muestra UNA vez con el resumen de sus tiendas', async () => {
    const rows = await as(
      ownerA(),
      `select id, publication_count, published_count, published_store_names, publication_state::text
         from public.admin_product_masters where sku = 'POLO-X'`,
    )
    expect(rows).toEqual([
      {
        id: master,
        publication_count: 2,
        published_count: 2,
        published_store_names: ['Tienda A2', `Tienda ${TENANT_A.slug}`].sort(),
        publication_state: 'published',
      },
    ])
  })

  it('product_store_publications lista todas las tiendas de la sociedad, publicadas o no', async () => {
    const other = await createMaster(ownerA(), 'SOLO-A1', 'Solo A1')
    await publish(ownerA(), other, storeA1, 'solo-a1', '10.00')
    const rows = await as(
      ownerA(),
      `select store_id, is_origin, slug, price from public.product_store_publications($1) order by store_name`,
      [other],
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.store_id === storeA1)).toMatchObject({ is_origin: true, slug: 'solo-a1', price: '10.00' })
    expect(rows.find((r) => r.store_id === storeA2)).toMatchObject({ is_origin: false, slug: null, price: null })
    // Ni la tienda de B ni la de la otra sociedad.
    expect(rows.map((r) => r.store_id)).not.toContain(storeB1)
    expect(rows.map((r) => r.store_id)).not.toContain(STORE_C)
  })

  it('publicado solo en A1 no aparece en la vitrina de A2', async () => {
    const onlyA1 = await createMaster(ownerA(), 'SOLO-VITRINA', 'Solo vitrina A1')
    await publish(ownerA(), onlyA1, storeA1, 'solo-vitrina', '12.00')
    const rows = await anon(`select store_id from public.public_products where product_id = $1`, [onlyA1])
    expect(rows).toEqual([{ store_id: storeA1 }])
  })
})

// ---------------------------------------------------------------------------
describe('editar y quitar la publicación de una tienda', () => {
  it('cambiar slug, categoría y precio en A1 no altera A2', async () => {
    const row = (await as(
      member('catalog'),
      `select public.update_product_publication($1, $2, p_slug => 'polo-x-nuevo', p_clear_category => true, p_price => 55.5) as r`,
      [master, storeA1],
    ))[0]?.r as Row
    expect(row).toMatchObject({ slug: 'polo-x-nuevo', category_id: null, price: '55.50' })
    expect(
      await svc(`select slug, category_id, price::text from public.store_products where product_id = $1 and store_id = $2`, [master, storeA2]),
    ).toEqual([{ slug: 'polo-x-outlet', category_id: categoryA2, price: '39.90' }])
  })

  it('A1 y A2 tienen configuración comercial distinta para el mismo producto en la vitrina', async () => {
    const rows = await anon(
      `select store_id, slug, price::text as price from public.public_products where product_id = $1 order by price`,
      [master],
    )
    expect(rows).toEqual([
      { store_id: storeA2, slug: 'polo-x-outlet', price: '39.90' },
      { store_id: storeA1, slug: 'polo-x-nuevo', price: '55.50' },
    ])
  })

  it('editar el nombre del maestro se ve en las dos publicaciones', async () => {
    await as(member('catalog'), `update public.products set name = 'Polo X Premium' where id = $1`, [master])
    const rows = await anon(`select distinct name from public.public_products where product_id = $1`, [master])
    expect(rows).toEqual([{ name: 'Polo X Premium' }])
  })

  it('pasar A2 a borrador lo saca de la vitrina de A2 y conserva A1', async () => {
    await as(member('catalog'), `select public.update_product_publication($1, $2, p_status => 'draft')`, [master, storeA2])
    expect(await svc(`select published_at from public.store_products where product_id = $1 and store_id = $2`, [master, storeA2]))
      .toEqual([{ published_at: null }])
    expect(await anon(`select store_id from public.public_products where product_id = $1`, [master])).toEqual([{ store_id: storeA1 }])
    await as(member('catalog'), `select public.update_product_publication($1, $2, p_status => 'published')`, [master, storeA2])
  })

  it('una categoría de otra tienda se rechaza', async () => {
    const message = await expectFailure(() =>
      as(member('catalog'), `select public.update_product_publication($1, $2, p_category_id => $3)`, [master, storeA2, categoryA1]),
    )
    expect(message).toMatch(/CATEGORIA_FUERA_DE_TIENDA/)
  })

  it('slug repetido en la tienda y publicación repetida tienen código propio', async () => {
    const other = await createMaster(ownerA(), 'OTRO-SLUG', 'Otro')
    expect(await expectFailure(() => publish(ownerA(), other, storeA1, 'polo-x-nuevo', '1.00'))).toMatch(/SLUG_DUPLICADO/)
    expect(await expectFailure(() => publish(ownerA(), master, storeA1, 'otro-slug', '1.00'))).toMatch(/PUBLICACION_DUPLICADA/)
    expect(await expectFailure(() => publish(ownerA(), other, storeA1, 'Slug Malo', '1.00'))).toMatch(/SLUG_INVALIDO/)
    expect(await expectFailure(() => publish(ownerA(), other, storeA1, 'otro-ok', '-1'))).toMatch(/PRECIO_INVALIDO/)
  })

  it('quitar de A1 conserva el maestro y la publicación de A2', async () => {
    const extra = await createMaster(ownerA(), 'QUITAR-A1', 'Quitar de A1')
    await publish(ownerA(), extra, storeA1, 'quitar-a1', '20.00')
    await publish(ownerA(), extra, storeA2, 'quitar-a1', '18.00')
    await as(member('catalog'), `select public.unpublish_product($1, $2)`, [extra, storeA1])
    expect(await svc(`select store_id from public.store_products where product_id = $1`, [extra])).toEqual([{ store_id: storeA2 }])
    expect(await svc(`select count(*)::int as n from public.products where id = $1`, [extra])).toEqual([{ n: 1 }])
    expect(await anon(`select store_id from public.public_products where product_id = $1`, [extra])).toEqual([{ store_id: storeA2 }])
    expect(
      await expectFailure(() => as(member('catalog'), `select public.unpublish_product($1, $2)`, [extra, storeA1])),
    ).toMatch(/PUBLICACION_NO_ENCONTRADA/)
  })
})

// ---------------------------------------------------------------------------
describe('el PIM es del maestro', () => {
  it('una variante creada con la tienda activa A2 se ancla al origen A1 y publicar en A2 no la copia', async () => {
    const shirt = (await as(
      ownerA(),
      `insert into public.products (organization_id, company_id, sku, name, stock, kind)
       values (ebim.org_id(), ebim.active_company(), 'CAM-1', 'Camisa', 0, 'variant') returning id`,
    ))[0]?.id as string
    await publish(ownerA(), shirt, storeA1, 'camisa', '80.00')

    // El cliente manda la tienda activa (A2); la base ancla al origen.
    await as(
      member('catalog'),
      `insert into public.product_variants (organization_id, company_id, store_id, product_id, sku, name, stock, is_default)
       values (ebim.org_id(), ebim.active_company(), $1, $2, 'CAM-1-M', 'Camisa M', 3, true)`,
      [storeA2, shirt],
    )
    expect(await svc(`select store_id from public.product_variants where product_id = $1`, [shirt])).toEqual([{ store_id: storeA1 }])

    await publish(ownerA(), shirt, storeA2, 'camisa', '75.00')
    expect(await svc(`select count(*)::int as n from public.product_variants where product_id = $1`, [shirt])).toEqual([{ n: 1 }])
    const variants = await anon(`select store_id from public.public_product_variants where product_id = $1 order by store_id`, [shirt])
    expect(variants.map((row) => row.store_id).sort()).toEqual([storeA1, storeA2].sort())
  })

  it('lo cargado antes de publicar queda sin ancla y se ancla con la primera publicación', async () => {
    const draft = await createMaster(ownerA(), 'PREVIO', 'Cargado antes')
    await as(
      member('catalog'),
      `insert into public.product_images (organization_id, company_id, store_id, product_id, storage_path, position)
       values (ebim.org_id(), ebim.active_company(), $1, $2, $3, 0)`,
      [storeA2, draft, `${TENANT_A.organizationId}/${storeA2}/${draft}/foto.jpg`],
    )
    expect(await svc(`select store_id from public.product_images where product_id = $1`, [draft])).toEqual([{ store_id: null }])

    await publish(ownerA(), draft, storeA2, 'cargado-antes', '5.00')
    expect(await svc(`select store_id from public.product_images where product_id = $1`, [draft])).toEqual([{ store_id: storeA2 }])
  })
})

// ---------------------------------------------------------------------------
describe('imágenes del maestro', () => {
  it('una imagen subida desde cualquier tienda de la sociedad la ven todas donde se publica, sin copiarla', async () => {
    const shared = await createMaster(ownerA(), 'IMG-1', 'Con imagen')
    await publish(ownerA(), shared, storeA1, 'con-imagen', '10.00')
    await publish(ownerA(), shared, storeA2, 'con-imagen', '9.00')

    // Ruta legacy (subida desde A1) y ruta nueva (subida desde A2): las dos valen.
    for (const [store, file, position] of [[storeA1, 'legacy.jpg', 0], [storeA2, 'nueva.jpg', 1]] as const) {
      await as(
        member('catalog'),
        `insert into public.product_images (organization_id, company_id, store_id, product_id, storage_path, position)
         values (ebim.org_id(), ebim.active_company(), $1, $2, $3, $4)`,
        [store, shared, `${TENANT_A.organizationId}/${store}/${shared}/${file}`, position],
      )
    }
    expect(await svc(`select count(*)::int as n from public.product_images where product_id = $1`, [shared])).toEqual([{ n: 2 }])

    // Quitado de A1, sigue vendiéndose en A2 y conserva las dos imágenes.
    await as(ownerA(), `select public.unpublish_product($1, $2)`, [shared, storeA1])
    const visible = await anon(`select storage_path from public.public_product_images where product_id = $1 order by position`, [shared])
    expect(visible.map((row) => String(row.storage_path).split('/').pop())).toEqual(['legacy.jpg', 'nueva.jpg'])
  })

  it('una ruta de la tienda de otra sociedad se rechaza', async () => {
    const message = await expectFailure(() =>
      as(
        member('catalog'),
        `insert into public.product_images (organization_id, company_id, product_id, storage_path, position)
         values (ebim.org_id(), ebim.active_company(), $1, $2, 0)`,
        [master, `${TENANT_A.organizationId}/${STORE_C}/${master}/ajena.jpg`],
      ),
    )
    expect(message).toMatch(/IMAGEN_RUTA_INVALIDA/)
  })
})

// ---------------------------------------------------------------------------
describe('aislamiento y permisos', () => {
  it('el producto de A nunca se publica en B1', async () => {
    // Desde A, la tienda de B ni existe.
    expect(await expectFailure(() => publish(ownerA(), master, storeB1, 'polo-x', '1.00'))).toMatch(/TIENDA_NO_ENCONTRADA/)
    // Desde B, el producto de A ni existe.
    expect(await expectFailure(() => publish(ownerB(), master, storeB1, 'polo-x', '1.00'))).toMatch(/PRODUCTO_NO_ENCONTRADO/)
    // Ni escribiendo la tabla a mano: la FK compuesta y la RLS lo impiden.
    await expectFailure(() =>
      as(
        ownerB(),
        `insert into public.store_products (organization_id, company_id, store_id, product_id, slug, price, currency)
         values ($1, $2, $3, $4, 'robado', 1, 'PEN')`,
        [TENANT_B.organizationId, TENANT_B.companyId, storeB1, master],
      ),
    )
    expect(await svc(`select count(*)::int as n from public.store_products where store_id = $1 and product_id = $2`, [storeB1, master]))
      .toEqual([{ n: 0 }])
  })

  it('la tienda de otra sociedad de la misma organización se rechaza aunque el usuario la vea', async () => {
    const both = claimsFor(TENANT_A, {
      companies: [
        { id: TENANT_A.companyId, role: 'admin' },
        { id: COMPANY_C, role: 'admin' },
      ],
    })
    expect(await expectFailure(() => publish(both, master, STORE_C, 'polo-x', '1.00'))).toMatch(
      /TIENDA_FUERA_DE_SOCIEDAD_ACTIVA|TIENDA_NO_ENCONTRADA/,
    )
  })

  it('viewer lee el estado por tienda pero no publica, edita ni quita', async () => {
    const rows = await as(member('viewer'), `select store_id from public.product_store_publications($1)`, [master])
    expect(rows).toHaveLength(2)
    expect(await expectFailure(() => publish(member('viewer'), master, storeA1, 'x-viewer', '1.00'))).toMatch(/SIN_PERMISO/)
    expect(
      await expectFailure(() => as(member('viewer'), `select public.update_product_publication($1, $2, p_price => 1)`, [master, storeA1])),
    ).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() => as(member('viewer'), `select public.unpublish_product($1, $2)`, [master, storeA1]))).toMatch(/SIN_PERMISO/)
  })

  it('catalog publica pero no crea tiendas, ni llamando al RPC directamente', async () => {
    expect(
      await expectFailure(() => as(member('catalog'), `select public.create_store('tienda-catalog', 'No', 'PEN')`)),
    ).toMatch(/SIN_PERMISO/)
  })

  it('anon no ejecuta los comandos', async () => {
    await expectFailure(() => anon(`select public.publish_product($1, $2, 'x', 1)`, [master, storeA1]))
    await expectFailure(() => anon(`select * from public.product_store_publications($1)`, [master]))
    await expectFailure(() => anon(`select * from public.admin_product_masters`))
  })

  it('el listado de maestros es de la sociedad activa: B no ve los de A', async () => {
    expect(await as(ownerB(), `select id from public.admin_product_masters where id = $1`, [master])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('borrado protegido del maestro', () => {
  it('el uso cuenta las publicaciones y el servidor niega borrar mientras siga publicado', async () => {
    const usage = (await as(ownerA(), `select public.product_deletion_usage($1) as r`, [master]))[0]?.r as Row
    expect(usage).toMatchObject({ publications: 2 })
    expect(await expectFailure(() => as(ownerA(), `select public.delete_product_master($1)`, [master]))).toMatch(/PRODUCTO_PUBLICADO/)
  })

  it('sin publicaciones ni historia se borra; viewer no puede', async () => {
    const temp = await createMaster(ownerA(), 'BORRAR', 'Borrar')
    expect(await expectFailure(() => as(member('viewer'), `select public.delete_product_master($1)`, [temp]))).toMatch(/SIN_PERMISO/)
    await as(member('catalog'), `select public.delete_product_master($1)`, [temp])
    expect(await svc(`select count(*)::int as n from public.products where id = $1`, [temp])).toEqual([{ n: 0 }])
  })
})

// ---------------------------------------------------------------------------
describe('importación en una segunda tienda', () => {
  it('publica el maestro existente en A2 en vez de duplicarlo, con su precio y su categoría', async () => {
    const seed = await createMaster(ownerA(), 'IMP-1', 'Importado')
    await publish(ownerA(), seed, storeA1, 'importado', '25.00')

    const result = (await as(
      ownerA(),
      `select public.import_catalog_products($1, $2::jsonb, false) as r`,
      [storeA2, JSON.stringify([{ row: 2, sku: 'imp-1', price: 21.5, category_slug: 'outlet', status: 'published', name: 'Importado v2' }])],
    ))[0]?.r as Row
    expect(result).toMatchObject({ applied: true, errors: 0, products_created: 0 })

    expect(await svc(`select count(*)::int as n from public.products where lower(sku) = 'imp-1'`)).toEqual([{ n: 1 }])
    expect(
      await svc(`select store_id, slug, price::text, category_id, status::text from public.store_products where product_id = $1 order by price`, [seed]),
    ).toEqual([
      { store_id: storeA2, slug: 'importado-v2', price: '21.50', category_id: categoryA2, status: 'published' },
      { store_id: storeA1, slug: 'importado', price: '25.00', category_id: null, status: 'published' },
    ])
    // El nombre es del maestro: cambia en las dos.
    expect(await svc(`select name, store_id from public.products where id = $1`, [seed])).toEqual([{ name: 'Importado v2', store_id: storeA1 }])
  })

  it('reimportar en la tienda de origen sigue actualizando su publicación como antes', async () => {
    const result = (await as(
      ownerA(),
      `select public.import_catalog_products($1, $2::jsonb, false) as r`,
      [storeA1, JSON.stringify([{ row: 2, sku: 'IMP-1', price: 26 }])],
    ))[0]?.r as Row
    expect(result).toMatchObject({ applied: true, errors: 0 })
    expect(
      await svc(`select store_id, price::text from public.store_products where product_id = (select id from public.products where sku = 'IMP-1') order by price`),
    ).toEqual([
      { store_id: storeA2, price: '21.50' },
      { store_id: storeA1, price: '26.00' },
    ])
  })
})
