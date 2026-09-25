// @vitest-environment node
/**
 * `platform-provisioning` — contrato GENERIC v1 de EBIM MasterAdmin, de punta a
 * punta sin red: JWT ES256 firmado aquí con una clave de prueba, handler real,
 * y las RPC reales sobre Postgres (PGlite con TODAS las migraciones).
 *
 * Lo que se defiende:
 *   · el token: sin token, basura, alg none/HS256, firma de otra clave, iss,
 *     aud, sub, scope, caducado, vida > máximo, claim `role`;
 *   · /health: 503 sin configuración, 200 {"status":"ok"} con ella;
 *   · create 201 → replay 200 replayed=true con los MISMOS ids → GET 200;
 *   · misma clave con otro cuerpo 409, mismo tenant con otra clave y otro
 *     contrato 409, slug ocupado 409;
 *   · ningún usuario de Auth creado; el owner queda PREPROVISIONED.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDatabase } from './harness.ts'
import {
  canonicalJson,
  deriveInternalIds,
  ECOMMERCE_PROVISIONING_NS_V1,
  parseGenericCreateRequest,
  uuidV5,
} from '../functions/_shared/platformProvisioning/contract.ts'
import { handleProvisioningRequest, type HandlerDeps } from '../functions/_shared/platformProvisioning/handler.ts'
import {
  importMasterAdminPublicKey,
  loadM2MConfig,
  type M2MConfig,
} from '../functions/_shared/platformProvisioning/m2m.ts'
import { createRpcRepository, type RpcClient } from '../functions/_shared/platformProvisioning/repository.ts'

type Row = Record<string, unknown>

const BASE = 'https://example.supabase.co/functions/v1/platform-provisioning'
const NOW = 1_790_000_000
const CPT = '5e000000-0000-4000-8000-000000000001'

let db: PGlite
let keys: CryptoKeyPair
let otherKeys: CryptoKeyPair
let publicKeyB64: string
let config: M2MConfig
let logs: Record<string, unknown>[]

// ── utilidades JWT ─────────────────────────────────────────────────────────
const b64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))

async function sign(
  claims: Record<string, unknown>,
  options: { header?: Record<string, unknown>; key?: CryptoKey } = {},
): Promise<string> {
  const header = options.header ?? { alg: 'ES256', typ: 'JWT' }
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    options.key ?? keys.privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${b64url(new Uint8Array(signature))}`
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'masteradmin.ebim',
    aud: 'ecommerce.ebim',
    sub: 'masteradmin-provisioning',
    iat: NOW - 10,
    exp: NOW + 110,
    jti: crypto.randomUUID(),
    scope: 'ecommerce:tenant:create ecommerce:tenant:read',
    actor_id: '10000000-0000-4000-a000-000000000002',
    actor_role: 'TECH_LEAD',
    ...overrides,
  }
}

function genericBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantCode: 'alpha-shop',
    tenantName: 'Empresa Directa Alpha · eCommerce',
    adminEmail: 'Admin@Alpha.EBIM.test',
    tenantType: 'PRODUCTION',
    environment: 'QAS',
    deploymentMode: 'SHARED',
    organization: {
      code: 'empresa-directa-alpha',
      legalName: 'Empresa Directa Alpha S.A.C.',
      displayName: 'Empresa Directa Alpha',
      countryCode: 'PE',
      taxId: '20500000004',
    },
    company: { code: 'ALPHA-01', name: 'Alpha Retail', countryCode: 'PE', currency: 'PEN' },
    plan: { code: 'ecommerce-standard', name: 'eCommerce Standard' },
    masterAdmin: {
      tenantId: CPT,
      productCode: 'ecommerce',
      requestId: '7a000000-0000-4000-8000-000000000001',
      contractVersion: 'v1',
    },
    ...overrides,
  }
}

// ── cliente RPC sobre PGlite, como lo haría supabase-js con service_role ──
const pgliteRpc: RpcClient = {
  async rpc(fn, args) {
    try {
      const data = await asRole(db, 'service_role', null, async () => {
        if (fn === 'platform_provision_tenant') {
          const r = await db.query<{ v: unknown }>(
            'select public.platform_provision_tenant($1::jsonb, $2::jsonb) as v',
            [JSON.stringify(args.p_payload), JSON.stringify(args.p_meta)],
          )
          return r.rows[0]?.v ?? null
        }
        if (fn === 'platform_get_provisioning') {
          const r = await db.query<{ v: unknown }>('select public.platform_get_provisioning($1::uuid) as v', [
            args.p_control_plane_tenant_id,
          ])
          return r.rows[0]?.v ?? null
        }
        if (fn === 'platform_record_provisioning_audit') {
          await db.query('select public.platform_record_provisioning_audit($1::jsonb)', [
            JSON.stringify(args.p_entry),
          ])
          return null
        }
        throw new Error(`rpc desconocida ${fn}`)
      })
      return { data, error: null }
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } }
    }
  },
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    config,
    publicKey: () => importMasterAdminPublicKey(publicKeyB64),
    repository: () => createRpcRepository(pgliteRpc),
    nowSeconds: () => NOW,
    log: (event) => logs.push(event),
    ...overrides,
  }
}

async function call(
  method: string,
  path: string,
  init: { token?: string | null; body?: unknown; headers?: Record<string, string>; deps?: HandlerDeps } = {},
): Promise<{ status: number; body: Row; headers: Headers }> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers['Content-Type'] ??= 'application/json'
  const request = new Request(`${BASE}${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  })
  const response = await handleProvisioningRequest(request, init.deps ?? deps())
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Row) : {}, headers: response.headers }
}

const create = async (body: unknown, key = 'ma-req-0001-alpha', token?: string) =>
  call('POST', '/tenants', {
    token: token ?? (await sign(claims())),
    body,
    headers: { 'Idempotency-Key': key, 'X-MasterAdmin-Contract': 'v1' },
  })

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

async function auditCount(): Promise<number> {
  const [row] = await su<{ n: number }>('select count(*)::int as n from platform_provisioning.audit')
  return row?.n ?? 0
}

beforeAll(async () => {
  db = await createTestDatabase()
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  otherKeys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64')
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----\n`
  publicKeyB64 = Buffer.from(pem).toString('base64')
  const env: Record<string, string> = {
    EBIM_MASTERADMIN_M2M_ENABLED: 'true',
    EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
    EBIM_MASTERADMIN_M2M_AUDIENCE: 'ecommerce.ebim',
    EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
    EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
    EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '120',
    EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'ecommerce:tenant:create',
    EBIM_MASTERADMIN_M2M_READ_SCOPE: 'ecommerce:tenant:read',
    EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  }
  const loaded = loadM2MConfig({ get: (k) => env[k] })
  if (!loaded) throw new Error('config de prueba invalida')
  config = loaded
  logs = []
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('configuración (fail-closed)', () => {
  it('sin ENABLED=true no hay configuración', () => {
    expect(loadM2MConfig({ get: () => undefined })).toBeNull()
  })

  it('un algoritmo distinto de ES256 o una vida > 300 anulan la configuración', () => {
    const base: Record<string, string> = {
      EBIM_MASTERADMIN_M2M_ENABLED: 'true',
      EBIM_MASTERADMIN_M2M_ISSUER: 'i',
      EBIM_MASTERADMIN_M2M_AUDIENCE: 'a',
      EBIM_MASTERADMIN_M2M_SUBJECT: 's',
      EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
      EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '120',
      EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'c',
      EBIM_MASTERADMIN_M2M_READ_SCOPE: 'r',
      EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: 'x',
    }
    expect(loadM2MConfig({ get: (k) => base[k] })).not.toBeNull()
    expect(loadM2MConfig({ get: (k) => ({ ...base, EBIM_MASTERADMIN_M2M_ALGORITHM: 'HS256' })[k] })).toBeNull()
    expect(loadM2MConfig({ get: (k) => ({ ...base, EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '301' })[k] })).toBeNull()
    expect(loadM2MConfig({ get: (k) => ({ ...base, EBIM_MASTERADMIN_M2M_SUBJECT: '' })[k] })).toBeNull()
  })

  it('sin configuración, POST y GET responden 503 M2M_NOT_CONFIGURED', async () => {
    const d = deps({ config: null })
    const post = await call('POST', '/tenants', { token: await sign(claims()), body: genericBody(), deps: d })
    expect(post.status).toBe(503)
    expect(post.body.code).toBe('M2M_NOT_CONFIGURED')
    const get = await call('GET', `/tenants/${CPT}`, { token: await sign(claims()), deps: d })
    expect(get.status).toBe(503)
  })
})

describe('GET /health', () => {
  it('503 {"status":"unavailable"} cuando está apagada', async () => {
    const res = await call('GET', '/health', { deps: deps({ config: null }) })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'unavailable' })
  })

  it('503 si la clave pública no importa', async () => {
    const res = await call('GET', '/health', {
      deps: deps({ publicKey: () => Promise.reject(new Error('mala')) }),
    })
    expect(res.status).toBe(503)
  })

  it('200 {"status":"ok"} sin autenticación y sin revelar configuración', async () => {
    const res = await call('GET', '/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('POST /health es 405', async () => {
    const res = await call('POST', '/health', { body: {} })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET')
  })
})

describe('el token M2M', () => {
  it('sin Authorization → 401 UNAUTHENTICATED', async () => {
    const res = await call('POST', '/tenants', { body: genericBody() })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('UNAUTHENTICATED')
  })

  it('token basura → 401 INVALID_M2M_TOKEN', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: 'no.es-un.jwt' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_M2M_TOKEN')
  })

  it('alg none → 401', async () => {
    const token = `${b64urlJson({ alg: 'none', typ: 'JWT' })}.${b64urlJson(claims())}.`
    const res = await call('GET', `/tenants/${CPT}`, { token })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_M2M_TOKEN')
  })

  it('alg HS256 (confusión de algoritmo) → 401', async () => {
    const token = await sign(claims(), { header: { alg: 'HS256', typ: 'JWT' } })
    expect((await call('GET', `/tenants/${CPT}`, { token })).status).toBe(401)
  })

  it('firma de otra clave → 401 INVALID_M2M_TOKEN, sin explicar iss/aud', async () => {
    const token = await sign(claims({ iss: 'otro' }), { key: otherKeys.privateKey })
    const res = await call('GET', `/tenants/${CPT}`, { token })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_M2M_TOKEN')
  })

  it('iss equivocado → 401 INVALID_ISSUER', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims({ iss: 'evil.ebim' })) })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_ISSUER')
  })

  it('aud de otro producto → 401 INVALID_AUDIENCE', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims({ aud: 'echange.ebim' })) })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_AUDIENCE')
  })

  it('sub distinto del configurado → 401', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims({ sub: 'masteradmin-otro' })) })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_M2M_TOKEN')
  })

  it('caducado → 401', async () => {
    const res = await call('GET', `/tenants/${CPT}`, {
      token: await sign(claims({ iat: NOW - 200, exp: NOW - 80 })),
    })
    expect(res.status).toBe(401)
  })

  it('vida mayor que el máximo (120 s) → 401', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims({ iat: NOW, exp: NOW + 121 })) })
    expect(res.status).toBe(401)
  })

  it('un JWT con claim `role` (Supabase) → 401', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims({ role: 'service_role' })) })
    expect(res.status).toBe(401)
  })

  it('sin jti → 401', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims({ jti: undefined })) })
    expect(res.status).toBe(401)
  })

  it('un token inválido NO se escribe en la bitácora', async () => {
    const before = await auditCount()
    await call('POST', '/tenants', { token: await sign(claims({ aud: 'x' })), body: genericBody() })
    expect(await auditCount()).toBe(before)
  })

  it('scope de lectura en POST → 403 MISSING_SCOPE y queda auditado', async () => {
    const before = await auditCount()
    const res = await create(genericBody(), 'ma-scope-only-read', await sign(claims({ scope: 'ecommerce:tenant:read' })))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('MISSING_SCOPE')
    expect(await auditCount()).toBe(before + 1)
  })

  it('scope de creación en GET → 403', async () => {
    const res = await call('GET', `/tenants/${CPT}`, {
      token: await sign(claims({ scope: 'ecommerce:tenant:create' })),
    })
    expect(res.status).toBe(403)
  })
})

describe('validación del cuerpo', () => {
  it('sin Idempotency-Key → 400', async () => {
    const res = await call('POST', '/tenants', { token: await sign(claims()), body: genericBody() })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('otro contrato en X-MasterAdmin-Contract → 400', async () => {
    const res = await call('POST', '/tenants', {
      token: await sign(claims()),
      body: genericBody(),
      headers: { 'Idempotency-Key': 'ma-req-v2-contract', 'X-MasterAdmin-Contract': 'v2' },
    })
    expect(res.body.code).toBe('UNSUPPORTED_CONTRACT_VERSION')
  })

  it('productCode de otro producto, slug inválido y correo de suite → 400 con todos los campos', async () => {
    const res = await create(
      genericBody({
        tenantCode: 'Mal Slug!',
        adminEmail: 'dcalagua@ebim.pe',
        masterAdmin: { tenantId: CPT, productCode: 'echange' },
      }),
      'ma-req-invalid-body',
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_REQUEST')
    const fields = ((res.body.error as Row).details as { field: string }[]).map((d) => d.field).sort()
    expect(fields).toEqual(['adminEmail', 'masterAdmin.productCode', 'tenantCode'])
  })

  it('JSON malformado → 400', async () => {
    const res = await create('{"tenantCode":', 'ma-req-malformed')
    expect(res.status).toBe(400)
  })

  it('el hash ignora lo que eCommerce no guarda', () => {
    const a = parseGenericCreateRequest(genericBody())
    const b = parseGenericCreateRequest(
      genericBody({ plan: { code: 'otro' }, tenantName: 'x', adminEmail: '  admin@alpha.ebim.TEST ' }),
    )
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      const strip = (d: typeof a.draft) => canonicalJson({ ...d, context: null })
      expect(strip(a.draft)).toBe(strip(b.draft))
    }
  })
})

describe('ids deterministas', () => {
  it('el namespace es uuid5(URL, "https://ecommerce.ebim/platform-provisioning/v1")', async () => {
    // Vector de RFC 9562 (uuid5 de "www.example.com" en el namespace DNS).
    expect(await uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    )
    expect(
      await uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'https://ecommerce.ebim/platform-provisioning/v1'),
    ).toBe(ECOMMERCE_PROVISIONING_NS_V1)
  })

  it('mismo tenant → mismos ids; organización ≠ sociedad', async () => {
    const a = await deriveInternalIds(CPT)
    const b = await deriveInternalIds(CPT.toUpperCase())
    expect(a).toEqual(b)
    expect(a.organizationId).not.toBe(a.companyId)
  })
})

describe('alta, replay, consulta y conflictos (RPC reales)', () => {
  let created: Row

  it('POST → 201 ACTIVE con owner PREPROVISIONED y sin usuario de Auth', async () => {
    const [{ n: usersBefore } = { n: -1 }] = await su<{ n: number }>('select count(*)::int as n from auth.users')
    const res = await create(genericBody())
    expect(res.status).toBe(201)
    created = res.body
    const ids = await deriveInternalIds(CPT)
    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      controlPlaneTenantId: CPT,
      externalTenantId: ids.organizationId,
      externalOrganizationId: ids.organizationId,
      externalCompanyId: ids.companyId,
      adminProvisioningStatus: 'PREPROVISIONED',
      deploymentMode: 'SHARED',
      replayed: false,
    })
    expect(res.body.requestHash).toBeUndefined()
    expect(res.body.resources).toMatchObject({ tenantSlug: 'alpha-shop', storeCount: 0 })

    const [{ n: usersAfter } = { n: -2 }] = await su<{ n: number }>('select count(*)::int as n from auth.users')
    expect(usersAfter).toBe(usersBefore)

    const [tenant] = await svc('select slug, name, admin_email, status from public.tenants where organization_id = $1', [
      ids.organizationId,
    ])
    expect(tenant).toEqual({
      slug: 'alpha-shop',
      name: 'Empresa Directa Alpha',
      admin_email: 'admin@alpha.ebim.test',
      status: 'active',
    })
    const [{ n: members } = { n: -1 }] = await su<{ n: number }>(
      'select count(*)::int as n from public.tenant_members where organization_id = $1',
      [ids.organizationId],
    )
    expect(members).toBe(0)
  })

  it('replay con la misma clave y el mismo cuerpo → 200 replayed=true, mismos ids', async () => {
    const res = await create(genericBody())
    expect(res.status).toBe(200)
    expect(res.body.replayed).toBe(true)
    expect(res.body.provisioningId).toBe(created.provisioningId)
    expect(res.body.externalTenantId).toBe(created.externalTenantId)
    expect(res.body.externalCompanyId).toBe(created.externalCompanyId)
  })

  it('replay normalizado (mayúsculas, espacios, plan distinto) también es replay', async () => {
    const res = await create(genericBody({ adminEmail: ' ADMIN@alpha.ebim.test ', plan: { code: 'otro' } }))
    expect(res.status).toBe(200)
    expect(res.body.replayed).toBe(true)
  })

  it('misma clave con otro cuerpo → 409 IDEMPOTENCY_CONFLICT', async () => {
    const res = await create(genericBody({ tenantCode: 'alpha-otra' }))
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('mismo tenant y mismo contrato con otra clave → 409 TENANT_ALREADY_PROVISIONED', async () => {
    const res = await create(genericBody(), 'ma-req-0002-alpha')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('TENANT_ALREADY_PROVISIONED')
  })

  it('mismo tenant con otro contrato → 409 TENANT_CONFLICT', async () => {
    const res = await create(genericBody({ adminEmail: 'otra@alpha.ebim.test' }), 'ma-req-0003-alpha')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('TENANT_CONFLICT')
  })

  it('otro tenant con un slug ya ocupado → 409 TENANT_CONFLICT, sin nada a medias', async () => {
    const other = '5e000000-0000-4000-8000-000000000002'
    const res = await create(
      genericBody({ masterAdmin: { tenantId: other, productCode: 'ecommerce' } }),
      'ma-req-0001-beta',
    )
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('TENANT_CONFLICT')
    const [{ n } = { n: -1 }] = await su<{ n: number }>(
      'select count(*)::int as n from platform_provisioning.requests where control_plane_tenant_id = $1',
      [other],
    )
    expect(n).toBe(0)
  })

  it('GET → 200 con el mismo registro', async () => {
    const res = await call('GET', `/tenants/${CPT}`, { token: await sign(claims()) })
    expect(res.status).toBe(200)
    expect(res.body.provisioningId).toBe(created.provisioningId)
    expect(res.body.externalTenantId).toBe(created.externalTenantId)
    expect(res.body.replayed).toBeUndefined()
  })

  it('GET de un tenant desconocido → 404 PROVISIONING_NOT_FOUND', async () => {
    const res = await call('GET', '/tenants/5e000000-0000-4000-8000-0000000000ff', { token: await sign(claims()) })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('PROVISIONING_NOT_FOUND')
  })

  it('GET con un id que no es UUID → 400', async () => {
    const res = await call('GET', '/tenants/no-es-uuid', { token: await sign(claims()) })
    expect(res.status).toBe(400)
  })

  it('la bitácora registró CREATED, REPLAYED, CONFLICT y FOUND con el sujeto M2M', async () => {
    const rows = await su<{ result: string; m2m_subject: string }>(
      `select result, m2m_subject from platform_provisioning.audit where control_plane_tenant_id = $1`,
      [CPT],
    )
    const results = new Set(rows.map((r) => r.result))
    for (const r of ['CREATED', 'REPLAYED', 'CONFLICT', 'FOUND']) expect(results.has(r)).toBe(true)
    expect(rows.every((r) => r.m2m_subject === 'masteradmin-provisioning')).toBe(true)
  })

  it('un fallo inesperado de la RPC → 500 PROVISIONING_FAILED sin detalle de Postgres', async () => {
    const res = await call('POST', '/tenants', {
      token: await sign(claims()),
      body: genericBody({ masterAdmin: { tenantId: '5e000000-0000-4000-8000-000000000003', productCode: 'ecommerce' }, tenantCode: 'gamma-shop' }),
      headers: { 'Idempotency-Key': 'ma-req-0001-gamma' },
      deps: deps({ repository: () => createRpcRepository({ rpc: async () => ({ data: null, error: { message: 'relation "x" does not exist' } }) }) }),
    })
    expect(res.status).toBe(500)
    expect(res.body.code).toBe('PROVISIONING_FAILED')
    expect(JSON.stringify(res.body)).not.toContain('does not exist')
  })

  it('nunca se loguea el token', () => {
    expect(JSON.stringify(logs)).not.toMatch(/eyJ/)
  })
})
