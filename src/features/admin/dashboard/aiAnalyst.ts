import { z } from 'zod'
import { AppError } from '@/domain/errors'
import type { CapabilityId } from '@/domain'
import { AI_ERROR_KINDS, parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { DASHBOARD_INSIGHTS_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { formatMoney } from '@/shared/lib/format'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

export { DASHBOARD_INSIGHTS_FUNCTION }

/**
 * Analista IA del dashboard, en el CLIENTE (fase 02).
 *
 * El navegador no llama a ningún proveedor: invoca `dashboard-insights`, que
 * lee el dataset reducido con el JWT del usuario (RLS) y valida la salida del
 * modelo. Aquí se valida OTRA VEZ con zod antes de pintar, y las cifras se
 * resuelven desde `metrics` (valor de la base), nunca desde el texto del modelo:
 * el texto solo trae marcadores `{{clave}}`.
 */

export const SEVERITIES = ['high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const ANALYST_MODULES = ['sales', 'orders', 'inventory', 'fulfillment', 'credit', 'catalog'] as const
export type AnalystModule = (typeof ANALYST_MODULES)[number]

/** Rutas destino (lista cerrada, espejo de `RUTA_DE_MODULO` del servidor). */
export const ANALYST_ROUTES: Readonly<Record<AnalystModule, string>> = {
  sales: '/app/analytics',
  orders: '/app/orders',
  inventory: '/app/inventory',
  fulfillment: '/app/fulfillment',
  credit: '/app/credit',
  catalog: '/app/products',
}

/** Capacidad que abre cada destino: sin ella no se ofrece el enlace. */
export const ANALYST_ROUTE_CAPABILITY: Readonly<Record<AnalystModule, CapabilityId>> = {
  sales: 'analytics.basic',
  orders: 'orders',
  inventory: 'inventory.multiwarehouse',
  fulfillment: 'fulfillment',
  credit: 'credit.management',
  catalog: 'catalog',
}

export const SUGGESTED_ACTIONS = [
  'review_orders',
  'review_approvals',
  'follow_up_payment',
  'restock',
  'review_idle_stock',
  'review_deliveries',
  'contact_customer',
  'review_catalog',
  'review_sales',
  'none',
] as const

export const SUGGESTED_QUESTIONS = [
  'review_today',
  'sales_change',
  'orders_attention',
  'products_review',
] as const
export type SuggestedQuestion = (typeof SUGGESTED_QUESTIONS)[number]

export const MAX_QUESTION = 300

const route = z.enum(Object.values(ANALYST_ROUTES) as [string, ...string[]])

export const metricSchema = z.object({
  kind: z.enum(['count', 'money', 'percent', 'days', 'quantity']),
  value: z.union([z.number().finite(), z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/)]),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
})
export type Metric = z.infer<typeof metricSchema>

const entitySchema = z.object({
  kind: z.enum(['order', 'stock_low', 'stock_idle', 'delivery', 'customer', 'product']),
  label: z.string().min(1).max(160),
  detail: z.string().max(40).nullable(),
  module: z.enum(ANALYST_MODULES),
  route,
})
export type AnalystEntity = z.infer<typeof entitySchema>

const contextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(8), entitySchema),
})
export type AnalystContext = z.infer<typeof contextSchema>

const insightSchema = z.object({
  title: z.string().min(1).max(160),
  explanation: z.string().min(1).max(500),
  severity: z.enum(SEVERITIES),
  module: z.enum(ANALYST_MODULES),
  route,
  entity_ref: z.string().max(8).nullable(),
  suggested_action: z.enum(SUGGESTED_ACTIONS),
  action_label: z.string().max(160),
  evidence: z.array(z.string().max(60)).max(6),
})
export type AnalystInsight = z.infer<typeof insightSchema>

export const summarySchema = contextSchema.extend({
  insights: z.array(insightSchema).min(1).max(6),
})
export type AnalystSummary = z.infer<typeof summarySchema>

export const answerSchema = contextSchema.extend({
  answerable: z.boolean(),
  answer: z.string().min(1).max(1000),
  module: z.enum(ANALYST_MODULES).nullable(),
  route: route.nullable(),
  evidence: z.array(z.string().max(60)).max(6),
})
export type AnalystAnswer = z.infer<typeof answerSchema>

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) {
    throw new AppError({ boundary: 'ai', code: 'CONFIG_INCOMPLETA' })
  }
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(
    DASHBOARD_INSIGHTS_FUNCTION,
    { body },
  )
  if (error) throw new AppError({ boundary: 'ai', code: await codeFromInvokeError(error) })
  return data?.data
}

/**
 * Pide el resumen «Hoy deberías revisar». No lanza cuando no hay resumen: la
 * ausencia viene con su motivo tipado (sin cuota, sin contratar, proveedor…).
 * Solo lanza si la llamada falló (red, sesión, permiso).
 */
export async function requestAnalystSummary(input: {
  storeId: string | null
  locale: Locale
}): Promise<AiResult<AnalystSummary>> {
  const raw = await invoke({ mode: 'summary', store_id: input.storeId, locale: input.locale })
  return parseAiResult(summarySchema, raw)
}

export async function askAnalyst(input: {
  storeId: string | null
  locale: Locale
  question: string
}): Promise<AiResult<AnalystAnswer>> {
  const question = input.question.trim().slice(0, MAX_QUESTION)
  const raw = await invoke({ mode: 'ask', store_id: input.storeId, locale: input.locale, question })
  return parseAiResult(answerSchema, raw)
}

// ---------------------------------------------------------------------------
// Pintar: marcadores → cifras de la base
// ---------------------------------------------------------------------------

export interface FormatLabels {
  /** Plantilla con `{n}`: «{n} días» / «{n} days». */
  readonly days: string
}

export function formatMetric(metric: Metric, locale: Locale, labels: FormatLabels): string {
  const n = typeof metric.value === 'number' ? metric.value : Number(metric.value)
  if (!Number.isFinite(n)) return '—'
  const tag = locale === 'en' ? 'en-US' : 'es-PE'
  switch (metric.kind) {
    case 'money':
      return metric.currency ? formatMoney(n, metric.currency, locale) : '—'
    case 'percent': {
      const txt = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(Math.abs(n))
      const sign = n > 0 ? '+' : n < 0 ? '−' : ''
      return `${sign}${txt} %`
    }
    case 'days':
      return labels.days.replace('{n}', new Intl.NumberFormat(tag).format(n))
    case 'quantity':
      return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(n)
    default:
      return new Intl.NumberFormat(tag).format(n)
  }
}

export type TextPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'metric'; readonly key: string; readonly text: string }
  | { readonly type: 'entity'; readonly ref: string; readonly text: string }

const PLACEHOLDER = /\{\{([A-Za-z0-9_.]{1,60})\}\}/g

/**
 * Lo mínimo que hace falta para pintar marcadores: cifras por clave y
 * entidades con etiqueta. Lo comparten el analista y la IA de pedidos (fase 04).
 */
export interface MarkerContext {
  readonly metrics: Readonly<Record<string, Metric>>
  readonly entities: Readonly<Record<string, { readonly label: string }>>
}

/**
 * Parte un texto del analista en trozos: texto, cifra (desde `metrics`) o
 * entidad (desde `entities`). Un marcador desconocido se pinta como «—»: el
 * servidor ya los filtró, pero lo que cruza la red se vuelve a mirar.
 */
export function renderAnalystText(
  text: string,
  context: MarkerContext,
  locale: Locale,
  labels: FormatLabels,
): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', text: text.slice(last, index) })
    const key = match[1] ?? ''
    // `Object.hasOwn`: `{{constructor}}` no puede resolver a una función heredada.
    const metric = Object.hasOwn(context.metrics, key) ? context.metrics[key] : undefined
    const entity = Object.hasOwn(context.entities, key) ? context.entities[key] : undefined
    if (metric) parts.push({ type: 'metric', key, text: formatMetric(metric, locale, labels) })
    else if (entity) parts.push({ type: 'entity', ref: key, text: entity.label })
    else parts.push({ type: 'text', text: '—' })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

export function plainAnalystText(
  text: string,
  context: MarkerContext,
  locale: Locale,
  labels: FormatLabels,
): string {
  return renderAnalystText(text, context, locale, labels)
    .map((p) => p.text)
    .join('')
}

/** Motivos tras los que tiene sentido volver a pedir (el resto necesita otra cosa). */
export function canRetryMotivo(motivo: (typeof AI_ERROR_KINDS)[number]): boolean {
  return (
    motivo === 'timeout' ||
    motivo === 'rate_limit' ||
    motivo === 'proveedor' ||
    motivo === 'truncado' ||
    motivo === 'esquema' ||
    motivo === 'vacia' ||
    motivo === 'bloqueada' ||
    motivo === 'refusal'
  )
}
