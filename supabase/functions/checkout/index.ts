/**
 * checkout — el pipeline del storefront (P07-SaaS).
 *
 * Sustituye a `create-order` como puerta del comprador, y `create-order` se
 * queda donde está: sigue funcionando, sus tests siguen pasando y un cliente
 * antiguo no se rompe. Lo que hace esta función y aquella no puede hacer es
 * **garantizar que reintentar no crea dos pedidos**: aquí toda la operación
 * cuelga de una clave de idempotencia que el navegador genera y que el servidor
 * ancla en `checkout_intents`.
 *
 * ## Quién decide qué
 *
 * El cuerpo dice, como siempre, solo QUÉ tienda (por su slug público), QUÉ
 * productos, CUÁNTAS unidades y los datos de contacto. Nada de precios, totales
 * ni tenant. Lo nuevo que sí acepta —y conviene ser explícito— es:
 *
 *  · `idempotency_key`: un secreto de alta entropía del cliente. No identifica
 *    a nadie y no autoriza nada; solo ancla el intento.
 *  · `cart_token`: el carrito del servidor que se convierte en pedido. Si no
 *    corresponde a nada, la compra sigue: el carrito es una comodidad.
 *  · `expected_prices`: lo que el navegador CREÍA que costaba cada línea. No se
 *    cobra con ello jamás — solo sirve para detenerse y avisar si el precio
 *    cambió mientras el comprador rellenaba el formulario.
 *  · `coupon_codes` y `gift_card_codes` (P10): lo que el comprador tecleó. Son
 *    CÓDIGOS, no descuentos: no llevan importe, no dicen qué campaña activan y
 *    no pueden marcar nada como aplicado. Cuánto descuenta cada uno lo decide
 *    la base, dos veces —una para enseñárselo al comprador y otra, con las
 *    filas bloqueadas, para cobrarle—.
 *
 * ## Dos clientes, y no es un descuido
 *
 * `service_role` para lo que el comprador anónimo no puede hacer (reclamar el
 * intento, reservar, crear el pedido), y el cliente del LLAMANTE para la única
 * pregunta que depende de su sesión: de qué cuenta B2B es miembro. Con
 * `service_role` esa pregunta no tendría respuesta, porque no hay sesión que
 * consultar; con el del llamante, la RLS y la función definer deciden.
 */
import { assertNoTenantInPayload } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'

import { serveJson } from '../_shared/http.ts'
import { createDbPorts, type RpcCaller } from '../_shared/checkout/dbPorts.ts'
import { CheckoutStageError } from '../_shared/checkout/errors.ts'
import { runCheckout } from '../_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../_shared/checkout/request.ts'
import { anonClient, serviceClient, userClient } from '../_runtime/clients.ts'

type PostgrestError = { message?: string; code?: string; details?: string | null }

/**
 * Convierte `{ data, error }` en «devuelve o lanza». El mensaje se conserva tal
 * cual (`CODIGO: texto`) porque es lo que el pipeline sabe descomponer en un
 * error con etapa; degradar aquí a «error interno» perdería el diagnóstico
 * justo antes de guardarlo.
 */
function rpcCaller(client: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestError | null }> }): RpcCaller {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) {
      const failure = new Error(error.message ?? 'Error interno')
      failure.name = 'PostgrestError'
      throw failure
    }
    return data
  }
}

/**
 * ¿Viene una sesión de persona, o solo la clave publicable?
 *
 * `functions.invoke` manda SIEMPRE una cabecera `Authorization`: con la clave
 * anónima si no hay sesión y con el token del usuario si la hay. Las dos son
 * JWT, así que la presencia de la cabecera no dice nada. Lo que distingue a una
 * persona es el `sub`. **No se usa como autorización** —esta comprobación no
 * verifica la firma—: solo decide si tiene sentido preguntar por una cuenta
 * B2B. Quien autoriza de verdad es la RLS con ese mismo token.
 */
function looksLikeUserSession(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return false

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const payload = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    ) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub.length > 0
  } catch {
    return false
  }
}

const handler = serveJson(
  // Storefront público: cualquier origen, igual que `create-order`.
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_STOREFRONT_ORIGINS')),
    service: 'checkout',
  },
  async ({ request, body, trace }) => {
    assertNoTenantInPayload(body)
    const parsed = await parseCheckoutBody(body)

    const hasSession = looksLikeUserSession(request)
    const ports = createDbPorts({
      service: rpcCaller(serviceClient(trace)),
      caller: rpcCaller(hasSession ? userClient(request, trace) : anonClient(trace)),
      hasSession,
      /**
       * La credencial de cada pasarela, una variable por `provider_code`.
       *
       * Se lee AQUÍ y no dentro del adaptador: este es el borde, el único sitio
       * del repositorio con entorno. Los adaptadores de `_shared/payments` son
       * puros para que la suite los ejecute en Node junto al resto.
       *
       * Una variable por pasarela y no un objeto con todas: así ninguna ve la
       * credencial de otra, y dar de alta una nueva no obliga a tocar el
       * despliegue de las que ya cobran.
       *
       * Sin variable, el conector simula (si sabe) o rechaza. Nunca finge.
       */
      secretFor: (providerCode) =>
        Deno.env.get(`EBIM_PAYMENT_SECRET_${providerCode.toUpperCase()}`) ?? null,
    })

    try {
      const result = await runCheckout(ports, parsed)
      return {
        // 200 y no 201 cuando es un reintento: no se creó nada esta vez, y un
        // 201 haría creer al cliente que sí.
        status: result.replay ? 200 : 201,
        body: {
          data: {
            order_id: result.order.orderId,
            order_number: result.order.orderNumber,
            access_token: result.order.accessToken,
            status: result.order.status,
            currency: result.order.currency,
            subtotal: result.order.subtotal,
            tax_total: result.order.taxTotal,
            // P12: el transporte va SEPARADO del total. Un comprador que ve un
            // total mayor que la suma de sus lineas y ninguna linea que lo
            // explique es un comprador que abandona el carrito.
            shipping_total: result.order.shippingTotal,
            grand_total: result.order.grandTotal,
            delivery: result.order.delivery,
            // P10: el desglose. Un total con descuento y sin explicación es lo
            // que hace que un comprador llame por teléfono para preguntar por
            // qué le cobraron eso.
            discount_total: result.promotions?.totals?.discountTotal ?? '0.00',
            promotions: result.promotions?.adjustments ?? [],
            coupons: result.promotions?.coupons ?? [],
            gift_cards: (result.giftCards?.redemptions ?? []).map((entry) => ({
              // Los cuatro últimos y el importe. El código entero no vuelve a
              // salir de la base ni siquiera aquí.
              last4: entry.last4,
              applied: entry.applied,
            })),
            items: result.order.items,
            replay: result.replay,
            intent_id: result.intentId,
            payment_status: result.payment?.status ?? 'not_required',
            // P08: si la compra espera la firma de la empresa, el comprador
            // tiene que enterarse AQUI. Descubrirlo dias despues, cuando no
            // llega nada, es la version cara del mismo dato.
            approval_status: result.order.approvalStatus,
            approval_reason: result.approval?.reason ?? null,
            source_channel: result.order.sourceChannel,
            // N05: la orden de compra con la que quedó firmado el pedido.
            purchase_order_number: result.order.purchaseOrderNumber ?? null,
          },
        },
      }
    } catch (error) {
      if (error instanceof CheckoutStageError) {
        // La etapa viaja en la respuesta. Es lo que permite que la pantalla
        // diga «no pudimos apartar el stock» en vez de «algo salió mal», y lo
        // que hace que el error sea auditable de los dos lados.
        return {
          status: error.status,
          body: {
            error: {
              code: error.code,
              message: error.message,
              stage: error.stage,
              retryable: error.retryable,
            },
          },
        }
      }
      // Lo que no sea del pipeline sigue su camino: `serveJson` lo traduce a la
      // misma forma de error que las otras cuatro funciones.
      throw error
    }
  },
)

Deno.serve(handler)
