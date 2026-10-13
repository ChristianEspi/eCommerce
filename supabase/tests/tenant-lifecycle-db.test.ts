// @vitest-environment node
/**
 * `lifecycle.v1` sobre Postgres REAL (PGlite, todas las migraciones).
 *
 *   · estructura: TODA tabla de `public` con `organization_id` tiene el guardián
 *     `a_tenant_lifecycle_guard` (y dispara primero), salvo las exentas
 *     documentadas; canales de plataforma en modo `platform`, mantenimiento en
 *     `skip`, reclamadores con filtro;
 *   · RPC M2M: aplicado, repetición, STALE_LIFECYCLE, VERSION_CONFLICT, 404,
 *     cuerpo inválido; bitácora append-only; tablas privadas sin GRANT;
 *   · bloqueo: el tenant suspendido NO escribe (RLS, RPC DEFINER, service_role,
 *     vitrina anónima, Storage) y SÍ lee; el otro tenant no se entera;
 *   · canales de plataforma abiertos; mantenimiento entre tenants no se cae;
 *   · reactivación: todo vuelve, sin perder datos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { applyMeta, ecommerceSnapshot, provisionTenant } from './entitlements-helpers.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA: string
let storeB: string
let productA: string
let productB: string

const CPT_A = '1c000000-0000-4000-8000-0000000000a1'
const CPT_B = '1c000000-0000-4000-8000-0000000000b2'
const CPT_UNKNOWN = '1c000000-0000-4000-8000-0000000000ff'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

function command(o: { cpt?: string; version: number; state: 'ACTIVE' | 'SUSPENDED'; reason?: string | null }): Row {
  const cpt = o.cpt ?? CPT_A
  return {
    contract: 'lifecycle.v1',
    controlPlaneTenantId: cpt,
    productCode: 'ecommerce',
    environment: 'DEV',
    version: o.version,
    state: o.state,
    reason: o.reason === undefined ? (o.state === 'SUSPENDED' ? 'NON_PAYMENT' : null) : o.reason,
    effectiveAt: '2026-10-13T11:00:00Z',
    idempotencyKey: `lifecycle:${cpt}:ecommerce:${o.version}`,
    correlationId: '1f0a3c1e-1b7e-4c47-9d55-3a4b1f2e9c10',
  }
}

const META = { correlationId: '1f0a3c1e-1b7e-4c47-9d55-3a4b1f2e9c10', m2mSubject: 'masteradmin-provisioning', m2mJti: 'jti-x', actorId: null, actorRole: 'SYSTEM' }

async function apply(cmd: Row, cpt = String(cmd.controlPlaneTenantId)): Promise<{ httpStatus: number; body: Row }> {
  return asRole(db, 'service_role', null, async () => {
    const rows = await sql('select public.platform_apply_lifecycle($1::uuid, $2::jsonb, $3::jsonb) as r', [
      cpt,
      JSON.stringify(cmd),
      JSON.stringify(META),
    ])
    return rows[0]?.r as { httpStatus: number; body: Row }
  })
}

async function suspendA(version: number, reason = 'NON_PAYMENT') {
  const r = await apply(command({ version, state: 'SUSPENDED', reason }))
  expect(r.httpStatus).toBe(200)
}
async function activateA(version: number) {
  const r = await apply(command({ version, state: 'ACTIVE' }))
  expect(r.httpStatus).toBe(200)
}

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        t.organizationId, t.companyId, t.slug, `Cuenta ${t.slug}`, t.adminEmail, t.ownerId, t.storeSlug, `Tienda ${t.slug}`,
      ])
    }
    await sql(`update public.stores set status = 'active'`)
    const stores = await sql(`select id, slug from public.stores order by slug`)
    storeA = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
    storeB = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)
    const insert = `
      insert into public.products
        (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
      values ($1, $2, $3, $4, $5, $6, '100.00', 'PEN', 50, 'published', now()) returning id`
    productA = String((await sql(insert, [TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-1', 'silla-a', 'Silla A']))[0]?.id)
    productB = String((await sql(insert, [TENANT_B.organizationId, TENANT_B.companyId, storeB, 'B-1', 'mesa-b', 'Mesa B']))[0]?.id)
  })
  // El mapping del alta M2M (lo que deja `platform_provision_tenant`).
  for (const [cpt, t] of [[CPT_A, TENANT_A], [CPT_B, TENANT_B]] as const) {
    await sql(
      `insert into platform_provisioning.requests
         (control_plane_tenant_id, idempotency_key, request_hash, tenant_organization_id, tenant_company_id,
          tenant_slug, admin_email, deployment_mode, status, correlation_id, m2m_subject, m2m_jti,
          request_payload, completed_at)
       values ($1, $2, repeat('a', 64), $3, $4, $5, $6, 'SHARED', 'ACTIVE', gen_random_uuid(),
               'masteradmin-provisioning', $2, '{}'::jsonb, now())`,
      [cpt, `lifecycle-test-${t.slug}`, t.organizationId, t.companyId, t.slug, t.adminEmail],
    )
  }
}, 120_000)

afterAll(async () => {
  await db?.close()
})

// ───────────────────────────────────────────────────────────────────────────
describe('estructura: el guardián está en TODA tabla de negocio', () => {
  it('cada tabla de public con organization_id tiene el trigger, salvo las exentas documentadas', async () => {
    const tables = await sql(`
      select c.relname as t,
             exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'a_tenant_lifecycle_guard') as guarded
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id'
                       and a.attnum > 0 and not a.attisdropped)
       order by 1`)
    const exempt = (await sql(`select table_name from platform_lifecycle.exempt_tables order by 1`)).map((r) => r.table_name)
    expect(exempt).toEqual(['api_requests'])
    expect(tables.length).toBeGreaterThan(150)
    const unguarded = tables.filter((r) => !r.guarded).map((r) => r.t)
    expect(unguarded).toEqual(exempt)
    // Ninguna exención sin su porqué.
    const reasons = await sql(`select length(reason) as n from platform_lifecycle.exempt_tables`)
    for (const r of reasons) expect(Number(r.n)).toBeGreaterThanOrEqual(40)
  })

  it('es BEFORE INSERT/UPDATE/DELETE por fila y dispara antes que cualquier otro BEFORE', async () => {
    const shape = await sql(`
      select distinct t.tgtype, p.proname
        from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgname = 'a_tenant_lifecycle_guard'`)
    // ROW(1) | BEFORE(2) | INSERT(4) | DELETE(8) | UPDATE(16) = 31
    expect(shape).toEqual([{ tgtype: 31, proname: 'enforce_tenant_lifecycle' }])
    const earlier = await sql(`
      select c.relname, t.tgname
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and (t.tgtype & 2) = 2
         and t.tgname < 'a_tenant_lifecycle_guard'`)
    expect(earlier).toEqual([])
  })

  it('ensure_guards() es idempotente', async () => {
    expect((await sql(`select platform_lifecycle.ensure_guards() as n`))[0]?.n).toBe(0)
  })

  it('canales de plataforma en modo platform, mantenimiento en skip, reclamadores con filtro', async () => {
    const modes = await sql(`
      select p.oid::regprocedure::text as fn,
             (select split_part(c, '=', 2) from unnest(p.proconfig) c where c like 'ebim.lifecycle_guard=%') as mode
        from pg_proc p
       where exists (select 1 from unnest(p.proconfig) c where c like 'ebim.lifecycle_guard=%')
       order by 1`)
    const byFn = Object.fromEntries(modes.map((r) => [r.fn, r.mode]))
    for (const fn of [
      'platform_provision_tenant(jsonb,jsonb)',
      'platform_apply_entitlements(uuid,jsonb,jsonb)',
      'platform_set_entitlement_enforcement_mode(text,text,text)',
      'platform_reconcile_entitlements(uuid)',
      'sync_platform_context(uuid,uuid,boolean,text[],entitlement_source,text)',
    ]) {
      expect(byFn[fn], fn).toBe('platform')
    }
    for (const fn of [
      'expire_carts()', 'expire_inventory_reservations()', 'expire_gift_cards(uuid)',
      'purge_api_idempotency(interval)', 'purge_api_requests(interval)', 'purge_api_tokens(interval)',
      'purge_checkout_attempts(interval)', 'purge_empty_guest_carts(interval)', 'purge_public_rate_events(interval)',
      'integration_reclaim_stale(interval)', 'reclaim_stale_domain_events(interval)', 'ebim.cart_recovery_guard_queue()',
      'integration_claim(text,text,integer)', 'claim_domain_events(text,integer,text[])', 'notification_email_claim(integer)',
      'ebim.enqueue_cart_recovery(integer)', 'ebim.run_order_schedules(integer)',
    ]) {
      expect(byFn[fn], fn).toBe('skip')
    }
    // Login permitido: el único paso de entrada que escribe (crea la membresía).
    expect(byFn['claim_provisioned_tenant()']).toBe('access')
    // Nada más tiene un modo: el modo no se reparte por accidente.
    expect(Object.keys(byFn)).toHaveLength(23)
    const filtered = await sql(`
      select p.proname from pg_proc p
       where p.oid in ('public.integration_claim(text,text,integer)'::regprocedure,
                       'public.claim_domain_events(text,integer,text[])'::regprocedure,
                       'public.notification_email_claim(integer)'::regprocedure,
                       'ebim.enqueue_cart_recovery(integer)'::regprocedure,
                       'ebim.run_order_schedules(integer)'::regprocedure)
         and p.prosrc like '%not ebim.tenant_is_suspended(%'`)
    expect(filtered).toHaveLength(5)
  })

  it('las tablas privadas: RLS forzada y sin GRANT; las RPC M2M solo para service_role', async () => {
    const tables = await sql(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'platform_lifecycle' and c.relkind = 'r' order by 1`)
    expect(tables.map((r) => r.relname)).toEqual(['events', 'exempt_tables', 'tenant_state'])
    for (const t of tables) {
      expect(t.relrowsecurity).toBe(true)
      expect(t.relforcerowsecurity).toBe(true)
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const [g] = await sql(`select has_table_privilege($1, $2, 'select,insert,update,delete') as ok`, [
          role, `platform_lifecycle.${String(t.relname)}`,
        ])
        expect(g?.ok, `${role} ${String(t.relname)}`).toBe(false)
      }
    }
    const fns: [string, string, boolean][] = [
      ['public.platform_apply_lifecycle(uuid,jsonb,jsonb)', 'anon', false],
      ['public.platform_apply_lifecycle(uuid,jsonb,jsonb)', 'authenticated', false],
      ['public.platform_apply_lifecycle(uuid,jsonb,jsonb)', 'service_role', true],
      ['public.platform_get_lifecycle(uuid)', 'authenticated', false],
      ['public.platform_get_lifecycle(uuid)', 'service_role', true],
      ['public.my_tenant_lifecycle()', 'anon', false],
      ['public.my_tenant_lifecycle()', 'authenticated', true],
      ['public.store_operational_for_slug(text)', 'anon', true],
      ['ebim.enforce_tenant_lifecycle()', 'authenticated', false],
      ['platform_lifecycle.ensure_guards()', 'service_role', false],
    ]
    for (const [fn, role, expected] of fns) {
      const [r] = await sql(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])
      expect(r?.ok, `${role} ${fn}`).toBe(expected)
    }
    expect((await sql(`select has_schema_privilege('authenticated', 'platform_lifecycle', 'usage') as ok`))[0]?.ok).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('RPC M2M: versión, idempotencia y errores', () => {
  it('sin PUT previo: ACTIVE y versión null; tenant sin alta: NULL', async () => {
    const [r] = await asRole(db, 'service_role', null, () =>
      sql(`select public.platform_get_lifecycle($1::uuid) as a, public.platform_get_lifecycle($2::uuid) as b`, [CPT_B, CPT_UNKNOWN]),
    )
    expect(r?.a).toEqual({ appliedVersion: null, state: 'ACTIVE', reason: null, appliedAt: null })
    expect(r?.b).toBeNull()
  })

  it('tenant no aprovisionado → 404 TENANT_NOT_PROVISIONED', async () => {
    const r = await apply(command({ cpt: CPT_UNKNOWN, version: 1, state: 'SUSPENDED' }))
    expect(r.httpStatus).toBe(404)
    expect(r.body.error).toBe('TENANT_NOT_PROVISIONED')
  })

  it('cuerpo inválido → 400 INVALID_LIFECYCLE (y nada cambia)', async () => {
    for (const bad of [
      command({ version: 0, state: 'SUSPENDED' }),
      command({ version: 1, state: 'SUSPENDED', reason: null }),
      command({ version: 1, state: 'ACTIVE', reason: 'MANUAL' }),
      { ...command({ version: 1, state: 'SUSPENDED' }), state: 'PAUSED' },
      { ...command({ version: 1, state: 'SUSPENDED' }), version: 1.5 },
      { ...command({ version: 1, state: 'SUSPENDED' }), effectiveAt: 'ayer' },
    ]) {
      const r = await apply(bad, CPT_A)
      expect(r.httpStatus, JSON.stringify(bad)).toBe(400)
      expect(r.body.error).toBe('INVALID_LIFECYCLE')
    }
    // Cuerpo de OTRO tenant contra la ruta de A.
    const other = await apply(command({ cpt: CPT_B, version: 1, state: 'SUSPENDED' }), CPT_A)
    expect(other.body.error).toBe('INVALID_LIFECYCLE')
    expect((await sql(`select count(*)::int as n from platform_lifecycle.tenant_state`))[0]?.n).toBe(0)
  })

  it('aplica, repite, rechaza lo viejo y el conflicto de versión', async () => {
    const first = await apply(command({ version: 3, state: 'SUSPENDED', reason: 'MANUAL' }))
    expect(first.httpStatus).toBe(200)
    expect(first.body).toMatchObject({ appliedVersion: 3, state: 'SUSPENDED', reason: 'MANUAL', replayed: false })
    expect(first.body.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

    const replay = await apply(command({ version: 3, state: 'SUSPENDED', reason: 'MANUAL' }))
    expect(replay.httpStatus).toBe(200)
    expect(replay.body).toMatchObject({ appliedVersion: 3, state: 'SUSPENDED', reason: 'MANUAL', replayed: true })

    const stale = await apply(command({ version: 2, state: 'ACTIVE' }))
    expect(stale.httpStatus).toBe(409)
    expect(stale.body).toMatchObject({ error: 'STALE_LIFECYCLE', appliedVersion: 3 })

    const conflict = await apply(command({ version: 3, state: 'ACTIVE' }))
    expect(conflict.httpStatus).toBe(409)
    expect(conflict.body).toMatchObject({ error: 'VERSION_CONFLICT', appliedVersion: 3 })
    // Misma versión, mismo estado, OTRA causa: tampoco es una repetición.
    const otherReason = await apply(command({ version: 3, state: 'SUSPENDED', reason: 'NON_PAYMENT' }))
    expect(otherReason.body).toMatchObject({ error: 'VERSION_CONFLICT', appliedVersion: 3 })

    await activateA(4)
    const [got] = await asRole(db, 'service_role', null, () =>
      sql(`select public.platform_get_lifecycle($1::uuid) as r`, [CPT_A]),
    )
    expect(got?.r).toMatchObject({ appliedVersion: 4, state: 'ACTIVE', reason: null })

    const outcomes = (await sql(
      `select outcome from platform_lifecycle.events where control_plane_tenant_id = $1 and version >= 2 order by id`,
      [CPT_A],
    )).map((r) => r.outcome)
    expect(outcomes).toEqual(['APPLIED', 'REPLAYED', 'STALE_LIFECYCLE', 'VERSION_CONFLICT', 'VERSION_CONFLICT', 'APPLIED'])
  })

  it('la bitácora es append-only', async () => {
    expect(await expectFailure(() => sql(`update platform_lifecycle.events set outcome = 'APPLIED'`))).toMatch(
      /AUDITORIA_INMUTABLE/,
    )
    expect(await expectFailure(() => sql(`delete from platform_lifecycle.events`))).toMatch(/AUDITORIA_INMUTABLE/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('SUSPENDED: la escritura se bloquea en el servidor; la lectura sigue', () => {
  beforeAll(async () => {
    await suspendA(10)
  })

  it('el backoffice del tenant (RLS) no escribe: TENANT_SUSPENDED con SQLSTATE PT423', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      for (const write of [
        () => sql(`update public.products set name = 'Otra' where id = $1`, [productA]),
        () => sql(`delete from public.products where id = $1`, [productA]),
        () => sql(
          `insert into public.products (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status)
           values ($1, $2, $3, 'A-2', 'mesa-a', 'Mesa A', '1.00', 'PEN', 1, 'draft')`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA],
        ),
      ]) {
        try {
          await write()
          throw new Error('la escritura debía fallar')
        } catch (error) {
          expect((error as Error).message).toMatch(/^TENANT_SUSPENDED: /)
          expect((error as { code?: string }).code).toBe('PT423')
        }
      }
    })
  })

  it('una RPC SECURITY DEFINER y service_role tampoco escriben (el pedido no nace)', async () => {
    const before = (await sql(`select count(*)::int as n from public.orders where organization_id = $1`, [TENANT_A.organizationId]))[0]?.n
    const msg = await asRole(db, 'service_role', null, () =>
      expectFailure(() => sql(
        `select public.create_order($1, 'comprador@ejemplo.com',
           jsonb_build_array(jsonb_build_object('product_id', $2::text, 'quantity', 1)))`,
        [storeA, productA],
      )),
    )
    expect(msg).toMatch(/^TENANT_SUSPENDED: /)
    const after = (await sql(`select count(*)::int as n from public.orders where organization_id = $1`, [TENANT_A.organizationId]))[0]?.n
    expect(after).toBe(before)
  })

  it('la vitrina anónima: catálogo visible, carrito bloqueado, aviso de tienda no disponible', async () => {
    await asRole(db, 'anon', null, async () => {
      const products = await sql(`select product_id from public.public_products where store_id = $1`, [storeA])
      expect(products.map((r) => r.product_id)).toContain(productA)
      const [op] = await sql(`select public.store_operational_for_slug($1) as a, public.store_operational_for_slug($2) as b,
                                     public.store_operational_for_slug('no-existe') as c`, [TENANT_A.storeSlug, TENANT_B.storeSlug])
      expect(op).toEqual({ a: { operational: false }, b: { operational: true }, c: null })
      const msg = await expectFailure(() => sql(`select public.cart_open($1, null)`, [TENANT_A.storeSlug]))
      expect(msg).toMatch(/^TENANT_SUSPENDED: /)
      // El otro tenant ni se entera.
      const [cart] = await sql(`select public.cart_open($1, null) as c`, [TENANT_B.storeSlug])
      expect(cart?.c).toBeTruthy()
    })
  })

  it('la lectura y la exportación siguen; los datos están intactos', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const rows = await sql(`select id, name from public.products where id = $1`, [productA])
      expect(rows).toEqual([{ id: productA, name: 'Silla A' }])
      const [life] = await sql(`select public.my_tenant_lifecycle() as r`)
      expect(life?.r).toMatchObject({ state: 'SUSPENDED', reason: 'NON_PAYMENT' })
    })
  })

  it('aislamiento: el otro tenant escribe y ve su propio estado ACTIVE', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_B), async () => {
      await sql(`update public.products set name = 'Mesa B2' where id = $1`, [productB])
      const [life] = await sql(`select public.my_tenant_lifecycle() as r`)
      expect(life?.r).toEqual({ state: 'ACTIVE', reason: null, applied_at: null })
      // No puede escribir en A aunque A no estuviera suspendido (RLS), y A no le cambia nada.
      const touched = await sql(`update public.products set name = 'x' where id = $1 returning id`, [productA])
      expect(touched).toEqual([])
    })
    // Un JWT con el org de A pero sin membresía no ve el estado de A.
    await asRole(db, 'authenticated', claimsFor(TENANT_B, { org_id: TENANT_A.organizationId }), async () => {
      expect((await sql(`select public.my_tenant_lifecycle() as r`))[0]?.r).toBeNull()
    })
  })

  it('LOGIN permitido: un miembro entra y carga su espacio de trabajo (solo lecturas)', async () => {
    // Exactamente las consultas de `fetchWorkspace` (src/features/tenant/workspace.ts) y del aviso.
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      expect(await sql(`select organization_id, slug, name, status from public.tenants`)).toHaveLength(1)
      const members = await sql(
        `select organization_id, role, status from public.tenant_members where user_id = $1 and status = 'active'`,
        [TENANT_A.ownerId],
      )
      expect(members).toEqual([{ organization_id: TENANT_A.organizationId, role: 'owner', status: 'active' }])
      expect(await sql(`select id from public.stores`)).toEqual([{ id: storeA }])
      expect((await sql(`select public.my_tenant_lifecycle() as r`))[0]?.r).toMatchObject({ state: 'SUSPENDED' })
    })
  })

  it('LOGIN permitido: el administrador PREPROVISIONED de una cuenta suspendida reclama su acceso y lee', async () => {
    const cpt = '1c000000-0000-4000-8000-0000000000c3'
    const org = '1c000000-0000-4000-8000-0000000000e0'
    const company = '1c000000-0000-4000-8000-0000000000e1'
    const user = '1c000000-0000-4000-8000-0000000000e2'
    await provisionTenant(db, { cpt, org, company, slug: 'cuenta-suspendida' })
    expect((await apply(command({ cpt, version: 1, state: 'SUSPENDED', reason: 'NON_PAYMENT' }))).httpStatus).toBe(200)
    await sql(`insert into auth.users (id, email) values ($1, 'owner@cuenta-suspendida.test')`, [user])
    const claims = {
      sub: user,
      email: 'owner@cuenta-suspendida.test',
      org_id: org,
      companies: [{ id: company, role: 'owner' }],
      active_company: company,
      apps: ['ecommerce'],
    }
    await asRole(db, 'authenticated', claims, async () => {
      expect((await sql(`select public.claim_provisioned_tenant() as r`))[0]?.r).toEqual(
        expect.objectContaining({ claimed: true }),
      )
      expect(await sql(`select organization_id from public.tenants`)).toEqual([{ organization_id: org }])
      expect((await sql(`select public.my_tenant_lifecycle() as r`))[0]?.r).toMatchObject({
        state: 'SUSPENDED', reason: 'NON_PAYMENT',
      })
      expect(await sql(`select role from public.tenant_members where user_id = $1`, [user])).toEqual([{ role: 'owner' }])
    })
    // El modo `access` vive solo dentro del reclamo: fuera de él, la misma
    // membresía no se puede tocar (ni siquiera con service_role).
    const msg = await asRole(db, 'service_role', null, () =>
      expectFailure(() => sql(`update public.tenant_members set role = 'admin' where user_id = $1`, [user])),
    )
    expect(msg).toMatch(/^TENANT_SUSPENDED: /)
  })

  it('Storage: no se sube ni se borra un archivo del tenant suspendido', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const msg = await expectFailure(() =>
        sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [
          `${TENANT_A.organizationId}/${storeA}/nueva.webp`,
        ]),
      )
      expect(msg).toMatch(/row-level security/)
    })
    await asRole(db, 'authenticated', claimsFor(TENANT_B), async () => {
      await sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [
        `${TENANT_B.organizationId}/${storeB}/nueva.webp`,
      ])
    })
  })

  it('los canales de plataforma siguen abiertos (contexto del hub, entitlements)', async () => {
    await asRole(db, 'service_role', null, async () => {
      // Sin el modo `platform`, la misma tabla está cerrada también para service_role.
      const direct = await expectFailure(() =>
        sql(`update public.tenant_platform_context set synced_at = now() where organization_id = $1`, [TENANT_A.organizationId]),
      )
      expect(direct).toMatch(/^TENANT_SUSPENDED: /)
      const [r] = await sql(
        `select public.sync_platform_context($1, $2, true, array['catalog.basic'], 'hub') as r`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      )
      expect((r?.r as Row).organization_id).toBe(TENANT_A.organizationId)
      const snapshot = await ecommerceSnapshot({ tenant: CPT_A, version: 1 })
      const [e] = await sql(`select public.platform_apply_entitlements($1::uuid, $2::jsonb, $3::jsonb) as r`, [
        CPT_A, JSON.stringify(snapshot), JSON.stringify(applyMeta()),
      ])
      expect((e?.r as Row).httpStatus).toBe(200)
    })
  })

  it('el mantenimiento entre tenants no se cae: salta lo suspendido y procesa lo demás', async () => {
    await sql(`set session_replication_role = replica`) // siembra sin pasar por el guardián
    await sql(
      `insert into public.public_rate_events (organization_id, company_id, store_id, surface, created_at)
       values ($1, $2, $3, 'analytics.track', now() - interval '2 days'),
              ($4, $5, $6, 'analytics.track', now() - interval '2 days')`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, TENANT_B.organizationId, TENANT_B.companyId, storeB],
    )
    await sql(`set session_replication_role = origin`)
    const purged = await asRole(db, 'service_role', null, () =>
      sql(`select public.purge_public_rate_events(interval '1 day') as n`),
    )
    expect(purged[0]?.n).toBe(1)
    const left = await sql(`select organization_id from public.public_rate_events where created_at < now() - interval '1 day'`)
    expect(left).toEqual([{ organization_id: TENANT_A.organizationId }])
  })

  it('las colas no entregan lo del suspendido (ni lo dejan ocupar el lote)', async () => {
    await sql(`set session_replication_role = replica`)
    await sql(`select ebim.publish_event($1, $2, $3, 'test.lifecycle', 'product', $4, '{}'::jsonb, 'lifecycle-a')`, [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, productA,
    ])
    await sql(`select ebim.publish_event($1, $2, $3, 'test.lifecycle', 'product', $4, '{}'::jsonb, 'lifecycle-b')`, [
      TENANT_B.organizationId, TENANT_B.companyId, storeB, productB,
    ])
    await sql(`set session_replication_role = origin`)
    const claimed = await asRole(db, 'service_role', null, () =>
      sql(`select organization_id from public.claim_domain_events('w1', 100, array['test.lifecycle'])`),
    )
    expect(claimed).toEqual([{ organization_id: TENANT_B.organizationId }])
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('ACTIVE: todo se reanuda sin intervención y sin perder datos', () => {
  beforeAll(async () => {
    await activateA(11)
  })

  it('el backoffice vuelve a escribir y los datos siguen ahí', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const rows = await sql(`update public.products set name = 'Silla A2' where id = $1 returning name`, [productA])
      expect(rows).toEqual([{ name: 'Silla A2' }])
      expect((await sql(`select public.my_tenant_lifecycle() as r`))[0]?.r).toMatchObject({ state: 'ACTIVE', reason: null })
    })
  })

  it('la vitrina vende otra vez y la cola entrega lo que esperaba', async () => {
    await asRole(db, 'anon', null, async () => {
      expect((await sql(`select public.store_operational_for_slug($1) as r`, [TENANT_A.storeSlug]))[0]?.r).toEqual({
        operational: true,
      })
      const [cart] = await sql(`select public.cart_open($1, null) as c`, [TENANT_A.storeSlug])
      expect(cart?.c).toBeTruthy()
    })
    const claimed = await asRole(db, 'service_role', null, () =>
      sql(`select organization_id from public.claim_domain_events('w2', 100, array['test.lifecycle'])`),
    )
    expect(claimed).toEqual([{ organization_id: TENANT_A.organizationId }])
    // El mantenimiento ya alcanza la fila que antes saltó.
    const purged = await asRole(db, 'service_role', null, () =>
      sql(`select public.purge_public_rate_events(interval '1 day') as n`),
    )
    expect(purged[0]?.n).toBe(1)
  })
})
