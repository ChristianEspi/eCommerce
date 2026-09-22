import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { metricSchema } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { PLANNING_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

export { PLANNING_ASSISTANT_FUNCTION }

/**
 * IA de planificación en el CLIENTE (fase 05).
 *
 * `planning-assistant` explica dos cosas que ya calculó el sistema:
 *  - la previsión EXISTENTE (`demand_forecasts`) frente a la venta real, y
 *  - el sugerido de `suggest_order_v2` (`history_seasonal_v2`).
 *
 * `system` = CÁLCULO DEL SISTEMA (señales, cantidades del motor); `data` =
 * INTERPRETACIÓN IA (texto con marcadores). La cantidad sugerida se pinta
 * SIEMPRE desde `system.lines[].suggested_quantity`, nunca desde el texto.
 */

// Espejo de `supabase/functions/_shared/aiPlanning.ts` (test de paridad).
export const PLANNING_AI_SIGNALS = [
  'forecast_over',
  'forecast_under',
  'no_recent_sales',
  'trend_up',
  'trend_down',
  'no_forecast',
  'seasonal_peak',
  'seasonal_low',
  'low_confidence',
] as const
export type PlanningAiSignal = (typeof PLANNING_AI_SIGNALS)[number]

export const PLANNING_AI_SEVERITIES = ['high', 'medium', 'low'] as const
export const PLANNING_PERIOD_PHASES = ['closed', 'current', 'future', 'territory'] as const
export const PLANNING_SEASONAL_REASONS = ['historial_anual', 'menos_de_un_anio', 'pocos_pedidos', 'sin_ventas_en_el_anio'] as const

export const MAX_PLANNING_QUESTION = 300

const entitySchema = z.object({
  kind: z.enum(['product', 'period']),
  label: z.string().min(1).max(160),
})

const contextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(12), entitySchema),
})
export type PlanningAiContext = z.infer<typeof contextSchema>

const modelCode = z.string().regex(/^[a-z][a-z0-9_.-]{0,59}$/i)

export const forecastSystemSchema = contextSchema.extend({
  models: z.array(modelCode).max(5),
  items: z
    .array(
      z.object({
        ref: z.string().max(8),
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        name: z.string().min(1).max(80),
        sku: z.string().max(60).nullable(),
        has_forecast: z.boolean(),
        severity: z.enum(PLANNING_AI_SEVERITIES),
        signals: z.array(z.enum(PLANNING_AI_SIGNALS)).max(PLANNING_AI_SIGNALS.length),
        seasonal: z.object({ applied: z.boolean(), reason: z.enum(PLANNING_SEASONAL_REASONS).nullable() }),
        forecasts: z
          .array(
            z.object({
              ref: z.string().max(12),
              model_code: modelCode,
              phase: z.enum(PLANNING_PERIOD_PHASES),
              anomaly: z.enum(['forecast_over', 'forecast_under']).nullable(),
            }),
          )
          .max(6),
      }),
    )
    .max(15),
})
export type ForecastSystem = z.infer<typeof forecastSystemSchema>

export const forecastInsightSchema = contextSchema.extend({
  overview: z.string().max(600),
  trend: z.string().max(600),
  seasonality: z.string().max(600),
  forecast_vs_sales: z.string().max(700),
  anomalies: z
    .array(
      z.object({
        ref: z.string().max(8),
        product_id: z.string().uuid(),
        name: z.string().min(1).max(80),
        signal: z.enum(PLANNING_AI_SIGNALS),
        severity: z.enum(PLANNING_AI_SEVERITIES),
        explanation: z.string().min(1).max(400),
      }),
    )
    .max(10),
  factors: z.array(z.string().min(1).max(300)).max(5),
  limitations: z.string().max(450),
  answer: z.string().max(1000),
  discarded: z.number().int().min(0).max(100),
})
export type ForecastInsight = z.infer<typeof forecastInsightSchema>

const decimal = z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/)

export const suggestionSystemSchema = contextSchema.extend({
  model_code: modelCode.nullable(),
  total: z.number().int().min(0),
  lines: z
    .array(
      z.object({
        ref: z.string().max(8),
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        name: z.string().min(1).max(80),
        sku: z.string().max(60).nullable(),
        suggested_quantity: decimal,
        on_hand_quantity: decimal.nullable(),
        model_code: modelCode,
        flags: z.object({
          fallback: z.boolean(),
          blended: z.boolean(),
          seasonal_applied: z.boolean(),
          seasonal_reason: z.enum(PLANNING_SEASONAL_REASONS).nullable(),
          capped: z.boolean(),
          shortage: z.boolean(),
          atp_state: z.enum(['known', 'unknown', 'backorder']).nullable(),
        }),
      }),
    )
    .max(20),
})
export type SuggestionSystem = z.infer<typeof suggestionSystemSchema>

export const suggestionInsightSchema = contextSchema.extend({
  overview: z.string().max(600),
  lines: z
    .array(z.object({ ref: z.string().max(8), product_id: z.string().uuid(), explanation: z.string().min(1).max(450) }))
    .max(20),
  caveats: z.string().max(450),
  discarded: z.number().int().min(0).max(100),
})
export type SuggestionInsight = z.infer<typeof suggestionInsightSchema>

export interface WithSystem<T, S> {
  readonly result: AiResult<T>
  readonly system: S | null
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AppError({ boundary: 'ai', code: 'CONFIG_INCOMPLETA' })
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(PLANNING_ASSISTANT_FUNCTION, { body })
  if (error) throw new AppError({ boundary: 'ai', code: await codeFromInvokeError(error) })
  const d = data?.data
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
}

function withSystem<T extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  dataSchema: T,
  systemSchema: S,
  env: Record<string, unknown> | null,
): WithSystem<z.infer<T>, z.infer<S>> {
  const system = systemSchema.safeParse(env?.system)
  return { result: parseAiResult(dataSchema, env), system: system.success ? system.data : null }
}

/** CÁLCULO DEL SISTEMA sobre la previsión. Sin IA y sin cuota. */
export async function fetchForecastSignals(storeId: string, locale: Locale): Promise<ForecastSystem | null> {
  const env = await invoke({ mode: 'signals', store_id: storeId, locale })
  const system = forecastSystemSchema.safeParse(env?.system)
  return system.success ? system.data : null
}

/** INTERPRETACIÓN IA de la previsión. Gasta una consulta. */
export async function requestForecastInsight(input: {
  storeId: string
  locale: Locale
  question?: string | null
}): Promise<WithSystem<ForecastInsight, ForecastSystem>> {
  const question = input.question?.trim().slice(0, MAX_PLANNING_QUESTION) ?? ''
  const env = await invoke({
    mode: 'forecast',
    store_id: input.storeId,
    locale: input.locale,
    ...(question ? { question } : {}),
  })
  return withSystem(forecastInsightSchema, forecastSystemSchema, env)
}

/** Explica el sugerido v2 de un cliente. Gasta una consulta; no guarda nada. */
export async function requestSuggestionInsight(input: {
  storeId: string
  customerId: string
  days: number
  locale: Locale
}): Promise<WithSystem<SuggestionInsight, SuggestionSystem>> {
  const env = await invoke({
    mode: 'suggestion',
    store_id: input.storeId,
    customer_id: input.customerId,
    days: input.days,
    locale: input.locale,
  })
  return withSystem(suggestionInsightSchema, suggestionSystemSchema, env)
}
