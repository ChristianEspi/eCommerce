import { toCsv } from '@/shared/lib/csv'
import type { ProductMaster } from './types'

/**
 * Exportación del catálogo. El escapado y la descarga viven en
 * `shared/lib/csv` desde P07: los usa igual el listado de pedidos.
 */
export { escapeCsvField, downloadCsv } from '@/shared/lib/csv'

/**
 * Lo mismo que se ve en el listado de maestros (ADR 018). Sin precio, slug ni
 * categoría: son de cada tienda, y una sola columna de precio en un CSV de
 * maestros sería el precio de ninguna tienda en concreto.
 */
const HEADERS = ['sku', 'name', 'kind', 'brand', 'family', 'stock', 'published_stores', 'stores', 'state'] as const

export function productsToCsv(products: ProductMaster[]): string {
  return toCsv(
    HEADERS,
    products.map((product) => [
      product.sku,
      product.name,
      product.kind,
      product.brand_name ?? '',
      product.family_name ?? '',
      String(product.stock),
      String(product.published_count),
      product.published_store_names.join(' | '),
      product.publication_state,
    ]),
  )
}
