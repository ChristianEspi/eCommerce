/**
 * Rutas `lifecycle.v1` de `platform-provisioning` (EBIM MasterAdmin → eCommerce).
 * ADITIVAS: las de provisioning y entitlements no cambian y ni siquiera pasan
 * por aquí (`isLifecycleRoute`).
 *
 *   PUT /platform-provisioning/tenants/{controlPlaneTenantId}/lifecycle   <product>:lifecycle:write
 *   GET /platform-provisioning/tenants/{controlPlaneTenantId}/lifecycle   <product>:lifecycle:read
 *
 * Orden de cada petición (el mismo que entitlements):
 *   1. Ruta y método. 2. Configuración (sin ella, 503).
 *   3. JWT M2M (misma verificación que provisioning) + scope PROPIO → 401/403.
 *   4. Recién entonces el repositorio (service-role). `jti` de un solo uso → 401.
 *   5. Cabeceras, cuerpo, forma, tenant, producto, entorno. 6. RPC en una transacción.
 *
 * Nunca se loguea Authorization ni el JWT: solo códigos, correlation id y
 * versiones. El canal está SIEMPRE abierto aunque el tenant esté suspendido:
 * es justamente por donde MasterAdmin lo reactiva.
 *
 * Portable (sin Deno.*): `platform-provisioning/index.ts` inyecta entorno y cliente.
 */
import { edgeSecurityHeaders } from '../securityHeaders.ts'
import { verifyMasterAdminM2M, type M2MClaims } from '../platformProvisioning/m2m.ts'
import type { LifecycleConfig } from './config.ts'
import {
  isLifecycleErrorCode,
  LIFECYCLE_CONTRACT,
  LIFECYCLE_ERROR_STATUS,
  lifecycleErrorBody,
  type LifecycleErrorCode,
  parseLifecycleCommand,
  UUID_RE,
} from './contract.ts'
import type { LifecycleRepository } from './repository.ts'

/** El cuerpo del contrato cabe de sobra en 16 KB; más que eso no es un PUT de MasterAdmin. */
export const MAX_RAW_BODY_BYTES = 16 * 1024

export interface LifecycleDeps {
  config: LifecycleConfig | null
  publicKey: () => Promise<CryptoKey>
  /** Se invoca SOLO tras validar el M2M. */
  repository: () => LifecycleRepository
  nowSeconds?: () => number
  randomUuid?: () => string
  log?: (event: Record<string, unknown>) => void
}

type Route =
  | { kind: 'put' | 'get'; controlPlaneTenantId: string }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed'; allow: string }

function pathOf(url: string): string {
  return new URL(url).pathname.replace(/^.*?\/platform-provisioning/, '').replace(/\/+$/, '')
}

/** ¿Es una ruta de lifecycle? Las demás siguen yendo a entitlements o a provisioning. */
export function isLifecycleRoute(url: string): boolean {
  return /^\/tenants\/[^/]+\/lifecycle$/.test(pathOf(url))
}

function resolveRoute(method: string, url: string): Route {
  const m = pathOf(url).match(/^\/tenants\/([^/]+)\/lifecycle$/)
  if (!m || !m[1]) return { kind: 'not_found' }
  let id: string
  try {
    id = decodeURIComponent(m[1]).toLowerCase()
  } catch {
    return { kind: 'not_found' }
  }
  if (!UUID_RE.test(id)) return { kind: 'not_found' }
  if (method === 'PUT') return { kind: 'put', controlPlaneTenantId: id }
  if (method === 'GET') return { kind: 'get', controlPlaneTenantId: id }
  return { kind: 'method_not_allowed', allow: 'GET, PUT' }
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

export async function handleLifecycleRequest(req: Request, deps: LifecycleDeps): Promise<Response> {
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const newUuid = deps.randomUuid ?? (() => crypto.randomUUID())
  const log = deps.log ?? (() => {})

  const incoming = req.headers.get('X-Correlation-Id')
  const correlationId = incoming && UUID_RE.test(incoming.toLowerCase()) ? incoming.toLowerCase() : newUuid()

  const fail = (
    code: LifecycleErrorCode,
    extra: { appliedVersion?: number | null } = {},
    headers: Record<string, string> = {},
  ) => {
    log({ event: 'platform_lifecycle.rejected', code, correlationId })
    return respond(LIFECYCLE_ERROR_STATUS[code], lifecycleErrorBody(code, extra), correlationId, headers)
  }

  const route = resolveRoute(req.method, req.url)
  if (route.kind === 'not_found') return fail('NOT_FOUND')
  if (route.kind === 'method_not_allowed') return fail('METHOD_NOT_ALLOWED', {}, { Allow: route.allow })

  const config = deps.config
  if (!config) return fail('LIFECYCLE_NOT_CONFIGURED')

  let publicKey: CryptoKey
  try {
    publicKey = await deps.publicKey()
  } catch {
    return fail('LIFECYCLE_NOT_CONFIGURED')
  }

  const scope = route.kind === 'put' ? config.writeScope : config.readScope
  const auth = await verifyMasterAdminM2M(req.headers.get('Authorization'), config.m2m, publicKey, scope, now())
  if (!auth.ok) {
    if (auth.code === 'MISSING_SCOPE') return fail('INSUFFICIENT_SCOPE')
    if (auth.code === 'M2M_NOT_CONFIGURED') return fail('LIFECYCLE_NOT_CONFIGURED')
    return fail('UNAUTHENTICATED')
  }
  const claims: M2MClaims = auth.claims

  let repository: LifecycleRepository
  try {
    repository = deps.repository()
  } catch {
    return fail('LIFECYCLE_FAILED')
  }

  try {
    const firstUse = await repository.useJti(config.m2m.issuer, claims.jti, new Date(claims.exp * 1000).toISOString())
    if (!firstUse) return fail('JTI_REPLAYED')
  } catch {
    return fail('LIFECYCLE_FAILED')
  }

  const cpt = route.controlPlaneTenantId

  if (route.kind === 'get') {
    try {
      const state = await repository.getApplied(cpt)
      if (!state) return fail('TENANT_NOT_PROVISIONED')
      log({ event: 'platform_lifecycle.read', correlationId, appliedVersion: state.appliedVersion })
      return respond(
        200,
        {
          controlPlaneTenantId: cpt,
          productCode: config.productCode,
          appliedVersion: state.appliedVersion,
          state: state.state,
          reason: state.reason,
          appliedAt: state.appliedAt,
        },
        correlationId,
      )
    } catch {
      return fail('LIFECYCLE_FAILED')
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────────────
  // Todo lo que no es el cuerpo del contrato es «cuerpo inválido» (§4).
  const contentType = (req.headers.get('Content-Type') || '').toLowerCase()
  if (!contentType.startsWith('application/json')) return fail('INVALID_LIFECYCLE')

  const contract = req.headers.get('X-MasterAdmin-Contract')
  if (contract !== null && contract.trim().toLowerCase() !== LIFECYCLE_CONTRACT) return fail('INVALID_LIFECYCLE')

  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_RAW_BODY_BYTES) return fail('INVALID_LIFECYCLE')

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fail('INVALID_LIFECYCLE')
  }

  const parsed = parseLifecycleCommand(body, {
    controlPlaneTenantId: cpt,
    productCode: config.productCode,
    environment: config.environment,
  })
  if (!parsed.ok) return fail(parsed.code)
  const command = parsed.command

  const idempotencyKey = req.headers.get('Idempotency-Key')
  if (idempotencyKey !== null && idempotencyKey !== command.idempotencyKey) return fail('INVALID_LIFECYCLE')

  try {
    const result = await repository.apply(cpt, command, {
      correlationId,
      m2mSubject: claims.sub,
      m2mJti: claims.jti,
      actorId: claims.actorId,
      actorRole: claims.actorRole,
    })
    if (result.httpStatus >= 400) {
      const code = result.body.error
      if (!isLifecycleErrorCode(code)) return fail('LIFECYCLE_FAILED')
      const applied = result.body.appliedVersion
      return fail(code, typeof applied === 'number' ? { appliedVersion: applied } : {})
    }
    const replayed = result.body.replayed === true
    log({
      event: replayed ? 'platform_lifecycle.replayed' : 'platform_lifecycle.applied',
      correlationId,
      appliedVersion: result.body.appliedVersion,
      state: result.body.state,
    })
    return respond(
      200,
      {
        controlPlaneTenantId: cpt,
        productCode: config.productCode,
        appliedVersion: result.body.appliedVersion,
        state: result.body.state,
        reason: result.body.reason ?? null,
        appliedAt: result.body.appliedAt,
        replayed,
      },
      correlationId,
    )
  } catch {
    // La transacción se deshizo entera. El detalle de Postgres no sale.
    return fail('LIFECYCLE_FAILED')
  }
}
