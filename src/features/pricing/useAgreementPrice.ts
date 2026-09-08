import { useMemo } from 'react'
import { useSessionContext } from '@/features/auth/session-context'
import { useCartQuote } from './useCartQuote'

/**
 * El precio que ESTE comprador tiene acordado para UN producto.
 *
 * La rejilla y la ficha leen `public_products`, que es una vista y no recibe
 * parámetros: por eso enseñaban el precio de catálogo a todo el mundo, y un
 * cliente con convenio no veía su precio hasta el carrito. Aquí la ficha
 * pregunta por su único producto —una línea, no un catálogo— y ya puede decirlo
 * donde se decide la compra.
 *
 * **Solo con sesión.** Un visitante anónimo no tiene acuerdo que resolver, así
 * que no se le gasta una llamada: la lista de líneas queda vacía y la consulta
 * ni se dispara. Ese es el motivo por el que esto se puede permitir en la ficha
 * y seguiría sin poderse en la rejilla, donde son cuarenta productos por página
 * y la mayoría de las visitas son anónimas.
 *
 * Devuelve `null` cuando no hay nada que contar: sin sesión, sin acuerdo, o con
 * un acuerdo que no mejora el precio público. Enseñar «tu precio» junto a un
 * número igual —o peor— sería ruido, y ruido que además desconfía.
 */
export function useAgreementPrice(
  storeSlug: string | undefined,
  product: { product_id: string; price: string; currency: string } | null,
): { amount: number; currency: string } | null {
  const { status } = useSessionContext()
  const productId = product?.product_id ?? null
  const preguntar = status === 'authenticated' && productId !== null

  // Una sola línea, cantidad 1: es el precio que anuncia la ficha. Las escalas
  // por volumen viven en el carrito, donde ya se sabe cuántas unidades van.
  const lines = useMemo(
    () =>
      preguntar && productId
        ? [{ productId, variantId: null, uomCode: null, quantity: 1 }]
        : [],
    [preguntar, productId],
  )

  const quote = useCartQuote(storeSlug, product?.currency ?? '', lines)

  const linea = quote.data?.lines[0]
  if (!product || !linea || linea.source !== 'price_list') return null

  const acordado = Number(linea.unitPrice.amount)
  if (!Number.isFinite(acordado) || acordado >= Number(product.price)) return null

  return { amount: acordado, currency: quote.data?.currency ?? product.currency }
}
