// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Medir resultados (2026-11-19).
 *
 *  · el impacto de una campaña compara su vigencia con el mismo tramo de
 *    antes, sobre SUS productos;
 *  · la atribución de la IA casa producto anotado + mismo correo + 7 días, y
 *    nada más; otra sociedad no ve nada.
 */

let db: PGlite
let store = ''
let prodA = ''
let prodB = ''
let seq = 0

type Row = Record<string, unknown>

async function svc<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}
async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

const owner = claimsFor(TENANT_A)
const comprador: JwtClaims = { sub: '0e000000-0000-4000-8000-00000000c001', email: 'Compras@Cliente.pe' } as JwtClaims

async function producto(sku: string) {
  const [row] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '10.00', 'PEN', 500, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, sku],
  )
  return String(row?.id)
}

async function pedido(email: string, product: string, qty: number, horasAtras: number) {
  seq += 1
  const [o] = await svc<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, fulfillment_status, currency,
        subtotal, tax_total, grand_total, customer_email, channel_id, placed_at, created_at)
     values ($1, $2, $3, $4, 'fulfilled', 'paid', 'fulfilled', 'PEN', $5, 0, $5, $6,
             (select c.id from public.channels c where c.store_id = $3 and c.is_default),
             now() - make_interval(hours => $7), now() - make_interval(hours => $7)) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, `VAL-${seq}`, qty * 10, email, horasAtras],
  )
  await svc(
    `insert into public.order_items (organization_id, company_id, store_id, order_id, product_id, sku, name, quantity, unit_price)
     values ($1, $2, $3, $4, $5, 'X', 'X', $6, 10)`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, o?.id, product, qty],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
  }
  await svc(`update public.stores set status = 'active'`)
  store = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  prodA = await producto('VAL-A')
  prodB = await producto('VAL-B')
})

afterAll(async () => {
  await db?.close()
})

describe('impacto de una campaña', () => {
  it('compara la vigencia con el mismo tramo de antes, solo sobre sus productos', async () => {
    // Campaña sobre A desde hace 4 días. Antes (días 8–4): 2 u. de A. Durante: 6 u. de A y 9 de B (B no cuenta).
    await pedido('x@y.pe', prodA, 2, 24 * 6)
    await pedido('x@y.pe', prodA, 6, 24 * 2)
    await pedido('x@y.pe', prodB, 9, 24 * 2)
    const [p] = await svc<{ id: string }>(
      `insert into public.promotions (organization_id, company_id, store_id, code, name, kind, status, value_percent, valid_from)
       values ($1, $2, $3, 'imp-1', 'Impacto', 'percentage', 'active', 10, now() - interval '4 days') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, store],
    )
    await svc(
      `insert into public.promotion_scopes (organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, product_id)
       values ($1, $2, $3, $4, 'percentage', 'product', $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, store, p?.id, prodA],
    )
    const [r] = await as<{ r: Row }>(owner, `select public.promotion_impact($1::uuid) as r`, [p?.id])
    const impacto = r?.r as Row
    expect(impacto).toMatchObject({ started: true, partial_scope: false })
    expect(Number((impacto.during as Row).units)).toBe(6)
    expect(Number((impacto.before as Row).units)).toBe(2)
    expect(Number(impacto.units_change_pct)).toBe(200)
  })

  it('otra sociedad no ve campañas ajenas', async () => {
    const [p] = await svc<{ id: string }>(`select id from public.promotions where code = 'imp-1'`)
    await expect(as(claimsFor(TENANT_B), `select public.promotion_impact($1::uuid)`, [p?.id])).rejects.toThrow(
      /CAMPANA_NO_ENCONTRADA/,
    )
  })
})

describe('valor de la IA', () => {
  it('anotar exige sesión; sin ella no se anota nada', async () => {
    const r = await asRole(db, 'anon', null, async () =>
      (await db.query(`select public.ai_attribution_mark($1, $2::uuid[], 'intake') as n`, [TENANT_A.storeSlug, [prodA]])).rows,
    ).catch((e: Error) => e.message)
    expect(String(r)).toMatch(/permission denied/i)
  })

  it('cuenta lo pedido por el MISMO correo, de lo anotado, dentro de 7 días', async () => {
    const [m] = await as<{ n: number }>(comprador, `select public.ai_attribution_mark($1, $2::uuid[], 'intake') as n`, [
      TENANT_A.storeSlug,
      [prodA, prodB],
    ])
    expect(m?.n).toBe(2)
    // Mismo correo, producto anotado, después de anotar: cuenta (3 u. × 10).
    await svc(`select 1`)
    seq += 1
    await pedido('compras@cliente.pe', prodA, 3, 0)
    // Otro correo: no cuenta.
    await pedido('otro@cliente.pe', prodA, 5, 0)

    const [r] = await as<{ r: Row }>(owner, `select public.ai_value_summary($1::uuid, 30) as r`, [store])
    const v = r?.r as Row
    expect(Number(v.attributed_revenue)).toBe(30)
    expect(Number(v.attributed_orders)).toBe(1)
    expect(Number((v.by_source as Row).intake)).toBe(30)
    expect(Number(v.marked_lines)).toBe(2)
  })

  it('solo administración ve el valor, y nadie lee las anotaciones crudas', async () => {
    await expect(as(claimsFor(TENANT_B), `select public.ai_value_summary($1::uuid, 30)`, [store])).rejects.toThrow(
      /TIENDA_NO_DISPONIBLE/,
    )
    await expect(as(owner, `select * from public.ai_cart_attributions`)).rejects.toThrow(/permission denied/i)
  })
})
