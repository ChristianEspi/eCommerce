/**
 * `PaymentProvider` — el contrato canónico de una pasarela (P09-SaaS).
 *
 * Es la versión de servidor de `src/domain/ports/payment.ts`: el mismo
 * contrato, escrito donde de verdad se ejecuta. El del navegador describe la
 * frontera para el mapa de dominios; este la implementa.
 *
 * ## Lo que este archivo decide, y cuesta caro revertir
 *
 * 1. **Las capacidades son datos, no `typeof provider.capture === 'function'`.**
 *    El encargo lo pide literal: «no todos los providers deben implementar
 *    todos los modos; expresa capabilities explícitamente». Una pasarela que
 *    cobra en un paso declara `capture: false` y quien la usa lo sabe *antes*
 *    de llamarla, no por un `TypeError` a mitad de un cobro.
 * 2. **Los importes viajan como TEXTO decimal.** `12.30` en `number` es
 *    `12.299999999999999`. Nunca un `number` en la ruta del dinero: es la misma
 *    regla que P04 impuso en el motor de precios y por la misma razón.
 * 3. **Aquí no entra una tarjeta.** El contrato mueve referencias del
 *    proveedor, importes y códigos de resultado. Ni PAN, ni CVV, ni token de
 *    tarjeta: PCI por delegación significa que el dato sensible nunca toca este
 *    proceso, y `ebim.jsonb_is_card_safe` lo comprueba del lado de la base.
 * 4. **Ninguna marca en un tipo.** El nombre de la pasarela vive en el `code`
 *    de `integration_providers`, que es una fila. Un `type Provider = 'bcp' |
 *    ...` obligaría a desplegar la app para dar de alta un banco.
 * 5. **`timeout` es un resultado de primera clase.** No es un `failed` con otro
 *    texto: un tiempo agotado NO dice que no se cobró, dice que no se sabe, y
 *    de esa diferencia depende si se reintenta o si se consulta el estado. La
 *    base tiene el mismo valor en `payment_attempt_status`.
 */

/** Operaciones canónicas. Mismo vocabulario que `integration_providers.capabilities`. */
export type PaymentOperation = 'authorize' | 'capture' | 'cancel' | 'refund' | 'status' | 'webhook'

/**
 * Qué sabe hacer esta pasarela. Se declara entera y explícita: un `false` es
 * información —«esta pasarela captura sola»— y no una carencia.
 */
export interface PaymentProviderCapabilities {
  readonly authorize: boolean
  /** Captura separada de la autorización. `false` = cobra en un solo paso. */
  readonly capture: boolean
  /** Anular una autorización no capturada. */
  readonly cancel: boolean
  readonly refund: boolean
  /** Consultar el estado por referencia. Es lo que salva un `timeout`. */
  readonly status: boolean
  /** Avisa por webhook firmado. */
  readonly webhook: boolean
}

/**
 * Resultado de una llamada, en el vocabulario del dominio.
 *
 * `requires_action` es 3DS o cualquier paso que obligue al comprador a salir de
 * la tienda. No es éxito ni fallo: es «todavía no».
 */
export type PaymentResultStatus =
  | 'authorized'
  | 'captured'
  | 'requires_action'
  | 'cancelled'
  | 'declined'
  | 'failed'
  | 'timeout'

export interface PaymentAuthorizeInput {
  /** Identificador del intento en ESTE sistema, no en la pasarela. */
  readonly intentId: string
  /**
   * El instrumento, ya TOKENIZADO por la pasarela en el navegador.
   *
   * Nunca es un numero de tarjeta: es lo que la pasarela devuelve a cambio
   * de uno, dentro de su propio iframe. Esa es la razon de que exista este
   * campo y no un `cardNumber` — con el numero aqui, todo el servidor
   * entraria en el alcance de PCI; con el token, ninguno.
   *
   * `null` para los medios que no tokenizan nada: transferencia, efectivo,
   * o una pasarela alojada que devuelve `requires_action` y cobra fuera.
   */
  readonly providerToken?: string | null
  /** Decimal como texto. Nunca `number`. */
  readonly amount: string
  readonly currency: string
  /** Misma petición, misma clave, un solo cargo. Viaja hasta la pasarela. */
  readonly idempotencyKey: string
  readonly customerEmail: string
  /** Lo compone el servidor, nunca el navegador. */
  readonly returnUrl?: string | null
}

export interface PaymentReferenceInput {
  readonly intentId: string
  readonly providerReference: string
  readonly amount: string
  readonly currency: string
  readonly idempotencyKey: string
}

export interface PaymentResult {
  readonly status: PaymentResultStatus
  /** Cómo se llama esto del lado de la pasarela. Es lo que se cita al conciliar. */
  readonly providerReference: string | null
  /** Código del proveedor tal cual, SIN traducir. El texto del comprador es i18n. */
  readonly resultCode: string | null
  readonly errorCode: string | null
  readonly errorDetail: string | null
  /** A dónde redirigir si la pasarela exige pasar por su página. */
  readonly redirectUrl: string | null
  readonly amount: string
}

/**
 * Aviso entrante ya VERIFICADO. `verifyWebhook` devuelve esto o `null`; si
 * devuelve `null`, quien llama descarta y **no reintenta**: un sobre con firma
 * inválida no mejora al repetirlo.
 */
export interface PaymentWebhookEvent {
  /** Identificador del evento del lado del proveedor. Ancla la deduplicación. */
  readonly externalEventId: string
  readonly providerReference: string
  /** Vocabulario del proveedor, sin normalizar. Se guarda para diagnosticar. */
  readonly eventType: string
  /**
   * `informational` es de primera clase: una pasarela avisa de muchas cosas que
   * no mueven dinero, y traducirlas a `failed` para tener un valor que poner
   * marcaría como fallido un cobro que va bien.
   */
  readonly status: PaymentResultStatus | 'refunded' | 'informational'
  readonly amount: string | null
  readonly currency: string | null
  readonly payload: Record<string, unknown>
}

/**
 * Los cuatro métodos de dinero son OPCIONALES y las capacidades dicen cuáles
 * hay. `requireOperation` es la única forma correcta de llamarlos: convierte
 * «este método no existe» en un error de dominio con código, no en un fallo de
 * tipo a medio cobro.
 */
export interface PaymentProvider {
  /** Código en `integration_providers`. Un dato del catálogo, no una marca. */
  readonly code: string
  readonly capabilities: PaymentProviderCapabilities
  /**
   * `true` si este adaptador, tal como se construyó, NO mueve dinero real: el
   * `sandbox` siempre, y una pasarela real sin credencial. La pasarela
   * (`gateway.ts`) no le deja cobrar salvo que el despliegue lo permita
   * expresamente: un secreto olvidado en producción no puede convertirse en
   * pedidos pagados sin dinero.
   */
  readonly simulated?: boolean
  authorize?(input: PaymentAuthorizeInput): Promise<PaymentResult>
  capture?(input: PaymentReferenceInput): Promise<PaymentResult>
  cancel?(input: PaymentReferenceInput): Promise<PaymentResult>
  refund?(input: PaymentReferenceInput): Promise<PaymentResult>
  getStatus?(providerReference: string): Promise<PaymentResult>
  /** `null` si la firma no valida. Quien llama descarta, no reintenta. */
  verifyWebhook?(
    rawBody: string,
    signature: string | null,
    secret: string | null,
  ): Promise<PaymentWebhookEvent | null>
}

/** Error de dominio: se pidió a una pasarela algo que declara no saber hacer. */
export class PaymentCapabilityError extends Error {
  readonly code = 'OPERACION_NO_SOPORTADA'
  readonly providerCode: string
  readonly operation: PaymentOperation

  constructor(providerCode: string, operation: PaymentOperation) {
    super(`El conector "${providerCode}" no implementa la operacion "${operation}"`)
    this.name = 'PaymentCapabilityError'
    this.providerCode = providerCode
    this.operation = operation
  }
}

export function supports(provider: PaymentProvider, operation: PaymentOperation): boolean {
  switch (operation) {
    case 'authorize':
      return provider.capabilities.authorize && typeof provider.authorize === 'function'
    case 'capture':
      return provider.capabilities.capture && typeof provider.capture === 'function'
    case 'cancel':
      return provider.capabilities.cancel && typeof provider.cancel === 'function'
    case 'refund':
      return provider.capabilities.refund && typeof provider.refund === 'function'
    case 'status':
      return provider.capabilities.status && typeof provider.getStatus === 'function'
    case 'webhook':
      return provider.capabilities.webhook && typeof provider.verifyWebhook === 'function'
  }
}

/**
 * Exige la operación y devuelve el método. Que la capacidad declarada y el
 * método presente tengan que coincidir es deliberado: un adaptador que declara
 * `refund: true` y no lo implementa es un error del adaptador, y sale aquí en
 * vez de a mitad de una devolución.
 */
export function requireOperation<T>(
  provider: PaymentProvider,
  operation: PaymentOperation,
  method: T | undefined,
): T {
  if (!supports(provider, operation) || method === undefined) {
    throw new PaymentCapabilityError(provider.code, operation)
  }
  return method
}

/** Operación canónica → nombre que usan `payment_attempts.operation` y el outbox. */
export function attemptOperation(operation: PaymentOperation): string {
  return `payment.${operation}`
}

/**
 * Resultado de la pasarela → estado del intento en la base.
 *
 * `timeout` deja el intento en `processing` a propósito: no se sabe si se
 * cobró, y marcarlo `failed` sería afirmar que no. Lo resuelve una consulta de
 * estado o el webhook, que son las dos únicas fuentes que sí saben.
 */
export function intentStatusFor(status: PaymentResultStatus): string | null {
  switch (status) {
    case 'authorized':
      return 'authorized'
    case 'captured':
      return 'captured'
    case 'requires_action':
      return 'requires_action'
    case 'cancelled':
      return 'cancelled'
    case 'declined':
    case 'failed':
      return 'failed'
    case 'timeout':
      return 'processing'
  }
}

/** Resultado de la pasarela → fila de `payment_attempts`. */
export function attemptStatusFor(status: PaymentResultStatus): string {
  switch (status) {
    case 'authorized':
    case 'captured':
    case 'cancelled':
      return 'succeeded'
    case 'requires_action':
      return 'pending'
    case 'declined':
      return 'declined'
    case 'failed':
      return 'failed'
    case 'timeout':
      return 'timeout'
  }
}
