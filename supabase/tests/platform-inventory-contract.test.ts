// @vitest-environment node
/**
 * `tenant-inventory.v1` de punta a punta sin red: JWT ES256 firmado aquí, los
 * handlers REALES de `platform-provisioning` (inventario/vínculo, alta y estado)
 * y las RPC reales sobre Postgres (PGlite, todas las migraciones).
 *
 *   · transporte: sin configuración 503; sin token 401; scope de otro canal 403;
 *     `jti` reutilizado 401; despacho de rutas (`GET /tenants` ≠ `POST /tenants`
 *     ≠ `GET /tenants/{id}`), 405;
 *   · inventario: todos los tenants, orden estable, keyset con cursor opaco,
 *     `externalTenantId` = el del alta, estados ACTIVE/SUSPENDED/INACTIVE, un
 *     alta cuyo tenant se borró no aparece (y su estado responde 404);
 *   · vínculo: LINKED → ALREADY_LINKED, 404, 409 en los dos sentidos, 400; tras
 *     vincular, el GET de estado y lifecycle.v1 resuelven el tenant; el vínculo
 *     no toca el tenant ni sus miembros.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDatabase } from './harness.ts'
import { provisionTenant } from './entitlements-helpers.ts'
import { isEntitlementsRoute } from '../functions/_shared/platformEntitlements/handler.ts'
import { isLifecycleRoute } from '../functions/_shared/platformLifecycle/handler.ts'
import {
  loadInventoryConfig,
  loadTenantLinkConfig,
  type InventoryRouteConfig,
} from '../functions/_shared/platformInventory/config.ts'
import { decodeCursor, encodeCursor } from '../functions/_shared/platformInventory/contract.ts'
import { handleInventoryRequest, isInventoryRoute } from '../functions/_shared/platformInventory/handler.ts'
import { createInventoryRpcRepository } from '../functions/_shared/platformInventory/repository.ts'
import { deriveInternalIds } from '../functions/_shared/platformProvisioning/contract.ts'
import { handleProvisioningRequest } from '../functions/_shared/platformProvisioning/handler.ts'
import { importMasterAdminPublicKey, loadM2MConfig, type M2MConfig } from '../functions/_shared/platformProvisioning/m2m.ts'
import { createRpcRepository, type RpcClient } from '../functions/_shared/platformProvisioning/repository.ts'

type Row = Record<string, unknown>

const BASE = 'https://example.supabase.co/functions/v1/platform-provisioning'
const NOW = 1_790_000_000
const LIST = 'ecommerce:tenants:list'
const LINK = 'ecommerce:tenants:link'

// Alta por MasterAdmin (handler real) y un alta cuyo tenant se borró después.
const CPT_MA = '3d000000-0000-4000-8000-000000000001'
const CPT_ORPHAN = '3d000000-0000-4000-8000-0000000000ee'
const ORG_ORPHAN = '3d000000-0000-4000-8000-0000000000e0'
// Tenants creados en la app (bootstrap, consola): MasterAdmin no los conoce.
const ORG_DIRECT = '3d100000-0000-4000-8000-000000000001'
const CO_DIRECT = '3d100000-0000-4000-8000-0000000000c1'
const OWNER_DIRECT = '3d100000-0000-4000-8000-0000000000f1'
const ORG_EMPTY = '3d200000-0000-4000-8000-000000000001'
const ORG_CLOSED = '3d300000-0000-4000-8000-000000000001'
const ORG_BLOCKED = '3d400000-0000-4000-8000-000000000001'
const CPT_LINK = '3d900000-0000-4000-8000-000000000001'
const CPT_LINK_EMPTY = '3d900000-0000-4000-8000-000000000002'
const CPT_OTHER = '3d900000-0000-4000-8000-0000000000ff'

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
    EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE: 'ecommerce:lifecycle:write',
    EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE: 'ecommerce:lifecycle:read',
    EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE: LIST,
    EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE: LINK,
    EBIM_ENTITLEMENTS_ENVIRONMENT: 'QAS',
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
          case 'platform_list_tenants':
            return one('select public.platform_list_tenants($1::uuid, $2::integer) as v', [args.p_after, args.p_limit])
          case 'platform_link_tenant':
            return one('select public.platform_link_tenant($1::uuid, $2::uuid, $3::uuid, $4::jsonb) as v', [
              args.p_control_plane_tenant_id,
              args.p_external_tenant_id,
              args.p_fallback_company,
              JSON.stringify(args.p_meta),
            ])
          case 'platform_record_provisioning_audit':
            await db.query('select public.platform_record_provisioning_audit($1::jsonb)', [JSON.stringify(args.p_entry)])
            return null
          case 'platform_entitlements_use_jti':
            return one('select public.platform_entitlements_use_jti($1, $2, $3::timestamptz) as v', [
              args.p_issuer,
              args.p_jti,
              args.p_expires_at,
            ])
          case 'platform_provision_tenant':
            return one('select public.platform_provision_tenant($1::jsonb, $2::jsonb) as v', [
              JSON.stringify(args.p_payload),
              JSON.stringify(args.p_meta),
            ])
          case 'platform_get_provisioning':
            return one('select public.platform_get_provisioning($1::uuid) as v', [args.p_control_plane_tenant_id])
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

type Deps = { listConfig?: InventoryRouteConfig | null; linkConfig?: InventoryRouteConfig | null }

async function call(
  method: string,
  path: string,
  init: { token?: string | null; body?: unknown; headers?: Record<string, string> } & Deps = {},
): Promise<{ status: number; body: Row; headers: Headers }> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  const payload = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
  if (payload !== undefined && !('Content-Type' in headers)) headers['Content-Type'] = 'application/json'
  const response = await handleInventoryRequest(new Request(`${BASE}${path}`, { method, headers, body: payload }), {
    listConfig: init.listConfig === undefined ? loadInventoryConfig(envFor()) : init.listConfig,
    linkConfig: init.linkConfig === undefined ? loadTenantLinkConfig(envFor()) : init.linkConfig,
    publicKey: () => importMasterAdminPublicKey(publicKeyB64),
    repository: () => createInventoryRpcRepository(pgliteRpc),
    nowSeconds: () => NOW,
    log: (event) => logs.push(event),
  })
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Row) : {}, headers: response.headers }
}

/** El canal de alta/estado de siempre (handler real), para la paridad y el estado tras vincular. */
async function provisioning(method: string, path: string, init: { token: string; body?: unknown; key?: string }) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` }
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers['Idempotency-Key'] = init.key ?? 'inv-test-0001'
  }
  const response = await handleProvisioningRequest(
    new Request(`${BASE}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
    {
      config: loadM2MConfig(envFor()) as M2MConfig,
      publicKey: () => importMasterAdminPublicKey(publicKeyB64),
      repository: () => createRpcRepository(pgliteRpc),
      nowSeconds: () => NOW,
    },
  )
  return { status: response.status, body: (await response.json()) as Row, headers: response.headers }
}

const listAll = async (limit: number) => {
  const items: Row[] = []
  let cursor: string | null = null
  for (let page = 0; page < 100; page += 1) {
    const res = await call('GET', `/tenants?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`, { token: await token(LIST) })
    expect(res.status).toBe(200)
    items.push(...(res.body.items as Row[]))
    const next = res.body.nextCursor as string | null
    if (next === null) return items
    expect(next).not.toBe(cursor)
    cursor = next
  }
  throw new Error('el cursor no termina')
}

const su = async <T extends Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const itemOf = async (org: string) => (await listAll(500)).find((i) => i.externalTenantId === org)

beforeAll(async () => {
  db = await createTestDatabase()
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  otherKeys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64')
  publicKeyB64 = Buffer.from(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`).toString('base64')
  logs = []

  // Tenants que existen solo en la app.
  await su(
    `insert into public.tenants (organization_id, slug, name, admin_email, status) values
       ($1, 'directo-shop', 'Directo Shop', 'owner@directo.test', 'active'),
       ($2, 'vacio-shop', 'Vacio Shop', 'owner@vacio.test', 'active'),
       ($3, 'cerrado-shop', 'Cerrado Shop', 'owner@cerrado.test', 'closed'),
       ($4, 'bloqueado-shop', 'Bloqueado Shop', 'owner@bloqueado.test', 'suspended')`,
    [ORG_DIRECT, ORG_EMPTY, ORG_CLOSED, ORG_BLOCKED],
  )
  await su(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'owner@directo.test', 'owner', 'active')`,
    [ORG_DIRECT, CO_DIRECT, OWNER_DIRECT],
  )
  // Un alta de MasterAdmin cuyo tenant se borró después (el caso del smoke de QAS).
  await provisionTenant(db, { cpt: CPT_ORPHAN, org: ORG_ORPHAN, company: '3d000000-0000-4000-8000-0000000000e1', slug: 'huerfano-shop' })
  await su('delete from public.tenants where organization_id = $1', [ORG_ORPHAN])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

// ───────────────────────────────────────────────────────────────────────────
describe('configuración y transporte', () => {
  it('fail-closed: sin scope propio, scope de otro canal o sin entorno no hay configuración', () => {
    expect(loadInventoryConfig(envFor())).toMatchObject({ scope: LIST, environment: 'QAS', productCode: 'ecommerce' })
    expect(loadTenantLinkConfig(envFor())).toMatchObject({ scope: LINK, environment: 'QAS', productCode: 'ecommerce' })
    expect(loadInventoryConfig(envFor({ EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE: undefined }))).toBeNull()
    expect(loadTenantLinkConfig(envFor({ EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE: undefined }))).toBeNull()
    expect(loadInventoryConfig(envFor({ EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE: 'ecommerce:lifecycle:read' }))).toBeNull()
    expect(loadTenantLinkConfig(envFor({ EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE: 'ecommerce:tenant:create' }))).toBeNull()
    expect(loadInventoryConfig(envFor({ EBIM_ENTITLEMENTS_ENVIRONMENT: undefined }))).toBeNull()
    expect(loadInventoryConfig(envFor({ EBIM_MASTERADMIN_M2M_ENABLED: 'false' }))).toBeNull()
  })

  it('503 INVENTORY_NOT_CONFIGURED / TENANT_LINK_NOT_CONFIGURED sin configuración', async () => {
    const list = await call('GET', '/tenants', { token: await token(LIST), listConfig: null })
    expect(list.status).toBe(503)
    expect(list.body.error).toBe('INVENTORY_NOT_CONFIGURED')
    const link = await call('PUT', `/tenants/${CPT_LINK}/link`, { token: await token(LINK), linkConfig: null, body: {} })
    expect(link.status).toBe(503)
    expect(link.body.error).toBe('TENANT_LINK_NOT_CONFIGURED')
  })

  it('401 sin token o con firma ajena; 403 con el scope de otro canal; 401 con jti reutilizado', async () => {
    expect((await call('GET', '/tenants')).status).toBe(401)
    expect((await call('GET', '/tenants', { token: await token(LIST, {}, otherKeys.privateKey) })).status).toBe(401)
    for (const scope of ['ecommerce:tenant:read', 'ecommerce:lifecycle:read', LINK]) {
      const res = await call('GET', '/tenants', { token: await token(scope) })
      expect(res.status, scope).toBe(403)
      expect(res.body.error).toBe('INSUFFICIENT_SCOPE')
    }
    const linkWithList = await call('PUT', `/tenants/${CPT_LINK}/link`, { token: await token(LIST), body: {} })
    expect(linkWithList.status).toBe(403)
    const jti = crypto.randomUUID()
    expect((await call('GET', '/tenants', { token: await token(LIST, { jti }) })).status).toBe(200)
    const replay = await call('GET', '/tenants', { token: await token(LIST, { jti }) })
    expect(replay.status).toBe(401)
    expect(replay.body.error).toBe('JTI_REPLAYED')
  })

  it('despacho: GET /tenants es el inventario; el alta, el estado y los demás canales no pasan por aquí', () => {
    expect(isInventoryRoute('GET', `${BASE}/tenants`)).toBe(true)
    expect(isInventoryRoute('GET', `${BASE}/tenants/?limit=5`)).toBe(true)
    expect(isInventoryRoute('PUT', `${BASE}/tenants/${CPT_LINK}/link`)).toBe(true)
    expect(isInventoryRoute('POST', `${BASE}/tenants`)).toBe(false)
    expect(isInventoryRoute('GET', `${BASE}/tenants/${CPT_MA}`)).toBe(false)
    expect(isInventoryRoute('GET', `${BASE}/tenants/${CPT_MA}/lifecycle`)).toBe(false)
    expect(isInventoryRoute('PUT', `${BASE}/tenants/${CPT_MA}/entitlements`)).toBe(false)
    expect(isLifecycleRoute(`${BASE}/tenants/${CPT_LINK}/link`)).toBe(false)
    expect(isEntitlementsRoute(`${BASE}/tenants/${CPT_LINK}/link`)).toBe(false)
  })

  it('405 con su Allow: el vínculo solo admite PUT; /tenants admite GET y POST', async () => {
    const res = await call('GET', `/tenants/${CPT_LINK}/link`, { token: await token(LINK) })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('PUT')
    const del = await provisioning('DELETE', '/tenants', { token: await token('ecommerce:tenant:read') })
    expect(del.status).toBe(405)
    expect(del.headers.get('Allow')).toBe('GET, POST')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('inventario (GET /tenants)', () => {
  it('externalTenantId y controlPlaneTenantId son los mismos que devuelve el alta', async () => {
    const created = await provisioning('POST', '/tenants', {
      token: await token('ecommerce:tenant:create'),
      key: 'inv-test-alta-0001',
      body: {
        tenantCode: 'alta-shop',
        adminEmail: 'owner@alta.test',
        deploymentMode: 'SHARED',
        organization: { displayName: 'Alta Shop' },
        masterAdmin: { tenantId: CPT_MA, productCode: 'ecommerce', contractVersion: 'v1' },
      },
    })
    expect(created.status).toBe(201)
    const item = await itemOf(created.body.externalTenantId as string)
    expect(item).toEqual({
      externalTenantId: created.body.externalTenantId,
      externalOrganizationId: created.body.externalOrganizationId,
      externalCompanyId: created.body.externalCompanyId,
      controlPlaneTenantId: CPT_MA,
      code: 'alta-shop',
      name: 'Alta Shop',
      status: 'ACTIVE',
    })
  })

  it('lista TODOS los tenants una vez, en orden estable por id, con el contrato y el entorno', async () => {
    const res = await call('GET', '/tenants', { token: await token(LIST), headers: { 'X-MasterAdmin-Contract': 'tenant-inventory.v1' } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ contract: 'tenant-inventory.v1', productCode: 'ecommerce', environment: 'QAS', nextCursor: null })
    const expected = (await su<{ id: string }>('select organization_id::text as id from public.tenants order by organization_id')).map((r) => r.id)
    expect((res.body.items as Row[]).map((i) => i.externalTenantId)).toEqual(expected)
    // Solo identidad y estado.
    for (const item of res.body.items as Row[]) {
      expect(Object.keys(item).sort()).toEqual(
        ['code', 'controlPlaneTenantId', 'externalCompanyId', 'externalOrganizationId', 'externalTenantId', 'name', 'status'],
      )
    }
  })

  it('paginación keyset: cada página trae su cursor y la unión es el listado completo, sin repetir', async () => {
    const all = (await listAll(500)).map((i) => i.externalTenantId)
    expect(all.length).toBeGreaterThanOrEqual(5)
    const paged = (await listAll(2)).map((i) => i.externalTenantId)
    expect(paged).toEqual(all)
    expect(new Set(paged).size).toBe(paged.length)
    const first = await call('GET', '/tenants?limit=1', { token: await token(LIST) })
    expect((first.body.items as Row[]).length).toBe(1)
    expect(decodeCursor(first.body.nextCursor as string)).toBe(all[0])
  })

  it('400 INVALID_INVENTORY_QUERY: limit fuera de 1..500, cursor ajeno o contrato distinto', async () => {
    for (const q of ['limit=0', 'limit=501', 'limit=abc', 'limit=-1', 'cursor=', 'cursor=zzz', `cursor=${Buffer.from('otra-cosa').toString('base64url')}`, 'limit=1&limit=2']) {
      const res = await call('GET', `/tenants?${q}`, { token: await token(LIST) })
      expect(res.status, q).toBe(400)
      expect(res.body.error).toBe('INVALID_INVENTORY_QUERY')
    }
    const contract = await call('GET', '/tenants', { token: await token(LIST), headers: { 'X-MasterAdmin-Contract': 'v1' } })
    expect(contract.status).toBe(400)
    expect(encodeCursor(ORG_DIRECT)).not.toContain(ORG_DIRECT)
  })

  it('estados: closed → INACTIVE; suspended propio o lifecycle.v1 SUSPENDED → SUSPENDED; sin alta → cpt null', async () => {
    expect((await itemOf(ORG_CLOSED))?.status).toBe('INACTIVE')
    expect((await itemOf(ORG_BLOCKED))?.status).toBe('SUSPENDED')
    const direct = await itemOf(ORG_DIRECT)
    expect(direct).toMatchObject({ status: 'ACTIVE', controlPlaneTenantId: null, externalCompanyId: CO_DIRECT, code: 'directo-shop' })
    expect((await itemOf(ORG_EMPTY))?.externalCompanyId).toBeNull()

    const [{ org } = { org: '' }] = await su<{ org: string }>(
      `select tenant_organization_id::text as org from platform_provisioning.requests where control_plane_tenant_id = $1`,
      [CPT_MA],
    )
    await su(
      `insert into platform_lifecycle.tenant_state (control_plane_tenant_id, organization_id, state, reason, applied_version)
       values ($1, $2, 'SUSPENDED', 'NON_PAYMENT', 1)`,
      [CPT_MA, org],
    )
    expect((await itemOf(org))?.status).toBe('SUSPENDED')
    await su('delete from platform_lifecycle.tenant_state where control_plane_tenant_id = $1', [CPT_MA])
    expect((await itemOf(org))?.status).toBe('ACTIVE')
  })

  it('un alta cuyo tenant se borró NO aparece, y su estado responde 404 (no un 200 «TENANT_MISSING»)', async () => {
    expect(await itemOf(ORG_ORPHAN)).toBeUndefined()
    const status = await provisioning('GET', `/tenants/${CPT_ORPHAN}`, { token: await token('ecommerce:tenant:read') })
    expect(status.status).toBe(404)
    expect(status.body.code).toBe('PROVISIONING_NOT_FOUND')
    const lifecycle = await asRole(db, 'service_role', null, async () =>
      (await db.query<{ v: unknown }>('select public.platform_get_lifecycle($1::uuid) as v', [CPT_ORPHAN])).rows[0]?.v,
    )
    expect(lifecycle).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('vínculo (PUT /tenants/{cpt}/link)', () => {
  const linkBody = (ext: string) => ({ externalTenantId: ext, requestId: '7b000000-0000-4000-8000-000000000001' })

  it('antes de vincular, el estado del tenant existente es 404', async () => {
    const res = await provisioning('GET', `/tenants/${CPT_LINK}`, { token: await token('ecommerce:tenant:read') })
    expect(res.status).toBe(404)
  })

  it('LINKED la primera vez y ALREADY_LINKED después, sin tocar el tenant ni sus miembros', async () => {
    const before = await su('select * from public.tenants where organization_id = $1', [ORG_DIRECT])
    const membersBefore = await su('select * from public.tenant_members where organization_id = $1', [ORG_DIRECT])

    const first = await call('PUT', `/tenants/${CPT_LINK}/link`, {
      token: await token(LINK),
      body: linkBody(ORG_DIRECT),
      headers: { 'X-MasterAdmin-Contract': 'tenant-inventory.v1' },
    })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({
      contract: 'tenant-inventory.v1',
      productCode: 'ecommerce',
      environment: 'QAS',
      controlPlaneTenantId: CPT_LINK,
      externalTenantId: ORG_DIRECT,
      status: 'LINKED',
    })
    const again = await call('PUT', `/tenants/${CPT_LINK.toUpperCase()}/link`, { token: await token(LINK), body: linkBody(ORG_DIRECT.toUpperCase()) })
    expect(again.status).toBe(200)
    expect(again.body.status).toBe('ALREADY_LINKED')

    expect(await su('select * from public.tenants where organization_id = $1', [ORG_DIRECT])).toEqual(before)
    expect(await su('select * from public.tenant_members where organization_id = $1', [ORG_DIRECT])).toEqual(membersBefore)
    const audit = await su<{ result: string }>(
      `select result from platform_provisioning.audit where operation = 'LINK_TENANT' and control_plane_tenant_id = $1 order by id`,
      [CPT_LINK],
    )
    expect(audit.map((a) => a.result)).toEqual(['LINKED', 'ALREADY_LINKED'])
    const [req] = await su<{ origin: string; adm: string }>(
      `select request_payload ->> 'origin' as origin, admin_provisioning_status as adm
         from platform_provisioning.requests where control_plane_tenant_id = $1`,
      [CPT_LINK],
    )
    expect(req).toEqual({ origin: 'LINKED', adm: 'ACTIVE' })
  })

  it('tras vincular, el estado, lifecycle.v1 y el inventario lo resuelven como si MasterAdmin lo hubiera creado', async () => {
    const status = await provisioning('GET', `/tenants/${CPT_LINK}`, { token: await token('ecommerce:tenant:read') })
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      status: 'ACTIVE',
      controlPlaneTenantId: CPT_LINK,
      externalTenantId: ORG_DIRECT,
      externalOrganizationId: ORG_DIRECT,
      externalCompanyId: CO_DIRECT,
      adminProvisioningStatus: 'ACTIVE',
    })
    const lifecycle = await asRole(db, 'service_role', null, async () =>
      (await db.query<{ v: Row }>('select public.platform_get_lifecycle($1::uuid) as v', [CPT_LINK])).rows[0]?.v,
    )
    expect(lifecycle).toMatchObject({ state: 'ACTIVE', appliedVersion: null })
    expect((await itemOf(ORG_DIRECT))?.controlPlaneTenantId).toBe(CPT_LINK)
  })

  it('un tenant sin sociedad visible usa la sociedad derivada del cpt y su owner queda PREPROVISIONED', async () => {
    const res = await call('PUT', `/tenants/${CPT_LINK_EMPTY}/link`, { token: await token(LINK), body: linkBody(ORG_EMPTY) })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('LINKED')
    const { companyId } = await deriveInternalIds(CPT_LINK_EMPTY)
    const status = await provisioning('GET', `/tenants/${CPT_LINK_EMPTY}`, { token: await token('ecommerce:tenant:read') })
    expect(status.body).toMatchObject({ externalTenantId: ORG_EMPTY, externalCompanyId: companyId, adminProvisioningStatus: 'PREPROVISIONED' })
  })

  it('el tenant que creó MasterAdmin ya está vinculado a su cpt: ALREADY_LINKED', async () => {
    const created = await provisioning('GET', `/tenants/${CPT_MA}`, { token: await token('ecommerce:tenant:read') })
    const res = await call('PUT', `/tenants/${CPT_MA}/link`, { token: await token(LINK), body: linkBody(created.body.externalTenantId as string) })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ALREADY_LINKED')
  })

  it('404 EXTERNAL_TENANT_NOT_FOUND si el tenant no existe (tampoco el de un alta borrada)', async () => {
    for (const ext of ['3d500000-0000-4000-8000-000000000001', ORG_ORPHAN]) {
      const res = await call('PUT', `/tenants/${CPT_OTHER}/link`, { token: await token(LINK), body: linkBody(ext) })
      expect(res.status, ext).toBe(404)
      expect(res.body.error).toBe('EXTERNAL_TENANT_NOT_FOUND')
    }
  })

  it('409 LINK_CONFLICT: el tenant ya está vinculado a otro cpt, o el cpt a otro tenant', async () => {
    const otherCpt = await call('PUT', `/tenants/${CPT_OTHER}/link`, { token: await token(LINK), body: linkBody(ORG_DIRECT) })
    expect(otherCpt.status).toBe(409)
    expect(otherCpt.body.error).toBe('LINK_CONFLICT')
    const otherExt = await call('PUT', `/tenants/${CPT_LINK}/link`, { token: await token(LINK), body: linkBody(ORG_CLOSED) })
    expect(otherExt.status).toBe(409)
    expect(otherExt.body.error).toBe('LINK_CONFLICT')
    const orphanCpt = await call('PUT', `/tenants/${CPT_ORPHAN}/link`, { token: await token(LINK), body: linkBody(ORG_CLOSED) })
    expect(orphanCpt.status).toBe(409)
    expect(await su('select 1 from platform_provisioning.requests where tenant_organization_id = $1', [ORG_CLOSED])).toEqual([])
  })

  it('400 INVALID_LINK_REQUEST: cpt o ids que no son UUID, cuerpo roto, campos del contrato con otro valor', async () => {
    const cases: Array<[string, unknown, Record<string, string>?]> = [
      ['/tenants/no-es-uuid/link', linkBody(ORG_DIRECT)],
      [`/tenants/${CPT_OTHER}/link`, { externalTenantId: '42', requestId: '7b000000-0000-4000-8000-000000000001' }],
      [`/tenants/${CPT_OTHER}/link`, { externalTenantId: ORG_CLOSED }],
      [`/tenants/${CPT_OTHER}/link`, '{roto'],
      [`/tenants/${CPT_OTHER}/link`, [linkBody(ORG_CLOSED)]],
      [`/tenants/${CPT_OTHER}/link`, { ...linkBody(ORG_CLOSED), productCode: 'gmao' }],
      [`/tenants/${CPT_OTHER}/link`, { ...linkBody(ORG_CLOSED), environment: 'PRD' }],
      [`/tenants/${CPT_OTHER}/link`, { ...linkBody(ORG_CLOSED), controlPlaneTenantId: CPT_LINK }],
      [`/tenants/${CPT_OTHER}/link`, linkBody(ORG_CLOSED), { 'Content-Type': 'text/plain' }],
      [`/tenants/${CPT_OTHER}/link`, linkBody(ORG_CLOSED), { 'X-MasterAdmin-Contract': 'lifecycle.v1' }],
    ]
    for (const [path, body, headers] of cases) {
      const res = await call('PUT', path, { token: await token(LINK), body, headers })
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400)
      expect(res.body.error).toBe('INVALID_LINK_REQUEST')
    }
    // Campos ajenos al contrato se toleran.
    const extra = await call('PUT', `/tenants/${CPT_LINK}/link`, {
      token: await token(LINK),
      body: { ...linkBody(ORG_DIRECT), contract: 'tenant-inventory.v1', note: 'x' },
    })
    expect(extra.body.status).toBe('ALREADY_LINKED')
  })

  it('la bitácora guarda los rechazos tras la firma, sin el token', async () => {
    const rows = await su<{ error_code: string; m2m_subject: string }>(
      `select error_code, m2m_subject from platform_provisioning.audit
        where operation = 'LINK_TENANT' and result in ('REJECTED', 'CONFLICT') order by id`,
    )
    const codes = new Set(rows.map((r) => r.error_code))
    for (const code of ['INSUFFICIENT_SCOPE', 'EXTERNAL_TENANT_NOT_FOUND', 'LINK_CONFLICT', 'INVALID_LINK_REQUEST']) {
      expect(codes.has(code), code).toBe(true)
    }
    expect(rows.every((r) => r.m2m_subject === 'masteradmin-provisioning')).toBe(true)
    expect(JSON.stringify(logs)).not.toMatch(/eyJ/)
  })

  it('las RPC nuevas son solo de service_role', async () => {
    const rows = await su<{ fn: string; anon: boolean; auth: boolean; svc: boolean }>(`
      select p.proname as fn,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('service_role', p.oid, 'execute') as svc
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('platform_list_tenants', 'platform_link_tenant')
       order by 1`)
    expect(rows).toEqual([
      { fn: 'platform_link_tenant', anon: false, auth: false, svc: true },
      { fn: 'platform_list_tenants', anon: false, auth: false, svc: true },
    ])
  })
})
