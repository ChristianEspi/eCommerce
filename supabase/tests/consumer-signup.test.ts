// @vitest-environment node
/**
 * N02 · Registrarse como consumidor NO crea nada de empresa, sobre Postgres real.
 *
 * El alta la hace Supabase Auth (`auth.users`). Lo que esta base tiene que
 * garantizar es que de esa fila no nace, por ningún disparador, ni un tenant,
 * ni una membresía de backoffice, ni una cuenta de empresa ni una ficha de
 * cliente; y que esa persona, con sesión, es una consumidora: sin contexto
 * comercial, sin cuentas que elegir y con el precio público.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, createTestDatabase } from './harness.ts'

type Row = Record<string, unknown>

const NUEVA = '0f200000-0000-4000-8000-00000000c001'

let db: PGlite

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function comoNueva<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  const claims = { sub: NUEVA, email: 'nueva@consumidora.test', org_id: '', companies: [], active_company: '' }
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

async function conteos(): Promise<Record<string, number>> {
  const [row] = await svc<Record<string, number>>(`
    select (select count(*)::int from public.tenants)                as tenants,
           (select count(*)::int from public.tenant_members)         as members,
           (select count(*)::int from public.business_accounts)      as accounts,
           (select count(*)::int from public.business_account_users) as account_users,
           (select count(*)::int from public.customers)              as customers`)
  return row ?? {}
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
  await svc(`update public.stores set status = 'active' where slug = $1`, [TENANT_A.storeSlug])
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('el alta de consumidor', () => {
  it('ninguna migración cuelga un disparador de auth.users', async () => {
    const triggers = await svc(`
      select t.tgname from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal`)
    expect(triggers).toEqual([])
  })

  it('crear el usuario no crea tenant, membresía, cuenta de empresa ni cliente', async () => {
    const antes = await conteos()
    // Como lo hace el servicio de Auth: con su propio rol, fuera de PostgREST.
    await db.query(`insert into auth.users (id, email) values ($1, 'nueva@consumidora.test')`, [NUEVA])
    expect(await conteos()).toEqual(antes)
  })

  it('con sesión es consumidora: sin contexto comercial ni cuentas que elegir', async () => {
    const [ctx] = await comoNueva<{ c: unknown }>(`select public.my_commerce_context($1) as c`, [TENANT_A.storeSlug])
    expect(ctx?.c).toBeNull()
    const [cuentas] = await comoNueva<{ c: unknown }>(`select public.my_store_business_accounts($1) as c`, [
      TENANT_A.storeSlug,
    ])
    expect(cuentas?.c).toEqual([])
    const [efectiva] = await comoNueva<{ c: unknown }>(`select public.my_effective_business_account_for_slug($1) as c`, [
      TENANT_A.storeSlug,
    ])
    expect(efectiva?.c).toBeNull()
    const [mias] = await comoNueva<{ c: unknown }>(`select public.my_business_accounts() as c`)
    expect(mias?.c).toEqual([])
  })

  it('y no ve nada del backoffice de la tienda', async () => {
    expect(await comoNueva(`select * from public.tenant_members`)).toEqual([])
    expect(await comoNueva(`select id from public.customers`)).toEqual([])
    expect(await comoNueva(`select id from public.orders`)).toEqual([])
  })
})
