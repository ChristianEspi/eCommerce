import type { SupabaseClient } from '@supabase/supabase-js'
import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import {
  STORES_TABLE,
  STORE_ASSETS_BUCKET,
  STORE_SETTINGS_TABLE,
  buildAssetPath,
  isExternalAsset,
  orNull,
  storeSettingsSchema,
  validateAssetFile,
  type AssetKind,
  type StoreFormValues,
  type StoreSettings,
} from './types'

/**
 * Configuración de la tienda: lectura y escritura bajo RLS.
 *
 * Aquí no hay Edge Function y no hace falta: `store_settings` y `stores` tienen
 * policies de escritura para `owner`/`admin` (P02), así que la autorización ya
 * la decide la base con el JWT. Añadir un borde intermedio solo movería la
 * misma comprobación de sitio.
 *
 * Ninguna consulta lleva filtro de tenant: `store_id` es alcance de pantalla,
 * el aislamiento lo pone la RLS.
 */

export class SettingsError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'configuration', key, code })
    this.name = 'SettingsError'
  }
}

export function mapSettingsCode(code: string): MessageKey {
  switch (code) {
    // Dar acceso exige que esa persona YA tenga cuenta: la identidad es de la
    // plataforma y esta pantalla solo reparte membresía. Decirlo evita el
    // «algo salió mal» que no indica qué hacer.
    case 'SIN_CUENTA':
      return 'settings.members.error.noAccount'
    case 'ROL_NO_ASIGNABLE':
      return 'settings.members.error.ownerRole'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'settings.error.forbidden'
    case 'DUPLICADO':
    case '23505':
      return 'settings.error.duplicate'
    case '23514':
    case 'CAMPO_INVALIDO':
      return 'settings.error.invalid'
    default:
      return 'settings.error.generic'
  }
}

function settingsErrorFromDb(error: PostgrestLike): SettingsError {
  const code = codeFromDbError(error)
  return new SettingsError(mapSettingsCode(code), code)
}

const SETTINGS_COLUMNS = [
  'store_id',
  'organization_id',
  'company_id',
  'accent_color',
  'logo_url',
  'banner_url',
  'white_label',
  'checkout_requires_account',
  'require_payment_before_dispatch',
  'default_locale',
  'support_email',
  'hero_title',
  'hero_subtitle',
  'contact_phone',
  'contact_address',
  'favicon_url',
  'font_family',
  'ui_radius',
  'ui_density',
  'business_display_name',
  'email_from_name',
  'email_reply_to',
  'custom_domain_status',
  'custom_domain_verified_at',
]

/**
 * Las tres columnas del Theme Engine, aparte.
 *
 * ## Por qué no van en la lista de arriba sin más
 *
 * Porque PostgREST no ignora una columna que no existe: responde 400 con
 * `42703` y **la consulta entera se cae**. Con las tres dentro de la lista, una
 * base a la que todavía no se le ha aplicado la migración no deja abrir
 * Configuración: ni General, ni Marca, ni Impuestos. Una pantalla de ajustes
 * que muere porque una migración va por detrás es exactamente el fallo que un
 * despliegue en dos pasos produce, y no puede costar el backoffice entero.
 *
 * ## Por qué aquí no vale el `*` que usa la vitrina
 *
 * La vitrina pide `public_stores` con `*` porque esa VISTA es la frontera:
 * enumera a mano lo publicable y todo lo que hay dentro ya es público. Esto es
 * la TABLA `store_settings`, que además guarda `config`, `tax_rate` y el token
 * de verificación del dominio. La lista explícita es lo que mantiene esos tres
 * fuera del navegador, así que se queda.
 */
const THEME_COLUMNS = ['theme_preset', 'storefront_style', 'home_layout'] as const

const SETTINGS_SELECT = [...SETTINGS_COLUMNS, ...THEME_COLUMNS].join(', ')
const SETTINGS_SELECT_SIN_TEMA = SETTINGS_COLUMNS.join(', ')

/** `undefined_column`: la columna pedida no existe todavía en esta base. */
const COLUMNA_INEXISTENTE = '42703'

/**
 * ¿Tiene esta base las columnas del tema?
 *
 * `null` mientras no se sabe. Lo resuelve la primera lectura de ajustes y se
 * recuerda para lo que queda de sesión: no tiene sentido volver a pagar una
 * consulta que ya se sabe que falla.
 *
 * Es estado de DESPLIEGUE, no de aplicación: describe qué versión del esquema
 * hay enfrente, y deja de importar en cuanto la migración se aplica.
 */
let temaEnLaBase: boolean | null = null

/** Para la pantalla de diseño, que no puede ofrecer lo que no se va a guardar. */
export function themeColumnsReady(): boolean {
  return temaEnLaBase !== false
}

/** Para las pruebas: cada una parte sin saber nada de la base. */
export function resetThemeColumnsProbe(): void {
  temaEnLaBase = null
}

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new SettingsError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

export async function fetchStoreSettings(storeId: string | null): Promise<StoreSettings | null> {
  if (!storeId) return null

  const leer = (select: string) =>
    client().from(STORE_SETTINGS_TABLE).select(select).eq('store_id', storeId).maybeSingle()

  let { data, error } = await leer(
    temaEnLaBase === false ? SETTINGS_SELECT_SIN_TEMA : SETTINGS_SELECT,
  )

  // La base va por detrás del código: se relee sin las columnas del tema y la
  // pantalla de Configuración sigue sirviendo para todo lo demás.
  if (error && temaEnLaBase !== false && error.code === COLUMNA_INEXISTENTE) {
    temaEnLaBase = false
    ;({ data, error } = await leer(SETTINGS_SELECT_SIN_TEMA))
  }

  if (error) throw settingsErrorFromDb(error)
  if (data && temaEnLaBase === null) temaEnLaBase = true
  return data ? storeSettingsSchema.parse(data) : null
}

export interface SaveSettingsInput {
  storeId: string
  organizationId: string
  companyId: string
  /** Nombre actual en `stores`: solo se escribe si cambió. */
  currentName: string
  values: StoreFormValues
  /**
   * ¿La sociedad tiene `content.white_label` (contrato §4.3)?
   *
   * Sin ella los campos PREMIUM no se envían en vez de enviarse vacíos: el
   * guardado de un nombre comercial no puede apagar de paso una marca blanca
   * que el tenant tenía. Desde P11-SaaS son cuatro —`white_label`,
   * `font_family` y la identidad de correo—; los de tematización (acento,
   * logo, favicon, radio, densidad) van siempre. Si alguien los forzara
   * igualmente, la policy `store_settings_update_admin` lo rechaza — esto solo
   * evita el 403.
   */
  canWhiteLabel: boolean
}

/**
 * Guarda el nombre comercial en `stores` y el resto en `store_settings`.
 *
 * Son dos tablas y por tanto dos escrituras: el nombre de la tienda es la
 * identidad de la fila (y lo usa el storefront para el `<title>` y el fallback
 * de logo), mientras que el branding vive en su tabla separada justo para poder
 * dar GRANT por columna a `anon` sin exponer `tax_rate` ni `config` (P02).
 *
 * `store_settings` nace con el tenant (`bootstrap_tenant`), pero si por lo que
 * sea no existiera, se inserta en vez de fallar en silencio con "0 filas
 * actualizadas" — un guardado que no guardó nada es peor que un error (P04 #32).
 */
export async function saveStoreSettings(input: SaveSettingsInput): Promise<void> {
  const supabase = client()
  const { values } = input

  if (values.name.trim() !== input.currentName) {
    const { error } = await supabase
      .from(STORES_TABLE)
      .update({ name: values.name.trim() })
      .eq('id', input.storeId)
      .select('id')
      .maybeSingle()
    if (error) throw settingsErrorFromDb(error)
  }

  const patch = {
    accent_color: values.accent_color.trim().toLowerCase(),
    hero_subtitle: orNull(values.hero_subtitle),
    support_email: orNull(values.support_email),
    contact_phone: orNull(values.contact_phone),
    contact_address: orNull(values.contact_address),
    logo_url: values.logo_url,
    banner_url: values.banner_url,
    favicon_url: values.favicon_url,
    // Tematización: no exige el addon. El lockup de la suite sigue puesto.
    ui_radius: orNull(values.ui_radius),
    ui_density: orNull(values.ui_density),
    business_display_name: orNull(values.business_display_name),
    // P18 · Regla de negocio del comercio, no addon: se envía siempre.
    checkout_requires_account: values.checkout_requires_account,
    // P19 · Misma naturaleza: regla de negocio del comercio, se envía siempre.
    require_payment_before_dispatch: values.require_payment_before_dispatch,
    // Theme Engine · Tematización, NO addon. Va fuera del bloque premium a
    // propósito: elegir entre cuatro disposiciones de los mismos componentes no
    // quita el lockup de la suite, y cobrar por ello sería vender una casilla en
    // vez de una capacidad. La policy no lo gatea; esto no lo gatea tampoco.
    //
    // La condición NO es de permisos: es de esquema. Si la base todavía no
    // tiene las tres columnas, enviarlas devuelve 400 y se pierde también el
    // teléfono que la persona acababa de escribir. La pantalla de diseño está
    // apagada en ese caso, así que aquí no hay nada que guardar.
    ...(temaEnLaBase === false
      ? {}
      : {
          theme_preset: values.theme_preset,
          storefront_style: values.storefront_style,
          home_layout: values.home_layout,
        }),
    // PREMIUM. Igual que `white_label` desde P02: sin la capacidad el campo NO
    // se envía, en vez de enviarse vacío. Guardar el teléfono de contacto no
    // puede apagar de paso una tipografía que el tenant tenía. Si alguien lo
    // forzara igualmente, la policy `store_settings_update_admin` lo rechaza —
    // esto solo evita el 403.
    ...(input.canWhiteLabel
      ? {
          white_label: values.white_label,
          font_family: orNull(values.font_family),
          email_from_name: orNull(values.email_from_name),
          email_reply_to: orNull(values.email_reply_to),
        }
      : {}),
  }

  const { data, error } = await supabase
    .from(STORE_SETTINGS_TABLE)
    .update(patch)
    .eq('store_id', input.storeId)
    .select('store_id')
    .maybeSingle()

  if (error) throw settingsErrorFromDb(error)
  if (data) return

  const { error: insertError } = await supabase.from(STORE_SETTINGS_TABLE).insert({
    store_id: input.storeId,
    organization_id: input.organizationId,
    company_id: input.companyId,
    ...patch,
  })
  if (insertError) throw settingsErrorFromDb(insertError)
}

/**
 * Sube un asset de branding al bucket privado y devuelve su RUTA.
 *
 * La ruta es lo que se guarda en `logo_url`/`banner_url`: una URL firmada
 * caduca en una hora y dejaría la vitrina sin logo al día siguiente. Quien
 * firma para ver es cada lado —el backoffice con la sesión del usuario, la
 * vitrina con el cliente anónimo— y cada uno bajo su propia policy.
 */
export async function uploadStoreAsset(input: {
  organizationId: string
  storeId: string
  kind: AssetKind
  file: File
}): Promise<string> {
  const validation = validateAssetFile(input.file)
  if (!validation.ok) throw new SettingsError(validation.key, 'ARCHIVO_INVALIDO')

  const path = buildAssetPath({
    organizationId: input.organizationId,
    storeId: input.storeId,
    kind: input.kind,
    mimeType: input.file.type,
  })

  const { error } = await client()
    .storage.from(STORE_ASSETS_BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type,
      upsert: false,
      // Mismo criterio que las fotos de producto: ruta con uuid, contenido
      // inmutable, siete días de caché de navegador.
      cacheControl: '604800',
    })

  if (error) throw settingsErrorFromDb(error)
  return path
}

/**
 * URL pintable de un asset. Una `https://` externa (el logo-auto del contrato
 * §4.3) se devuelve tal cual; una ruta se firma contra el bucket privado.
 */
export async function resolveAssetUrls(
  supabase: SupabaseClient,
  values: Array<string | null>,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const paths: string[] = []

  for (const value of values) {
    if (!value) continue
    if (isExternalAsset(value)) map[value] = value
    else paths.push(value)
  }
  if (paths.length === 0) return map

  const { data, error } = await supabase.storage
    .from(STORE_ASSETS_BUCKET)
    .createSignedUrls([...new Set(paths)], 3600)

  // Una firma que falle no puede tumbar la pantalla: el asset cae al hueco
  // neutral y el resto de la configuración se sigue viendo y guardando.
  if (error) return map
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}

/** Vista de backoffice: firma con la sesión del usuario (policy de miembro). */
export async function signOwnAssets(values: Array<string | null>): Promise<Record<string, string>> {
  return resolveAssetUrls(client(), values)
}
