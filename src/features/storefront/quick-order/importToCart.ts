import { fetchPublicAvailability } from '@/features/inventory/api'
import { addLinesToCart } from '../cart/addLinesToCart'
import { lineKey, type CartLine } from '../cart/cart'
import type { CartApi } from '../cart/cart-context'
import type { AcceptedLine } from './lines'

/**
 * Pasar al carrito lo que el servidor aceptó, de forma REPETIBLE.
 *
 * ## El problema
 *
 * `cart.add` —y por tanto `addLinesToCart`— SUMA: dos veces «1 silla» son dos
 * sillas, que es lo que se espera de un botón «añadir». Para una carga es justo
 * lo contrario de lo que se espera: quien importa `pedido.csv`, ve que falló la
 * red y lo vuelve a importar, NO pidió el doble. Una importación que duplica al
 * reintentar enseña a no reintentar.
 *
 * ## La regla: la cantidad del archivo se FIJA, no se suma
 *
 * Tras importar, cada artículo aceptado queda en el carrito con la cantidad de
 * la hoja, esté o no de antes. Tres casos:
 *
 *  · **no estaba** → entra por `addLinesToCart`, el camino de «volver a
 *    comprar» y de los sugeridos: relee el producto del catálogo público y
 *    pregunta existencia antes de añadir;
 *  · **estaba con otra cantidad** → se fija con `setQuantity`, después de
 *    preguntar la existencia de la cantidad NUEVA (la misma cortesía que
 *    `cart.add`: si la consulta falla, se fija igual y decide el checkout);
 *  · **estaba con la misma** → no se toca: es exactamente el reintento.
 *
 * Lo que no viene en el archivo no se quita del carrito: importar es añadir
 * una hoja, no sustituir el carrito entero.
 *
 * Nada de esto decide precio, crédito ni aprobación: eso sigue siendo del
 * checkout oficial, que es por donde acaba pasando todo lo que entra aquí.
 */

export interface CartImportPlan {
  readonly toAdd: readonly AcceptedLine[]
  readonly toSet: readonly AcceptedLine[]
  readonly unchanged: readonly AcceptedLine[]
}

export interface CartImportResult {
  /** Artículos que no estaban y entraron. */
  readonly added: number
  /** Artículos que ya estaban y quedaron con la cantidad del archivo. */
  readonly updated: number
  /** Ya estaban con esa cantidad: el reintento no los tocó. */
  readonly unchanged: number
  /** Aceptados por el SKU pero que el carrito no admitió (sin existencia, despublicados). */
  readonly skipped: number
}

export function planCartImport(
  current: readonly Pick<CartLine, 'product_id' | 'variant_id' | 'quantity'>[],
  accepted: readonly AcceptedLine[],
): CartImportPlan {
  const inCart = new Map(current.map((line) => [lineKey(line), line.quantity]))
  const toAdd: AcceptedLine[] = []
  const toSet: AcceptedLine[] = []
  const unchanged: AcceptedLine[] = []

  for (const line of accepted) {
    const quantity = inCart.get(lineKey(line))
    if (quantity === undefined) toAdd.push(line)
    else if (quantity === line.quantity) unchanged.push(line)
    else toSet.push(line)
  }
  return { toAdd, toSet, unchanged }
}

export async function importIntoCart(
  cart: Pick<CartApi, 'cart' | 'add' | 'setQuantity'>,
  store: { storeId: string; storeSlug: string },
  accepted: readonly AcceptedLine[],
): Promise<CartImportResult> {
  const plan = planCartImport(cart.cart.lines, accepted)

  let skipped = 0
  let updated = 0
  if (plan.toSet.length > 0) {
    let availability: Awaited<ReturnType<typeof fetchPublicAvailability>> = []
    try {
      availability = await fetchPublicAvailability({
        storeSlug: store.storeSlug,
        items: plan.toSet.map((line) => ({
          product_id: line.product_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
        })),
      })
    } catch (error) {
      // Consultiva, como en `cart.add`: sin respuesta se fija igual.
      console.error('[pedido rapido] no se pudo comprobar la existencia', error)
    }
    const noHay = new Set(
      availability.filter((row) => !row.unknown && !row.in_stock).map((row) => lineKey(row)),
    )
    for (const line of plan.toSet) {
      if (noHay.has(lineKey(line))) {
        skipped += 1
        continue
      }
      cart.setQuantity(line.product_id, line.quantity, line.variant_id)
      updated += 1
    }
  }

  const added = plan.toAdd.length > 0 ? await addLinesToCart(cart, store.storeId, plan.toAdd) : { added: 0, skipped: 0 }

  return {
    added: added.added,
    updated,
    unchanged: plan.unchanged.length,
    skipped: skipped + added.skipped,
  }
}
