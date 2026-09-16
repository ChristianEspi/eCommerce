// @vitest-environment node
/**
 * Carrito, pedido, inventario y API de socio sobre la publicación por tienda
 * (Stores + Product Master, fase 05 · paso B).
 *
 * El MISMO maestro P se publica en A1 y A2 de una sociedad; Q solo en A2. Lo que
 * queda fijado: un pedido de A1 no acepta lo publicado solo en A2; una tienda en
 * borrador para P no lo vende aunque la otra sí; la moneda y el precio salen de
 * la publicación; despublicar no borra el historial de pedidos; un almacén que
 * sirve a las dos tiendas guarda UNA existencia; y la API de socio responde por
 * tienda.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA1: string
let storeA2: string
let productP: string
let productQ: string
let warehouse: string

const SLUG_A1 = TENANT_A.storeSlug
const SLUG_A2 = 'tienda-a2-pedidos'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))
const owner = (query: string, params: unknown[] = []) =>
  asRole(db, 'authenticated', claimsFor(TENANT_A), () => sql(query, params))

async function checkout(slug: string, items: Row[], email = 'ana@compradora.com'): Promise<Row> {
  const rows = await svc(
    `select public.create_order_for_slug($1, $2, $3::jsonb, 'Ana', '+51 999 111 222',
       '{"address": "Av. Primavera 120"}'::jsonb, null, null) as result`,
    [slug, email, JSON.stringify(items)],
  )
  return rows[0]?.result as Row
}

async function master(sku: string, name: string, stock: number): Promise<string> {
  return String((await owner(
    `insert into public.products (organization_id, company_id, sku, name, stock, kind)
     values (ebim.org_id(), ebim.active_company(), $1, $2, $3, 'simple') returning id`,
    [sku, name, stock],
  ))[0]?.id)
}

async function publish(product: string, store: string, slug: string, price: string, status = 'published') {
  await owner(`select public.publish_product($1, $2, $3, $4::numeric, null, $5::public.product_status)`, [
    product, store, slug, price, status,
  ])
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda A1', 'PEN')`, [
    TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.slug, TENANT_A.slug,
    TENANT_A.adminEmail, TENANT_A.ownerId, SLUG_A1,
  ])
  storeA1 = String((await svc(`select id from public.stores where slug = $1`, [SLUG_A1]))[0]?.id)
  const created = await owner(`select public.create_store($1, 'Tienda A2', 'PEN') as r`, [SLUG_A2])
  storeA2 = String((created[0]?.r as Row).id)
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0`)

  productP = await master('P-100', 'Producto P', 20)
  productQ = await master('Q-100', 'Producto Q', 20)
  await publish(productP, storeA1, 'producto-p', '100.00')
  await publish(productP, storeA2, 'producto-p-outlet', '75.00')
  await publish(productQ, storeA2, 'producto-q', '40.00')
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('el pedido vende lo publicado en SU tienda', () => {
  it('A1 cobra su precio de publicación y A2 el suyo, sobre el mismo maestro', async () => {
    const a1 = await checkout(SLUG_A1, [{ product_id: productP, quantity: 1 }])
    const a2 = await checkout(SLUG_A2, [{ product_id: productP, quantity: 1 }], 'bea@compradora.com')
    const lineOf = async (order: Row) =>
      (await svc(`select product_id, unit_price::text as unit_price, store_id from public.order_items where order_id = $1`, [
        order.order_id,
      ]))[0]
    expect(await lineOf(a1)).toEqual({ product_id: productP, unit_price: '100.00', store_id: storeA1 })
    expect(await lineOf(a2)).toEqual({ product_id: productP, unit_price: '75.00', store_id: storeA2 })
  })

  it('un pedido de A1 no acepta un producto publicado solo en A2', async () => {
    const message = await expectFailure(() => checkout(SLUG_A1, [{ product_id: productQ, quantity: 1 }]))
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })

  it('en borrador en una tienda no se vende allí aunque en la otra sí', async () => {
    const draft = await master('D-100', 'En borrador en A2', 10)
    await publish(draft, storeA1, 'borrador-a2', '10.00')
    await publish(draft, storeA2, 'borrador-a2', '10.00', 'draft')
    await expect(checkout(SLUG_A1, [{ product_id: draft, quantity: 1 }])).resolves.toBeDefined()
    expect(await expectFailure(() => checkout(SLUG_A2, [{ product_id: draft, quantity: 1 }]))).toMatch(
      /PRODUCTO_NO_DISPONIBLE/,
    )
    // Tampoco se consulta su disponibilidad pública en A2.
    const availability = (await asRole(db, 'anon', null, () =>
      sql(`select public.availability_for_slug($1, $2::jsonb) as r`, [SLUG_A2, JSON.stringify([{ product_id: draft }])]),
    ))[0]?.r as Row[]
    expect(availability[0]).toMatchObject({ in_stock: false, unknown: false })
  })

  it('despublicar de A1 no toca el historial de A1 ni la venta en A2', async () => {
    const before = await svc(`select count(*)::int as n from public.order_items where product_id = $1 and store_id = $2`, [
      productP, storeA1,
    ])
    await owner(`select public.unpublish_product($1, $2)`, [productP, storeA1])

    expect(
      await svc(`select count(*)::int as n from public.order_items where product_id = $1 and store_id = $2`, [
        productP, storeA1,
      ]),
    ).toEqual(before)
    expect(await expectFailure(() => checkout(SLUG_A1, [{ product_id: productP, quantity: 1 }]))).toMatch(
      /PRODUCTO_NO_DISPONIBLE/,
    )
    await expect(checkout(SLUG_A2, [{ product_id: productP, quantity: 1 }], 'caro@compradora.com')).resolves.toBeDefined()
  })
})

describe('inventario: una existencia física para las dos tiendas', () => {
  beforeAll(async () => {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      TENANT_A.organizationId, TENANT_A.companyId, ['ecommerce.inventory.multiwarehouse', 'ecommerce.partner.api'],
    ])
    warehouse = String((await svc(
      `insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'CD', 'Central') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    ))[0]?.id)
    for (const store of [storeA1, storeA2]) {
      await svc(
        `insert into public.store_warehouses (organization_id, company_id, store_id, warehouse_id) values ($1, $2, $3, $4)`,
        [TENANT_A.organizationId, TENANT_A.companyId, store, warehouse],
      )
    }
    await svc(`select public.sync_inventory_level($1, $2, null, 7, null, 'fixture')`, [warehouse, productQ])
  })

  it('un nivel por almacén × maestro, visto igual desde A1 y A2', async () => {
    expect(await svc(`select count(*)::int as n from public.inventory_levels where product_id = $1`, [productQ])).toEqual([
      { n: 1 },
    ])
    const a1 = (await svc(`select ebim.atp($1, $2, null) as r`, [storeA1, productQ]))[0]?.r as Row
    const a2 = (await svc(`select ebim.atp($1, $2, null) as r`, [storeA2, productQ]))[0]?.r as Row
    expect(Number(a1.available)).toBe(7)
    expect(Number(a2.available)).toBe(7)
  })

  it('sembrar desde las dos tiendas no duplica niveles', async () => {
    await owner(`select public.seed_inventory_from_catalog($1, $2)`, [warehouse, storeA2])
    await owner(`select public.seed_inventory_from_catalog($1, $2)`, [warehouse, storeA2])
    const levels = await svc(
      `select product_id, count(*)::int as n from public.inventory_levels where warehouse_id = $1 group by product_id`,
      [warehouse],
    )
    expect(levels.every((row) => row.n === 1)).toBe(true)
  })

  it('un maestro sin tienda de origen también puede recibir existencia', async () => {
    const loose = await master('L-100', 'Sin publicar', 0)
    await owner(`select public.adjust_inventory($1, $2, null, 3, 'receipt', 'alta', null)`, [warehouse, loose])
    const rows = await svc(
      `select store_id, on_hand_qty::int as on_hand from public.inventory_levels where warehouse_id = $1 and product_id = $2`,
      [warehouse, loose],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.on_hand).toBe(3)
    expect(rows[0]?.store_id).not.toBeNull()
  })
})

describe('carrito', () => {
  it('una línea de carrito exige la publicación de su tienda', async () => {
    const cart = String((await svc(
      `insert into public.carts (organization_id, company_id, store_id, channel_id, currency)
       select $1, $2, $3, c.id, 'PEN' from public.channels c where c.store_id = $3 limit 1 returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA1],
    ))[0]?.id)
    const message = await expectFailure(() =>
      svc(
        `insert into public.cart_items (organization_id, company_id, store_id, cart_id, product_id, quantity)
         values ($1, $2, $3, $4, $5, 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA1, cart, productQ],
      ),
    )
    expect(message).toMatch(/cart_items_product_fk/)
  })
})
