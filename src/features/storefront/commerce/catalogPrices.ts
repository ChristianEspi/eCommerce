import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSessionContext } from '@/features/auth/session-context'
import type { PublicProduct } from '../types'
import type { CommercialPriceLabel } from './catalogQuote'
import { catalogPricesKey } from './keys'

/**
 * El precio comercial en la rejilla y en las filas, SIN N+1 (N03).
 *
 * La tarjeta lee `public_products`, una vista sin parámetros: enseña el precio
 * público a todo el mundo. Un comercio o una empresa con convenio descubría su
 * precio al abrir la ficha. Esto lo adelanta sin crear otra autoridad:
 *
 *  · UNA cotización por colección con `price_quote_for_slug` —la misma función
 *    en lote que usan la ficha, el carrito y el pedido—, cantidad 1 por
 *    producto. Nunca una por tarjeta.
 *  · Solo si el SERVIDOR dijo que esta sesión tiene condiciones comerciales
 *    vigentes en esta tienda (`my_commerce_context.has_commercial_pricing`,
 *    la misma consulta y la misma caché que la barra de contexto). El invitado
 *    no pregunta nada; el consumidor con sesión, nada que la barra no pregunte
 *    ya.
 *  · Los productos con variantes NO se cotizan: la tarjeta no sabe qué variante
 *    es y no se inventa una. Siguen con su precio público o «desde».
 *  · Solo se pinta un precio si viene de una lista y MEJORA el público. Igual o
 *    peor no añade ruido.
 *
 * Lo que devuelve esto solo se PINTA: el carrito y el checkout vuelven a
 * cotizar con el servidor, así que este número no puede llegar a cobrarse.
 *
 * La clave cuelga de `['pricing']`: al cambiar de cuenta (N01) se invalida con
 * el resto de cotizaciones y se vuelve a pedir, contexto incluido.
 *
 * Lo que pesa —contexto, audiencia, la llamada— va en `catalogQuote.ts` y se
 * carga solo con sesión: la portada del visitante anónimo no paga por esto.
 */

/** El mismo techo que `ebim.build_quote`: más líneas serían un error del servidor, no una cotización. */
export const CATALOG_QUOTE_LIMIT = 100

export type { CommercialPriceLabel }

export interface CommercialPrice {
  readonly amount: number
  readonly label: CommercialPriceLabel
}

const EMPTY: ReadonlyMap<string, CommercialPrice> = new Map()

/**
 * Precio comercial por `product_id` para una colección de productos a la vista.
 * Mapa vacío mientras no hay nada que decir (y siempre para invitado/consumidor).
 */
export function useCatalogCommercialPrices(
  storeSlug: string,
  products: readonly PublicProduct[],
): ReadonlyMap<string, CommercialPrice> {
  const queryClient = useQueryClient()
  const { status } = useSessionContext()
  const authenticated = status === 'authenticated'

  // Únicos, sin variantes, en orden estable y dentro del techo: la misma
  // colección pintada dos veces (una fila que se repite para girar) es UNA clave.
  const productIds = useMemo(() => {
    if (!authenticated) return []
    const ids = new Set<string>()
    for (const product of products) {
      if (product.kind !== 'variant') ids.add(product.product_id)
    }
    return [...ids].sort().slice(0, CATALOG_QUOTE_LIMIT)
  }, [authenticated, products])

  const quote = useQuery({
    queryKey: catalogPricesKey(storeSlug, productIds),
    queryFn: () => import('./catalogQuote').then((m) => m.quoteCatalog(queryClient, storeSlug, productIds)),
    enabled: authenticated && storeSlug !== '' && productIds.length > 0,
    retry: false,
    staleTime: 60_000,
  })

  return useMemo(() => {
    const data = authenticated ? quote.data : undefined
    if (!data?.label || data.lines.length === 0) return EMPTY
    const publicPrice = new Map(products.map((product) => [product.product_id, Number(product.price)]))
    const prices = new Map<string, CommercialPrice>()
    for (const line of data.lines) {
      const reference = publicPrice.get(line.productId)
      if (reference !== undefined && line.amount < reference) {
        prices.set(line.productId, { amount: line.amount, label: data.label })
      }
    }
    return prices
  }, [authenticated, quote.data, products])
}
