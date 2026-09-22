// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B } from './harness'
import { AI_FEATURE_IDS, AI_FEATURES } from '../functions/_shared/aiCore.ts'

/**
 * El núcleo de IA contra Postgres real (fase 01, `20260921120000_ai_core.sql`).
 *
 * Tres cosas que no pueden vivir solo en TypeScript:
 *  1. El registro de funcionalidades es el MISMO en las dos copias.
 *  2. Gastar cuota exige rol y módulo, además de capacidad y saldo.
 *  3. Una traza por JWT solo existe canjeando el ticket de un consumo: nadie
 *     fabrica trazas ni infla tokens desde el navegador.
 */

let db: PGlite

const VIEWER = '0a000000-0000-4000-8000-00000000f001'
const CATALOGO = '0a000000-0000-4000-8000-00000000f002'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

function claimsDe(tenant: typeof TENANT_A, userId: string, email: string) {
  return claimsFor(tenant, { sub: userId, email })
}

async function como<T>(claims: ReturnType<typeof claimsFor>, fn: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claims, fn)
}

const admin = (tenant: typeof TENANT_A) => claimsFor(tenant)
const viewer = claimsDe(TENANT_A, VIEWER, 'lector@tenant-a.com')
const catalogo = claimsDe(TENANT_A, CATALOGO, 'catalogo@tenant-a.com')

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
    const rows = await svc<{ r: Record<string, unknown> }>(`select ebim.ai_consume($1, 1) as r`, [
      feature,
    ])
    return rows[0]?.r as Record<string, unknown>
  })
}

async function registrar(
  claims: ReturnType<typeof claimsFor>,
  feature: string,
  extra: { input?: number; errorKind?: string | null } = {},
) {
  return como(claims, async () => {
    const rows = await svc<{ id: string | null }>(
      `select public.ai_record($1, 'ai', 'claude-sonnet-5', 'p', 'r', $2, 1, 0, 10, $3) as id`,
      [feature, extra.input ?? 5, extra.errorKind ?? null],
    )
    return rows[0]?.id ?? null
  })
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
  await svc(`update public.stores set status = 'active'`)
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer'),
            ($1, $2, $4, 'catalogo@tenant-a.com', 'catalog')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER, CATALOGO],
  )
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.ai_usage`)
  await svc(`delete from public.ai_interactions`)
  await svc(`delete from public.ai_tickets`)
  await svc(`delete from public.ai_quotas`)
  await svc(`delete from public.tenant_entitlements where entitlement_code like 'ecommerce.ai.%'`)
  await svc(
    `delete from public.tenant_entitlements where entitlement_code in
       ('ecommerce.credit.management', 'ecommerce.planning.demand')`,
  )
})

describe('un solo registro de funcionalidades, en dos copias', () => {
  it('la lista declarada en SQL es la de TypeScript', async () => {
    const rows = await svc<{ f: string[] }>(`select ebim.ai_features() as f`)
    expect([...(rows[0]?.f ?? [])].sort()).toEqual([...AI_FEATURE_IDS].sort())
  })

  it('capacidad, módulo y roles coinciden funcionalidad por funcionalidad', async () => {
    for (const feature of AI_FEATURE_IDS) {
      const rows = await svc<{ cap: string; mod: string | null; roles: string }>(
        `select ebim.ai_capability_for($1) as cap,
                ebim.ai_module_capability_for($1) as mod,
                array_to_string(ebim.ai_feature_roles($1), ',') as roles`,
        [feature],
      )
      const spec = AI_FEATURES[feature]
      expect(rows[0]?.cap, feature).toBe(spec.capability)
      expect(rows[0]?.mod ?? null, feature).toBe(spec.module)
      expect((rows[0]?.roles ?? '').split(',').sort(), feature).toEqual([...spec.roles].sort())
    }
  })

  it('toda capacidad y todo módulo referidos existen en el catálogo de la app', async () => {
    const codigos = new Set(
      (await svc<{ code: string }>(`select code from public.app_capabilities`)).map((r) => r.code),
    )
    for (const feature of AI_FEATURE_IDS) {
      const spec = AI_FEATURES[feature]
      expect(codigos.has(spec.capability), `${feature} → ${spec.capability}`).toBe(true)
      if (spec.module) expect(codigos.has(spec.module), `${feature} → ${spec.module}`).toBe(true)
    }
  })

  it('ai.content queda declarada, vendible y en la frontera ai', async () => {
    const rows = await svc<{ state: string; is_baseline: boolean; boundary: string }>(
      `select state, is_baseline, boundary from public.app_capabilities where code = 'ai.content'`,
    )
    expect(rows[0]).toEqual({ state: 'declared', is_baseline: false, boundary: 'ai' })
  })
})

describe('gastar cuota exige rol', () => {
  it('un lector no redacta fichas aunque la sociedad lo tenga contratado', async () => {
    await contratar(TENANT_A, 'ai.catalog.copy')
    const r = await consumir(viewer, 'catalog.copy')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('SIN_PERMISO')
    // Y no gastó nada.
    expect(await svc(`select * from public.ai_usage`)).toHaveLength(0)
  })

  it('el rol de catálogo sí, y recibe un ticket', async () => {
    await contratar(TENANT_A, 'ai.catalog.copy')
    const r = await consumir(catalogo, 'catalog.copy')
    expect(r.allowed).toBe(true)
    expect(typeof r.ticket).toBe('string')
  })

  it('crédito es de quien administra: el lector no gasta', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await contratar(TENANT_A, 'credit.management')
    expect((await consumir(viewer, 'credit')).reason).toBe('SIN_PERMISO')
    expect((await consumir(admin(TENANT_A), 'credit')).allowed).toBe(true)
  })
})

describe('gastar cuota exige el módulo', () => {
  it('IA de cobranza sin cobranza contratada no existe', async () => {
    await contratar(TENANT_A, 'ai.insights')
    const r = await consumir(admin(TENANT_A), 'credit')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('MODULO_NO_CONTRATADO')
  })

  it('sin la IA contratada se dice eso primero, no lo del módulo', async () => {
    const r = await consumir(admin(TENANT_A), 'credit')
    expect(r.reason).toBe('DISABLED')
  })

  it('el saldo marca la funcionalidad según capacidad + módulo', async () => {
    await contratar(TENANT_A, 'ai.insights')
    const saldo = await como(admin(TENANT_A), async () => {
      const rows = await svc<{ r: { features: Record<string, boolean> } }>(
        `select ebim.ai_entitlement() as r`,
      )
      return rows[0]?.r
    })
    // `orders` es baseline: abierta. `credit` exige cobranza: cerrada.
    expect(saldo?.features.orders).toBe(true)
    expect(saldo?.features.credit).toBe(false)
    expect(saldo?.features['catalog.copy']).toBe(false)
  })
})

describe('la traza por JWT canjea un ticket', () => {
  it('sin consumo previo no hay traza ni tokens', async () => {
    await contratar(TENANT_A, 'ai.insights')
    const id = await registrar(admin(TENANT_A), 'orders', { input: 999999 })
    expect(id).toBeNull()
    expect(await svc(`select * from public.ai_interactions`)).toHaveLength(0)
    expect(await svc(`select * from public.ai_usage`)).toHaveLength(0)
  })

  it('un consumo, una traza: el ticket no se reutiliza', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await consumir(admin(TENANT_A), 'orders')
    const primera = await registrar(admin(TENANT_A), 'orders', { errorKind: 'rate_limit' })
    const segunda = await registrar(admin(TENANT_A), 'orders')
    expect(primera).toMatch(/^[0-9a-f-]{36}$/)
    expect(segunda).toBeNull()
    const filas = await svc<{ error_kind: string | null; created_by: string }>(
      `select error_kind, created_by from public.ai_interactions`,
    )
    expect(filas).toEqual([{ error_kind: 'rate_limit', created_by: TENANT_A.ownerId }])
  })

  it('el ticket es de SU funcionalidad y de SU usuario', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await contratar(TENANT_A, 'ai.catalog.copy')
    await consumir(catalogo, 'catalog.copy')
    // Otra funcionalidad del mismo usuario: no canjea.
    expect(await registrar(catalogo, 'orders')).toBeNull()
    // Mismo uso, otra persona: no canjea.
    expect(await registrar(admin(TENANT_A), 'catalog.copy')).toBeNull()
    expect(await registrar(catalogo, 'catalog.copy')).not.toBeNull()
  })

  it('el ticket de otra sociedad no sirve', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await consumir(admin(TENANT_A), 'orders')
    expect(await registrar(admin(TENANT_B), 'orders')).toBeNull()
  })

  it('los tokens se acotan y un tipo de fallo desconocido no rompe la traza', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await consumir(admin(TENANT_A), 'orders')
    await registrar(admin(TENANT_A), 'orders', { input: 2_000_000_000, errorKind: 'inventado' })
    const filas = await svc<{ input_tokens: number; error_kind: string | null }>(
      `select input_tokens, error_kind from public.ai_interactions`,
    )
    // Fase 12: la ruta JWT (alcanzable desde el navegador) tiene su propio
    // techo, más bajo que el del servidor (1 000 000).
    expect(filas[0]?.input_tokens).toBe(200_000)
    expect(filas[0]?.error_kind).toBeNull()
  })

  it('fase 12: por JWT no se compra más de una unidad por llamada', async () => {
    await contratar(TENANT_A, 'ai.insights')
    const r = await como(admin(TENANT_A), async () => {
      const rows = await svc<{ r: Record<string, unknown> }>(`select ebim.ai_consume('orders', 25) as r`)
      return rows[0]?.r as Record<string, unknown>
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('BAD_UNITS')
    const usado = await svc<{ n: number }>(`select coalesce(sum(used), 0)::int as n from public.ai_usage`)
    expect(usado[0]?.n).toBe(0)
  })

  it('fase 12: más de 30 consumos por minuto de la misma persona se frenan sin gastar', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await svc(
      `insert into public.ai_quotas (organization_id, company_id, plan, trial_quota)
       values ($1, $2, 'trial', 1000)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    for (let i = 0; i < 30; i++) {
      expect((await consumir(admin(TENANT_A), 'orders')).allowed).toBe(true)
    }
    const frenado = await consumir(admin(TENANT_A), 'orders')
    expect(frenado.allowed).toBe(false)
    expect(frenado.reason).toBe('RATE_LIMITED')
    const usado = await svc<{ n: number }>(`select coalesce(sum(used), 0)::int as n from public.ai_usage`)
    expect(usado[0]?.n).toBe(30)
  })

  it('fase 12: los tickets de más de un día se purgan al consumir', async () => {
    await contratar(TENANT_A, 'ai.insights')
    await svc(
      `insert into public.ai_tickets (organization_id, company_id, feature, user_id, created_at)
       values ($1, $2, 'orders', $3, now() - interval '2 days')`,
      [TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.ownerId],
    )
    await consumir(admin(TENANT_A), 'orders')
    const viejos = await svc<{ n: number }>(
      `select count(*)::int as n from public.ai_tickets where created_at < now() - interval '1 day'`,
    )
    expect(viejos[0]?.n).toBe(0)
  })

  it('los tickets no son legibles ni escribibles con un token de usuario', async () => {
    const leer = await como(admin(TENANT_A), async () => {
      try {
        await svc(`select * from public.ai_tickets`)
        return 'ok'
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(leer).toMatch(/permission denied/i)

    const escribir = await como(admin(TENANT_A), async () => {
      try {
        await svc(
          `insert into public.ai_tickets (organization_id, company_id, feature, user_id)
           values ($1, $2, 'orders', $3)`,
          [TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.ownerId],
        )
        return 'ok'
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(escribir).toMatch(/permission denied/i)
  })

  it('la variante con sociedad explícita sigue siendo solo de servidor', async () => {
    const rows = await svc<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', f, 'EXECUTE') as auth,
              has_function_privilege('anon', f, 'EXECUTE') as anon
         from unnest(array[
           'ebim.ai_record_for(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer, text)',
           'public.ai_record_for_store(text, text, text, text, text, text, integer, integer, integer, integer, text)'
         ]) as f`,
    )
    for (const r of rows) {
      expect(r.auth).toBe(false)
      expect(r.anon).toBe(false)
    }
  })
})

describe('la vitrina sigue midiendo por slug', () => {
  it('consumo y traza de servidor, con tipo de fallo', async () => {
    await contratar(TENANT_A, 'ai.assist')
    const consumo = await svc<{ r: { allowed: boolean } }>(
      `select public.ai_consume_for_store($1, 'assistant', 1) as r`,
      [TENANT_A.storeSlug],
    )
    expect(consumo[0]?.r.allowed).toBe(true)
    const traza = await svc<{ id: string }>(
      `select public.ai_record_for_store($1, 'assistant', 'error', 'claude-haiku-4-5', 'hola', null,
                                         0, 0, 0, 5, 'timeout') as id`,
      [TENANT_A.storeSlug],
    )
    expect(traza[0]?.id).toBeTruthy()
    const filas = await svc<{ company_id: string; error_kind: string }>(
      `select company_id, error_kind from public.ai_interactions`,
    )
    expect(filas).toEqual([{ company_id: TENANT_A.companyId, error_kind: 'timeout' }])
  })
})

describe('el pulgar', () => {
  async function trazaDe(claims: ReturnType<typeof claimsFor>, feature: string) {
    await consumir(claims, feature)
    return (await registrar(claims, feature)) as string
  }

  async function opinar(claims: ReturnType<typeof claimsFor>, id: string) {
    return como(claims, async () => {
      const rows = await svc<{ ok: boolean }>(`select public.ai_feedback($1, 1::smallint) as ok`, [id])
      return rows[0]?.ok
    })
  }

  it('lo pone quien generó la respuesta', async () => {
    await contratar(TENANT_A, 'ai.catalog.copy')
    const id = await trazaDe(catalogo, 'catalog.copy')
    expect(await opinar(catalogo, id)).toBe(true)
  })

  it('otro miembro sin administrar no opina sobre la respuesta ajena', async () => {
    await contratar(TENANT_A, 'ai.catalog.copy')
    const id = await trazaDe(catalogo, 'catalog.copy')
    expect(await opinar(viewer, id)).toBe(false)
  })

  it('quien administra sí, y nadie de otra sociedad', async () => {
    await contratar(TENANT_A, 'ai.catalog.copy')
    const id = await trazaDe(catalogo, 'catalog.copy')
    expect(await opinar(admin(TENANT_A), id)).toBe(true)
    expect(await opinar(admin(TENANT_B), id)).toBe(false)
  })
})
