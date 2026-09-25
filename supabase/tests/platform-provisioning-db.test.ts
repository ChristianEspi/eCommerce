// @vitest-environment node
/**
 * Alta desde EBIM MasterAdmin — la mitad de base de datos, sobre Postgres real
 * (PGlite con TODAS las migraciones, la misma base virgen que el resto de la
 * suite). Es el equivalente pgTAP del repositorio: aserciones sobre catálogo,
 * permisos y datos, con `SET ROLE` y los claims del JWT como lo hace Supabase.
 *
 *  · privacidad: esquema y tablas fuera del alcance de anon/authenticated;
 *    RPC M2M solo para service_role; reclamo solo para authenticated.
 *  · bitácora append-only (UPDATE, DELETE y TRUNCATE rechazados).
 *  · el owner PREPROVISIONED se reclama SOLO con org + sociedad + correo
 *    correctos; idempotente; nadie más puede.
 *  · el tenant reclamado funciona: crea su primera tienda y no ve a otro tenant.
 *  · `bootstrap_tenant` sigue funcionando y un tenant suyo bloquea el alta M2M.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDatabase, expectFailure, TENANT_B, type JwtClaims } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite

const CPT = '6e000000-0000-4000-8000-000000000001'
const ORG = '6e000000-0000-4000-8000-0000000000a0'
const COMPANY = '6e000000-0000-4000-8000-0000000000c0'
const OWNER = '6e000000-0000-4000-8000-0000000000d1'
const INTRUDER = '6e000000-0000-4000-8000-0000000000e1'
const EMAIL = 'owner@cliente-m2m.test'

function payload(overrides: Row = {}): Row {
  return {
    controlPlaneTenantId: CPT,
    organization: { id: ORG, slug: 'cliente-m2m', name: 'Cliente M2M' },
    company: { id: COMPANY },
    admin: { email: EMAIL },
    deploymentMode: 'SHARED',
    context: { planCode: 'x' },
    ...overrides,
  }
}

function meta(overrides: Row = {}): Row {
  return {
    idempotencyKey: 'db-test-key-0001',
    requestHash: 'a'.repeat(64),
    correlationId: '6e000000-0000-4000-8000-00000000cc01',
    m2mSubject: 'masteradmin-provisioning',
    m2mJti: 'jti-1',
    actorId: null,
    actorRole: null,
    ...overrides,
  }
}

function claims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: OWNER,
    email: EMAIL,
    org_id: ORG,
    companies: [{ id: COMPANY, role: 'owner' }],
    active_company: COMPANY,
    apps: ['ecommerce'],
    ...overrides,
  }
}

/** Como `service_role`: lo que haría la Edge Function. */
async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

/**
 * Como el dueño de la base, solo para INSPECCIONAR: ni `service_role` tiene
 * permisos sobre `platform_provisioning` ni sobre `auth.users`, y eso es lo que
 * se prueba en otro sitio.
 */
async function su<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(query, params)).rows
}

async function as<T = Row>(c: JwtClaims, query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'authenticated', c, async () => (await db.query<T>(query, params)).rows)
}

async function provision(p: Row = payload(), m: Row = meta()): Promise<Row> {
  const [row] = await svc<{ r: Row }>('select public.platform_provision_tenant($1::jsonb, $2::jsonb) as r', [
    JSON.stringify(p),
    JSON.stringify(m),
  ])
  return row?.r as Row
}

async function claim(c: JwtClaims): Promise<Row> {
  const [row] = await as<{ r: Row }>(c, 'select public.claim_provisioned_tenant() as r')
  return row?.r as Row
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('privacidad del esquema', () => {
  it('las tablas viven fuera de `public` con RLS activada y forzada', async () => {
    const rows = await svc<{ relname: string; on: boolean; forced: boolean }>(`
      select c.relname, c.relrowsecurity as on, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'platform_provisioning' and c.relkind = 'r' order by 1`)
    expect(rows).toEqual([
      { relname: 'audit', on: true, forced: true },
      { relname: 'requests', on: true, forced: true },
    ])
  })

  it('ni anon ni authenticated tienen USAGE del esquema ni privilegios de tabla', async () => {
    const [row] = await su<Row>(`
      select has_schema_privilege('anon', 'platform_provisioning', 'USAGE') as anon_usage,
             has_schema_privilege('authenticated', 'platform_provisioning', 'USAGE') as auth_usage,
             (select count(*)::int from information_schema.role_table_grants
               where table_schema = 'platform_provisioning'
                 and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) as grants`)
    expect(row).toEqual({ anon_usage: false, auth_usage: false, grants: 0 })
  })

  it('authenticated no puede leer las tablas aunque lo intente', async () => {
    const message = await expectFailure(() => as(claims(), 'select * from platform_provisioning.requests'))
    expect(message).toMatch(/permission denied/)
  })

  it('las RPC M2M solo las ejecuta service_role; el reclamo solo authenticated', async () => {
    const rows = await svc<{ fn: string; anon: boolean; auth: boolean; svc: boolean }>(`
      select p.proname as fn,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('platform_provision_tenant', 'platform_get_provisioning',
                          'platform_record_provisioning_audit', 'claim_provisioned_tenant')
      order by 1`)
    expect(rows).toEqual([
      { fn: 'claim_provisioned_tenant', anon: false, auth: true, svc: true },
      { fn: 'platform_get_provisioning', anon: false, auth: false, svc: true },
      { fn: 'platform_provision_tenant', anon: false, auth: false, svc: true },
      { fn: 'platform_record_provisioning_audit', anon: false, auth: false, svc: true },
    ])
  })

  it('authenticated no puede dar de alta un tenant por la RPC M2M', async () => {
    const message = await expectFailure(() =>
      as(claims(), 'select public.platform_provision_tenant($1::jsonb, $2::jsonb)', [
        JSON.stringify(payload()),
        JSON.stringify(meta()),
      ]),
    )
    expect(message).toMatch(/permission denied/)
  })
})

describe('alta M2M', () => {
  it('crea el tenant sin membresía, sin tienda y sin usuario de Auth', async () => {
    const result = await provision()
    expect(result.outcome).toBe('CREATED')
    const [counts] = await su<Row>(
      `select (select count(*)::int from public.tenants where organization_id = $1) as tenants,
              (select count(*)::int from public.tenant_members where organization_id = $1) as members,
              (select count(*)::int from public.stores where organization_id = $1) as stores,
              (select count(*)::int from auth.users) as users`,
      [ORG],
    )
    expect(counts).toEqual({ tenants: 1, members: 0, stores: 0, users: 0 })
  })

  it('el replay no duplica nada', async () => {
    const again = await provision()
    expect(again.outcome).toBe('REPLAYED')
    const [row] = await su<{ n: number }>('select count(*)::int as n from platform_provisioning.requests')
    expect(row?.n).toBe(1)
  })

  it('la base rechaza un correo de la suite aunque la Edge Function fallara', async () => {
    const message = await expectFailure(() =>
      provision(
        payload({
          controlPlaneTenantId: '6e000000-0000-4000-8000-000000000009',
          organization: { id: '6e000000-0000-4000-8000-0000000000a9', slug: 'suite-x', name: 'X' },
          company: { id: '6e000000-0000-4000-8000-0000000000c9' },
          admin: { email: 'dcalagua@ebim.pe' },
        }),
        meta({ idempotencyKey: 'db-test-key-suite' }),
      ),
    )
    expect(message).toMatch(/ADMIN_EMAIL_INVALIDO/)
  })
})

describe('bitácora append-only', () => {
  it('UPDATE, DELETE y TRUNCATE fallan incluso para service_role', async () => {
    for (const statement of [
      "update platform_provisioning.audit set result = 'ERROR'",
      'delete from platform_provisioning.audit',
      'truncate platform_provisioning.audit',
    ]) {
      // Como superusuario (el dueño) para que el rechazo sea del trigger, no de un GRANT.
      const message = await expectFailure(() => db.query(statement))
      expect(message).toMatch(/AUDITORIA_INMUTABLE/)
    }
  })
})

describe('el owner PREPROVISIONED reclama su tenant', () => {
  it('sin org en el token (un comprador) → claimed=false', async () => {
    expect(await claim(claims({ org_id: undefined as unknown as string }))).toEqual({ claimed: false })
  })

  it('correo distinto → claimed=false y queda auditado', async () => {
    expect(await claim(claims({ sub: INTRUDER, email: 'otro@cliente-m2m.test' }))).toEqual({ claimed: false })
    const [row] = await su<{ n: number }>(
      `select count(*)::int as n from platform_provisioning.audit
        where operation = 'CLAIM_ADMIN' and result = 'REJECTED'`,
    )
    expect(row?.n).toBe(1)
  })

  it('sociedad aprovisionada ausente del token → claimed=false', async () => {
    expect(
      await claim(claims({ companies: [{ id: TENANT_B.companyId, role: 'owner' }], active_company: TENANT_B.companyId })),
    ).toEqual({ claimed: false })
  })

  it('con org + sociedad + correo correctos → owner activo', async () => {
    const result = await claim(claims({ email: EMAIL.toUpperCase() }))
    expect(result).toEqual({ claimed: true, organization_id: ORG, company_id: COMPANY })
    const [member] = await su<Row>(
      'select user_id, email, role, status from public.tenant_members where organization_id = $1',
      [ORG],
    )
    expect(member).toEqual({ user_id: OWNER, email: EMAIL, role: 'owner', status: 'active' })
    const [req] = await su<Row>(
      `select admin_provisioning_status, admin_user_id from platform_provisioning.requests
        where control_plane_tenant_id = $1`,
      [CPT],
    )
    expect(req).toEqual({ admin_provisioning_status: 'ACTIVE', admin_user_id: OWNER })
  })

  it('reclamar otra vez es idempotente', async () => {
    expect(await claim(claims())).toEqual({ claimed: true })
    const [row] = await su<{ n: number }>(
      'select count(*)::int as n from public.tenant_members where organization_id = $1',
      [ORG],
    )
    expect(row?.n).toBe(1)
  })

  it('otro usuario con el mismo correo ya no puede reclamar', async () => {
    expect(await claim(claims({ sub: INTRUDER }))).toEqual({ claimed: false })
  })

  it('el GET refleja al administrador ACTIVE', async () => {
    const [row] = await svc<{ r: Row }>('select public.platform_get_provisioning($1::uuid) as r', [CPT])
    expect(row?.r.adminProvisioningStatus).toBe('ACTIVE')
  })

  it('anon no puede reclamar', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, async () => db.query('select public.claim_provisioned_tenant()')),
    )
    expect(message).toMatch(/permission denied/)
  })
})

describe('el tenant reclamado funciona y está aislado', () => {
  it('el owner ve su tenant por RLS', async () => {
    const rows = await as(claims(), 'select organization_id, slug from public.tenants')
    expect(rows).toEqual([{ organization_id: ORG, slug: 'cliente-m2m' }])
  })

  it('el owner crea su primera tienda con create_store', async () => {
    const [row] = await as<{ r: Row }>(claims(), `select public.create_store('cliente-m2m-tienda', 'Tienda', 'PEN') as r`)
    expect(row?.r).toBeTruthy()
    const [{ n } = { n: -1 }] = await su<{ n: number }>(
      'select count(*)::int as n from public.stores where organization_id = $1 and company_id = $2',
      [ORG, COMPANY],
    )
    expect(n).toBe(1)
  })

  it('el owner de otro tenant no ve este', async () => {
    const other: JwtClaims = {
      sub: TENANT_B.ownerId,
      email: TENANT_B.adminEmail,
      org_id: TENANT_B.organizationId,
      companies: [{ id: TENANT_B.companyId, role: 'owner' }],
      active_company: TENANT_B.companyId,
    }
    expect(await as(other, 'select * from public.tenants where organization_id = $1', [ORG])).toEqual([])
    expect(await as(other, 'select * from public.stores where organization_id = $1', [ORG])).toEqual([])
  })
})

describe('convivencia con bootstrap-tenant', () => {
  it('bootstrap_tenant sigue creando tenant + owner + tienda', async () => {
    const [row] = await svc<{ r: Row }>(
      `select public.bootstrap_tenant($1, $2, 'boot-legacy', 'Legacy', 'admin@legacy.test', $3,
                                      'boot-legacy-shop', 'Legacy Shop', 'PEN') as r`,
      [TENANT_B.organizationId, TENANT_B.companyId, TENANT_B.ownerId],
    )
    expect(row?.r.store_id).toBeTruthy()
  })

  it('un alta M2M que choca con un tenant de bootstrap → CONFLICT sin tocarlo', async () => {
    const result = await provision(
      payload({
        controlPlaneTenantId: '6e000000-0000-4000-8000-000000000002',
        organization: { id: '6e000000-0000-4000-8000-0000000000a2', slug: 'boot-legacy', name: 'Choque' },
        company: { id: '6e000000-0000-4000-8000-0000000000c2' },
      }),
      meta({ idempotencyKey: 'db-test-key-0002' }),
    )
    expect(result).toMatchObject({ outcome: 'CONFLICT', errorCode: 'TENANT_CONFLICT' })
    const [row] = await su<{ name: string }>(`select name from public.tenants where slug = 'boot-legacy'`)
    expect(row?.name).toBe('Legacy')
  })
})
