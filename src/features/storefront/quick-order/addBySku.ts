import type { CartApi } from '../cart/cart-context'
import { resolveOrderLines } from './api'
import { importIntoCart, type CartImportResult } from './importToCart'
import { buildReport, type AcceptedLine, type ValidLine } from './lines'

/**
 * SKU + cantidad → carrito, por el MISMO verificador que el pedido rápido.
 *
 * Lo usan el chat y la reposición: nada entra al carrito porque lo diga una
 * propuesta; entra porque `resolve_order_lines_for_slug` lo encuentra publicado
 * y vendible hoy en esta tienda. Lo que no pasa se cuenta en `rejected`.
 */
export async function addSkuLinesToCart(
  cart: Pick<CartApi, 'cart' | 'add' | 'setQuantity'>,
  store: { storeId: string; storeSlug: string },
  lines: readonly ValidLine[],
): Promise<{ result: CartImportResult; rejected: number; accepted: readonly AcceptedLine[] }> {
  const resolved = await resolveOrderLines({ storeSlug: store.storeSlug, lines })
  const report = buildReport(lines, [], resolved)
  const accepted = report.filter((l): l is AcceptedLine => l.status === 'ok')
  const result = await importIntoCart(cart, store, accepted)
  return { result, rejected: report.length - accepted.length, accepted }
}
