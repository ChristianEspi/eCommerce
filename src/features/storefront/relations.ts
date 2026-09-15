import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { PRODUCT_RELATIONS_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { StorefrontError, fetchPublicProductsByIds, storefrontClient } from './api'
import type { PublicProduct } from './types'

/**
 * Relaciones que el comercio curó, pintadas en la ficha.
 *
 * ## De dónde salen
 *
 * `product_relations_for_slug` (migración 20260914140000) devuelve SOLO ids,
 * tipo y posición de los relacionados que el comprador puede ver: publicados,
 * de la tienda que nombra el slug y visibles en su canal público. La ficha de
 * cada uno —precio resuelto, disponibilidad, foto— la sirve después
 * `public_products` con `fetchPublicProductsByIds`, igual que los favoritos.
 * Pedir aquí esos campos sería una segunda fuente de la misma verdad.
 *
 * ## Por qué con el cliente ANÓNIMO
 *
 * La función la ejecutan `anon` y `authenticated`, y lo que responde no depende
 * de quién pregunta: el cliente de la vitrina, sin sesión, es el correcto y el
 * que ya lee `public_products`.
 *
 * ## Tres filas, no seis
 *
 * Seis tipos son vocabulario del backoffice; a un comprador le sirven tres
 * preguntas: «¿qué más hay parecido?» (relacionado, sustituto), «¿qué me falta
 * para usarlo?» (venta cruzada, accesorio, repuesto) y «¿hay algo mejor?»
 * (venta superior).
 */

export const RELATION_KINDS = [
  'related',
  'cross_sell',
  'up_sell',
  'accessory',
  'substitute',
  'spare_part',
] as const
export type RelationKind = (typeof RELATION_KINDS)[number]

export type RelationSection = 'complete' | 'upgrade' | 'related'

export const RELATION_SECTION: Record<RelationKind, RelationSection> = {
  related: 'related',
  substitute: 'related',
  cross_sell: 'complete',
  accessory: 'complete',
  spare_part: 'complete',
  up_sell: 'upgrade',
}

/** Tarjetas por fila: las mismas cuatro que pintaba el relleno por categoría. */
export const RELATED_PER_SECTION = 4
/** Filas que se piden: hasta cuatro por cada una de las tres secciones. */
const RELATIONS_FETCH = 12

const relationRowSchema = z.object({
  related_product_id: z.string().uuid(),
  relation_kind: z.enum(RELATION_KINDS),
  position: z.number().int(),
})
export type RelationRow = z.infer<typeof relationRowSchema>

export async function fetchProductRelations(
  storeSlug: string,
  productId: string,
): Promise<RelationRow[]> {
  const { data, error } = await storefrontClient().rpc(PRODUCT_RELATIONS_PUBLIC_RPC, {
    p_store_slug: storeSlug,
    p_product_id: productId,
    p_kinds: null,
    p_limit: RELATIONS_FETCH,
  })
  if (error) throw new StorefrontError(error)
  return relationRowSchema.array().parse(data ?? [])
}

export interface RelatedSections {
  readonly complete: PublicProduct[]
  readonly upgrade: PublicProduct[]
  readonly related: PublicProduct[]
}

export const EMPTY_SECTIONS: RelatedSections = { complete: [], upgrade: [], related: [] }

/**
 * Reparte las filas en las tres secciones. Función PURA.
 *
 * - Respeta el orden que llega (el que fija el comercio).
 * - Un producto que no se pudo hidratar no se pinta: se despublicó entre las
 *   dos lecturas, y un hueco en la fila es peor que una tarjeta menos.
 * - Un mismo producto no sale dos veces: si el comercio lo puso como accesorio
 *   y como relacionado, se queda donde aparezca primero.
 * - Nunca el propio producto abierto.
 */
export function groupRelatedProducts(
  rows: readonly RelationRow[],
  products: readonly PublicProduct[],
  currentProductId: string | null,
  perSection = RELATED_PER_SECTION,
): RelatedSections {
  const byId = new Map(products.map((product) => [product.product_id, product]))
  const seen = new Set<string>()
  const sections: Record<RelationSection, PublicProduct[]> = { complete: [], upgrade: [], related: [] }

  for (const row of rows) {
    const product = byId.get(row.related_product_id)
    if (!product || product.product_id === currentProductId || seen.has(product.product_id)) continue
    const bucket = sections[RELATION_SECTION[row.relation_kind]]
    if (bucket.length >= perSection) continue
    seen.add(product.product_id)
    bucket.push(product)
  }
  return sections
}

const RELATIONS_STALE = 60 * 1000

/**
 * Las secciones de la ficha y si ya se sabe lo que hay.
 *
 * `settled` distingue «no hay relaciones» de «todavía no lo sé». La ficha solo
 * cae al relleno por categoría cuando ya lo sabe; si no, pintaría la categoría
 * un instante y la cambiaría por lo curado, que se lee como un parpadeo.
 *
 * Un fallo de la función cuenta como «no hay»: las relaciones son un añadido de
 * la ficha, y una ficha sin ellas sigue vendiendo.
 */
export function useRelatedSections(
  storeSlug: string,
  storeId: string | null,
  productId: string | null,
): { sections: RelatedSections; settled: boolean } {
  const relations = useQuery({
    queryKey: ['storefront', 'relations', storeSlug, productId ?? ''],
    queryFn: () => fetchProductRelations(storeSlug, productId as string),
    enabled: Boolean(storeSlug && productId),
    staleTime: RELATIONS_STALE,
    retry: false,
  })

  const ids = [...new Set((relations.data ?? []).map((row) => row.related_product_id))]
  const hydrated = useQuery({
    queryKey: ['storefront', 'products-by-id', storeId ?? '', ids],
    queryFn: () => fetchPublicProductsByIds(storeId, ids),
    enabled: Boolean(storeId && ids.length > 0),
    staleTime: RELATIONS_STALE,
    retry: false,
  })

  if (!productId) return { sections: EMPTY_SECTIONS, settled: false }
  if (relations.isError) return { sections: EMPTY_SECTIONS, settled: true }
  if (!relations.isSuccess) return { sections: EMPTY_SECTIONS, settled: false }
  if (ids.length === 0) return { sections: EMPTY_SECTIONS, settled: true }
  if (hydrated.isError) return { sections: EMPTY_SECTIONS, settled: true }
  if (!hydrated.isSuccess) return { sections: EMPTY_SECTIONS, settled: false }

  return {
    sections: groupRelatedProducts(relations.data, hydrated.data, productId),
    settled: true,
  }
}