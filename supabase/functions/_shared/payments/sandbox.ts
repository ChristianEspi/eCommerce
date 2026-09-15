/**
 * El conector `sandbox`: una pasarela DETERMINISTA, sin dinero real.
 *
 * Es el «FakePaymentProvider» que pide el criterio 11 de la fase, pero no vive
 * en la carpeta de tests: vive donde vive cualquier otro adaptador, se registra
 * como cualquier otro y tiene fila en `integration_providers` como cualquier
 * otro. Esa es la propiedad que interesa —los tests recorren el MISMO camino
 * que la producción— y por eso también sirve para que un comercio pruebe su
 * checkout de punta a punta antes de contratar pasarela.
 *
 * ## Cómo se le pide un resultado concreto
 *
 * Por los CÉNTIMOS del importe, que es como funcionan los entornos de prueba de
 * las pasarelas de verdad (allí son números de tarjeta; aquí no hay tarjetas
 * que dar, porque este repositorio no toca ninguna).
 *
 *   `x.01` → rechazo          (`declined`)
 *   `x.02` → tiempo agotado   (`timeout`)  ← no dice que no se cobró
 *   `x.03` → hace falta 3DS   (`requires_action`, con `redirectUrl`)
 *   `x.04` → autoriza, pero la captura falla
 *   `x.05` → la devolución falla
 *   resto  → éxito
 *
 * Determinista de verdad: sin reloj, sin azar y sin estado entre llamadas. La
 * misma entrada da la misma salida hoy y dentro de un año, que es lo único que
 * hace que un test de cobro no sea intermitente.
 *
 * La referencia que devuelve se deriva del intento y de la operación, así que
 * repetir una llamada devuelve la MISMA referencia: es lo que deja que los
 * cerrojos de idempotencia de la base (índice único por
 * `provider_code, provider_reference`) hagan su trabajo también en las pruebas.
 */
import type {
  PaymentAuthorizeInput,
  PaymentProvider,
  PaymentReferenceInput,
  PaymentResult,
  PaymentResultStatus,
  PaymentWebhookEvent,
} from './provider.ts'
import { verifyHmacSignature } from './signature.ts'

export const SANDBOX_PROVIDER_CODE = 'sandbox'

/** Los céntimos, como número entero de 0 a 99. Sobre TEXTO, nunca sobre float. */
function centsOf(amount: string): number {
  const match = /^-?\d+(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (!match) return 0
  return Number((match[1] ?? '0').padEnd(2, '0'))
}

/** Referencia estable: mismo intento y misma operación, misma referencia. */
function referenceFor(intentId: string, operation: string): string {
  return `sbx-${operation}-${intentId}`
}

function ok(
  status: PaymentResultStatus,
  amount: string,
  reference: string,
  extra: Partial<PaymentResult> = {},
): PaymentResult {
  return {
    status,
    providerReference: reference,
    resultCode: status === 'captured' || status === 'authorized' ? 'SBX00' : 'SBX10',
    errorCode: null,
    errorDetail: null,
    redirectUrl: null,
    amount,
    ...extra,
  }
}

function ko(
  status: PaymentResultStatus,
  amount: string,
  code: string,
  detail: string,
): PaymentResult {
  return {
    status,
    providerReference: null,
    resultCode: code,
    errorCode: code,
    errorDetail: detail,
    redirectUrl: null,
    amount,
  }
}

export interface SandboxOptions {
  /**
   * `automatic` = cobra en un paso y devuelve `captured`; `manual` = autoriza y
   * espera una captura aparte. Es propiedad del MEDIO de pago del tenant
   * (`payment_methods.capture_mode`), no del conector, y por eso entra por aquí.
   */
  readonly captureMode?: 'automatic' | 'manual'
  /** URL a la que vuelve el comprador cuando el resultado es `requires_action`. */
  readonly returnUrl?: string | null
}

export function createSandboxProvider(options: SandboxOptions = {}): PaymentProvider {
  const captureMode = options.captureMode ?? 'automatic'

  return {
    code: SANDBOX_PROVIDER_CODE,
    // Siempre: es su razón de ser. Solo cobra donde el despliegue lo permite.
    simulated: true,
    capabilities: {
      authorize: true,
      capture: true,
      cancel: true,
      refund: true,
      status: true,
      webhook: true,
    },

    authorize(input: PaymentAuthorizeInput): Promise<PaymentResult> {
      const reference = referenceFor(input.intentId, 'auth')
      switch (centsOf(input.amount)) {
        case 1:
          return Promise.resolve(
            ko('declined', input.amount, 'SBX51', 'Fondos insuficientes (simulado)'),
          )
        case 2:
          return Promise.resolve(
            ko('timeout', input.amount, 'SBX99', 'La pasarela no contesto a tiempo (simulado)'),
          )
        case 3:
          return Promise.resolve(
            ok('requires_action', input.amount, reference, {
              redirectUrl: options.returnUrl ?? input.returnUrl ?? null,
              resultCode: 'SBX3DS',
            }),
          )
        default:
          return Promise.resolve(
            ok(captureMode === 'automatic' ? 'captured' : 'authorized', input.amount, reference),
          )
      }
    },

    capture(input: PaymentReferenceInput): Promise<PaymentResult> {
      if (centsOf(input.amount) === 4) {
        return Promise.resolve(
          ko('failed', input.amount, 'SBX61', 'La captura fue rechazada (simulado)'),
        )
      }
      return Promise.resolve(ok('captured', input.amount, referenceFor(input.intentId, 'cap')))
    },

    cancel(input: PaymentReferenceInput): Promise<PaymentResult> {
      return Promise.resolve(ok('cancelled', input.amount, input.providerReference))
    },

    refund(input: PaymentReferenceInput): Promise<PaymentResult> {
      if (centsOf(input.amount) === 5) {
        return Promise.resolve(
          ko('failed', input.amount, 'SBX62', 'La devolucion fue rechazada (simulado)'),
        )
      }
      return Promise.resolve(ok('captured', input.amount, referenceFor(input.intentId, 'ref')))
    },

    getStatus(providerReference: string): Promise<PaymentResult> {
      // Lo que salva un `timeout`: la referencia existe, luego se cobró.
      return Promise.resolve(ok('captured', '0.00', providerReference))
    },

    /**
     * Verifica y traduce. Devuelve `null` —y no lanza— cuando la firma no
     * valida o el sobre no tiene la forma esperada: quien llama descarta.
     */
    async verifyWebhook(
      rawBody: string,
      signature: string | null,
      secret: string | null,
    ): Promise<PaymentWebhookEvent | null> {
      if (!(await verifyHmacSignature({ rawBody, signature, secret }))) return null

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        return null
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const body = parsed as Record<string, unknown>

      const externalEventId = typeof body.event_id === 'string' ? body.event_id : ''
      const providerReference = typeof body.reference === 'string' ? body.reference : ''
      const eventType = typeof body.type === 'string' ? body.type : ''
      if (externalEventId === '' || providerReference === '' || eventType === '') return null

      // Lo que no está en la tabla es INFORMATIVO, no un fallo: la pasarela
      // avisa de más cosas de las que mueven dinero.
      const STATUS_BY_TYPE: Record<string, PaymentWebhookEvent['status']> = {
        'payment.captured': 'captured',
        'payment.authorized': 'authorized',
        'payment.refunded': 'refunded',
        'payment.declined': 'declined',
        'payment.failed': 'failed',
        'payment.cancelled': 'cancelled',
      }
      const status: PaymentWebhookEvent['status'] = STATUS_BY_TYPE[eventType] ?? 'informational'

      return {
        externalEventId,
        providerReference,
        eventType,
        status,
        amount: typeof body.amount === 'string' ? body.amount : null,
        currency: typeof body.currency === 'string' ? body.currency : null,
        payload: body,
      }
    },
  }
}
