/**
 * Claves de consulta del contexto comercial, en un módulo sin dependencias.
 *
 * Las comparten la barra de contexto (perezosa) y el precio comercial de la
 * rejilla (en la portada): importar la clave no puede arrastrar a la portada el
 * resto del módulo que la usa.
 */
export const commerceContextKey = (storeSlug: string) => ['storefront', 'commerce-context', storeSlug] as const

export const catalogPricesKey = (storeSlug: string, productIds: readonly string[]) =>
  ['pricing', 'catalog-overlay', storeSlug, productIds] as const
