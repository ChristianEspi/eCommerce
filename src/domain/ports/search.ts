import type { CurrencyCode, MoneyAmount } from '../money'

/**
 * `SearchPort` — encontrar en el catálogo, sin que el dominio sepa con qué.
 *
 * ## Por qué existe AHORA y no antes
 *
 * `ports/index.ts` lleva desde P01-SaaS explicando por qué este puerto **no** se
 * creaba, y dejando escrito el disparador: «el día que aparezca un índice o
 * motor de búsqueda propio (P11 / P15) o un `catalog.search` en
 * `integration_providers`». P11-SaaS crea el índice —`products.search_vector`,
 * trigramas y sinónimos por tienda— y con él aparecen las dos implementaciones
 * que la regla del repositorio exige:
 *
 * | Implementación | Actor | Qué devuelve |
 * |---|---|---|
 * | `catalog_search_for_slug` | comprador **anónimo** | solo lo publicado, con precio resuelto y semáforo de disponibilidad |
 * | `catalog_search`          | backoffice **con sesión** | además lo NO publicado, para el selector de productos del editor de contenido |
 *
 * No son dos capas de lo mismo: son dos actores con dos autorizaciones y dos
 * respuestas. Es la misma forma que `InventoryPort` tiene desde P06 —cifra para
 * el backoffice, semáforo para la vitrina— y es lo que hace que esto sea una
 * frontera y no una indirección.
 *
 * ## Lo que el contrato fija, y por qué importa para cambiar de motor
 *
 * 1. **La búsqueda devuelve una PÁGINA, no una lista.** `total`, `limit` y
 *    `offset` son parte de la respuesta porque el encargo prohíbe cargar el
 *    catálogo entero en el navegador: un puerto que devolviera `Result[]` sin
 *    total invitaría a paginar en el cliente, que es lo mismo que traérselo todo.
 * 2. **Las facetas vienen del motor.** Contarlas en el navegador exige tener
 *    todas las filas. Un motor que no sepa hacer facetas tendrá que calcularlas
 *    en su adaptador; el dominio no cambia.
 * 3. **`mode` es parte de la respuesta.** Un resultado obtenido por tolerancia a
 *    erratas no es lo mismo que uno exacto, y la vitrina necesita poder decir
 *    «quizá quisiste decir» en vez de fingir que era lo que se pidió. Un motor
 *    que no distinga devuelve `'fts'`: se degrada, no miente.
 * 4. **Ningún importe es `number`.** `MoneyAmount` es un decimal en TEXTO, como
 *    en todo el dominio desde P01.
 * 5. **El tenant NO es un parámetro.** Ni `organization_id`, ni `company_id`, ni
 *    `store_id`: el alcance lo pone el adaptador con lo que ya sabe (el slug de
 *    la URL en la vitrina, la tienda activa de la sesión en el backoffice) y la
 *    autoridad final es la función de la base. Un parámetro que se puede pasar
 *    se puede pasar mal.
 */

/** Filtros del buscador. Todos opcionales: ninguno filtra por sí solo. */
export interface SearchFilters {
  /** Slug de categoría. Una sola: el árbol se navega, no se multiselecciona. */
  readonly category?: string | null
  /** Códigos de marca. Varias: OR entre ellas. */
  readonly brands?: readonly string[]
  /**
   * Atributos del PIM: `{ color: ['rojo', 'azul'], talla: ['m'] }`.
   * AND entre atributos, OR entre los valores de cada uno — que es lo que
   * espera quien filtra («rojo o azul», pero «y talla M»).
   */
  readonly attributes?: Readonly<Record<string, readonly string[]>>
  readonly availability?: 'all' | 'in-stock'
  /**
   * Solo lo que tiene precio anterior MAYOR que el actual.
   *
   * Un sí/no y no un rango: «en oferta» no admite grados. Lo resuelve la base
   * sobre el precio YA resuelto por lista, que es el único sitio donde ese
   * cálculo es cierto para todas las tiendas.
   */
  readonly discounted?: boolean
  /**
   * 2026-11-20 · Solo los productos de UNA campaña (su id). Lo resuelve la base
   * y solo para una campaña que la tienda esté anunciando.
   */
  readonly promotion?: string | null
  readonly priceMin?: MoneyAmount | null
  readonly priceMax?: MoneyAmount | null
}

/** `discount` (Resumen v2): mayor PORCENTAJE de rebaja primero; lo no rebajado, al final. */
export type SearchSort = 'relevance' | 'price-asc' | 'price-desc' | 'name' | 'recent' | 'discount'

export interface SearchQuery {
  /** Lo que se tecleó. Vacío = navegar el catálogo con filtros. */
  readonly term: string
  readonly filters?: SearchFilters
  readonly sort?: SearchSort
  readonly limit?: number
  readonly offset?: number
  /**
   * Cancelación. Un buscador con rebote dispara peticiones que dejan de
   * interesar en cuanto se pulsa la siguiente tecla; sin esto, la respuesta
   * lenta de hace tres letras puede pisar a la de ahora.
   */
  readonly signal?: AbortSignal
}

export interface SearchHit {
  readonly productId: string
  readonly slug: string
  readonly name: string
  /** El código con el que pide el comprador empresa. Nulo en respuestas antiguas. */
  readonly sku: string | null
  readonly description: string
  readonly kind: 'simple' | 'variant' | 'bundle'
  readonly brandName: string | null
  readonly categorySlug: string | null
  readonly categoryName: string | null
  readonly price: MoneyAmount | null
  readonly compareAtPrice: MoneyAmount | null
  readonly priceFrom: MoneyAmount | null
  readonly currency: CurrencyCode | null
  readonly inStock: boolean
  readonly imagePath: string | null
  readonly imageAlt: string | null
  /** `false` solo puede aparecer en la implementación del backoffice. */
  readonly published: boolean
  /** Puntuación del motor, como texto: es un decimal, no un contador. */
  readonly score: string
}

export interface FacetCount {
  readonly code: string
  readonly name: string
  readonly count: number
}

export interface AttributeFacet {
  readonly code: string
  readonly name: string
  readonly values: readonly FacetCount[]
}

export interface SearchFacets {
  readonly categories: readonly FacetCount[]
  readonly brands: readonly FacetCount[]
  readonly attributes: readonly AttributeFacet[]
  readonly price: { readonly min: MoneyAmount | null; readonly max: MoneyAmount | null }
  readonly availability: { readonly inStock: number; readonly total: number }
}

/**
 * Cómo se encontró lo que se encontró.
 *
 *  - `fts`    — coincidencia de texto exacta (lematizada y con prefijo).
 *  - `fuzzy`  — no hubo coincidencia y se cayó a similitud: hay errata.
 *  - `browse` — no se buscó nada; esto es el catálogo con filtros.
 *  - `empty`  — se buscó y no hay nada, ni siquiera parecido.
 */
export type SearchMode = 'fts' | 'fuzzy' | 'browse' | 'empty'

export interface SearchResult {
  readonly items: readonly SearchHit[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly sort: SearchSort
  readonly mode: SearchMode
  readonly facets: SearchFacets
  /** Lo que se buscó, devuelto por el motor: sirve para descartar respuestas viejas. */
  readonly query: string
}

/** Sugerencia de autocompletado. Es una ayuda a TECLEAR: sin precio ni stock. */
export interface Suggestion {
  readonly kind: 'product' | 'category' | 'brand'
  readonly label: string
  /** Slug del producto o de la categoría; código de la marca. */
  readonly slug: string
}

export interface SearchPort {
  search(query: SearchQuery): Promise<SearchResult>
  /**
   * Autocompletado. Separado de `search` a propósito: se dispara con cada tecla
   * y no puede pagar el coste de calcular facetas ni de resolver precios.
   */
  suggest(term: string, options?: { limit?: number; signal?: AbortSignal }): Promise<readonly Suggestion[]>
}
