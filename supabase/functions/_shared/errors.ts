/**
 * Errores compartidos por las Edge Functions.
 *
 * Un error de negocio de la base llega como `CODIGO: mensaje` (así los levantan
 * las funciones de `20260827090700_server_operations.sql`). Aquí se traduce a
 * un código HTTP estable, sin filtrar detalle interno de Postgres al cliente.
 */

/**
 * `502`/`503` entran en la lista con el proxy del Platform Context API
 * (P02-SaaS): «el hub no esta configurado» y «el hub no contesta» no son
 * errores de esta app, y devolverlos como 500 haria que el cliente reintentara
 * contra un problema que no se arregla reintentando.
 *
 * `402` entra con el pipeline de checkout (P07-SaaS): «el pago no se autorizo»
 * no es ni un error del cliente (400) ni una falta de permiso (403) ni un fallo
 * de esta app (500). Es el unico codigo que dice lo que de verdad paso, y de el
 * depende que la pantalla ofrezca otro medio de pago en vez de reintentar.
 */
export type ErrorStatus =
  | 400 | 401 | 402 | 403 | 404 | 405 | 409 | 422 | 429 | 500 | 502 | 503

export class AppError extends Error {
  readonly code: string
  readonly status: ErrorStatus

  constructor(code: string, message: string, status: ErrorStatus = 400) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
  }
}

export const badRequest = (code: string, message: string) => new AppError(code, message, 400)
export const unauthorized = (message = 'Credenciales ausentes o invalidas') =>
  new AppError('NO_AUTENTICADO', message, 401)
export const forbidden = (message = 'Sin permiso para esta operacion') =>
  new AppError('SIN_PERMISO', message, 403)
/**
 * 402 — la accion es legitima pero no queda saldo.
 *
 * Separado de 403 a proposito: «no puedes» y «no te queda» llevan a sitios
 * distintos, y devolver 403 por una cuota agotada manda a revisar permisos a
 * quien solo tiene que ampliar el plan.
 */
export const paymentRequired = (code: string, message: string) => new AppError(code, message, 402)
export const notFound = (code: string, message: string) => new AppError(code, message, 404)
export const methodNotAllowed = (method: string) =>
  new AppError('METODO_NO_PERMITIDO', `Metodo ${method} no permitido`, 405)

/** Códigos de negocio que la base levanta y su traducción a HTTP. */
const DB_CODE_STATUS: Record<string, ErrorStatus> = {
  ADMIN_EMAIL_REQUERIDO: 400,
  ADMIN_EMAIL_INVALIDO: 400,
  OWNER_REQUERIDO: 400,
  TENANT_REQUERIDO: 400,
  TENANT_YA_EXISTE: 409,
  TIENDA_NO_DISPONIBLE: 404,
  PRODUCTO_NO_DISPONIBLE: 404,
  STOCK_INSUFICIENTE: 409,
  MONEDA_INCONSISTENTE: 409,
  CANTIDAD_INVALIDA: 400,
  ITEMS_REQUERIDOS: 400,
  ITEMS_EXCESIVOS: 400,
  EMAIL_REQUERIDO: 400,
  CAMPO_NO_PERMITIDO: 400,
  ORDER_TRANSICION_INVALIDA: 409,
  ORDER_IMPORTES_INMUTABLES: 403,
  EBIM_TENANT_REQUERIDO: 400,
}

type PostgrestLike = { message?: string; code?: string; details?: string | null }

/**
 * Traduce un error de PostgREST/Postgres. Lo que no es un código de negocio
 * conocido se degrada a 500 con mensaje genérico: los internos de la base no
 * salen por la API.
 */
export function fromDatabaseError(error: PostgrestLike | null | undefined): AppError {
  const raw = (error?.message ?? '').trim()
  const match = /^([A-Z][A-Z0-9_]{3,60}):\s*(.+)$/s.exec(raw)

  const code = match?.[1]
  const message = match?.[2]
  if (code && message) {
    const status = DB_CODE_STATUS[code]
    if (status) return new AppError(code, message.trim(), status)
  }

  // Violación de RLS o de permiso: el tenant no puede tocar esa fila.
  if (error?.code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return forbidden('La operacion no esta permitida para este tenant')
  }
  if (error?.code === '23505') {
    return new AppError('DUPLICADO', 'Ya existe un registro con esos datos', 409)
  }
  if (error?.code === '23503' || error?.code === '23514') {
    return badRequest('DATOS_INVALIDOS', 'Los datos enviados no cumplen las reglas del catalogo')
  }
  if (error?.code === 'PGRST116') {
    return notFound('NO_ENCONTRADO', 'El recurso no existe o no es visible para este tenant')
  }

  return new AppError('ERROR_INTERNO', 'Error interno', 500)
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error && typeof error === 'object' && 'code' in error) {
    return fromDatabaseError(error as PostgrestLike)
  }
  return new AppError('ERROR_INTERNO', 'Error interno', 500)
}
