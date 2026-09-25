import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { blockChoosesLayout } from '@/domain/content'
import { ContentError, contentErrorFromDb } from './errors'
import {
  CONTENT_BLOCKS_TABLE,
  CONTENT_BLOCK_ITEMS_TABLE,
  CONTENT_PAGES_TABLE,
  CONTENT_PAGE_OVERVIEW_VIEW,
  CONTENT_PREVIEW_RPC,
  PROMOTION_OVERVIEW_VIEW,
  SEARCH_SYNONYMS_TABLE,
  linkablePromotionSchema,
  contentBlockItemSchema,
  contentBlockSchema,
  contentPageSchema,
  orNull,
  parseExpansions,
  searchSynonymSchema,
  type BlockFormValues,
  type ContentBlockItemRow,
  type ContentBlockRow,
  type ContentPageRow,
  type PageFormValues,
  type SearchSynonymRow,
  type SynonymFormValues,
} from './types'

/**
 * Contenido del backoffice: lectura y escritura bajo RLS.
 *
 * Aquí no hay Edge Function y no hace falta: las tres tablas del CMS tienen
 * policies de escritura para `owner`/`admin` **con la capacidad `content.cms`**
 * (migración `20260828140000`), así que la autorización ya la decide la base
 * con el JWT. Un borde intermedio solo movería la misma comprobación de sitio.
 *
 * **Ninguna consulta lleva filtro de tenant.** `store_id` es alcance de
 * pantalla; el aislamiento lo pone la RLS. Es la misma regla que rige el resto
 * del backoffice desde P02, y la razón por la que en este archivo no aparece ni
 * un `organization_id`.
 */

export interface ContentScope {
  organizationId: string
  companyId: string
  storeId: string
}

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new ContentError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

const PAGE_SELECT = [
  'id',
  'organization_id',
  'company_id',
  'store_id',
  'slug',
  'title',
  'kind',
  'status',
  'effective_status',
  'channel_id',
  'channel_code',
  'channel_name',
  'priority',
  'publish_from',
  'publish_to',
  'show_in_nav',
  'nav_position',
  'seo_title',
  'seo_description',
  'og_image_url',
  'block_count',
  'active_block_count',
  'live_block_count',
  'updated_at',
].join(', ')

const BLOCK_SELECT = [
  'id',
  'page_id',
  'store_id',
  'block_type',
  'position',
  'title',
  'subtitle',
  'body',
  'media_url',
  'media_alt',
  'cta_label',
  'cta_href',
  'promotion_id',
  'category_id',
  'item_limit',
  'is_active',
  'publish_from',
  'publish_to',
  'channel_id',
  'segment_id',
  'settings',
].join(', ')

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

export interface PageFilter {
  storeId: string | null
  /** `all` o uno de los estados EFECTIVOS de la vista. */
  status: string
  term: string
}

export async function fetchPages(filter: PageFilter): Promise<ContentPageRow[]> {
  if (!filter.storeId) return []

  let request = client()
    .from(CONTENT_PAGE_OVERVIEW_VIEW)
    .select(PAGE_SELECT)
    .eq('store_id', filter.storeId)

  if (filter.status !== 'all') request = request.eq('effective_status', filter.status)

  const search = buildTextSearchFilter(filter.term, ['title', 'slug'])
  if (search) request = request.or(search)

  const { data, error } = await request.order('kind').order('priority', { ascending: false }).order('title')
  if (error) throw contentErrorFromDb(error)
  return contentPageSchema.array().parse(data ?? [])
}

function pagePatch(values: PageFormValues) {
  return {
    slug: values.slug.trim().toLowerCase(),
    title: values.title.trim(),
    kind: values.kind,
    status: values.status,
    channel_id: values.channel_id,
    priority: values.priority,
    publish_from: values.publish_from,
    publish_to: orNull(values.publish_to),
    show_in_nav: values.show_in_nav,
    nav_position: values.nav_position,
    seo_title: orNull(values.seo_title),
    seo_description: orNull(values.seo_description),
    og_image_url: values.og_image_url,
  }
}

export async function createPage(scope: ContentScope, values: PageFormValues): Promise<string> {
  const { data, error } = await client()
    .from(CONTENT_PAGES_TABLE)
    .insert({
      organization_id: scope.organizationId,
      company_id: scope.companyId,
      store_id: scope.storeId,
      ...pagePatch(values),
    })
    .select('id')
    .single()

  if (error) throw contentErrorFromDb(error)
  return (data as { id: string }).id
}

export async function updatePage(id: string, values: PageFormValues): Promise<void> {
  const { error } = await client().from(CONTENT_PAGES_TABLE).update(pagePatch(values)).eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

export async function deletePage(id: string): Promise<void> {
  const { error } = await client().from(CONTENT_PAGES_TABLE).delete().eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

export async function fetchBlocks(pageId: string | null): Promise<ContentBlockRow[]> {
  if (!pageId) return []
  const { data, error } = await client()
    .from(CONTENT_BLOCKS_TABLE)
    .select(BLOCK_SELECT)
    .eq('page_id', pageId)
    .order('position')

  if (error) throw contentErrorFromDb(error)
  return contentBlockSchema.array().parse(data ?? [])
}

function blockPatch(values: BlockFormValues) {
  return {
    block_type: values.block_type,
    position: values.position,
    title: orNull(values.title),
    subtitle: orNull(values.subtitle),
    body: values.body,
    media_url: values.media_url,
    media_alt: orNull(values.media_alt),
    cta_label: orNull(values.cta_label),
    cta_href: orNull(values.cta_href),
    promotion_id: values.block_type === 'campaign' ? values.promotion_id : null,
    category_id: values.category_id,
    item_limit: values.item_limit,
    is_active: values.is_active,
    publish_from: values.publish_from,
    publish_to: orNull(values.publish_to),
    channel_id: values.channel_id,
    segment_id: values.segment_id,
    // `settings` es un vocabulario CERRADO (ver `ebim.content_settings_are_safe`).
    // Se construye aquí, clave a clave: pasar un objeto que venga del formulario
    // entero sería la vía por la que entra una clave que nadie revisó.
    settings: {
      columns: values.columns,
      descendants: values.descendants,
      // Solo donde significa algo: un `layout` en un hero seria una clave que
      // nadie lee ocupando sitio en un vocabulario de doce. Desde V3 · P08 son
      // cinco tipos los que eligen composicion, no solo el carrusel de imagenes.
      ...(blockChoosesLayout(values.block_type) ? { layout: values.layout } : {}),
    },
  }
}

export async function createBlock(
  scope: ContentScope,
  pageId: string,
  values: BlockFormValues,
): Promise<string> {
  const { data, error } = await client()
    .from(CONTENT_BLOCKS_TABLE)
    .insert({
      organization_id: scope.organizationId,
      company_id: scope.companyId,
      store_id: scope.storeId,
      page_id: pageId,
      ...blockPatch(values),
    })
    .select('id')
    .single()

  if (error) throw contentErrorFromDb(error)
  return (data as { id: string }).id
}

export async function updateBlock(id: string, values: BlockFormValues): Promise<void> {
  const { error } = await client().from(CONTENT_BLOCKS_TABLE).update(blockPatch(values)).eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

export async function deleteBlock(id: string): Promise<void> {
  const { error } = await client().from(CONTENT_BLOCKS_TABLE).delete().eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

/** Mover un bloque es cambiar su posición: el orden es DATO, no el de inserción. */
export async function moveBlock(id: string, position: number): Promise<void> {
  const { error } = await client()
    .from(CONTENT_BLOCKS_TABLE)
    .update({ position })
    .eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Items de una colección
// ---------------------------------------------------------------------------

export async function fetchBlockItems(blockId: string | null): Promise<ContentBlockItemRow[]> {
  if (!blockId) return []
  const { data, error } = await client()
    .from(CONTENT_BLOCK_ITEMS_TABLE)
    .select(
      'id, block_id, item_kind, product_id, variant_id, category_id, media_url, media_alt, href, position',
    )
    .eq('block_id', blockId)
    .order('position')

  if (error) throw contentErrorFromDb(error)
  return contentBlockItemSchema.array().parse(data ?? [])
}

export interface BlockItemInput {
  blockId: string
  blockType: string
  itemKind: 'product' | 'variant' | 'category' | 'media'
  productId?: string | null
  variantId?: string | null
  categoryId?: string | null
  /** Solo para `media`: la ruta subida, su texto alternativo y su destino. */
  mediaUrl?: string | null
  mediaAlt?: string | null
  href?: string | null
  position: number
}

export async function addBlockItem(scope: ContentScope, input: BlockItemInput): Promise<void> {
  const { error } = await client().from(CONTENT_BLOCK_ITEMS_TABLE).insert({
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    block_id: input.blockId,
    // `block_type` va denormalizado con FK contra `content_blocks (id,
    // block_type)`: es lo que permite que el CHECK mire el tipo del padre. Si
    // el que se manda no coincide con el del bloque, la FK lo rechaza — no hace
    // falta que esta pantalla lo compruebe.
    block_type: input.blockType,
    item_kind: input.itemKind,
    product_id: input.productId ?? null,
    variant_id: input.variantId ?? null,
    category_id: input.categoryId ?? null,
    media_url: input.mediaUrl ?? null,
    media_alt: input.mediaAlt ?? null,
    href: input.href ?? null,
    position: input.position,
  })
  if (error) throw contentErrorFromDb(error)
}

/**
 * Cambia el sitio de un item dentro de su bloque.
 *
 * `position` no es única en la tabla, así que intercambiar dos items son dos
 * updates y no hace falta un hueco intermedio. En un carrusel el orden ES el
 * contenido —la primera imagen es la que casi todo el mundo ve—, de modo que
 * sin esto la única forma de recolocar sería borrar y volver a subir.
 */
export async function setBlockItemPosition(input: {
  id: string
  position: number
}): Promise<void> {
  const { error } = await client()
    .from(CONTENT_BLOCK_ITEMS_TABLE)
    .update({ position: input.position })
    .eq('id', input.id)
  if (error) throw contentErrorFromDb(error)
}

export async function removeBlockItem(id: string): Promise<void> {
  const { error } = await client().from(CONTENT_BLOCK_ITEMS_TABLE).delete().eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

export interface PreviewInput {
  pageId: string
  /** Instante que se quiere simular. Nulo = ahora. */
  at?: string | null
  channelId?: string | null
  segmentId?: string | null
  /** `true` = tal y como lo estoy editando; `false` = tal y como se verá. */
  includeDrafts: boolean
}

/**
 * Vista previa: la MISMA resolución que usa la vitrina, con el reloj y el canal
 * en la mano.
 *
 * Que sea la misma función de la base es la propiedad: una vista previa
 * calculada aparte es una vista previa que miente el día que las dos se
 * separan, y ese día no avisa.
 */
export async function fetchPreview(input: PreviewInput): Promise<unknown> {
  const { data, error } = await client().rpc(CONTENT_PREVIEW_RPC, {
    p_page_id: input.pageId,
    p_at: input.at ?? null,
    p_channel_id: input.channelId ?? null,
    p_segment_id: input.segmentId ?? null,
    p_include_drafts: input.includeDrafts,
  })

  if (error) throw contentErrorFromDb(error)
  return data
}

// ---------------------------------------------------------------------------
// Sinónimos de búsqueda
// ---------------------------------------------------------------------------

export async function fetchSynonyms(
  storeId: string | null,
  term: string,
): Promise<SearchSynonymRow[]> {
  if (!storeId) return []

  let request = client()
    .from(SEARCH_SYNONYMS_TABLE)
    .select('id, store_id, term, term_normalized, expansions, is_active, updated_at')
    .eq('store_id', storeId)

  const search = buildTextSearchFilter(term, ['term'])
  if (search) request = request.or(search)

  const { data, error } = await request.order('term')
  if (error) throw contentErrorFromDb(error)
  return searchSynonymSchema.array().parse(data ?? [])
}

export async function createSynonym(
  scope: ContentScope,
  values: SynonymFormValues,
): Promise<void> {
  const { error } = await client().from(SEARCH_SYNONYMS_TABLE).insert({
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    term: values.term.trim(),
    expansions: parseExpansions(values.expansions),
    is_active: values.is_active,
  })
  if (error) throw contentErrorFromDb(error)
}

export async function updateSynonym(id: string, values: SynonymFormValues): Promise<void> {
  const { error } = await client()
    .from(SEARCH_SYNONYMS_TABLE)
    .update({
      term: values.term.trim(),
      expansions: parseExpansions(values.expansions),
      is_active: values.is_active,
    })
    .eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

export async function deleteSynonym(id: string): Promise<void> {
  const { error } = await client().from(SEARCH_SYNONYMS_TABLE).delete().eq('id', id)
  if (error) throw contentErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Campañas que un bloque puede anunciar
// ---------------------------------------------------------------------------

/**
 * Las campañas de la tienda, para el selector del bloque `campaign`.
 *
 * Lee `promotion_overview`, cuya policy solo exige MEMBRESÍA —no la capacidad
 * `promotions`—, que es lo mismo que decidió P10: si un tenant deja de pagar el
 * módulo, sus campañas dejan de aplicarse pero se siguen viendo. Aquí eso
 * importa: un bloque que anuncia una campaña caducada tiene que poder señalarse
 * y corregirse, no desaparecer del desplegable.
 *
 * Devuelve el estado EFECTIVO junto al nombre: elegir una campaña que ya no
 * descuenta es un error caro y silencioso, y el desplegable es donde se ve.
 */
export async function fetchLinkablePromotions(
  storeId: string | null,
): Promise<Array<{ id: string; name: string; code: string; effective_status: string }>> {
  if (!storeId) return []

  const { data, error } = await client()
    .from(PROMOTION_OVERVIEW_VIEW)
    .select('id, name, code, effective_status')
    .eq('store_id', storeId)
    .order('name')

  // El selector es una ayuda: si la lectura falla —por ejemplo, porque el
  // proyecto todavía no tiene el dominio de promociones desplegado— el bloque
  // se sigue pudiendo crear sin campaña asociada.
  if (error) return []
  return linkablePromotionSchema.array().parse(data ?? [])
}
