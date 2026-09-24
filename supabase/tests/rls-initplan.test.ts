// @vitest-environment node
/**
 * La RLS resuelve la membresía UNA vez por consulta (migración
 * `20260923100000_rls_membership_initplan.sql`).
 *
 *  1. **Ninguna policy vuelve a la forma por fila.** Una policy nueva escrita
 *     con `ebim.can_access(organization_id, company_id)` o
 *     `ebim.has_role(organization_id, company_id, …)` pone esto rojo: con datos
 *     reales esa forma cuesta ~1 ms por fila y tumbó el analista IA en QAS.
 *  2. **Misma regla que `can_access`/`has_role`.** `member_companies()` y
 *     `has_role_companies()` se niegan en cada caso en que lo hace el predicado
 *     original: sin `sub`, otra organización, sociedad fuera del token,
 *     membresía revocada, tenant suspendido, rol fuera de la lista.
 *  3. **El aislamiento sigue en pie** a través de las policies reescritas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}
async function as(claims: ReturnType<typeof claimsFor>, query: string): Promise<Row[]> {
  return asRole(db, 'authenticated', claims, () => sql(query))
}
async function companies(claims: ReturnType<typeof claimsFor>, roles?: string): Promise<string[]> {
  const call = roles
    ? `ebim.has_role_companies(array[${roles}]::public.app_role[])`
    : 'ebim.member_companies()'
  const rows = await as(claims, `select ${call}::text[] as c`)
  return (rows[0]?.c as string[]) ?? []
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.slug,
      tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
    ])
  }
  const stores = await svc(`select id, organization_id from public.stores`)
  for (const tenant of [TENANT_A, TENANT_B]) {
    const store = stores.find((s) => s.organization_id === tenant.organizationId)?.id
    await svc(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status)
       values ($1, $2, $3, $4, $5, $4, '10.00', 'PEN', 1, 'draft')`,
      [tenant.organizationId, tenant.companyId, store, `SKU-${tenant.slug}`, `producto-${tenant.slug}`],
    )
  }
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('forma de las policies', () => {
  it('ninguna policy de public evalúa la membresía fila a fila', async () => {
    const rows = await sql(`
      select tablename, policyname
        from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
             ~ 'ebim\\.(can_access|has_role)\\(organization_id, company_id'
       order by 1, 2`)
    expect(rows).toEqual([])
  })

  it('las policies de negocio usan la membresía resuelta una vez', async () => {
    const rows = await sql(`
      select count(*)::int as n from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%ebim.member_companies()%'`)
    expect(Number(rows[0]?.n)).toBeGreaterThan(100)
  })

  it('anon no puede ejecutar las funciones de membresía', async () => {
    for (const call of ['ebim.member_companies()', `ebim.has_role_companies(array['owner']::public.app_role[])`]) {
      const message = await expectFailure(() => asRole(db, 'anon', null, () => sql(`select ${call}`)))
      expect(message).toMatch(/permission denied/)
    }
  })
})

describe('member_companies / has_role_companies equivalen a can_access / has_role', () => {
  it('el dueño ve su sociedad, y coincide con can_access', async () => {
    const claims = claimsFor(TENANT_A)
    expect(await companies(claims)).toEqual([TENANT_A.companyId])
    const rows = await as(claims, `select ebim.can_access('${TENANT_A.organizationId}', '${TENANT_A.companyId}') as ok`)
    expect(rows[0]?.ok).toBe(true)
  })

  it('sin sub no hay sociedades', async () => {
    const claims = claimsFor(TENANT_A, { sub: '' })
    expect(await companies(claims)).toEqual([])
  })

  it('con org_id de otra organización no hay sociedades', async () => {
    const claims = claimsFor(TENANT_A, { org_id: TENANT_B.organizationId })
    expect(await companies(claims)).toEqual([])
  })

  it('una sociedad que el token no declara no cuenta, aunque haya membresía', async () => {
    const claims = claimsFor(TENANT_A, { companies: [], active_company: TENANT_A.companyId })
    expect(await companies(claims)).toEqual([])
  })

  it('membresía revocada ⇒ nada; al reactivarla vuelve', async () => {
    const claims = claimsFor(TENANT_A)
    await svc(`update public.tenant_members set status = 'revoked' where user_id = $1`, [TENANT_A.ownerId])
    try {
      expect(await companies(claims)).toEqual([])
      const rows = await as(claims, `select ebim.can_access('${TENANT_A.organizationId}', '${TENANT_A.companyId}') as ok`)
      expect(rows[0]?.ok).toBe(false)
    } finally {
      await svc(`update public.tenant_members set status = 'active' where user_id = $1`, [TENANT_A.ownerId])
    }
    expect(await companies(claims)).toEqual([TENANT_A.companyId])
  })

  it('tenant suspendido ⇒ nada', async () => {
    const claims = claimsFor(TENANT_A)
    await svc(`update public.tenants set status = 'suspended' where organization_id = $1`, [TENANT_A.organizationId])
    try {
      expect(await companies(claims)).toEqual([])
    } finally {
      await svc(`update public.tenants set status = 'active' where organization_id = $1`, [TENANT_A.organizationId])
    }
  })

  it('has_role_companies filtra por rol como has_role', async () => {
    const claims = claimsFor(TENANT_A)
    const role = String((await svc(
      `select role::text as r from public.tenant_members where user_id = $1`, [TENANT_A.ownerId],
    ))[0]?.r)
    expect(await companies(claims, `'${role}'`)).toEqual([TENANT_A.companyId])
    const otro = role === 'viewer' ? 'catalog' : 'viewer'
    expect(await companies(claims, `'${otro}'`)).toEqual([])
    const rows = await as(
      claims,
      `select ebim.has_role('${TENANT_A.organizationId}', '${TENANT_A.companyId}', array['${otro}']::public.app_role[]) as ok`,
    )
    expect(rows[0]?.ok).toBe(false)
  })
})

describe('aislamiento a través de las policies reescritas', () => {
  it('cada tenant lee solo sus productos', async () => {
    const a = await as(claimsFor(TENANT_A), `select sku from public.products order by sku`)
    const b = await as(claimsFor(TENANT_B), `select sku from public.products order by sku`)
    expect(a.map((r) => r.sku)).toEqual([`SKU-${TENANT_A.slug}`])
    expect(b.map((r) => r.sku)).toEqual([`SKU-${TENANT_B.slug}`])
  })

  it('un token con org_id ajeno y sin membresía no ve nada', async () => {
    const intruso = claimsFor(TENANT_A, {
      org_id: TENANT_B.organizationId,
      companies: [{ id: TENANT_B.companyId, role: 'admin' }],
      active_company: TENANT_B.companyId,
    })
    expect(await as(intruso, `select id from public.products`)).toEqual([])
  })

  it('no se puede escribir en la sociedad de otro tenant', async () => {
    const store = (await svc(`select id from public.stores where organization_id = $1`, [TENANT_B.organizationId]))[0]?.id
    const message = await expectFailure(() =>
      as(
        claimsFor(TENANT_A),
        `insert into public.products (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status)
         values ('${TENANT_B.organizationId}', '${TENANT_B.companyId}', '${store}', 'X', 'x', 'X', '1.00', 'PEN', 1, 'draft')`,
      ),
    )
    expect(message).toMatch(/row-level security|permission denied/)
  })
})
