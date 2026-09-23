import { useCallback, useEffect } from 'react'
import { fetchStorePromotions, promotionsKey, type StorePromotion } from './promotions'
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import type { SearchQuery, SearchResult, Suggestion } from '@/domain'
import {
  fetchGallery,
  fetchPublicBrands,
  fetchPublicCategories,
  fetchPublicProduct,
  fetchPublicProducts,
  fetchPublicStore,
  fetchPublicVariants,
  signPaths,
  signStoreAssetPaths,
} from './api'
import {
  contentAssetPaths,
  contentImagePaths,
  fetchStoreContent,
  fetchStoreNavigation,
  type StoreContent,
  type StoreNavigationItem,
} from './content'
import { track } from './analytics'
import { createStorefrontSearch } from './search'
import type {
  CatalogQuery,
  GalleryImage,
  PublicBrand,
  PublicCategory,
  PublicProduct,
  PublicStore,
  PublicVariant,
} from './types'

/**
 * Datos de la vitrina. Todo con `retry: false`: si la tienda no existe o el
 * producto no está publicado, reintentar cuatro veces solo retrasa el 404.
 */

export const storeKey = (slug: string) => ['storefront', 'store', slug] as const
export const categoriesKey = (storeId: string) => ['storefront', 'categories', storeId] as const
export const brandsKey = (storeId: string) => ['storefront', 'brands', storeId] as const
export const productsKey = (query: CatalogQuery) => ['storefront', 'products', query] as const
export const productKey = (storeId: string, slug: string) =>
  ['storefront', 'product', storeId, slug] as const
export const galleryKey = (productId: string) => ['storefront', 'gallery', productId] as const
export const variantsKey = (productId: string) => ['storefront', 'variants', productId] as const
export const thumbsKey = (paths: string[]) => ['storefront', 'thumbs', paths] as const

/** La marca cambia poco; el catálogo, algo más. De ahí los dos `staleTime`. */
const BRAND_STALE = 5 * 60 * 1000
const CATALOG_STALE = 60 * 1000

export function usePublicStore(slug: string | undefined): UseQueryResult<PublicStore> {
  return useQuery({
    queryKey: storeKey(slug ?? ''),
    queryFn: () => fetchPublicStore(slug as string),
    enabled: Boolean(slug),
    staleTime: BRAND_STALE,
    retry: false,
  })
}

export function usePublicCategories(storeId: string | null): UseQueryResult<PublicCategory[]> {
  return useQuery({
    queryKey: categoriesKey(storeId ?? ''),
    queryFn: () => fetchPublicCategories(storeId),
    enabled: Boolean(storeId),
    staleTime: CATALOG_STALE,
    retry: false,
  })
}

/**
 * Las marcas de la tienda con su logo (Storefront V2 · P02).
 *
 * `BRAND_STALE` y no `CATALOG_STALE`: un logo de marca cambia como cambia una
 * marca —casi nunca—, y esta consulta la piden dos secciones de la portada. La
 * clave cuelga de `store_id`, así que las dos comparten la MISMA respuesta y
 * cuesta una petición, no dos.
 */
export function usePublicBrands(storeId: string | null): UseQueryResult<PublicBrand[]> {
  return useQuery({
    queryKey: brandsKey(storeId ?? ''),
    queryFn: () => fetchPublicBrands(storeId),
    enabled: Boolean(storeId),
    staleTime: BRAND_STALE,
    retry: false,
  })
}

export function usePublicProducts(query: CatalogQuery): UseQueryResult<PublicProduct[]> {
  return useQuery({
    queryKey: productsKey(query),
    queryFn: () => fetchPublicProducts(query),
    enabled: Boolean(query.storeId),
    staleTime: CATALOG_STALE,
    retry: false,
  })
}

export function usePublicProduct(
  storeId: string | null,
  slug: string | undefined,
): UseQueryResult<PublicProduct> {
  return useQuery({
    queryKey: productKey(storeId ?? '', slug ?? ''),
    queryFn: () => fetchPublicProduct({ storeId, slug: slug as string }),
    enabled: Boolean(storeId && slug),
    staleTime: CATALOG_STALE,
    retry: false,
  })
}

/**
 * Variantes de la ficha. Solo se piden cuando el producto declara tenerlas: un
 * catálogo de productos simples no paga una consulta por ficha visitada.
 */
export function usePublicVariants(
  product: PublicProduct | undefined,
): UseQueryResult<PublicVariant[]> {
  const productId = product?.kind === 'variant' ? product.product_id : null
  return useQuery({
    queryKey: variantsKey(productId ?? ''),
    queryFn: () => fetchPublicVariants(productId),
    enabled: Boolean(productId),
    staleTime: CATALOG_STALE,
    retry: false,
  })
}

export function useGallery(productId: string | null): UseQueryResult<GalleryImage[]> {
  return useQuery({
    queryKey: galleryKey(productId ?? ''),
    queryFn: () => fetchGallery(productId),
    enabled: Boolean(productId),
    staleTime: CATALOG_STALE,
    retry: false,
  })
}

/**
 * Miniaturas del listado en UNA sola firma para todo el lote, en vez de una
 * petición por tarjeta. Si la firma falla, el mapa queda vacío y las tarjetas
 * caen al marcador neutral: una foto que no carga no puede dejar sin catálogo.
 */
export function useThumbnails(products: PublicProduct[]): Record<string, string> {
  return useSignedThumbnails(products.map((p) => p.primary_image_path))
}

/**
 * Firma un lote de rutas de imagen y devuelve el mapa `ruta -> URL`. Lo usan el
 * catálogo y el carrito: las rutas se deduplican y se ordenan para que la clave
 * de caché no cambie por el orden en que llegaron.
 *
 * `keepPreviousData` (P15-SaaS) no es una comodidad: al pedir la siguiente
 * página del catálogo el lote crece, la clave cambia y sin esto el mapa se
 * vaciaba —`data` pasa a `undefined` en una clave nueva— y **todas** las fotos
 * ya pintadas caían al marcador neutral hasta que llegaba la firma nueva. Se
 * veía como un parpadeo de la rejilla entera al pulsar «ver más».
 */
export function useSignedThumbnails(paths: Array<string | null>): Record<string, string> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))].sort()

  const { data } = useQuery({
    queryKey: thumbsKey(unique),
    queryFn: () => signPaths(unique),
    enabled: unique.length > 0,
    staleTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  })

  return data ?? {}
}

/** Contexto que el layout de la vitrina pasa a sus pantallas. */
export interface StorefrontOutlet {
  storeSlug: string
  store: PublicStore
}

export function useStorefront(): StorefrontOutlet {
  return useOutletContext<StorefrontOutlet>()
}

/**
 * El mismo contexto, admitiendo que puede NO haberlo (P15-SaaS).
 *
 * `useOutletContext` devuelve `null` cuando el componente se monta fuera del
 * `<Outlet>` del layout, así que la firma de `useStorefront` miente en ese
 * caso. Mientras lo único que se leía del contexto era el catálogo daba igual
 * —esas pantallas no existen fuera de la vitrina—, pero los metadatos de P15
 * los pide tambien `StoreAccountPage`, que sí se monta suelta (es una pantalla
 * de `features/customers` probada por su cuenta).
 *
 * Se resuelve declarando la verdad en el tipo en vez de obligar a cada llamador
 * a montar un layout entero para poner un `<title>`: sin tienda resuelta no hay
 * metadatos que poner, y la pantalla se pinta igual.
 */
export function useStorefrontOptional(): StorefrontOutlet | null {
  return useOutletContext<StorefrontOutlet | null>() ?? null
}

// ---------------------------------------------------------------------------
// Contenido administrable y búsqueda (P11-SaaS)
// ---------------------------------------------------------------------------

export const contentKey = (storeSlug: string, pageSlug: string | null) =>
  ['storefront', 'content', storeSlug, pageSlug ?? 'home'] as const
export const navigationKey = (storeSlug: string) =>
  ['storefront', 'navigation', storeSlug] as const
export const searchKey = (storeSlug: string, query: SearchQuery) =>
  ['storefront', 'search', storeSlug, query.term, query.filters, query.sort, query.offset] as const
export const suggestKey = (storeSlug: string, term: string) =>
  ['storefront', 'suggest', storeSlug, term] as const

/**
 * Contenido de una página. `pageSlug` nulo = portada.
 *
 * `retry: false` como el resto de la vitrina, y `staleTime` de marca: el
 * contenido cambia cuando el comercio lo cambia, no cada minuto. Un `cms:false`
 * —la sociedad no tiene el módulo— es una respuesta VÁLIDA y se cachea igual:
 * reintentarla no la convierte en otra cosa.
 */
export function useStoreContent(
  storeSlug: string | undefined,
  pageSlug: string | null = null,
): UseQueryResult<StoreContent> {
  return useQuery({
    queryKey: contentKey(storeSlug ?? '', pageSlug),
    queryFn: () => fetchStoreContent({ storeSlug: storeSlug as string, pageSlug }),
    enabled: Boolean(storeSlug),
    staleTime: BRAND_STALE,
    retry: false,
  })
}

/**
 * Campañas vigentes de la tienda.
 *
 * `retry: false` y la tolerancia de `fetchStorePromotions` van juntas: si la
 * función de base todavía no está desplegada, esto devuelve lista vacía y la
 * portada se pinta igual, sin carrusel y sin error.
 */
export function useStorePromotions(storeSlug: string | undefined): UseQueryResult<StorePromotion[]> {
  return useQuery({
    queryKey: promotionsKey(storeSlug ?? ''),
    queryFn: () => fetchStorePromotions(storeSlug as string),
    enabled: Boolean(storeSlug),
    staleTime: BRAND_STALE,
    retry: false,
  })
}

export function useStoreNavigation(storeSlug: string | undefined): UseQueryResult<StoreNavigationItem[]> {
  return useQuery({
    queryKey: navigationKey(storeSlug ?? ''),
    queryFn: () => fetchStoreNavigation(storeSlug as string),
    enabled: Boolean(storeSlug),
    staleTime: BRAND_STALE,
    retry: false,
  })
}

/**
 * Firma las imágenes que el contenido necesita: las del bucket de branding
 * (hero, banner) y las del bucket de producto (colecciones).
 *
 * Dos lotes y no uno porque son dos buckets con dos policies. Una firma que
 * falle deja el hueco neutral en vez de tumbar la portada.
 */
export function useContentAssets(content: StoreContent | undefined): {
  assets: Record<string, string>
  images: Record<string, string>
} {
  const assetPaths = content ? contentAssetPaths(content) : []
  const imagePaths = content ? contentImagePaths(content) : []
  const uniqueAssets = [...new Set(assetPaths)].sort()

  const { data: assets } = useQuery({
    queryKey: ['storefront', 'content-assets', uniqueAssets] as const,
    queryFn: () => signStoreAssetPaths(uniqueAssets),
    enabled: uniqueAssets.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  return { assets: assets ?? {}, images: useSignedThumbnails(imagePaths) }
}

/**
 * Firma un puñado de referencias sueltas del bucket de branding.
 *
 * La diferencia con `useContentAssets` es de dónde vienen: aquélla recorre un
 * árbol de bloques del CMS, y ésta recibe una lista ya hecha —las fotos de las
 * campañas vigentes, por ejemplo—.
 *
 * **Deja pasar las URL absolutas sin tocarlas.** El campo admite las dos cosas:
 * una ruta del bucket privado o un `https://` externo, que es lo que permite el
 * contrato §4.3 para el branding automático. Lo que NO se puede es servir el
 * `https://` externo y esperar que se vea: la CSP del despliegue solo admite
 * imágenes del propio dominio y del proyecto de Supabase, así que una foto
 * alojada fuera se bloquea en el navegador aunque la fila la traiga. Por eso
 * esto solo firma rutas: lo demás no es cosa suya.
 */
export function useSignedStoreAssets(refs: readonly (string | null)[]): Record<string, string> {
  const rutas = [
    ...new Set(
      refs.filter((ref): ref is string => typeof ref === 'string' && !/^https?:\/\//i.test(ref)),
    ),
  ].sort()

  const { data } = useQuery({
    queryKey: ['storefront', 'store-assets', rutas] as const,
    queryFn: () => signStoreAssetPaths(rutas),
    enabled: rutas.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  return data ?? {}
}

/**
 * Búsqueda del catálogo con rebote y CANCELACIÓN.
 *
 * La cancelación no es una optimización: sin ella, la respuesta de una consulta
 * anterior puede llegar después de la actual y pintar resultados que ya no
 * corresponden a lo que hay escrito en la caja. React Query pasa su `signal` al
 * puerto y el adaptador se lo da al SDK.
 *
 * `placeholderData` mantiene la página anterior mientras llega la nueva: sin
 * ella, cada tecla vacía la rejilla y la pantalla parpadea.
 */
export function useCatalogSearch(
  storeSlug: string | undefined,
  query: SearchQuery,
  enabled = true,
): UseQueryResult<SearchResult> {
  const result = useQuery({
    queryKey: searchKey(storeSlug ?? '', query),
    queryFn: ({ signal }) =>
      createStorefrontSearch(storeSlug as string).search({ ...query, signal }),
    enabled: Boolean(storeSlug) && enabled,
    staleTime: CATALOG_STALE,
    placeholderData: (previous) => previous,
    retry: false,
  })

  /**
   * `search` (P13-SaaS), con su NÚMERO DE RESULTADOS.
   *
   * Se emite aquí y no en la caja de texto porque el dato que se acciona no es
   * qué se tecleó, es qué se tecleó Y NO ENCONTRÓ NADA: un término buscado
   * cincuenta veces con cero resultados es un producto que falta en el catálogo
   * o un sinónimo que falta en `search_synonyms` (P11). En la caja aún no se
   * sabe.
   *
   * Solo la primera página (`offset === 0`): paginar es la misma búsqueda, y
   * contarla otra vez hincharía el denominador con el desplazamiento de quien
   * SÍ encontró lo que buscaba.
   */
  const term = query.term.trim()
  const total = result.data?.total
  useEffect(() => {
    if (!storeSlug || term === '' || total === undefined || query.offset !== 0) return
    track(storeSlug, { type: 'search', term, result_count: total })
  }, [storeSlug, term, total, query.offset])

  return result
}

/** Autocompletado. Solo a partir de dos caracteres: con uno, sugiere el catálogo entero. */
export function useCatalogSuggestions(
  storeSlug: string | undefined,
  term: string,
): UseQueryResult<readonly Suggestion[]> {
  const clean = term.trim()
  return useQuery({
    queryKey: suggestKey(storeSlug ?? '', clean),
    queryFn: ({ signal }) =>
      createStorefrontSearch(storeSlug as string).suggest(clean, { signal }),
    enabled: Boolean(storeSlug) && clean.length >= 2,
    staleTime: CATALOG_STALE,
    retry: false,
  })
}

// ---------------------------------------------------------------------------
// Paginación del catálogo y prefetch (P15-SaaS)
// ---------------------------------------------------------------------------

export const searchPagesKey = (storeSlug: string, query: SearchQuery) =>
  ['storefront', 'search-pages', storeSlug, query.term, query.filters, query.sort, query.limit] as const

/**
 * Catálogo paginado DE VERDAD contra el servidor.
 *
 * Hasta P14 «ver más» subía el `limit` y volvía a pedir desde el desplazamiento
 * cero: la segunda página descargaba 48 productos para enseñar 24 nuevos, la
 * tercera 72 para enseñar 24, y así. Con veinte pulsaciones el navegador se
 * había traído el catálogo entero varias veces —exactamente lo que P11 quitó de
 * la carga inicial—. Ahora cada página pide su tramo con `offset` y las
 * anteriores se quedan donde estaban.
 *
 * `getNextPageParam` se apoya en el `total` que devuelve la propia función de
 * la base: no hace falta pedir una página de más para saber si hay siguiente.
 */
/**
 * Lo REBAJADO de la tienda: una sola consulta para los dos que la necesitan.
 *
 * La portada la usa para su banda de ofertas y la barra de navegación para
 * decidir si enseña la puerta «Ofertas». Es una constante y no dos objetos
 * iguales escritos en dos sitios porque la clave de TanStack se calcula de los
 * VALORES: dos literales que se separen un día —un límite distinto, otro
 * orden— dejan de compartir caché y pasan a ser dos peticiones que devuelven
 * lo mismo.
 */
export const OFERTAS_QUERY: SearchQuery = {
  term: '',
  filters: { discounted: true },
  sort: 'relevance',
  limit: 12,
  offset: 0,
}

export function useCatalogPages(
  storeSlug: string | undefined,
  query: SearchQuery,
): UseInfiniteQueryResult<InfiniteData<SearchResult, unknown>> {
  const result = useInfiniteQuery({
    queryKey: searchPagesKey(storeSlug ?? '', query),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      createStorefrontSearch(storeSlug as string).search({ ...query, offset: pageParam, signal }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    enabled: Boolean(storeSlug),
    staleTime: CATALOG_STALE,
    // Sin esto, cambiar un filtro vacía la rejilla y la página salta al alto de
    // un esqueleto y vuelve. Con esto se ve lo anterior atenuado hasta que
    // llega lo nuevo, que es lo que hacía `useCatalogSearch` desde P11.
    placeholderData: keepPreviousData,
    retry: false,
  })

  /**
   * `search` (P13-SaaS), con su NÚMERO DE RESULTADOS.
   *
   * Se emite aquí y no en la caja de texto porque el dato que se acciona no es
   * qué se tecleó, es qué se tecleó Y NO ENCONTRÓ NADA: un término buscado
   * cincuenta veces con cero resultados es un producto que falta en el catálogo
   * o un sinónimo que falta en `search_synonyms` (P11). En la caja aún no se
   * sabe.
   *
   * Solo la PRIMERA página: paginar es la misma búsqueda, y contarla otra vez
   * hincharía el denominador con el desplazamiento de quien SÍ encontró lo que
   * buscaba.
   */
  const term = query.term.trim()
  const total = result.data?.pages[0]?.total
  useEffect(() => {
    if (!storeSlug || term === '' || total === undefined) return
    track(storeSlug, { type: 'search', term, result_count: total })
  }, [storeSlug, term, total])

  return result
}

/**
 * Prefetch de una ficha de producto.
 *
 * Se dispara al APUNTAR o al ENFOCAR una tarjeta, no al pintarla: precargar las
 * veinticuatro fichas de la rejilla convertiría un ahorro en veinticuatro
 * consultas que casi nadie va a usar. Apuntar a una tarjeta es la señal más
 * barata de intención que hay, y entre el `mouseenter` y el clic caben los
 * ~150 ms que tarda la consulta.
 *
 * `staleTime` largo: si el comprador entra en la ficha justo después, el dato
 * ya está y no se vuelve a pedir. Y si no entra, no ha costado más que una
 * fila.
 */
export function usePrefetchProduct(storeId: string | null): (slug: string) => void {
  const client = useQueryClient()

  return useCallback(
    (slug: string) => {
      if (!storeId || !slug) return
      void client.prefetchQuery({
        queryKey: productKey(storeId, slug),
        queryFn: () => fetchPublicProduct({ storeId, slug }),
        staleTime: CATALOG_STALE,
      })
    },
    [client, storeId],
  )
}
