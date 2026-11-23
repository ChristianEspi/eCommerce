// @vitest-environment node
/**
 * El carrito del comprador para el chat (2026-11-22) · `my_cart_summary`.
 *
 * Lo que se fija: el carrito ACTIVO del comprador con sesión, con el precio al
 * añadir frente al de hoy; otro comprador no lo ve; no escribe (la última
 * actividad no se mueve); anon no puede llamarla.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, expectFailure, TENANT_A } from './harness'

let db: PGlite
let store = ''
let carrito = ''
const ANA = '0a000000-0000-4000-8000-00000000ad01'
const DANI = '0a000000-0000-4000-8000-00000000ad02'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

const comprador = (sub: string) => ({
  sub,
  email: `${sub.slice(-4)}@compra.test`,
  org_id: '00000000-0000-4000-8000-000000000000',
  companies: [],
  active_company: '00000000-0000-4000-8000-000000000000',
  apps: ['ecommerce'],
})

async function resumen(sub: string) {
  return asRole(db, 'authenticated', comprador(sub), async () =>
    (await db.query<{ r: Record<string, unknown> | null }>(`select public.my_cart_summary($1) as r`, [TENANT_A.storeSlug])).rows[0]!.r,
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    TENANT_A.slug,
    TENANT_A.adminEmail,
    TENANT_A.ownerId,
    TENANT_A.storeSlug,
  ])
  store = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]!.id
  await svc(`update public.stores set status = 'active'`)
  const [p] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'LEJ-5', 'lej-5', 'Lejía 5 L', '9.00', 'PEN', 10, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, store],
  )
  const [c] = await svc<{ id: string }>(
    `insert into public.carts (organization_id, company_id, store_id, channel_id, user_id, currency, status, last_activity_at)
     values ($1, $2, $3, (select id from public.channels where store_id = $3 and is_default), $4, 'PEN', 'active', now() - interval '3 days')
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, ANA],
  )
  carrito = c!.id
  await svc(
    `insert into public.cart_items (organization_id, company_id, store_id, cart_id, product_id, quantity, unit_price_snapshot, currency_snapshot, quoted_at)
     values ($1, $2, $3, $4, $5, 2, '10.00', 'PEN', now() - interval '3 days')`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, carrito, p!.id],
  )
})

afterAll(async () => {
  await db?.close()
})

describe('my_cart_summary', () => {
  it('el carrito del comprador con el precio de antes y el de hoy; no escribe', async () => {
    const antes = (await svc<{ t: string }>(`select last_activity_at::text as t from public.carts where id = $1`, [carrito]))[0]!.t
    const r = await resumen(ANA)
    expect(r).toMatchObject({ moneda: 'PEN', dias_sin_tocar: 3, lineas: [{ nombre: 'Lejía 5 L', cantidad: 2, precio_antes: '10.00', precio_hoy: '9.00' }] })
    const despues = (await svc<{ t: string }>(`select last_activity_at::text as t from public.carts where id = $1`, [carrito]))[0]!.t
    expect(despues).toBe(antes)
  })

  it('otro comprador ve un carrito vacío; anon no puede llamarla', async () => {
    expect(await resumen(DANI)).toMatchObject({ lineas: [] })
    const mensaje = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query(`select public.my_cart_summary($1)`, [TENANT_A.storeSlug])),
    )
    expect(mensaje).toMatch(/permission denied/)
  })
})
