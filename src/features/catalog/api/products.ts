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
import { CATALOG_PRODUCT_FUNCTION, PRODUCT_USAGE_RPC } from '@/shared/lib/db-schema'
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

/** Tamaño de página del listado del backoffice. */
export const PRODUCTS_PAGE_SIZE = 25

export interface ProductQuery {
  storeId: string | null
  search: string
  status: ProductStatusFilter
  /** Página empezando en 0. */
  page: number
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
}: ProductQuery): Promise<ProductPage> {
  if (!storeId) return { rows: [], total: 0 }
  const supabase = catalogClient()

  let query = supabase
    .from(PRODUCTS_TABLE)
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('store_id', storeId)
  if (status !== 'all') query = query.eq('status', status)

  const filter = buildTextSearchFilter(search, ['name', 'sku', 'slug'])
  if (filter) query = query.or(filter)

  const from = Math.max(0, page) * PRODUCTS_PAGE_SIZE
  const { data, error, count } = await query
    .order('name')
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
