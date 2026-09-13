import { useMemo } from 'react'
import { useCartQuote } from '@/features/pricing/useCartQuote'
import type { PriceQuote } from '@/domain'
import { esAcuerdoDelComprador } from './agreement'
import { useCart } from './cart-context'

/** Constante y no `[]` en la firma: un array nuevo por render cambia la clave. */
const SIN_CUPONES: readonly string[] = []

/**
 * El carrito, con el precio que de verdad se va a cobrar.
 *
 * Existe porque el panel lateral y la página del carrito estaban contando cosas
 * distintas del MISMO carrito: la página preguntaba al servidor y el panel
 * sumaba los precios de escaparate que guarda el navegador. Con un acuerdo B2B
 * eso se veía —panel «S/ 79.60», página «S/ 71.64», un clic de diferencia—, y
 * dos totales para lo mismo en la misma sesión es lo que hace que alguien deje
 * de fiarse del número.
 *
 * La consulta es la misma y la clave también, así que el segundo que la pide no
 * gasta una llamada: la cotización del panel ya está en caché cuando se abre la
 * página, y al revés.
 */
export function useQuotedCart(
  storeSlug: string | undefined,
  /** Cupones confirmados. El carrito no los pide; el checkout sí. */
  coupons: readonly string[] = SIN_CUPONES,
): {
  quote: ReturnType<typeof useCartQuote>
  quoted: PriceQuote | null
  /** Alguna línea sale de un acuerdo del comprador (segmento o cliente). */
  discounted: boolean
} {
  const { cart, currency } = useCart()

  // El array entra en la clave de la consulta: uno nuevo por render la
  // invalidaría en bucle. Se arma con la forma del PUERTO, no con la del
  // transporte: quien cotiza puede ser mañana el ERP del tenant.
  const requests = useMemo(
    () =>
      cart.lines.map((line) => ({
        productId: line.product_id,
        variantId: line.variant_id,
        uomCode: null,
        quantity: line.quantity,
      })),
    [cart.lines],
  )

  const quote = useCartQuote(storeSlug, currency, requests, coupons)
  const quoted = quote.data ?? null

  return {
    quote,
    quoted,
    // Solo un acuerdo del comprador es «precio especial»: ver `agreement.ts`.
    discounted: quoted?.lines.some(esAcuerdoDelComprador) ?? false,
  }
}
