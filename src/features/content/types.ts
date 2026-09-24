import { z } from 'zod'
import {
  ALL_BLOCK_LAYOUTS,
  CONTENT_BLOCK_TYPES,
  CONTENT_PAGE_KINDS,
  CONTENT_STATUSES,
  blockFieldRules,
  blockLayoutDefault,
  blockLayoutIsValid,
  isSafeHref,
  looksLikeMarkup,
  richTextSchema,
  type BlockLayout,
  type ContentBlockType,
  type RichTextDocument,
} from '@/domain/content'

/**
 * Vocabulario del editor de contenido (P11-SaaS).
 *
 * Este archivo es la **mitad de cliente** de los CHECK de
 * `20260828140000_cms_core.sql`. Existe para que el editor diga «este enlace no
 * vale» con el foco en el campo, no para decidir: si la base y esto discrepan,
 * manda la base. Un test compara las dos mitades contra Postgres real.
 */

export {
  CONTENT_PAGES_TABLE,
  CONTENT_BLOCKS_TABLE,
  CONTENT_BLOCK_ITEMS_TABLE,
  CONTENT_PAGE_OVERVIEW_VIEW,
  SEARCH_SYNONYMS_TABLE,
  CONTENT_PREVIEW_RPC,
  CATALOG_SEARCH_RPC,
  PROMOTION_OVERVIEW_VIEW,
  STORE_ASSETS_BUCKET,
} from '@/shared/lib/db-schema'

/**
 * Lo mínimo de una campaña para poder elegirla en un bloque `campaign`: su
 * nombre y su estado EFECTIVO. El bloque apunta a la campaña; la campaña no
 * sabe que existe el bloque (FK en una sola dirección, `on delete set null`).
 */
export const linkablePromotionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  effective_status: z.string(),
})
export type LinkablePromotion = z.infer<typeof linkablePromotionSchema>

export type { ContentBlockType, RichTextDocument }

/** Fila de `content_page_overview`: la página con su estado EFECTIVO. */
export const contentPageSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  store_id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  kind: z.enum(CONTENT_PAGE_KINDS),
  status: z.enum(CONTENT_STATUSES),
  effective_status: z.string(),
  channel_id: z.string().uuid().nullable().default(null),
  channel_code: z.string().nullable().default(null),
  channel_name: z.string().nullable().default(null),
  priority: z.number().int(),
  publish_from: z.string(),
  publish_to: z.string().nullable().default(null),
  show_in_nav: z.boolean(),
  nav_position: z.number().int(),
  seo_title: z.string().nullable().default(null),
  seo_description: z.string().nullable().default(null),
  og_image_url: z.string().nullable().default(null),
  block_count: z.coerce.number().int().default(0),
  active_block_count: z.coerce.number().int().default(0),
  live_block_count: z.coerce.number().int().default(0),
  updated_at: z.string(),
})
export type ContentPageRow = z.infer<typeof contentPageSchema>

export const contentBlockSchema = z.object({
  id: z.string().uuid(),
  page_id: z.string().uuid(),
  store_id: z.string().uuid(),
  block_type: z.enum(CONTENT_BLOCK_TYPES),
  position: z.number().int(),
  title: z.string().nullable().default(null),
  subtitle: z.string().nullable().default(null),
  body: z.unknown().nullable().default(null),
  media_url: z.string().nullable().default(null),
  media_alt: z.string().nullable().default(null),
  cta_label: z.string().nullable().default(null),
  cta_href: z.string().nullable().default(null),
  promotion_id: z.string().uuid().nullable().default(null),
  category_id: z.string().uuid().nullable().default(null),
  item_limit: z.number().int(),
  is_active: z.boolean(),
  publish_from: z.string(),
  publish_to: z.string().nullable().default(null),
  channel_id: z.string().uuid().nullable().default(null),
  segment_id: z.string().uuid().nullable().default(null),
  settings: z.unknown().default({}),
})
export type ContentBlockRow = z.infer<typeof contentBlockSchema>

export const contentBlockItemSchema = z.object({
  id: z.string().uuid(),
  block_id: z.string().uuid(),
  item_kind: z.enum(['product', 'variant', 'category', 'media']),
  product_id: z.string().uuid().nullable().default(null),
  variant_id: z.string().uuid().nullable().default(null),
  category_id: z.string().uuid().nullable().default(null),
  /** P18 · La diapositiva: ruta en el bucket privado, su alt y su destino. */
  media_url: z.string().nullable().default(null),
  media_alt: z.string().nullable().default(null),
  href: z.string().nullable().default(null),
  position: z.number().int(),
})
export type ContentBlockItemRow = z.infer<typeof contentBlockItemSchema>

export const searchSynonymSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  term: z.string(),
  term_normalized: z.string(),
  expansions: z.array(z.string()),
  is_active: z.boolean(),
  updated_at: z.string(),
})
export type SearchSynonymRow = z.infer<typeof searchSynonymSchema>

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

const optionalText = (max: number, key: string) =>
  z
    .string()
    .trim()
    .max(max, key)
    .refine((value) => !looksLikeMarkup(value), key)

export const pageFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,60}$/, 'content.error.slug'),
  title: z.string().trim().min(1, 'content.error.title').max(160, 'content.error.title'),
  kind: z.enum(CONTENT_PAGE_KINDS),
  status: z.enum(CONTENT_STATUSES),
  channel_id: z.string().nullable(),
  priority: z.coerce.number().int().min(-100, 'content.error.priority').max(100, 'content.error.priority'),
  publish_from: z.string().trim().min(1, 'content.error.window'),
  publish_to: z.string().trim(),
  show_in_nav: z.boolean(),
  nav_position: z.coerce.number().int().min(0).max(999),
  seo_title: optionalText(160, 'content.error.seoTitle'),
  seo_description: optionalText(320, 'content.error.seoDescription'),
  og_image_url: z.string().nullable(),
})
export type PageFormValues = z.infer<typeof pageFormSchema>

export const blockFormSchema = z.object({
  block_type: z.enum(CONTENT_BLOCK_TYPES),
  position: z.coerce.number().int().min(0).max(999),
  title: optionalText(160, 'content.error.title'),
  subtitle: optionalText(320, 'content.error.subtitle'),
  /**
   * El cuerpo YA es el documento, no un texto que haya que interpretar.
   *
   * Se acepta cualquier array para que el formulario siga parseando aunque el
   * contenido todavia no valide —una etiqueta a medio escribir— y sea
   * `validateBlockForm` quien de el mensaje preciso junto al campo. Con
   * `richTextSchema` aqui, un `<b>` tumbaria el formulario entero y el error
   * saldria sin decir de que campo es.
   */
  body: z.custom<RichTextDocument | null>((value) => value === null || Array.isArray(value)),
  media_url: z.string().nullable(),
  media_alt: optionalText(200, 'content.error.mediaAlt'),
  cta_label: optionalText(60, 'content.error.ctaLabel'),
  cta_href: z.string().trim(),
  category_id: z.string().nullable(),
  promotion_id: z.string().nullable(),
  item_limit: z.coerce.number().int().min(1).max(48),
  is_active: z.boolean(),
  publish_from: z.string().trim().min(1, 'content.error.window'),
  publish_to: z.string().trim(),
  channel_id: z.string().nullable(),
  segment_id: z.string().nullable(),
  columns: z.coerce.number().int().min(2).max(6),
  /**
   * P18 · La colección incluye las subcategorías de la categoría elegida.
   *
   * Viaja en `settings`, que es vocabulario CERRADO (ver `content.ts` y el
   * CHECK `ebim.content_settings_are_safe`). Apagada por defecto: un bloque ya
   * publicado no cambia de contenido porque alguien cuelgue algo mañana.
   */
  descendants: z.boolean().default(false),
  /**
   * Cómo se enseña el bloque. Va en `settings` como `columns` y `descendants`:
   * es presentación, no contenido, y la lista de items es la misma en todas.
   *
   * ## Por qué el enum es la lista ENTERA y no la del tipo elegido
   *
   * Porque un esquema de Zod valida un campo mirando ese campo, y «vale para
   * este tipo de bloque» es una relación ENTRE dos campos: `spotlight` es
   * correcto en una colección de productos y absurdo en un banner. Aquí se
   * cierra el vocabulario —nada que no esté en la lista entra— y el encaje con
   * el tipo lo comprueba `validateBlockForm`, que es donde viven las demás
   * reglas entre campos.
   *
   * Storefront V3 · P08 amplía la lista; hasta entonces solo eran las dos de
   * los carruseles de imágenes.
   */
  layout: z.enum(ALL_BLOCK_LAYOUTS).default('carousel'),
})
export type BlockFormValues = z.infer<typeof blockFormSchema>

export type ValidationIssue = { field: keyof BlockFormValues; key: string }

/**
 * Reglas de FORMA del bloque, espejo del CHECK `content_blocks_shape` y de sus
 * tres hermanos.
 *
 * Se comprueban aquí y no solo con Zod porque son reglas ENTRE campos —«un hero
 * necesita título o imagen», «un botón sin destino no es un botón»— y un
 * `superRefine` por cada una acaba dando un mensaje pegado al formulario
 * entero en vez de al campo que hay que arreglar.
 */
export function validateBlockForm(values: BlockFormValues): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const rules = blockFieldRules(values.block_type)
  // El mismo juez que la base: si esto pasa y el CHECK no, es que las dos
  // mitades se han separado — y hay un test que lo comprueba contra Postgres.
  const parsedBody = values.body === null ? null : richTextSchema.safeParse(values.body)

  // --- Lo que FALTA -------------------------------------------------------
  if (rules.title === 'required' && !values.title.trim()) {
    issues.push({ field: 'title', key: 'content.error.titleRequired' })
  }
  if (rules.body === 'required' && !parsedBody?.success) {
    issues.push({ field: 'body', key: 'content.error.bodyRequired' })
  }
  // Hero y banner: uno de los dos basta, y por eso el aviso habla de los dos.
  if (rules.titleOrMedia && !values.title.trim() && !values.media_url) {
    issues.push({ field: 'title', key: 'content.error.titleOrMedia' })
  }

  // --- Lo que SOBRA -------------------------------------------------------
  // El fallo que lo destapó: un carrusel de imágenes con texto escrito en
  // «Contenido». La base lo rechazaba con `content_blocks_body_only_text` y el
  // aviso decía «faltan datos obligatorios», que es justo lo contrario.
  if (rules.body === 'unused' && values.body !== null) {
    issues.push({ field: 'body', key: 'content.error.notForThisType' })
  }
  if (rules.media === 'unused' && values.media_url) {
    issues.push({ field: 'media_url', key: 'content.error.notForThisType' })
  }
  if (rules.cta === 'unused' && (values.cta_label || values.cta_href)) {
    issues.push({ field: 'cta_label', key: 'content.error.notForThisType' })
  }
  if (rules.promotion === 'unused' && values.promotion_id) {
    issues.push({ field: 'promotion_id', key: 'content.error.promotionOnlyCampaign' })
  }
  if (rules.category === 'unused' && values.category_id) {
    issues.push({ field: 'category_id', key: 'content.error.categoryOnlyCollection' })
  }

  // --- Lo que está MAL ----------------------------------------------------
  if (parsedBody && !parsedBody.success && rules.body !== 'unused') {
    const message = parsedBody.error.issues[0]?.message ?? ''
    issues.push({
      field: 'body',
      key: message.startsWith('content.') ? message : 'content.error.body',
    })
  }

  // Un botón sin destino es un botón roto; un destino sin botón no se pulsa.
  if (Boolean(values.cta_label) !== Boolean(values.cta_href)) {
    issues.push({ field: 'cta_href', key: 'content.error.ctaPair' })
  }
  if (values.cta_href && !isSafeHref(values.cta_href)) {
    issues.push({ field: 'cta_href', key: 'content.error.href' })
  }
  if (values.publish_to && values.publish_to <= values.publish_from) {
    issues.push({ field: 'publish_to', key: 'content.error.window' })
  }
  // Una composición que no es de este tipo de bloque (V3 · P08). El desplegable
  // sale de la misma tabla que esta comprobación, así que esto solo salta si la
  // llamada no viene del formulario.
  if (!blockLayoutIsValid(values.block_type, values.layout)) {
    issues.push({ field: 'layout', key: 'content.error.notForThisType' })
  }

  return issues
}

/**
 * Vacía los campos que el tipo elegido no admite.
 *
 * Se llama al cambiar el desplegable de tipo. Sin esto, escribir el contenido de
 * un hero y pasarlo después a carrusel dejaría un cuerpo escondido —el campo ya
 * no se pinta— que el CHECK de la base rechaza al guardar, con el formulario sin
 * nada que señalar.
 */
export function clearUnusedBlockFields(values: BlockFormValues): BlockFormValues {
  const rules = blockFieldRules(values.block_type)
  return {
    ...values,
    subtitle: rules.subtitle === 'unused' ? '' : values.subtitle,
    body: rules.body === 'unused' ? null : values.body,
    media_url: rules.media === 'unused' ? null : values.media_url,
    media_alt: rules.media === 'unused' ? '' : values.media_alt,
    cta_label: rules.cta === 'unused' ? '' : values.cta_label,
    cta_href: rules.cta === 'unused' ? '' : values.cta_href,
    promotion_id: rules.promotion === 'unused' ? null : values.promotion_id,
    category_id: rules.category === 'unused' ? null : values.category_id,
    /**
     * Y la composición vuelve a la del tipo nuevo (V3 · P08).
     *
     * Sin esto, pasar un banner a sangre a colección de productos dejaría
     * `bleed` guardado en un bloque que no sabe qué es eso: el desplegable no lo
     * ofrecería, el formulario no lo enseñaría y la validación lo rechazaría al
     * guardar sin nada que señalar. Es el mismo problema que el cuerpo escondido
     * de un hero que pasa a carrusel, resuelto en el mismo sitio.
     */
    layout: composicionDelTipo(values.block_type, values.layout),
  }
}

/** La composición si vale para el tipo; si no, la que ese tipo trae de serie. */
function composicionDelTipo(type: ContentBlockType, layout: BlockLayout): BlockLayout {
  if (blockLayoutIsValid(type, layout)) return layout
  // Un tipo que no elige composición se queda con lo que traía: nadie lo lee.
  return blockLayoutDefault(type) ?? layout
}

/** Un texto vacío se guarda como NULL: los CHECK de longitud no admiten `''`. */
export function orNull(value: string | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Sinónimo: el término y sus expansiones, separadas por comas. */
export const synonymFormSchema = z.object({
  term: z.string().trim().min(2, 'content.error.term').max(60, 'content.error.term'),
  expansions: z.string().trim().min(2, 'content.error.expansions'),
  is_active: z.boolean(),
})
export type SynonymFormValues = z.infer<typeof synonymFormSchema>

export function parseExpansions(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 60),
    ),
  ].slice(0, 12)
}
