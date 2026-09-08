import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient, tryGetStorefrontRpcClient } from '@/shared/lib/supabase'
import { PricingError, pricingErrorFromDb } from './errors'
import type { ResolvedPriceRow } from './importCsv'
import {
  CHANNELS_TABLE,
  CUSTOMER_SEGMENTS_TABLE,
  PRICE_CHANGE_EVENTS_TABLE,
  PRICE_LISTS_TABLE,
  PRICE_LIST_ASSIGNMENTS_TABLE,
  PRICE_LIST_ITEMS_TABLE,
  PRICE_LIST_CONFLICTS_RPC,
  PRICE_QUOTE_PUBLIC_RPC,
  PRICE_QUOTE_RPC,
  PRODUCTS_TABLE,
  PRODUCT_UOMS_TABLE,
  PRODUCT_VARIANTS_TABLE,
  UNITS_OF_MEASURE_TABLE,
  channelOptionSchema,
  customerSegmentSchema,
  priceChangeEventSchema,
  priceConflictSchema,
  priceListAssignmentSchema,
  priceListItemSchema,
  priceListSchema,
  priceQuoteSchema,
  pricedProductSchema,
  pricedUomSchema,
  pricedVariantSchema,
  type AssignmentFormValues,
  type ChannelOption,
  type CustomerSegment,
  type PriceChangeEvent,
  type PriceConflict,
  type PriceList,
  type PriceListAssignment,
  type PriceListFormValues,
  type PriceListItem,
  type PriceQuoteResult,
  type PricedProduct,
  type PricedUom,
  type PricedVariant,
  type SegmentFormValues,
} from './types'

/**
 * Acceso a datos del motor de precios.
 *
 * Dos reglas, las mismas del resto del backoffice:
 *
 *  1. **Ninguna consulta declara el tenant.** `organization_id` y `company_id`
 *     se escriben en los `insert` porque las columnas son NOT NULL, pero salen
 *     del contexto derivado del JWT; quien decide si esa escritura vale es la
 *     RLS. Ningún `select` filtra por tenant: un filtro olvidado parecería
 *     seguridad y no lo sería.
 *  2. **Ningún precio se calcula aquí.** Este módulo lee y escribe listas; a la
 *     pregunta «cuánto cuesta» responde el servidor (`price_quote`). Un
 *     cálculo de precio en el navegador es un precio que el navegador puede
 *     cambiar.
 */

export interface TenantScope {
  organizationId: string
  companyId: string
}

export interface StoreScope extends TenantScope {
  storeId: string
}

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new PricingError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

// ---------------------------------------------------------------------------
// Segmentos comerciales
// ---------------------------------------------------------------------------

const SEGMENT_SELECT = 'id, code, name, description, is_active'

export async function fetchSegments(): Promise<CustomerSegment[]> {
  const { data, error } = await client().from(CUSTOMER_SEGMENTS_TABLE).select(SEGMENT_SELECT).order('name')
  if (error) throw pricingErrorFromDb(error)
  return customerSegmentSchema.array().parse(data ?? [])
}

export async function saveSegment(input: {
  id?: string | null
  scope: TenantScope
  values: SegmentFormValues
}): Promise<void> {
  const supabase = client()
  const fields = { code: input.values.code, name: input.values.name, is_active: input.values.is_active }

  const { error } = input.id
    ? await supabase.from(CUSTOMER_SEGMENTS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(CUSTOMER_SEGMENTS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        ...fields,
      })

  if (error) throw pricingErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

const LIST_SELECT =
  'id, store_id, code, name, currency, priority, valid_from, valid_to, is_active, notes'

export async function fetchPriceLists(storeId: string | null): Promise<PriceList[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(PRICE_LISTS_TABLE)
    .select(LIST_SELECT)
    .eq('store_id', storeId)
    .order('priority', { ascending: false })
    .order('code')
  if (error) throw pricingErrorFromDb(error)
  return priceListSchema.array().parse(data ?? [])
}

/**
 * `datetime-local` no lleva zona. Se manda tal cual y Postgres lo interpreta en
 * la del servidor; convertirlo a UTC en el navegador movería la vigencia según
 * dónde esté sentado quien la escribe, que es exactamente el error que hace que
 * una campaña arranque a las 19:00 del día anterior.
 */
function localToTimestamp(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed.replace('T', ' ') : null
}

export async function savePriceList(input: {
  id?: string | null
  scope: StoreScope
  values: PriceListFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    currency: input.values.currency.toUpperCase(),
    priority: input.values.priority,
    valid_from: localToTimestamp(input.values.valid_from),
    valid_to: localToTimestamp(input.values.valid_to),
    is_active: input.values.is_active,
    notes: input.values.notes.trim() || null,
  }

  const { error } = input.id
    ? await supabase.from(PRICE_LISTS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(PRICE_LISTS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        ...fields,
      })

  if (error) throw pricingErrorFromDb(error)
}

export async function deletePriceList(id: string): Promise<void> {
  const { error } = await client().from(PRICE_LISTS_TABLE).delete().eq('id', id)
  if (error) throw pricingErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Renglones
// ---------------------------------------------------------------------------

const ITEM_SELECT =
  'id, price_list_id, product_id, variant_id, uom_id, min_quantity::text, unit_price::text, compare_at_price::text'

export async function fetchPriceItems(listId: string | null): Promise<PriceListItem[]> {
  if (!listId) return []
  const { data, error } = await client()
    .from(PRICE_LIST_ITEMS_TABLE)
    .select(ITEM_SELECT)
    .eq('price_list_id', listId)
    .order('min_quantity')
  if (error) throw pricingErrorFromDb(error)
  return priceListItemSchema.array().parse(data ?? [])
}

export interface PriceItemInput {
  productId: string
  variantId: string | null
  uomId: string | null
  minQuantity: string
  unitPrice: string
  compareAtPrice: string | null
}

export async function savePriceItem(input: {
  id?: string | null
  scope: StoreScope
  listId: string
  values: PriceItemInput
}): Promise<void> {
  const supabase = client()
  const fields = {
    product_id: input.values.productId,
    variant_id: input.values.variantId,
    uom_id: input.values.uomId,
    min_quantity: input.values.minQuantity,
    unit_price: input.values.unitPrice,
    compare_at_price: input.values.compareAtPrice,
  }

  const { error } = input.id
    ? await supabase.from(PRICE_LIST_ITEMS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(PRICE_LIST_ITEMS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        price_list_id: input.listId,
        ...fields,
      })

  if (error) throw pricingErrorFromDb(error)
}

export async function deletePriceItem(id: string): Promise<void> {
  const { error } = await client().from(PRICE_LIST_ITEMS_TABLE).delete().eq('id', id)
  if (error) throw pricingErrorFromDb(error)
}

/**
 * La CLAVE NATURAL de un renglón dentro de su lista.
 *
 * Es la misma que vigilan los dos índices únicos de `price_list_items`: lista,
 * producto (o variante), presentación y cantidad mínima. `min_quantity` pasa
 * por `Number` porque la base lo devuelve como `1.000000` y el CSV lo trae
 * como `1`: comparadas como texto, esas dos son claves distintas y el renglón
 * se duplicaría contra un índice que dice que no puede.
 */
function claveDeRenglon(row: {
  product_id: string
  variant_id: string | null
  uom_id: string | null
  min_quantity: string
}): string {
  return [row.product_id, row.variant_id ?? '', row.uom_id ?? '', Number(row.min_quantity)].join('|')
}

/**
 * Carga masiva: da de alta lo que no está y ACTUALIZA lo que ya está.
 *
 * Antes era un `insert` a secas —el comentario decía `upsert`, el código no lo
 * hacía— y por eso reimportar la misma hoja con tres precios corregidos moría
 * con un error de duplicado contra el índice único. Corregir una lista en bloque
 * es justo lo que se hace con un CSV, así que fallar ahí es fallar en el caso
 * principal.
 *
 * No se usa `upsert` de PostgREST porque su `on_conflict` infiere el índice por
 * una LISTA DE COLUMNAS, y los de esta tabla son parciales y con expresión
 * (`coalesce(uom_id, product_id)`, `where variant_id is null`): no hay lista de
 * columnas que los nombre. Así que la partida se hace aquí: una consulta para
 * saber qué existe ya, un `insert` con todas las altas y un `update` por cada
 * renglón que cambia.
 *
 * Los `update` van de uno en uno porque cada renglón lleva valores distintos y
 * no hay forma de expresar eso en una sola escritura de PostgREST. Es la parte
 * cara —una hoja que corrige 300 precios hace 300 llamadas— y se acepta a
 * sabiendas: la alternativa era borrar y volver a insertar, que deja la lista
 * de precios vacía si la segunda mitad falla.
 */
export async function importPriceItems(input: {
  scope: StoreScope
  listId: string
  rows: readonly ResolvedPriceRow[]
}): Promise<{ inserted: number; updated: number }> {
  if (input.rows.length === 0) return { inserted: 0, updated: 0 }

  const supabase = client()
  const existentes = new Map(
    (await fetchPriceItems(input.listId)).map((item) => [claveDeRenglon(item), item.id]),
  )

  const altas: Record<string, unknown>[] = []
  const cambios: { id: string; fields: Record<string, unknown> }[] = []

  for (const row of input.rows) {
    const fields = {
      product_id: row.productId,
      variant_id: row.variantId,
      uom_id: row.uomId,
      min_quantity: row.minQuantity,
      unit_price: row.unitPrice,
      compare_at_price: row.compareAtPrice,
    }
    const id = existentes.get(
      claveDeRenglon({
        product_id: row.productId,
        variant_id: row.variantId,
        uom_id: row.uomId,
        min_quantity: row.minQuantity,
      }),
    )
    if (id) cambios.push({ id, fields })
    else {
      altas.push({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        price_list_id: input.listId,
        ...fields,
      })
    }
  }

  if (altas.length > 0) {
    const { error } = await supabase.from(PRICE_LIST_ITEMS_TABLE).insert(altas)
    if (error) throw pricingErrorFromDb(error)
  }

  for (const cambio of cambios) {
    const { error } = await supabase
      .from(PRICE_LIST_ITEMS_TABLE)
      .update(cambio.fields)
      .eq('id', cambio.id)
    if (error) throw pricingErrorFromDb(error)
  }

  return { inserted: altas.length, updated: cambios.length }
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

const ASSIGNMENT_SELECT = 'id, price_list_id, scope, channel_id, segment_id, customer_id, is_active'

export async function fetchAssignments(listId: string | null): Promise<PriceListAssignment[]> {
  if (!listId) return []
  const { data, error } = await client()
    .from(PRICE_LIST_ASSIGNMENTS_TABLE)
    .select(ASSIGNMENT_SELECT)
    .eq('price_list_id', listId)
    .order('scope')
  if (error) throw pricingErrorFromDb(error)
  return priceListAssignmentSchema.array().parse(data ?? [])
}

export async function addAssignment(input: {
  scope: StoreScope
  listId: string
  values: AssignmentFormValues
}): Promise<void> {
  const { error } = await client()
    .from(PRICE_LIST_ASSIGNMENTS_TABLE)
    .insert({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      store_id: input.scope.storeId,
      price_list_id: input.listId,
      scope: input.values.scope,
      channel_id: input.values.scope === 'channel' ? input.values.channel_id : null,
      segment_id: input.values.scope === 'segment' ? input.values.segment_id : null,
      customer_id: input.values.scope === 'customer' ? input.values.customer_id : null,
    })
  if (error) throw pricingErrorFromDb(error)
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await client().from(PRICE_LIST_ASSIGNMENTS_TABLE).delete().eq('id', id)
  if (error) throw pricingErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Canales y catálogo tarifable
// ---------------------------------------------------------------------------

export async function fetchChannels(storeId: string | null): Promise<ChannelOption[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(CHANNELS_TABLE)
    .select('id, code, name, kind, is_default, is_active')
    .eq('store_id', storeId)
    .order('code')
  if (error) throw pricingErrorFromDb(error)
  return channelOptionSchema.array().parse(data ?? [])
}

/**
 * Búsqueda de producto para tarifar. Con LÍMITE y en el servidor: un selector
 * que se trae los 3.000 SKU de la tienda para filtrarlos en memoria es la forma
 * habitual de que el backoffice deje de abrir en el cliente que más productos
 * tiene, que es justo el que más lo necesita.
 */
export async function searchPricedProducts(input: {
  storeId: string | null
  term: string
}): Promise<PricedProduct[]> {
  if (!input.storeId) return []
  let query = client()
    .from(PRODUCTS_TABLE)
    .select('id, sku, name, kind')
    .eq('store_id', input.storeId)
    .order('name')
    .limit(20)

  const filter = buildTextSearchFilter(input.term, ['name', 'sku'])
  if (filter) query = query.or(filter)

  const { data, error } = await query
  if (error) throw pricingErrorFromDb(error)
  return pricedProductSchema.array().parse(data ?? [])
}

export async function fetchProductVariants(productId: string | null): Promise<PricedVariant[]> {
  if (!productId) return []
  const { data, error } = await client()
    .from(PRODUCT_VARIANTS_TABLE)
    .select('id, product_id, sku, name')
    .eq('product_id', productId)
    .order('position')
  if (error) throw pricingErrorFromDb(error)
  return pricedVariantSchema.array().parse(data ?? [])
}

/**
 * Presentaciones de un producto. Se leen `product_uoms` y `units_of_measure`
 * por separado y se cruzan aquí: la FK entre ambas es compuesta con el tenant,
 * y pedirle a PostgREST que deduzca ese embebido es depender de una inferencia
 * que cambia con la versión.
 */
export async function fetchProductUoms(productId: string | null): Promise<PricedUom[]> {
  if (!productId) return []
  const supabase = client()

  const [uomsRes, unitsRes] = await Promise.all([
    supabase
      .from(PRODUCT_UOMS_TABLE)
      .select('uom_id, product_id, factor::text')
      .eq('product_id', productId)
      .order('position'),
    supabase.from(UNITS_OF_MEASURE_TABLE).select('id, code'),
  ])

  const failure = uomsRes.error ?? unitsRes.error
  if (failure) throw pricingErrorFromDb(failure)

  const codes = new Map(
    (unitsRes.data ?? []).map((unit) => [String((unit as { id: string }).id), String((unit as { code: string }).code)]),
  )

  const rows = (uomsRes.data ?? [])
    .map((row) => {
      const uomId = String((row as { uom_id: string }).uom_id)
      const code = codes.get(uomId)
      return code
        ? { uom_id: uomId, product_id: String((row as { product_id: string }).product_id), code, factor: (row as { factor: string }).factor }
        : null
    })
    .filter((row): row is { uom_id: string; product_id: string; code: string; factor: string } => row !== null)

  return pricedUomSchema.array().parse(rows)
}

/**
 * Catálogo completo para resolver una importación por SKU. Se pide entero a
 * propósito —es el único caso que lo justifica— y solo cuando alguien suelta un
 * archivo, no al abrir la pantalla.
 */
export async function fetchPricingCatalog(storeId: string | null): Promise<{
  products: PricedProduct[]
  variants: PricedVariant[]
  uoms: PricedUom[]
}> {
  if (!storeId) return { products: [], variants: [], uoms: [] }
  const supabase = client()

  const [productsRes, variantsRes, uomsRes, unitsRes] = await Promise.all([
    supabase.from(PRODUCTS_TABLE).select('id, sku, name, kind').eq('store_id', storeId),
    supabase.from(PRODUCT_VARIANTS_TABLE).select('id, product_id, sku, name').eq('store_id', storeId),
    supabase.from(PRODUCT_UOMS_TABLE).select('uom_id, product_id, factor::text').eq('store_id', storeId),
    supabase.from(UNITS_OF_MEASURE_TABLE).select('id, code'),
  ])

  const failure = productsRes.error ?? variantsRes.error ?? uomsRes.error ?? unitsRes.error
  if (failure) throw pricingErrorFromDb(failure)

  const codes = new Map(
    (unitsRes.data ?? []).map((unit) => [String((unit as { id: string }).id), String((unit as { code: string }).code)]),
  )

  const uoms = (uomsRes.data ?? [])
    .map((row) => {
      const uomId = String((row as { uom_id: string }).uom_id)
      const code = codes.get(uomId)
      return code
        ? { uom_id: uomId, product_id: String((row as { product_id: string }).product_id), code, factor: (row as { factor: string }).factor }
        : null
    })
    .filter((row): row is { uom_id: string; product_id: string; code: string; factor: string } => row !== null)

  return {
    products: pricedProductSchema.array().parse(productsRes.data ?? []),
    variants: pricedVariantSchema.array().parse(variantsRes.data ?? []),
    uoms: pricedUomSchema.array().parse(uoms),
  }
}

// ---------------------------------------------------------------------------
// Diagnóstico, bitácora y simulador
// ---------------------------------------------------------------------------

export async function fetchConflicts(storeId: string | null): Promise<PriceConflict[]> {
  if (!storeId) return []
  const { data, error } = await client().rpc(PRICE_LIST_CONFLICTS_RPC, { p_store_id: storeId })
  if (error) throw pricingErrorFromDb(error)
  return priceConflictSchema.array().parse(data ?? [])
}

export async function fetchPriceChanges(storeId: string | null): Promise<PriceChangeEvent[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(PRICE_CHANGE_EVENTS_TABLE)
    .select(
      'id, price_list_id, product_id, action, old_unit_price::text, new_unit_price::text, actor_email, occurred_at',
    )
    .eq('store_id', storeId)
    .order('occurred_at', { ascending: false })
    .limit(50)
  if (error) throw pricingErrorFromDb(error)
  return priceChangeEventSchema.array().parse(data ?? [])
}

export interface SimulationInput {
  storeId: string
  productId: string
  variantId: string | null
  quantity: number
  channelId: string | null
  segmentId: string | null
  /**
   * Cliente concreto (P05-SaaS). Si va sin segmento, el SERVIDOR toma el de su
   * ficha: derivarlo aquí sería una segunda copia de la regla, y la respuesta
   * que importa es la del motor.
   */
  customerId?: string | null
}

/**
 * El simulador. Llama a la MISMA función que la vitrina y que el pedido, así
 * que lo que enseña no es una estimación: es el precio.
 */
export async function simulatePrice(input: SimulationInput): Promise<PriceQuoteResult> {
  const { data, error } = await client().rpc(PRICE_QUOTE_RPC, {
    p_store_id: input.storeId,
    p_items: [
      input.variantId
        ? { product_id: input.productId, variant_id: input.variantId, quantity: input.quantity }
        : { product_id: input.productId, quantity: input.quantity },
    ],
    p_channel_id: input.channelId,
    p_segment_id: input.segmentId,
    p_customer_id: input.customerId ?? null,
  })
  if (error) throw pricingErrorFromDb(error)
  return priceQuoteSchema.parse(data)
}

// ---------------------------------------------------------------------------
// Cotización de la vitrina pública
// ---------------------------------------------------------------------------

export interface PublicQuoteItem {
  product_id: string
  quantity: number
  variant_id?: string
  uom_code?: string
}

/**
 * Lo que pide el carrito de la vitrina.
 *
 * Viaja el slug de la URL y QUÉ se quiere comprar. Nada más: ni precio, ni
 * canal, ni cliente — el cliente NO se declara, se deduce de quien firma.
 *
 * Por eso va con el cliente que lleva la sesión si la hay (P19) y no con el
 * anónimo de la vitrina: la función es `security definer` y saca el acuerdo de
 * `ebim.user_id()`. Pedirla sin token es pedir el precio de catálogo, que es lo
 * que hacía —el motor resolvía bien y aquí no se le decía a quién—.
 */
export async function quotePublicCart(input: {
  storeSlug: string
  items: readonly PublicQuoteItem[]
}): Promise<PriceQuoteResult> {
  const supabase = tryGetStorefrontRpcClient()
  if (!supabase) throw new PricingError('auth.notConfigured', 'CONFIG_INCOMPLETA')

  const { data, error } = await supabase.rpc(PRICE_QUOTE_PUBLIC_RPC, {
    p_store_slug: input.storeSlug,
    p_items: input.items,
  })
  if (error) throw pricingErrorFromDb(error)
  return priceQuoteSchema.parse(data)
}
