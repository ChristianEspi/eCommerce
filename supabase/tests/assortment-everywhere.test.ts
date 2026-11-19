// @vitest-environment node
/**
 * El surtido se respeta en TODA la tienda (20261116120000), contra Postgres real.
 *
 * Lo que no puede fallar:
 *
 *  · un pedido de una cuenta B2B con un producto FUERA de su surtido no se
 *    crea — por ninguna ruta, porque la guarda está en `order_items`;
 *  · dentro del surtido, el pedido se crea igual que siempre;
 *  · al consumidor (sin cuenta) y a la sociedad sin el módulo no les recorta;
 *  · `my_assortment_blocked` responde con la cuenta de la SESIÓN, sin fugas
 *    entre tenants y sin puerta para `anon`;
 *  · una asignación desactivada deja de recortar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

const COMPRADOR_B2B = '0e200000-0000-4000-8000-00000000e001'
const CONSUMIDOR = '0e200000-0000-4000-8000-00000000e002'

let db: PGlite
let storeA = ''
let jabon = ''
let champu = ''
let cuenta = ''
let asignacion = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

const shopper = (sub: string) => ({ sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' })

async function bloqueados(sub: string | null, productos: string[], slug = TENANT_A.storeSlug): Promise<string[]> {
  const correr = async () =>
    (await db.query<{ r: string[] }>(`select public.my_assortment_blocked($1, $2::uuid[]) as r`, [slug, productos])).rows
  const [row] = sub ? await asRole(db, 'authenticated', shopper(sub), correr) : await asRole(db, 'anon', null, correr)
  return row?.r ?? []
}

async function producto(sku: string): Promise<string> {
  return id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '10.00', 'PEN', 100, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, sku],
  )
}

async function pedido(productId: string, account: string | null) {
  return svc(
    `select public.create_order(
       p_store_id => $1, p_customer_email => 'compras@empresa.test',
       p_items => $2::jsonb, p_business_account_id => $3) as r`,
    [storeA, JSON.stringify([{ product_id: productId, quantity: 1 }]), account],
  )
}

async function modulo(activo: boolean) {
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    activo ? ['ecommerce.trade.assortments'] : [],
  ])
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
    ])
  }
  await svc(`update public.stores set status = 'active'`)
  storeA = await id(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug])
  jabon = await producto('SE-JABON')
  champu = await producto('SE-CHAMPU')
  await modulo(true)

  const cliente = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', 'SE-CLIENTE', 'SE Cliente', 'se@cliente.test') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  cuenta = await id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, 'SE', 'SE Cuenta') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, cliente],
  )
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, 'b2b@compras.test', 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, cuenta, COMPRADOR_B2B],
  )
  // Lista blanca: SOLO el jabón.
  const surtido = await id(
    `insert into public.assortments (organization_id, company_id, store_id, code, name, is_allow_list)
     values ($1, $2, $3, 'SE-BLANCA', 'SE Blanca', true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(
    `insert into public.assortment_items (organization_id, company_id, assortment_id, product_id)
     values ($1, $2, $3, $4)`,
    [TENANT_A.organizationId, TENANT_A.companyId, surtido, jabon],
  )
  asignacion = await id(
    `insert into public.assortment_assignments (organization_id, company_id, store_id, assortment_id, scope, customer_id)
     values ($1, $2, $3, $4, 'customer', $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, surtido, cliente],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('el pedido de una cuenta B2B respeta su surtido', () => {
  it('fuera de surtido: PRODUCTO_FUERA_DE_SURTIDO y ni un pedido', async () => {
    const [antes] = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)
    const error = await expectFailure(() => pedido(champu, cuenta))
    expect(error).toMatch(/PRODUCTO_FUERA_DE_SURTIDO/)
    const [despues] = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)
    expect(despues?.n).toBe(antes?.n)
  })

  it('dentro de surtido: el pedido se crea como siempre', async () => {
    const [row] = await pedido(jabon, cuenta)
    expect(row?.r).toBeTruthy()
  })

  it('ni un insert directo en order_items lo salta', async () => {
    const [o] = await svc<{ id: string }>(
      `select id from public.orders where business_account_id = $1 limit 1`, [cuenta])
    const error = await expectFailure(() =>
      svc(
        `insert into public.order_items
           (organization_id, company_id, store_id, order_id, product_id, sku, name, unit_price, quantity)
         values ($1, $2, $3, $4, $5, 'SE-CHAMPU', 'SE-CHAMPU', 10, 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, o?.id, champu],
      ),
    )
    expect(error).toMatch(/PRODUCTO_FUERA_DE_SURTIDO/)
  })

  it('al consumidor (sin cuenta) no le recorta', async () => {
    const [row] = await pedido(champu, null)
    expect(row?.r).toBeTruthy()
  })

  it('sin el módulo contratado no recorta', async () => {
    await modulo(false)
    try {
      const [row] = await pedido(champu, cuenta)
      expect(row?.r).toBeTruthy()
    } finally {
      await modulo(true)
    }
  })
})

describe('la tienda sabe qué marcar: my_assortment_blocked', () => {
  it('con la sesión del comprador B2B: lo que está fuera de su surtido', async () => {
    expect(await bloqueados(COMPRADOR_B2B, [jabon, champu])).toEqual([champu])
  })

  it('al consumidor no le bloquea nada', async () => {
    expect(await bloqueados(CONSUMIDOR, [jabon, champu])).toEqual([])
  })

  it('sin sesión no hay puerta', async () => {
    const error = await expectFailure(() => bloqueados(null, [champu]))
    expect(error).toMatch(/permission denied/i)
  })

  it('en la tienda de OTRA sociedad el comprador no tiene cuenta: nada bloqueado, nada filtrado', async () => {
    expect(await bloqueados(COMPRADOR_B2B, [champu], TENANT_B.storeSlug)).toEqual([])
  })

  it('una asignación desactivada deja de recortar, en la tienda y en el pedido', async () => {
    await svc(`update public.assortment_assignments set is_active = false where id = $1`, [asignacion])
    try {
      expect(await bloqueados(COMPRADOR_B2B, [jabon, champu])).toEqual([])
      const [row] = await pedido(champu, cuenta)
      expect(row?.r).toBeTruthy()
    } finally {
      await svc(`update public.assortment_assignments set is_active = true where id = $1`, [asignacion])
    }
  })
})
