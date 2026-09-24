import { z } from 'zod'
import { BRAND_FONTS, BRAND_RADII, DENSITIES } from '@/theme/tokens'
import {
  homeLayoutField,
  storefrontStyleField,
  themePresetSchema,
} from '@/features/storefront/theme/schema'
import {
  DEFAULT_THEME_PRESET,
  normalizeThemePreset,
  sanitizeHomeLayout,
  sanitizeStorefrontStyle,
} from '@/features/storefront/theme/presets'
import {
  VALUE_PROPS_LIMITS,
  VALUE_PROP_ICON_KEYS,
  sanitizeValueProps,
  type StoreValueProp,
} from '@/features/storefront/valueProps'

/**
 * Personalización de la tienda (`/app/settings`).
 *
 * Los nombres de campo son los del contrato §4.3 (`accent_color`, `logo_url`,
 * `white_label`) y los que P02/P05 dejaron en `store_settings`. No se inventa
 * un `description` nuevo: **`hero_subtitle` ES la descripción publicable de la
 * tienda** —es el texto que la vitrina pinta bajo el nombre— y un segundo campo
 * de descripción sería una segunda fuente de verdad que se desincroniza
 * (precedente P05 #44).
 */

/**
 * Nombres reales de tabla y del bucket PRIVADO de branding
 * (`20260827090600_storage_buckets.sql`). Fuente unica:
 * `shared/lib/db-schema.ts` — `STORES_TABLE` y `STORE_ASSETS_BUCKET` estaban
 * escritas tambien en tenant y en storefront.
 */
export {
  STORE_SETTINGS_TABLE,
  STORES_TABLE,
  STORE_ASSETS_BUCKET,
} from '@/shared/lib/db-schema'

/** 2 MB. Un logo o un banner por encima de esto es una imagen sin optimizar. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024

/**
 * Tipos aceptados y su extensión canónica.
 *
 * **Sin SVG a propósito**: un SVG es un documento que puede llevar `<script>`,
 * y aquí lo sube el tenant y lo sirve el dominio de la vitrina. La extensión
 * sale del MIME, no del nombre del archivo (mismo criterio que P04 #33).
 */
export const ALLOWED_ASSET_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/**
 * Qué es el objeto que se sube.
 *
 * `content` (P18) es la imagen de un BLOQUE del CMS: misma validación, mismo
 * bucket y misma frontera de tenant que el branding, pero en su propia carpeta
 * —`content/` en vez de `branding/`— porque su ciclo de vida es otro: el logo
 * de una tienda es uno y dura; las imágenes de campaña se suben, se cambian y
 * se quedan atrás cada temporada.
 */
export type AssetKind = 'logo' | 'banner' | 'favicon' | 'content'

export const storeSettingsSchema = z.object({
  store_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  accent_color: z.string(),
  logo_url: z.string().nullable().default(null),
  banner_url: z.string().nullable().default(null),
  white_label: z.boolean().nullable().default(false),
  default_locale: z.string().nullable().default(null),
  support_email: z.string().nullable().default(null),
  hero_title: z.string().nullable().default(null),
  hero_subtitle: z.string().nullable().default(null),
  contact_phone: z.string().nullable().default(null),
  contact_address: z.string().nullable().default(null),
  /** P18 · La tienda solo vende a quien ha iniciado sesión. */
  checkout_requires_account: z.boolean().nullable().default(false),
  /** P19 · La tienda no entrega mercancía sin haber cobrado. */
  require_payment_before_dispatch: z.boolean().nullable().default(false),
  /**
   * White-label por tokens (P11-SaaS). `catch(null)` en los tres de lista
   * cerrada: un valor que la app no conoce cae al de suite en vez de dejar la
   * pantalla sin cargar.
   */
  favicon_url: z.string().nullable().default(null),
  font_family: z.enum(BRAND_FONTS).nullable().catch(null).default(null),
  ui_radius: z.enum(BRAND_RADII).nullable().catch(null).default(null),
  ui_density: z.enum(DENSITIES).nullable().catch(null).default(null),
  business_display_name: z.string().nullable().default(null),
  email_from_name: z.string().nullable().default(null),
  email_reply_to: z.string().nullable().default(null),
  /**
   * Estado del dominio propio. Se LEE aquí y no se escribe: `store_settings`
   * dejó de tener GRANT de UPDATE sobre estas columnas en la migración
   * `20260828140200`. Marcarse a uno mismo el dominio como verificado sería
   * saltarse la única prueba de que ese dominio es suyo.
   */
  custom_domain_status: z.string().nullable().default('none'),
  custom_domain_verified_at: z.string().nullable().default(null),
  /**
   * Theme Engine (P02). Crudos, como en la vitrina y por el mismo motivo: un
   * `enum` aquí haría fallar el `parse` de toda la pantalla de Configuración
   * por un campo de presentación. `toForm` los resuelve contra el contrato.
   */
  theme_preset: z.unknown(),
  storefront_style: z.unknown(),
  home_layout: z.unknown(),
  /**
   * Propuestas de valor (Storefront V2 · P01). Crudas, por el mismo motivo que
   * las tres de arriba: una fila anterior al despliegue de la migración no
   * puede dejar la pantalla de Configuración sin cargar. `sanitizeValueProps`
   * las resuelve en `toForm`.
   */
  value_props: z.unknown(),
})
export type StoreSettings = z.infer<typeof storeSettingsSchema>

/**
 * Las propuestas de valor tal y como las declara el FORMULARIO.
 *
 * Replica el CHECK de la migración `20260923100000` clave por clave —incluido
 * el `strict`, que es la mitad del contrato: una clave que no está en la lista
 * pasaría la validación del formulario y moriría en la base con un error
 * genérico—. Y el título es obligatorio aquí aunque el saneador lo tolere
 * vacío: el saneador sirve a una fila que se está EDITANDO, esto decide si lo
 * escrito puede escribirse.
 *
 * `z.custom` por la misma razón de tipos que los campos del tema: el contrato
 * es de solo lectura (`readonly`) y lo que infiere Zod no lo es, así que el
 * formulario habla el mismo tipo que la vitrina y la comprobación sigue siendo
 * la de este esquema.
 */
const valuePropEntrySchema = z
  .object({
    iconKey: z.enum(VALUE_PROP_ICON_KEYS),
    title: z.string().trim().min(1).max(VALUE_PROPS_LIMITS.titleMax),
    body: z.string().trim().max(VALUE_PROPS_LIMITS.bodyMax).optional(),
    enabled: z.boolean(),
  })
  .strict()

const valuePropsListSchema = z
  .array(valuePropEntrySchema)
  .max(VALUE_PROPS_LIMITS.max)
  // Sin icono repetido, igual que el CHECK: dos entradas con el mismo glifo no
  // son una preferencia, son un guardado accidentado.
  .refine(
    (lista) => new Set(lista.map((prop) => prop.iconKey)).size === lista.length,
    { message: 'settings.error.invalid' },
  )

export const valuePropsField = z.custom<readonly StoreValueProp[]>(
  (valor) => valuePropsListSchema.safeParse(valor).success,
  { message: 'settings.error.invalid' },
)

const optionalText = (max: number, error: string) =>
  z
    .string()
    .trim()
    .max(max, error)
    .transform((value) => value || '')

/**
 * Formulario. Los límites replican los CHECK de la base uno a uno: un mensaje
 * en el campo es mejor que un 400 genérico después de pulsar Guardar, pero la
 * validación que manda sigue siendo la de Postgres.
 */
export const storeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'settings.error.name')
    .max(200, 'settings.error.name'),
  hero_subtitle: optionalText(240, 'settings.error.description'),
  accent_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'settings.error.color'),
  support_email: z
    .string()
    .trim()
    .max(320, 'settings.error.email')
    .refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'settings.error.email'),
  contact_phone: z
    .string()
    .trim()
    .refine((value) => value === '' || (value.length >= 4 && value.length <= 40), 'settings.error.phone'),
  contact_address: z
    .string()
    .trim()
    .refine((value) => value === '' || (value.length >= 3 && value.length <= 240), 'settings.error.address'),
  logo_url: z.string().nullable(),
  banner_url: z.string().nullable(),
  /**
   * Marca blanca. Addon premium de suite (contrato §4.3), así que el campo
   * existe siempre en el formulario pero solo se ENVÍA si la sociedad tiene la
   * capacidad `content.white_label` — ver `saveStoreSettings`.
   */
  white_label: z.boolean(),
  /**
   * Tokens de white-label. `font_family` es PREMIUM (exige
   * `content.white_label`) y `ui_radius`/`ui_density`/`business_display_name`
   * no: el acento, el logo, el favicon, el radio y la densidad son
   * tematización —el lockup de la suite sigue puesto— mientras que la
   * tipografía, la identidad de correo y el dominio propio son lo que hace que
   * la tienda deje de parecer de la suite. La raya está explicada en la
   * migración `20260828140200` y la impone la policy, no esta pantalla.
   */
  font_family: z.string(),
  ui_radius: z.string(),
  ui_density: z.string(),
  business_display_name: optionalText(200, 'settings.error.name'),
  email_from_name: optionalText(120, 'settings.error.name'),
  email_reply_to: z
    .string()
    .trim()
    .max(320, 'settings.error.email')
    .refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'settings.error.email'),
  favicon_url: z.string().nullable(),
  /**
   * P18 · Exigir cuenta para comprar.
   *
   * No es premium ni depende de ningún addon: es una regla de negocio del
   * comercio, como el impuesto. Quien la IMPONE es el pipeline del checkout con
   * la sesión verificada; esto solo la declara.
   */
  checkout_requires_account: z.boolean(),
  /**
   * Frena la ENTREGA, no la preparación: preparar mientras llega la
   * transferencia es trabajo útil, y lo que no se recupera es la mercancía que
   * ya salió. Las cuentas con línea de crédito quedan exentas — sin esa
   * excepción la regla estorbaría justo donde el crédito existe.
   */
  require_payment_before_dispatch: z.boolean(),
  /**
   * Theme Engine. Los tres se guardan SIEMPRE para owner/admin: elegir entre
   * cuatro disposiciones de los mismos componentes es tematización, igual que
   * el acento o la densidad, y no depende de `content.white_label`. La raya
   * está en la migración `20260910220000` y la impone la policy, no esta
   * pantalla.
   *
   * `storefront_style` y `home_layout` guardan lo que la tienda DIJO, no la
   * versión completa: lo que no dicen lo hereda del tema. Ver `sanitize*` en
   * `storefront/theme/normalize.ts`.
   */
  theme_preset: themePresetSchema,
  storefront_style: storefrontStyleField,
  home_layout: homeLayoutField,
  /**
   * Propuestas de valor. CONTENIDO del comercio, no tematización y no marca
   * blanca: se guardan siempre para owner/admin, igual que el teléfono de
   * contacto. La raya la pone la migración `20260923100000` y la impone la
   * policy, no esta pantalla.
   */
  value_props: valuePropsField,
})
export type StoreFormValues = z.infer<typeof storeFormSchema>

/** Fila + nombre de la tienda → valores del formulario. */
export function toForm(name: string, settings: StoreSettings | null): StoreFormValues {
  return {
    name,
    hero_subtitle: settings?.hero_subtitle ?? '',
    accent_color: settings?.accent_color ?? '#5AA97F',
    support_email: settings?.support_email ?? '',
    contact_phone: settings?.contact_phone ?? '',
    contact_address: settings?.contact_address ?? '',
    logo_url: settings?.logo_url ?? null,
    banner_url: settings?.banner_url ?? null,
    white_label: settings?.white_label ?? false,
    font_family: settings?.font_family ?? '',
    ui_radius: settings?.ui_radius ?? '',
    ui_density: settings?.ui_density ?? '',
    business_display_name: settings?.business_display_name ?? '',
    email_from_name: settings?.email_from_name ?? '',
    email_reply_to: settings?.email_reply_to ?? '',
    favicon_url: settings?.favicon_url ?? null,
    checkout_requires_account: settings?.checkout_requires_account ?? false,
    require_payment_before_dispatch: settings?.require_payment_before_dispatch ?? false,
    /**
     * Theme Engine. Los tres pasan por el contrato antes de llegar al
     * formulario, así que una fila anterior al despliegue de la migración —o
     * una escrita a mano— no deja la pantalla de Configuración sin cargar: se
     * lee como la tienda `universal` sin nada pisado que era.
     *
     * `sanitize` y no `normalize`: aquí se está preparando lo que se va a
     * GUARDAR. Completar el estilo con los siete valores del preset convertiría
     * «heredo de mi tema» en siete valores fijos, y cambiar de tema después no
     * cambiaría nada.
     */
    theme_preset: normalizeThemePreset(settings?.theme_preset ?? DEFAULT_THEME_PRESET),
    storefront_style: sanitizeStorefrontStyle(settings?.storefront_style),
    home_layout: sanitizeHomeLayout(settings?.home_layout),
    /**
     * `sanitize` y no `resolve`: aquí se prepara lo que se va a GUARDAR. Las
     * propuestas de la plataforma no se copian a la fila —si se copiaran, el
     * día que la suite mejorara ese texto esta tienda se quedaría con el viejo
     * escrito a su nombre—. La lista vacía significa «usa las de plataforma».
     */
    value_props: sanitizeValueProps(settings?.value_props),
  }
}

/** Un texto vacío se guarda como NULL: los CHECK de longitud no admiten `''`. */
export function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * ¿La referencia de un asset es una URL externa o una ruta del bucket privado?
 *
 * Es la mitad de cliente de `ebim.is_store_asset_ref` (migración 15): la base
 * la vuelve a comprobar con un CHECK contra las columnas de tenant de la propia
 * fila, así que esto solo decide si hay que firmar la ruta para verla.
 */
export function isExternalAsset(value: string): boolean {
  return /^https:\/\//i.test(value)
}

export type AssetValidation = { ok: true } | { ok: false; key: 'settings.error.assetType' | 'settings.error.assetSize' }

export function validateAssetFile(file: { type: string; size: number }): AssetValidation {
  if (!ALLOWED_ASSET_TYPES[file.type]) return { ok: false, key: 'settings.error.assetType' }
  if (file.size <= 0 || file.size > MAX_ASSET_BYTES) return { ok: false, key: 'settings.error.assetSize' }
  return { ok: true }
}

/**
 * Ruta del objeto: `{organization_id}/{store_id}/branding/{kind}-{uuid}.{ext}`.
 *
 * Los dos primeros segmentos son los que lee `ebim.can_write_store_object` para
 * autorizar la subida y los que exige el CHECK `store_settings_logo_ref`: una
 * ruta del tenant de al lado no llega ni a subirse ni a guardarse.
 */
export function buildAssetPath(input: {
  organizationId: string
  storeId: string
  kind: AssetKind
  mimeType: string
}): string {
  const extension = ALLOWED_ASSET_TYPES[input.mimeType]
  if (!extension) throw new Error('MIME_NO_ADMITIDO')
  // `branding/` para lo que define la tienda; `content/` para lo que ilustra
  // una campaña. Los dos primeros segmentos —los que autorizan— no cambian.
  const carpeta = input.kind === 'content' ? 'content' : 'branding'
  return `${input.organizationId}/${input.storeId}/${carpeta}/${input.kind}-${crypto.randomUUID()}.${extension}`
}
