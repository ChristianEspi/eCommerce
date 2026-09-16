// @vitest-environment node
/**
 * Precios, listas, canales y promociones sobre la publicación por tienda
 * (Stores + Product Master, fase 05 · paso A).
 *
 * El MISMO producto maestro P vive en dos tiendas A1 y A2 de la misma sociedad.
 * Lo que queda fijado: el precio efectivo sale de la publicación de CADA tienda
 * (sin duplicar P); un precio propio de variante o una lista de A1 no se filtran
 * a A2; la vitrina de A2 no cotiza lo que solo se publica en A1; una promoción
 * por la categoría de A1 no aplica en A2; la configuración comercial por tienda
 * exige publicación en esa tienda; y quitar P de A1 se lleva solo lo de A1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA1: string
let storeA2: string
let slugA1: string
let categoryA1: string
let categoryA2: string
let channelA1: string
let channelA2: string
let productP: string
let variantV: string
let productQ: string

const SLUG_A2 = 'tienda-a2-precios'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))
const owner = (query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claimsFor(TENANT_A), () => sql(query, params))
const anon = (query: string, params: unknown[] = []) => asRole(db, 'anon', null, () => sql(query, params))

async function one(query: string, params: unknown[] = []): Promise<string> {
  return String((await svc(query, params))[0]?.id)
}

async function publish(product: string, store: string, slug: string, price: string, category: string | null) {
  await owner(`select public.publish_product($1, $2, $3, $4::numeric, $5, 'published')`, [
    product, store, slug, price, category,
  ])
}

/** Cotización PÚBLICA de la vitrina: la que ve el comprador de esa tienda. */
async function quote(slug: string, items: Row[]): Promise<Row> {
  const rows = await anon(`select public.price_quote_for_slug($1, $2::jsonb) as q`, [slug, JSON.stringify(items)])
  return rows[0]?.q as Row
}

function unitPrice(result: Row): string {
  return String((((result.lines as Row[]) ?? [])[0] ?? {}).unit_price)
}

async function promoQuote(slug: string, items: Row[]): Promise<Row> {
  const rows = await anon(`select public.promotion_quote_for_slug($1, $2::jsonb, null) as q`, [
    slug, JSON.stringify(items),
  ])
  return rows[0]?.q as Row
}

function appliedCodes(result: Row): string[] {
  const promos = (result.promotions ?? {}) as Row
  return ((promos.applied ?? []) as Row[]).map((entry) => String(entry.code))
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda A1', 'PEN')`, [
    TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.slug, TENANT_A.slug,
    TENANT_A.adminEmail, TENANT_A.ownerId, TENANT_A.storeSlug,
  ])
  slugA1 = TENANT_A.storeSlug
  storeA1 = String((await svc(`select id from public.stores where slug = $1`, [slugA1]))[0]?.id)
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId, TENANT_A.companyId, ['ecommerce.pricing.lists', 'ecommerce.promotions', 'ecommerce.catalog.advanced'],
  ])

  const created = await owner(`select public.create_store($1, 'Tienda A2', 'PEN') as r`, [SLUG_A2])
  storeA2 = String((created[0]?.r as Row).id)
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0, tax_inclusive = false`)

  channelA1 = String((await svc(`select id from public.channels where store_id = $1 limit 1`, [storeA1]))[0]?.id)
  channelA2 = String((await svc(`select id from public.channels where store_id = $1 limit 1`, [storeA2]))[0]?.id)

  categoryA1 = await one(
    `insert into public.categories (organization_id, company_id, store_id, slug, name)
     values ($1, $2, $3, 'ofertas', 'Ofertas') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
  )
  categoryA2 = await one(
    `insert into public.categories (organization_id, company_id, store_id, slug, name)
     values ($1, $2, $3, 'ofertas', 'Ofertas') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
  )

  // Maestros sin tienda: la tienda la pone cada publicación.
  productP = String((await owner(
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), 'P-1', 'Producto P', 50, 'variant') returning id`,
  ))[0]?.id)
  productQ = String((await owner(
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), 'Q-1', 'Producto Q', 50, 'simple') returning id`,
  ))[0]?.id)

  await publish(productP, storeA1, 'producto-p', '100.00', categoryA1)
  await publish(productP, storeA2, 'producto-p', '80.00', categoryA2)
  await publish(productQ, storeA1, 'producto-q', '30.00', null)

  variantV = String((await owner(
    `insert into public.product_variants (organization_id, company_id, product_id, sku, name, stock, is_default)
     values (ebim.org_id(), ebim.active_company(), $1, 'P-1-M', 'P talla M', 10, true) returning id`,
    [productP],
  ))[0]?.id)
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('precio efectivo por publicación', () => {
  it('el mismo maestro cuesta distinto en cada tienda sin duplicarse', async () => {
    expect(await svc(`select count(*)::int as n from public.products where sku = 'P-1'`)).toEqual([{ n: 1 }])
    expect(unitPrice(await quote(slugA1, [{ product_id: productP, variant_id: variantV, quantity: 1 }]))).toBe('100.00')
    expect(unitPrice(await quote(SLUG_A2, [{ product_id: productP, variant_id: variantV, quantity: 1 }]))).toBe('80.00')
  })

  it('el precio propio de la variante en A1 no se filtra a A2', async () => {
    await svc(
      `insert into public.store_price_overrides (organization_id, company_id, store_id, product_id, variant_id, price)
       values ($1, $2, $3, $4, $5, 120)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1, productP, variantV],
    )
    expect(unitPrice(await quote(slugA1, [{ product_id: productP, variant_id: variantV, quantity: 1 }]))).toBe('120.00')
    expect(unitPrice(await quote(SLUG_A2, [{ product_id: productP, variant_id: variantV, quantity: 1 }]))).toBe('80.00')
  })

  it('una lista de precios de A1 no toca A2', async () => {
    const list = await one(
      `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from)
       values ($1, $2, $3, 'a1-lista', 'Lista A1', 'PEN', now() - interval '1 day') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
    )
    await svc(
      `insert into public.price_list_assignments (organization_id, company_id, store_id, price_list_id, scope)
       values ($1, $2, $3, $4, 'store')`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1, list],
    )
    await svc(
      `insert into public.price_list_items (organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price)
       values ($1, $2, $3, $4, $5, 1, 90)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1, list, productQ],
    )
    expect(unitPrice(await quote(slugA1, [{ product_id: productQ, quantity: 1 }]))).toBe('90.00')
    // Q ni siquiera se publica en A2: su vitrina no lo cotiza.
    const message = await expectFailure(() => quote(SLUG_A2, [{ product_id: productQ, quantity: 1 }]))
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })
})

describe('promociones por la categoría de la publicación', () => {
  it('una promoción de la categoría de A1 no aplica en A2 al mismo producto', async () => {
    const promoA1 = await one(
      `insert into public.promotions (organization_id, company_id, store_id, code, name, kind, status, value_percent, valid_from)
       values ($1, $2, $3, 'oferta-a1', 'Oferta A1', 'percentage', 'active', 10, now() - interval '1 day') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
    )
    await svc(
      `insert into public.promotion_scopes (organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, category_id)
       values ($1, $2, $3, $4, 'percentage', 'category', $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1, promoA1, categoryA1],
    )
    const line = [{ product_id: productP, variant_id: variantV, quantity: 1 }]
    expect(appliedCodes(await promoQuote(slugA1, line))).toContain('oferta-a1')
    expect(appliedCodes(await promoQuote(SLUG_A2, line))).not.toContain('oferta-a1')
  })
})

describe('la configuración comercial por tienda exige publicación en esa tienda', () => {
  it('lista, canal y alcance de A2 rechazan un producto publicado solo en A1', async () => {
    const listA2 = await one(
      `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from)
       values ($1, $2, $3, 'a2-lista', 'Lista A2', 'PEN', now() - interval '1 day') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    )
    expect(
      await expectFailure(() =>
        svc(
          `insert into public.price_list_items (organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price)
           values ($1, $2, $3, $4, $5, 1, 10)`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA2, listA2, productQ],
        ),
      ),
    ).toMatch(/price_list_items_product_fk/)

    expect(
      await expectFailure(() =>
        svc(
          `insert into public.product_channels (organization_id, company_id, store_id, product_id, channel_id)
           values ($1, $2, $3, $4, $5)`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA2, productQ, channelA2],
        ),
      ),
    ).toMatch(/product_channels_product_fk/)

    const promoA2 = await one(
      `insert into public.promotions (organization_id, company_id, store_id, code, name, kind, status, value_percent, valid_from)
       values ($1, $2, $3, 'solo-a2', 'Solo A2', 'percentage', 'draft', 5, now()) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA2],
    )
    expect(
      await expectFailure(() =>
        svc(
          `insert into public.promotion_scopes (organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, product_id)
           values ($1, $2, $3, $4, 'percentage', 'product', $5)`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA2, promoA2, productQ],
        ),
      ),
    ).toMatch(/promotion_scopes_product_fk/)
  })

  it('quitar P de A1 se lleva su configuración de A1 y conserva la de A2', async () => {
    const lists = await svc(
      `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from)
       values ($1, $2, $3, 'a1-p', 'P en A1', 'PEN', now()), ($1, $2, $4, 'a2-p', 'P en A2', 'PEN', now())
       returning id, store_id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1, storeA2],
    )
    for (const list of lists) {
      await svc(
        `insert into public.price_list_items (organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price)
         values ($1, $2, $3, $4, $5, 5, 70)`,
        [TENANT_A.organizationId, TENANT_A.companyId, list.store_id, list.id, productP],
      )
    }
    for (const [store, channel] of [[storeA1, channelA1], [storeA2, channelA2]] as const) {
      await svc(
        `insert into public.product_channels (organization_id, company_id, store_id, product_id, channel_id)
         values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [TENANT_A.organizationId, TENANT_A.companyId, store, productP, channel],
      )
    }

    await owner(`select public.unpublish_product($1, $2)`, [productP, storeA1])

    const remaining = async (table: string) =>
      (await svc(`select store_id from public.${table} where product_id = $1 order by store_id`, [productP]))
        .map((row) => row.store_id)
    expect(await remaining('price_list_items')).toEqual([storeA2])
    expect(await remaining('product_channels')).toEqual([storeA2])
    expect(await remaining('store_price_overrides')).toEqual([])
    expect(await svc(`select count(*)::int as n from public.products where id = $1`, [productP])).toEqual([{ n: 1 }])
    expect(unitPrice(await quote(SLUG_A2, [{ product_id: productP, variant_id: variantV, quantity: 1 }]))).toBe('80.00')
  })

  it('la moneda en uso de una tienda se mide por sus publicaciones', async () => {
    const rows = await owner(`select ebim.store_currency_in_use($1) as a1, ebim.store_currency_in_use($2) as a2`, [
      storeA1, storeA2,
    ])
    expect(rows).toEqual([{ a1: true, a2: true }])
  })
})
