/**
 * Rutas `tenant-inventory.v1` de `platform-provisioning` (EBIM MasterAdmin → eCommerce).
 * ADITIVAS: provisioning, entitlements y lifecycle no cambian.
 *
 *   GET /platform-provisioning/tenants?limit=&cursor=           <product>:tenants:list
 *   PUT /platform-provisioning/tenants/{controlPlaneTenantId}/link   <product>:tenants:link
 *
 * Choque de rutas resuelto en `isInventoryRoute`: `GET /tenants` (listado) viene
 * aquí; `POST /tenants` (alta) y `GET /tenants/{id}` (estado) siguen en
 * provisioning; `/tenants/{id}/lifecycle|entitlements` en sus canales.
 *
 * Orden de cada petición (el de lifecycle):
 *   1. Ruta y método. 2. Configuración (sin ella, 503).
 *   3. JWT M2M (misma verificación que provisioning) + scope PROPIO → 401/403.
 *   4. Recién entonces el repositorio (service-role). `jti` de un solo uso → 401.
 *   5. Consulta / cabeceras y cuerpo. 6. RPC.
 *
 * Nunca se loguea Authorization ni el JWT. Portable (sin Deno.*).
 */
import { edgeSecurityHeaders } from '../securityHeaders.ts'
import { verifyMasterAdminM2M, type M2MClaims } from '../platformProvisioning/m2m.ts'
import { deriveInternalIds } from '../platformProvisioning/contract.ts'
import type { InventoryRouteConfig } from './config.ts'
import {
  encodeCursor,
  INVENTORY_CONTRACT,
  INVENTORY_ERROR_STATUS,
  inventoryErrorBody,
  type InventoryErrorCode,
  isInventoryErrorCode,
  parseInventoryQuery,
  parseLinkCommand,
  UUID_RE,
} from './contract.ts'
import type { InventoryRepository } from './repository.ts'

/** El cuerpo del vínculo cabe de sobra en 16 KB. */
export const MAX_LINK_BODY_BYTES = 16 * 1024

export interface InventoryDeps {
  /** Configuración de `GET /tenants`; null = 503 INVENTORY_NOT_CONFIGURED. */
  listConfig: InventoryRouteConfig | null
  /** Configuración de `PUT /tenants/{id}/link`; null = 503 TENANT_LINK_NOT_CONFIGURED. */
  linkConfig: InventoryRouteConfig | null
  publicKey: (config: InventoryRouteConfig) => Promise<CryptoKey>
  /** Se invoca SOLO tras validar el M2M. */
  repository: () => InventoryRepository
  nowSeconds?: () => number
  randomUuid?: () => string
  log?: (event: Record<string, unknown>) => void
}

type Route =
  | { kind: 'list' }
  | { kind: 'link'; rawId: string }
  | { kind: 'method_not_allowed'; allow: string }
  | { kind: 'not_found' }

function pathOf(url: string): string {
  return new URL(url).pathname.replace(/^.*?\/platform-provisioning/, '').replace(/\/+$/, '')
}

const LINK_PATH = /^\/tenants\/([^/]+)\/link$/

/**
 * ¿Es de este canal? `GET /tenants` (el listado; `POST /tenants` es el alta) y
 * cualquier método sobre `/tenants/{id}/link`.
 */
export function isInventoryRoute(method: string, url: string): boolean {
  const path = pathOf(url)
  return (path === '/tenants' && method === 'GET') || LINK_PATH.test(path)
}

function resolveRoute(method: string, url: string): Route {
  const path = pathOf(url)
  if (path === '/tenants') return method === 'GET' ? { kind: 'list' } : { kind: 'method_not_allowed', allow: 'GET, POST' }
  const m = path.match(LINK_PATH)
  if (!m || !m[1]) return { kind: 'not_found' }
  if (method !== 'PUT') return { kind: 'method_not_allowed', allow: 'PUT' }
  return { kind: 'link', rawId: m[1] }
}

function respond(status: number, body: unknown, correlationId: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...edgeSecurityHeaders(),
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      ...extra,
    },
  })
}

export async function handleInventoryRequest(req: Request, deps: InventoryDeps): Promise<Response> {
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const newUuid = deps.randomUuid ?? (() => crypto.randomUUID())
  const log = deps.log ?? (() => {})

  const incoming = req.headers.get('X-Correlation-Id')
  const correlationId = incoming && UUID_RE.test(incoming.toLowerCase()) ? incoming.toLowerCase() : newUuid()

  const fail = (code: InventoryErrorCode, headers: Record<string, string> = {}) => {
    log({ event: 'platform_inventory.rejected', code, correlationId })
    return respond(INVENTORY_ERROR_STATUS[code], inventoryErrorBody(code), correlationId, headers)
  }

  const route = resolveRoute(req.method, req.url)
  if (route.kind === 'not_found') return fail('NOT_FOUND')
  if (route.kind === 'method_not_allowed') return fail('METHOD_NOT_ALLOWED', { Allow: route.allow })

  const isList = route.kind === 'list'
  const notConfigured: InventoryErrorCode = isList ? 'INVENTORY_NOT_CONFIGURED' : 'TENANT_LINK_NOT_CONFIGURED'
  const failed: InventoryErrorCode = isList ? 'INVENTORY_FAILED' : 'TENANT_LINK_FAILED'

  const config = isList ? deps.listConfig : deps.linkConfig
  if (!config) return fail(notConfigured)

  let publicKey: CryptoKey
  try {
    publicKey = await deps.publicKey(config)
  } catch {
    return fail(notConfigured)
  }

  const auth = await verifyMasterAdminM2M(req.headers.get('Authorization'), config.m2m, publicKey, config.scope, now())
  if (!auth.ok) {
    if (auth.code === 'M2M_NOT_CONFIGURED') return fail(notConfigured)
    if (auth.code !== 'MISSING_SCOPE') return fail('UNAUTHENTICATED')
    // Firma válida sin el scope del vínculo: se audita (como el alta). Un token inválido no.
    if (!isList && auth.claims) {
      const repo = tryRepository(deps)
      if (repo) await safeAudit(repo, log, linkAudit('INSUFFICIENT_SCOPE', null, null, auth.claims, correlationId))
    }
    return fail('INSUFFICIENT_SCOPE')
  }
  const claims: M2MClaims = auth.claims

  const repository = tryRepository(deps)
  if (!repository) return fail(failed)

  try {
    const firstUse = await repository.useJti(config.m2m.issuer, claims.jti, new Date(claims.exp * 1000).toISOString())
    if (!firstUse) return fail('JTI_REPLAYED')
  } catch {
    return fail(failed)
  }

  const contract = req.headers.get('X-MasterAdmin-Contract')
  const contractOk = contract === null || contract.trim().toLowerCase() === INVENTORY_CONTRACT

  // ── GET /tenants ───────────────────────────────────────────────────────────
  if (route.kind === 'list') {
    const query = parseInventoryQuery(req.url)
    if (!contractOk || !query) return fail('INVALID_INVENTORY_QUERY')
    try {
      const page = await repository.list(query.after, query.limit)
      const last = page.items[page.items.length - 1]
      const nextCursor = page.hasMore && last ? encodeCursor(last.externalTenantId) : null
      log({ event: 'platform_inventory.listed', correlationId, count: page.items.length, more: nextCursor !== null })
      return respond(
        200,
        {
          contract: INVENTORY_CONTRACT,
          productCode: config.productCode,
          environment: config.environment,
          items: page.items,
          nextCursor,
        },
        correlationId,
      )
    } catch {
      return fail('INVENTORY_FAILED')
    }
  }

  // ── PUT /tenants/{cpt}/link ───────────────────────────────────────────────
  let cpt: string | null = null
  try {
    const decoded = decodeURIComponent(route.rawId).toLowerCase()
    cpt = UUID_RE.test(decoded) ? decoded : null
  } catch {
    cpt = null
  }

  const rejectLink = async (code: InventoryErrorCode, requestId: string | null = null) => {
    await safeAudit(repository, log, linkAudit(code, cpt, requestId, claims, correlationId))
    return fail(code)
  }

  if (!cpt || !contractOk) return rejectLink('INVALID_LINK_REQUEST')
  const contentType = (req.headers.get('Content-Type') || '').toLowerCase()
  if (!contentType.startsWith('application/json')) return rejectLink('INVALID_LINK_REQUEST')

  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_LINK_BODY_BYTES) return rejectLink('INVALID_LINK_REQUEST')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return rejectLink('INVALID_LINK_REQUEST')
  }
  const command = parseLinkCommand(body, {
    controlPlaneTenantId: cpt,
    productCode: config.productCode,
    environment: config.environment,
  })
  if (!command) return rejectLink('INVALID_LINK_REQUEST')

  try {
    // Si la organización no tiene ninguna sociedad visible, la misma regla del alta.
    const { companyId } = await deriveInternalIds(cpt)
    const result = await repository.link(cpt, command.externalTenantId, companyId, {
      requestId: command.requestId,
      correlationId,
      m2mSubject: claims.sub,
      m2mJti: claims.jti,
      actorId: claims.actorId,
      actorRole: claims.actorRole,
    })
    if (result.httpStatus >= 400) {
      const code = result.body.error
      // La RPC ya auditó el rechazo dentro de su transacción.
      return isInventoryErrorCode(code) ? fail(code) : rejectLink('TENANT_LINK_FAILED', command.requestId)
    }
    const status = result.body.status === 'ALREADY_LINKED' ? 'ALREADY_LINKED' : 'LINKED'
    log({ event: 'platform_inventory.linked', correlationId, status })
    return respond(
      200,
      {
        contract: INVENTORY_CONTRACT,
        productCode: config.productCode,
        environment: config.environment,
        controlPlaneTenantId: cpt,
        externalTenantId: command.externalTenantId,
        status,
      },
      correlationId,
    )
  } catch {
    // La transacción se deshizo entera. El detalle de Postgres no sale.
    return rejectLink('TENANT_LINK_FAILED', command.requestId)
  }
}

function tryRepository(deps: InventoryDeps): InventoryRepository | null {
  try {
    return deps.repository()
  } catch {
    return null
  }
}

function linkAudit(
  code: InventoryErrorCode,
  cpt: string | null,
  requestId: string | null,
  claims: M2MClaims,
  correlationId: string,
) {
  return {
    operation: 'LINK_TENANT' as const,
    result: code === 'TENANT_LINK_FAILED' ? ('ERROR' as const) : ('REJECTED' as const),
    errorCode: code,
    httpStatus: INVENTORY_ERROR_STATUS[code],
    controlPlaneTenantId: cpt,
    idempotencyKey: requestId,
    correlationId,
    m2mSubject: claims.sub,
    m2mJti: claims.jti,
    actorId: claims.actorId,
    actorRole: claims.actorRole,
  }
}

async function safeAudit(
  repository: InventoryRepository,
  log: (event: Record<string, unknown>) => void,
  entry: Parameters<InventoryRepository['recordAudit']>[0],
) {
  try {
    await repository.recordAudit(entry)
  } catch {
    // Un fallo de auditoría no cambia la respuesta, pero queda visible en los logs.
    log({ event: 'platform_inventory.audit_failed', correlationId: entry.correlationId })
  }
}
