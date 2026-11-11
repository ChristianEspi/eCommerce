// @vitest-environment node
/**
 * Escalas PÚBLICAS de precio por cantidad (lámina 31 · precio por volumen).
 *
 * Lo que queda fijado:
 *  · las escalas que anuncia la ficha son las MISMAS que cobra el carrito a un
 *    comprador anónimo para esas cantidades;
 *  · una lista de segmento (precio privado de un comprador) no aparece;
 *  · el mismo producto pedido desde otra tienda devuelve cero escalas;
 *  · sin escalas, lista vacía; una escala que repite el precio no se anuncia.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA1: string
let productP: string
let productQ: string

const SLUG_A2 = 'tienda-a2-escalas'

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

async function tiers(slug: string, product: string): Promise<Array<{ min_quantity: string; unit_price: string }>> {
  const rows = await anon(`select public.product_price_tiers_for_slug($1, $2) as r`, [slug, product])
  return ((rows[0]?.r as Row).tiers ?? []) as Array<{ min_quantity: string; unit_price: string }>
}

/** Lo que cobra el carrito a un anónimo por `quantity` unidades. */
async function cobra(slug: string, product: string, quantity: number): Promise<number> {
  const rows = await anon(`select public.price_quote_for_slug($1, $2::jsonb) as q`, [
    slug,
    JSON.stringify([{ product_id: product, quantity }]),
  ])
  const q = rows[0]?.q as Row
  return Number((((q.lines as Row[]) ?? [])[0] ?? {}).unit_price)
}

async function lista(code: string, scope: 'store' | 'segment', segmentId: string | null) {
  const listId = await one(
    `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from)
     values ($1, $2, $3, $4, $4, 'PEN', now() - interval '1 day') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA1, code],
  )
  await svc(
    `insert into public.price_list_assignments (organization_id, company_id, store_id, price_list_id, scope, segment_id)
     values ($1, $2, $3, $4, $5::public.price_scope, $6)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA1, listId, scope, segmentId],
  )
  return listId
}

async function renglon(listId: string, product: string, minQuantity: number, price: string) {
  await svc(
    `insert into public.price_list_items (organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA1, listId, product, minQuantity, price],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda A1', 'PEN')`, [
    TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.slug, TENANT_A.slug,
    TENANT_A.adminEmail, TENANT_A.ownerId, TENANT_A.storeSlug,
  ])
  storeA1 = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId, TENANT_A.companyId, ['ecommerce.pricing.lists', 'ecommerce.catalog.advanced'],
  ])
  const created = await owner(`select public.create_store($1, 'Tienda A2', 'PEN') as r`, [SLUG_A2])
  const storeA2 = String((created[0]?.r as Row).id)
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0, tax_inclusive = false`)

  productP = String((await owner(
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), 'T-1', 'Manguera', 500, 'simple') returning id`,
  ))[0]?.id)
  productQ = String((await owner(
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), 'T-2', 'Sin escalas', 500, 'simple') returning id`,
  ))[0]?.id)
  for (const [product, store, slug] of [
    [productP, storeA1, 'manguera'],
    [productP, storeA2, 'manguera'],
    [productQ, storeA1, 'sin-escalas'],
  ] as const) {
    await owner(`select public.publish_product($1, $2, $3, 70::numeric, null, 'published')`, [product, store, slug])
  }

  const tienda = await lista('publica', 'store', null)
  await renglon(tienda, productP, 10, '63.00')
  await renglon(tienda, productP, 50, '59.50')
  // Repite el precio de la escala anterior: no es una escala nueva.
  await renglon(tienda, productP, 100, '59.50')

  // Precio PRIVADO de un segmento, más barato: no se anuncia al público.
  const segmento = await one(
    `insert into public.customer_segments (organization_id, company_id, code, name)
     values ($1, $2, 'mayorista', 'Mayorista') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const privada = await lista('mayorista', 'segment', segmento)
  await renglon(privada, productP, 5, '40.00')

  // 2026-11-11 · Un comprador B2B de ese segmento (20261111140000).
  const cliente = await one(
    `insert into public.customers (organization_id, company_id, kind, code, name, segment_id)
     values ($1, $2, 'company', 'CLI-HOTEL', 'Hotel Sol', $3) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, segmento],
  )
  const cuenta = await one(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, 'HOTEL', 'Hotel Sol') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, cliente],
  )
  await svc(
    `insert into public.business_account_users (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, 'compras@hotel.test', 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, cuenta, COMPRADOR],
  )
}, 240_000)

const COMPRADOR = '0a000000-0000-4000-8000-0000000000c7'
async function tiersComo(sub: string, slug: string, product: string) {
  const rows = await asRole(db, 'authenticated', { sub, email: 'compras@hotel.test', role: 'authenticated' } as never, () =>
    sql(`select public.product_price_tiers_for_slug($1, $2) as r`, [slug, product]),
  )
  return ((rows[0]?.r as Row).tiers ?? []) as Array<{ min_quantity: string; unit_price: string }>
}

afterAll(async () => {
  await db?.close()
})

describe('product_price_tiers_for_slug', () => {
  it('anuncia las escalas públicas que bajan el precio, en orden', async () => {
    expect(await tiers(TENANT_A.storeSlug, productP)).toEqual([
      { min_quantity: '1', unit_price: '70.00' },
      { min_quantity: '10.000000', unit_price: '63.00' },
      { min_quantity: '50.000000', unit_price: '59.50' },
    ])
  })

  it('lo que anuncia es lo que cobra el carrito a un anónimo', async () => {
    for (const [cantidad, esperado] of [[1, 70], [9, 70], [10, 63], [49, 63], [50, 59.5], [120, 59.5]] as const) {
      expect(await cobra(TENANT_A.storeSlug, productP, cantidad)).toBe(esperado)
    }
  })

  it('no enseña la lista privada de un segmento', async () => {
    const precios = (await tiers(TENANT_A.storeSlug, productP)).map((tier) => tier.unit_price)
    expect(precios).not.toContain('40.00')
  })

  it('el mismo producto desde otra tienda no trae las escalas de A1', async () => {
    expect(await tiers(SLUG_A2, productP)).toEqual([{ min_quantity: '1', unit_price: '70.00' }])
  })

  it('sin escalas devuelve solo el precio unitario (la vitrina no pinta nada)', async () => {
    expect(await tiers(TENANT_A.storeSlug, productQ)).toEqual([{ min_quantity: '1', unit_price: '70.00' }])
  })
})

describe('el comprador B2B ve SU escala (20261111140000)', () => {
  it('con cuenta en el segmento mayorista, la ficha anuncia lo que su carrito cobra', async () => {
    const escalas = await tiersComo(COMPRADOR, TENANT_A.storeSlug, productP)
    expect(escalas.map((t) => Number(t.unit_price))).toEqual([70, 40])
    expect(Number(escalas[1]?.min_quantity)).toBe(5)
  })

  it('sin cuenta B2B, una sesión cualquiera sigue viendo la escala pública', async () => {
    const escalas = await tiersComo('0a000000-0000-4000-8000-0000000000c8', TENANT_A.storeSlug, productP)
    expect(escalas.map((t) => Number(t.unit_price))).toEqual([70, 63, 59.5])
  })
})

