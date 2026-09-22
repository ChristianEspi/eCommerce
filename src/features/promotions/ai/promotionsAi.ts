import { z } from 'zod'
import { formatMetric, metricSchema, type Metric } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import { invokeAi } from '@/features/customers/ai/customersAi'
import type { Locale } from '@/shared/i18n/messages'
import { PROMOTIONS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'

/**
 * Promociones con IA en el CLIENTE (fase 09). Espejo de
 * `supabase/functions/_shared/aiPromotions.ts`.
 *
 * El navegador no habla con ningún proveedor: invoca `promotions-assistant`,
 * que lee la promoción con el JWT del usuario y revisa lo que dice el modelo.
 * Aquí se vuelve a validar con zod antes de pintar.
 *
 *  - `system` — CÁLCULO DEL SISTEMA: condiciones de la promoción, valores de
 *    sus reglas y candidatos por regla. Sin IA y sin cuota.
 *  - `data`   — BORRADOR: textos con marcadores `{{clave}}` que se sustituyen
 *    por el valor de la base con el formato del idioma.
 *
 * Nada de aquí escribe: aplicar un texto lo pone en el FORMULARIO y la persona
 * guarda con el botón de siempre. Las reglas de descuento no se tocan.
 */

export { PROMOTIONS_ASSISTANT_FUNCTION }

export const PROMO_TERMS = [
  'requires_coupon',
  'exclusive',
  'min_subtotal',
  'min_quantity',
  'max_discount',
  'per_customer_limit',
  'usage_limit',
  'ends',
  'starts_later',
  'expired',
  'scope_limited',
  'has_exclusions',
  'audience_limited',
  'tiers',
] as const
export type PromoTerm = (typeof PROMO_TERMS)[number]

export const PROMO_CANDIDATE_REASONS = ['top_seller', 'slow_mover', 'segment'] as const
export const PROMO_TONES = ['neutral', 'friendly', 'premium'] as const
export type PromoTone = (typeof PROMO_TONES)[number]
export const PROMO_TEXT_FIELDS = ['name', 'description', 'headline', 'copy', 'cta', 'terms_summary'] as const
export type PromoTextField = (typeof PROMO_TEXT_FIELDS)[number]
export const MAX_PROMO_BRIEF = 600

const entitySchema = z.object({
  kind: z.enum(['scope', 'exclusion', 'audience', 'product', 'segment']),
  label: z.string().min(1).max(160),
})
const ref = z.string().max(8)

const contextSchema = z.object({
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(ref, entitySchema),
})

export const promoSystemSchema = contextSchema.extend({
  promotion_id: z.string().uuid(),
  kind: z.enum(['percentage', 'fixed_amount', 'volume_tier', 'x_for_y', 'bundle']),
  status: z.string().max(20),
  generated_at: z.string().nullable(),
  terms: z.array(z.enum(PROMO_TERMS)).max(PROMO_TERMS.length),
  candidates: z
    .array(
      z.object({
        ref,
        id: z.string().uuid(),
        kind: z.enum(['product', 'segment']),
        reason: z.enum(PROMO_CANDIDATE_REASONS),
        label: z.string().min(1).max(160),
        metrics: z.array(z.string().max(60)).max(4),
      }),
    )
    .max(20),
})
export type PromoSystem = z.infer<typeof promoSystemSchema>

export const promoDraftSchema = contextSchema.extend({
  texts: z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(700).optional(),
    headline: z.string().min(1).max(200).optional(),
    copy: z.string().min(1).max(600).optional(),
    cta: z.string().min(1).max(120).optional(),
    terms_summary: z.string().min(1).max(800).optional(),
  }),
  candidates: z
    .array(
      z.object({
        ref,
        id: z.string().uuid(),
        kind: z.enum(['product', 'segment']),
        reason: z.enum(PROMO_CANDIDATE_REASONS),
        label: z.string().min(1).max(160),
        text: z.string().max(400),
      }),
    )
    .max(6),
  discarded: z.number().int().min(0).max(100),
  draft: z.literal(true),
})
export type PromoDraft = z.infer<typeof promoDraftSchema>

export interface PromoResponse<T> {
  readonly result: AiResult<T>
  readonly system: PromoSystem | null
}

function systemOf(env: Record<string, unknown> | null): PromoSystem | null {
  const parsed = promoSystemSchema.safeParse(env?.system)
  return parsed.success ? parsed.data : null
}

/** CÁLCULO DEL SISTEMA. Sin IA y sin cuota. */
export async function fetchPromotionRules(promotionId: string, locale: Locale): Promise<PromoSystem | null> {
  return systemOf(await invokeAi(PROMOTIONS_ASSISTANT_FUNCTION, { mode: 'rules', promotion_id: promotionId, locale }))
}

/** BORRADOR de textos y candidatos. Gasta una consulta. */
export async function requestPromotionCopy(input: {
  promotionId: string
  locale: Locale
  tone: PromoTone
  brief?: string | null
}): Promise<PromoResponse<PromoDraft>> {
  const brief = input.brief?.trim().slice(0, MAX_PROMO_BRIEF) ?? ''
  const env = await invokeAi(PROMOTIONS_ASSISTANT_FUNCTION, {
    mode: 'copy',
    promotion_id: input.promotionId,
    locale: input.locale,
    tone: input.tone,
    ...(brief ? { brief } : {}),
  })
  return { result: parseAiResult(promoDraftSchema, env), system: systemOf(env) }
}

// ---------------------------------------------------------------------------
// Marcadores → valores de la base
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{([A-Za-z0-9_.]{1,60})\}\}/g

/**
 * El valor de una regla con el formato del idioma. El porcentaje de una
 * promoción es un valor, no una variación: sin signo (a diferencia del
 * analista, que pinta «+15 %»).
 */
export function formatPromoMetric(metric: Metric, locale: Locale, days: string): string {
  if (metric.kind === 'percent') {
    const n = Number(metric.value)
    if (!Number.isFinite(n)) return '—'
    const txt = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE', { maximumFractionDigits: 2 }).format(n)
    return locale === 'en' ? `${txt}%` : `${txt} %`
  }
  return formatMetric(metric, locale, { days })
}

/** Texto plano: marcadores → valor de la base o nombre de la entidad. Desconocido ⇒ «—». */
export function resolvePromoText(
  text: string,
  context: { metrics: Readonly<Record<string, Metric>>; entities: Readonly<Record<string, { label: string }>> },
  locale: Locale,
  days: string,
): string {
  return text.replace(PLACEHOLDER, (_m, key: string) => {
    const metric = Object.hasOwn(context.metrics, key) ? context.metrics[key] : undefined
    if (metric) return formatPromoMetric(metric, locale, days)
    const entity = Object.hasOwn(context.entities, key) ? context.entities[key] : undefined
    return entity ? entity.label : '—'
  })
}

/** Qué valor acompaña a cada condición en el bloque del sistema. */
export const TERM_METRIC: Partial<Record<PromoTerm, string>> = {
  min_subtotal: 'min_subtotal',
  min_quantity: 'min_quantity',
  max_discount: 'max_discount',
  per_customer_limit: 'per_customer_limit',
  usage_limit: 'usage_limit',
  ends: 'ends_in_days',
  starts_later: 'starts_in_days',
}
