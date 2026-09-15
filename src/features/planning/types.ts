import { z } from 'zod'

export {
  ORDER_SUGGESTIONS_TABLE,
  ORDER_SUGGESTION_ITEMS_TABLE,
  DEMAND_FORECASTS_TABLE,
  SUGGEST_ORDER_RPC,
  SUGGEST_ORDER_V2_RPC,
  PRODUCTS_TABLE,
} from '@/shared/lib/db-schema'

/**
 * Sugerido de pedido y previsión de demanda, en el CLIENTE.
 *
 * Mitad de pantalla de `20260902180000_planning_demand.sql`.
 *
 * **La sugerencia no crea pedidos.** Produce una lista que una persona
 * confirma, y de ahí sale un carrito que entra por el pipeline de checkout de
 * siempre. Un sistema que pide por ti es un sistema que se equivoca por ti, y
 * en distribución eso se paga en devoluciones y mercadería vencida.
 */

export const SUGGESTION_STATUSES = ['draft', 'sent', 'accepted', 'discarded'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

/**
 * A dónde puede ir una sugerencia.
 *
 * La base **no** tiene trigger de estado aquí: es criterio de pantalla, y se
 * dice para que nadie lo confunda con una barrera. `accepted` y `discarded`
 * cierran: una sugerencia aceptada ya tiene un pedido detrás, y una descartada
 * es información sobre el modelo que no conviene reescribir.
 */
export function nextSuggestionStatuses(status: SuggestionStatus): SuggestionStatus[] {
  if (status === 'draft') return ['sent', 'discarded']
  if (status === 'sent') return ['accepted', 'discarded']
  return []
}

export const suggestionSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  sales_rep_id: z.string().uuid().nullable().default(null),
  status: z.enum(SUGGESTION_STATUSES).catch('draft'),
  model_code: z.string(),
  generated_at: z.string(),
  order_id: z.string().uuid().nullable().default(null),
  customer_code: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
})
export type Suggestion = z.infer<typeof suggestionSchema>

export const suggestionItemSchema = z.object({
  id: z.string().uuid(),
  suggestion_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  uom_code: z.string().nullable().default(null),
  suggested_quantity: z.string(),
  /** Por qué se sugiere. La base lo exige: `order_suggestion_items_reason_len`. */
  reason: z.string(),
  last_period_quantity: z.string().nullable().default(null),
  on_hand_quantity: z.string().nullable().default(null),
  position: z.number().default(0),
  product_name: z.string().nullable().default(null),
  product_sku: z.string().nullable().default(null),
})
export type SuggestionItem = z.infer<typeof suggestionItemSchema>

// --- Cierre · item 11 · Sugerido v2 -----------------------------------------

/** Los dos modelos que puede devolver `suggest_order_v2`. */
export const SUGGEST_MODEL_V2 = 'history_seasonal_v2'
export const SUGGEST_MODEL_V1 = 'historic_v1'

/**
 * Los números con los que se calculó una línea (`inputs` de v2).
 *
 * Todo opcional y con `catch`: es la explicación, no la cifra. Si el servidor
 * añade un dato nuevo o el fallback trae menos, la línea se sigue pintando con
 * su motivo en vez de romper la previsualización entera por un campo de más.
 */
export const suggestionInputsSchema = z
  .object({
    model: z.string().optional(),
    fallback: z.boolean().optional(),
    windows: z
      .object({ recent_days: z.number().optional(), long_days: z.number().optional() })
      .partial()
      .optional(),
    rates: z
      .object({ recent: z.coerce.number(), long: z.coerce.number(), base: z.coerce.number() })
      .partial()
      .optional(),
    blend: z.object({ recent: z.coerce.number(), long: z.coerce.number() }).partial().optional(),
    seasonal: z
      .object({ applied: z.boolean(), factor: z.coerce.number(), reason: z.string() })
      .partial()
      .optional(),
    demand: z.coerce.number().optional(),
    atp: z
      .object({
        state: z.string(),
        available: z.coerce.number().nullable(),
        source: z.string().nullable(),
      })
      .partial()
      .optional(),
    capped: z.boolean().optional(),
    shortage: z.boolean().optional(),
  })
  .passthrough()
export type SuggestionInputs = z.infer<typeof suggestionInputsSchema>

/**
 * Una fila tal y como la devuelve `suggest_order_v2` (o su fallback v1).
 * Todavía no es nada: existe cuando una persona la guarda.
 *
 * `model_code` e `inputs` tienen valor por defecto para seguir leyendo una
 * respuesta de v1 pelada, que no los trae.
 */
export const suggestedLineSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  suggested_quantity: z.coerce.string(),
  last_period_quantity: z.coerce.string().nullable().default(null),
  on_hand_quantity: z.coerce.string().nullable().default(null),
  reason: z.string(),
  inputs: suggestionInputsSchema.catch({}).default({}),
  model_code: z.string().default(SUGGEST_MODEL_V1),
})
export type SuggestedLine = z.infer<typeof suggestedLineSchema>

/**
 * ¿Se puede guardar esta línea? La base exige `suggested_quantity > 0`, y una
 * línea sin disponibilidad sale con cero a propósito: se ENSEÑA para saber qué
 * falta, pero no se guarda como algo que pedir.
 */
export function isSaveableLine(line: SuggestedLine): boolean {
  const qty = Number(line.suggested_quantity)
  return Number.isFinite(qty) && qty >= 1
}

/**
 * El modelo de la sugerencia entera. Todas las líneas de una respuesta traen el
 * mismo; si no hay ninguna, se guarda v2, que es lo que se pidió.
 */
export function modelOf(lines: readonly SuggestedLine[]): string {
  return lines[0]?.model_code ?? SUGGEST_MODEL_V2
}

export const forecastSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  territory_id: z.string().uuid().nullable().default(null),
  period_start: z.string(),
  period_end: z.string(),
  forecast_quantity: z.string(),
  confidence: z.string().nullable().default(null),
  model_code: z.string(),
  product_name: z.string().nullable().default(null),
})
export type Forecast = z.infer<typeof forecastSchema>

/** Ventanas de historial que la pantalla ofrece, en días. */
export const SUGGEST_WINDOWS = [15, 30, 60, 90] as const
export type SuggestWindow = (typeof SUGGEST_WINDOWS)[number]

export const generateFormSchema = z.object({
  customer_id: z.string().uuid('planning.error.customer'),
  days: z.string(),
})
export type GenerateFormValues = z.infer<typeof generateFormSchema>

export function emptyGenerateForm(): GenerateFormValues {
  // Treinta días es el mes comercial: ni tan corto que una semana rara lo
  // desvíe, ni tan largo que arrastre un surtido que ya no se vende.
  return { customer_id: '', days: '30' }
}
