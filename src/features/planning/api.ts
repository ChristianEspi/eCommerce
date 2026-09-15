import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { PlanningError, planningErrorFromDb } from './errors'
import {
  DEMAND_FORECASTS_TABLE,
  ORDER_SUGGESTIONS_TABLE,
  ORDER_SUGGESTION_ITEMS_TABLE,
  PRODUCTS_TABLE,
  SUGGEST_ORDER_V2_RPC,
  forecastSchema,
  isSaveableLine,
  modelOf,
  suggestedLineSchema,
  suggestionItemSchema,
  suggestionSchema,
  type Forecast,
  type SuggestedLine,
  type Suggestion,
  type SuggestionItem,
  type SuggestionStatus,
} from './types'

/**
 * Acceso a planificación: sugerido y previsión.
 *
 * Ninguna consulta filtra por tenant: lo hace la RLS desde el JWT.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new PlanningError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

export interface PlanningScope {
  organizationId: string
  companyId: string
  storeId: string
}

function primero<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// ---------------------------------------------------------------------------
// Sugerencias
// ---------------------------------------------------------------------------

const SUGGESTION_SELECT =
  'id, store_id, customer_id, sales_rep_id, status, model_code, generated_at, order_id, ' +
  'customers(code, name)'

export async function fetchSuggestions(): Promise<Suggestion[]> {
  const { data, error } = await client()
    .from(ORDER_SUGGESTIONS_TABLE)
    .select(SUGGESTION_SELECT)
    .order('generated_at', { ascending: false })

  if (error) throw planningErrorFromDb(error)

  const filas = (data ?? []).map((row) => {
    const { customers, ...resto } = row as unknown as Record<string, unknown> & {
      customers?: { code?: string; name?: string }[] | { code?: string; name?: string } | null
    }
    const cliente = primero(customers)
    return { ...resto, customer_code: cliente?.code ?? null, customer_name: cliente?.name ?? null }
  })

  return suggestionSchema.array().parse(filas)
}

const ITEM_SELECT =
  'id, suggestion_id, product_id, variant_id, uom_code, suggested_quantity::text, reason, ' +
  'last_period_quantity::text, on_hand_quantity::text, position, products(name, sku)'

export async function fetchSuggestionItems(
  suggestionId: string | null,
): Promise<SuggestionItem[]> {
  if (!suggestionId) return []

  const { data, error } = await client()
    .from(ORDER_SUGGESTION_ITEMS_TABLE)
    .select(ITEM_SELECT)
    .eq('suggestion_id', suggestionId)
    .order('position')

  if (error) throw planningErrorFromDb(error)

  const filas = (data ?? []).map((row) => {
    const { products, ...resto } = row as unknown as Record<string, unknown> & {
      products?: { name?: string; sku?: string }[] | { name?: string; sku?: string } | null
    }
    const producto = primero(products)
    return { ...resto, product_name: producto?.name ?? null, product_sku: producto?.sku ?? null }
  })

  return suggestionItemSchema.array().parse(filas)
}

/**
 * Pide el sugerido al servidor. **No escribe nada**: `suggest_order_v2`
 * devuelve filas y ya. Quien decide guardarlas es la persona que las mira.
 *
 * Cierre · item 11: se llama a v2, que explica cada línea (`inputs`) y cae
 * él solo a `historic_v1` cuando no tiene datos. La pantalla no decide el
 * modelo: lo lee de `model_code`, que es lo que se guarda.
 */
export async function previewSuggestion(input: {
  storeId: string
  customerId: string
  days: number
}): Promise<SuggestedLine[]> {
  const { data, error } = await client().rpc(SUGGEST_ORDER_V2_RPC, {
    p_store: input.storeId,
    p_customer: input.customerId,
    p_days: input.days,
  })

  if (error) throw planningErrorFromDb(error)
  return suggestedLineSchema.array().parse(data ?? [])
}

/**
 * Guarda la sugerencia y sus líneas.
 *
 * Dos escrituras, y el orden importa: la cabecera primero. Si fallan las
 * líneas queda una sugerencia VACÍA —visible, descartable, y que no propone
 * nada— en vez de líneas huérfanas que ningún listado enseñaría.
 *
 * Cada línea guarda **su motivo**, que la base exige. Una cifra que nadie
 * discute es una cifra que nadie corrige: sin el «compró 12 en los últimos 30
 * días» detrás, el preventista no puede defenderla delante del cliente y
 * entonces no la usa.
 */
export async function saveSuggestion(input: {
  scope: PlanningScope
  customerId: string
  lines: SuggestedLine[]
}): Promise<void> {
  const supabase = client()
  // Las líneas sin disponibilidad (cantidad 0) se enseñan pero no se guardan:
  // la base exige cantidad positiva y un sugerido de «0 unidades» no se pide.
  const guardables = input.lines.filter(isSaveableLine)

  const { data, error } = await supabase
    .from(ORDER_SUGGESTIONS_TABLE)
    .insert({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      store_id: input.scope.storeId,
      customer_id: input.customerId,
      // Con qué se calculó. Sin esto toda sugerencia nacía `historic_v1` por el
      // default de la columna, aunque la hubiera calculado otro modelo.
      model_code: modelOf(input.lines),
    })
    .select('id')
    .single()

  if (error) throw planningErrorFromDb(error)
  if (guardables.length === 0) return

  const { error: itemsError } = await supabase.from(ORDER_SUGGESTION_ITEMS_TABLE).insert(
    guardables.map((line, index) => ({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      suggestion_id: (data as { id: string }).id,
      product_id: line.product_id,
      variant_id: line.variant_id,
      suggested_quantity: line.suggested_quantity,
      last_period_quantity: line.last_period_quantity,
      // Lo disponible cuando se calculó: es lo que hace comprobable un
      // «limitado a 3 disponibles» semanas después.
      on_hand_quantity: line.on_hand_quantity,
      reason: line.reason,
      position: index,
    })),
  )

  if (itemsError) throw planningErrorFromDb(itemsError)
}

export async function setSuggestionStatus(input: {
  id: string
  status: SuggestionStatus
}): Promise<void> {
  const { error } = await client()
    .from(ORDER_SUGGESTIONS_TABLE)
    .update({ status: input.status })
    .eq('id', input.id)
  if (error) throw planningErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Previsión de demanda
// ---------------------------------------------------------------------------

const FORECAST_SELECT =
  'id, product_id, variant_id, territory_id, period_start, period_end, ' +
  'forecast_quantity::text, confidence::text, model_code, products(name)'

export async function fetchForecasts(): Promise<Forecast[]> {
  const { data, error } = await client()
    .from(DEMAND_FORECASTS_TABLE)
    .select(FORECAST_SELECT)
    .order('period_start', { ascending: false })

  if (error) throw planningErrorFromDb(error)

  const filas = (data ?? []).map((row) => {
    const { products, ...resto } = row as unknown as Record<string, unknown> & {
      products?: { name?: string }[] | { name?: string } | null
    }
    return { ...resto, product_name: primero(products)?.name ?? null }
  })

  return forecastSchema.array().parse(filas)
}

// ---------------------------------------------------------------------------
// Nombres de producto para la previsualización (cierre · item 11)
// ---------------------------------------------------------------------------

export interface ProductLabel {
  id: string
  name: string
  sku: string
}

/**
 * Nombre y SKU de las líneas propuestas. El sugerido devuelve ids; una cifra
 * junto a un uuid no se puede discutir con nadie. Lectura acotada a los ids de
 * la propuesta, bajo la RLS de `products`.
 */
export async function fetchProductLabels(ids: readonly string[]): Promise<ProductLabel[]> {
  if (ids.length === 0) return []
  const { data, error } = await client()
    .from(PRODUCTS_TABLE)
    .select('id, name, sku')
    .in('id', [...ids])
  if (error) throw planningErrorFromDb(error)
  return (data ?? []).map((row) => {
    const fila = row as { id: string; name?: string | null; sku?: string | null }
    return { id: fila.id, name: fila.name ?? '', sku: fila.sku ?? '' }
  })
}