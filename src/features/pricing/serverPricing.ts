import type { PriceContext, PriceQuote, PriceRequest, PricedLine, PricingPort } from '@/domain'
import { quotePublicCart, type PublicQuoteItem } from './api'

/**
 * `PricingPort` sobre el motor de la base (P04-SaaS).
 *
 * Es la PRIMERA implementación del puerto, y existe para que la vitrina no
 * hable con PostgREST directamente: el día que un tenant tarifique en su ERP
 * —`integration_providers` ya declara la operación `price.read`— lo que cambia
 * es qué implementación se inyecta, no el carrito.
 *
 * Lo que este adaptador NO hace, y es lo importante: no calcula. Traduce la
 * forma del transporte a la del dominio y nada más. Cualquier resta, redondeo o
 * conversión que apareciera aquí sería un segundo sitio donde el precio puede
 * salir distinto del que se cobra.
 */

function toItem(line: PriceRequest): PublicQuoteItem {
  // Las claves opcionales solo viajan si tienen valor: una línea de producto
  // simple sale del navegador exactamente igual que antes de esta fase.
  const item: PublicQuoteItem = { product_id: line.productId, quantity: line.quantity }
  if (line.variantId) item.variant_id = line.variantId
  if (line.uomCode) item.uom_code = line.uomCode
  return item
}

export const serverPricing: PricingPort = {
  async quote(context: PriceContext, lines: readonly PriceRequest[]): Promise<PriceQuote> {
    const result = await quotePublicCart({
      storeSlug: context.storeSlug,
      items: lines.map(toItem),
      couponCodes: context.couponCodes,
    })

    const priced: PricedLine[] = result.lines.map((line) => ({
      productId: line.product_id,
      variantId: line.variant_id,
      uomCode: line.uom_code,
      quantity: line.quantity,
      name: line.name,
      // El precio unitario llega con su moneda porque un `Money` sin moneda es
      // un número suelto, y un número suelto se acaba sumando con otro de otra.
      unitPrice: { amount: line.unit_price, currency: result.currency },
      compareAtPrice: line.compare_at_price
        ? { amount: line.compare_at_price, currency: result.currency }
        : null,
      netAmount: line.net_amount,
      taxRate: line.tax_rate,
      source: line.source,
      priceListCode: line.price_list_code,
      scope: line.scope,
      minQuantity: line.min_quantity,
    }))

    return {
      // La moneda la decide la TIENDA, no quien pregunta: `context.currency` es
      // lo que el carrito creía, y si no coincidiera, la que vale es esta.
      currency: result.currency,
      taxInclusive: result.tax_inclusive,
      lines: priced,
      netTotal: result.subtotal,
      discountTotal: result.discount_total,
      taxTotal: result.tax_total,
      grossTotal: result.grand_total,
      promotions: (result.promotions.applied ?? []).map((promo) => ({
        id: promo.promotion_id,
        code: promo.code,
        label: promo.label,
        amount: promo.amount,
        couponCode: promo.coupon_code,
      })),
    }
  },
}
