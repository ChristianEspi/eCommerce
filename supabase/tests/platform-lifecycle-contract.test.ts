// @vitest-environment node
/**
 * `lifecycle.v1` de punta a punta sin red: JWT ES256 firmado aquí con una
 * clave de prueba, handler REAL de `platform-provisioning` para las rutas de
 * lifecycle y las RPC reales sobre Postgres (PGlite, todas las migraciones).
 *
 *   · transporte: sin configuración 503; sin token / firma ajena / emisor 401;
 *     scope de entitlements o de alta 403; `jti` reutilizado 401; rutas 404/405;
 *   · cuerpo: campo desconocido, causa incoherente, versión, contrato,
 *     Content-Type e Idempotency-Key → 400 INVALID_LIFECYCLE; PRODUCT_MISMATCH;
 *     WRONG_ENVIRONMENT;
 *   · semántica: aplicado, repetición, STALE_LIFECYCLE, VERSION_CONFLICT,
 *     TENANT_NOT_PROVISIONED, GET antes y después; la respuesta 2xx confirma lo
 *     enviado (lo que exige `classifyLifecycleResponse` de MasterAdmin);
 *   · despacho: las rutas de lifecycle no caen en entitlements ni en provisioning.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDatabase } from './harness.ts'
import { provisionTenant } from './entitlements-helpers.ts'
import { isEntitlementsRoute } from '../functions/_shared/platformEntitlements/handler.ts'
import { loadLifecycleConfig, type LifecycleConfig } from '../functions/_shared/platformLifecycle/config.ts'
import { handleLifecycleRequest, isLifecycleRoute } from '../functions/_shared/platformLifecycle/handler.ts'
import { createLifecycleRpcRepository } from '../functions/_shared/platformLifecycle/repository.ts'
import { importMasterAdminPublicKey } from '../functions/_shared/platformProvisioning/m2m.ts'
import type { RpcClient } from '../functions/_shared/platformProvisioning/repository.ts'

type Row = Record<string, unknown>

const BASE = 'https://example.supabase.co/functions/v1/platform-provisioning'
const NOW = 1_790_000_000
const CPT = '2c000000-0000-4000-8000-000000000001'
const CPT_UNKNOWN = '2c000000-0000-4000-8000-0000000000ff'
const WRITE = 'ecommerce:lifecycle:write'
const READ = 'ecommerce:lifecycle:read'

let db: PGlite
let keys: CryptoKeyPair
let otherKeys: CryptoKeyPair
let publicKeyB64: string
let logs: Record<string, unknown>[]

const b64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))

async function sign(claims: Record<string, unknown>, key: CryptoKey = keys.privateKey): Promise<string> {
  const input = `${b64urlJson({ alg: 'ES256', typ: 'JWT' })}.${b64urlJson(claims)}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input))
  return `${input}.${b64url(new Uint8Array(signature))}`
}

function token(scope: string, overrides: Record<string, unknown> = {}, key?: CryptoKey): Promise<string> {
  return sign(
    {
      iss: 'masteradmin.ebim',
      aud: 'ecommerce.ebim',
      sub: 'masteradmin-provisioning',
      iat: NOW - 10,
      exp: NOW + 110,
      jti: crypto.randomUUID(),
      scope,
      actor_id: '10000000-0000-4000-a000-000000000002',
      actor_role: 'SYSTEM',
      ...overrides,
    },
    key,
  )
}

function envFor(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    EBIM_MASTERADMIN_M2M_ENABLED: 'true',
    EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
    EBIM_MASTERADMIN_M2M_AUDIENCE: 'ecommerce.ebim',
    EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
    EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
    EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
    EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'ecommerce:tenant:create',
    EBIM_MASTERADMIN_M2M_READ_SCOPE: 'ecommerce:tenant:read',
    EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
    EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'ecommerce:entitlements:write',
    EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'ecommerce:entitlements:read',
    EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE: WRITE,
    EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE: READ,
    EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
    ...overrides,
  }
  return { get: (key: string) => values[key] }
}

const pgliteRpc: RpcClient = {
  async rpc(fn, args) {
    try {
      const data = await asRole(db, 'service_role', null, async () => {
        const one = async (sql: string, params: unknown[]) => (await db.query<{ v: unknown }>(sql, params)).rows[0]?.v ?? null
        switch (fn) {
          case 'platform_apply_lifecycle':
            return one('select public.platform_apply_lifecycle($1::uuid, $2::jsonb, $3::jsonb) as v', [
              args.p_control_plane_tenant_id,
              JSON.stringify(args.p_command),
              JSON.stringify(args.p_meta),
            ])
          case 'platform_get_lifecycle':
            return one('select public.platform_get_lifecycle($1::uuid) as v', [args.p_control_plane_tenant_id])
          case 'platform_entitlements_use_jti':
            return one('select public.platform_entitlements_use_jti($1, $2, $3::timestamptz) as v', [
              args.p_issuer,
              args.p_jti,
              args.p_expires_at,
            ])
          default:
            throw new Error(`RPC no esperada: ${fn}`)
        }
      })
      return { data, error: null }
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } }
    }
  },
}

const CONFIG = () => loadLifecycleConfig(envFor()) as LifecycleConfig

function body(o: Partial<Row> & { version: number; state?: string; reason?: string | null } = { version: 1 }): Row {
  const state = o.state ?? 'SUSPENDED'
  return {
    contract: 'lifecycle.v1',
    controlPlaneTenantId: CPT,
    productCode: 'ecommerce',
    environment: 'DEV',
    state,
    reason: state === 'SUSPENDED' ? 'NON_PAYMENT' : null,
    effectiveAt: '2026-10-13T11:00:00Z',
    idempotencyKey: `lifecycle:${CPT}:ecommerce:${o.version}`,
    correlationId: '1f0a3c1e-1b7e-4c47-9d55-3a4b1f2e9c10',
    ...o,
  }
}

async function call(
  method: string,
  path: string,
  init: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string>; config?: LifecycleConfig | null } = {},
): Promise<{ status: number; body: Row; headers: Headers }> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  const payload = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body))
  if (payload !== undefined && !('Content-Type' in headers)) headers['Content-Type'] = 'application/json'
  if (payload !== undefined && init.body && typeof init.body === 'object' && !('Idempotency-Key' in headers)) {
    const key = (init.body as Row).idempotencyKey
    if (typeof key === 'string') headers['Idempotency-Key'] = key
  }
  const config = init.config === undefined ? CONFIG() : init.config
  const response = await handleLifecycleRequest(new Request(`${BASE}${path}`, { method, headers, body: payload }), {
    config,
    publicKey: () => importMasterAdminPublicKey(publicKeyB64),
    repository: () => createLifecycleRpcRepository(pgliteRpc),
    nowSeconds: () => NOW,
    log: (event) => logs.push(event),
  })
  const text = await response.text()
  let parsed: Row = {}
  try {
    parsed = JSON.parse(text) as Row
  } catch {
    parsed = {}
  }
  return { status: response.status, body: parsed, headers: response.headers }
}

const PATH = `/tenants/${CPT}/lifecycle`

beforeAll(async () => {
  db = await createTestDatabase()
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  otherKeys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64')
  publicKeyB64 = Buffer.from(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`).toString('base64')
  logs = []
  await provisionTenant(db, {
    cpt: CPT,
    org: '2c000000-0000-4000-8000-0000000000a0',
    company: '2c000000-0000-4000-8000-0000000000c0',
    slug: 'lifecycle-shop',
  })
}, 120_000)

afterAll(async () => {
  await db?.close()
})

// ───────────────────────────────────────────────────────────────────────────
describe('configuración', () => {
  it('fail-closed: sin scopes propios, scopes reutilizados o sin entorno no hay configuración', () => {
    expect(loadLifecycleConfig(envFor())).toMatchObject({ writeScope: WRITE, readScope: READ, environment: 'DEV', productCode: 'ecommerce' })
    expect(loadLifecycleConfig(envFor({ EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE: undefined }))).toBeNull()
    expect(loadLifecycleConfig(envFor({ EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE: WRITE }))).toBeNull()
    expect(loadLifecycleConfig(envFor({ EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE: 'ecommerce:entitlements:write' }))).toBeNull()
    expect(loadLifecycleConfig(envFor({ EBIM_ENTITLEMENTS_ENVIRONMENT: undefined }))).toBeNull()
    expect(loadLifecycleConfig(envFor({ EBIM_MASTERADMIN_M2M_ENABLED: 'false' }))).toBeNull()
  })

  it('sin configuración: 503 LIFECYCLE_NOT_CONFIGURED', async () => {
    const r = await call('GET', PATH, { token: await token(READ), config: null })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('LIFECYCLE_NOT_CONFIGURED')
  })
})

describe('despacho y rutas', () => {
  it('las rutas de lifecycle son solo /tenants/{id}/lifecycle y no caen en entitlements', () => {
    expect(isLifecycleRoute(`${BASE}${PATH}`)).toBe(true)
    expect(isEntitlementsRoute(`${BASE}${PATH}`)).toBe(false)
    expect(isLifecycleRoute(`${BASE}/tenants/${CPT}/entitlements`)).toBe(false)
    expect(isLifecycleRoute(`${BASE}/tenants/${CPT}`)).toBe(false)
    expect(isLifecycleRoute(`${BASE}/health`)).toBe(false)
  })

  it('id que no es UUID → 404; método no admitido → 405 con Allow', async () => {
    expect((await call('GET', '/tenants/no-uuid/lifecycle', { token: await token(READ) })).status).toBe(404)
    const r = await call('DELETE', PATH, { token: await token(WRITE) })
    expect(r.status).toBe(405)
    expect(r.headers.get('Allow')).toBe('GET, PUT')
  })
})

describe('autenticación M2M y scopes', () => {
  it('sin token, firma ajena, emisor o sujeto distintos → 401 UNAUTHENTICATED', async () => {
    for (const t of [
      null,
      await token(WRITE, {}, otherKeys.privateKey),
      await token(WRITE, { iss: 'otro' }),
      await token(WRITE, { sub: 'otra-cosa' }),
      await token(WRITE, { aud: 'esupplier.ebim' }),
      await token(WRITE, { exp: NOW - 1 }),
    ]) {
      const r = await call('PUT', PATH, { token: t, body: body({ version: 1 }) })
      expect(r.status).toBe(401)
      expect(r.body.error).toBe('UNAUTHENTICATED')
    }
  })

  it('una credencial de entitlements o de alta no suspende a nadie → 403; leer no da escribir', async () => {
    for (const scope of ['ecommerce:entitlements:write', 'ecommerce:tenant:create', READ]) {
      const r = await call('PUT', PATH, { token: await token(scope), body: body({ version: 1 }) })
      expect(r.status, scope).toBe(403)
      expect(r.body.error).toBe('INSUFFICIENT_SCOPE')
    }
    const get = await call('GET', PATH, { token: await token(WRITE) })
    expect(get.status).toBe(403)
  })

  it('un jti se usa una sola vez → 401 JTI_REPLAYED', async () => {
    const t = await token(READ)
    expect((await call('GET', PATH, { token: t })).status).toBe(200)
    const again = await call('GET', PATH, { token: t })
    expect(again.status).toBe(401)
    expect(again.body.error).toBe('JTI_REPLAYED')
  })
})

describe('cuerpo del PUT', () => {
  it('lo que no es el contrato → 400 INVALID_LIFECYCLE', async () => {
    const extra = { ...body({ version: 1 }), extra: 1 }
    const missing = body({ version: 1 }) as Row
    delete missing.correlationId
    const cases: { body?: unknown; raw?: string; headers?: Record<string, string> }[] = [
      { body: extra },
      { body: missing },
      { body: body({ version: 1, reason: null }) },
      { body: body({ version: 1, state: 'ACTIVE', reason: 'MANUAL' }) },
      { body: body({ version: 1, reason: 'OTRA' }) },
      { body: body({ version: 0 }) },
      { body: body({ version: 1.5 }) },
      { body: body({ version: 1, state: 'PAUSED' }) },
      { body: body({ version: 1, contract: 'lifecycle.v2' }) },
      { body: body({ version: 1, effectiveAt: '2026-10-13T11:00:00' }) },
      { body: body({ version: 1, controlPlaneTenantId: CPT_UNKNOWN }) },
      { body: body({ version: 1, environment: 'STAGING' }) },
      { raw: '{no es json' },
      { raw: JSON.stringify(body({ version: 1 })), headers: { 'Content-Type': 'text/plain' } },
      { body: body({ version: 1 }), headers: { 'X-MasterAdmin-Contract': 'entitlements.v1' } },
      { body: body({ version: 1 }), headers: { 'Idempotency-Key': 'otra-clave-distinta' } },
    ]
    for (const c of cases) {
      const r = await call('PUT', PATH, { token: await token(WRITE), ...c })
      expect(r.status, JSON.stringify(c)).toBe(400)
      expect(r.body.error, JSON.stringify(c)).toBe('INVALID_LIFECYCLE')
    }
  })

  it('otro producto → PRODUCT_MISMATCH; otro entorno → WRONG_ENVIRONMENT', async () => {
    const p = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 1, productCode: 'esupplier' }) })
    expect(p.status).toBe(400)
    expect(p.body.error).toBe('PRODUCT_MISMATCH')
    const e = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 1, environment: 'QAS' }) })
    expect(e.status).toBe(400)
    expect(e.body.error).toBe('WRONG_ENVIRONMENT')
    expect(JSON.stringify(e.body)).not.toContain('NON_PAYMENT') // nunca se repite lo recibido
  })
})

describe('semántica lifecycle.v1', () => {
  it('GET sin PUT previo: ACTIVE con versión null', async () => {
    const r = await call('GET', PATH, { token: await token(READ) })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      controlPlaneTenantId: CPT,
      productCode: 'ecommerce',
      appliedVersion: null,
      state: 'ACTIVE',
      reason: null,
      appliedAt: null,
    })
  })

  it('tenant no aprovisionado → 404 en PUT y GET', async () => {
    const path = `/tenants/${CPT_UNKNOWN}/lifecycle`
    const put = await call('PUT', path, {
      token: await token(WRITE),
      body: body({ version: 1, controlPlaneTenantId: CPT_UNKNOWN, idempotencyKey: `lifecycle:${CPT_UNKNOWN}:ecommerce:1` }),
    })
    expect(put.status).toBe(404)
    expect(put.body.error).toBe('TENANT_NOT_PROVISIONED')
    const get = await call('GET', path, { token: await token(READ) })
    expect(get.status).toBe(404)
    expect(get.body.error).toBe('TENANT_NOT_PROVISIONED')
  })

  it('aplica, repite, STALE, CONFLICT y reactiva; el 2xx confirma lo enviado', async () => {
    const applied = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 3 }) })
    expect(applied.status).toBe(200)
    expect(applied.body).toMatchObject({
      controlPlaneTenantId: CPT,
      productCode: 'ecommerce',
      appliedVersion: 3,
      state: 'SUSPENDED',
      reason: 'NON_PAYMENT',
      replayed: false,
    })
    expect(Object.keys(applied.body).sort()).toEqual(
      ['appliedAt', 'appliedVersion', 'controlPlaneTenantId', 'productCode', 'reason', 'replayed', 'state'],
    )

    const replay = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 3 }) })
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ appliedVersion: 3, state: 'SUSPENDED', replayed: true })

    const stale = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 2, state: 'ACTIVE' }) })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'STALE_LIFECYCLE', appliedVersion: 3 })

    const conflict = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 3, state: 'ACTIVE' }) })
    expect(conflict.status).toBe(409)
    expect(conflict.body).toMatchObject({ error: 'VERSION_CONFLICT', appliedVersion: 3 })

    const get = await call('GET', PATH, { token: await token(READ) })
    expect(get.body).toMatchObject({ appliedVersion: 3, state: 'SUSPENDED', reason: 'NON_PAYMENT' })
    expect(get.body.appliedAt).toMatch(/Z$/)

    const active = await call('PUT', PATH, { token: await token(WRITE), body: body({ version: 4, state: 'ACTIVE' }) })
    expect(active.status).toBe(200)
    expect(active.body).toMatchObject({ appliedVersion: 4, state: 'ACTIVE', reason: null, replayed: false })
  })

  it('X-Correlation-Id UUID se devuelve; el log no lleva el token', async () => {
    const correlation = '3f0a3c1e-1b7e-4c47-9d55-3a4b1f2e9c10'
    const t = await token(READ)
    const r = await call('GET', PATH, { token: t, headers: { 'X-Correlation-Id': correlation } })
    expect(r.headers.get('X-Correlation-Id')).toBe(correlation)
    expect(JSON.stringify(logs)).not.toContain(t)
  })
})

describe('TENANT_SUSPENDED en las Edge Functions: 423, no 500', () => {
  it('error de la base → 423 en el borde, en el checkout y en la API de socio', async () => {
    const { fromDatabaseError } = await import('../functions/_shared/errors.ts')
    const { statusForCode, asStageError } = await import('../functions/_shared/checkout/errors.ts')
    const { toApiError } = await import('../functions/_shared/api/contract.ts')
    const message = 'TENANT_SUSPENDED: la cuenta esta suspendida; los datos se pueden consultar pero no modificar'
    expect(fromDatabaseError({ message, code: 'PT423' })).toMatchObject({ code: 'TENANT_SUSPENDED', status: 423 })
    // Aunque el mensaje llegue sin prefijo, manda el SQLSTATE.
    expect(fromDatabaseError({ message: 'x', code: 'PT423' })).toMatchObject({ code: 'TENANT_SUSPENDED', status: 423 })
    expect(statusForCode('TENANT_SUSPENDED')).toBe(423)
    expect(asStageError('reserve_inventory', new Error(message))).toMatchObject({ code: 'TENANT_SUSPENDED', status: 423, retryable: false })
    expect(toApiError(new Error(message))).toMatchObject({ code: 'TENANT_SUSPENDED', status: 423 })
  })
})
