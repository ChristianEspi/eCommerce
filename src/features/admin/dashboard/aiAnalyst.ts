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
  'last_order',
  'sales_change',
  'orders_attention',
  'products_review',
] as const
export type SuggestedQuestion = (typeof SUGGESTED_QUESTIONS)[number]

export const MAX_QUESTION = 300

const route = z.enum(Object.values(ANALYST_ROUTES) as [string, ...string[]])

const DECIMAL_TEXT = /^-?\d{1,15}(\.\d{1,6})?$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/

export const metricSchema = z
  .object({
    kind: z.enum(['count', 'money', 'percent', 'days', 'quantity', 'datetime']),
    value: z.union([z.number().finite(), z.string().regex(DECIMAL_TEXT), z.string().regex(ISO_DATETIME)]),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  })
  // Una fecha solo como `datetime`, y un `datetime` solo como fecha: un número
  // que llega con el tipo cambiado no se pinta como otra cosa.
  .refine((m) => (m.kind === 'datetime') === (typeof m.value === 'string' && ISO_DATETIME.test(m.value)))
export type Metric = z.infer<typeof metricSchema>

const CODE = /^[a-z_]{1,40}$/

const entitySchema = z.object({
  kind: z.enum(['order', 'stock_low', 'stock_idle', 'delivery', 'customer', 'product']),
  label: z.string().min(1).max(160),
  detail: z.string().max(40).nullable(),
  module: z.enum(ANALYST_MODULES),
  route,
  /** Id de la fila (de la base, no del modelo): abre ESA ficha. */
  id: z.string().uuid().optional(),
  /** Estados por eje como códigos cerrados (`payment`, `fulfillment`). */
  facets: z.record(z.enum(['payment', 'fulfillment']), z.string().regex(CODE)).optional(),
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
  const tag = locale === 'en' ? 'en-US' : 'es-PE'
  if (metric.kind === 'datetime') {
    const date = new Date(String(metric.value))
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  const n = typeof metric.value === 'number' ? metric.value : Number(metric.value)
  if (!Number.isFinite(n)) return '—'
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

// ---------------------------------------------------------------------------
// Tarjetas: qué entidades y cifras cita una respuesta
// ---------------------------------------------------------------------------

/** Tope de tarjetas por respuesta: lo demás sigue en el texto. */
export const MAX_ANSWER_CARDS = 6

/**
 * Referencias de entidad que una respuesta cita, en orden de aparición: el
 * marcador directo (`{{R1}}`) o el prefijo de una cifra (`{{R1.total}}` → R1),
 * en el texto y en la evidencia. Solo las que existen en `entities`.
 */
export function citedEntityRefs(
  text: string,
  evidence: readonly string[],
  context: Pick<AnalystContext, 'entities'>,
): string[] {
  const refs: string[] = []
  const add = (key: string) => {
    const ref = key.split('.')[0] ?? ''
    if (Object.hasOwn(context.entities, ref) && !refs.includes(ref)) refs.push(ref)
  }
  for (const match of text.matchAll(PLACEHOLDER)) add(match[1] ?? '')
  for (const key of evidence) add(key)
  return refs.slice(0, MAX_ANSWER_CARDS)
}

/**
 * Cifras generales (no de una entidad) que sostienen la respuesta, sin repetir
 * y solo si existen: se pintan como indicadores.
 */
export function evidenceMetricKeys(
  evidence: readonly string[],
  context: Pick<AnalystContext, 'metrics' | 'entities'>,
): string[] {
  const keys: string[] = []
  for (const key of evidence) {
    const prefix = key.split('.')[0] ?? ''
    if (Object.hasOwn(context.entities, prefix)) continue
    if (Object.hasOwn(context.metrics, key) && !keys.includes(key)) keys.push(key)
  }
  return keys.slice(0, 4)
}

/** Cifras de una entidad (`R1.total` → `total`), en un orden estable. */
export const ENTITY_FIELDS = [
  'total',
  'placed_at',
  'age_days',
  'available',
  'reorder_point',
  'days_late',
  'documents',
  'max_days_overdue',
  'units',
  'revenue',
] as const
export type EntityField = (typeof ENTITY_FIELDS)[number]

export function entityMetrics(
  ref: string,
  context: Pick<AnalystContext, 'metrics'>,
): Array<{ field: EntityField; metric: Metric }> {
  const out: Array<{ field: EntityField; metric: Metric }> = []
  for (const field of ENTITY_FIELDS) {
    const key = `${ref}.${field}`
    const metric = Object.hasOwn(context.metrics, key) ? context.metrics[key] : undefined
    if (metric) out.push({ field, metric })
  }
  return out
}

/** Enlace que abre ESE pedido en el listado (el drawer lo relee por id, con RLS). */
export function orderHref(entity: Pick<AnalystEntity, 'kind' | 'id'>): string | null {
  return entity.kind === 'order' && entity.id ? `${ANALYST_ROUTES.orders}?order=${entity.id}` : null
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
