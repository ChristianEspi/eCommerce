/**
 * Códigos de error ESTABLES del contrato con MasterAdmin y su status HTTP.
 * Cambiar un código es un cambio de contrato: MasterAdmin decide reintentos con
 * ellos. Son los mismos nombres que eSupplier y eChange, para que la consola
 * lea igual a toda la suite.
 */

export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  INVALID_M2M_TOKEN: 401,
  INVALID_ISSUER: 401,
  INVALID_AUDIENCE: 401,
  MISSING_SCOPE: 403,
  NOT_FOUND: 404,
  PROVISIONING_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  INVALID_REQUEST: 400,
  UNSUPPORTED_CONTRACT_VERSION: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_CONFLICT: 409,
  TENANT_ALREADY_PROVISIONED: 409,
  TENANT_CONFLICT: 409,
  PROVISIONING_FAILED: 500,
  M2M_NOT_CONFIGURED: 503,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

const MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Missing bearer token',
  INVALID_M2M_TOKEN: 'Invalid M2M token',
  INVALID_ISSUER: 'Invalid token issuer',
  INVALID_AUDIENCE: 'Invalid token audience',
  MISSING_SCOPE: 'Token lacks the required scope',
  NOT_FOUND: 'Route not found',
  PROVISIONING_NOT_FOUND: 'No provisioning exists for this controlPlaneTenantId',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key header is required',
  INVALID_IDEMPOTENCY_KEY: 'Idempotency-Key must match ^[A-Za-z0-9._:-]{8,200}$',
  INVALID_REQUEST: 'Request body is invalid',
  UNSUPPORTED_CONTRACT_VERSION: 'Only the MasterAdmin contract v1 is supported',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json',
  PAYLOAD_TOO_LARGE: 'Request body too large',
  IDEMPOTENCY_CONFLICT: 'Idempotency-Key was already used with a different payload',
  TENANT_ALREADY_PROVISIONED: 'This controlPlaneTenantId is already provisioned with the same contract',
  TENANT_CONFLICT: 'Tenant conflicts with an existing eCommerce tenant, company or slug',
  PROVISIONING_FAILED: 'Provisioning failed; no changes were persisted',
  M2M_NOT_CONFIGURED: 'Platform provisioning is not enabled',
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_STATUS, value)
}

/**
 * `code` y `message` también en el nivel superior: MasterAdmin
 * (`normalizeProviderFailure`) lee `body.code` antes que `body.error`.
 */
export function errorBody(code: ErrorCode, correlationId: string, details?: unknown) {
  return {
    code,
    message: MESSAGES[code],
    error: { code, message: MESSAGES[code], ...(details !== undefined ? { details } : {}) },
    correlationId,
  }
}
