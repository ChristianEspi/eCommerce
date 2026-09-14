/**
 * Los adaptadores del pipeline sobre las funciones de la base.
 *
 * Traducen y nada más. **Ni un cálculo aquí dentro**: cualquier suma, resta o
 * redondeo en este archivo sería un segundo sitio donde el importe puede salir
 * distinto del que se cobra, que es exactamente lo que P04 cerró al dejar una
 * sola autoridad de precio.
 *
 * ## Dos llamadores, no uno
 *
 * `service` salta la RLS y se usa para lo que el comprador anónimo no puede
 * hacer por su cuenta: reclamar el intento, reservar existencia, crear el
 * pedido. `caller` actúa COMO QUIEN LLAMA (clave publicable + su
 * `Authorization`) y se usa para lo que depende de la sesión: con qué cuenta
 * B2B compra en esta tienda (`my_effective_business_account_for_slug`, que no
 * acepta identidad: la cuenta sale del token), y cotizar con su precio. Con
 * `service` esas preguntas no tendrían respuesta posible: no hay sesión que
 * consultar.
 */
import type { OrderItemInput } from '../orders.ts'
import { alwaysDeliverable } from './hooks.ts'
import { createPaymentGateway } from '../payments/gateway.ts'
import type {
  AccountContext,
  CheckoutContext,
  CheckoutPorts,
  CheckoutRequest,
  DeliveryContext,
  GiftCardRedemption,
  GiftCardTender,
  IntentClaim,
  PlacedOrder,
  PriceDrift,
  PromotionResult,
  PurchaseApproval,
  Quote,
  QuotedLine,
  Reservation,
} from './ports.ts'
import type { CheckoutStage } from './stages.ts'

/**
 * Llamar a una función de la base. Resuelve con el dato o **lanza un `Error`
 * cuyo mensaje es el de Postgres** (`CODIGO: texto`), que es lo que
 * `asStageError` sabe descomponer en código y detalle.
 */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>

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

function itemPayload(items: readonly OrderItemInput[]): Record<string, unknown>[] {
  return items.map((item) => {
    const line: Record<string, unknown> = {
      product_id: item.product_id,
      quantity: item.quantity,
    }
    if (item.variant_id) line.variant_id = item.variant_id
    if (item.uom_code) line.uom_code = item.uom_code
    return line
  })
}

function toQuote(raw: unknown): Quote {
  const source = record(raw)
  const lines = Array.isArray(source.lines) ? source.lines : []
  return {
    currency: text(source, 'currency'),
    channelCode: text(source, 'channel'),
    taxInclusive: source.tax_inclusive === true,
    lines: lines.map((entry): QuotedLine => {
      const line = record(entry)
      return {
        productId: text(line, 'product_id'),
        variantId: nullableText(line, 'variant_id'),
        uomCode: nullableText(line, 'uom_code'),
        name: text(line, 'name'),
        quantity: Number(line.quantity ?? 0),
        unitPrice: text(line, 'unit_price', '0.00'),
        netAmount: text(line, 'net_amount', '0.00'),
        taxRate: text(line, 'tax_rate', '0'),
        source: text(line, 'source', 'catalog'),
        priceListCode: nullableText(line, 'price_list_code'),
        scope: nullableText(line, 'scope'),
      }
    }),
    subtotal: text(source, 'subtotal', '0.00'),
    taxTotal: text(source, 'tax_total', '0.00'),
    grandTotal: text(source, 'grand_total', '0.00'),
  }
}

export interface DbPortOptions {
  /** Salta RLS. Solo lo que el comprador anónimo no puede hacer por su cuenta. */
  readonly service: RpcCaller
  /** Actúa como quien llama. Solo para resolver la cuenta B2B de la sesión. */
  readonly caller: RpcCaller
  /** `true` si la petición traía `Authorization`. No prueba nada por sí solo. */
  readonly hasSession: boolean
  /**
   * La credencial de cada pasarela, por `provider_code`.
   *
   * La pone el BORDE, que es el único sitio del repositorio donde se leen
   * secretos. Aquí no se lee el entorno a propósito: este archivo vive en
   * `_shared`, la suite lo ejecuta en Node, y un `Deno.env` lo dejaría sin poder
   * probarse con el resto.
   *
   * Sin ella, cada adaptador decide: el que tiene simulacro simula, el que no,
   * rechaza. Ninguno finge un cobro.
   */
  readonly secretFor?: (providerCode: string) => string | null
}

export function createDbPorts(options: DbPortOptions): CheckoutPorts {
  const { service, caller, hasSession } = options
  // P09: el gancho de la etapa 8 deja de ser un `not_required` fijo. El
  // pipeline no se entera —misma firma, mismo puerto— y el dominio de pedidos
  // tampoco: quien conoce la pasarela es este adaptador, y solo por su `code`.
  /**
   * La credencial de cada pasarela llega por OPCIONES, no se lee aqui.
   *
   * Este archivo vive en `_shared`, que la suite ejecuta en Node: tocar
   * `Deno.env` aqui lo dejaria sin poder probarse. Quien lee secretos es el
   * borde —`functions/checkout/index.ts`— y los baja por esta puerta.
   *
   * Sin credencial, `null`: un adaptador con simulacro simula y uno sin
   * simulacro rechaza. Ninguno finge un cobro.
   */
  const gateway = createPaymentGateway({
    service,
    ...(options.secretFor ? { secretFor: options.secretFor } : {}),
  })

  return {
    async begin(request: CheckoutRequest): Promise<IntentClaim> {
      const raw = record(
        await service('checkout_begin', {
          p_store_slug: request.storeSlug,
          p_idempotency_key: request.idempotencyKey,
          p_request_hash: request.requestHash,
          p_cart_token: request.cartToken,
        }),
      )
      return {
        intentId: text(raw, 'intent_id'),
        replay: raw.replay === true,
        attempt: Number(raw.attempt ?? 1),
        result: raw.result ? record(raw.result) : null,
      }
    },

    async markStage(intentId: string, stage: CheckoutStage, reservationToken?: string) {
      await service('checkout_mark_stage', {
        p_intent_id: intentId,
        p_stage: stage,
        p_reservation_token: reservationToken ?? null,
      })
    },

    async failIntent(intentId: string, stage: CheckoutStage, code: string, detail: string) {
      await service('checkout_fail', {
        p_intent_id: intentId,
        p_stage: stage,
        p_code: code,
        p_detail: detail,
      })
    },

    async resolveContext(storeSlug: string): Promise<CheckoutContext> {
      const raw = record(await service('checkout_context', { p_store_slug: storeSlug }))
      return {
        storeSlug: text(raw, 'store_slug', storeSlug),
        storeName: text(raw, 'store_name'),
        currency: text(raw, 'currency'),
        channelCode: text(raw, 'channel'),
        channelKind: text(raw, 'channel_kind'),
        requiresAuth: raw.requires_auth === true,
        requiresAccount: raw.requires_account === true,
        taxInclusive: raw.tax_inclusive === true,
      }
    },

    /**
     * Quien compra, preguntandoselo a la BASE con el token del llamante.
     *
     * `hasSession` solo mira el `sub` del token sin comprobar la firma —lo dice
     * su propio comentario— y por eso no puede sostener una regla de acceso:
     * escribir un JWT con un `sub` dentro lo hace cualquiera. Aqui la pregunta
     * pasa por PostgREST, que verifica la firma antes de ejecutar nada; un
     * token falso ni llega a la funcion.
     *
     * Un fallo se trata como «no hay sesion» y no se traga: la etapa que exige
     * cuenta prefiere rechazar una compra que dejar pasar una sin identificar.
     */
    async verifyBuyer(): Promise<string | null> {
      if (!hasSession) return null
      try {
        const raw = record(await caller('current_buyer', {}))
        return nullableText(raw, 'user_id')
      } catch (error) {
        console.error('[checkout] no se pudo verificar la sesion del comprador', error)
        return null
      }
    },

    /**
     * N01 · la cuenta EFECTIVA en esta tienda, no la primera de una lista.
     *
     * Hasta H14 esto tomaba `rows[0]` de `my_business_accounts()`, que no
     * filtra por sociedad y ordena por nombre, mientras el precio lo fijaba
     * `ebim.pricing_actor` con otra regla: con dos cuentas, el carrito cotizaba
     * con una y el pedido se firmaba con otra. Ahora las dos preguntan a
     * `ebim.effective_business_account` —aquí a través de
     * `my_effective_business_account_for_slug`, con el token del comprador— y
     * no hay segunda regla que pueda discrepar.
     *
     * El slug es el de la tienda que resolvió la etapa 1; la identidad sale del
     * token. Ningún campo del cuerpo de la petición interviene.
     */
    async resolveAccount(storeSlug: string): Promise<AccountContext> {
      const empty: AccountContext = {
        hasSession,
        userId: null,
        accountId: null,
        role: null,
        spendingLimit: null,
      }
      if (!hasSession) return empty

      // Con sesión pero sin vínculo, la respuesta es `null` y NO un error: un
      // comprador con cuenta EBIM que todavía no está vinculado a ninguna
      // empresa compra igual que un anónimo.
      let raw: unknown
      try {
        raw = await caller('my_effective_business_account_for_slug', { p_store_slug: storeSlug })
      } catch (error) {
        // Que la resolución de cuenta no conteste no puede impedir una compra normal.
        console.error('[checkout] no se pudo resolver la cuenta B2B', error)
        return empty
      }

      const effective = record(raw)
      if (!effective.account_id) return empty

      return {
        hasSession,
        userId: null,
        accountId: text(effective, 'account_id'),
        role: nullableText(effective, 'role'),
        spendingLimit: nullableText(effective, 'spending_limit'),
      }
    },

    async resolveApproval(accountId: string, amount: string): Promise<PurchaseApproval> {
      // Con el cliente del LLAMANTE, igual que `my_business_accounts`: el
      // limite de la persona sale de `ebim.user_id()` dentro de la funcion, y
      // con `service_role` no habria usuario del que sacarlo.
      const raw = record(
        await caller('purchase_approval', {
          p_business_account_id: accountId,
          p_amount: amount,
        }),
      )
      return {
        required: raw.required === true,
        reason: nullableText(raw, 'reason'),
        purchaseOrderRequired: raw.purchase_order_required === true,
      }
    },

    /**
     * Con el cliente del LLAMANTE y no con `service`.
     *
     * Desde P19 el precio del acuerdo sale de la SESION dentro de
     * `ebim.build_quote`. Con `service` no hay sesion de la que salga, asi que
     * el pipeline cotizaria a precio de catalogo mientras el carrito guarda el
     * de convenio: el comprador B2B veria «el precio cambio» en cada compra, y
     * hacia arriba. Estas tres funciones son publicas —las llama el navegador
     * a diario— y ninguna de las dos primeras lleva limitador, asi que no hay
     * nada que `service` estuviera sorteando.
     */
    async resolvePrices(storeSlug: string, items: readonly OrderItemInput[]): Promise<Quote> {
      return toQuote(
        await caller('price_quote_for_slug', {
          p_store_slug: storeSlug,
          p_items: itemPayload(items),
        }),
      )
    },

    async resolvePriceDrift(storeSlug: string, cartToken: string): Promise<PriceDrift> {
      const raw = record(
        await caller('cart_price_drift', { p_store_slug: storeSlug, p_token: cartToken }),
      )
      const changed = Array.isArray(raw.changed) ? raw.changed : []
      return {
        changed: changed.map((entry) => {
          const line = record(entry)
          return {
            productId: text(line, 'product_id'),
            variantId: nullableText(line, 'variant_id'),
            uomCode: nullableText(line, 'uom_code'),
            was: text(line, 'was', '0.00'),
            now: text(line, 'now', '0.00'),
          }
        }),
      }
    },

    /**
     * P10 · el gancho vacío de P07 pasa a preguntar a la base.
     *
     * `promotion_quote_for_slug` es la MISMA función que usa el carrito de la
     * vitrina, y devuelve la cotización entera con el descuento aplicado y los
     * totales ya recalculados. Aquí no se suma ni se redondea nada: cualquier
     * aritmética en este archivo sería un segundo sitio donde el importe puede
     * salir distinto del que se cobra.
     *
     * Lo que este resultado NO es: una autorización. `create_order` vuelve a
     * evaluar, con los cerrojos puestos, y es su resultado el que se cobra.
     * Éste sirve para enseñárselo al comprador y para que el pipeline pueda
     * comprobar que los totales cuadran antes de llamar a una pasarela.
     */
    async resolvePromotions(input): Promise<PromotionResult> {
      const raw = record(
        await caller('promotion_quote_for_slug', {
          p_store_slug: input.context.storeSlug,
          p_items: itemPayload(input.items),
          p_coupon_codes: input.couponCodes.length > 0 ? input.couponCodes : null,
        }),
      )
      return toPromotionResult(raw)
    },

    async reserveInventory(input): Promise<Reservation> {
      const raw = record(
        await service('reserve_inventory_for_slug', {
          p_store_slug: input.storeSlug,
          p_reference_key: input.referenceKey,
          p_items: itemPayload(input.items),
          p_ttl_seconds: input.ttlSeconds,
        }),
      )
      return {
        reservationId: text(raw, 'reservation_id'),
        token: text(raw, 'token'),
        expiresAt: text(raw, 'expires_at'),
        created: raw.created !== false,
      }
    },

    /**
     * Etapa 7 · la entrega, resuelta contra la base (P12-SaaS).
     *
     * Sin elección de método cae al gancho neutro `alwaysDeliverable`, que es
     * el comportamiento de P06 a P11: entregable, transporte cero y sin
     * promesa. Un tenant que no ha configurado zonas ni métodos sigue vendiendo
     * exactamente igual — se degrada, no se rompe.
     *
     * Con elección, la autoridad es `delivery_options_for_slug`, que recalcula
     * el subtotal con el motor de precios ANTES de mirar la tarifa: ni el
     * importe ni el subtotal con el que se evalúa el envío gratis pueden venir
     * del navegador. Aquí no se suma ni se redondea nada, como en el resto de
     * este archivo.
     */
    async validateDelivery(input): Promise<DeliveryContext> {
      if (input.choice === null) {
        return alwaysDeliverable({
          context: input.context,
          address: input.address,
          account: input.account,
        })
      }

      // R01 · Con el cliente del LLAMANTE y no con `service`, por la misma razón
      // que `resolvePrices`: la RPC recalcula el subtotal con `ebim.build_quote`,
      // que resuelve el precio comercial desde la SESIÓN. Con `service_role` no
      // hay sesión, el subtotal salía a precio público y el umbral de envío
      // gratis se evaluaba con otro número que el de `create_order`: el checkout
      // autorizaba el cobro, el tope y la aprobación con un envío distinto del
      // que el pedido cobraba. La función está concedida a `anon` y
      // `authenticated` (la vitrina ya la llama así) y no recibe identidad.
      const quoted = record(
        await caller('delivery_options_for_slug', {
          p_store_slug: input.context.storeSlug,
          p_address: input.address,
          p_items: itemPayload(input.items),
        }),
      )

      const options = Array.isArray(quoted.options) ? quoted.options : []
      const chosen = options
        .map((entry) => record(entry))
        .find((entry) => text(entry, 'code') === input.choice?.methodCode)

      if (!chosen) {
        return {
          address: input.address,
          deliverable: false,
          // Código de dominio y no el texto del servidor: la vitrina lo traduce.
          reason: 'ENTREGA_NO_DISPONIBLE',
          amount: '0.00',
          methodCode: null,
          strategy: null,
          promisedFrom: null,
          promisedTo: null,
        }
      }

      const available = chosen.available === true
      return {
        address: input.address,
        deliverable: available,
        reason: available ? null : nullableText(chosen, 'reason') ?? 'FUERA_DE_COBERTURA',
        amount: text(chosen, 'amount', '0.00'),
        methodCode: text(chosen, 'code'),
        strategy: text(chosen, 'strategy'),
        promisedFrom: nullableText(chosen, 'promised_from'),
        promisedTo: nullableText(chosen, 'promised_to'),
      }
    },

    /**
     * P10 · canjear saldo de tarjeta regalo, de una en una y en orden.
     *
     * En orden y no en paralelo a propósito: dos canjes simultáneos contra dos
     * tarjetas distintas repartirían mal el resto —cada uno creería que le toca
     * cubrir el total— y el comercio acabaría cobrando de menos.
     *
     * La referencia es la clave de idempotencia del checkout más el índice de
     * la tarjeta: un reintento de la misma compra no vuelve a gastar saldo, y
     * dos tarjetas de la misma compra no comparten referencia.
     */
    async applyGiftCards(input): Promise<GiftCardTender> {
      const redemptions: GiftCardRedemption[] = []
      let pending = Math.round(Number(input.amount) * 100)

      for (const [index, code] of input.codes.entries()) {
        if (pending <= 0) break
        const reference = `${input.idempotencyKey}:gc:${index}`
        const raw = record(
          await service('gift_card_redeem', {
            p_store_slug: input.storeSlug,
            p_code: code,
            p_amount: (pending / 100).toFixed(2),
            p_reference: reference,
            p_order_id: null,
          }),
        )
        const applied = text(raw, 'applied', '0.00')
        if (Math.round(Number(applied) * 100) <= 0) continue
        redemptions.push({
          giftCardId: text(raw, 'gift_card_id'),
          last4: text(raw, 'last4'),
          applied,
          reference,
        })
        pending -= Math.round(Number(applied) * 100)
      }

      const total = redemptions.reduce(
        (acc, entry) => acc + Math.round(Number(entry.applied) * 100),
        0,
      )
      return {
        redemptions,
        applied: (total / 100).toFixed(2),
        remaining: (Math.max(pending, 0) / 100).toFixed(2),
      }
    },

    // El token viaja tal cual: este adaptador no lo mira ni lo guarda, solo
    // lo lleva del pipeline a la pasarela.
    authorizePayment: (request) => gateway.authorizePayment(request),

    async placeOrder(input): Promise<PlacedOrder> {
      const raw = record(
        await service('checkout_place_order', {
          p_intent_id: input.intentId,
          p_customer_email: input.request.customerEmail,
          p_items: itemPayload(input.request.items),
          p_customer_name: input.request.customerName,
          p_customer_phone: input.request.customerPhone,
          p_shipping_address: input.request.shippingAddress,
          p_notes: input.request.notes,
          p_reservation_token: input.reservationToken,
          p_payment:
            input.payment.status === 'not_required'
              ? null
              : {
                  status: input.payment.status,
                  provider_code: input.payment.providerCode,
                  provider_reference: input.payment.providerReference,
                },
          // La cuenta B2B la resolvio la SESION del comprador, no el cuerpo de
          // la peticion. La base vuelve a comprobar que sea de esta tienda.
          p_business_account_id: input.account.accountId,
          p_billing_address: input.request.billingAddress,
          p_approval:
            input.approval === null
              ? null
              : { required: input.approval.required, reason: input.approval.reason },
          // P10 · los códigos tecleados. Ni un importe: cuánto descuentan lo
          // decide `create_order`, que vuelve a evaluar con las filas delante
          // y bloqueadas. El navegador no puede declarar un descuento.
          p_coupon_codes:
            input.request.couponCodes.length > 0 ? [...input.request.couponCodes] : null,
          // P12 · la ELECCION de entrega. Ni importe, ni proveedor, ni almacen:
          // `create_order` vuelve a cotizar dentro de la transaccion, con la
          // fila de tarifa delante, y de ahi sale `orders.shipping_total`.
          p_delivery:
            input.request.delivery === null
              ? null
              : {
                  method_code: input.request.delivery.methodCode,
                  pickup_point_id: input.request.delivery.pickupPointId,
                  window: input.request.delivery.window
                    ? {
                        date: input.request.delivery.window.date,
                        starts_at: input.request.delivery.window.startsAt,
                        ends_at: input.request.delivery.window.endsAt,
                      }
                    : null,
                },
          // N05 · la orden de compra tecleada. `create_order` la valida y, si la
          // cuenta la exige y no llegó, no crea el pedido.
          p_purchase_order_number: input.request.purchaseOrderNumber ?? null,
        }),
      )
      const orderId = text(raw, 'order_id')

      // P09 · el cobro se ata al pedido AQUÍ, después de crearlo, porque ese es
      // el orden real: se cobra en la etapa 8 y el pedido nace en la 9.
      //
      // Está en el adaptador y no en el pipeline a propósito: el pipeline no
      // conoce el dominio de pagos y no debería aprender a conocerlo para
      // esto. Y **no puede tumbar la compra**: el pedido ya existe y el cobro
      // también; si el enlace falla, lo que hay es una fila sin `order_id` que
      // el backoffice ve y una persona ata, no una venta perdida.
      if (orderId !== '' && input.payment.intentId) {
        try {
          await service('payment_intent_attach_order', {
            p_intent_id: input.payment.intentId,
            p_order_id: orderId,
          })
        } catch (error) {
          console.error('[checkout] no se pudo atar el cobro al pedido', error)
        }
      }

      // P10 · el canje de tarjeta regalo se ata al pedido AQUÍ, por la misma
      // razón que el cobro: se canjea en la etapa 8 y el pedido nace en la 9.
      // Y tampoco puede tumbar la compra: el pedido existe y el saldo ya se
      // movió; si el enlace falla queda un asiento sin `order_id` que el
      // backoffice ve y una persona ata, no una venta perdida.
      if (orderId !== '' && input.giftCards) {
        for (const entry of input.giftCards.redemptions) {
          try {
            await service('gift_card_attach_order', {
              p_gift_card_id: entry.giftCardId,
              p_reference: entry.reference,
              p_order_id: orderId,
            })
          } catch (error) {
            console.error('[checkout] no se pudo atar el canje al pedido', error)
          }
        }
      }

      // Hardening H02 · quién compró, cuando compró con sesión.
      //
      // `orders` no guarda al usuario, y «Mis pedidos» del consumidor no puede
      // salir de filtrar por correo (un correo no prueba nada). El vínculo se
      // escribe AQUÍ, igual que el cobro y la tarjeta regalo: después del
      // pedido y sin poder tumbarlo.
      //
      // El usuario es el VERIFICADO: el de la etapa 2 si ya se comprobó, o el
      // que devuelve `current_buyer()` con el token del llamante, que PostgREST
      // valida antes de ejecutar. `hasSession` solo decide si merece la pena
      // preguntar; un token con la firma falsa no llega a responder.
      if (orderId !== '' && hasSession) {
        try {
          const buyer =
            input.account.userId ?? nullableText(record(await caller('current_buyer', {})), 'user_id')
          if (buyer) {
            await service('checkout_link_order_buyer', { p_order_id: orderId, p_user_id: buyer })
          }
        } catch (error) {
          console.error('[checkout] no se pudo vincular el pedido con su comprador', error)
        }
      }

      return {
        orderId,
        orderNumber: text(raw, 'order_number'),
        accessToken: nullableText(raw, 'access_token'),
        status: text(raw, 'status'),
        approvalStatus: text(raw, 'approval_status', 'not_required'),
        sourceChannel: text(raw, 'source_channel', 'storefront'),
        currency: text(raw, 'currency'),
        subtotal: text(raw, 'subtotal', '0.00'),
        taxTotal: text(raw, 'tax_total', '0.00'),
        shippingTotal: text(raw, 'shipping_total', '0.00'),
        grandTotal: text(raw, 'grand_total', '0.00'),
        items: Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [],
        delivery: raw.delivery === null || raw.delivery === undefined ? null : record(raw.delivery),
        purchaseOrderNumber: nullableText(raw, 'purchase_order_number'),
        replay: raw.replay === true,
      }
    },

    async releaseReservation(storeSlug: string, token: string) {
      await service('release_inventory_by_token', {
        p_store_slug: storeSlug,
        p_token: token,
      })
    },

    voidPayment: (outcome) => gateway.voidPayment(outcome),

    async releaseGiftCards(input) {
      // Cada devolución en su propio `try`: si una falla, las otras tienen que
      // intentarse igual. Es la misma regla que `unwind` aplica entre
      // compensaciones, aquí dentro de una sola.
      for (const entry of input.tender.redemptions) {
        try {
          await service('gift_card_release', {
            p_gift_card_id: entry.giftCardId,
            p_amount: entry.applied,
            p_reference: `${entry.reference}:release`,
          })
        } catch (error) {
          console.error('[checkout] no se pudo devolver el saldo de la tarjeta', error)
        }
      }
    },
  }
}

/** Traduce la respuesta de `promotion_quote_for_slug`. Traduce y nada más. */
function toPromotionResult(source: Record<string, unknown>): PromotionResult {
  const promos = record(source.promotions)
  const applied = Array.isArray(promos.applied) ? promos.applied : []
  const lines = Array.isArray(source.lines) ? source.lines : []

  return {
    adjustments: applied.map((entry) => {
      const item = record(entry)
      return {
        code: text(item, 'code'),
        label: text(item, 'label'),
        amount: text(item, 'amount', '0.00'),
        productId: null,
      }
    }),
    discountTotal: text(source, 'discount_total', '0.00'),
    lines: lines.map((entry, index) => {
      const line = record(entry)
      const adjustments = Array.isArray(line.adjustments) ? line.adjustments : []
      return {
        lineKey: Number(line.line_key ?? index + 1),
        discount: text(line, 'discount', '0'),
        adjustments: adjustments.map((raw) => {
          const item = record(raw)
          return {
            code: text(item, 'code'),
            label: text(item, 'label'),
            amount: text(item, 'amount', '0.00'),
            productId: nullableText(line, 'product_id'),
          }
        }),
      }
    }),
    coupons: (Array.isArray(promos.coupons) ? promos.coupons : []).map((entry) => {
      const item = record(entry)
      return { code: text(item, 'code'), status: text(item, 'status') }
    }),
    skipped: (Array.isArray(promos.skipped) ? promos.skipped : []).map((entry) => {
      const item = record(entry)
      return { code: text(item, 'code'), reason: text(item, 'reason') }
    }),
    totals: {
      subtotal: text(source, 'subtotal', '0.00'),
      discountTotal: text(source, 'discount_total', '0.00'),
      taxTotal: text(source, 'tax_total', '0.00'),
      grandTotal: text(source, 'grand_total', '0.00'),
    },
  }
}
