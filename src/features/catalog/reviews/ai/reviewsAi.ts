import { z } from 'zod'
import { metricSchema } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import { invokeAi } from '@/features/customers/ai/customersAi'
import type { Locale } from '@/shared/i18n/messages'
import { REVIEWS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'

/**
 * Reseñas con IA en el CLIENTE (fase 09). Espejo de
 * `supabase/functions/_shared/aiReviews.ts`.
 *
 *  - `system` — CÁLCULO DEL SISTEMA: conteos, tono por estrellas, señales por
 *    regla y la muestra (solo referencias y marcas; el texto ya está en la
 *    cola). Sin IA y sin cuota.
 *  - `data`   — INTERPRETACIÓN IA agregada (temas, reseñas a revisar) o el
 *    BORRADOR de respuesta.
 *
 * Nada de aquí modera: publicar y rechazar siguen siendo los botones de la
 * cola (`moderate_product_review`). No hay forma de responder, ocultar ni
 * borrar una reseña desde la IA.
 */

export { REVIEWS_ASSISTANT_FUNCTION }

export const REVIEW_SIGNALS = [
  'negative_share',
  'low_rated_product',
  'pending_backlog',
  'contact_in_reviews',
  'unverified_negative',
  'few_reviews',
] as const
export type ReviewSignal = (typeof REVIEW_SIGNALS)[number]
export const REVIEW_FLAGS = ['low_rating', 'pending_stale', 'contact_like', 'unverified_negative'] as const
export const REVIEW_TONES = ['positive', 'mixed', 'negative', 'insufficient'] as const
export type ReviewTone = (typeof REVIEW_TONES)[number]
export const THEME_SENTIMENTS = ['positive', 'negative', 'mixed'] as const
export const ATTENTION_REASONS = [
  'product_issue',
  'delivery_issue',
  'service_complaint',
  'safety_concern',
  'personal_data',
  'offensive_language',
  'possible_spam',
  'off_topic',
  'needs_reply',
] as const
export const REPLY_TONES = ['formal', 'friendly'] as const
export type ReplyTone = (typeof REPLY_TONES)[number]
export const MAX_REVIEWS_QUESTION = 300
export const MAX_REPLY_NOTES = 800

const severity = z.enum(['high', 'medium', 'low'])
const ref = z.string().max(8)
const contextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(ref, z.object({ kind: z.enum(['product', 'review']), label: z.string().min(1).max(200) })),
})
export type ReviewsContext = z.infer<typeof contextSchema>

export const reviewsSystemSchema = contextSchema.extend({
  scope: z.enum(['store', 'product']),
  system_tone: z.enum(REVIEW_TONES),
  signals: z.array(z.object({ code: z.enum(REVIEW_SIGNALS), severity, ref: ref.nullable() })).max(80),
  sample: z
    .array(
      z.object({
        ref,
        id: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        status: z.enum(['pending', 'published', 'rejected']),
        flags: z.array(z.enum(REVIEW_FLAGS)).max(REVIEW_FLAGS.length),
      }),
    )
    .max(40),
})
export type ReviewsSystem = z.infer<typeof reviewsSystemSchema>

export const reviewsInsightSchema = contextSchema.extend({
  overview: z.string().max(700),
  tone: z.enum(REVIEW_TONES),
  tone_overridden: z.boolean(),
  themes: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        sentiment: z.enum(THEME_SENTIMENTS),
        refs: z.array(ref).min(1).max(6),
        review_ids: z.array(z.string().uuid()).min(1).max(6),
        text: z.string().min(1).max(300),
      }),
    )
    .max(6),
  attention: z
    .array(
      z.object({
        ref,
        review_id: z.string().uuid(),
        reason: z.enum(ATTENTION_REASONS),
        text: z.string().min(1).max(260),
      }),
    )
    .max(8),
  answer: z.string().max(1000),
  discarded: z.number().int().min(0).max(100),
})
export type ReviewsInsight = z.infer<typeof reviewsInsightSchema>

export const reviewReplySchema = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(1000),
  points: z.array(z.string().min(1).max(220)).max(3),
  discarded: z.number().int().min(0).max(100),
  draft: z.literal(true),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(ref, z.object({ kind: z.enum(['product', 'review']), label: z.string().min(1).max(200) })),
})
export type ReviewReply = z.infer<typeof reviewReplySchema>

function systemOf(env: Record<string, unknown> | null): ReviewsSystem | null {
  const parsed = reviewsSystemSchema.safeParse(env?.system)
  return parsed.success ? parsed.data : null
}

/** CÁLCULO DEL SISTEMA. Sin IA y sin cuota. */
export async function fetchReviewSignals(storeId: string, locale: Locale): Promise<ReviewsSystem | null> {
  return systemOf(await invokeAi(REVIEWS_ASSISTANT_FUNCTION, { mode: 'signals', store_id: storeId, locale }))
}

/** INTERPRETACIÓN IA agregada. Gasta una consulta. */
export async function requestReviewsInsight(input: {
  storeId: string
  locale: Locale
  question?: string | null
}): Promise<{ result: AiResult<ReviewsInsight>; system: ReviewsSystem | null }> {
  const q = input.question?.trim().slice(0, MAX_REVIEWS_QUESTION) ?? ''
  const env = await invokeAi(REVIEWS_ASSISTANT_FUNCTION, {
    mode: 'analyze',
    store_id: input.storeId,
    locale: input.locale,
    ...(q ? { question: q } : {}),
  })
  return { result: parseAiResult(reviewsInsightSchema, env), system: systemOf(env) }
}

/** BORRADOR de respuesta a una reseña. Gasta una consulta. Nunca se publica. */
export async function requestReviewReply(input: {
  storeId: string
  reviewId: string
  locale: Locale
  tone: ReplyTone
  notes?: string | null
}): Promise<AiResult<ReviewReply>> {
  const notes = input.notes?.trim().slice(0, MAX_REPLY_NOTES) ?? ''
  const env = await invokeAi(REVIEWS_ASSISTANT_FUNCTION, {
    mode: 'reply',
    store_id: input.storeId,
    review_id: input.reviewId,
    locale: input.locale,
    tone: input.tone,
    ...(notes ? { notes } : {}),
  })
  return parseAiResult(reviewReplySchema, env)
}

/** Métricas que el bloque del sistema enseña primero, en orden. */
export const REVIEW_HIGHLIGHTS = [
  'total',
  'average',
  'published_average',
  'positive',
  'neutral',
  'negative',
  'pending',
  'pending_stale',
  'contact_like',
] as const
