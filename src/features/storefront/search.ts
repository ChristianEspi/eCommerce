import { z } from 'zod'
import type {
  SearchFacets,
  SearchFilters,
  SearchHit,
  SearchPort,
  SearchQuery,
  SearchResult,
  SearchSort,
  Suggestion,
} from '@/domain'
import { CATALOG_SEARCH_PUBLIC_RPC, CATALOG_SUGGEST_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { StorefrontError, storefrontClient } from './api'
import type { PublicProduct } from './types'

/**
 * `SearchPort` de la VITRINA: el comprador anónimo (P11-SaaS).
 *
 * Una de las dos implementaciones vivas del puerto. Esta responde «¿qué hay
 * publicado?»; la del backoffice (`features/content/searchAdapter.ts`) responde
 * «¿qué hay?», incluido lo no publicado. Dos actores, dos autorizaciones, dos
 * respuestas — que es lo que hace que el puerto sea una frontera.
 *
 * Tres propiedades que este archivo tiene que conservar:
 *
 *  1. **El catálogo no baja al navegador.** La consulta manda término, filtros
 *     y página; vuelven `limit` filas y los CONTADORES de las facetas. Filtrar
 *     y contar aquí exigiría traerse todo, que es lo que el encargo prohíbe.
 *  2. **La tienda sale del slug de la URL**, resuelto por la función de la base
 *     contra tiendas activas. Ni `store_id` ni tenant viajan en la petición.
 *  3. **Se puede cancelar.** El buscador escribe con rebote y la respuesta de
 *     hace tres letras no puede pisar a la de ahora.
 */

const facetCountSchema = z.object({
  code: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  count: z.number().int().default(0),
})

const hitSchema = z.object({
  product_id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  // Resumen v2 · `default` y no obligatorio: el motor anterior no lo devolvía.
  sku: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  kind: z.enum(['simple', 'variant', 'bundle']).default('simple'),
  brand_name: z.string().nullable().default(null),
  category_slug: z.string().nullable().default(null),
  category_name: z.string().nullable().default(null),
  price: z.string().nullable().default(null),
  compare_at_price: z.string().nullable().default(null),
  price_from: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  in_stock: z.boolean().default(false),
  image_path: z.string().nullable().default(null),
  image_alt: z.string().nullable().default(null),
  published: z.boolean().default(true),
  score: z.string().default('0'),
})

const responseSchema = z.object({
  items: z.array(hitSchema).default([]),
  total: z.number().int().default(0),
  limit: z.number().int().default(24),
  offset: z.number().int().default(0),
  sort: z.enum(['relevance', 'price-asc', 'price-desc', 'name', 'recent', 'discount']).default('relevance'),
  mode: z.enum(['fts', 'fuzzy', 'browse', 'empty']).default('browse'),
  query: z.string().nullable().default(null),
  facets: z
    .object({
      categories: z.array(z.object({ slug: z.string().nullable(), name: z.string().nullable(), count: z.number().int() })).default([]),
      brands: z.array(facetCountSchema).default([]),
      attributes: z
        .array(
          z.object({
            code: z.string(),
            name: z.string(),
            values: z
              .array(z.object({ code: z.string(), label: z.string(), count: z.number().int() }))
              .default([]),
          }),
        )
        .default([]),
      price: z
        .object({ min: z.string().nullable().default(null), max: z.string().nullable().default(null) })
        .default({ min: null, max: null }),
      availability: z
        .object({ in_stock: z.number().int().default(0), total: z.number().int().default(0) })
        .default({ in_stock: 0, total: 0 }),
    })
    .default({
      categories: [],
      brands: [],
      attributes: [],
      price: { min: null, max: null },
      availability: { in_stock: 0, total: 0 },
    }),
})

const suggestionSchema = z
  .array(
    z.object({
      kind: z.enum(['product', 'category', 'brand']),
      label: z.string().min(1),
      slug: z.string().min(1),
    }),
  )
  .default([])

/**
 * Filtros del dominio → el saco `jsonb` que espera la base.
 *
 * Se serializa aquí y no en el componente por lo de siempre: si la forma del
 * saco se escribiera en cada pantalla, cambiarla sería buscarla en todas.
 */
export function toFilterPayload(filters: SearchFilters | undefined): Record<string, unknown> {
  if (!filters) return {}
  const payload: Record<string, unknown> = {}
  if (filters.category) payload.category = filters.category
  if (filters.brands && filters.brands.length > 0) payload.brands = [...filters.brands]
  if (filters.availability === 'in-stock') payload.availability = 'in-stock'
  if (filters.discounted) payload.discounted = true
  if (filters.promotion) payload.promotion = filters.promotion
  // Los importes viajan como TEXTO. Un número de JSON es un double, y un double
  // no es un importe (regla del repositorio desde P02).
  if (filters.priceMin) payload.price_min = filters.priceMin
  if (filters.priceMax) payload.price_max = filters.priceMax
  if (filters.attributes) {
    const attributes: Record<string, string[]> = {}
    for (const [code, values] of Object.entries(filters.attributes)) {
      if (values.length > 0) attributes[code] = [...values]
    }
    if (Object.keys(attributes).length > 0) payload.attributes = attributes
  }
  return payload
}

function toFacets(raw: z.infer<typeof responseSchema>['facets']): SearchFacets {
  return {
    categories: raw.categories
      .filter((item) => item.slug !== null)
      .map((item) => ({ code: item.slug as string, name: item.name ?? (item.slug as string), count: item.count })),
    brands: raw.brands
      .filter((item) => item.code !== null)
      .map((item) => ({ code: item.code as string, name: item.name ?? (item.code as string), count: item.count })),
    attributes: raw.attributes.map((attribute) => ({
      code: attribute.code,
      name: attribute.name,
      values: attribute.values.map((value) => ({
        code: value.code,
        name: value.label,
        count: value.count,
      })),
    })),
    price: { min: raw.price.min, max: raw.price.max },
    availability: { inStock: raw.availability.in_stock, total: raw.availability.total },
  }
}

function toHits(raw: z.infer<typeof responseSchema>['items']): SearchHit[] {
  return raw.map((item) => ({
    productId: item.product_id,
    slug: item.slug,
    name: item.name,
    sku: item.sku,
    description: item.description ?? '',
    kind: item.kind,
    brandName: item.brand_name,
    categorySlug: item.category_slug,
    categoryName: item.category_name,
    price: item.price,
    compareAtPrice: item.compare_at_price,
    priceFrom: item.price_from,
    currency: item.currency,
    inStock: item.in_stock,
    imagePath: item.image_path,
    imageAlt: item.image_alt,
    published: item.published,
    score: item.score,
  }))
}

export function toSearchResult(raw: unknown): SearchResult {
  const parsed = responseSchema.parse(raw)
  return {
    items: toHits(parsed.items),
    total: parsed.total,
    limit: parsed.limit,
    offset: parsed.offset,
    sort: parsed.sort as SearchSort,
    mode: parsed.mode,
    facets: toFacets(parsed.facets),
    query: parsed.query ?? '',
  }
}

/** Implementación de la vitrina. La tienda entra por SLUG, nunca por id. */
export function createStorefrontSearch(storeSlug: string): SearchPort {
  return {
    async search(query: SearchQuery): Promise<SearchResult> {
      const request = storefrontClient().rpc(CATALOG_SEARCH_PUBLIC_RPC, {
        p_store_slug: storeSlug,
        p_query: query.term.trim() || null,
        p_filters: toFilterPayload(query.filters),
        p_sort: query.sort ?? 'relevance',
        p_limit: query.limit ?? 24,
        p_offset: query.offset ?? 0,
      })

      const { data, error } = await (query.signal ? request.abortSignal(query.signal) : request)
      if (error) throw new StorefrontError(error)
      return toSearchResult(data)
    },

    async suggest(term, options): Promise<readonly Suggestion[]> {
      const clean = term.trim()
      if (clean.length < 2) return []

      const request = storefrontClient().rpc(CATALOG_SUGGEST_PUBLIC_RPC, {
        p_store_slug: storeSlug,
        p_query: clean,
        p_limit: options?.limit ?? 8,
      })

      const { data, error } = await (options?.signal
        ? request.abortSignal(options.signal)
        : request)

      // El autocompletado es una ayuda: si falla, se deja de sugerir. Enseñar
      // un error debajo de la caja mientras alguien teclea es ruido.
      if (error) return []
      return suggestionSchema.parse(data ?? [])
    },
  }
}

/**
 * `SearchHit` → la forma que ya pinta `ProductCard`.
 *
 * Existe para NO duplicar la tarjeta del catálogo. La alternativa era una
 * segunda tarjeta «de resultados» idéntica a la de siempre, y dos tarjetas se
 * separan en cuanto una de las dos recibe un arreglo. Los tres campos que el
 * motor no devuelve —`category_id`, `published_at` y `variant_count`— no los
 * usa la tarjeta: se rellenan con el neutro y no con un valor inventado.
 */
export function hitToPublicProduct(hit: SearchHit, storeId: string): PublicProduct {
  return {
    product_id: hit.productId,
    store_id: storeId,
    category_id: null,
    slug: hit.slug,
    name: hit.name,
    sku: hit.sku,
    description: hit.description || null,
    price: hit.price ?? '0',
    compare_at_price: hit.compareAtPrice,
    currency: hit.currency ?? '',
    published_at: null,
    in_stock: hit.inStock,
    category_slug: hit.categorySlug,
    category_name: hit.categoryName,
    primary_image_path: hit.imagePath,
    primary_image_alt: hit.imageAlt,
    kind: hit.kind,
    brand_name: hit.brandName,
    variant_count: 0,
    price_from: hit.priceFrom ?? hit.price ?? '0',
  }
}
