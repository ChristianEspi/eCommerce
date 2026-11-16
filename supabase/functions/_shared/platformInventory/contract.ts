/**
 * Contrato `tenant-inventory.v1` (EBIM MasterAdmin → eCommerce) — parte pura:
 * códigos de error y su status, cursor opaco y forma del cuerpo del vínculo.
 * Sin `Deno.*` ni red: lo ejercitan los tests contra el handler real.
 *
 * Formato de error: `{error: "<CODIGO>", message}` (MasterAdmin lee `body.error`).
 */

export const INVENTORY_CONTRACT = 'tenant-inventory.v1'

export type InventoryEnvironment = 'DEV' | 'QAS' | 'DEMO' | 'PRD'
export type InventoryStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'

export const DEFAULT_LIMIT = 200
export const MAX_LIMIT = 500

export const INVENTORY_ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  JTI_REPLAYED: 401,
  INSUFFICIENT_SCOPE: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INVALID_INVENTORY_QUERY: 400,
  INVENTORY_FAILED: 500,
  INVENTORY_NOT_CONFIGURED: 503,
  INVALID_LINK_REQUEST: 400,
  EXTERNAL_TENANT_NOT_FOUND: 404,
  LINK_CONFLICT: 409,
  TENANT_LINK_FAILED: 500,
  TENANT_LINK_NOT_CONFIGURED: 503,
} as const

export type InventoryErrorCode = keyof typeof INVENTORY_ERROR_STATUS

const MESSAGES: Record<InventoryErrorCode, string> = {
  UNAUTHENTICATED: 'Missing or invalid M2M token',
  JTI_REPLAYED: 'Token jti already used',
  INSUFFICIENT_SCOPE: 'Token lacks the required scope',
  NOT_FOUND: 'Route not found',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  INVALID_INVENTORY_QUERY: 'limit must be 1..500 and cursor a value returned by this endpoint',
  INVENTORY_FAILED: 'Inventory could not be read',
  INVENTORY_NOT_CONFIGURED: 'Tenant inventory channel is not enabled',
  INVALID_LINK_REQUEST: 'Body does not satisfy the tenant link request',
  EXTERNAL_TENANT_NOT_FOUND: 'externalTenantId does not exist in this application',
  LINK_CONFLICT: 'Tenant or controlPlaneTenantId is already linked to another one',
  TENANT_LINK_FAILED: 'Tenant could not be linked; nothing changed',
  TENANT_LINK_NOT_CONFIGURED: 'Tenant link channel is not enabled',
}

export function isInventoryErrorCode(value: unknown): value is InventoryErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INVENTORY_ERROR_STATUS, value)
}

/** Cuerpo de error. Nunca repite lo recibido. */
export function inventoryErrorBody(code: InventoryErrorCode) {
  return { error: code, message: MESSAGES[code] }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── Cursor opaco: base64url de `inv1:<organization_id>` (keyset por id) ──────
const CURSOR_PREFIX = 'inv1:'

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function encodeCursor(lastExternalTenantId: string): string {
  return toBase64Url(CURSOR_PREFIX + lastExternalTenantId.toLowerCase())
}

/** El id tras el que sigue la página; null = cursor inválido. */
export function decodeCursor(cursor: string): string | null {
  if (cursor.length === 0 || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null
  let text: string
  try {
    const pad = cursor.length % 4 === 0 ? '' : '='.repeat(4 - (cursor.length % 4))
    text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/') + pad)
  } catch {
    return null
  }
  if (!text.startsWith(CURSOR_PREFIX)) return null
  const id = text.slice(CURSOR_PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

export type InventoryQuery = { after: string | null; limit: number }

/** `?limit=1..500&cursor=<opaco>`; otros parámetros se ignoran. */
export function parseInventoryQuery(url: string): InventoryQuery | null {
  const params = new URL(url).searchParams
  if (params.getAll('limit').length > 1 || params.getAll('cursor').length > 1) return null

  let limit = DEFAULT_LIMIT
  const rawLimit = params.get('limit')
  if (rawLimit !== null) {
    if (!/^\d{1,4}$/.test(rawLimit)) return null
    limit = Number(rawLimit)
    if (limit < 1 || limit > MAX_LIMIT) return null
  }

  const rawCursor = params.get('cursor')
  if (rawCursor === null) return { after: null, limit }
  const after = decodeCursor(rawCursor)
  return after ? { after, limit } : null
}

export interface LinkCommand {
  externalTenantId: string
  requestId: string
}

/**
 * `{"externalTenantId":"<uuid>","requestId":"<uuid>"}`. En eCommerce el tenant
 * es la organización: su id es un UUID. Campos adicionales se toleran, salvo
 * los del propio contrato con otro valor (contract, controlPlaneTenantId,
 * productCode, environment).
 */
export function parseLinkCommand(
  body: unknown,
  expected: { controlPlaneTenantId: string; productCode: string; environment: InventoryEnvironment },
): LinkCommand | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  const ext = typeof b.externalTenantId === 'string' ? b.externalTenantId.trim().toLowerCase() : ''
  const requestId = typeof b.requestId === 'string' ? b.requestId.trim().toLowerCase() : ''
  if (!UUID_RE.test(ext) || !UUID_RE.test(requestId)) return null

  if (b.contract !== undefined && b.contract !== INVENTORY_CONTRACT) return null
  if (
    b.controlPlaneTenantId !== undefined &&
    (typeof b.controlPlaneTenantId !== 'string' || b.controlPlaneTenantId.toLowerCase() !== expected.controlPlaneTenantId)
  ) {
    return null
  }
  if (b.productCode !== undefined && b.productCode !== expected.productCode) return null
  if (b.environment !== undefined && b.environment !== expected.environment) return null

  return { externalTenantId: ext, requestId }
}
