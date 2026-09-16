import {
  PRODUCT_IMAGES_TABLE,
  productMasterSchema,
  productPublicationSchema,
  productUsageSchema,
  type ProductFormValues,
  type ProductMaster,
  type ProductPublication,
  type ProductStatus,
  type ProductUsage,
  type PublicationFormValues,
} from '../types'
import {
  ADMIN_PRODUCT_MASTERS_VIEW,
  CATALOG_PRODUCT_FUNCTION,
  DELETE_PRODUCT_MASTER_RPC,
  PRODUCT_STORE_PUBLICATIONS_RPC,
  PRODUCT_USAGE_RPC,
  PUBLISH_PRODUCT_RPC,
  UNPUBLISH_PRODUCT_RPC,
  UPDATE_PRODUCT_PUBLICATION_RPC,
} from '@/shared/lib/db-schema'
import { PRODUCT_IMAGES_BUCKET } from './images'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { catalogClient } from './client'
import { catalogErrorFromDb, catalogErrorFromInvoke } from './errors'

export { CATALOG_PRODUCT_FUNCTION, PRODUCT_USAGE_RPC }

/**
 * Lo que la pantalla de productos lee de `admin_product_masters`. Sin precio a
 * propósito: el precio es de cada publicación (ADR 018), y un único importe en
 * el listado afirmaría algo que no es cierto en cuanto dos tiendas difieren.
 */
const MASTER_SELECT = [
  'id',
  'organization_id',
  'company_id',
  'origin_store_id',
  'sku',
  'name',
  'description',
  'kind',
  'brand_id',
  'brand_name',
  'family_id',
  'family_name',
  'tax_category_id',
  'stock',
  'legacy_sku_conflict',
  'updated_at',
  'publication_count',
  'published_count',
  'store_ids',
  'published_store_names',
  'category_ids',
  'publication_state',
].join(', ')

export type ProductStatusFilter = ProductStatus | 'all'

/**
 * Por qué columnas se puede ordenar el listado.
 *
 * Cerrado a propósito: el nombre de columna viaja tal cual a PostgREST, y una
 * lista abierta convierte el `order=` en un parámetro que decide el cliente.
 * Son las que se ven en la cabecera de la tabla — ordenar por algo que no está
 * en pantalla no se puede ni pedir ni entender.
 */
export const PRODUCT_SORT_COLUMNS = [
  'name',
  'sku',
  'brand_name',
  'published_count',
  'stock',
  'publication_state',
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
  /**
   * La sociedad activa. NO filtra: la vista ya se limita a la sociedad activa
   * del JWT. Está para que la caché de otra sociedad no se sirva al cambiar.
   */
  companyId: string | null
  search: string
  /** Estado AGREGADO del maestro (publicado en alguna tienda, etc.). */
  status: ProductStatusFilter
  /** Página empezando en 0. */
  page: number
  sort?: ProductSort
  /**
   * La categoría elegida Y SU DESCENDENCIA, ya expandida. Las categorías son de
   * la tienda activa, así que el filtro deja los maestros publicados en ella
   * bajo alguna de esas categorías.
   */
  categoryIds?: readonly string[] | null
  brandId?: string | null
  /** Deja solo lo que tiene AL MENOS esta cantidad. */
  minStock?: number | null
}

export interface ProductPage {
  rows: ProductMaster[]
  /** Total de filas que cumplen el filtro, no las de esta página. */
  total: number
}

/**
 * Productos MAESTROS de la sociedad activa, paginados en el servidor.
 *
 * Una fila por producto aunque se venda en varias tiendas. No se envía
 * `organization_id`/`company_id`: la vista y la RLS los toman del JWT.
 */
export async function fetchProducts({
  companyId,
  search,
  status,
  page,
  sort,
  categoryIds,
  brandId,
  minStock,
}: ProductQuery): Promise<ProductPage> {
  if (!companyId) return { rows: [], total: 0 }
  const supabase = catalogClient()

  let query = supabase.from(ADMIN_PRODUCT_MASTERS_VIEW).select(MASTER_SELECT, { count: 'exact' })
  if (status !== 'all') query = query.eq('publication_state', status)

  // El texto libre busca en lo que el usuario VE en la fila.
  const filter = buildTextSearchFilter(search, ['name', 'sku', 'brand_name', 'family_name'])
  if (filter) query = query.or(filter)

  // `ov` (se solapan): el maestro tiene alguna publicación en esas categorías.
  if (categoryIds && categoryIds.length > 0) query = query.overlaps('category_ids', [...categoryIds])
  if (brandId) query = query.eq('brand_id', brandId)
  if (typeof minStock === 'number' && Number.isFinite(minStock)) {
    query = query.gte('stock', minStock)
  }

  const orden = sort ?? DEFAULT_PRODUCT_SORT
  const from = Math.max(0, page) * PRODUCTS_PAGE_SIZE
  const { data, error, count } = await query
    .order(orden.column, { ascending: orden.direction === 'asc', nullsFirst: false })
    // Desempate estable: sin él, dos filas iguales saltan de página entre consultas.
    .order('id', { ascending: true })
    .range(from, from + PRODUCTS_PAGE_SIZE - 1)

  if (error) throw catalogErrorFromDb(error)
  return {
    rows: productMasterSchema.array().parse(data ?? []),
    total: typeof count === 'number' ? count : (data?.length ?? 0),
  }
}

interface CatalogProductResponse {
  data: { id: string }
}

/**
 * Alta y edición del MAESTRO por la Edge Function `catalog-product`, que actúa
 * con el JWT del usuario (nunca `service_role`). El cuerpo NO lleva tenant.
 *
 * - Alta con `publish`: manda `store_id` y los campos de la publicación, y la
 *   función crea el maestro publicado en esa tienda en la misma escritura.
 * - Alta sin `publish`: solo el maestro; se publica después en «Tiendas».
 * - Edición: solo campos del maestro. Lo de cada tienda va por sus comandos.
 */
export async function saveProduct(input: {
  productId?: string | null
  storeId: string | null
  values: ProductFormValues
}): Promise<{ id: string }> {
  const supabase = catalogClient()
  const { values } = input

  const master = {
    sku: values.sku,
    name: values.name,
    description: values.description,
    stock: Number(values.stock),
    kind: values.kind,
    brand_id: values.brand_id || null,
    family_id: values.family_id || null,
    // Vacío = `null` = la categoría fiscal por defecto de la sociedad. Se manda
    // siempre: omitirlo dejaría imposible volver un exonerado a la tasa general.
    tax_category_id: values.tax_category_id || null,
  }

  let body: Record<string, unknown>
  if (input.productId) {
    body = { action: 'update', product_id: input.productId, ...master }
  } else if (values.publish && input.storeId) {
    body = {
      action: 'create',
      store_id: input.storeId,
      ...master,
      slug: values.slug,
      price: values.price,
      status: values.status,
      category_id: values.category_id || null,
    }
  } else {
    body = { action: 'create', ...master }
  }

  const { data, error } = await supabase.functions.invoke<CatalogProductResponse>(
    CATALOG_PRODUCT_FUNCTION,
    { body },
  )

  if (error) throw await catalogErrorFromInvoke(error)
  if (!data?.data?.id) throw await catalogErrorFromInvoke(null)
  return { id: data.data.id }
}

/** Todas las tiendas de la sociedad y el estado del producto en cada una. */
export async function fetchProductPublications(productId: string): Promise<ProductPublication[]> {
  const { data, error } = await catalogClient().rpc(PRODUCT_STORE_PUBLICATIONS_RPC, {
    p_product_id: productId,
  })
  if (error) throw catalogErrorFromDb(error)
  return productPublicationSchema.array().parse(data ?? [])
}

/** Publica el maestro en una tienda. La moneda la pone la tienda, no el cliente. */
export async function publishProduct(input: {
  productId: string
  storeId: string
  values: PublicationFormValues
}): Promise<void> {
  const { values } = input
  const { error } = await catalogClient().rpc(PUBLISH_PRODUCT_RPC, {
    p_product_id: input.productId,
    p_store_id: input.storeId,
    p_slug: values.slug,
    p_price: values.price,
    p_category_id: values.category_id || null,
    p_status: values.status,
  })
  if (error) throw catalogErrorFromDb(error)
}

/**
 * Edita la publicación de UNA tienda. Solo viaja lo que cambió: NULL significa
 * «no tocar» en el comando, y la categoría vacía se pide con `p_clear_category`.
 */
export async function updatePublication(input: {
  productId: string
  storeId: string
  current: ProductPublication
  values: PublicationFormValues
}): Promise<void> {
  const { current, values } = input
  const category = values.category_id || null
  const { error } = await catalogClient().rpc(UPDATE_PRODUCT_PUBLICATION_RPC, {
    p_product_id: input.productId,
    p_store_id: input.storeId,
    p_slug: values.slug !== current.slug ? values.slug : null,
    p_category_id: category !== null && category !== current.category_id ? category : null,
    p_clear_category: category === null && current.category_id !== null,
    p_status: values.status !== current.status ? values.status : null,
    p_price: values.price !== current.price ? values.price : null,
  })
  if (error) throw catalogErrorFromDb(error)
}

/** Cambia solo el estado de la publicación de una tienda. */
export async function setPublicationStatus(input: {
  productId: string
  storeId: string
  status: ProductStatus
}): Promise<void> {
  const { error } = await catalogClient().rpc(UPDATE_PRODUCT_PUBLICATION_RPC, {
    p_product_id: input.productId,
    p_store_id: input.storeId,
    p_status: input.status,
  })
  if (error) throw catalogErrorFromDb(error)
}

/** Quita el producto de una tienda. El maestro y las demás tiendas no cambian. */
export async function unpublishProduct(input: { productId: string; storeId: string }): Promise<void> {
  const { error } = await catalogClient().rpc(UNPUBLISH_PRODUCT_RPC, {
    p_product_id: input.productId,
    p_store_id: input.storeId,
  })
  if (error) throw catalogErrorFromDb(error)
}

/** Conteo real de uso antes de borrar (contrato §4.2). Cuenta bajo RLS. */
export async function fetchProductUsage(productId: string): Promise<ProductUsage> {
  const supabase = catalogClient()
  const { data, error } = await supabase.rpc(PRODUCT_USAGE_RPC, { p_product_id: productId })
  if (error) throw catalogErrorFromDb(error)
  return productUsageSchema.parse(data)
}

/**
 * Borrado definitivo del maestro.
 *
 * Pasa por `delete_product_master`, que lo NIEGA si el producto sigue publicado
 * en alguna tienda, tiene pedidos o es componente de un kit: la protección no
 * depende de que la pantalla esconda el botón.
 *
 * Orden deliberado: primero la fila y después los objetos de Storage. Al revés,
 * si el borrado fallara, las fotos ya estarían perdidas. Lo peor que puede pasar
 * así es dejar objetos huérfanos, que no rompen ninguna pantalla.
 */
export async function deleteProduct(productId: string): Promise<void> {
  const supabase = catalogClient()

  const { data: images, error: imagesError } = await supabase
    .from(PRODUCT_IMAGES_TABLE)
    .select('storage_path')
    .eq('product_id', productId)
  if (imagesError) throw catalogErrorFromDb(imagesError)

  const { error } = await supabase.rpc(DELETE_PRODUCT_MASTER_RPC, { p_product_id: productId })
  if (error) throw catalogErrorFromDb(error)

  const paths = (images ?? [])
    .map((row) => (row as { storage_path?: unknown }).storage_path)
    .filter((path): path is string => typeof path === 'string')

  if (paths.length > 0) {
    await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove(paths)
  }
}
