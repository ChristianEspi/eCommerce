import type { CurrencyCode, Money, MoneyAmount, Quantity } from '../money'

/**
 * `PricingPort` — cuánto cuesta una línea ANTES de promociones.
 *
 * Por qué existe la frontera: hasta P03 el precio era `products.price`, una
 * columna escalar del producto, y quien la aplicaba de verdad era `create_order`
 * en la base. P04 trae el motor de listas —canal, segmento, cliente, cantidad,
 * moneda y vigencia— y `integration_providers` declara `price.read` para los dos
 * adaptadores de ERP: un tenant que tarifica en su sistema de gestión quiere ese
 * precio, no una copia que se desincroniza. Tres implementaciones de la misma
 * pregunta son una frontera, no una capa de más.
 *
 * Cuatro reglas que este contrato fija:
 *
 *  1. **Devuelve el desglose, no un total.** Un total sin `unitPrice`,
 *     `netAmount` y `taxRate` por línea no puede reconstruir una factura, y ese
 *     es exactamente el hueco que la auditoría de P00 encontró en `order_items`.
 *     Desde P04 el desglose incluye además POR QUÉ costó eso: qué lista y con
 *     qué alcance.
 *
 *     Lo que NO hay es un importe de impuesto POR LÍNEA, y es deliberado: el
 *     impuesto se redondea por GRUPO DE TASA, no línea a línea. Un `taxAmount`
 *     de línea sería una cifra que no suma el total, o sea una cifra inventada
 *     que alguien acabaría citando en una factura.
 *  2. **No aplica descuentos.** Promociones son una capa posterior (P10) que
 *     recibe este resultado. Mezclarlas produce un motor que nadie puede
 *     explicar cuando un precio sale mal.
 *  3. **No recibe el tenant.** Ni aquí ni en ningún otro puerto: la
 *     organización y la sociedad salen del JWT en el servidor. Un parámetro que
 *     se puede pasar se puede pasar mal.
 *  4. **No recibe el canal, el segmento ni el cliente.** Los tres cambian el
 *     precio, y los tres los deriva el SERVIDOR del contexto de la petición: el
 *     canal de la tienda, el segmento y el cliente de la sesión. Un contexto de
 *     precio que el llamante puede rellenar es un descuento que el llamante se
 *     puede conceder.
 */

/**
 * Lo único que el llamante puede declarar sobre el ALCANCE de la cotización: de
 * qué tienda es el carrito. Es público por definición —está en la URL— y el
 * servidor lo traduce a una tienda activa.
 */
export interface PriceContext {
  readonly storeSlug: string
  /** Moneda en la que se pide la cotización. La resuelve la tienda, no el comprador. */
  readonly currency: CurrencyCode
  /**
   * Cupones TECLEADOS por el comprador.
   *
   * La única excepción a la regla de arriba, y no la contradice: un cupón no es
   * contexto que el servidor pueda derivar —nace de que alguien escribe un
   * código— y lo que el navegador manda es el texto, no el descuento. Quien
   * decide si vale, cuánto rebaja y si queda saldo sigue siendo la base.
   */
  readonly couponCodes?: readonly string[]
}

export interface PriceRequest {
  readonly productId: string
  /** Variante elegida. `null` para el producto simple y para el kit. */
  readonly variantId: string | null
  /** Presentación de venta (`CAJA`, `PACK`). `null` = unidad implícita. */
  readonly uomCode: string | null
  readonly quantity: Quantity
}

/** De dónde salió el precio. */
export type PriceSource = 'catalog' | 'price_list' | 'erp'

/** Alcance del acuerdo que ganó, de más específico a menos. */
export type PriceScope = 'customer' | 'segment' | 'channel' | 'store'

export interface PricedLine {
  readonly productId: string
  readonly variantId: string | null
  readonly uomCode: string | null
  readonly quantity: Quantity
  /** Nombre de lo que se cotiza, ya resuelto (producto · variante). */
  readonly name: string
  /** Precio unitario vigente, sin impuesto. */
  readonly unitPrice: Money
  /** Precio de referencia tachado, si lo hay. */
  readonly compareAtPrice: Money | null
  /** Base imponible de la línea: `unitPrice * quantity`. */
  readonly netAmount: MoneyAmount
  /** Tasa aplicada, como decimal en texto (`"0.18"`). Cero es una tasa válida. */
  readonly taxRate: MoneyAmount
  /**
   * De dónde salió el precio. No es decorativo: cuando un comercio reclama por
   * un importe, la primera pregunta es si lo puso la lista o el ERP.
   */
  readonly source: PriceSource
  /** Código de la lista que ganó, si ganó una. */
  readonly priceListCode: string | null
  /** Alcance por el que ganó. Es la mitad de la explicación del precio. */
  readonly scope: PriceScope | null
  /** Escala aplicada, en unidades base. `null` cuando no hubo lista. */
  readonly minQuantity: MoneyAmount | null
}

/** Una campaña que entró en el total, con lo que rebajó. */
export interface AppliedPromotion {
  readonly id: string | null
  readonly code: string | null
  /** Nombre de cara al comprador. */
  readonly label: string | null
  readonly amount: MoneyAmount | null
  /** El cupón que la activó, si hizo falta teclear uno. */
  readonly couponCode: string | null
}

export interface PriceQuote {
  readonly currency: CurrencyCode
  /** `true` = los importes de línea ya llevan impuesto dentro. */
  readonly taxInclusive: boolean
  readonly lines: readonly PricedLine[]
  readonly netTotal: MoneyAmount
  /**
   * Lo que rebajan las campañas. Va aparte del subtotal a propósito: la
   * identidad que cobra `create_order` es `subtotal + impuesto - descuento`, y
   * mezclarlo en el neto haría imposible enseñarle al comprador de dónde sale.
   */
  readonly discountTotal: MoneyAmount
  readonly taxTotal: MoneyAmount
  readonly grossTotal: MoneyAmount
  /** Las campañas aplicadas, para poder nombrarlas. */
  readonly promotions: readonly AppliedPromotion[]
}

export interface PricingPort {
  /**
   * Cotiza el conjunto de líneas de una vez.
   *
   * En lote y no línea a línea a propósito: una lista con escalado por cantidad
   * o un ERP con precio de pedido completo no pueden responder correctamente si
   * solo ven una línea, y N llamadas a un ERP por un carrito de N artículos es
   * la forma más rápida de agotar su cupo de sesiones.
   */
  quote(context: PriceContext, lines: readonly PriceRequest[]): Promise<PriceQuote>
}
