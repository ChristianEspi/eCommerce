import { z } from 'zod'
import { AppError } from '@/domain/errors'
import type { CapabilityId } from '@/domain'
import { metricSchema } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { ORDERS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import {
  APPROVAL_STATUSES,
  FULFILLMENT_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from '../types'

export { ORDERS_ASSISTANT_FUNCTION }

/**
 * IA de pedidos en el CLIENTE (fase 04).
 *
 * El navegador no llama a ningún proveedor: invoca `orders-assistant`, que lee
 * datasets reducidos con el JWT del usuario (RLS) y valida lo que dice el
 * modelo. Aquí se valida OTRA VEZ con zod antes de pintar. Las cifras salen de
 * `metrics` (valor de la base): el texto solo trae marcadores `{{clave}}`.
 *
 * Nada de este archivo escribe: la `suggested_action` es un destino (pestaña o
 * ruta) donde la persona entra al flujo normal. Aprobar, cobrar, despachar o
 * cancelar siguen pasando por `order_transition` / `order_approval_decide`.
 */

// Listas cerradas — espejo de `supabase/functions/_shared/aiOrders.ts`.
// `ai-orders-front.test.tsx` compara las dos copias.
export const ORDER_AI_SIGNALS = [
  'approval_pending',
  'approval_rejected',
  'payment_failed',
  'payment_requires_action',
  'payment_stale',
  'payment_pending',
  'paid_not_shipped',
  'ready_to_fulfill',
  'fulfillment_in_progress',
  'fulfillment_overdue',
  'fulfillment_failed',
  'shipment_error',
  'return_open',
  'stale',
] as const
export type OrderAiSignal = (typeof ORDER_AI_SIGNALS)[number]

export const ORDER_AI_MISSING = ['shipping_address', 'phone', 'email', 'purchase_order', 'items'] as const
export type OrderAiMissing = (typeof ORDER_AI_MISSING)[number]

export const ORDER_AI_ACTIONS = [
  'review_approval',
  'follow_up_payment',
  'prepare_fulfillment',
  'review_fulfillment',
  'review_return',
  'contact_customer',
  'add_note',
  'open_order',
  'none',
] as const
export type OrderAiAction = (typeof ORDER_AI_ACTIONS)[number]

export const ORDER_AI_SEVERITIES = ['high', 'medium', 'low'] as const
export type OrderAiSeverity = (typeof ORDER_AI_SEVERITIES)[number]

/** Pestañas del cajón a las que puede llevar una sugerencia. */
export const ORDER_DRAWER_TABS = ['summary', 'operation', 'history'] as const
export type OrderDrawerTab = (typeof ORDER_DRAWER_TABS)[number]

/** Rutas fuera del cajón (lista cerrada) y la capacidad que las abre. */
export const ORDER_AI_ROUTES = ['/app/fulfillment'] as const
export const ORDER_AI_ROUTE_CAPABILITY: Readonly<Record<(typeof ORDER_AI_ROUTES)[number], CapabilityId>> = {
  '/app/fulfillment': 'fulfillment',
}

export const MAX_ORDER_QUESTION = 300

/** Espejo de `PESTANA_DE_ACCION` / `RUTA_DE_ACCION` del servidor (test de paridad). */
export const ORDER_AI_ACTION_TAB: Readonly<Record<OrderAiAction, OrderDrawerTab | null>> = {
  review_approval: 'summary',
  follow_up_payment: 'operation',
  prepare_fulfillment: 'operation',
  review_fulfillment: 'operation',
  review_return: 'history',
  contact_customer: 'summary',
  add_note: 'operation',
  open_order: 'summary',
  none: null,
}

export const ORDER_AI_ACTION_ROUTE: Readonly<Record<OrderAiAction, (typeof ORDER_AI_ROUTES)[number] | null>> = {
  review_approval: null,
  follow_up_payment: null,
  prepare_fulfillment: null,
  review_fulfillment: '/app/fulfillment',
  review_return: '/app/fulfillment',
  contact_customer: null,
  add_note: null,
  open_order: null,
  none: null,
}

/** La acción del SISTEMA (siguiente paso esperado) con su destino. */
export function suggestedActionFor(kind: OrderAiAction, orderId: string | null): OrderSuggestedAction {
  return {
    kind,
    order_id: kind === 'none' ? null : orderId,
    tab: ORDER_AI_ACTION_TAB[kind],
    route: ORDER_AI_ACTION_ROUTE[kind],
  }
}

const suggestedActionSchema = z.object({
  kind: z.enum(ORDER_AI_ACTIONS),
  order_id: z.string().uuid().nullable(),
  tab: z.enum(ORDER_DRAWER_TABS).nullable(),
  route: z.enum(ORDER_AI_ROUTES).nullable(),
})
export type OrderSuggestedAction = z.infer<typeof suggestedActionSchema>

const entitySchema = z.object({
  kind: z.enum(['order', 'customer', 'line', 'event', 'note']),
  label: z.string().min(1).max(160),
})

const contextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(20), entitySchema),
})
export type OrderAiContext = z.infer<typeof contextSchema>

const diagnosisSchema = z.object({
  signals: z
    .array(z.object({ code: z.enum(ORDER_AI_SIGNALS), severity: z.enum(ORDER_AI_SEVERITIES) }))
    .max(ORDER_AI_SIGNALS.length),
  missing: z.array(z.enum(ORDER_AI_MISSING)).max(ORDER_AI_MISSING.length),
  next_action: z.enum(ORDER_AI_ACTIONS),
  allowed_actions: z.array(z.enum(ORDER_AI_ACTIONS)).max(ORDER_AI_ACTIONS.length),
  closed: z.boolean(),
})
export type OrderDiagnosis = z.infer<typeof diagnosisSchema>

/** Bloque `system` del detalle: lo que detecta el sistema, haya IA o no. */
export const orderSystemSchema = contextSchema.extend({
  order_id: z.string().uuid(),
  diagnosis: diagnosisSchema,
})
export type OrderSystem = z.infer<typeof orderSystemSchema>

export const orderInsightSchema = contextSchema.extend({
  summary: z.string().max(600),
  status_explanation: z.string().max(600),
  blockers: z
    .array(z.object({ signal: z.enum(ORDER_AI_SIGNALS), severity: z.enum(ORDER_AI_SEVERITIES), explanation: z.string().min(1).max(400) }))
    .max(8),
  missing_info: z.array(z.object({ field: z.enum(ORDER_AI_MISSING), explanation: z.string().min(1).max(300) })).max(6),
  next_step: z.object({ action: z.enum(ORDER_AI_ACTIONS), explanation: z.string().max(400), overridden: z.boolean() }),
  history_summary: z.string().max(600),
  answer: z.string().max(900),
  suggested_action: suggestedActionSchema,
  discarded: z.number().int().min(0).max(100),
})
export type OrderInsight = z.infer<typeof orderInsightSchema>

const rowBase = {
  order_id: z.string().uuid(),
  order_number: z.string().min(1).max(40),
  customer_label: z.string().max(80).nullable(),
  status: z.enum(ORDER_STATUSES),
  payment_status: z.enum(PAYMENT_STATUSES),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES),
  approval_status: z.enum(APPROVAL_STATUSES),
}

export const attentionSystemSchema = contextSchema.extend({
  total_open: z.union([z.number().int().min(0), z.string()]).transform((v) => Number(v)),
  items: z
    .array(
      z.object({
        ref: z.string().max(8),
        ...rowBase,
        severity: z.enum(ORDER_AI_SEVERITIES),
        signals: z.array(z.enum(ORDER_AI_SIGNALS)).max(ORDER_AI_SIGNALS.length),
        next_action: z.enum(ORDER_AI_ACTIONS),
      }),
    )
    .max(15),
})
export type AttentionSystem = z.infer<typeof attentionSystemSchema>

export const attentionSchema = contextSchema.extend({
  overview: z.string().max(500),
  items: z
    .array(
      z.object({
        ref: z.string().max(8),
        ...rowBase,
        severity: z.enum(ORDER_AI_SEVERITIES),
        signals: z.array(z.enum(ORDER_AI_SIGNALS)).max(ORDER_AI_SIGNALS.length),
        reason: z.string().min(1).max(300),
        suggested_action: suggestedActionSchema,
      }),
    )
    .max(15),
  discarded: z.number().int().min(0).max(100),
})
export type OrdersAttention = z.infer<typeof attentionSchema>

export const orderFiltersSchema = z.object({
  status: z.enum(ORDER_STATUSES).nullable(),
  payment_status: z.enum(PAYMENT_STATUSES).nullable(),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES).nullable(),
  approval_status: z.enum(APPROVAL_STATUSES).nullable(),
  source_channel: z.enum(ORDER_SOURCES).nullable(),
  placed_within_days: z.number().int().min(1).max(366).nullable(),
  older_than_days: z.number().int().min(1).max(366).nullable(),
  text: z.string().max(60).nullable(),
  attention_only: z.boolean(),
})
export type OrderAiFilters = z.infer<typeof orderFiltersSchema>

export const searchSchema = z.object({
  filters: orderFiltersSchema,
  discarded: z.number().int().min(0).max(100),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(25),
  rows: z
    .array(
      z.object({
        id: z.string().uuid(),
        order_number: z.string().min(1).max(40),
        customer_label: z.string().max(80).nullable(),
        status: z.enum(ORDER_STATUSES),
        payment_status: z.enum(PAYMENT_STATUSES),
        fulfillment_status: z.enum(FULFILLMENT_STATUSES),
        approval_status: z.enum(APPROVAL_STATUSES),
        currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
        grand_total: z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/).nullable(),
        placed_at: z.string().nullable(),
      }),
    )
    .max(25),
})
export type OrdersSearch = z.infer<typeof searchSchema>

/** Un resultado de IA + el bloque determinista que lo acompaña. */
export interface WithSystem<T, S> {
  readonly result: AiResult<T>
  readonly system: S | null
}

async function invoke(body: Record<string, unknown>): Promise<{ data?: unknown } | null> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AppError({ boundary: 'ai', code: 'CONFIG_INCOMPLETA' })
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(ORDERS_ASSISTANT_FUNCTION, { body })
  if (error) throw new AppError({ boundary: 'ai', code: await codeFromInvokeError(error) })
  return data ?? null
}

function envelope(raw: { data?: unknown } | null): Record<string, unknown> | null {
  const d = raw?.data
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
}

function parseWithSystem<T extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  dataSchema: T,
  systemSchema: S,
  raw: { data?: unknown } | null,
): WithSystem<z.infer<T>, z.infer<S>> {
  const env = envelope(raw)
  const system = systemSchema.safeParse(env?.system)
  return {
    result: parseAiResult(dataSchema, env),
    // Un bloque del sistema roto no se pinta a medias: se omite.
    system: system.success ? system.data : null,
  }
}

/** Lo que detecta el SISTEMA en un pedido. Sin IA y sin cuota. */
export async function fetchOrderSignals(orderId: string, locale: Locale): Promise<OrderSystem | null> {
  const raw = await invoke({ mode: 'signals', order_id: orderId, locale })
  const system = orderSystemSchema.safeParse(envelope(raw)?.system)
  return system.success ? system.data : null
}

/** Resumen/explicación de UN pedido, con pregunta opcional. Gasta una consulta. */
export async function requestOrderInsight(input: {
  orderId: string
  locale: Locale
  question?: string | null
}): Promise<WithSystem<OrderInsight, OrderSystem>> {
  const question = input.question?.trim().slice(0, MAX_ORDER_QUESTION) ?? ''
  const raw = await invoke({
    mode: 'order',
    order_id: input.orderId,
    locale: input.locale,
    ...(question ? { question } : {}),
  })
  return parseWithSystem(orderInsightSchema, orderSystemSchema, raw)
}

/** «¿Qué pedidos requieren atención?»: lote pequeño de la tienda activa. */
export async function requestOrdersAttention(input: {
  storeId: string
  locale: Locale
  question?: string | null
}): Promise<WithSystem<OrdersAttention, AttentionSystem>> {
  const question = input.question?.trim().slice(0, MAX_ORDER_QUESTION) ?? ''
  const raw = await invoke({
    mode: 'attention',
    store_id: input.storeId,
    locale: input.locale,
    ...(question ? { question } : {}),
  })
  return parseWithSystem(attentionSchema, attentionSystemSchema, raw)
}

/** Lenguaje natural → filtros tipados → búsqueda controlada (≤25). */
export async function searchOrdersNatural(input: {
  storeId: string
  locale: Locale
  question: string
}): Promise<AiResult<OrdersSearch>> {
  const question = input.question.trim().slice(0, MAX_ORDER_QUESTION)
  const raw = await invoke({ mode: 'search', store_id: input.storeId, locale: input.locale, question })
  return parseAiResult(searchSchema, envelope(raw))
}

/** Filtros aplicados como pares (clave, valor) para pintar chips traducidos. */
export function describeFilters(f: OrderAiFilters): Array<{ key: keyof OrderAiFilters; value: string | number | true }> {
  const out: Array<{ key: keyof OrderAiFilters; value: string | number | true }> = []
  const keys: Array<keyof OrderAiFilters> = [
    'status',
    'payment_status',
    'fulfillment_status',
    'approval_status',
    'source_channel',
    'placed_within_days',
    'older_than_days',
    'text',
  ]
  for (const key of keys) {
    const value = f[key]
    if (value !== null && value !== false) out.push({ key, value: value as string | number })
  }
  if (f.attention_only) out.push({ key: 'attention_only', value: true })
  return out
}
