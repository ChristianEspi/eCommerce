/**
 * El conector `culqi`, hoy en SIMULACRO.
 *
 * Se escribe aquí y se registra con una línea en `registry.ts`, que es
 * literalmente lo que ese archivo promete: «añadir una pasarela real es escribir
 * un archivo y una línea en este mapa». Ni una migración, ni un `if` en el
 * checkout, ni una segunda función de borde que decida si algo está pagado.
 *
 * Por eso el cobro con tarjeta ya recorre HOY el camino de producción entero:
 * `checkout_begin` abre el intento, el pipeline llama a `authorize`, y
 * `payment_apply_outcome` mueve el intento y el pedido. Lo único simulado es la
 * respuesta del banco.
 *
 * ## Cómo se pide un resultado concreto
 *
 * Por los CÉNTIMOS del importe, la misma convención que `sandbox` — y no es
 * pereza: es lo que hace que las dos pasarelas se prueben igual, y que quien
 * conozca una sepa manejar la otra sin volver a leer nada.
 *
 *   `x.01` → rechazada        (`declined`)
 *   `x.02` → tiempo agotado   (`timeout`)  ← no dice que no se cobró
 *   resto  → cobrada          (`captured`)
 *
 * Determinista de verdad: sin reloj, sin azar y sin estado entre llamadas. Una
 * demo tiene que poder enseñar el rechazo cuando quiere, no cuando toca.
 *
 * ## Qué falta EXACTAMENTE para cobrar de verdad
 *
 * Dos cosas, y ninguna es «poner la clave y ya»:
 *
 * 1. **Hacer llegar el secreto hasta aquí.** Los adaptadores de esta carpeta son
 *    PUROS —ninguno lee `Deno.env`— porque así se prueban en Node con el resto
 *    de la suite. El secreto tiene que entrar por `ProviderResolveOptions`, que
 *    hoy solo transporta `captureMode` y `returnUrl`: hay que añadir el campo y
 *    que `gateway.ts` lo reciba de quien sí puede leer el entorno.
 *
 * 2. **Hacer llegar el token de la tarjeta.** Culqi cobra contra un `source_id`
 *    que su JavaScript crea en el navegador a cambio de la tarjeta —el número
 *    nunca toca este servidor, y eso es lo que mantiene el cumplimiento PCI
 *    fuera del proyecto—. `PaymentAuthorizeInput` no lo lleva todavía.
 *
 * Con las dos, `authorize` pasa a hacer un `POST` a `https://api.culqi.com/v2/charges`
 * con `{ amount, currency_code, email, source_id }` y a mapear la respuesta a
 * `captured` o `declined`. El resto de este archivo no cambia.
 *
 * Está escrito aquí y no en un ticket porque el día que lleguen las claves, esto
 * es lo primero que alguien va a abrir.
 */
import type {
  PaymentAuthorizeInput,
  PaymentProvider,
  PaymentReferenceInput,
  PaymentResult,
  PaymentResultStatus,
} from './provider.ts'

export const CULQI_PROVIDER_CODE = 'culqi'

export interface CulqiOptions {
  /**
   * `automatic` = cobra en un paso. Culqi funciona así: no hay autorización que
   * capturar después, y ofrecer una captura diferida haría que el comercio
   * esperara una acción que la pasarela no tiene.
   */
  readonly captureMode?: 'automatic' | 'manual'
}

/** Los céntimos como entero 0-99, sobre TEXTO y nunca sobre coma flotante. */
function centsOf(amount: string): number {
  const match = /^-?\d+(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (!match) return 0
  return Number((match[1] ?? '0').padEnd(2, '0'))
}

/** Referencia estable: mismo intento y misma operación, misma referencia. Es lo
 *  que deja que el índice único de la base haga su trabajo también aquí. */
function referenceFor(intentId: string, operation: string): string {
  return `clq-${operation}-${intentId}`
}

function ok(status: PaymentResultStatus, amount: string, reference: string): PaymentResult {
  return {
    status,
    providerReference: reference,
    resultCode: status === 'captured' || status === 'authorized' ? 'CLQ00' : 'CLQ10',
    errorCode: null,
    errorDetail: null,
    redirectUrl: null,
    amount,
  }
}

function ko(
  status: PaymentResultStatus,
  amount: string,
  errorCode: string,
  errorDetail: string,
): PaymentResult {
  return {
    status,
    providerReference: null,
    resultCode: null,
    errorCode,
    errorDetail,
    redirectUrl: null,
    amount,
  }
}

export function createCulqiProvider(_options: CulqiOptions = {}): PaymentProvider {
  return {
    code: CULQI_PROVIDER_CODE,
    capabilities: {
      authorize: true,
      // Cobro en un paso: no hay captura ni anulación previas al cobro.
      capture: false,
      cancel: false,
      refund: true,
      status: false,
      webhook: true,
    },

    authorize(input: PaymentAuthorizeInput): Promise<PaymentResult> {
      const reference = referenceFor(input.intentId, 'auth')
      switch (centsOf(input.amount)) {
        case 1:
          return Promise.resolve(
            ko('declined', input.amount, 'CLQ51', 'Tarjeta rechazada por el emisor (simulado)'),
          )
        case 2:
          return Promise.resolve(
            ko('timeout', input.amount, 'CLQ99', 'Culqi no respondio a tiempo (simulado)'),
          )
        default:
          return Promise.resolve(ok('captured', input.amount, reference))
      }
    },

    refund(input: PaymentReferenceInput): Promise<PaymentResult> {
      if (centsOf(input.amount) === 5) {
        return Promise.resolve(
          ko('failed', input.amount, 'CLQ62', 'La devolucion fue rechazada (simulado)'),
        )
      }
      return Promise.resolve(ok('captured', input.amount, referenceFor(input.intentId, 'ref')))
    },
  }
}
