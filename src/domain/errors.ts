import type { BoundaryId } from './boundaries'

/**
 * Error de aplicación con un discriminante ESTABLE.
 *
 * El problema que resuelve: hasta P01 había cinco clases de error idénticas
 * (`CatalogError`, `OrderError`, `CheckoutError`, `SettingsError`,
 * `BootstrapError`), cada una con su `code: string`, y la única forma de
 * preguntar «¿esto fue un permiso o un duplicado?» era comparar contra la lista
 * de códigos de esa feature. Un consumidor transversal —un reintento, una
 * bitácora, un `ErrorBoundary`— tenía que conocer las cinco listas o leer el
 * mensaje, que es lo que este proyecto prohíbe desde P02.
 *
 * Ahora la clasificación se hace UNA vez, en `classifyErrorCode`, y el resto de
 * la app se ramifica por `kind`. El `code` se conserva íntegro: es lo que
 * permite diagnosticar sin adivinar, y traducir el mensaje sigue siendo trabajo
 * de cada feature, porque «no encontrado» no se le cuenta igual a un comprador
 * anónimo que a un administrador de catálogo.
 *
 * Lo que este módulo NO hace: leer texto. Interpretar el `message` de Postgres
 * o el cuerpo de una Edge Function es trabajo de infraestructura y vive
 * confinado en `shared/lib/appError.ts` y `shared/lib/edgeError.ts`. Aquí solo
 * llegan códigos ya extraídos.
 */
export const APP_ERROR_KINDS = [
  /** La app no está conectada al backend. No es culpa del usuario ni reintentable. */
  'config',
  /** No hay sesión válida. Se resuelve volviendo a entrar. */
  'unauthorized',
  /** Hay sesión y falta permiso. Volver a entrar no cambia nada. */
  'forbidden',
  /** No existe, o existe y este actor no puede verlo (que se cuenta igual, a propósito). */
  'not_found',
  /** Choca con algo que ya está: duplicado, o estado incompatible con la transición. */
  'conflict',
  /** El servidor rechazó los datos. El usuario puede corregirlos. */
  'invalid',
  /** Demasiadas peticiones. Reintentable con espera. */
  'rate_limited',
  /** El destino no respondió: red, integración caída, disyuntor abierto. Reintentable. */
  'unavailable',
  /** No clasificado. Nunca se asume reintentable. */
  'unknown',
] as const

export type AppErrorKind = (typeof APP_ERROR_KINDS)[number]

/** Códigos que la base y las Edge Functions ya levantan, agrupados por clase. */
const CODE_KINDS: Readonly<Record<string, AppErrorKind>> = {
  // --- configuración local -------------------------------------------------
  CONFIG_INCOMPLETA: 'config',

  // --- identidad y permiso -------------------------------------------------
  NO_AUTENTICADO: 'unauthorized',
  SIN_PERMISO: 'forbidden',
  PROHIBIDO: 'forbidden',
  '42501': 'forbidden',
  // lifecycle.v1: la cuenta está suspendida por EBIM MasterAdmin. Se puede
  // leer; escribir no, y reintentar no lo cambia hasta que se reactive.
  TENANT_SUSPENDED: 'forbidden',
  PT423: 'forbidden',

  // --- ausencia ------------------------------------------------------------
  NO_ENCONTRADO: 'not_found',
  PRODUCTO_NO_ENCONTRADO: 'not_found',
  CATEGORIA_NO_ENCONTRADA: 'not_found',
  IMAGEN_NO_ENCONTRADA: 'not_found',
  TIENDA_NO_ENCONTRADA: 'not_found',
  PEDIDO_NO_ENCONTRADO: 'not_found',
  TIENDA_NO_DISPONIBLE: 'not_found',
  PRODUCTO_NO_DISPONIBLE: 'not_found',
  PGRST116: 'not_found',

  // --- choque con el estado actual ----------------------------------------
  DUPLICADO: 'conflict',
  TENANT_YA_EXISTE: 'conflict',
  ORDER_TRANSICION_INVALIDA: 'conflict',
  ORDER_IMPORTES_INMUTABLES: 'conflict',
  STOCK_INSUFICIENTE: 'conflict',
  SIN_CAMBIOS: 'conflict',
  '23505': 'conflict',

  // --- datos rechazados ----------------------------------------------------
  CAMPO_INVALIDO: 'invalid',
  CAMPO_NO_PERMITIDO: 'invalid',
  DATOS_INVALIDOS: 'invalid',
  TENANT_NO_ADMITIDO: 'invalid',
  ITEMS_REQUERIDOS: 'invalid',
  CANTIDAD_INVALIDA: 'invalid',
  MONEDA_INCONSISTENTE: 'invalid',
  ARCHIVO_INVALIDO: 'invalid',
  ADMIN_EMAIL_INVALIDO: 'invalid',
  ADMIN_EMAIL_REQUERIDO: 'invalid',
  RESPUESTA_INVALIDA: 'invalid',
  '23503': 'invalid',
  '23514': 'invalid',

  // --- ritmo ---------------------------------------------------------------
  DEMASIADAS_PETICIONES: 'rate_limited',
  '429': 'rate_limited',

  // --- el otro lado --------------------------------------------------------
  BACKEND_NO_DISPONIBLE: 'unavailable',
  // La petición no llegó a la función (sin red, DNS, CORS): no hubo respuesta.
  SIN_CONEXION: 'unavailable',
  CIRCUITO_ABIERTO: 'unavailable',
}

/**
 * Clase de un código. Lo desconocido es `unknown` y nunca `unavailable`: dar
 * por reintentable un error que no se entiende es cómo se construye un bucle
 * que machaca al servidor justo cuando peor está.
 */
export function classifyErrorCode(code: string): AppErrorKind {
  return CODE_KINDS[code] ?? 'unknown'
}

/** Solo estas clases se reintentan solas. El resto necesita una decisión. */
const RETRYABLE: ReadonlySet<AppErrorKind> = new Set<AppErrorKind>(['rate_limited', 'unavailable'])

export function isRetryable(kind: AppErrorKind): boolean {
  return RETRYABLE.has(kind)
}

export interface AppErrorInput {
  /** Frontera que levantó el error: da contexto sin obligar a mirar el stack. */
  readonly boundary: BoundaryId
  readonly code: string
  /** Se deriva del código si no se fuerza. */
  readonly kind?: AppErrorKind
  /**
   * Mensaje TÉCNICO, para diagnóstico. Nunca se pinta: el texto que ve el
   * usuario sale de i18n a partir del código.
   */
  readonly message?: string
  readonly cause?: unknown
}

export class AppError extends Error {
  readonly boundary: BoundaryId
  readonly code: string
  readonly kind: AppErrorKind

  constructor(input: AppErrorInput) {
    super(input.message ?? input.code)
    this.name = 'AppError'
    this.boundary = input.boundary
    this.code = input.code
    this.kind = input.kind ?? classifyErrorCode(input.code)
    if (input.cause !== undefined) this.cause = input.cause
  }

  get retryable(): boolean {
    return isRetryable(this.kind)
  }
}

/** `instanceof` no sobrevive a un `structuredClone` ni a dos copias del módulo. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/** Clase de cualquier cosa que se haya capturado, sea o no un `AppError`. */
export function errorKind(value: unknown): AppErrorKind {
  return isAppError(value) ? value.kind : 'unknown'
}
