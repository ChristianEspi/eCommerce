// @vitest-environment node
/**
 * Importación del catálogo desde Excel sobre Postgres REAL (PGlite).
 *
 * Lo que tiene que quedar fijado, porque es lo que hace que alguien se atreva a
 * subir 2 000 filas: (a) simular NO escribe, (b) una fila mala no deja media
 * carga, (c) una celda vacía no borra, (d) el motivo de cada rechazo es un código
 * estable con su columna, y (e) ni el rol de lectura, ni el tenant de al lado, ni
 * una sociedad sin el módulo pasan.
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
type Tenant = typeof TENANT_A

interface ImportRow {
  sheet: string
  row: number
  key: string | null
  status: 'created' | 'updated' | 'error'
  reason?: string
  field?: string | null
}

interface ImportResult {
  dry_run: boolean
  applied: boolean
  total: number
  created: number
  updated: number
  errors: number
  rows: ImportRow[]
  inventory_by_warehouse?: boolean
  products_created?: number
  variants_created?: number
}

let db: PGlite
let storeA: string
let storeB: string

const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

const svc = (query: string, params: unknown[] = []) =>
  asRole(db, 'service_role', null, () => sql(query, params))

const viewerClaims = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

async function syncWith(tenant: Tenant, entitlements: string[]): Promise<void> {
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [tenant.organizationId, tenant.companyId, entitlements],
  )
}

async function vocabulary(sheets: unknown, dryRun: boolean, tenant: Tenant = TENANT_A): Promise<ImportResult> {
  const rows = await asRole(db, 'authenticated', claimsFor(tenant), () =>
    sql('select public.import_catalog_vocabulary($1::jsonb, $2) as r', [JSON.stringify(sheets), dryRun]),
  )
  return rows[0]?.r as ImportResult
}

async function categories(storeId: string, rows: unknown[], dryRun: boolean, tenant: Tenant = TENANT_A) {
  const result = await asRole(db, 'authenticated', claimsFor(tenant), () =>
    sql('select public.import_catalog_categories($1, $2::jsonb, $3) as r', [storeId, JSON.stringify(rows), dryRun]),
  )
  return result[0]?.r as ImportResult
}

async function products(storeId: string, rows: unknown[], dryRun: boolean, tenant: Tenant = TENANT_A) {
  const result = await asRole(db, 'authenticated', claimsFor(tenant), () =>
    sql('select public.import_catalog_products($1, $2::jsonb, $3) as r', [storeId, JSON.stringify(rows), dryRun]),
  )
  return result[0]?.r as ImportResult
}

const errorsOf = (result: ImportResult) =>
  result.rows.filter((row) => row.status === 'error').map((row) => [row.row, row.reason, row.field ?? null])

async function count(table: string, storeOrCompany: string, column = 'store_id'): Promise<number> {
  const rows = await svc(`select count(*)::int as n from public.${table} where ${column} = $1`, [storeOrCompany])
  return Number(rows[0]?.n)
}

beforeAll(async () => {
  db = await createTestDatabase()
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
    const stores = await sql(`select id, slug from public.stores order by slug`)
    storeA = String(stores.find((store) => store.slug === TENANT_A.storeSlug)?.id)
    storeB = String(stores.find((store) => store.slug === TENANT_B.storeSlug)?.id)

    await sql(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
    )
  })
  // A contrata el catálogo avanzado; B está sincronizada SIN él.
  await syncWith(TENANT_A, ['ecommerce.catalog.advanced'])
  await syncWith(TENANT_B, [])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------
describe('import_catalog_vocabulary', () => {
  const libro = {
    brands: [
      { row: 2, code: 'biel-studio', name: 'Biel Studio', description: 'Casa' },
      { row: 3, code: 'nordica', name: 'Nórdica' },
    ],
    families: [{ row: 2, code: 'ropa', name: 'Ropa' }],
    units: [{ row: 2, code: 'und', name: 'Unidad', symbol: 'und' }],
    attributes: [
      { row: 2, code: 'talla', name: 'Talla', data_type: 'opción', is_variant_axis: 'sí' },
      { row: 3, code: 'material', name: 'Material', data_type: 'texto' },
    ],
    attribute_values: [
      { row: 2, attribute_code: 'talla', label: 'S' },
      { row: 3, attribute_code: 'talla', label: 'M' },
      { row: 4, attribute_code: 'talla', code: 't40', label: '40', position: 10 },
    ],
  }

  it('simular hace el trabajo entero y no deja nada escrito', async () => {
    const result = await vocabulary(libro, true)

    expect(result).toMatchObject({ dry_run: true, applied: false, total: 9, created: 9, errors: 0 })
    expect(await count('brands', TENANT_A.companyId, 'company_id')).toBe(0)
    expect(await count('attributes', TENANT_A.companyId, 'company_id')).toBe(0)
  })

  it('aplicar crea todo, y los valores encuentran al atributo creado en la misma carga', async () => {
    const result = await vocabulary(libro, false)

    expect(result).toMatchObject({ applied: true, created: 9, updated: 0, errors: 0 })
    const valores = await svc(
      `select av.code, av.label from public.attribute_values av
         join public.attributes a on a.id = av.attribute_id
        where a.company_id = $1 and a.code = 'talla' order by av.position, av.code`,
      [TENANT_A.companyId],
    )
    expect(valores).toEqual([
      { code: 'm', label: 'M' },
      { code: 's', label: 'S' },
      { code: 't40', label: '40' },
    ])
    const talla = await svc(
      `select data_type::text, is_variant_axis from public.attributes where company_id = $1 and code = 'talla'`,
      [TENANT_A.companyId],
    )
    expect(talla[0]).toEqual({ data_type: 'option', is_variant_axis: true })
  })

  it('volver a cargar actualiza, y una celda vacía conserva el valor actual', async () => {
    const result = await vocabulary({ brands: [{ row: 2, code: 'BIEL-STUDIO', name: 'Biel Studio Lima' }] }, false)

    expect(result).toMatchObject({ applied: true, created: 0, updated: 1 })
    const marca = await svc(`select name, description from public.brands where company_id = $1 and code = 'biel-studio'`, [
      TENANT_A.companyId,
    ])
    expect(marca[0]).toEqual({ name: 'Biel Studio Lima', description: 'Casa' })
  })

  it('una fila mala rechaza la carga entera y dice qué columna', async () => {
    const result = await vocabulary(
      {
        brands: [
          { row: 2, code: 'urbano', name: 'Urbano' },
          { row: 3, code: 'Lima Denim', name: 'Lima Denim' },
        ],
        attribute_values: [{ row: 2, attribute_code: 'no-existe', label: 'Rojo' }],
      },
      false,
    )

    expect(result.applied).toBe(false)
    expect(errorsOf(result)).toEqual([
      [3, 'CODIGO_INVALIDO', 'code'],
      [2, 'ATRIBUTO_NO_ENCONTRADO', 'attribute_code'],
    ])
    expect(await svc(`select 1 from public.brands where company_id = $1 and code = 'urbano'`, [TENANT_A.companyId])).toEqual([])
  })

  it('valores solo en atributos de lista', async () => {
    const result = await vocabulary({ attribute_values: [{ row: 5, attribute_code: 'material', label: 'Lino' }] }, true)
    expect(errorsOf(result)).toEqual([[5, 'ATRIBUTO_NO_ES_LISTA', 'attribute_code']])
  })

  it('una columna que la carga no admite rechaza el libro entero', async () => {
    const message = await expectFailure(() =>
      vocabulary({ brands: [{ code: 'x1', name: 'X', organization_id: TENANT_B.organizationId }] }, true),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('el rol de lectura, la sociedad sin módulo y el anónimo no pasan', async () => {
    expect(
      await expectFailure(() =>
        asRole(db, 'authenticated', viewerClaims(), () =>
          sql(`select public.import_catalog_vocabulary('{"brands":[]}'::jsonb, true)`),
        ),
      ),
    ).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() => vocabulary({ brands: [] }, true, TENANT_B))).toMatch(/MODULO_NO_CONTRATADO/)
    expect(
      await expectFailure(() =>
        asRole(db, 'anon', null, () => sql(`select public.import_catalog_vocabulary('{}'::jsonb, true)`)),
      ),
    ).toMatch(/permission denied/)
  })
})

// ---------------------------------------------------------------------------
describe('import_catalog_categories', () => {
  it('una hija que viene antes que su madre espera a la madre', async () => {
    const result = await categories(
      storeA,
      [
        { row: 2, slug: 'mujer-vestidos', name: 'Vestidos', parent_slug: 'mujer' },
        { row: 3, slug: 'mujer', name: 'Mujer' },
        { row: 4, name: 'Niños y bebés' },
      ],
      false,
    )

    expect(result).toMatchObject({ applied: true, created: 3, errors: 0 })
    expect(result.rows.map((row) => row.row)).toEqual([2, 3, 4])
    const arbol = await svc(
      `select c.slug, p.slug as madre from public.categories c
         left join public.categories p on p.id = c.parent_id
        where c.store_id = $1 order by c.slug`,
      [storeA],
    )
    expect(arbol).toEqual([
      { slug: 'mujer', madre: null },
      { slug: 'mujer-vestidos', madre: 'mujer' },
      { slug: 'ninos-y-bebes', madre: null },
    ])
  })

  it('una madre que no existe es un rechazo con su columna, y no se escribe nada', async () => {
    const result = await categories(
      storeA,
      [
        { row: 2, slug: 'hombre', name: 'Hombre' },
        { row: 3, slug: 'calzado-botas', name: 'Botas', parent_slug: 'calzado' },
      ],
      false,
    )

    expect(result.applied).toBe(false)
    expect(errorsOf(result)).toEqual([[3, 'PADRE_NO_ENCONTRADO', 'parent_slug']])
    expect(await svc(`select 1 from public.categories where store_id = $1 and slug = 'hombre'`, [storeA])).toEqual([])
  })

  it('la tienda de otro tenant no se toca', async () => {
    expect(await expectFailure(() => categories(storeB, [{ slug: 'intrusa', name: 'Intrusa' }], false))).toMatch(
      /SIN_PERMISO/,
    )
    expect(await count('categories', storeB)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('import_catalog_products', () => {
  it('crea un producto simple con categoría, marca y estado publicado', async () => {
    const result = await products(
      storeA,
      [
        {
          row: 2, sku: 'BIE-BLU-0001', name: 'Blusa Aurora de lino', category_slug: 'mujer',
          brand_code: 'biel-studio', family_code: 'ropa', price: '129,90', compare_at_price: 159.9,
          status: 'publicado', stock: 12,
        },
      ],
      false,
    )

    expect(result).toMatchObject({ applied: true, created: 1, errors: 0, inventory_by_warehouse: false })
    const producto = await svc(
      // ADR 018: slug, precio, moneda, estado y categoría son de la publicación
      // en la tienda; stock, tipo y marca, del maestro.
      `select sp.slug, sp.price::text, sp.currency::text, p.stock, p.kind::text, sp.status::text,
              sp.published_at is not null as publicado, c.slug as categoria, b.code as marca
         from public.products p
         join public.store_products sp on sp.product_id = p.id and sp.store_id = $1
         left join public.categories c on c.id = sp.category_id
         left join public.brands b on b.id = p.brand_id
        where p.sku = 'BIE-BLU-0001'`,
      [storeA],
    )
    expect(producto[0]).toEqual({
      slug: 'blusa-aurora-de-lino', price: '129.90', currency: 'PEN', stock: 12, kind: 'simple',
      status: 'published', publicado: true, categoria: 'mujer', marca: 'biel-studio',
    })
  })

  it('varias filas con el mismo SKU forman un producto con variantes y sus ejes', async () => {
    const result = await products(
      storeA,
      [
        { row: 2, sku: 'BIE-VES-0001', name: 'Vestido Dalia midi', price: 189, category_slug: 'mujer-vestidos', variant_sku: 'BIE-VES-0001-S', variant_stock: 5, axes: { talla: 's' } },
        { row: 3, sku: 'BIE-VES-0001', variant_sku: 'BIE-VES-0001-M', variant_stock: 7, axes: { Talla: 'M' } },
        { row: 4, sku: 'BIE-VES-0001', price: 189, variant_sku: 'BIE-VES-0001-40', variant_price: 199, axes: { talla: '40' } },
      ],
      false,
    )

    expect(result).toMatchObject({ applied: true, created: 3, errors: 0, products_created: 1, variants_created: 3 })
    const variantes = await svc(
      `select pv.sku, pv.name, pv.stock, pv.price::text, pv.is_default, av.code as talla
         from public.product_variants pv
         join public.variant_attribute_values vav on vav.variant_id = pv.id
         join public.attribute_values av on av.id = vav.value_id
        where pv.store_id = $1 order by pv.position`,
      [storeA],
    )
    expect(variantes).toEqual([
      { sku: 'BIE-VES-0001-S', name: 'Vestido Dalia midi · S', stock: 5, price: null, is_default: true, talla: 's' },
      { sku: 'BIE-VES-0001-M', name: 'Vestido Dalia midi · M', stock: 7, price: null, is_default: false, talla: 'm' },
      { sku: 'BIE-VES-0001-40', name: 'Vestido Dalia midi · 40', stock: 0, price: '199.00', is_default: false, talla: 't40' },
    ])
    const tipo = await svc(`select kind::text from public.products where store_id = $1 and sku = 'BIE-VES-0001'`, [storeA])
    expect(tipo[0]).toEqual({ kind: 'variant' })
  })

  it('una hoja con solo SKU y precio cambia el precio y no borra lo demás', async () => {
    const result = await products(storeA, [{ row: 2, sku: 'bie-blu-0001', price: 99.9 }], false)

    expect(result).toMatchObject({ applied: true, created: 0, updated: 1 })
    const producto = await svc(
      `select p.name, sp.price::text, p.stock, sp.status::text
         from public.products p
         join public.store_products sp on sp.product_id = p.id and sp.store_id = $1
        where p.sku = 'BIE-BLU-0001'`,
      [storeA],
    )
    expect(producto[0]).toEqual({ name: 'Blusa Aurora de lino', price: '99.90', stock: 12, status: 'published' })
  })

  it('cada rechazo dice su motivo y su columna, y la carga no se aplica', async () => {
    const result = await products(
      storeA,
      [
        { row: 2, sku: 'BIE-POL-0001', name: 'Polo Base', price: 59, variant_sku: 'BIE-POL-0001-S', axes: { talla: 's' } },
        { row: 3, sku: 'BIE-POL-0001', price: 69, variant_sku: 'BIE-POL-0001-M', axes: { talla: 'm' } },
        { row: 4, sku: 'BIE-POL-0002', name: 'Polo Costa', price: 59, variant_sku: 'BIE-POL-0002-XXL', axes: { talla: 'XXL' } },
        { row: 5, sku: 'BIE-POL-0003', name: 'Polo Norte', price: 59, category_slug: 'no-existe' },
        { row: 6, sku: 'BIE-POL-0004', name: 'Polo Muelle', price: 'gratis' },
        { row: 7, sku: 'BIE-BLU-0001', variant_sku: 'BIE-BLU-0001-S', axes: { talla: 's' } },
        { row: 8, sku: 'BIE-POL-0005', name: 'Polo Dique', price: 59, variant_sku: 'BIE-VES-0001', axes: { color: 'rojo' } },
        { row: 9, sku: 'BIE-POL-0006', price: 59 },
      ],
      false,
    )

    expect(result.applied).toBe(false)
    expect(errorsOf(result)).toEqual([
      [3, 'DATO_DISTINTO', 'price'],
      [4, 'VALOR_NO_ENCONTRADO', 'talla'],
      [5, 'CATEGORIA_NO_ENCONTRADA', 'category_slug'],
      [6, 'NUMERO_INVALIDO', 'price'],
      [7, 'TIPO_DISTINTO', 'variant_sku'],
      [8, 'EJE_NO_ENCONTRADO', 'color'],
      [9, 'CAMPO_REQUERIDO', 'name'],
    ])
    expect(await svc(`select 1 from public.products where store_id = $1 and sku like 'BIE-POL-%'`, [storeA])).toEqual([])
  })

  it('el SKU de una variante no puede repetir el de un producto', async () => {
    const result = await products(
      storeA,
      [{ row: 2, sku: 'BIE-POL-0009', name: 'Polo Faro', price: 59, variant_sku: 'BIE-BLU-0001', axes: { talla: 's' } }],
      true,
    )
    expect(errorsOf(result)).toEqual([[2, 'SKU_DUPLICADO', null]])
  })

  it('simular no escribe y avisa cuando la tienda sirve desde almacenes', async () => {
    await svc(
      `insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'alm-a', 'Almacén A')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const antes = await count('products', storeA)
    const result = await products(storeA, [{ row: 2, sku: 'BIE-GOR-0001', name: 'Gorra Trucker', price: 45 }], true)

    expect(result).toMatchObject({ dry_run: true, applied: false, created: 1, inventory_by_warehouse: true })
    expect(await count('products', storeA)).toBe(antes)
  })

  it('sin catálogo avanzado, las filas con variante o marca se rechazan una a una', async () => {
    const result = await products(
      storeB,
      [
        { row: 2, sku: 'B-1', name: 'Simple', price: 10 },
        { row: 3, sku: 'B-2', name: 'Con marca', price: 10, brand_code: 'x' },
        { row: 4, sku: 'B-3', name: 'Con variante', price: 10, variant_sku: 'B-3-S' },
      ],
      true,
      TENANT_B,
    )
    expect(errorsOf(result)).toEqual([
      [3, 'MODULO_NO_CONTRATADO', 'brand_code'],
      [4, 'MODULO_NO_CONTRATADO', 'variant_sku'],
    ])
  })

  it('ni el rol de lectura ni el tenant de al lado importan productos', async () => {
    expect(
      await expectFailure(() =>
        asRole(db, 'authenticated', viewerClaims(), () =>
          sql(`select public.import_catalog_products($1, '[]'::jsonb, true)`, [storeA]),
        ),
      ),
    ).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() => products(storeA, [], true, TENANT_B))).toMatch(/SIN_PERMISO/)
    expect(
      await expectFailure(() => products(storeA, [{ sku: 'X', name: 'X', price: 1, currency: 'USD' }], true)),
    ).toMatch(/CAMPO_NO_PERMITIDO/)
  })
})
