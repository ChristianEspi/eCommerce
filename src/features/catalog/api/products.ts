import {
  PRODUCTS_TABLE,
  PRODUCT_IMAGES_TABLE,
  productSchema,
  productUsageSchema,
  type Product,
  type ProductFormValues,
  type ProductStatus,
  type ProductUsage,
} from '../types'
import {
  ADMIN_PRODUCTS_VIEW,
  CATALOG_PRODUCT_FUNCTION,
  PRODUCT_USAGE_RPC,
} from '@/shared/lib/db-schema'
import { PRODUCT_IMAGES_BUCKET } from './images'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { catalogClient } from './client'
import { catalogErrorFromDb, catalogErrorFromInvoke } from './errors'

export { CATALOG_PRODUCT_FUNCTION, PRODUCT_USAGE_RPC }

/**
 * `price::text` y `compare_at_price::text`: el importe sale como texto para no
 * pasar por el float del navegador (decisión P02 #19).
 */
const PRODUCT_SELECT = [
  'id',
  'organization_id',
  'company_id',
  'store_id',
  'category_id',
  'sku',
  'name',
  'slug',
  'description',
  'status',
  'price::text',
  'compare_at_price::text',
  'currency',
  'stock',
  'published_at',
  'updated_at',
  'kind',
  'brand_id',
  'family_id',
  'tax_category_id',
].join(', ')

export type ProductStatusFilter = ProductStatus | 'all'

/**
 * Por qué columnas se puede ordenar el listado.
 *
 * Cerrado a propósito: el nombre de columna viaja tal cual a PostgREST, y una
 * lista abierta convierte el `order=` en un parámetro que decide el cliente.
 * Son las mismas seis que se ven en la cabecera de la tabla — ordenar por algo
 * que no está en pantalla no se puede ni pedir ni entender.
 */
export const PRODUCT_SORT_COLUMNS = [
  'name',
  'sku',
  'category_name',
  'price',
  'stock',
  'status',
] as const

export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number]

export interface ProductSort {
  readonly column: ProductSortColumn
  readonly direction: 'asc' | 'desc'
}

/** Alfabético por nombre: como estaba antes de que se pudiera ordenar. */
export const DEFAULT_PRODUCT_SORT: ProductSort = { column: 'name', direction: 'asc' }

/** Tamaño de página del listado del backoffice. */
export const PRODUCTS_PAGE_SIZE = 25

export interface ProductQuery {
  storeId: string | null
  search: string
  status: ProductStatusFilter
  /** Página empezando en 0. */
  page: number
  sort?: ProductSort
  /**
   * La categoría elegida Y SU DESCENDENCIA, ya expandida.
   *
   * Expandida por quien llama y no aquí porque el árbol vive en el cliente —la
   * pantalla ya lo tiene cargado para pintar el desplegable— y esta función no
   * tiene por qué saber que las categorías anidan.
   *
   * Elegir «Medicamentos» y no ver los antiinfecciosos es la respuesta que
   * nadie espera: quien abre una familia quiere lo que hay dentro, no solo lo
   * que alguien colgó directamente de ella.
   */
  categoryIds?: readonly string[] | null
  brandId?: string | null
  /** Deja solo lo que tiene AL MENOS esta cantidad. */
  minStock?: number | null
}

export interface ProductPage {
  rows: Product[]
  /** Total de filas que cumplen el filtro, no las de esta página. */
  total: number
}

/**
 * Productos de la tienda activa, PAGINADOS EN EL SERVIDOR (P03-SaaS).
 *
 * Hasta P02 el listado traía la tabla entera y la pintaba: correcto con
 * cincuenta productos, insostenible con los miles que el PIM hace normales. El
 * filtro, el orden y el corte los hace Postgres; el navegador recibe una página.
 * `count: 'exact'` viaja en la misma petición, así que la paginación no cuesta
 * un viaje extra.
 *
 * No se envía `organization_id`/`company_id`: el aislamiento lo garantiza la
 * RLS a partir del JWT. `store_id` sí se filtra, pero es alcance de pantalla y
 * no seguridad — una tienda ajena tampoco devolvería filas.
 */
export async function fetchProducts({
  storeId,
  search,
  status,
  page,
  sort,
  categoryIds,
  brandId,
  minStock,
}: ProductQuery): Promise<ProductPage> {
  if (!storeId) return { rows: [], total: 0 }
  const supabase = catalogClient()

  // Se lee de la VISTA y no de la tabla: es la que trae `category_name` y
  // `brand_name` al lado, que es lo que permite buscar «cabello» o «eucerin»
  // en la misma caja. `security_invoker`, o sea la misma RLS de siempre.
  let query = supabase
    .from(ADMIN_PRODUCTS_VIEW)
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('store_id', storeId)
  if (status !== 'all') query = query.eq('status', status)

  // El texto libre busca en las cinco columnas que el usuario VE. Antes eran
  // tres —nombre, SKU y slug— y las dos que faltaban son justo las que están
  // escritas en la tabla: escribir lo que uno lee en pantalla y no encontrar
  // nada es la peor respuesta posible de un buscador.
  const filter = buildTextSearchFilter(search, [
    'name',
    'sku',
    'slug',
    'category_name',
    'brand_name',
  ])
  if (filter) query = query.or(filter)

  // Categoría y marca por IDENTIFICADOR y no por nombre: salen de un
  // desplegable, así que no hay nada que interpretar. Dos categorías con
  // nombres parecidos —«Cuidado de la piel» y «Cuidado del cabello»— se
  // distinguen sin ambigüedad, cosa que un `ilike` sobre el nombre no puede
  // prometer.
  //
  // `in` y no `eq`: la lista ya trae la familia entera, así que elegir la madre
  // enseña también lo que cuelga de ella.
  if (categoryIds && categoryIds.length > 0) query = query.in('category_id', [...categoryIds])
  if (brandId) query = query.eq('brand_id', brandId)
  // Mínimo, no exacto: la pregunta real es «qué me queda por encima de», y para
  // «lo que se está acabando» se pone 1 y se ordena por stock.
  if (typeof minStock === 'number' && Number.isFinite(minStock)) {
    query = query.gte('stock', minStock)
  }

  const orden = sort ?? DEFAULT_PRODUCT_SORT
  const from = Math.max(0, page) * PRODUCTS_PAGE_SIZE
  const { data, error, count } = await query
    // `nullsFirst: false` para que los productos sin categoría o sin marca
    // queden al final y no ocupen la primera página al ordenar por ellas.
    .order(orden.column, { ascending: orden.direction === 'asc', nullsFirst: false })
    // Desempate estable: dos productos con el mismo precio saltarían de página
    // entre consultas, y al pasar a la siguiente uno se repite y otro no sale.
    .order('id', { ascending: true })
    .range(from, from + PRODUCTS_PAGE_SIZE - 1)

  if (error) throw catalogErrorFromDb(error)
  return {
    rows: productSchema.array().parse(data ?? []),
    // `count` puede faltar si el backend no lo devuelve; caer al tamaño de la
    // página deja la paginación consistente en vez de anunciar cero filas.
    total: typeof count === 'number' ? count : (data?.length ?? 0),
  }
}

interface CatalogProductResponse {
  data: { id: string; status: ProductStatus }
}

/**
 * Alta y edición pasan por la Edge Function `catalog-product`, que actúa con
 * el JWT del usuario (nunca `service_role`) y deja decidir a la RLS. El cuerpo
 * NO lleva tenant: la función lo saca del token y rechaza con 400 cualquier
 * intento de declararlo.
 */
export async function saveProduct(input: {
  productId?: string | null
  storeId: string
  values: ProductFormValues
}): Promise<{ id: string; status: ProductStatus }> {
  const supabase = catalogClient()
  const { values } = input

  const fields = {
    sku: values.sku,
    slug: values.slug,
    name: values.name,
    description: values.description,
    price: values.price,
    stock: Number(values.stock),
    status: values.status,
    category_id: values.category_id || null,
    kind: values.kind,
    brand_id: values.brand_id || null,
    family_id: values.family_id || null,
    // Vacío = `null` = la categoría fiscal por defecto de la sociedad. Se manda
    // igual al crear y al editar: omitirlo en la edición dejaría imposible
    // volver un producto exonerado a la tasa general.
    tax_category_id: values.tax_category_id || null,
  }

  const body = input.productId
    ? { action: 'update', product_id: input.productId, ...fields }
    : { action: 'create', store_id: input.storeId, ...fields }

  const { data, error } = await supabase.functions.invoke<CatalogProductResponse>(
    CATALOG_PRODUCT_FUNCTION,
    { body },
  )

  if (error) throw await catalogErrorFromInvoke(error)
  if (!data?.data?.id) throw await catalogErrorFromInvoke(null)
  return { id: data.data.id, status: data.data.status }
}

/**
 * Publicar / despublicar / archivar. Se manda solo `status`: `published_at` lo
 * pone la Edge Function, porque un producto publicado sin fecha viola el CHECK
 * de la tabla y el storefront lo dejaría fuera del listado.
 */
export async function setProductStatus(input: {
  productId: string
  status: ProductStatus
}): Promise<void> {
  const supabase = catalogClient()
  const { error } = await supabase.functions.invoke(CATALOG_PRODUCT_FUNCTION, {
    body: { action: 'update', product_id: input.productId, status: input.status },
  })
  if (error) throw await catalogErrorFromInvoke(error)
}

/** Conteo real de uso antes de borrar (contrato §4.2). Cuenta bajo RLS. */
export async function fetchProductUsage(productId: string): Promise<ProductUsage> {
  const supabase = catalogClient()
  const { data, error } = await supabase.rpc(PRODUCT_USAGE_RPC, { p_product_id: productId })
  if (error) throw catalogErrorFromDb(error)
  return productUsageSchema.parse(data)
}

/**
 * Borrado definitivo.
 *
 * Orden deliberado: primero la fila y después los objetos de Storage. Al revés,
 * si el DELETE fallara (rol sin permiso, RLS), las fotos ya estarían perdidas y
 * el producto seguiría en el catálogo apuntando a rutas muertas. Así, lo peor
 * que puede pasar es dejar objetos huérfanos, que no rompen ninguna pantalla.
 * `product_images` cae en cascada con el producto.
 */
export async function deleteProduct(productId: string): Promise<void> {
  const supabase = catalogClient()

  const { data: images, error: imagesError } = await supabase
    .from(PRODUCT_IMAGES_TABLE)
    .select('storage_path')
    .eq('product_id', productId)
  if (imagesError) throw catalogErrorFromDb(imagesError)

  const { error } = await supabase.from(PRODUCTS_TABLE).delete().eq('id', productId)
  if (error) throw catalogErrorFromDb(error)

  const paths = (images ?? [])
    .map((row) => (row as { storage_path?: unknown }).storage_path)
    .filter((path): path is string => typeof path === 'string')

  if (paths.length > 0) {
    await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove(paths)
  }
}
