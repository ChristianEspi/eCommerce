// @vitest-environment node
/**
 * Llaves de Culqi por tienda (20261113140000) contra Postgres real.
 *
 * Lo que no puede fallar:
 *
 *  - un tenant no escribe ni descubre las llaves del otro;
 *  - la secreta va a Vault: nadie con sesión la lee, solo `service_role` y
 *    solo por intento de pago (la del medio de ESE intento);
 *  - `has_secret`/`secret_hint` no se escriben a mano;
 *  - formato `pk_`/`sk_` y mismo entorno (pruebas o producción) en las dos;
 *  - la vitrina (anon) ve la pública y nada más;
 *  - cambiar de pasarela o borrar el medio saca la secreta de Vault.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
  vaciarPagosYEntregas,
} from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let storeB = ''
let metodoA = ''
let metodoB = ''
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000e1'

const SK_TEST = 'sk_test_aaaaaaaa1111'
const SK_LIVE = 'sk_live_bbbbbbbb2222'
const PK_TEST = 'pk_test_cccccccc3333'

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function asUser<T = Row>(
  tenant: typeof TENANT_A,
  query: string,
  params: unknown[] = [],
  overrides: Parameters<typeof claimsFor>[1] = {},
): Promise<T[]> {
  return asRole(db, 'authenticated', claimsFor(tenant, overrides), async () => {
    return (await db.query<T>(query, params)).rows
  })
}

async function asAnon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => (await db.query<T>(query, params)).rows)
}

/** Vault simulado: solo lo toca el superusuario, como en Supabase. */
async function su<T = Row>(query: string): Promise<T[]> {
  return (await db.query<T>(query)).rows
}

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
  ])
  const [store] = await svc(`select id from public.stores where slug = $1`, [tenant.storeSlug])
  await svc(`update public.stores set status = 'active' where id = $1`, [store?.id])
  return String(store?.id)
}

async function metodoCulqi(tenant: typeof TENANT_A, storeId: string, code = 'tarjeta'): Promise<string> {
  const [row] = await svc(
    `insert into public.payment_methods
       (organization_id, company_id, store_id, code, kind, display_name, provider_code, capture_mode, is_active)
     values ($1, $2, $3, $4, 'card', 'Tarjeta', 'culqi', 'automatic', true) returning id`,
    [tenant.organizationId, tenant.companyId, storeId, code],
  )
  return String(row?.id)
}

const setSecret = (tenant: typeof TENANT_A, method: string, secret: string, overrides = {}) =>
  asUser(tenant, `select public.payment_method_set_secret($1, $2) as r`, [method, secret], overrides)

beforeAll(async () => {
  db = await createTestDatabase()
  await db.exec(`
    create schema if not exists vault;
    create table vault.secrets (
      id uuid primary key default gen_random_uuid(),
      name text unique, description text, secret text not null
    );
    create view vault.decrypted_secrets as
      select id, name, description, secret, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null,
      new_description text default '', new_key_id uuid default null) returns uuid
      language sql as $$ insert into vault.secrets (name, description, secret)
                         values (new_name, new_description, new_secret) returning id $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null,
      new_name text default null, new_description text default null, new_key_id uuid default null)
      returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret)
                                       where id = secret_id $$;
  `)
  storeA = await bootstrap(TENANT_A)
  storeB = await bootstrap(TENANT_B)
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
  )
  await vaciarPagosYEntregas(db, [storeA, storeB])
  metodoA = await metodoCulqi(TENANT_A, storeA)
  metodoB = await metodoCulqi(TENANT_B, storeB)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  // Los intentos de pago son inmutables (ni el superusuario los borra) y sujetan
  // al medio: los medios se crean una vez y aquí solo se devuelven a cero.
  await su(`delete from ebim.payment_method_secrets`)
  await su(`delete from vault.secrets`)
  await su(`select set_config('ebim.payment_secret_write', 'on', false)`)
  await su(`update public.payment_methods
               set checkout_public_key = null, has_secret = false, secret_hint = null, secret_set_at = null`)
  await su(`select set_config('ebim.payment_secret_write', '', false)`)
})

describe('la llave secreta va a Vault y no vuelve', () => {
  it('el owner/admin la guarda; queda la pista, no la llave', async () => {
    const [r] = await setSecret(TENANT_A, metodoA, SK_TEST)
    expect(r?.r).toEqual({ has_secret: true, secret_hint: 'sk_test_…1111' })

    const [fila] = await asUser(TENANT_A,
      `select has_secret, secret_hint, to_jsonb(m)::text as todo from public.payment_methods m where id = $1`, [metodoA])
    expect(fila?.has_secret).toBe(true)
    expect(fila?.secret_hint).toBe('sk_test_…1111')
    expect(String(fila?.todo)).not.toContain(SK_TEST)

    expect(await su(`select secret from vault.secrets`)).toEqual([{ secret: SK_TEST }])
  })

  it('nadie con sesión lee la secreta ni el puntero; el checkout sí, por intento', async () => {
    await setSecret(TENANT_A, metodoA, SK_TEST)

    const sinPermiso = await expectFailure(() =>
      asUser(TENANT_A, `select * from ebim.payment_method_secrets`))
    expect(sinPermiso).toMatch(/permission denied/i)

    const [intento] = await svc<{ r: { intent_id: string } }>(
      `select public.payment_intent_open($1, 'tarjeta', 100::numeric, 'PEN', 'clave-intento-a') as r`, [TENANT_A.storeSlug])
    const intentId = intento?.r.intent_id

    for (const quien of [
      () => asUser(TENANT_A, `select public.payment_secret_for_intent($1)`, [intentId]),
      () => asAnon(`select public.payment_secret_for_intent($1)`, [intentId]),
    ]) {
      expect(await expectFailure(quien)).toMatch(/permission denied/i)
    }

    const [deServidor] = await svc<{ s: string }>(`select public.payment_secret_for_intent($1) as s`, [intentId])
    expect(deServidor?.s).toBe(SK_TEST)
  })

  it('el intento de OTRA tienda lleva SU llave, no la de esta', async () => {
    await setSecret(TENANT_A, metodoA, SK_TEST)
    await setSecret(TENANT_B, metodoB, SK_LIVE)
    const [intentoB] = await svc<{ r: { intent_id: string } }>(
      `select public.payment_intent_open($1, 'tarjeta', 50::numeric, 'PEN', 'clave-intento-b') as r`, [TENANT_B.storeSlug])
    const [s] = await svc<{ s: string }>(`select public.payment_secret_for_intent($1) as s`, [intentoB?.r.intent_id])
    expect(s?.s).toBe(SK_LIVE)
  })
})

describe('aislamiento y permisos', () => {
  it('un tenant no toca las llaves del otro (ni sabe que el medio existe)', async () => {
    const error = await expectFailure(() => setSecret(TENANT_B, metodoA, SK_TEST))
    expect(error).toMatch(/MEDIO_DE_PAGO_NO_ENCONTRADO/)
    expect(await su(`select 1 from vault.secrets`)).toHaveLength(0)

    const ajenas = await asUser(TENANT_B, `select id from public.payment_methods where id = $1`, [metodoA])
    expect(ajenas).toHaveLength(0)
  })

  it('un viewer no la cambia', async () => {
    const error = await expectFailure(() =>
      setSecret(TENANT_A, metodoA, SK_TEST, {
        sub: VIEWER_USER,
        email: 'lector@tenant-a.com',
        companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
      }))
    expect(error).toMatch(/SIN_PERMISO/)
  })

  it('has_secret y la pista no se escriben a mano', async () => {
    await asUser(TENANT_A,
      `update public.payment_methods set has_secret = true, secret_hint = 'sk_live_…9999' where id = $1`, [metodoA])
    const [fila] = await svc(`select has_secret, secret_hint from public.payment_methods where id = $1`, [metodoA])
    expect(fila).toEqual({ has_secret: false, secret_hint: null })
  })
})

describe('formato y entorno', () => {
  it('rechaza una secreta que no es sk_ (p. ej. la pública pegada en su lugar)', async () => {
    expect(await expectFailure(() => setSecret(TENANT_A, metodoA, PK_TEST))).toMatch(/LLAVE_NO_VALIDA/)
  })

  it('la pública exige pk_ y nunca acepta una secreta', async () => {
    const error = await expectFailure(() =>
      asUser(TENANT_A, `update public.payment_methods set checkout_public_key = $2 where id = $1`, [metodoA, SK_TEST]))
    expect(error).toMatch(/payment_methods_public_key_fmt/)
  })

  it('pública de pruebas + secreta de producción no se mezclan, en ningún orden', async () => {
    await asUser(TENANT_A, `update public.payment_methods set checkout_public_key = $2 where id = $1`, [metodoA, PK_TEST])
    expect(await expectFailure(() => setSecret(TENANT_A, metodoA, SK_LIVE))).toMatch(/LLAVES_DE_DISTINTO_ENTORNO/)

    await setSecret(TENANT_A, metodoA, SK_TEST)
    const error = await expectFailure(() =>
      asUser(TENANT_A, `update public.payment_methods set checkout_public_key = 'pk_live_dddddddd4444' where id = $1`, [metodoA]))
    expect(error).toMatch(/payment_methods_keys_same_env/)
  })
})

describe('vitrina y ciclo de vida', () => {
  it('anon ve la llave pública del medio y nada de la secreta', async () => {
    await asUser(TENANT_A, `update public.payment_methods set checkout_public_key = $2 where id = $1`, [metodoA, PK_TEST])
    await setSecret(TENANT_A, metodoA, SK_TEST)

    const [visto] = await asAnon(`select * from public.public_payment_methods where payment_method_id = $1`, [metodoA])
    expect(visto?.checkout_public_key).toBe(PK_TEST)
    expect(JSON.stringify(visto)).not.toMatch(/sk_|has_secret|secret_hint|provider_code/)

    const error = await expectFailure(() =>
      asAnon(`select secret_hint from public.payment_methods where id = $1`, [metodoA]))
    expect(error).toMatch(/permission denied/i)
  })

  it('vaciar la secreta, cambiar de pasarela o borrar el medio la saca de Vault', async () => {
    // Medio propio, sin intentos: los intentos sujetan al medio y no se borran.
    const medio = await metodoCulqi(TENANT_A, storeA, 'tarjeta-ciclo')

    await setSecret(TENANT_A, medio, SK_TEST)
    await setSecret(TENANT_A, medio, '')
    expect(await su(`select 1 from vault.secrets`)).toHaveLength(0)

    await setSecret(TENANT_A, medio, SK_TEST)
    await asUser(TENANT_A, `update public.payment_methods set provider_code = 'sandbox' where id = $1`, [medio])
    expect(await su(`select 1 from vault.secrets`)).toHaveLength(0)
    const [fila] = await svc(`select has_secret, checkout_public_key from public.payment_methods where id = $1`, [medio])
    expect(fila).toEqual({ has_secret: false, checkout_public_key: null })

    await asUser(TENANT_A, `update public.payment_methods set provider_code = 'culqi' where id = $1`, [medio])
    await setSecret(TENANT_A, medio, SK_TEST)
    await asUser(TENANT_A, `delete from public.payment_methods where id = $1`, [medio])
    expect(await su(`select 1 from vault.secrets`)).toHaveLength(0)
  })
})
