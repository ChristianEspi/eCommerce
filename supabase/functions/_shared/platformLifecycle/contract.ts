/**
 * Contrato `lifecycle.v1` (EBIM MasterAdmin → eCommerce) — parte pura.
 *
 * Forma del cuerpo del PUT, códigos de error y su status HTTP. Sin `Deno.*` ni
 * red: lo ejercitan los tests contra el handler real.
 *
 * Formato de error del contrato: `{error: "<CODIGO>", message, appliedVersion?}`
 * (MasterAdmin lee `body.error` como cadena, igual que en entitlements).
 */

export const LIFECYCLE_CONTRACT = 'lifecycle.v1'

export type LifecycleEnvironment = 'DEV' | 'QAS' | 'DEMO' | 'PRD'
export type LifecycleState = 'ACTIVE' | 'SUSPENDED'
export type LifecycleReason = 'NON_PAYMENT' | 'MANUAL' | 'TERMINATED'

export const LIFECYCLE_STATES: readonly LifecycleState[] = ['ACTIVE', 'SUSPENDED']
export const LIFECYCLE_REASONS: readonly LifecycleReason[] = ['NON_PAYMENT', 'MANUAL', 'TERMINATED']
const ENVIRONMENTS: readonly LifecycleEnvironment[] = ['DEV', 'QAS', 'DEMO', 'PRD']

export interface LifecycleCommand {
  contract: typeof LIFECYCLE_CONTRACT
  controlPlaneTenantId: string
  productCode: string
  environment: LifecycleEnvironment
  version: number
  state: LifecycleState
  reason: LifecycleReason | null
  effectiveAt: string
  idempotencyKey: string
  correlationId: string
}

export const LIFECYCLE_ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  JTI_REPLAYED: 401,
  INSUFFICIENT_SCOPE: 403,
  NOT_FOUND: 404,
  TENANT_NOT_PROVISIONED: 404,
  METHOD_NOT_ALLOWED: 405,
  STALE_LIFECYCLE: 409,
  VERSION_CONFLICT: 409,
  INVALID_LIFECYCLE: 400,
  PRODUCT_MISMATCH: 400,
  WRONG_ENVIRONMENT: 400,
  LIFECYCLE_FAILED: 500,
  LIFECYCLE_NOT_CONFIGURED: 503,
} as const

export type LifecycleErrorCode = keyof typeof LIFECYCLE_ERROR_STATUS

const MESSAGES: Record<LifecycleErrorCode, string> = {
  UNAUTHENTICATED: 'Missing or invalid M2M token',
  JTI_REPLAYED: 'Token jti already used',
  INSUFFICIENT_SCOPE: 'Token lacks the required lifecycle scope',
  NOT_FOUND: 'Route not found',
  TENANT_NOT_PROVISIONED: 'Tenant has no local provisioning',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  STALE_LIFECYCLE: 'Lifecycle version is older than the applied one',
  VERSION_CONFLICT: 'Same lifecycle version with a different state',
  INVALID_LIFECYCLE: 'Body does not satisfy lifecycle.v1',
  PRODUCT_MISMATCH: 'productCode is not this application',
  WRONG_ENVIRONMENT: 'environment differs from this receiver',
  LIFECYCLE_FAILED: 'Lifecycle could not be applied; nothing changed',
  LIFECYCLE_NOT_CONFIGURED: 'Lifecycle channel is not enabled',
}

export function isLifecycleErrorCode(value: unknown): value is LifecycleErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIFECYCLE_ERROR_STATUS, value)
}

/** Cuerpo de error del contrato. Nunca repite lo recibido. */
export function lifecycleErrorBody(code: LifecycleErrorCode, extra: { appliedVersion?: number | null } = {}) {
  return { error: code, message: MESSAGES[code], ...extra }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** ISO-8601 CON zona (Z u offset). La app aplica al recibir: es informativo. */
const ISO_ZONED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/
const KEYS = [
  'contract', 'controlPlaneTenantId', 'productCode', 'environment', 'version', 'state', 'reason', 'effectiveAt',
  'idempotencyKey', 'correlationId',
].sort()
const MAX_VERSION = 2_147_483_647

export type ParseResult =
  | { ok: true; command: LifecycleCommand }
  | { ok: false; code: 'INVALID_LIFECYCLE' | 'PRODUCT_MISMATCH' | 'WRONG_ENVIRONMENT' }

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}

/**
 * Valida el cuerpo del PUT contra el contrato y contra ESTE receptor.
 * Orden: forma (INVALID_LIFECYCLE) → tenant de la ruta → producto
 * (PRODUCT_MISMATCH) → entorno (WRONG_ENVIRONMENT).
 */
export function parseLifecycleCommand(
  body: unknown,
  expected: { controlPlaneTenantId: string; productCode: string; environment: LifecycleEnvironment },
): ParseResult {
  const invalid = { ok: false, code: 'INVALID_LIFECYCLE' } as const
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return invalid
  const d = body as Record<string, unknown>
  // Campos desconocidos (o ausentes) → INVALID_LIFECYCLE.
  if (JSON.stringify(Object.keys(d).sort()) !== JSON.stringify(KEYS)) return invalid

  const state = d.state as LifecycleState
  const reason = d.reason as LifecycleReason | null
  const shapeOk =
    d.contract === LIFECYCLE_CONTRACT &&
    typeof d.controlPlaneTenantId === 'string' && UUID_RE.test(d.controlPlaneTenantId.toLowerCase()) &&
    typeof d.productCode === 'string' && /^[a-z0-9]+$/.test(d.productCode) &&
    typeof d.environment === 'string' && ENVIRONMENTS.includes(d.environment as LifecycleEnvironment) &&
    typeof d.version === 'number' && Number.isInteger(d.version) && d.version >= 1 && d.version <= MAX_VERSION &&
    LIFECYCLE_STATES.includes(state) &&
    ((state === 'ACTIVE' && reason === null) ||
      (state === 'SUSPENDED' && typeof reason === 'string' && LIFECYCLE_REASONS.includes(reason))) &&
    typeof d.effectiveAt === 'string' && ISO_ZONED_RE.test(d.effectiveAt) && !Number.isNaN(Date.parse(d.effectiveAt)) &&
    boundedText(d.idempotencyKey) &&
    boundedText(d.correlationId)
  if (!shapeOk) return invalid

  // El tenant del cuerpo es el de la ruta: un cuerpo de otro tenant no se aplica.
  if ((d.controlPlaneTenantId as string).toLowerCase() !== expected.controlPlaneTenantId) return invalid
  if (d.productCode !== expected.productCode) return { ok: false, code: 'PRODUCT_MISMATCH' }
  if (d.environment !== expected.environment) return { ok: false, code: 'WRONG_ENVIRONMENT' }

  return {
    ok: true,
    command: {
      contract: LIFECYCLE_CONTRACT,
      controlPlaneTenantId: expected.controlPlaneTenantId,
      productCode: d.productCode as string,
      environment: d.environment as LifecycleEnvironment,
      version: d.version as number,
      state,
      reason: state === 'ACTIVE' ? null : reason,
      effectiveAt: d.effectiveAt as string,
      idempotencyKey: d.idempotencyKey as string,
      correlationId: d.correlationId as string,
    },
  }
}
