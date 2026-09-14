/**
 * El error del checkout lleva ETAPA, y por eso se puede auditar.
 *
 * Un 500 con «error interno» en una compra no le dice nada a nadie: ni al
 * comprador, que no sabe si reintentar; ni al comercio, que no sabe si perdió
 * una venta por falta de stock o por un precio mal configurado. Un
 * `CheckoutStageError` sabe **en qué etapa** se cayó, **con qué código de
 * negocio** y **si tiene sentido reintentar**, y esas tres cosas se guardan en
 * `checkout_intents` dentro de la misma llamada.
 *
 * `retryable` no se deduce del status HTTP: `409 STOCK_INSUFICIENTE` no se
 * arregla reintentando —hay que cambiar el carrito— y `503` sí. Deducirlo del
 * status es exactamente cómo se construye un cliente que machaca un servidor
 * caído o que se rinde ante un error pasajero.
 */
import { AppError, type ErrorStatus } from '../errors.ts'
import type { CheckoutStage } from './stages.ts'

export class CheckoutStageError extends AppError {
  readonly stage: CheckoutStage
  readonly retryable: boolean
  /** Lo que hubo que deshacer. Se guarda con el error, no se pierde en un log. */
  readonly compensations: string[]

  constructor(input: {
    stage: CheckoutStage
    code: string
    message: string
    status?: ErrorStatus
    retryable?: boolean
    compensations?: string[]
  }) {
    super(input.code, input.message, input.status ?? statusForCode(input.code))
    this.name = 'CheckoutStageError'
    this.stage = input.stage
    this.retryable = input.retryable ?? isRetryableCode(input.code)
    this.compensations = input.compensations ?? []
  }

  /** Copia con las compensaciones ya ejecutadas anotadas. */
  withCompensations(entries: string[]): CheckoutStageError {
    return new CheckoutStageError({
      stage: this.stage,
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      compensations: entries,
    })
  }
}

/**
 * Códigos que el checkout puede devolver, con su traducción a HTTP.
 *
 * Los de la base llegan como `CODIGO: mensaje` desde las funciones de P02–P07;
 * los que nacen aquí describen el propio pipeline. Lo que no está en la tabla
 * se degrada a 500 y NO se marca reintentable, por la misma regla que
 * `src/domain/errors.ts`: lo desconocido nunca es reintentable.
 */
const STAGE_CODE_STATUS: Record<string, ErrorStatus> = {
  // --- Contexto y canal ---
  TIENDA_NO_DISPONIBLE: 404,
  CANAL_NO_DISPONIBLE: 409,
  CANAL_NO_PUBLICO: 403,
  CANAL_EXIGE_SESION: 401,
  // La tienda no vende a quien no ha entrado. 401 y no 403: falta la sesion,
  // no el permiso — es exactamente el caso en el que el cliente debe mandar a
  // iniciar sesion y reintentar.
  COMPRA_EXIGE_SESION: 401,
  // --- Cliente y cuenta ---
  CUENTA_NO_VINCULADA: 403,
  LIMITE_DE_AUTORIZACION: 403,
  // A1: la cuenta está en retención de crédito. 403 y no 402: no falta un pago
  // que el comprador pueda hacer ahora, falta que quien cobra levante el
  // bloqueo. Por la misma razón NO es reintentable: insistir no lo cambia.
  CREDITO_BLOQUEADO: 403,
  // --- Catálogo y precio ---
  PRODUCTO_NO_DISPONIBLE: 404,
  PRODUCTO_FUERA_DE_CANAL: 409,
  VARIANTE_REQUERIDA: 400,
  VARIANTE_NO_APLICA: 400,
  VARIANTE_NO_DISPONIBLE: 404,
  UOM_NO_DISPONIBLE: 409,
  PRECIO_NO_RESUELTO: 409,
  PRECIO_CAMBIADO: 409,
  MONEDA_INCONSISTENTE: 409,
  // --- Existencia ---
  STOCK_INSUFICIENTE: 409,
  DISPONIBILIDAD_DESCONOCIDA: 503,
  RESERVA_NO_ENCONTRADA: 409,
  RESERVA_NO_VIGENTE: 409,
  CADUCIDAD_INVALIDA: 400,
  // --- Entrega ---
  DIRECCION_NO_ENTREGABLE: 422,
  // N05: le falta (o sobra formato a) la orden de compra que la cuenta exige.
  ORDEN_COMPRA_REQUERIDA: 422,
  ORDEN_COMPRA_INVALIDA: 422,
  // --- Pago ---
  PAGO_RECHAZADO: 402,
  PAGO_NO_DISPONIBLE: 503,
  // --- Pipeline ---
  IDEMPOTENCIA_INVALIDA: 400,
  IDEMPOTENCIA_EN_CONFLICTO: 409,
  CHECKOUT_EN_CURSO: 409,
  INTENTO_NO_VIGENTE: 409,
  INTENTO_NO_ENCONTRADO: 404,
  CARRITO_NO_ENCONTRADO: 404,
  CARRITO_NO_VIGENTE: 409,
  CARRITO_DE_OTRA_TIENDA: 409,
  CARRITO_DE_OTRO_CANAL: 409,
  CARRITO_CON_DUENO: 403,
  LIMITE_DE_PEDIDOS: 429,
  // --- Payload ---
  ITEMS_REQUERIDOS: 400,
  ITEMS_EXCESIVOS: 400,
  CANTIDAD_INVALIDA: 400,
  CAMPO_NO_PERMITIDO: 400,
  CAMPO_INVALIDO: 400,
  EMAIL_REQUERIDO: 400,
}

/**
 * Reintentar tiene sentido cuando el que falló fue el sistema, no la petición.
 * Un carrito sin stock no cambia por insistir; un proveedor caído, sí.
 */
const RETRYABLE_CODES = new Set([
  'DISPONIBILIDAD_DESCONOCIDA',
  'PAGO_NO_DISPONIBLE',
  'CHECKOUT_EN_CURSO',
  'SERVICIO_NO_DISPONIBLE',
])

export function statusForCode(code: string): ErrorStatus {
  return STAGE_CODE_STATUS[code] ?? 500
}

export function isRetryableCode(code: string): boolean {
  return RETRYABLE_CODES.has(code)
}

/** `CODIGO: mensaje` de una función de la base → código y texto separados. */
export function parseDatabaseCode(message: string): { code: string; detail: string } {
  const match = /^([A-Z][A-Z0-9_]{3,60}):\s*(.+)$/s.exec((message ?? '').trim())
  if (match && match[1] && match[2]) return { code: match[1], detail: match[2].trim() }
  return { code: 'ERROR_INTERNO', detail: 'Error interno' }
}

/**
 * Cualquier cosa que reviente dentro de una etapa sale de aquí como un error
 * con etapa. Un `throw` suelto en un adaptador no puede convertirse en un 500
 * sin nombre: el intento tiene que poder decir dónde murió.
 */
export function asStageError(stage: CheckoutStage, error: unknown): CheckoutStageError {
  if (error instanceof CheckoutStageError) return error

  if (error instanceof AppError) {
    return new CheckoutStageError({
      stage,
      code: error.code,
      message: error.message,
      status: error.status,
    })
  }

  const raw = error instanceof Error ? error.message : String(error ?? '')
  const parsed = parseDatabaseCode(raw)
  if (parsed.code !== 'ERROR_INTERNO') {
    return new CheckoutStageError({ stage, code: parsed.code, message: parsed.detail })
  }

  return new CheckoutStageError({
    stage,
    code: 'ERROR_INTERNO',
    message: 'No se pudo completar la compra',
    status: 500,
  })
}
