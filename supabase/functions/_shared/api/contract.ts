/**
 * Contrato de la API empresarial, del lado del borde (P14-SaaS).
 *
 * Es la MISMA lista que `src/domain/api.ts` y que `ebim.api_scope_catalog()`.
 * Está escrita tres veces porque son tres tiempos de ejecución distintos —el
 * navegador, Deno y Postgres— y ninguno puede importar del otro; lo que impide
 * que se separen no es la disciplina sino
 * `supabase/tests/enterprise-api-contract.test.ts`, que compara las tres contra
 * Postgres real. Misma técnica que P01 usó con el vocabulario de operaciones.
 *
 * Aquí no se importa el SDK de Supabase ni se toca `Deno`: es TypeScript puro,
 * como el resto de `_shared`, y por eso el `tsc` y la suite lo compilan sin
 * levantar nada.
 */

/** Versión servida. Va en la RUTA y no en una cabecera que se puede omitir. */
export const API_VERSION = 'v1'

export const API_SCOPES = [
  'order.read',
  'order.create',
  'product.read',
  'stock.read',
  'customer.read',
  'catalog.write',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

export const API_ERROR_CODES = [
  'NO_AUTENTICADO',
  'TOKEN_INVALIDO',
  'TOKEN_EXPIRADO',
  'CREDENCIAL_INVALIDA',
  'SCOPE_INSUFICIENTE',
  'RECURSO_NO_ENCONTRADO',
  'PETICION_INVALIDA',
  'IDEMPOTENCIA_CONFLICTO',
  'IDEMPOTENCIA_EN_CURSO',
  'LIMITE_DE_TASA',
  'VERSION_NO_SOPORTADA',
  'METODO_NO_PERMITIDO',
  'LOTE_DEMASIADO_GRANDE',
  'ERROR_INTERNO',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const CORRELATION_HEADER = 'x-correlation-id'
export const REQUEST_HEADER = 'x-request-id'
export const IDEMPOTENCY_HEADER = 'idempotency-key'
export const RATE_LIMIT_HEADER = 'x-ratelimit-limit'
export const RATE_REMAINING_HEADER = 'x-ratelimit-remaining'

/**
 * Estado HTTP por código canónico.
 *
 * Un mapa y no una cadena de `if`: el socio ramifica por el CÓDIGO y el estado
 * es lo que decide si su cliente HTTP reintenta solo. Equivocarse aquí —un 500
 * donde debía ir un 400— hace que una integración reintente para siempre contra
 * un problema que no se arregla reintentando (la lección que `_shared/errors.ts`
 * ya dejó escrita con el 502/503 del hub).
 */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  NO_AUTENTICADO: 401,
  TOKEN_INVALIDO: 401,
  TOKEN_EXPIRADO: 401,
  CREDENCIAL_INVALIDA: 401,
  SCOPE_INSUFICIENTE: 403,
  RECURSO_NO_ENCONTRADO: 404,
  PETICION_INVALIDA: 400,
  IDEMPOTENCIA_CONFLICTO: 409,
  IDEMPOTENCIA_EN_CURSO: 409,
  LIMITE_DE_TASA: 429,
  VERSION_NO_SOPORTADA: 400,
  METODO_NO_PERMITIDO: 405,
  LOTE_DEMASIADO_GRANDE: 413,
  ERROR_INTERNO: 500,
}

/**
 * Códigos que levanta la BASE traducidos al vocabulario del contrato.
 *
 * Lo que no está en el mapa se degrada a `ERROR_INTERNO` con mensaje genérico:
 * un `PGRST…` o el texto de una violación de restricción llevan dentro nombres
 * de tabla, de columna y de policy, y esto lo lee un tercero.
 */
export const DB_CODE_TO_API: Record<string, ApiErrorCode> = {
  TOKEN_INVALIDO: 'TOKEN_INVALIDO',
  TOKEN_EXPIRADO: 'TOKEN_EXPIRADO',
  CREDENCIAL_INVALIDA: 'CREDENCIAL_INVALIDA',
  SCOPE_INSUFICIENTE: 'SCOPE_INSUFICIENTE',
  LIMITE_DE_TASA: 'LIMITE_DE_TASA',
  IDEMPOTENCIA_CONFLICTO: 'IDEMPOTENCIA_CONFLICTO',
  PEDIDO_NO_ENCONTRADO: 'RECURSO_NO_ENCONTRADO',
  PRODUCTO_NO_DISPONIBLE: 'RECURSO_NO_ENCONTRADO',
  TIENDA_NO_DISPONIBLE: 'RECURSO_NO_ENCONTRADO',
  CREDENCIAL_NO_ENCONTRADA: 'RECURSO_NO_ENCONTRADO',
  TIENDA_REQUERIDA: 'PETICION_INVALIDA',
  SKU_REQUERIDO: 'PETICION_INVALIDA',
  ITEMS_REQUERIDOS: 'PETICION_INVALIDA',
  ITEMS_EXCESIVOS: 'PETICION_INVALIDA',
  CANTIDAD_INVALIDA: 'PETICION_INVALIDA',
  EMAIL_REQUERIDO: 'PETICION_INVALIDA',
  CAMPO_NO_PERMITIDO: 'PETICION_INVALIDA',
  STOCK_INSUFICIENTE: 'PETICION_INVALIDA',
  MONEDA_INCONSISTENTE: 'PETICION_INVALIDA',
  LIMITE_DE_PEDIDOS: 'LIMITE_DE_TASA',
  SIN_MODULO: 'SCOPE_INSUFICIENTE',
  SIN_PERMISO: 'SCOPE_INSUFICIENTE',
  LOTE_INVALIDO: 'PETICION_INVALIDA',
  LOTE_EXCESIVO: 'LOTE_DEMASIADO_GRANDE',
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode
    readonly message: string
    readonly status: number
    readonly correlation_id: string
    readonly request_id: string
  }
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = API_ERROR_STATUS[code]
  }
}

/** `CODIGO: mensaje`, la forma en que esta base levanta sus errores de negocio. */
const DB_ERROR_RE = /^([A-Z][A-Z0-9_]{3,60}):\s*(.+)$/s

/**
 * Traduce lo que venga —un `ApiError`, un error de PostgREST, cualquier cosa—
 * al vocabulario del contrato. Lo desconocido nunca sale con su texto original.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  const raw =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : ''
  const match = DB_ERROR_RE.exec(raw.trim())
  const dbCode = match?.[1]
  const mapped = dbCode ? DB_CODE_TO_API[dbCode] : undefined

  if (mapped && match?.[2]) return new ApiError(mapped, match[2].trim())
  return new ApiError('ERROR_INTERNO', 'Error interno')
}
