import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '@/domain/errors'
import { codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'
import { ORDER_BY_TOKEN_RPC } from '@/shared/lib/db-schema'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetStorefrontClient } from '@/shared/lib/supabase'
import {
  PRODUCT_IMAGES_BUCKET,
  STORE_ASSETS_BUCKET,
  PUBLIC_CATEGORIES_VIEW,
  PUBLIC_PRODUCTS_VIEW,
  PUBLIC_PRODUCT_IMAGES_VIEW,
  PUBLIC_PRODUCT_VARIANTS_VIEW,
  PUBLIC_STORES_VIEW,
  publicCategorySchema,
  publicProductImageSchema,
  publicProductSchema,
  publicStoreSchema,
  publicVariantSchema,
  type CatalogQuery,
  type GalleryImage,
  type PublicCategory,
  type PublicProduct,
  type PublicStore,
  type PublicVariant,
  OrderNotFoundError,
  trackedOrderSchema,
  type TrackedOrder,
} from './types'
import { signedUrls, SIGN_TTL_SECONDS } from './signed-url-cache'

/**
 * Acceso a datos de la vitrina pública.
 *
 * Dos reglas gobiernan todo este archivo:
 *
 *  1. **El cliente es anónimo siempre** (`getStorefrontClient`), aunque el
 *     visitante tenga sesión de backoffice abierta. Las policies públicas son
 *     `to anon`; con el cliente autenticado la vitrina se vería vacía.
 *  2. **La tienda se resuelve por el slug de la URL contra `public_stores`**,
 *     que ya filtra `status = 'active'`. El `store_id` que se usa después sale
 *     de esa consulta, nunca de un parámetro que declare el cliente: quien
 *     escriba un uuid en la barra de direcciones no llega a ninguna parte.
 */

export class StorefrontNotConfiguredError extends AppError {
  constructor() {
    super({
      boundary: 'content',
      code: 'CONFIG_INCOMPLETA',
      message: 'El proyecto Supabase de eCommerce todavía no está conectado.',
    })
    this.name = 'StorefrontNotConfiguredError'
  }
}

/** La tienda o el producto no existen, o existen pero no están publicados. */
export class StorefrontNotFoundError extends AppError {
  constructor(what: string) {
    super({
      boundary: 'content',
      code: 'NO_ENCONTRADO',
      message: `No existe nada publicado para "${what}".`,
    })
    this.name = 'StorefrontNotFoundError'
  }
}

/**
 * Fallo de la vitrina que NO es «no existe»: red, RLS, esquema.
 *
 * Se construye con el CÓDIGO del error, nunca con su `message`. Hasta P01 estos
 * cinco puntos hacían `throw new Error(error.message)`, así que un mensaje crudo
 * de Postgres —con nombres de tabla, de columna y de policy dentro— podía
 * acabar pintado en la pantalla de un comprador anónimo. La regla ya estaba
 * escrita en el proyecto desde P02; lo que faltaba era cumplirla aquí.
 */
export class StorefrontError extends AppError {
  constructor(error: PostgrestLike) {
    super({ boundary: 'content', code: codeFromDbError(error) })
    this.name = 'StorefrontError'
  }
}

function storefront(): SupabaseClient {
  const supabase = tryGetStorefrontClient()
  if (!supabase) throw new StorefrontNotConfiguredError()
  return supabase
}

/**
 * El mismo cliente ANÓNIMO, para los módulos de datos que P11 añade
 * (`content.ts` y `search.ts`).
 *
 * Se exporta la función y no el cliente: crearlo en el momento de importar
 * haría que un bundle sin configuración de Supabase reventara al cargar en vez
 * de al consultar, y el mensaje «falta configurar» no llegaría a pintarse.
 */
export function storefrontClient(): SupabaseClient {
  return storefront()
}

const STORE_COLUMNS = [
  'store_id',
  'slug',
  'name',
  'currency',
  'accent_color',
  'logo_url',
  'white_label',
  'default_locale',
  'support_email',
  'banner_url',
  'hero_title',
  'hero_subtitle',
  'contact_phone',
  'contact_address',
  'favicon_url',
  'font_family',
  'ui_radius',
  'ui_density',
  'business_display_name',
  'checkout_requires_account',
]

/**
 * Las tres columnas del Theme Engine, aparte y por un motivo operativo.
 *
 * PostgREST no ignora una columna que no existe: devuelve 400 y la consulta
 * ENTERA se cae. Durante un despliegue en el que la app sale antes que la
 * migración —que es exactamente lo que pasa cuando el front se publica solo—,
 * pedirlas en el mismo `select` dejaría la vitrina sin tienda, no sin tema.
 *
 * Por eso van separadas: si la respuesta dice que no existen, se repite la
 * consulta sin ellas y la tienda se pinta con el tema por defecto. Un despliegue
 * a medias degrada la presentación; no cierra el comercio.
 */
export const THEME_COLUMNS = ['theme_preset', 'storefront_style', 'home_layout'] as const

const STORE_SELECT = [...STORE_COLUMNS, ...THEME_COLUMNS].join(', ')
const STORE_SELECT_SIN_TEMA = STORE_COLUMNS.join(', ')

const CATEGORY_SELECT = 'category_id, store_id, parent_id, slug, name, position'

/** `::text` en los importes: el céntimo no pasa por el float del navegador. */
const PRODUCT_SELECT = [
  'product_id',
  'store_id',
  'category_id',
  'slug',
  'name',
  'description',
  'price::text',
  'compare_at_price::text',
  'currency',
  'published_at',
  'in_stock',
  'category_slug',
  'category_name',
  'primary_image_path',
  'primary_image_alt',
  'kind',
  'brand_name',
  'variant_count',
  'price_from::text',
].join(', ')

const IMAGE_SELECT = 'image_id, product_id, storage_path, alt, position, is_primary'

const VARIANT_SELECT = [
  'variant_id',
  'product_id',
  'store_id',
  'name',
  'position',
  'is_default',
  'in_stock',
  'price::text',
  'compare_at_price::text',
  'currency',
].join(', ')

/** Una referencia de branding externa se pinta tal cual; una ruta hay que firmarla. */
function isExternalAsset(value: string): boolean {
  return /^https:\/\//i.test(value)
}

/**
 * Resuelve `logo_url` y `banner_url` a algo que un `<img>` pueda pintar.
 *
 * Desde P07 el tenant sube su logo y su banner al bucket PRIVADO
 * `store-assets` y lo que se guarda es la RUTA, no una URL: una URL firmada
 * caduca en una hora y dejaría la vitrina sin marca al día siguiente. Aquí se
 * firma con el cliente ANÓNIMO, así que quien autoriza es
 * `ebim_objects_select_public_asset` — solo objetos de tienda ACTIVA.
 *
 * El contrato §4.3 también permite un `logo_url` externo (el "logo-auto" de
 * Clearbit al provisionar): ese no se firma, se devuelve tal cual.
 */
async function resolveStoreAssets(store: PublicStore): Promise<PublicStore> {
  const paths = [store.logo_url, store.banner_url].filter(
    (value): value is string => Boolean(value) && !isExternalAsset(value as string),
  )
  if (paths.length === 0) return store

  const { data, error } = await storefront()
    .storage.from(STORE_ASSETS_BUCKET)
    .createSignedUrls([...new Set(paths)], 3600)

  // Una firma que falle no puede dejar la tienda sin vitrina: se cae al
  // fallback neutral (iniciales del tenant y degradado de tokens).
  const signed: Record<string, string> = {}
  if (!error) {
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signed[item.path] = item.signedUrl
    }
  }

  const resolve = (value: string | null) =>
    value === null ? null : isExternalAsset(value) ? value : (signed[value] ?? null)

  return { ...store, logo_url: resolve(store.logo_url), banner_url: resolve(store.banner_url) }
}

/**
 * La UNICA tienda activa del proyecto, si es que hay solo una.
 *
 * Sirve a la portada del dominio raiz para poder ofrecer «ver la tienda» en un
 * despliegue de una sola tienda —el caso de una demo o de un cliente unico— sin
 * cablear su slug en el codigo.
 *
 * Pide DOS y devuelve `null` si vienen dos: con varias tiendas, la raiz no
 * elige por el visitante, y sobre todo no las lista. La lista de tiendas
 * activas de un SaaS es la lista de clientes, y la portada publica no es sitio
 * para publicarla.
 */
export async function fetchOnlyPublicStore(): Promise<{ slug: string; name: string } | null> {
  const { data, error } = await storefront()
    .from(PUBLIC_STORES_VIEW)
    .select('slug, name')
    .limit(2)

  if (error || !data || data.length !== 1) return null
  const [store] = data as Array<{ slug: string; name: string }>
  return store ?? null
}

/**
 * `undefined_column` de Postgres: la columna pedida no existe.
 *
 * Se mira el CÓDIGO y nunca el texto. Es la regla del repositorio —el `message`
 * de PostgREST lleva dentro nombres de tabla y de policy, y ramificar por él se
 * rompe en cuanto el servidor cambia una palabra— y aquí además basta: en esta
 * consulta las únicas columnas que pueden faltar son las tres del tema, porque
 * el resto lleva desplegado desde hace fases.
 */
const COLUMNA_INEXISTENTE = '42703'

/**
 * Se recuerda entre llamadas: una vez sabido que la base va por detrás, no
 * tiene sentido pagar la consulta fallida en cada navegación.
 */
let baseSinTema = false

/** Vuelve a intentar con las columnas del tema. Para las pruebas y para el día
 *  en que la migración sí esté aplicada sin haber recargado la pestaña. */
export function resetStorefrontThemeProbe(): void {
  baseSinTema = false
}

export async function fetchPublicStore(slug: string): Promise<PublicStore> {
  const consultar = (select: string) =>
    storefront().from(PUBLIC_STORES_VIEW).select(select).eq('slug', slug).maybeSingle()

  let { data, error } = await consultar(baseSinTema ? STORE_SELECT_SIN_TEMA : STORE_SELECT)

  if (error && !baseSinTema && error.code === COLUMNA_INEXISTENTE) {
    baseSinTema = true
    ;({ data, error } = await consultar(STORE_SELECT_SIN_TEMA))
  }

  if (error) throw new StorefrontError(error)
  if (!data) throw new StorefrontNotFoundError(slug)
  return resolveStoreAssets(publicStoreSchema.parse(data))
}

/** Solo categorías activas: la vista `public_categories` ya filtra `is_active`. */
export async function fetchPublicCategories(storeId: string | null): Promise<PublicCategory[]> {
  if (!storeId) return []

  const { data, error } = await storefront()
    .from(PUBLIC_CATEGORIES_VIEW)
    .select(CATEGORY_SELECT)
    .eq('store_id', storeId)
    .order('position')
    .order('name')

  if (error) throw new StorefrontError(error)
  return publicCategorySchema.array().parse(data ?? [])
}

/**
 * Catálogo con los filtros simples de la vitrina: buscador general, categoría y
 * disponibilidad. Nada de paneles multi-campo (regla de suite §8).
 *
 * El término se sanea antes de entrar en el `or=`: una coma o un paréntesis no
 * son "texto que no encuentra nada" en PostgREST, son sintaxis del filtro.
 */
export async function fetchPublicProducts(query: CatalogQuery): Promise<PublicProduct[]> {
  if (!query.storeId) return []

  let request = storefront()
    .from(PUBLIC_PRODUCTS_VIEW)
    .select(PRODUCT_SELECT)
    .eq('store_id', query.storeId)

  if (query.categorySlug) request = request.eq('category_slug', query.categorySlug)
  if (query.availability === 'in-stock') request = request.eq('in_stock', true)

  const searchFilter = buildTextSearchFilter(query.search, ['name', 'description', 'category_name'])
  if (searchFilter) request = request.or(searchFilter)

  switch (query.sort) {
    case 'price-asc':
      request = request.order('price', { ascending: true })
      break
    case 'price-desc':
      request = request.order('price', { ascending: false })
      break
    case 'name':
      request = request.order('name', { ascending: true })
      break
    default:
      request = request.order('published_at', { ascending: false })
  }

  // El techo viaja SIEMPRE. PostgREST sin `limit` devuelve lo que la política
  // del proyecto permita, que puede ser el catálogo entero: la única forma de
  // que el navegador no se lo traiga es no pedirlo.
  const { data, error } = await request.limit(query.limit)
  if (error) throw new StorefrontError(error)
  return publicProductSchema.array().parse(data ?? [])
}

/**
 * Los productos guardados, en el orden en que se pidieron.
 *
 * PostgREST devuelve lo que quiere para un `in`, y una lista de favoritos que
 * cambia de orden en cada recarga se siente rota. El orden lo pone quien llama
 * —que es quien sabe cuál se guardó antes— y aquí solo se reordena.
 *
 * Un id que ya no esté publicado simplemente no vuelve: el producto se
 * despublicó o se archivó despues de guardarlo, y la lista lo omite en vez de
 * pintar un hueco. Sigue guardado, por si vuelve a la vitrina.
 */
export async function fetchPublicProductsByIds(
  storeId: string | null,
  ids: readonly string[],
): Promise<PublicProduct[]> {
  if (!storeId || ids.length === 0) return []

  const { data, error } = await storefront()
    .from(PUBLIC_PRODUCTS_VIEW)
    .select(PRODUCT_SELECT)
    .eq('store_id', storeId)
    .in('product_id', [...ids])
    .limit(ids.length)

  if (error) throw new StorefrontError(error)
  const rows = publicProductSchema.array().parse(data ?? [])
  const byId = new Map(rows.map((row) => [row.product_id, row]))
  return ids.map((id) => byId.get(id)).filter((row): row is PublicProduct => row !== undefined)
}

export async function fetchPublicProduct(input: {
  storeId: string | null
  slug: string
}): Promise<PublicProduct> {
  if (!input.storeId) throw new StorefrontNotFoundError(input.slug)

  const { data, error } = await storefront()
    .from(PUBLIC_PRODUCTS_VIEW)
    .select(PRODUCT_SELECT)
    .eq('store_id', input.storeId)
    .eq('slug', input.slug)
    .maybeSingle()

  if (error) throw new StorefrontError(error)
  if (!data) throw new StorefrontNotFoundError(input.slug)
  return publicProductSchema.parse(data)
}

/**
 * Variantes publicadas de un producto (P03-SaaS).
 *
 * La vista `public_product_variants` solo devuelve variantes activas de un
 * producto publicado en tienda activa, y ya trae el precio heredado resuelto.
 * Como el resto de la vitrina, se consulta con el cliente ANÓNIMO.
 */
export async function fetchPublicVariants(productId: string | null): Promise<PublicVariant[]> {
  if (!productId) return []

  const { data, error } = await storefront()
    .from(PUBLIC_PRODUCT_VARIANTS_VIEW)
    .select(VARIANT_SELECT)
    .eq('product_id', productId)
    .order('position')
    .order('name')

  if (error) throw new StorefrontError(error)
  return publicVariantSchema.array().parse(data ?? [])
}

/**
 * Galería de la ficha, ya resuelta a URLs pintables.
 *
 * El bucket es PRIVADO (decisión P02 #18): no hay URL pública ni para el dueño.
 * Se firman por una hora — de sobra para una visita — y quien autoriza la firma
 * es la policy `ebim_objects_select_public_product`, que solo deja pasar
 * objetos de producto publicado en tienda activa.
 */
export async function fetchGallery(productId: string | null): Promise<GalleryImage[]> {
  if (!productId) return []
  const supabase = storefront()

  const { data, error } = await supabase
    .from(PUBLIC_PRODUCT_IMAGES_VIEW)
    .select(IMAGE_SELECT)
    .eq('product_id', productId)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })

  if (error) throw new StorefrontError(error)
  const images = publicProductImageSchema.array().parse(data ?? [])
  const urls = await signPaths(images.map((image) => image.storage_path))

  return images.map((image) => ({ ...image, url: urls[image.storage_path] ?? null }))
}

/**
 * Firma un lote de rutas, reutilizando las que siguen vivas.
 *
 * La caché ([`signed-url-cache`](./signed-url-cache.ts)) es lo que hace que
 * volver al catálogo no vuelva a bajar las mismas fotos: firmar otra vez cambia
 * la URL, y una URL nueva es, para el navegador, otra imagen que descargar.
 *
 * Una firma que falle no puede tumbar el catálogo entero: el producto se sigue
 * viendo con el marcador neutral en vez de la foto.
 */
export async function signPaths(paths: string[]): Promise<Record<string, string>> {
  return signedUrls(PRODUCT_IMAGES_BUCKET, paths, async (missing) => {
    const { data, error } = await storefront()
      .storage.from(PRODUCT_IMAGES_BUCKET)
      .createSignedUrls(missing, SIGN_TTL_SECONDS)

    if (error) return {}

    const map: Record<string, string> = {}
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) map[item.path] = item.signedUrl
    }
    return map
  })
}

/**
 * Firma un lote de rutas del bucket de BRANDING (`store-assets`).
 *
 * Es la hermana de `signPaths`, que firma sobre `product-images`. Son dos
 * buckets con dos policies distintas —una mira producto publicado, la otra
 * tienda activa— y por eso son dos funciones y no una con parámetro: un
 * parámetro invitaría a pasar el bucket equivocado y a que la policy que
 * autoriza no fuera la que se cree.
 *
 * Lo usa el contenido del CMS (P11-SaaS): la imagen de un hero o de un banner
 * vive en el mismo bucket privado que el logo del tenant.
 */
export async function signStoreAssetPaths(paths: string[]): Promise<Record<string, string>> {
  return signedUrls(STORE_ASSETS_BUCKET, paths, async (missing) => {
    const { data, error } = await storefront()
      .storage.from(STORE_ASSETS_BUCKET)
      .createSignedUrls(missing, SIGN_TTL_SECONDS)

    if (error) return {}

    const map: Record<string, string> = {}
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) map[item.path] = item.signedUrl
    }
    return map
  })
}

/**
 * Recupera un pedido con el token que el comprador lleva en el enlace.
 *
 * `orders` NO esta abierta a `anon`: la unica puerta es la funcion
 * `order_by_token`, que exige tienda activa, numero y token, y que devuelve el
 * mismo error tanto si el pedido no existe como si el token es incorrecto —los
 * numeros de pedido son correlativos y mensajes distintos permitirian
 * enumerarlos—. Por eso aqui tampoco se distinguen los casos.
 */
export async function fetchOrderByToken(input: {
  storeSlug: string
  orderNumber: string
  token: string
}): Promise<TrackedOrder> {
  const { data, error } = await storefront().rpc(ORDER_BY_TOKEN_RPC, {
    p_store_slug: input.storeSlug,
    p_order_number: input.orderNumber,
    p_token: input.token,
  })

  if (error) throw new OrderNotFoundError()
  return trackedOrderSchema.parse(data)
}
