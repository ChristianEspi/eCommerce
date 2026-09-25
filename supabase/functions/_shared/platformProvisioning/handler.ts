/**
 * Orquestación HTTP de `platform-provisioning` (EBIM MasterAdmin → eCommerce,
 * contrato GENERIC v1).
 *
 *   POST /platform-provisioning/tenants                          scope ecommerce:tenant:create
 *   GET  /platform-provisioning/tenants/{controlPlaneTenantId}   scope ecommerce:tenant:read
 *   GET  /platform-provisioning/health                           sin autenticación
 *
 * Orden de cada petición (importa):
 *   1. Ruta y método — estático, no revela nada.
 *   2. Configuración M2M — sin ella, 503 fail-closed.
 *   3. JWT M2M con el scope de la ruta.
 *   4. SOLO ENTONCES se crea el repositorio (cliente con service-role).
 *   5. Headers de negocio, cuerpo, validación, RPC, auditoría, respuesta.
 *
 * Nunca se loguea Authorization, el JWT, la service-role ni el cuerpo: solo
 * códigos, correlation id e identificadores ya verificados. `actor_id` y
 * `actor_role` se guardan para auditoría y NO autorizan nada.
 *
 * Portable (sin Deno.*): `platform-provisioning/index.ts` inyecta entorno,
 * reloj y cliente.
 */
import {
  buildCommand,
  CONTRACT_VERSION,
  type CreateTenantCommand,
  type DeriveInternalIds,
  deriveInternalIds,
  hashCommand,
  IDEMPOTENCY_KEY_RE,
  isUuid,
  parseGenericCreateRequest,
} from './contract.ts'
import { edgeSecurityHeaders } from '../securityHeaders.ts'
import { type ErrorCode, ERROR_STATUS, errorBody, isErrorCode } from './errors.ts'
import { type M2MClaims, type M2MConfig, verifyMasterAdminM2M } from './m2m.ts'
import type { AuditEntry, ProvisioningRecord, ProvisioningRepository } from './repository.ts'

export const MAX_BODY_BYTES = 64 * 1024

export interface HandlerDeps {
  /** null = no configurado (fail-closed). */
  config: M2MConfig | null
  /** Clave pública ya importada; se resuelve una vez por instancia. */
  publicKey: () => Promise<CryptoKey>
  /** Se invoca SOLO tras validar el M2M. Es quien crea el cliente con service-role. */
  repository: () => ProvisioningRepository
  nowSeconds?: () => number
  randomUuid?: () => string
  log?: (event: Record<string, unknown>) => void
  /** Ids internos. Por defecto, UUIDv5 de `contract.ts`. */
  deriveInternalIds?: DeriveInternalIds
}

type Route =
  | { kind: 'health' }
  | { kind: 'create' }
  | { kind: 'get'; controlPlaneTenantId: string }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed'; allow: string }

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment // `%` malformado: no es un UUID y la validación lo rechaza.
  }
}

export function resolveRoute(method: string, url: string): Route {
  const path = new URL(url).pathname.replace(/^.*?\/platform-provisioning/, '').replace(/\/+$/, '')
  if (path === '/health') {
    return method === 'GET' ? { kind: 'health' } : { kind: 'method_not_allowed', allow: 'GET' }
  }
  if (path === '/tenants') {
    return method === 'POST' ? { kind: 'create' } : { kind: 'method_not_allowed', allow: 'POST' }
  }
  const m = path.match(/^\/tenants\/([^/]+)$/)
  if (m && m[1]) {
    return method === 'GET'
      ? { kind: 'get', controlPlaneTenantId: safeDecode(m[1]) }
      : { kind: 'method_not_allowed', allow: 'GET' }
  }
  return { kind: 'not_found' }
}

function respond(
  status: number,
  body: unknown,
  correlationId: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      // Las cabeceras de seguridad del borde (no-store, nosniff, CSP vacía…).
      ...edgeSecurityHeaders(),
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      ...extra,
    },
  })
}

/** `requestHash` es interno: sirve para diagnosticar un 409, no es contrato. */
function publicRecord(record: ProvisioningRecord): Omit<ProvisioningRecord, 'requestHash'> {
  const copy: Partial<ProvisioningRecord> = { ...record }
  delete copy.requestHash
  return copy as Omit<ProvisioningRecord, 'requestHash'>
}

export async function handleProvisioningRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const newUuid = deps.randomUuid ?? (() => crypto.randomUUID())
  const log = deps.log ?? (() => {})

  // El correlation id del llamante se acepta solo si es un UUID: nunca se
  // refleja texto arbitrario en logs ni en la bitácora.
  const incomingCorrelation = req.headers.get('X-Correlation-Id')
  const correlationId =
    incomingCorrelation && isUuid(incomingCorrelation) ? incomingCorrelation.toLowerCase() : newUuid()

  const fail = (code: ErrorCode, details?: unknown, extra?: Record<string, string>) => {
    log({ event: 'platform_provisioning.rejected', code, correlationId })
    return respond(ERROR_STATUS[code], errorBody(code, correlationId, details), correlationId, extra)
  }

  const route = resolveRoute(req.method, req.url)
  if (route.kind === 'not_found') return fail('NOT_FOUND')
  if (route.kind === 'method_not_allowed') {
    return fail('METHOD_NOT_ALLOWED', undefined, { Allow: route.allow })
  }
  if (route.kind === 'health') return health(deps, correlationId)

  const operation = route.kind === 'create' ? 'CREATE_TENANT' : 'GET_TENANT_STATUS'
  const config = deps.config
  if (!config) return fail('M2M_NOT_CONFIGURED')

  let publicKey: CryptoKey
  try {
    publicKey = await deps.publicKey()
  } catch {
    // Clave mal cargada: es configuración, no culpa del llamante.
    return fail('M2M_NOT_CONFIGURED')
  }

  const requiredScope = route.kind === 'create' ? config.createScope : config.readScope
  const auth = await verifyMasterAdminM2M(
    req.headers.get('Authorization'),
    config,
    publicKey,
    requiredScope,
    now(),
  )

  if (!auth.ok) {
    // Scope insuficiente con firma válida: se audita. Un token inválido NO se persiste.
    const auditRepo = auth.code === 'MISSING_SCOPE' && auth.claims ? tryRepository(deps) : null
    if (auth.code === 'MISSING_SCOPE' && auth.claims && auditRepo) {
      await safeAudit(auditRepo, log, {
        operation,
        result: 'REJECTED',
        errorCode: 'MISSING_SCOPE',
        httpStatus: 403,
        controlPlaneTenantId:
          route.kind === 'get' && isUuid(route.controlPlaneTenantId)
            ? route.controlPlaneTenantId.toLowerCase()
            : null,
        ...auditIdentity(auth.claims, correlationId),
      })
    }
    return fail(auth.code)
  }

  const claims = auth.claims
  const repository = tryRepository(deps)
  // Sin cliente de servidor (secretos de Supabase ausentes) no hay nada que
  // hacer ni donde auditarlo: 500 estable, sin detalle.
  if (!repository) return fail('PROVISIONING_FAILED')
  const identity = auditIdentity(claims, correlationId)

  const rejectAudited = async (code: ErrorCode, extra: Partial<AuditEntry> = {}, details?: unknown) => {
    await safeAudit(repository, log, {
      operation,
      result: code === 'PROVISIONING_FAILED' ? 'ERROR' : 'REJECTED',
      errorCode: code,
      httpStatus: ERROR_STATUS[code],
      ...identity,
      ...extra,
    })
    return fail(code, details)
  }

  if (route.kind === 'get') {
    if (!isUuid(route.controlPlaneTenantId)) {
      return rejectAudited('INVALID_REQUEST', {}, [
        { field: 'controlPlaneTenantId', issue: 'must be a UUID' },
      ])
    }
    const cpt = route.controlPlaneTenantId.toLowerCase()
    try {
      const record = await repository.getProvisioning(cpt)
      if (!record) return rejectAudited('PROVISIONING_NOT_FOUND', { controlPlaneTenantId: cpt })
      await safeAudit(repository, log, {
        operation,
        result: 'FOUND',
        httpStatus: 200,
        provisioningId: record.provisioningId,
        controlPlaneTenantId: cpt,
        ...identity,
      })
      log({ event: 'platform_provisioning.read', correlationId, provisioningId: record.provisioningId })
      return respond(200, { ...publicRecord(record), correlationId }, correlationId)
    } catch {
      return rejectAudited('PROVISIONING_FAILED', { controlPlaneTenantId: cpt })
    }
  }

  // ── CREATE ────────────────────────────────────────────────────────────────
  const idempotencyKey = req.headers.get('Idempotency-Key')
  if (!idempotencyKey) return rejectAudited('IDEMPOTENCY_KEY_REQUIRED')
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) return rejectAudited('INVALID_IDEMPOTENCY_KEY')

  // MasterAdmin manda `x-masteradmin-contract: v1`. Ausente se tolera (un
  // cliente de pruebas); presente y distinto es otro contrato.
  const contract = req.headers.get('X-MasterAdmin-Contract')
  if (contract !== null && contract.trim().toLowerCase() !== CONTRACT_VERSION) {
    return rejectAudited('UNSUPPORTED_CONTRACT_VERSION', { idempotencyKey })
  }

  const contentType = (req.headers.get('Content-Type') || '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    return rejectAudited('UNSUPPORTED_MEDIA_TYPE', { idempotencyKey })
  }

  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return rejectAudited('PAYLOAD_TOO_LARGE', { idempotencyKey })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return rejectAudited('INVALID_REQUEST', { idempotencyKey }, [{ field: '$', issue: 'malformed JSON' }])
  }

  const parsed = parseGenericCreateRequest(body)
  if (!parsed.ok) return rejectAudited('INVALID_REQUEST', { idempotencyKey }, parsed.errors)

  let command: CreateTenantCommand
  try {
    const ids = await (deps.deriveInternalIds ?? deriveInternalIds)(parsed.draft.controlPlaneTenantId)
    command = buildCommand(parsed.draft, ids)
  } catch {
    // Colisión de ids internos: no se llama a la RPC.
    return rejectAudited('PROVISIONING_FAILED', { idempotencyKey })
  }
  const requestHash = await hashCommand(command)

  try {
    const result = await repository.provisionTenant(command, parsed.draft.context, {
      idempotencyKey,
      requestHash,
      correlationId,
      m2mSubject: claims.sub,
      m2mJti: claims.jti,
      actorId: claims.actorId,
      actorRole: claims.actorRole,
    })

    // La RPC ya auditó CREATED / REPLAYED / CONFLICT dentro de su transacción.
    if (result.outcome === 'CONFLICT') {
      const code: ErrorCode = isErrorCode(result.errorCode) ? result.errorCode : 'TENANT_CONFLICT'
      return fail(code, result.provisioningId ? { provisioningId: result.provisioningId } : undefined)
    }

    const replayed = result.outcome === 'REPLAYED'
    log({
      event: replayed ? 'platform_provisioning.replayed' : 'platform_provisioning.created',
      correlationId,
      provisioningId: result.provisioning.provisioningId,
    })
    return respond(
      replayed ? 200 : 201,
      { ...publicRecord(result.provisioning), replayed, correlationId },
      correlationId,
    )
  } catch {
    // La transacción se deshizo entera. El detalle de Postgres no sale.
    return rejectAudited('PROVISIONING_FAILED', {
      idempotencyKey,
      controlPlaneTenantId: command.controlPlaneTenantId,
    })
  }
}

/**
 * Health para CHECK_HEALTH de MasterAdmin. Sin autenticación y con cuerpo FIJO:
 * ni project ref, ni secretos, ni configuración. Nunca crea el repositorio.
 */
async function health(deps: HandlerDeps, correlationId: string): Promise<Response> {
  if (!deps.config) return respond(503, { status: 'unavailable' }, correlationId)
  try {
    await deps.publicKey()
  } catch {
    return respond(503, { status: 'unavailable' }, correlationId)
  }
  return respond(200, { status: 'ok' }, correlationId)
}

function tryRepository(deps: HandlerDeps): ProvisioningRepository | null {
  try {
    return deps.repository()
  } catch {
    return null
  }
}

function auditIdentity(claims: M2MClaims, correlationId: string) {
  return {
    correlationId,
    m2mSubject: claims.sub,
    m2mJti: claims.jti,
    actorId: claims.actorId,
    actorRole: claims.actorRole,
  }
}

async function safeAudit(
  repository: ProvisioningRepository,
  log: (event: Record<string, unknown>) => void,
  entry: AuditEntry,
) {
  try {
    await repository.recordAudit(entry)
  } catch {
    // Un fallo de auditoría no cambia la respuesta, pero queda visible en los logs.
    log({ event: 'platform_provisioning.audit_failed', correlationId: entry.correlationId })
  }
}
