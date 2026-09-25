import { STORE_ASSETS_BUCKET } from '@/shared/lib/db-schema'
import { ALLOWED_IMAGE_TYPES } from './images'
import { optimizeImageFile } from '@/shared/lib/imageOptimizer'
import { catalogClient } from './client'
import { CatalogError, catalogErrorFromDb } from './errors'

export { STORE_ASSETS_BUCKET }

/**
 * La foto de una categoría: subirla, firmarla y saber cuándo no vale.
 *
 * ## Por qué es un asset de TIENDA y el logo de marca no
 *
 * Porque una categoría SÍ cuelga de una tienda: `public.categories` tiene
 * `store_id` y su FK compuesta obliga a que la madre sea de la misma tienda. El
 * árbol de categorías es navegación del comprador, y cada vitrina tiene el suyo.
 *
 * Así que la ruta usa el prefijo de siempre —`{organization_id}/{store_id}/`— y
 * la autoriza `ebim.can_write_store_object`, que es la función que ya existía.
 * Esta fase no abre ninguna puerta nueva en Storage.
 *
 * ## Y por qué carpeta propia
 *
 * El bucket ya tenía `branding/` (logo y banner de la tienda) y `content/`
 * (imágenes de campaña del CMS). Una categoría no es ninguna de las dos: su
 * ciclo de vida es el del catálogo, no el de la identidad ni el de una campaña
 * de temporada. Con carpeta propia se puede mirar el bucket y saber qué es cada
 * cosa, y borrar las fotos de una temporada sin tocar las de las categorías.
 *
 * La carpeta no cambia la autorización —`can_write_store_object` solo lee los
 * dos primeros segmentos— pero sí la valida el CHECK `categories_image_ref`,
 * que exige `categories/` exactamente.
 */

/** 2 MB. Una foto de categoría por encima de esto es una foto sin optimizar. */
export const MAX_CATEGORY_IMAGE_BYTES = 2 * 1024 * 1024

export type CategoryImageValidation =
  | { ok: true }
  | { ok: false; key: 'catalog.categories.image.errorType' | 'catalog.categories.image.errorSize' }

/**
 * Validación de cliente. La de verdad son la policy de Storage y el CHECK de
 * ruta; esto evita subir ocho megas para que el servidor los rechace.
 *
 * **Sin SVG**, igual que el resto de imágenes que sube el tenant: un SVG es un
 * documento que puede llevar `<script>` y lo sirve el dominio de la vitrina.
 */
export function validateCategoryImage(file: {
  type: string
  size: number
}): CategoryImageValidation {
  if (!ALLOWED_IMAGE_TYPES[file.type]) return { ok: false, key: 'catalog.categories.image.errorType' }
  if (file.size <= 0 || file.size > MAX_CATEGORY_IMAGE_BYTES) {
    return { ok: false, key: 'catalog.categories.image.errorSize' }
  }
  return { ok: true }
}

/**
 * Ruta del objeto: `{organization_id}/{store_id}/categories/{uuid}.{ext}`.
 *
 * La extensión sale del MIME y no del nombre del archivo: un `.jpg` que en
 * realidad es un HTML no se convierte en imagen por llamarse así.
 */
export function buildCategoryImagePath(input: {
  organizationId: string
  storeId: string
  mimeType: string
}): string {
  const extension = ALLOWED_IMAGE_TYPES[input.mimeType]
  if (!extension) throw new CatalogError('catalog.categories.image.errorType', 'MIME_NO_ADMITIDO')
  return `${input.organizationId}/${input.storeId}/categories/${crypto.randomUUID()}.${extension}`
}

/** ¿Es una URL externa o una ruta del bucket privado? */
export function isExternalCategoryImage(value: string): boolean {
  return /^https:\/\//i.test(value)
}

/**
 * Sube el archivo y devuelve su RUTA.
 *
 * Lo que se guarda en `categories.image_url` es la ruta, no una URL firmada:
 * una firma caduca en una hora y dejaría la portada sin fotos al día siguiente.
 *
 * Se sube ANTES de guardar la fila. Si alguien sube y cancela, queda un objeto
 * huérfano —que no rompe ninguna pantalla—. Al revés, la fila apuntaría a un
 * objeto que no existe, y eso sí se ve.
 */
export async function uploadCategoryImage(input: {
  organizationId: string
  storeId: string
  file: File
}): Promise<string> {
  // Se reduce antes de validar (V3 · P11): una puerta de familia ocupa como
  // mucho media pantalla de escritorio, y la pieza principal del mosaico el
  // doble de área.
  const { file } = await optimizeImageFile(input.file, 'category')

  const validation = validateCategoryImage(file)
  if (!validation.ok) throw new CatalogError(validation.key, 'ARCHIVO_INVALIDO')

  const path = buildCategoryImagePath({
    organizationId: input.organizationId,
    storeId: input.storeId,
    mimeType: file.type,
  })

  const { error } = await catalogClient()
    .storage.from(STORE_ASSETS_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
      // La ruta lleva un uuid: el contenido de este objeto nunca cambia.
      cacheControl: '604800',
    })

  if (error) throw catalogErrorFromDb(error)
  return path
}

/**
 * URLs para VER las fotos en el backoffice, en UN lote.
 *
 * Una externa se devuelve tal cual; una ruta se firma con la sesión del
 * usuario, así que autoriza `ebim_objects_select_member`. Una firma que falle no
 * puede tumbar la pantalla de categorías: se devuelve lo que se pudo firmar y
 * el resto cae al tinte con icono, que es el mismo respaldo de la vitrina.
 */
export async function signedCategoryImageUrls(
  refs: readonly (string | null)[],
): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {}
  const rutas: string[] = []

  for (const ref of refs) {
    if (!ref) continue
    if (isExternalCategoryImage(ref)) mapa[ref] = ref
    else rutas.push(ref)
  }
  if (rutas.length === 0) return mapa

  const { data, error } = await catalogClient()
    .storage.from(STORE_ASSETS_BUCKET)
    .createSignedUrls([...new Set(rutas)], 3600)

  if (error) return mapa
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl
  }
  return mapa
}
