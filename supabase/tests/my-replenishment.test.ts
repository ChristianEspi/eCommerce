// @vitest-environment node
/**
 * Reposición predictiva del comprador (2026-11-22) · `my_replenishment`.
 *
 * Lo que se fija:
 *  · el ritmo sale del historial: cada cuántos días, cantidad típica (mediana)
 *    y cuánto falta; un producto comprado una sola vez no tiene ritmo;
 *  · cuentan los pedidos del comprador y los de su cuenta de empresa activa, no
 *    los de otro comprador ni los de otra tienda/tenant; los cancelados, no;
 *  · lo que se pasó hace más de vuelta y media ya no es reposición;
 *  · anon no puede llamarla; sin importes en la respuesta.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

let db: PGlite
const store: Record<string, string> = {}
const ANA = '0a000000-0000-4000-8000-00000000ab01' // consumidora
const BETO = '0a000000-0000-4000-8000-00000000ab02' // compra para la empresa
const CARLA = '0a000000-0000-4000-8000-00000000ab03' // misma empresa, otro usuario
const DANI = '0a000000-0000-4000-8000-00000000ab04' // otro comprador, nada en común
let seq = 0

type Json = Record<string, unknown>

async function svc<T = Json>(query: string, params: unknown[] = []) {
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

async function reponer(sub: string, slug = TENANT_A.storeSlug, horizonte = 7) {
  return asRole(db, 'authenticated', comprador(sub), async () =>
    (await db.query<{ r: Json[] }>(`select public.my_replenishment($1, $2) as r`, [slug, horizonte])).rows[0]!.r,
  )
}

interface Linea {
  sku: string
  name: string
  qty: number
  variantLabel?: string
}

async function pedido(
  tenant: typeof TENANT_A,
  diasAtras: number,
  lineas: Linea[],
  quien: { buyer?: string; account?: string },
  status = 'fulfilled',
) {
  seq += 1
  const [o] = await svc<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, currency,
        subtotal, grand_total, customer_email, channel_id, business_account_id, placed_at, created_at)
     values ($1, $2, $3, $4, $5::public.order_status, 'paid', 'PEN', 100, 100, 'x@cli.pe',
             (select c.id from public.channels c where c.store_id = $3 and c.is_default), $6,
             now() - make_interval(days => $7), now() - make_interval(days => $7)) returning id`,
    [tenant.organizationId, tenant.companyId, store[tenant.slug], `RP-${seq}`, status, quien.account ?? null, diasAtras],
  )
  for (const l of lineas) {
    await svc(
      `insert into public.order_items
         (organization_id, company_id, store_id, order_id, product_id, sku, name, variant_label, quantity, unit_price)
       values ($1, $2, $3, $4, (select id from public.products where sku = $5 and store_id = $3), $5, $6, $7, $8, '10.00')`,
      [tenant.organizationId, tenant.companyId, store[tenant.slug], o!.id, l.sku, l.name, l.variantLabel ?? null, l.qty],
    )
  }
  if (quien.buyer) {
    await svc(
      `insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id)
       values ($1, $2, $3, $4, $5)`,
      [o!.id, tenant.organizationId, tenant.companyId, store[tenant.slug], quien.buyer],
    )
  }
}

async function producto(tenant: typeof TENANT_A, sku: string, nombre: string) {
  await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $5, '10.00', 'PEN', 10, 'published', now())`,
    [tenant.organizationId, tenant.companyId, store[tenant.slug], sku, nombre],
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
    store[tenant.slug] = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [tenant.storeSlug]))[0]!.id
  }
  await svc(`update public.stores set status = 'active'`)
  for (const [sku, nombre] of [
    ['LEJ-5', 'Lejía 5 L'],
    ['JAB-1', 'Jabón líquido'],
    ['GUA-1', 'Guantes'],
    ['PAP-1', 'Papel toalla'],
    ['ESC-1', 'Escoba'],
  ]) {
    await producto(TENANT_A, sku!, nombre!)
  }
  await producto(TENANT_B, 'LEJ-5', 'Lejía de B')

  // Ana (consumidora): lejía cada 10 días, la última hace 8 → le toca en 2.
  for (const [dias, qty] of [[28, 2], [18, 3], [8, 2]] as const) {
    await pedido(TENANT_A, dias, [{ sku: 'LEJ-5', name: 'Lejía 5 L', qty }], { buyer: ANA })
  }
  // Ana: guantes una sola vez → sin ritmo.
  await pedido(TENANT_A, 5, [{ sku: 'GUA-1', name: 'Guantes', qty: 1 }], { buyer: ANA })
  // Ana: escoba cada 10 días pero la última hace 40 → se le pasó hace 30 (> 15): ya no.
  await pedido(TENANT_A, 50, [{ sku: 'ESC-1', name: 'Escoba', qty: 1 }], { buyer: ANA })
  await pedido(TENANT_A, 40, [{ sku: 'ESC-1', name: 'Escoba', qty: 1 }], { buyer: ANA })
  // Ana: papel cada 30 días, la última hace 2 → le toca en 28: fuera del horizonte.
  await pedido(TENANT_A, 32, [{ sku: 'PAP-1', name: 'Papel toalla', qty: 4 }], { buyer: ANA })
  await pedido(TENANT_A, 2, [{ sku: 'PAP-1', name: 'Papel toalla', qty: 4 }], { buyer: ANA })

  // Empresa de Beto y Carla: jabón cada 14 días, último hace 16 → se pasó hace 2.
  const [c] = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name, email, tax_id)
     values ($1, $2, 'company', 'EMP', 'Empresa', 'emp@cli.pe', '20123456789') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const [a] = await svc<{ id: string }>(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, 'CTA-EMP', 'Cuenta Empresa') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, c!.id],
  )
  for (const user of [BETO, CARLA]) {
    await svc(
      `insert into public.business_account_users
         (organization_id, company_id, business_account_id, user_id, email, role, status)
       values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
      [TENANT_A.organizationId, TENANT_A.companyId, a!.id, user, `${user.slice(-4)}@compra.test`],
    )
  }
  await pedido(TENANT_A, 44, [{ sku: 'JAB-1', name: 'Jabón líquido', qty: 10 }], { account: a!.id })
  await pedido(TENANT_A, 30, [{ sku: 'JAB-1', name: 'Jabón líquido', qty: 12 }], { account: a!.id })
  await pedido(TENANT_A, 16, [{ sku: 'JAB-1', name: 'Jabón líquido', qty: 12 }], { account: a!.id })
  // Un cancelado reciente de la empresa NO cuenta como compra.
  await pedido(TENANT_A, 1, [{ sku: 'JAB-1', name: 'Jabón líquido', qty: 99 }], { account: a!.id }, 'cancelled')

  // Otro tenant: la misma Ana compra lejía en B; no se mezcla con A.
  seq += 100
  for (const dias of [21, 11]) {
    await pedido(TENANT_B, dias, [{ sku: 'LEJ-5', name: 'Lejía de B', qty: 50 }], { buyer: ANA })
  }
})

afterAll(async () => {
  await db?.close()
})

describe('my_replenishment', () => {
  it('calcula ritmo, cantidad típica y cuánto falta, solo de lo que toca', async () => {
    const r = await reponer(ANA)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ sku: 'LEJ-5', nombre: 'Lejía 5 L', compras: 3, cada_dias: 10, cantidad: 2, dias_restantes: 2 })
    expect(JSON.stringify(r)).not.toMatch(/unit_price|total|10\.00/)
  })

  it('con horizonte amplio entra lo que toca más adelante; lo comprado una vez y lo abandonado, nunca', async () => {
    const skus = (await reponer(ANA, TENANT_A.storeSlug, 30)).map((x) => x.sku)
    expect(skus).toEqual(['LEJ-5', 'PAP-1'])
  })

  it('en B2B es de la cuenta: lo ve cualquier miembro activo; el cancelado no cuenta', async () => {
    for (const quien of [BETO, CARLA]) {
      const r = await reponer(quien)
      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ sku: 'JAB-1', cada_dias: 14, cantidad: 12, dias_restantes: -2 })
    }
  })

  it('otro comprador no ve nada; otra tienda tiene su propio historial', async () => {
    expect(await reponer(DANI)).toEqual([])
    const enB = await reponer(ANA, TENANT_B.storeSlug)
    expect(enB.map((x) => x.nombre)).toEqual(['Lejía de B'])
    expect(JSON.stringify(enB)).not.toMatch(/Lejía 5 L/)
  })

  it('tienda inexistente: lista vacía; anon: no puede llamarla', async () => {
    expect(await reponer(ANA, 'no-existe')).toEqual([])
    const mensaje = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query(`select public.my_replenishment($1)`, [TENANT_A.storeSlug])),
    )
    expect(mensaje).toMatch(/permission denied/)
  })

  it('el nombre no repite el producto cuando la etiqueta de la variante ya lo trae', async () => {
    const label = async (n: string, v: string | null) =>
      (await svc<{ r: string }>(`select ebim.replenishment_label($1, $2) as r`, [n, v]))[0]!.r
    expect(await label('Pedialyte 500 ml · Pedialyte 500 ml · Uva', 'Pedialyte 500 ml · Uva')).toBe('Pedialyte 500 ml · Uva')
    expect(await label('Lejía', '5 L')).toBe('Lejía · 5 L')
    expect(await label('Lejía', null)).toBe('Lejía')
  })
})
