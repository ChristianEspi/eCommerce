// @vitest-environment node
/**
 * P04 · Administración de catálogo sobre Postgres REAL (PGlite).
 *
 * Lo que se prueba aquí no es "que el SQL parezca correcto", sino que la base
 * efectivamente: (a) mantenga una sola imagen principal por producto, (b)
 * reordene entero o falle entero, (c) cuente el uso real bajo la RLS de quien
 * pregunta y (d) no deje que el tenant de al lado toque nada de esto.
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
let productA: string
let productB: string
let categoryA: string
let imagesA: string[] = []

const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

const viewerClaims = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

async function imagesOf(productId: string): Promise<Row[]> {
  return asRole(db, 'service_role', null, () =>
    sql(
      `select id, "position", is_primary from public.product_images
        where product_id = $1 order by "position"`,
      [productId],
    ),
  )
}

async function seed(): Promise<void> {
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
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
    await sql(`update public.stores set status = 'active'`)

    const stores = await sql(`select id, slug from public.stores order by slug`)
    storeA = String(stores.find((store) => store.slug === TENANT_A.storeSlug)?.id)
    storeB = String(stores.find((store) => store.slug === TENANT_B.storeSlug)?.id)

    await sql(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
    )

    categoryA = String(
      (
        await sql(
          `insert into public.categories (organization_id, company_id, store_id, slug, name)
           values ($1, $2, $3, 'sillas', 'Sillas') returning id`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA],
        )
      )[0]?.id,
    )

    const insertProduct = `
      insert into public.products
        (organization_id, company_id, store_id, category_id, sku, slug, name, price, currency, stock, status)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'PEN', 10, 'draft')
      returning id`

    productA = String(
      (
        await sql(insertProduct, [
          TENANT_A.organizationId, TENANT_A.companyId, storeA, categoryA,
          'A-1', 'silla-a', 'Silla A', '199.90',
        ])
      )[0]?.id,
    )
    productB = String(
      (
        await sql(insertProduct, [
          TENANT_B.organizationId, TENANT_B.companyId, storeB, null,
          'B-1', 'silla-b', 'Silla B', '99.00',
        ])
      )[0]?.id,
    )

    // Un pedido de A que consume el producto: es el "uso real" que el diálogo
    // de borrado tiene que enseñar antes de dejar eliminar.
    const orderA = String(
      (
        await sql(
          `insert into public.orders
             (organization_id, company_id, store_id, channel_id, order_number, customer_email,
              currency, subtotal, grand_total)
           values ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default), 'A-0001', 'cliente@correo.com', 'PEN', '199.90', '199.90')
           returning id`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA],
        )
      )[0]?.id,
    )
    await sql(
      `insert into public.order_items
         (organization_id, company_id, store_id, order_id, product_id, sku, name, unit_price, quantity)
       values ($1, $2, $3, $4, $5, 'A-1', 'Silla A', '199.90', 1)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, orderA, productA],
    )
  })
}

/** Sube tres imágenes de A como su propietario, que es quien tiene rol. */
async function seedImages(): Promise<void> {
  imagesA = []
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
    for (const index of [0, 1, 2]) {
      const rows = await sql(
        `insert into public.product_images
           (organization_id, company_id, store_id, product_id, storage_path, "position", is_primary)
         values ($1, $2, $3, $4, $5, $6, false)
         returning id`,
        [
          TENANT_A.organizationId,
          TENANT_A.companyId,
          storeA,
          productA,
          `${TENANT_A.organizationId}/${storeA}/${productA}/foto-${index}.jpg`,
          index,
        ],
      )
      imagesA.push(String(rows[0]?.id))
    }
  })
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed()
  await seedImages()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

/**
 * `admin_products`: el listado del backoffice con la categoria y la marca al
 * lado.
 *
 * La vista existe para una cosa muy concreta: que el buscador general pueda
 * mirar `category_name` y `brand_name` dentro del mismo `or=` que ya mira
 * nombre y SKU. PostgREST sabe filtrar por una tabla relacionada, pero no sabe
 * meter esa condicion dentro de un OR junto a columnas propias.
 *
 * Lo que hay que demostrar de una vista con `security_invoker` es justo lo que
 * la haria peligrosa si estuviera mal: que NO amplia un permiso. Una vista sin
 * eso se ejecuta con los privilegios de quien la creo y se convierte en una
 * puerta de atras al catalogo del tenant de al lado.
 */
describe('el listado del backoffice', () => {
  let brandA: string

  beforeAll(async () => {
    await asRole(db, 'service_role', null, async () => {
      brandA = String(
        (
          await sql(
            `insert into public.brands (organization_id, company_id, code, name)
             values ($1, $2, 'nordica', 'Nordica') returning id`,
            [TENANT_A.organizationId, TENANT_A.companyId],
          )
        )[0]?.id,
      )
      await sql(`update public.products set brand_id = $1 where id = $2`, [brandA, productA])
    })
  })

  it('trae el nombre de la categoria y el de la marca junto al producto', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select sku, category_name, brand_name from public.admin_products where id = $1`, [
        productA,
      ]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.category_name).toBe('Sillas')
    expect(rows[0]?.brand_name).toBe('Nordica')
  })

  /**
   * Con `join` a secas en vez de `left join`, dar de alta un producto y no
   * elegirle marca lo haria desaparecer de su propia tabla. Es la forma mas
   * rapida de que alguien crea que no se guardo.
   */
  it('un producto sin categoria ni marca sigue apareciendo, con los nombres nulos', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select sku, category_name, brand_name from public.admin_products`),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.sku).toBe('B-1')
    expect(rows[0]?.category_name).toBeNull()
    expect(rows[0]?.brand_name).toBeNull()
  })

  it('el tenant de al lado no ve ni una fila: la vista no amplia la RLS', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select id from public.admin_products where id = $1`, [productA]),
    )
    expect(rows).toHaveLength(0)
  })

  it('el comprador anonimo no entra: esto es backoffice, no vitrina', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => sql(`select id from public.admin_products`)),
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('imagen principal', () => {
  it('la primera imagen del producto queda como principal sin pedirlo', async () => {
    const rows = await imagesOf(productA)
    expect(rows.filter((row) => row.is_primary)).toHaveLength(1)
    expect(rows[0]?.is_primary).toBe(true)
  })

  it('cambiar la principal deja exactamente una, sin chocar con el indice unico', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.set_primary_product_image($1)`, [imagesA[2]]),
    )

    const rows = await imagesOf(productA)
    const primary = rows.filter((row) => row.is_primary)
    expect(primary).toHaveLength(1)
    expect(String(primary[0]?.id)).toBe(imagesA[2])
  })

  it('volver a marcar la que ya es principal no falla ni duplica', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.set_primary_product_image($1)`, [imagesA[2]]),
    )
    expect((await imagesOf(productA)).filter((row) => row.is_primary)).toHaveLength(1)
  })

  it('un rol sin catalogo no puede cambiarla: falla en vez de no hacer nada', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', viewerClaims(), () =>
        sql(`select public.set_primary_product_image($1)`, [imagesA[0]]),
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
    expect(String((await imagesOf(productA)).filter((row) => row.is_primary)[0]?.id)).toBe(
      imagesA[2],
    )
  })

  it('el tenant de al lado no ve la imagen: para el no existe', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
        sql(`select public.set_primary_product_image($1)`, [imagesA[0]]),
      ),
    )
    expect(message).toMatch(/IMAGEN_NO_ENCONTRADA/)
  })

  it('anon no puede ejecutar ninguna de las funciones de catalogo', async () => {
    for (const call of [
      `select public.set_primary_product_image('00000000-0000-4000-8000-000000000000')`,
      `select public.reorder_product_images('00000000-0000-4000-8000-000000000000', array[]::uuid[])`,
      `select public.product_deletion_usage('00000000-0000-4000-8000-000000000000')`,
      `select public.category_deletion_usage('00000000-0000-4000-8000-000000000000')`,
    ]) {
      const message = await expectFailure(() => asRole(db, 'anon', null, () => sql(call)))
      expect(message).toMatch(/permission denied/i)
    }
  })
})

describe('orden de las imagenes', () => {
  it('aplica el orden completo que se le envia', async () => {
    const reversed = [...imagesA].reverse()
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.reorder_product_images($1, $2)`, [productA, reversed]),
    )

    const rows = await imagesOf(productA)
    expect(rows.map((row) => String(row.id))).toEqual(reversed)
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2])
  })

  it('rechaza un orden parcial: dejaria posiciones duplicadas', async () => {
    const before = await imagesOf(productA)
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select public.reorder_product_images($1, $2)`, [productA, [imagesA[0]]]),
      ),
    )
    expect(message).toMatch(/CAMPO_INVALIDO/)
    expect(await imagesOf(productA)).toEqual(before)
  })

  it('rechaza un orden con imagenes repetidas', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select public.reorder_product_images($1, $2)`, [
          productA,
          [imagesA[0], imagesA[0], imagesA[1]],
        ]),
      ),
    )
    expect(message).toMatch(/CAMPO_INVALIDO/)
  })

  it('rechaza una lista vacia', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select public.reorder_product_images($1, array[]::uuid[])`, [productA]),
      ),
    )
    expect(message).toMatch(/ITEMS_REQUERIDOS/)
  })

  it('el tenant de al lado no reordena el catalogo ajeno', async () => {
    const before = await imagesOf(productA)
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
        sql(`select public.reorder_product_images($1, $2)`, [productA, [...imagesA].reverse()]),
      ),
    )
    // Para B el producto no tiene imagenes visibles: ni siquiera llega a escribir.
    expect(message).toMatch(/CAMPO_INVALIDO/)
    expect(await imagesOf(productA)).toEqual(before)
  })

  it('un rol sin catalogo no reordena', async () => {
    const before = await imagesOf(productA)
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', viewerClaims(), () =>
        sql(`select public.reorder_product_images($1, $2)`, [productA, [...imagesA].reverse()]),
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
    expect(await imagesOf(productA)).toEqual(before)
  })
})

describe('eliminacion segura (contrato §4.2)', () => {
  // P03-SaaS amplia el conteo con `variants` y `bundles`: el segundo NO es
  // informativo —la FK del componente es `restrict` y decide si el borrado
  // puede ocurrir—. Se sigue comparando el objeto ENTERO para que una clave
  // nueva no entre sin que nadie la mire.
  it('el conteo de uso del producto es el real: lineas, imagenes, variantes, kits y tiendas', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.product_deletion_usage($1) as usage`, [productA]),
    )
    expect(rows[0]?.usage).toEqual({
      name: 'Silla A',
      order_lines: 1,
      images: 3,
      variants: 0,
      bundles: 0,
      // ADR 018: publicado en su tienda de siempre.
      publications: 1,
    })
  })

  it('el tenant de al lado no obtiene el conteo del producto ajeno', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
        sql(`select public.product_deletion_usage($1)`, [productA]),
      ),
    )
    expect(message).toMatch(/PRODUCTO_NO_ENCONTRADO/)
  })

  it('un JWT con el org_id ajeno tampoco cuenta nada', async () => {
    const message = await expectFailure(() =>
      asRole(
        db,
        'authenticated',
        claimsFor(TENANT_B, {
          org_id: TENANT_A.organizationId,
          companies: [{ id: TENANT_A.companyId, role: 'admin' }],
          active_company: TENANT_A.companyId,
        }),
        () => sql(`select public.product_deletion_usage($1)`, [productA]),
      ),
    )
    expect(message).toMatch(/PRODUCTO_NO_ENCONTRADO/)
  })

  it('el conteo de la categoria cuenta sus productos y sus hijas', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.category_deletion_usage($1) as usage`, [categoryA]),
    )
    expect(rows[0]?.usage).toEqual({ name: 'Sillas', products: 1, children: 0 })
  })

  it('borrar la categoria NO borra sus productos: quedan sin categoria', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`delete from public.categories where id = $1`, [categoryA]),
    )
    const rows = await asRole(db, 'service_role', null, () =>
      sql(`select category_id from public.products where id = $1`, [productA]),
    )
    expect(rows[0]?.category_id).toBeNull()
  })

  it('al borrar la imagen principal asciende la siguiente', async () => {
    const before = await imagesOf(productA)
    const primaryId = String(before.find((row) => row.is_primary)?.id)

    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`delete from public.product_images where id = $1`, [primaryId]),
    )

    const after = await imagesOf(productA)
    expect(after).toHaveLength(2)
    expect(after.filter((row) => row.is_primary)).toHaveLength(1)
    expect(String(after[0]?.id)).toBe(String(after.filter((row) => row.is_primary)[0]?.id))
  })

  it('borrar el producto se lleva sus imagenes y deja el pedido intacto', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`delete from public.products where id = $1`, [productA]),
    )

    const rows = await asRole(db, 'service_role', null, () =>
      sql(
        `select
           (select count(*) from public.product_images where product_id = $1)::int as images,
           (select count(*) from public.order_items where sku = 'A-1')::int          as lines,
           (select product_id from public.order_items where sku = 'A-1')             as product_ref`,
        [productA],
      ),
    )
    expect(rows[0]?.images).toBe(0)
    // El pedido conserva su snapshot (sku, nombre, precio) y solo pierde el enlace.
    expect(rows[0]?.lines).toBe(1)
    expect(rows[0]?.product_ref).toBeNull()
  })

  it('el producto del otro tenant sigue ahi despues de todo esto', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select id, name from public.products`),
    )
    expect(rows).toHaveLength(1)
    expect(String(rows[0]?.id)).toBe(productB)
  })
})
