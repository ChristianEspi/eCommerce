// @vitest-environment node
/**
 * Ingesta de catálogo por la API de socio (`public.api_catalog_upsert`), contra
 * Postgres real.
 *
 * Lo que queda fijado:
 * - el tenant sale de la credencial: el cuerpo no puede nombrar sociedad, y la
 *   tienda de otra sociedad no existe para el integrador;
 * - upsert por SKU en el maestro de la sociedad, con publicación por tienda y
 *   precio de variante por tienda;
 * - todo o nada: una fila mala deshace el lote, y `dry_run` nunca escribe;
 * - reenviar lo mismo sale `unchanged`; omitido no toca, `null` vacía;
 * - cada error dice su código estable y la ruta JSON del campo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>
interface Item {
  index: number
  sku: string
  status: string
  product_id: string | null
  publications: Array<{ store: string; status: string }>
  errors: Array<{ code: string; field: string; message: string }>
}
interface Report {
  dry_run: boolean
  applied: boolean
  summary: { received: number; created: number; updated: number; unchanged: number; rejected: number }
  items: Item[]
}

let db: PGlite
let clientA = ''
let clientB = ''
let clientReadOnly = ''
let storeA1 = ''
let storeA2 = ''

const ENTERPRISE = 'ecommerce.integrations.enterprise'
const ADVANCED = 'ecommerce.catalog.advanced'
const A2 = 'tienda-a2-api'

async function sql<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(query, params)).rows
}
const svc = <T = Row>(query: string, params: unknown[] = []) =>
  asRole(db, 'service_role', null, () => sql<T>(query, params))
const ownerOf = <T = Row>(tenant: typeof TENANT_A, query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claimsFor(tenant), () => sql<T>(query, params))

async function ingest(client: string, payload: unknown, dryRun = false): Promise<Report> {
  const [row] = await svc<{ r: Report }>(`select public.api_catalog_upsert($1, $2::jsonb, $3) as r`, [
    client,
    JSON.stringify(payload),
    dryRun,
  ])
  return row?.r as Report
}

async function credential(tenant: typeof TENANT_A, scopes: string[]): Promise<string> {
  const [row] = await ownerOf<{ data: { id: string } }>(tenant, `select public.api_client_create($1, $2) as data`, [
    `erp-${scopes.join('-')}`,
    scopes,
  ])
  return String(row?.data.id)
}

async function productBySku(tenant: typeof TENANT_A, sku: string): Promise<Row | undefined> {
  return (
    await svc(`select * from public.products where organization_id = $1 and company_id = $2 and sku = $3`, [
      tenant.organizationId,
      tenant.companyId,
      sku,
    ])
  )[0]
}

async function publication(productId: unknown, storeId: string): Promise<Row | undefined> {
  return (await svc(`select * from public.store_products where product_id = $1 and store_id = $2`, [productId, storeId]))[0]
}

const simple = (sku: string, extra: Row = {}, pub: Row = {}) => ({
  sku,
  name: `Producto ${sku}`,
  publications: [{ store: TENANT_A.storeSlug, price: '10.00', ...pub }],
  ...extra,
})

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
  })
  const created = await ownerOf<{ r: Row }>(TENANT_A, `select public.create_store($1, 'Tienda A2', 'PEN') as r`, [A2])
  storeA2 = String(created[0]?.r.id)
  await svc(`update public.stores set status = 'active'`)
  storeA1 = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)

  for (const [tenant, entitlements] of [
    [TENANT_A, [ENTERPRISE, ADVANCED]],
    [TENANT_B, [ENTERPRISE]],
  ] as const) {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      tenant.organizationId, tenant.companyId, entitlements,
    ])
  }

  // Vocabulario de la sociedad A.
  await svc(
    `insert into public.categories (organization_id, company_id, store_id, slug, name)
     values ($1, $2, $3, 'cuidado-de-la-piel', 'Cuidado de la piel'), ($1, $2, $4, 'liquidacion', 'Liquidación')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA1, storeA2],
  )
  await svc(
    `insert into public.brands (organization_id, company_id, code, name) values ($1, $2, 'eucerin', 'Eucerin')`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const attrs = await svc<{ id: string; code: string }>(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, is_variant_axis)
     values ($1, $2, 'color', 'Color', 'option', true), ($1, $2, 'talla', 'Talla', 'option', true),
            ($1, $2, 'material', 'Material', 'text', false)
     returning id, code`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const attr = (code: string) => attrs.find((a) => a.code === code)?.id
  await svc(
    `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
     values ($1, $2, $3, 'rosa-palo', 'Rosa palo'), ($1, $2, $4, 's', 'S'), ($1, $2, $4, 'm', 'M')`,
    [TENANT_A.organizationId, TENANT_A.companyId, attr('color'), attr('talla')],
  )

  clientA = await credential(TENANT_A, ['catalog.write', 'product.read'])
  clientB = await credential(TENANT_B, ['catalog.write'])
  clientReadOnly = await credential(TENANT_A, ['product.read'])
}, 240_000)

beforeEach(async () => {
  await svc(`delete from public.api_idempotency`)
})

afterAll(async () => {
  await db?.close()
})

describe('permiso y forma del lote', () => {
  it('una credencial sin catalog.write no escribe', async () => {
    expect(await expectFailure(() => ingest(clientReadOnly, { products: [simple('X-1')] }))).toMatch(
      /SCOPE_INSUFICIENTE/,
    )
  })

  it('el cuerpo no puede nombrar la sociedad', async () => {
    const message = await expectFailure(() =>
      ingest(clientA, { organization_id: TENANT_B.organizationId, products: [simple('X-1')] }),
    )
    expect(message).toMatch(/^CAMPO_NO_PERMITIDO/)
  })

  it('un lote vacío o de más de 500 productos se rechaza entero', async () => {
    expect(await expectFailure(() => ingest(clientA, { products: [] }))).toMatch(/^LOTE_INVALIDO/)
    const many = Array.from({ length: 501 }, (_, i) => simple(`M-${i}`))
    expect(await expectFailure(() => ingest(clientA, { products: many }))).toMatch(/^LOTE_EXCESIVO/)
  })

  it('las funciones no se pueden llamar desde el navegador', async () => {
    const [row] = await svc<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.api_catalog_upsert(uuid, jsonb, boolean)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.api_catalog_upsert(uuid, jsonb, boolean)', 'execute') as auth`,
    )
    expect(row).toEqual({ anon: false, auth: false })
  })
})

describe('alta y actualización de un producto simple', () => {
  const payload = {
    products: [
      {
        sku: 'QS-514574',
        gtin: '4005800077937',
        name: 'Bloqueador Solar Eucerin FPS 50',
        description: 'Frasco de 150 ml',
        brand_code: 'eucerin',
        stock: 181,
        attributes: { material: 'Loción' },
        custom_fields: { codigo_qs: '514574', linea: 'BEIERSDORF' },
        publications: [
          {
            store: TENANT_A.storeSlug,
            category_slug: 'cuidado-de-la-piel',
            status: 'published',
            price: '111.29',
            compare_at_price: '130.93',
            currency: 'PEN',
          },
        ],
      },
    ],
  }

  it('dry_run informa el alta y no escribe nada', async () => {
    const report = await ingest(clientA, payload, true)
    expect(report).toMatchObject({ dry_run: true, applied: false, summary: { received: 1, created: 1, rejected: 0 } })
    expect(report.items[0]).toMatchObject({ status: 'created', product_id: null, errors: [] })
    expect(await productBySku(TENANT_A, 'QS-514574')).toBeUndefined()
    expect(await svc(`select 1 from public.audit_log where action = 'catalog.batch_via_api'`)).toHaveLength(0)
  })

  it('aplicado crea el maestro, su ficha y la publicación en la tienda', async () => {
    const report = await ingest(clientA, payload)
    expect(report).toMatchObject({ dry_run: false, applied: true, summary: { created: 1 } })
    expect(report.items[0]?.publications).toEqual([{ store: TENANT_A.storeSlug, status: 'created' }])

    const product = await productBySku(TENANT_A, 'QS-514574')
    expect(product).toMatchObject({
      id: report.items[0]?.product_id,
      gtin: '4005800077937',
      kind: 'simple',
      stock: 181,
      custom_fields: { codigo_qs: '514574', linea: 'BEIERSDORF' },
      store_id: storeA1,
      price: null,
    })
    const pub = await publication(product?.id, storeA1)
    expect(pub).toMatchObject({ status: 'published', price: '111.29', compare_at_price: '130.93', currency: 'PEN' })
    expect(pub?.slug).toBe('bloqueador-solar-eucerin-fps-50')
    expect(await svc(`select value_text from public.product_attribute_values where product_id = $1`, [product?.id])).toEqual([
      { value_text: 'Loción' },
    ])

    // Visible en la vitrina de esa tienda, y solo en esa.
    const vitrina = await asRole(db, 'anon', null, () =>
      sql(`select store_id from public.public_products where product_id = $1`, [product?.id]),
    )
    expect(vitrina.map((r) => r.store_id)).toEqual([storeA1])

    const audit = await svc(`select metadata from public.audit_log where action = 'catalog.batch_via_api'`)
    expect(audit).toHaveLength(1)
    expect(audit[0]?.metadata).toMatchObject({ api_client_id: clientA, created: 1 })
  })

  it('reenviar lo mismo sale unchanged', async () => {
    const report = await ingest(clientA, payload)
    expect(report.summary).toMatchObject({ unchanged: 1, updated: 0, created: 0 })
    expect(report.items[0]?.publications).toEqual([{ store: TENANT_A.storeSlug, status: 'unchanged' }])
  })

  it('omitido no toca, null vacía y custom_fields se fusiona', async () => {
    const report = await ingest(clientA, {
      products: [
        {
          sku: 'QS-514574',
          description: null,
          custom_fields: { linea: null, pack_maestro: 24 },
          publications: [{ store: TENANT_A.storeSlug, price: '99.90', compare_at_price: null }],
        },
      ],
    })
    expect(report.items[0]).toMatchObject({ status: 'updated', publications: [{ status: 'updated' }] })
    const product = await productBySku(TENANT_A, 'QS-514574')
    expect(product).toMatchObject({
      name: 'Bloqueador Solar Eucerin FPS 50',
      description: null,
      gtin: '4005800077937',
      stock: 181,
      custom_fields: { codigo_qs: '514574', pack_maestro: 24 },
    })
    expect(await publication(product?.id, storeA1)).toMatchObject({
      price: '99.90',
      compare_at_price: null,
      status: 'published',
    })
  })

  it('publicar en una segunda tienda no toca la primera', async () => {
    const report = await ingest(clientA, {
      products: [{ sku: 'QS-514574', publications: [{ store: A2, price: '89.90', category_slug: 'liquidacion' }] }],
    })
    expect(report.items[0]?.publications).toEqual([{ store: A2, status: 'created' }])
    const product = await productBySku(TENANT_A, 'QS-514574')
    expect(await publication(product?.id, storeA2)).toMatchObject({ price: '89.90', status: 'draft' })
    expect(await publication(product?.id, storeA1)).toMatchObject({ price: '99.90' })
    expect(await svc(`select count(*)::int as n from public.products where sku = 'QS-514574'`)).toEqual([{ n: 1 }])
  })
})

describe('todo o nada', () => {
  it('una fila mala deshace el lote y el informe dice qué falló y dónde', async () => {
    const report = await ingest(clientA, {
      products: [simple('OK-1'), simple('MALA-1', {}, { category_slug: 'no-existe' })],
    })
    expect(report).toMatchObject({ applied: false, summary: { received: 2, created: 1, rejected: 1 } })
    expect(report.items[0]).toMatchObject({ status: 'created', product_id: null })
    expect(report.items[1]).toMatchObject({
      status: 'rejected',
      errors: [{ code: 'CATEGORIA_NO_ENCONTRADA', field: 'products[1].publications[0].category_slug' }],
    })
    expect(await productBySku(TENANT_A, 'OK-1')).toBeUndefined()
  })

  it('cada regla del contrato tiene su código y su campo', async () => {
    const report = await ingest(clientA, {
      products: [
        simple('E-1', { gtin: '4005800077930' }),
        simple('E-2', {}, { currency: 'USD' }),
        simple('E-3', {}, { price: 10.5 }),
        simple('E-4', { color: 'rojo' }),
        simple('E-5', {}, { store: TENANT_B.storeSlug }),
        simple('E-6', { brand_code: 'no-existe' }),
        simple('DUP', {}),
        simple('dup', {}),
        { sku: 'E-8', name: 'Sin precio', publications: [{ store: TENANT_A.storeSlug }] },
        simple('E-9', { gtin: '4005800077937' }),
        simple('E-10', { kind: 'variant' }),
      ],
    })
    const errors = report.items.map((item) => item.errors[0] && [item.errors[0].code, item.errors[0].field])
    expect(errors).toEqual([
      ['GTIN_INVALIDO', 'products[0].gtin'],
      ['MONEDA_INCONSISTENTE', 'products[1].publications[0].currency'],
      ['VALOR_INVALIDO', 'products[2].publications[0].price'],
      ['CAMPO_NO_PERMITIDO', 'products[3].color'],
      // La tienda de otra sociedad no existe para esta credencial.
      ['TIENDA_NO_ENCONTRADA', 'products[4].publications[0].store'],
      ['MARCA_NO_ENCONTRADA', 'products[5].brand_code'],
      ['SKU_REPETIDO_EN_LOTE', 'products[6].sku'],
      ['SKU_REPETIDO_EN_LOTE', 'products[7].sku'],
      ['CAMPO_REQUERIDO', 'products[8].publications[0].price'],
      ['GTIN_EN_OTRO_PRODUCTO', 'products[9].gtin'],
      ['CAMPO_REQUERIDO', 'products[10].variants'],
    ])
    expect(report.summary.rejected).toBe(11)
  })
})

describe('variantes y precio por tienda', () => {
  const blusa = {
    sku: 'BIE-BLU-0101',
    name: 'Blusa Marea satinada',
    kind: 'variant',
    variants: [
      { sku: 'BIE-BLU-0101-ROS-S', gtin: '7750000000014', axes: { color: 'rosa-palo', talla: 's' }, stock: 5 },
      {
        sku: 'BIE-BLU-0101-ROS-M',
        gtin: '7750000000021',
        axes: { color: 'rosa-palo', talla: 'm' },
        stock: 7,
        prices: [{ store: A2, price: '79.90' }],
      },
    ],
    publications: [
      { store: TENANT_A.storeSlug, status: 'published', price: '101.90' },
      { store: A2, status: 'draft', price: '84.90' },
    ],
  }

  it('crea el maestro con variantes, ejes, códigos de barras y el precio propio en una tienda', async () => {
    const report = await ingest(clientA, { products: [blusa] })
    expect(report).toMatchObject({ applied: true, summary: { created: 1 } })
    const product = await productBySku(TENANT_A, 'BIE-BLU-0101')
    const variants = await svc(
      `select sku, barcode, stock, is_default, name from public.product_variants where product_id = $1 order by sku`,
      [product?.id],
    )
    expect(variants).toEqual([
      { sku: 'BIE-BLU-0101-ROS-M', barcode: '7750000000021', stock: 7, is_default: false, name: 'Blusa Marea satinada · Rosa palo / M' },
      { sku: 'BIE-BLU-0101-ROS-S', barcode: '7750000000014', stock: 5, is_default: true, name: 'Blusa Marea satinada · Rosa palo / S' },
    ])
    expect(
      await svc(`select count(*)::int as n from public.variant_attribute_values v
                 join public.product_variants pv on pv.id = v.variant_id where pv.product_id = $1`, [product?.id]),
    ).toEqual([{ n: 4 }])
    const overrides = await svc(
      `select s.slug, o.price from public.store_price_overrides o join public.stores s on s.id = o.store_id
       where o.product_id = $1`,
      [product?.id],
    )
    expect(overrides).toEqual([{ slug: A2, price: '79.90' }])
  })

  it('el precio de variante en una tienda sin publicación se rechaza', async () => {
    const report = await ingest(clientA, {
      products: [
        {
          sku: 'BIE-BLU-0202',
          name: 'Blusa sin publicar',
          variants: [{ sku: 'BIE-BLU-0202-S', axes: { talla: 's' }, prices: [{ store: A2, price: '10.00' }] }],
        },
      ],
    })
    expect(report.items[0]?.errors[0]).toMatchObject({
      code: 'PUBLICACION_FALTANTE',
      field: 'products[0].variants[0].prices[0].store',
    })
  })

  it('un SKU de variante no puede entrar como producto, ni una variante de otro producto', async () => {
    const report = await ingest(clientA, {
      products: [
        simple('BIE-BLU-0101-ROS-S'),
        {
          sku: 'OTRA-BLUSA',
          name: 'Otra blusa',
          variants: [{ sku: 'BIE-BLU-0101-ROS-M', axes: { talla: 'm' } }],
        },
      ],
    })
    expect(report.items.map((item) => item.errors[0]?.code)).toEqual(['SKU_DUPLICADO', 'VARIANTE_DE_OTRO_PRODUCTO'])
  })

  it('sin catálogo avanzado no hay variantes', async () => {
    const report = await ingest(clientB, {
      products: [{ sku: 'B-VAR', name: 'Con variantes', variants: [{ sku: 'B-VAR-1' }] }],
    })
    expect(report.items[0]?.errors[0]).toMatchObject({ code: 'MODULO_NO_CONTRATADO', field: 'products[0].variants' })
  })
})

describe('aislamiento entre sociedades', () => {
  it('el mismo SKU en otra sociedad es otro producto y no toca el de A', async () => {
    const before = await productBySku(TENANT_A, 'QS-514574')
    const report = await ingest(clientB, {
      products: [
        {
          sku: 'QS-514574',
          gtin: '4005800077937',
          name: 'Producto de B',
          publications: [{ store: TENANT_B.storeSlug, price: '1.00' }],
        },
      ],
    })
    expect(report).toMatchObject({ applied: true, summary: { created: 1 } })
    const inB = await productBySku(TENANT_B, 'QS-514574')
    expect(inB?.id).not.toBe(before?.id)
    const after = await productBySku(TENANT_A, 'QS-514574')
    expect(after?.name).toBe(before?.name)
    expect(after?.updated_at).toEqual(before?.updated_at)
  })

  it('B no puede publicar en una tienda de A aunque conozca su slug', async () => {
    const report = await ingest(clientB, {
      products: [{ sku: 'QS-514574', publications: [{ store: A2, price: '1.00' }] }],
    })
    expect(report.items[0]?.errors[0]).toMatchObject({ code: 'TIENDA_NO_ENCONTRADA' })
    expect(
      await svc(`select count(*)::int as n from public.store_products where store_id = $1 and organization_id = $2`, [
        storeA2,
        TENANT_B.organizationId,
      ]),
    ).toEqual([{ n: 0 }])
  })
})
