import type { MessageKey } from '@/shared/i18n/messages'
import { PRODUCT_IMAGES_TABLE, productImageSchema, type ProductImage } from '../types'
import { optimizeImageFile } from '@/shared/lib/imageOptimizer'
import { catalogClient } from './client'
import { CatalogError, catalogErrorFromDb } from './errors'

/**
 * Bucket PRIVADO creado en `20260827090600_storage_buckets.sql` y RPCs de
 * imagenes. Fuente unica: `shared/lib/db-schema.ts`.
 */
import {
  PRODUCT_IMAGES_BUCKET,
  SET_PRIMARY_IMAGE_RPC,
  REORDER_IMAGES_RPC,
} from '@/shared/lib/db-schema'

export { PRODUCT_IMAGES_BUCKET, SET_PRIMARY_IMAGE_RPC, REORDER_IMAGES_RPC }

/** 5 MB. Una foto de catálogo por encima de esto es una foto sin optimizar. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Tipos aceptados y su extensión canónica.
 *
 * La extensión sale del MIME, no del nombre del archivo: un `.jpg` que en
 * realidad es un HTML no se convierte en imagen por llamarse así, y guardar la
 * extensión que el usuario escribió deja el objeto con un tipo que no es.
 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export type ImageValidation = { ok: true } | { ok: false; key: MessageKey }

/** Validación de cliente. La de verdad es la policy de Storage + el CHECK de ruta. */
export function validateImageFile(file: { type: string; size: number }): ImageValidation {
  if (!ALLOWED_IMAGE_TYPES[file.type]) return { ok: false, key: 'catalog.images.error.type' }
  if (file.size <= 0) return { ok: false, key: 'catalog.images.error.empty' }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, key: 'catalog.images.error.size' }
  return { ok: true }
}

/**
 * Ruta del objeto: `{organization_id}/{store_id}/{product_id}/{uuid}.{ext}`.
 *
 * Los dos primeros segmentos son los que exige el CHECK
 * `product_images_path_tenant` y los que leen `ebim.storage_org` /
 * `ebim.storage_store` para autorizar: una ruta del tenant de al lado no llega
 * ni a insertarse. El tercero agrupa por producto, que es lo que pedía el
 * encargo, y el nombre es un uuid nuevo — el del usuario podría traer acentos,
 * espacios o el nombre de un archivo que ya existe.
 */
export function buildImagePath(input: {
  organizationId: string
  storeId: string
  productId: string
  mimeType: string
}): string {
  const extension = ALLOWED_IMAGE_TYPES[input.mimeType]
  if (!extension) throw new CatalogError('catalog.images.error.type', 'MIME_NO_ADMITIDO')
  return `${input.organizationId}/${input.storeId}/${input.productId}/${crypto.randomUUID()}.${extension}`
}

const IMAGE_SELECT = 'id, product_id, store_id, storage_path, alt, position, is_primary'

export async function fetchProductImages(productId: string | null): Promise<ProductImage[]> {
  if (!productId) return []
  const supabase = catalogClient()

  const { data, error } = await supabase
    .from(PRODUCT_IMAGES_TABLE)
    .select(IMAGE_SELECT)
    .eq('product_id', productId)
    .order('position')

  if (error) throw catalogErrorFromDb(error)
  return productImageSchema.array().parse(data ?? [])
}

/**
 * URLs firmadas para ver las miniaturas en el backoffice.
 *
 * El bucket es privado (decisión P02 #18): no hay URL pública que valga, ni
 * siquiera para el dueño del producto. Se firman por una hora, que sobra para
 * una sesión de edición.
 */
export async function signedImageUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const supabase = catalogClient()

  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .createSignedUrls(paths, 3600)

  if (error) throw catalogErrorFromDb(error)

  const map: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}

/**
 * Sube el objeto y registra la fila.
 *
 * Con la clave PUBLICABLE y la sesión del usuario: `service_role` no existe en
 * el navegador. Quien autoriza la subida es
 * `ebim.can_write_store_object(name)`, que deriva el tenant de la propia ruta.
 *
 * `is_primary` se manda en false siempre: el trigger `product_images_defaults`
 * asciende la primera foto del producto. Decidirlo aquí sería una carrera con
 * el índice único parcial cuando se suben varias a la vez.
 */
export async function uploadProductImage(input: {
  organizationId: string
  companyId: string
  storeId: string
  productId: string
  file: File
  position: number
}): Promise<ProductImage> {
  /**
   * Primero se REDUCE y después se valida (V3 · P11).
   *
   * Al revés, una foto de teléfono de 6 MB se rechazaba por tamaño aunque
   * reducida pesara unos cientos de kilobytes — y el producto se quedaba sin
   * foto, que es el peor resultado posible. Se valida lo que de verdad se sube.
   *
   * El tope es el más alto de la lista porque la galería de la ficha permite
   * ampliar: recortar a 1200 se notaría justo en el gesto en el que alguien
   * está decidiendo si compra.
   */
  const { file } = await optimizeImageFile(input.file, 'product')

  const validation = validateImageFile(file)
  if (!validation.ok) throw new CatalogError(validation.key, 'ARCHIVO_INVALIDO')

  const supabase = catalogClient()
  const path = buildImagePath({
    organizationId: input.organizationId,
    storeId: input.storeId,
    productId: input.productId,
    mimeType: file.type,
  })

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
      // La ruta lleva un uuid: este objeto NUNCA cambia de contenido, así que
      // el navegador puede quedárselo y no volver a pedirlo. Siete días y no
      // un año: los bytes siguen siendo de un bucket privado, y una caché
      // eterna sobreviviría a despublicar el producto.
      cacheControl: '604800',
    })

  if (uploadError) throw catalogErrorFromDb(uploadError)

  const { data, error } = await supabase
    .from(PRODUCT_IMAGES_TABLE)
    .insert({
      organization_id: input.organizationId,
      company_id: input.companyId,
      store_id: input.storeId,
      product_id: input.productId,
      storage_path: path,
      position: input.position,
      is_primary: false,
    })
    .select(IMAGE_SELECT)
    .single()

  if (error) {
    // La fila no entró: el objeto ya subido sería basura invisible en el
    // bucket, así que se retira antes de propagar el error.
    await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
    throw catalogErrorFromDb(error)
  }

  return productImageSchema.parse(data)
}

/** Borra la fila y después el objeto: mismo orden que en `deleteProduct`. */
export async function deleteProductImage(image: ProductImage): Promise<void> {
  const supabase = catalogClient()

  const { error } = await supabase.from(PRODUCT_IMAGES_TABLE).delete().eq('id', image.id)
  if (error) throw catalogErrorFromDb(error)

  await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([image.storage_path])
}

/** Imagen principal: una sola operación en la base (índice único parcial). */
export async function setPrimaryImage(imageId: string): Promise<void> {
  const supabase = catalogClient()
  const { error } = await supabase.rpc(SET_PRIMARY_IMAGE_RPC, { p_image_id: imageId })
  if (error) throw catalogErrorFromDb(error)
}

/** Reordenar: se manda el orden COMPLETO, y la función lo aplica o falla entero. */
export async function reorderProductImages(input: {
  productId: string
  imageIds: string[]
}): Promise<void> {
  const supabase = catalogClient()
  const { error } = await supabase.rpc(REORDER_IMAGES_RPC, {
    p_product_id: input.productId,
    p_image_ids: input.imageIds,
  })
  if (error) throw catalogErrorFromDb(error)
}

/** Mueve un elemento de la lista y devuelve el orden nuevo. Función pura. */
export function moveImage(images: ProductImage[], imageId: string, delta: number): string[] {
  const ids = images.map((image) => image.id)
  const from = ids.indexOf(imageId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  if (moved) next.splice(to, 0, moved)
  return next
}
