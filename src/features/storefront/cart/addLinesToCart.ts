import { fetchPublicProductsByIds, fetchPublicVariants } from '../api'
import { MAX_LINE_QUANTITY } from './cart'
import type { CartApi } from './cart-context'

export interface LineToAdd {
  readonly product_id?: string | null
  readonly variant_id?: string | null
  /** Número o decimal como texto: los sugeridos lo guardan así. */
  readonly quantity: number | string
}

/**
 * Manda líneas conocidas al carrito COMO SI SE AÑADIERAN HOY.
 *
 * Lo usan «pasar un sugerido al carrito» y «volver a comprar». En los dos casos
 * la regla es la misma y es la que protege el precio:
 *
 *  · De la línea de origen solo se toma QUÉ (producto, variante) y CUÁNTO. Ni
 *    un importe: el producto se vuelve a leer del catálogo público y el
 *    carrito lo recotiza contra el servidor, que es el único que decide.
 *  · Lo que ya no se vende —despublicado, sin la variante, sin stock según
 *    `cart.add`— no entra, y se cuenta. Meterlo igual sería descubrirlo en el
 *    último paso del checkout.
 */
export async function addLinesToCart(
  cart: Pick<CartApi, 'add'>,
  storeId: string,
  lines: readonly LineToAdd[],
): Promise<{ added: number; skipped: number }> {
  const conProducto = lines.filter((line): line is LineToAdd & { product_id: string } => Boolean(line.product_id))
  let skipped = lines.length - conProducto.length

  const productos = await fetchPublicProductsByIds(
    storeId,
    conProducto.map((line) => line.product_id),
  )
  const porId = new Map(productos.map((p) => [p.product_id, p]))

  let added = 0
  for (const linea of conProducto) {
    const producto = porId.get(linea.product_id)
    const cantidad = Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.round(Number(linea.quantity))))
    if (!producto) {
      skipped += 1
      continue
    }
    const variante = linea.variant_id
      ? ((await fetchPublicVariants(linea.product_id)).find((v) => v.variant_id === linea.variant_id) ?? null)
      : null
    if (linea.variant_id && !variante) {
      skipped += 1
      continue
    }
    if (await cart.add(producto, cantidad, variante)) added += 1
    else skipped += 1
  }
  return { added, skipped }
}
