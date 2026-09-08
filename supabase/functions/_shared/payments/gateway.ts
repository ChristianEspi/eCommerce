/**
 * La pasarela vista desde el checkout: el gancho de la etapa 8, ahora con
 * dominio detrás (P09-SaaS).
 *
 * Sustituye a `noPaymentGateway`, que devolvía `not_required` porque no había
 * con qué cobrar. Lo que NO cambia —y es la parte importante— es la forma: el
 * pipeline sigue llamando a `authorizePayment` y a `voidPayment` y sigue sin
 * saber que existe una pasarela. Añadir un proveedor real es registrar un
 * adaptador en `registry.ts`; ni el pipeline ni el dominio de pedidos se tocan.
 *
 * ## El orden de las tres llamadas, y por qué es ese
 *
 *   1. `payment_intent_open`  — la intención queda ESCRITA antes de hablar con
 *      nadie. Si el proceso muere en el segundo paso, hay una fila que dice
 *      «se iba a cobrar esto», que es la diferencia entre investigar y adivinar.
 *   2. `provider.authorize`   — la única llamada a la red.
 *   3. `payment_apply_outcome`— el resultado entra por el comando único, con su
 *      intento, su bitácora y su idempotencia.
 *
 * Invertir 1 y 2 —llamar primero y anotar después— es cómo se pierde un cobro:
 * el proveedor retiene el dinero y aquí no queda rastro de a qué compra era.
 *
 * ## Los tres finales posibles, sin ambigüedad
 *
 *   sin medio de pago         → `not_required`. La tienda cobra por su canal.
 *   medio sin pasarela        → `pending`. Transferencia o contra entrega: el
 *                               pedido nace y alguien confirma el dinero luego.
 *   medio con pasarela        → lo que diga el adaptador.
 *
 * Un `timeout` NO se traduce a rechazo. «No se sabe» y «no se cobró» son cosas
 * distintas y decirle al comprador que le rechazaron la tarjeta cuando puede
 * habérsele cobrado es el peor de los dos errores. Sale como
 * `PAGO_NO_DISPONIBLE` (503, reintentable) y el intento se queda en
 * `processing`, esperando al webhook o a una consulta de estado.
 */
import type { RpcCaller } from '../checkout/dbPorts.ts'
import type { PaymentOutcome, PaymentRequest } from '../checkout/ports.ts'
import {
  attemptOperation,
  attemptStatusFor,
  intentStatusFor,
  requireOperation,
  supports,
  type PaymentProvider,
  type PaymentResult,
} from './provider.ts'
import { resolvePaymentProvider } from './registry.ts'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  return typeof value === 'string' ? value : fallback
}

function nullableText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : null
}

const NOT_REQUIRED: PaymentOutcome = {
  status: 'not_required',
  providerCode: null,
  providerReference: null,
  providerMessage: null,
}

/** Reloj inyectable: sin él, la latencia haría intermitente cualquier test. */
export interface PaymentGatewayOptions {
  readonly service: RpcCaller
  readonly now?: () => number
  /**
   * A dónde vuelve el comprador cuando la pasarela exige 3DS. **La compone el
   * servidor**: una URL de retorno que viniera del navegador es un redirector
   * abierto con el pago dentro.
   */
  readonly returnUrl?: (storeSlug: string) => string
  /**
   * La credencial de cada pasarela, por `provider_code`.
   *
   * Entra por aqui porque los adaptadores son PUROS —ninguno lee el
   * entorno— y porque quien sabe leer secretos es el borde, no una carpeta
   * compartida que la suite ejecuta en Node. Un adaptador sin credencial no
   * finge un cobro: simula si sabe, y rechaza si no.
   */
  readonly secretFor?: (providerCode: string) => string | null
}

export interface PaymentGateway {
  authorizePayment(request: PaymentRequest): Promise<PaymentOutcome>
  voidPayment(outcome: PaymentOutcome): Promise<void>
  /** Ata el cobro al pedido recién creado. El pedido no se entera de nada. */
  attachOrder(outcome: PaymentOutcome, orderId: string): Promise<void>
}

export function createPaymentGateway(options: PaymentGatewayOptions): PaymentGateway {
  const { service } = options
  const now = options.now ?? (() => Date.now())

  async function applyOutcome(
    intentId: string,
    operation: string,
    idempotencyKey: string,
    result: PaymentResult,
    latencyMs: number,
  ): Promise<Record<string, unknown>> {
    return record(
      await service('payment_apply_outcome', {
        p_intent_id: intentId,
        p_operation: operation,
        p_idempotency_key: idempotencyKey,
        p_attempt_status: attemptStatusFor(result.status),
        p_intent_status: intentStatusFor(result.status),
        p_amount: result.amount,
        p_provider_reference: result.providerReference,
        p_provider_result_code: result.resultCode,
        p_error_code: result.errorCode,
        p_error_detail: result.errorDetail,
        p_latency_ms: latencyMs,
        p_source: 'provider_response',
      }),
    )
  }

  return {
    async authorizePayment(request: PaymentRequest): Promise<PaymentOutcome> {
      // Tienda sin cobro en línea: exactamente lo que hacía P07, y sigue siendo
      // verdad. Un comercio que no ha contratado pasarela no deja de vender.
      if (!request.methodCode) return NOT_REQUIRED

      const intent = record(
        await service('payment_intent_open', {
          p_store_slug: request.storeSlug,
          p_method_code: request.methodCode,
          p_amount: request.amount,
          p_currency: request.currency,
          p_idempotency_key: request.idempotencyKey,
        }),
      )
      const intentId = text(intent, 'intent_id')
      const providerCode = nullableText(intent, 'provider_code')

      // Medio offline: transferencia, contra entrega. No hay a quién llamar y
      // el dinero lo confirma una persona. `pending` y no `authorized`: decir
      // que se autorizó un cobro que nadie intentó es mentir donde más cuesta.
      if (providerCode === null) {
        return {
          status: 'pending',
          providerCode: null,
          providerReference: null,
          providerMessage: null,
          intentId,
        }
      }

      const provider: PaymentProvider = resolvePaymentProvider(providerCode, {
        captureMode: text(intent, 'capture_mode', 'automatic') === 'manual' ? 'manual' : 'automatic',
        returnUrl: options.returnUrl?.(request.storeSlug) ?? null,
        secret: options.secretFor?.(providerCode) ?? null,
      })
      const authorize = requireOperation(provider, 'authorize', provider.authorize)

      const startedAt = now()
      let result: PaymentResult
      try {
        result = await authorize.call(provider, {
          intentId,
          amount: request.amount,
          currency: request.currency,
          idempotencyKey: request.idempotencyKey,
          customerEmail: request.customerEmail,
          returnUrl: options.returnUrl?.(request.storeSlug) ?? null,
          providerToken: request.providerToken ?? null,
        })
      } catch (error) {
        // La pasarela reventó. Se anota como intento fallido —queda la fila— y
        // sale como no disponible, que es lo que de verdad pasó.
        await applyOutcome(
          intentId,
          attemptOperation('authorize'),
          request.idempotencyKey,
          {
            status: 'timeout',
            providerReference: null,
            resultCode: null,
            errorCode: 'CONECTOR_NO_RESPONDE',
            errorDetail: error instanceof Error ? error.message : String(error),
            redirectUrl: null,
            amount: request.amount,
          },
          now() - startedAt,
        )
        throw new Error('PAGO_NO_DISPONIBLE: la pasarela no esta disponible ahora mismo')
      }

      const applied = await applyOutcome(
        intentId,
        attemptOperation('authorize'),
        request.idempotencyKey,
        result,
        now() - startedAt,
      )
      const providerMessage = result.errorCode ?? result.resultCode

      switch (result.status) {
        case 'captured':
          return {
            status: 'captured',
            providerCode,
            providerReference: result.providerReference,
            providerMessage,
            intentId,
          }
        case 'authorized':
          return {
            status: 'authorized',
            providerCode,
            providerReference: result.providerReference,
            providerMessage,
            intentId,
          }
        case 'requires_action':
          return {
            status: 'pending',
            providerCode,
            providerReference: result.providerReference,
            providerMessage,
            intentId,
            redirectUrl: result.redirectUrl,
          }
        case 'declined':
        case 'failed':
          return {
            status: 'declined',
            providerCode,
            providerReference: result.providerReference,
            providerMessage,
            intentId,
          }
        case 'cancelled':
          return {
            status: 'declined',
            providerCode,
            providerReference: result.providerReference,
            providerMessage,
            intentId,
          }
        case 'timeout':
          // El intento queda en `processing` —lo dejó `intentStatusFor`— y
          // `applied` ya lo escribió. Quien resuelve es el webhook.
          void applied
          throw new Error('PAGO_NO_DISPONIBLE: no se pudo confirmar el cobro con la pasarela')
      }
    },

    /**
     * Compensación de la etapa 8. Se ejecuta cuando el cobro salió bien y lo
     * que vino DESPUÉS falló: sin esto queda dinero retenido de alguien que no
     * tiene pedido.
     *
     * Anular una autorización y devolver una captura son operaciones distintas
     * y el adaptador puede no tener las dos. Si no las tiene, esto NO lanza: la
     * compensación corre dentro del `unwind` de un error que ya existe, y
     * hacerla fallar taparía el error original. Queda escrito en la bitácora.
     */
    async voidPayment(outcome: PaymentOutcome): Promise<void> {
      const intentId = outcome.intentId
      if (!intentId || !outcome.providerCode || !outcome.providerReference) return
      if (outcome.status !== 'authorized' && outcome.status !== 'captured') return

      const provider = resolvePaymentProvider(outcome.providerCode)
      const wanted = outcome.status === 'captured' ? 'refund' : 'cancel'
      if (!supports(provider, wanted)) return

      const method = wanted === 'refund' ? provider.refund : provider.cancel
      if (!method) return

      const startedAt = now()
      const result = await method.call(provider, {
        intentId,
        providerReference: outcome.providerReference,
        amount: '0.00',
        currency: '',
        idempotencyKey: `void:${intentId}`,
      })

      await service('payment_apply_outcome', {
        p_intent_id: intentId,
        p_operation: attemptOperation(wanted),
        p_idempotency_key: `void:${intentId}`,
        p_attempt_status: attemptStatusFor(result.status),
        p_intent_status: 'cancelled',
        p_provider_reference: result.providerReference,
        p_provider_result_code: result.resultCode,
        p_error_code: result.errorCode,
        p_error_detail: result.errorDetail,
        p_latency_ms: now() - startedAt,
        p_source: 'system',
      })
    },

    async attachOrder(outcome: PaymentOutcome, orderId: string): Promise<void> {
      if (!outcome.intentId) return
      await service('payment_intent_attach_order', {
        p_intent_id: outcome.intentId,
        p_order_id: orderId,
      })
    },
  }
}
