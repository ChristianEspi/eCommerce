import type { ExcelBook, Translate } from '@/shared/lib/excel'
import type { ProductMaster } from './types'

/**
 * Exportación del catálogo a Excel (antes CSV).
 *
 * Lo mismo que se ve en el listado de maestros (ADR 018). Sin precio, slug ni
 * categoría: son de cada tienda, y una sola columna de precio en un libro de
 * maestros sería el precio de ninguna tienda en concreto.
 *
 * El stock solo va en el producto simple: el maestro de variantes y el kit no
 * llevan existencia propia, y escribir su 0 sería afirmar que no hay (el
 * listado enseña «—» por la misma razón).
 */
export function productsBook(products: readonly ProductMaster[], t: Translate): ExcelBook {
  return {
    fileName: t('exports.catalog.sheet').toLowerCase(),
    guide: { title: t('exports.catalog.title'), paragraphs: [t('exports.catalog.intro')] },
    sheets: [
      {
        name: t('exports.catalog.sheet'),
        columns: [
          { header: t('exports.catalog.col.sku'), description: t('exports.catalog.desc.sku'), format: 'text' },
          { header: t('exports.catalog.col.name'), description: t('exports.catalog.desc.name'), format: 'text', width: 40 },
          { header: t('exports.catalog.col.kind'), description: t('exports.catalog.desc.kind'), format: 'text' },
          { header: t('exports.catalog.col.brand'), description: t('exports.catalog.desc.brand'), format: 'text' },
          { header: t('exports.catalog.col.family'), description: t('exports.catalog.desc.family'), format: 'text' },
          { header: t('exports.catalog.col.stock'), description: t('exports.catalog.desc.stock'), format: 'decimal' },
          { header: t('exports.catalog.col.published'), description: t('exports.catalog.desc.published'), format: 'integer' },
          { header: t('exports.catalog.col.stores'), description: t('exports.catalog.desc.stores'), format: 'text' },
          { header: t('exports.catalog.col.state'), description: t('exports.catalog.desc.state'), format: 'text' },
        ],
        rows: products.map((product) => [
          product.sku,
          product.name,
          t(`catalog.kind.${product.kind}`),
          product.brand_name ?? null,
          product.family_name ?? null,
          product.kind === 'simple' ? product.stock : null,
          product.published_count,
          product.published_store_names.join(' | ') || null,
          t(`catalog.status.${product.publication_state}`),
        ]),
      },
    ],
  }
}
