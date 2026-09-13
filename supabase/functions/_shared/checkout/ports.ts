/**
 * Los puertos del checkout.
 *
 * El orquestador (`pipeline.ts`) no sabe qué hay detrás de ninguna de estas
 * funciones: ni que el precio lo resuelve `ebim.resolve_price`, ni que la
 * existencia la aparta `reserve_inventory_for_slug`, ni —sobre todo— quién
 * cobra. **Ningún nombre de pasarela, transportista ni ERP aparece en este
 * archivo ni en ninguno de este directorio**, que es la misma regla que
 * `src/architecture.test.ts` impone sobre `src/`: los proveedores concretos son
 * filas de `integration_providers`, no tipos de TypeScript.
 *
 * Dos reglas más, heredadas de `src/domain/ports` (ADR 001):
 *
 *  1. **Ningún puerto recibe el tenant.** `organization_id` y `company_id`
 *     salen de la tienda dentro de la base. Un parámetro que se puede pasar se
 *     puede pasar mal.
 *  2. **Ninguno recibe un precio, un total ni un canal.** Todo lo que decide
 *     dinero lo devuelve el servidor; el pipeline lo transporta y lo compara,
 *     nunca lo calcula.
 *
 * Sobre la relación con `src/domain/ports/payment.ts`: es el mismo contrato,
 * escrito dos veces porque el borde corre en Deno y no puede importar de `src`.
 * `PaymentAuthorizationPort` es un subconjunto —autorizar y anular— y su
 * vocabulario de estados se compara con el del dominio en un test.
 */
import type { CheckoutStage } from './stages.ts'
import type { OrderItemInput, ShippingAddress } from '../orders.ts'

/** Importe decimal como TEXTO. El céntimo no pasa por un `number`. */
export type MoneyText = string

// ---------------------------------------------------------------------------
// 1 · Contexto
// ---------------------------------------------------------------------------
export interface CheckoutContext {
  readonly storeSlug: string
  readonly storeName: string
  readonly currency: string
  readonly channelCode: string
  readonly channelKind: string
  readonly requiresAuth: boolean
  /**
   * La tienda solo vende a quien ha iniciado sesion
   * (`store_settings.checkout_requires_account`).
   *
   * Distinta de `requiresAuth`, que es del CANAL: aquella dice que ese canal es
   * cerrado; esta, que este comercio no vende a desconocidos por ninguno.
   */
  readonly requiresAccount: boolean
  readonly taxInclusive: boolean
}

// ---------------------------------------------------------------------------
// 2 · Cliente / cuenta
// ---------------------------------------------------------------------------
/**
 * Lo que el SERVIDOR sabe de quien compra. No hay ningún campo que el navegador
 * pueda declarar: la cuenta B2B sale de `my_business_accounts()`, que desde P05
 * no acepta un solo argumento precisamente para que no exista la clase de error
 * que consiste en creerse el id que manda el cliente.
 */
export interface AccountContext {
  readonly hasSession: boolean
  /**
   * El usuario de la sesion VERIFICADA, o `null`.
   *
   * `hasSession` sale de leer el `sub` del token SIN comprobar la firma, asi
   * que sirve para decidir a quien preguntar y no para autorizar: cualquiera
   * puede escribir un JWT con un `sub` dentro. Esto lo responde la base con ese
   * mismo token, y PostgREST comprueba la firma antes. Lo que exige cuenta mira
   * este campo, nunca el otro.
   *
   * Opcional porque solo se pregunta cuando la tienda exige cuenta: en una
   * tienda abierta seria un viaje mas por compra para responder algo que nadie
   * usa. Ausente y `null` significan lo mismo aqui — «no se ha verificado
   * ninguna» — y por eso ningun sitio lo lee para autorizar.
   */
  readonly userId?: string | null
  readonly accountId: string | null
  readonly role: string | null
  /** Tope de autorización de la persona, como texto decimal. `null` = sin tope. */
  readonly spendingLimit: MoneyText | null
}

/**
 * ¿Esta compra necesita que alguien de la empresa la firme? (P08-SaaS)
 *
 * La respuesta la da `public.purchase_approval`, y se pide **con la sesión del
 * comprador** por la misma razón que la cuenta: el límite de la persona depende
 * de quién pregunta, y con `service_role` esa pregunta no tiene respuesta.
 *
 * Es una CONSULTA, no una decisión: no crea nada y no cambia ningún estado. Lo
 * que decide de verdad es la base, dentro de `create_order`, que además impone
 * el umbral de la CUENTA por su cuenta — este resultado solo puede AÑADIR una
 * aprobación, nunca quitarla.
 */
export interface PurchaseApproval {
  readonly required: boolean
  /** `user_limit`, `rule` o `account_threshold`. Nunca un texto libre. */
  readonly reason: string | null
  readonly purchaseOrderRequired: boolean
}

// ---------------------------------------------------------------------------
// 3 · Precio
// ---------------------------------------------------------------------------
export interface QuotedLine {
  readonly productId: string
  readonly variantId: string | null
  readonly uomCode: string | null
  readonly name: string
  readonly quantity: number
  readonly unitPrice: MoneyText
  readonly netAmount: MoneyText
  readonly taxRate: MoneyText
  readonly source: string
  readonly priceListCode: string | null
  readonly scope: string | null
}

export interface Quote {
  readonly currency: string
  readonly channelCode: string
  readonly taxInclusive: boolean
  readonly lines: readonly QuotedLine[]
  readonly subtotal: MoneyText
  readonly taxTotal: MoneyText
  readonly grandTotal: MoneyText
}

/**
 * Lineas cuyo precio ya no es el que el comprador vio.
 *
 * La referencia NO la pone el navegador: sale de
 * `cart_items.unit_price_snapshot`, que escribio el motor de precios cuando el
 * comprador toco el carrito por ultima vez. Es lo que permite avisar de un
 * cambio de precio **sin que ningun importe viaje en la peticion de compra**.
 */
export interface DriftedLine {
  readonly productId: string
  readonly variantId: string | null
  readonly uomCode: string | null
  readonly was: MoneyText
  readonly now: MoneyText
}

export interface PriceDrift {
  readonly changed: readonly DriftedLine[]
}

// ---------------------------------------------------------------------------
// 4 · Promociones (P10-SaaS: el gancho de P07 ya tiene motor detrás)
// ---------------------------------------------------------------------------
export interface PromotionAdjustment {
  readonly code: string
  readonly label: string
  readonly amount: MoneyText
  readonly productId: string | null
}

/** Un cupón tecleado y qué pasó con él. Nunca «el cliente dice que se aplicó». */
export interface CouponOutcome {
  readonly code: string
  /** `aplicado`, `no_existe`, `inactivo`, `fuera_de_vigencia`, `agotado`… */
  readonly status: string
}

/** Una campaña que NO se aplicó, y por qué. Es la mitad que nadie devuelve. */
export interface PromotionSkip {
  readonly code: string
  readonly reason: string
}

/** El descuento de una línea, con las campañas que lo compusieron. */
export interface PromotionLine {
  readonly lineKey: number
  readonly discount: MoneyText
  readonly adjustments: readonly PromotionAdjustment[]
}

/**
 * Los totales YA recalculados por el servidor.
 *
 * `undefined` = quien contestó no tiene motor de promociones detrás (el gancho
 * neutro de P07 sigue existiendo y sigue siendo válido para un comercio sin el
 * módulo). Con motor SIEMPRE vienen, y el pipeline los transporta sin
 * rehacerlos: rehacer el impuesto en TypeScript crearía una segunda autoridad
 * fiscal que discreparía de la primera el día que alguien cambie un redondeo.
 */
export interface PromotionTotals {
  readonly subtotal: MoneyText
  readonly discountTotal: MoneyText
  readonly taxTotal: MoneyText
  readonly grandTotal: MoneyText
}

export interface PromotionResult {
  readonly adjustments: readonly PromotionAdjustment[]
  readonly discountTotal: MoneyText
  readonly lines: readonly PromotionLine[]
  readonly coupons: readonly CouponOutcome[]
  readonly skipped: readonly PromotionSkip[]
  readonly totals?: PromotionTotals
}

// ---------------------------------------------------------------------------
// 5 · Impuesto
// ---------------------------------------------------------------------------
export interface TaxResult {
  readonly taxInclusive: boolean
  readonly subtotal: MoneyText
  /** P10. Con cero descuentos es `0.00`, que es lo que devolvía P07. */
  readonly discountTotal: MoneyText
  readonly taxTotal: MoneyText
  readonly grandTotal: MoneyText
}

// ---------------------------------------------------------------------------
// 6 · Existencia
// ---------------------------------------------------------------------------
export interface Reservation {
  readonly reservationId: string
  /** Secreto de 256 bits. Es lo único que permite reclamar ESTA reserva. */
  readonly token: string
  readonly expiresAt: string
  /** `false` = ya existía por la misma referencia (idempotencia de P06). */
  readonly created: boolean
}

// ---------------------------------------------------------------------------
// 7 · Entrega (P12-SaaS)
// ---------------------------------------------------------------------------
/**
 * Lo que el comprador ELIGE. Nunca lleva importe: cuánto cuesta ese método lo
 * decide `ebim.delivery_options` en el servidor, dos veces —una para
 * enseñárselo y otra, con la fila delante, para cobrárselo—.
 *
 * Es la misma forma que tienen `paymentMethodCode` y `couponCodes`: un código
 * del comercio y ningún número.
 */
export interface DeliveryChoice {
  readonly methodCode: string
  /** Obligatorio cuando la estrategia es `pickup`; lo comprueba la base. */
  readonly pickupPointId: string | null
  /** Franja elegida, ya resuelta a fecha. `null` = el método no la exige. */
  readonly window: {
    readonly date: string
    readonly startsAt: string
    readonly endsAt: string
  } | null
}

export interface DeliveryContext {
  readonly address: ShippingAddress
  readonly deliverable: boolean
  /** Motivo cuando no lo es. Sin nombres de transportista. */
  readonly reason: string | null
  /**
   * Lo que se le va a cobrar por la entrega, resuelto en el servidor. `'0.00'`
   * cuando la tienda no cobra transporte, que es lo que pasaba antes de P12.
   */
  readonly amount: MoneyText
  /** `null` cuando no se eligió método: el pedido nace sin promesa de entrega. */
  readonly methodCode: string | null
  readonly strategy: string | null
  readonly promisedFrom: string | null
  readonly promisedTo: string | null
}

// ---------------------------------------------------------------------------
// 7 bis · Tarjeta regalo (P10-SaaS)
//
// **No es un descuento, es un MEDIO DE PAGO.** Por eso vive aquí, junto al
// cobro, y no en el bloque de promociones: no baja el subtotal, no baja el
// impuesto y no toca `discount_total`. Lo único que hace es reducir cuánto hay
// que pedirle a la pasarela.
//
// Deja rastro FUERA de la transacción del pedido —el saldo ya se movió—, así
// que como la reserva de existencia y como el cobro, tiene compensación.
// ---------------------------------------------------------------------------
export interface GiftCardRedemption {
  readonly giftCardId: string
  /** Los cuatro últimos. El código entero no vuelve a salir de la base. */
  readonly last4: string
  readonly applied: MoneyText
  /** La misma referencia con la que se canjeó: es lo que hace idempotente el deshacer. */
  readonly reference: string
}

export interface GiftCardTender {
  readonly redemptions: readonly GiftCardRedemption[]
  readonly applied: MoneyText
  /** Lo que queda por cobrar por otra vía. Lo calcula el adaptador, no el pipeline. */
  readonly remaining: MoneyText
}

// ---------------------------------------------------------------------------
// 8 · Pago
// ---------------------------------------------------------------------------
/**
 * `not_required` es un estado de primera clase y no un `null`: «esta tienda
 * todavía no cobra en línea» es una decisión del comercio, no la ausencia de un
 * dato. Con `null` habría que preguntarse en cada rama si es que no hay
 * pasarela o si es que falló la que hay.
 */
/**
 * `captured` entra con P09: una pasarela configurada en un solo paso cobra y
 * autoriza a la vez, y llamar a eso `authorized` obligaría a preguntar en otro
 * sitio si el dinero está retenido o cobrado. La compensación es distinta
 * —anular contra devolver— y por eso el estado tiene que serlo también.
 */
export type PaymentStatus =
  | 'not_required'
  | 'authorized'
  | 'captured'
  | 'pending'
  | 'declined'

export interface PaymentRequest {
  readonly amount: MoneyText
  readonly currency: string
  /** La misma que ancla el intento. Viaja hasta el proveedor. */
  readonly idempotencyKey: string
  readonly customerEmail: string
  /** La tienda resuelve el tenant y el medio. Sale del contexto, no del cuerpo. */
  readonly storeSlug: string
  /**
   * Medio elegido por el comprador (`payment_methods.code` de ESA tienda).
   * `null` = la tienda no cobra en línea, que es lo que hacía P07 y sigue
   * siendo válido para un comercio sin pasarela contratada.
   */
  readonly methodCode: string | null
  /**
   * El instrumento tokenizado, cuando el medio lo necesita (tarjeta).
   *
   * Viaja desde el navegador porque es alli donde se crea: la pasarela lo
   * entrega a cambio de la tarjeta, dentro de su iframe. Aqui no hay ningun
   * dato de tarjeta, solo su referencia de un solo uso.
   */
  readonly providerToken?: string | null
}

export interface PaymentOutcome {
  readonly status: PaymentStatus
  /** Código del proveedor en `integration_providers`. Nunca su marca. */
  readonly providerCode: string | null
  readonly providerReference: string | null
  /** Código del proveedor tal cual, para conciliar. El texto del comprador es i18n. */
  readonly providerMessage: string | null
  /** Intento de pago de ESTE sistema (P09). `undefined` = no hubo dominio detrás. */
  readonly intentId?: string | null
  /** A dónde mandar al comprador si la pasarela exige 3DS. Lo compone el servidor. */
  readonly redirectUrl?: string | null
}

// ---------------------------------------------------------------------------
// 9 · Pedido
// ---------------------------------------------------------------------------
export interface PlacedOrder {
  readonly orderId: string
  readonly orderNumber: string
  readonly accessToken: string | null
  readonly status: string
  /** P08: `pending` = el pedido existe pero espera la firma de la empresa. */
  readonly approvalStatus: string
  readonly sourceChannel: string
  readonly currency: string
  readonly subtotal: MoneyText
  readonly taxTotal: MoneyText
  /** P12. `'0.00'` cuando la tienda no cobra transporte. */
  readonly shippingTotal: MoneyText
  readonly grandTotal: MoneyText
  readonly items: readonly Record<string, unknown>[]
  /**
   * Como y cuando llega, tal y como quedo congelado en el pedido. `null` = no
   * se eligio entrega, que es distinto de «entrega gratis».
   */
  readonly delivery: Record<string, unknown> | null
  /** N05: la orden de compra tal como quedó guardada en el pedido, o `null`. */
  readonly purchaseOrderNumber?: string | null
  readonly replay: boolean
}

// ---------------------------------------------------------------------------
// El conjunto
// ---------------------------------------------------------------------------
export interface CheckoutRequest {
  readonly storeSlug: string
  readonly idempotencyKey: string
  readonly requestHash: string
  readonly cartToken: string | null
  readonly customerName: string
  readonly customerEmail: string
  readonly customerPhone: string
  readonly shippingAddress: ShippingAddress
  /**
   * Dirección FISCAL. `null` = se factura donde se entrega, que es lo que pasa
   * en casi toda compra B2C. No es un dato de dinero: es una dirección, y por
   * eso sí puede venir del comprador.
   */
  readonly billingAddress: ShippingAddress | null
  readonly notes: string | null
  readonly items: readonly OrderItemInput[]
  /**
   * Medio de pago elegido (`payment_methods.code` de esta tienda). P09.
   *
   * Es un CÓDIGO del comercio, no una instrucción de cobro: no lleva importe,
   * ni proveedor, ni credencial. Cuánto se cobra lo sigue decidiendo el motor
   * de precios y con qué pasarela lo dice la fila del medio, no el navegador.
   * `null` = la tienda no cobra en línea.
   */
  readonly paymentMethodCode: string | null
  /**
   * El instrumento tokenizado, cuando el medio lo necesita (tarjeta).
   *
   * Opcional: la inmensa mayoria de las compras —transferencia, efectivo,
   * credito— no tokenizan nada, y exigirlo obligaria a escribir `null` en
   * cada llamada que nunca vera una tarjeta.
   */
  readonly paymentToken?: string | null
  /**
   * Los códigos de cupón que el comprador tecleó. P10.
   *
   * Es lo ÚNICO de las promociones que entra desde fuera, y entra como TEXTO:
   * ni importe, ni campaña, ni «ya aplicada». Que descuente y cuánto lo decide
   * `ebim.evaluate_promotions` dentro de la transacción del pedido.
   */
  readonly couponCodes: readonly string[]
  /**
   * Los códigos de tarjeta regalo. P10.
   *
   * Van aparte de los cupones porque son otra cosa: un cupón cambia el PRECIO y
   * una tarjeta paga una PARTE del precio. Mezclarlos en un solo campo
   * obligaría al servidor a adivinar cuál es cuál, y adivinar mal significa
   * cobrar de menos o falsear la base imponible.
   */
  readonly giftCardCodes: readonly string[]
  /**
   * Cómo quiere que le llegue. P12.
   *
   * `null` = no eligió, y entonces el pedido nace con transporte cero y sin
   * promesa de entrega — exactamente como antes de esta fase. Un tenant que no
   * ha configurado métodos sigue vendiendo.
   */
  readonly delivery: DeliveryChoice | null
  /**
   * N05 · Número de orden de compra del comprador B2B. Una REFERENCIA
   * comercial: no identifica a nadie ni fija un importe. `null` = no se
   * tecleó. Si la cuenta la exige, la base se niega a crear el pedido sin ella.
   * Opcional en el tipo para no obligar a escribir `null` en cada llamada que
   * nunca será B2B.
   */
  readonly purchaseOrderNumber?: string | null
}

export interface IntentClaim {
  readonly intentId: string
  readonly replay: boolean
  readonly attempt: number
  /** Respuesta ya construida del intento que salió bien. Solo si `replay`. */
  readonly result: Record<string, unknown> | null
}

export interface CheckoutPorts {
  // Idempotencia: no es una etapa, es lo que envuelve a las once.
  begin(request: CheckoutRequest): Promise<IntentClaim>
  markStage(intentId: string, stage: CheckoutStage, reservationToken?: string): Promise<void>
  failIntent(
    intentId: string,
    stage: CheckoutStage,
    code: string,
    detail: string,
  ): Promise<void>

  // Las once etapas, en el orden de `CHECKOUT_STAGES`.
  resolveContext(storeSlug: string): Promise<CheckoutContext>
  /**
   * La cuenta B2B EFECTIVA de la sesión en ESTA tienda (N01): la misma regla
   * que fija el precio (`ebim.effective_business_account`), nunca «la primera
   * de la lista».
   */
  resolveAccount(storeSlug: string): Promise<AccountContext>
  /** Quien compra, segun la base y con el token del llamante. */
  verifyBuyer(): Promise<string | null>
  resolvePrices(storeSlug: string, items: readonly OrderItemInput[]): Promise<Quote>
  /**
   * Solo tiene sentido con un carrito de servidor detras: sin snapshot no hay
   * con que comparar. Sin carrito devuelve la lista vacia, que es la respuesta
   * honesta y no un "no cambio nada".
   */
  resolvePriceDrift(storeSlug: string, cartToken: string): Promise<PriceDrift>
  resolvePromotions(input: {
    context: CheckoutContext
    account: AccountContext
    quote: Quote
    /** Lo que el comprador tecleó. El servidor decide si vale. */
    couponCodes: readonly string[]
    /** Para el tope por cliente, que no se puede cumplir sin saber quién compra. */
    customerEmail: string
    items: readonly OrderItemInput[]
  }): Promise<PromotionResult>
  reserveInventory(input: {
    storeSlug: string
    referenceKey: string
    items: readonly OrderItemInput[]
    ttlSeconds: number
  }): Promise<Reservation>
  /**
   * Etapa 7 · ¿se puede entregar, y por cuánto?
   *
   * Recibe la ELECCIÓN y las líneas —no un importe— y devuelve el coste ya
   * resuelto. Las líneas hacen falta porque el umbral de envío gratis y la
   * tarifa por peso dependen de lo que se compra, y el subtotal con el que se
   * evalúan lo recalcula el servidor: si viniera en la petición, el envío
   * gratis lo decidiría el navegador.
   */
  validateDelivery(input: {
    context: CheckoutContext
    address: ShippingAddress
    account: AccountContext
    choice: DeliveryChoice | null
    items: readonly OrderItemInput[]
  }): Promise<DeliveryContext>
  /**
   * Etapa 8a · la tarjeta regalo, ANTES de la pasarela.
   *
   * Antes y no después porque lo que se le pide a la pasarela es el RESTO: al
   * revés habría que cobrar el total y devolver la diferencia, que es un
   * movimiento de dinero de más y una comisión de más en cada compra.
   */
  applyGiftCards(input: {
    storeSlug: string
    codes: readonly string[]
    amount: MoneyText
    idempotencyKey: string
  }): Promise<GiftCardTender>
  authorizePayment(request: PaymentRequest): Promise<PaymentOutcome>
  /**
   * Solo se pregunta cuando hay cuenta B2B. Un comprador anónimo no tiene a
   * quién pedirle una firma, y preguntarlo igual sería inventar un circuito de
   * aprobación para el 99% de las compras (regla de la fase: la aprobación B2B
   * no contamina B2C).
   */
  resolveApproval(accountId: string, amount: MoneyText): Promise<PurchaseApproval>
  placeOrder(input: {
    intentId: string
    request: CheckoutRequest
    reservationToken: string | null
    payment: PaymentOutcome
    account: AccountContext
    approval: PurchaseApproval | null
    /** P10. `null` = no se canjeó ninguna; el pedido no cambia por ello. */
    giftCards: GiftCardTender | null
  }): Promise<PlacedOrder>

  // Compensaciones. Existen porque las etapas 6 y 8 dejan rastro fuera de la
  // transacción del pedido, y ese rastro hay que poder deshacerlo.
  releaseReservation(storeSlug: string, token: string): Promise<void>
  voidPayment(outcome: PaymentOutcome): Promise<void>
  /**
   * Deshacer el canje de tarjeta regalo. Saldo gastado sin pedido detrás es
   * dinero del comprador que se quedó el comercio, y es el único de los tres
   * efectos compensables que el comprador NO puede reclamar por su cuenta: una
   * reserva caduca sola y un cobro se ve en el extracto, pero un saldo perdido
   * no deja rastro que el comprador pueda enseñar.
   */
  releaseGiftCards(input: { storeSlug: string; tender: GiftCardTender }): Promise<void>
}
