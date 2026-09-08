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
  /**
   * La clave secreta (`sk_…`), del entorno del borde. Sin ella se simula.
   *
   * No se lee aquí con `Deno.env` porque este archivo se ejecuta también en Node
   * dentro de la suite: un adaptador que toca el entorno deja de poder probarse
   * con el resto.
   */
  readonly secret?: string | null
}

const CULQI_CHARGES = 'https://api.culqi.com/v2/charges'

/** Si Culqi no contesta en este tiempo, el cobro se marca agotado — que NO es
 *  lo mismo que rechazado: puede haberse cobrado y no habernos llegado. */
const TIMEOUT_MS = 20_000

/** El importe en céntimos enteros, que es lo que Culqi espera. */
function aCentimos(amount: string): number {
  return Math.round(Number(amount) * 100)
}

/**
 * El cobro de verdad.
 *
 * Un solo `POST`. Culqi cobra en el acto, así que un 2xx es dinero movido y se
 * devuelve como `captured`, no como `authorized`.
 */
async function cobrar(
  secret: string,
  token: string,
  input: PaymentAuthorizeInput,
): Promise<PaymentResult> {
  const control = new AbortController()
  const alarma = setTimeout(() => control.abort(), TIMEOUT_MS)
  try {
    const respuesta = await fetch(CULQI_CHARGES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${secret}` },
      signal: control.signal,
      body: JSON.stringify({
        amount: aCentimos(input.amount),
        currency_code: input.currency,
        email: input.customerEmail,
        source_id: token,
        // Sale en el panel de Culqi: es lo que permite conciliar un cargo con un
        // intento sin cruzar hojas de calculo.
        metadata: { intent_id: input.intentId },
      }),
    })
    const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>

    if (respuesta.ok) {
      const id = typeof cuerpo.id === 'string' ? cuerpo.id : referenceFor(input.intentId, 'auth')
      return ok('captured', input.amount, id)
    }

    // El texto del proveedor va a la bitacora del comercio, nunca a la cara del
    // comprador: la vitrina traduce por codigo.
    const detalle =
      typeof cuerpo.merchant_message === 'string'
        ? cuerpo.merchant_message
        : 'Culqi rechazo el cargo'
    return ko('declined', input.amount, 'CLQ51', detalle)
  } catch {
    return ko('timeout', input.amount, 'CLQ99', 'Culqi no respondio a tiempo')
  } finally {
    clearTimeout(alarma)
  }
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

export function createCulqiProvider(options: CulqiOptions = {}): PaymentProvider {
  const secret = options.secret ?? null

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
      const token = input.providerToken ?? null

      // --- Con credencial: se cobra de verdad --------------------------------
      if (secret) {
        if (!token) {
          // Sin instrumento no hay nada que cobrar, y aprobarlo igual seria lo
          // peor que puede hacer un conector de pagos.
          return Promise.resolve(
            ko(
              'declined',
              input.amount,
              'CLQ40',
              'No llego el token de la tarjeta desde el navegador',
            ),
          )
        }
        return cobrar(secret, token, input)
      }

      // --- Sin credencial: simulacro -----------------------------------------
      //
      // Manda el ULTIMO DIGITO del token cuando lo hay, y los centimos del total
      // cuando no. El token gana porque, con formulario delante, quien prueba
      // espera que la TARJETA decida el resultado; los centimos siguen para los
      // casos sin formulario (pruebas de servidor, sandbox).
      const reference = referenceFor(input.intentId, 'auth')
      const ultimo = token ? Number(token.slice(-1)) : centsOf(input.amount)

      if (token ? ultimo === 0 : ultimo === 1) {
        return Promise.resolve(
          ko('declined', input.amount, 'CLQ51', 'Tarjeta rechazada por el emisor (simulado)'),
        )
      }
      if (!token && ultimo === 2) {
        return Promise.resolve(
          ko('timeout', input.amount, 'CLQ99', 'Culqi no respondio a tiempo (simulado)'),
        )
      }
      return Promise.resolve(ok('captured', input.amount, reference))
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
