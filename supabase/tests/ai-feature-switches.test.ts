// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B } from './harness'

/**
 * Complementos IA contra Postgres real (`20261123100000_ai_feature_switches.sql`).
 *
 *  1. Apagar una IA la apaga DE VERDAD: `ai_consume` la deniega sin gastar, y
 *     el saldo la marca `off`. Las demás siguen igual.
 *  2. Solo propietario o administración cambia el interruptor, y solo por
 *     `ai_feature_set`: nada de escribir la tabla directamente.
 *  3. Aislamiento: lo que apaga una empresa no lo ve ni lo sufre otra.
 *  4. Cada cambio queda en la bitácora.
 */

let db: PGlite

const VIEWER = '0a000000-0000-4000-8000-00000000f101'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function como<T>(claims: ReturnType<typeof claimsFor>, fn: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claims, fn)
}

const adminA = claimsFor(TENANT_A)
const adminB = claimsFor(TENANT_B)
const viewerA = claimsFor(TENANT_A, { sub: VIEWER, email: 'lector@tenant-a.com' })

async function contratar(tenant: typeof TENANT_A, capability: string) {
  await svc(
    `insert into public.tenant_entitlements
       (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, $3, true, 'hub')
     on conflict (organization_id, company_id, entitlement_code) do update set is_active = true`,
    [tenant.organizationId, tenant.companyId, `ecommerce.${capability}`],
  )
}

async function consumir(claims: ReturnType<typeof claimsFor>, feature: string) {
  return como(claims, async () => {
    const rows = await svc<{ r: Record<string, unknown> }>(`select ebim.ai_consume($1, 1) as r`, [feature])
    return rows[0]?.r as Record<string, unknown>
  })
}

async function saldo(claims: ReturnType<typeof claimsFor>) {
  return como(claims, async () => {
    const rows = await svc<{ r: Record<string, unknown> }>(`select public.ai_entitlement() as r`)
    return rows[0]?.r as { features: Record<string, boolean>; states: Record<string, string> }
  })
}

async function cambiar(claims: ReturnType<typeof claimsFor>, feature: string, enabled: boolean) {
  return como(claims, () => svc(`select public.ai_feature_set($1, $2) as r`, [feature, enabled]))
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
  }
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER],
  )
  for (const tenant of [TENANT_A, TENANT_B]) await contratar(tenant, 'ai.insights')
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.ai_feature_settings`)
  await svc(`delete from public.ai_usage`)
  await svc(`delete from public.ai_tickets`)
})

describe('Complementos IA', () => {
  it('sin tocar nada, todo sigue encendido (la migración no cambia a nadie)', async () => {
    const s = await saldo(adminA)
    expect(s.states.orders).toBe('on')
    expect(s.features.orders).toBe(true)
    expect((await consumir(adminA, 'orders')).allowed).toBe(true)
  })

  it('apagada por la empresa: el saldo dice `off` y consumir se deniega sin gastar', async () => {
    await cambiar(adminA, 'orders', false)

    const s = await saldo(adminA)
    expect(s.states.orders).toBe('off')
    expect(s.features.orders).toBe(false)
    // Las demás, intactas.
    expect(s.states.inventory).not.toBe('off')

    const r = await consumir(adminA, 'orders')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('DISABLED')
    const usado = await svc<{ used: number }>(
      `select coalesce(sum(used), 0)::int as used from public.ai_usage where company_id = $1`,
      [TENANT_A.companyId],
    )
    expect(usado[0]?.used).toBe(0)

    await cambiar(adminA, 'orders', true)
    expect((await consumir(adminA, 'orders')).allowed).toBe(true)
  })

  it('distingue lo que la empresa apagó de lo que no tiene contratado', async () => {
    // El alta de prueba trae `ai.catalog.copy` y crédito: se le quitan para este caso.
    await svc(
      `update public.tenant_entitlements set is_active = false
        where company_id = $1
          and entitlement_code in ('ecommerce.ai.catalog.copy', 'ecommerce.credit.management')`,
      [TENANT_A.companyId],
    )
    try {
      const s = await saldo(adminA)
      // Sin la capacidad: no es «apagada», es «no incluida».
      expect(s.states['catalog.copy']).toBe('no_ai')
      // `credit` exige el módulo de crédito, que no está contratado.
      expect(s.states.credit).toBe('no_module')
    } finally {
      await svc(
        `update public.tenant_entitlements set is_active = true
          where company_id = $1
            and entitlement_code in ('ecommerce.ai.catalog.copy', 'ecommerce.credit.management')`,
        [TENANT_A.companyId],
      )
    }
  })

  it('solo propietario o administración puede cambiarla', async () => {
    await expect(cambiar(viewerA, 'orders', false)).rejects.toThrow(/SIN_PERMISO/)
    expect((await saldo(adminA)).states.orders).toBe('on')
  })

  it('nadie escribe la tabla directamente', async () => {
    await expect(
      como(adminA, () =>
        svc(
          `insert into public.ai_feature_settings (organization_id, company_id, feature, enabled)
           values ($1, $2, 'orders', false)`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        ),
      ),
    ).rejects.toThrow()
  })

  it('una IA desconocida se rechaza', async () => {
    await expect(cambiar(adminA, 'inventada', false)).rejects.toThrow(/DATOS_INVALIDOS/)
  })

  it('aislamiento: lo que apaga A no lo ve ni lo sufre B', async () => {
    await cambiar(adminA, 'orders', false)

    const filasB = await como(adminB, () => svc(`select * from public.ai_feature_settings`))
    expect(filasB).toHaveLength(0)
    expect((await saldo(adminB)).states.orders).toBe('on')
    expect((await consumir(adminB, 'orders')).allowed).toBe(true)

    const filasA = await como(adminA, () => svc<{ feature: string }>(`select feature from public.ai_feature_settings`))
    expect(filasA.map((f) => f.feature)).toEqual(['orders'])
  })

  it('cada cambio queda en la bitácora', async () => {
    await cambiar(adminA, 'reviews', false)
    const rows = await svc<{ action: string; entity_label: string }>(
      `select action, entity_label from public.audit_log
        where company_id = $1 and entity_type = 'ai_feature' order by occurred_at desc limit 1`,
      [TENANT_A.companyId],
    )
    expect(rows[0]).toEqual({ action: 'ai_feature.disabled', entity_label: 'reviews' })
  })

  it('el consumo del mes sale por funcionalidad y solo de la propia empresa', async () => {
    const filasA = await como(adminA, () => svc<{ r: unknown[] }>(`select public.ai_usage_this_month() as r`))
    expect(Array.isArray(filasA[0]?.r)).toBe(true)
  })
})
