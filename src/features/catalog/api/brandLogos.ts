import { STORE_ASSETS_BUCKET } from '@/shared/lib/db-schema'
import { ALLOWED_IMAGE_TYPES } from './images'
import { optimizeImageFile } from '@/shared/lib/imageOptimizer'
import { catalogClient } from './client'
import { CatalogError, catalogErrorFromDb } from './errors'

export { STORE_ASSETS_BUCKET }

/**
 * El logo de una marca: subirlo, firmarlo y borrarlo.
 *
 * ## Por qué esto no es una foto de producto
 *
 * Las fotos de producto viven en `product-images` bajo
 * `{organization_id}/{store_id}/{product_id}/…`, y esa ruta autoriza porque una
 * foto de producto es de una tienda. Una MARCA no: `public.brands` no tiene
 * `store_id` y eso es deliberado desde el PIM —la misma marca se vende en la
 * mayorista y en la minorista de la misma sociedad, y tenerla dos veces
 * significa que un día el logo se cambia en una y no en la otra—.
 *
 * Así que el logo es un asset de SOCIEDAD y su ruta lo dice:
 *
 *     {organization_id}/company/{company_id}/brands/{uuid}.{ext}
 *
 * Quien autoriza es `ebim.can_write_company_object(name)`, que saca la
 * organización del primer segmento y la sociedad del tercero y comprueba el rol
 * contra la membresía de esa sociedad (migración `20260923150000`). El literal
 * `company` del segundo segmento es lo que separa las dos familias de rutas del
 * mismo bucket: con él, `ebim.storage_store` devuelve NULL y las policies de
 * tienda no autorizan nada.
 *
 * ## Por qué el bucket es el de branding y no uno nuevo
 *
 * Porque su naturaleza es la misma —una imagen publicable de identidad— y sus
 * policies ya distinguen por ruta. Un bucket por tipo de asset multiplica las
 * policies que hay que mantener sincronizadas, que es la forma habitual de que
 * una se quede sin el `revoke` de la otra.
 */

/** 2 MB. Un logo por encima de esto es un PNG sin optimizar, no un logo. */
export const MAX_BRAND_LOGO_BYTES = 2 * 1024 * 1024

export type BrandLogoValidation = { ok: true } | { ok: false; key: 'pim.brands.logo.errorType' | 'pim.brands.logo.errorSize' }

/**
 * Validación de cliente. La de verdad es la policy de Storage más el CHECK
 * `brands_logo_ref`; esto solo evita subir 8 MB para que el servidor los
 * rechace.
 *
 * **Sin SVG**, igual que el branding de la tienda: un SVG es un documento que
 * puede llevar `<script>`, lo sube el tenant y lo sirve el dominio de la
 * vitrina. Este repositorio no tiene sanitizador de SVG aprobado.
 */
export function validateBrandLogo(file: { type: string; size: number }): BrandLogoValidation {
  if (!ALLOWED_IMAGE_TYPES[file.type]) return { ok: false, key: 'pim.brands.logo.errorType' }
  if (file.size <= 0 || file.size > MAX_BRAND_LOGO_BYTES) {
    return { ok: false, key: 'pim.brands.logo.errorSize' }
  }
  return { ok: true }
}

/**
 * Ruta del objeto. La extensión sale del MIME y NO del nombre del archivo: un
 * `.jpg` que en realidad es un HTML no se convierte en imagen por llamarse así.
 */
export function buildBrandLogoPath(input: {
  organizationId: string
  companyId: string
  mimeType: string
}): string {
  const extension = ALLOWED_IMAGE_TYPES[input.mimeType]
  if (!extension) throw new CatalogError('pim.brands.logo.errorType', 'MIME_NO_ADMITIDO')
  return `${input.organizationId}/company/${input.companyId}/brands/${crypto.randomUUID()}.${extension}`
}

/** ¿Es una URL externa (contrato §4.3) o una ruta del bucket privado? */
export function isExternalBrandLogo(value: string): boolean {
  return /^https:\/\//i.test(value)
}

/**
 * Sube el archivo y devuelve su RUTA.
 *
 * Lo que se guarda en `brands.logo_url` es la ruta, no una URL firmada: una
 * firma caduca en una hora y dejaría la vitrina sin logo al día siguiente.
 *
 * Se sube ANTES de guardar la fila. Si alguien sube y luego cancela, queda un
 * objeto huérfano en el bucket —que no rompe ninguna pantalla—. Al revés, el
 * riesgo sería una fila apuntando a un objeto que no existe, y eso sí se ve.
 */
export async function uploadBrandLogo(input: {
  organizationId: string
  companyId: string
  file: File
}): Promise<string> {
  // Se reduce antes de validar (V3 · P11): un logotipo de 3000 px se pinta a
  // 44 en el muro de marcas, y rechazarlo por peso dejaba a la marca sin
  // logotipo. WebP conserva la transparencia, que en un logotipo es el dato.
  const { file } = await optimizeImageFile(input.file, 'logo')

  const validation = validateBrandLogo(file)
  if (!validation.ok) throw new CatalogError(validation.key, 'ARCHIVO_INVALIDO')

  const path = buildBrandLogoPath({
    organizationId: input.organizationId,
    companyId: input.companyId,
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
 * URLs para VER los logos en el backoffice.
 *
 * Una `https://` externa se devuelve tal cual; una ruta se firma contra el
 * bucket privado con la sesión del usuario, así que quien autoriza es
 * `ebim_objects_select_company_member`.
 *
 * Una firma que falle no puede tumbar la tabla de marcas: se devuelve lo que se
 * pudo firmar y el resto cae al monograma, que es el mismo respaldo que usa la
 * vitrina.
 */
export async function signedBrandLogoUrls(
  refs: readonly (string | null)[],
): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {}
  const rutas: string[] = []

  for (const ref of refs) {
    if (!ref) continue
    if (isExternalBrandLogo(ref)) mapa[ref] = ref
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
