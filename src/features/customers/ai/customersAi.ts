import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { metricSchema } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { CUSTOMERS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

export { CUSTOMERS_ASSISTANT_FUNCTION }

/**
 * IA de clientes en el CLIENTE (fase 06): resumen 360.
 *
 * El navegador no habla con ningún proveedor: invoca `customers-assistant`,
 * que lee `ai_customer_facts` con el JWT del usuario (cartera del vendedor,
 * crédito solo con permiso) y revisa lo que dice el modelo. Aquí se vuelve a
 * validar con zod antes de pintar.
 *
 * Dos capas que la pantalla NO mezcla:
 *  - `system` — CÁLCULO DEL SISTEMA: ficha reducida, señales, últimos pedidos,
 *    productos frecuentes, promociones y visitas. Llega siempre (también sin
 *    IA) y no gasta cuota. Lo reutiliza la IA de visitas (`salesAi.ts`).
 *  - `data`   — INTERPRETACIÓN IA: texto con marcadores `{{clave}}` que se
 *    sustituyen por la cifra de la base (`metrics`).
 */

// Listas cerradas — espejo de `supabase/functions/_shared/aiCustomers.ts`
// (`CustomersAi.test.tsx` compara las dos copias).
export const CUSTOMER_AI_SIGNALS = [
  'payment_failed',
  'overdue_debt',
  'credit_blocked',
  'inactive',
  'frequency_drop',
  'awaiting_approval',
  'awaiting_payment',
  'credit_watch',
  'quote_expiring',
  'open_returns',
  'pending_visit_tasks',
  'open_quotes',
  'lapsed_products',
  'no_recent_visit',
  'cancellations',
  'open_orders',
  'new_customer',
  'no_orders',
  'missing_contact',
  'inactive_record',
] as const
export type CustomerAiSignal = (typeof CUSTOMER_AI_SIGNALS)[number]

export const CUSTOMER_AI_SEVERITIES = ['high', 'medium', 'low'] as const
export type CustomerAiSeverity = (typeof CUSTOMER_AI_SEVERITIES)[number]

export const CUSTOMER_ORDER_LINKS = ['account', 'email', 'account_and_email', 'none'] as const
export const VISIT_OUTCOMES_AI = ['planned', 'completed', 'no_order', 'closed', 'rescheduled'] as const

export const MAX_CUSTOMER_QUESTION = 300

const entitySchema = z.object({
  kind: z.enum(['customer', 'product', 'order', 'promotion', 'task']),
  label: z.string().min(1).max(160),
})

export const customerAiContextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(8), entitySchema),
})
export type CustomerAiContext = z.infer<typeof customerAiContextSchema>

const signalSchema = z.object({ code: z.enum(CUSTOMER_AI_SIGNALS), severity: z.enum(CUSTOMER_AI_SEVERITIES) })

const productSchema = z.object({
  ref: z.string().max(8),
  product_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  lapsed: z.boolean(),
})

/** Bloque `system`: CÁLCULO DEL SISTEMA, haya IA o no. */
export const customerSystemSchema = customerAiContextSchema.extend({
  customer: z.object({
    customer_id: z.string().uuid(),
    kind: z.enum(['person', 'company']).nullable(),
    code: z.string().max(40).nullable(),
    name: z.string().min(1).max(80),
    tier: z.enum(['a', 'b', 'c']).nullable(),
    visit_frequency: z.enum(['weekly', 'biweekly', 'monthly', 'on_demand']).nullable(),
    segment: z.string().max(60).nullable(),
    business_type: z.string().max(60).nullable(),
    is_active: z.boolean(),
    has_email: z.boolean(),
    has_phone: z.boolean(),
    has_tax_id: z.boolean(),
  }),
  account: z
    .object({ is_active: z.boolean(), requires_approval: z.boolean(), purchase_order_required: z.boolean() })
    .nullable(),
  link: z.enum(CUSTOMER_ORDER_LINKS),
  sections: z.object({
    credit: z.boolean(),
    visits: z.boolean(),
    promotions: z.boolean(),
    returns: z.boolean(),
    quotes: z.boolean(),
  }),
  credit_status: z.enum(['ok', 'watch', 'blocked', 'none']).nullable(),
  signals: z.array(signalSchema).max(CUSTOMER_AI_SIGNALS.length),
  recent_orders: z
    .array(
      z.object({
        ref: z.string().max(8),
        order_id: z.string().uuid(),
        order_number: z.string().min(1).max(40),
        status: z.string().max(30).nullable(),
        payment_status: z.string().max(30).nullable(),
        fulfillment_status: z.string().max(30).nullable(),
        approval_status: z.string().max(30).nullable(),
      }),
    )
    .max(5),
  products: z.array(productSchema).max(8),
  promotions: z.array(z.object({ ref: z.string().max(8), name: z.string().min(1).max(60) })).max(5),
  tasks: z.array(z.object({ ref: z.string().max(8), label: z.string().min(1).max(120) })).max(8),
  visits: z
    .object({
      recent: z
        .array(z.object({ outcome: z.enum(VISIT_OUTCOMES_AI), has_order: z.boolean(), notes: z.string().max(200).nullable() }))
        .max(5),
      in_portfolio: z.boolean(),
    })
    .nullable(),
  visit: z
    .object({
      visit_id: z.string().uuid(),
      outcome: z.enum(VISIT_OUTCOMES_AI),
      checked_in: z.boolean(),
      checked_out: z.boolean(),
      has_order: z.boolean(),
      route: z.string().max(60).nullable(),
      notes: z.string().max(300).nullable(),
      tasks: z.array(z.object({ label: z.string().min(1).max(120), done: z.boolean() })).max(10),
    })
    .nullable(),
})
export type CustomerSystem = z.infer<typeof customerSystemSchema>

export const pendingSchema = z.object({
  signal: z.enum(CUSTOMER_AI_SIGNALS),
  severity: z.enum(CUSTOMER_AI_SEVERITIES),
  text: z.string().min(1).max(350),
})
export const productNoteSchema = productSchema.extend({ text: z.string().min(1).max(350) })

/** `data`: INTERPRETACIÓN IA del 360, ya revisada por el servidor. */
export const customerInsightSchema = customerAiContextSchema.extend({
  overview: z.string().max(700),
  highlights: z.array(z.string().min(1).max(350)).max(5),
  pending: z.array(pendingSchema).max(6),
  opportunities: z.array(productNoteSchema).max(4),
  answer: z.string().max(1000),
  discarded: z.number().int().min(0).max(100),
})
export type CustomerInsight = z.infer<typeof customerInsightSchema>

export interface CustomerAiResponse {
  readonly result: AiResult<CustomerInsight>
  readonly system: CustomerSystem | null
}

export function systemOf(env: Record<string, unknown> | null): CustomerSystem | null {
  const parsed = customerSystemSchema.safeParse(env?.system)
  // Un bloque del sistema roto no se pinta a medias: se omite.
  return parsed.success ? parsed.data : null
}

export async function invokeAi(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AppError({ boundary: 'ai', code: 'CONFIG_INCOMPLETA' })
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(fn, { body })
  if (error) throw new AppError({ boundary: 'ai', code: await codeFromInvokeError(error) })
  const d = data?.data
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
}

/** CÁLCULO DEL SISTEMA. Sin IA y sin cuota. */
export async function fetchCustomerSignals(customerId: string, locale: Locale): Promise<CustomerSystem | null> {
  return systemOf(await invokeAi(CUSTOMERS_ASSISTANT_FUNCTION, { mode: 'signals', customer_id: customerId, locale }))
}

/** INTERPRETACIÓN IA del 360, con pregunta opcional. Gasta una consulta. */
export async function requestCustomerInsight(input: {
  customerId: string
  locale: Locale
  question?: string | null
}): Promise<CustomerAiResponse> {
  const question = input.question?.trim().slice(0, MAX_CUSTOMER_QUESTION) ?? ''
  const env = await invokeAi(CUSTOMERS_ASSISTANT_FUNCTION, {
    mode: 'summary',
    customer_id: input.customerId,
    locale: input.locale,
    ...(question ? { question } : {}),
  })
  return { result: parseAiResult(customerInsightSchema, env), system: systemOf(env) }
}
