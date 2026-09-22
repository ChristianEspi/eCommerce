import { z } from 'zod'
import {
  customerAiContextSchema,
  invokeAi,
  pendingSchema,
  productNoteSchema,
  systemOf,
  type CustomerSystem,
} from '@/features/customers/ai/customersAi'
import { renderAnalystText, type MarkerContext } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { SALES_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'

export { SALES_ASSISTANT_FUNCTION }

/**
 * IA de visitas en el CLIENTE (fase 06): Preparar visita y Generar seguimiento.
 *
 * `sales-assistant` lee `ai_visit_facts` con el JWT del usuario (la visita es
 * del vendedor que la hace, u owner/admin) y revisa al modelo. El seguimiento
 * es un BORRADOR: esta capa no tiene ninguna función de envío, y la pantalla
 * solo permite editarlo y copiarlo.
 */

export const FOLLOW_UP_TONES = ['formal', 'friendly'] as const
export type FollowUpTone = (typeof FOLLOW_UP_TONES)[number]
export const MAX_FOLLOW_UP_NOTES = 800

/** `data` de Preparar visita, ya revisado por el servidor. */
export const visitPrepSchema = customerAiContextSchema.extend({
  summary: z.string().max(700),
  recent_activity: z.string().max(700),
  pending: z.array(pendingSchema).max(6),
  products: z.array(productNoteSchema).max(5),
  questions: z.array(z.string().min(1).max(300)).max(5),
  discarded: z.number().int().min(0).max(100),
})
export type VisitPrep = z.infer<typeof visitPrepSchema>

/**
 * `data` del seguimiento. `draft` es SIEMPRE `true`: si el servidor dijera otra
 * cosa, la respuesta no se pinta (`esquema`).
 */
export const followUpDraftSchema = customerAiContextSchema.extend({
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(1600),
  points: z.array(z.string().min(1).max(220)).max(5),
  discarded: z.number().int().min(0).max(100),
  draft: z.literal(true),
})
export type FollowUpDraft = z.infer<typeof followUpDraftSchema>

export interface SalesAiResponse<T> {
  readonly result: AiResult<T>
  readonly system: CustomerSystem | null
}

/** CÁLCULO DEL SISTEMA de la visita. Sin IA y sin cuota. */
export async function fetchVisitSignals(visitId: string, locale: Locale): Promise<CustomerSystem | null> {
  return systemOf(await invokeAi(SALES_ASSISTANT_FUNCTION, { mode: 'signals', visit_id: visitId, locale }))
}

/** Preparar visita. Gasta una consulta. */
export async function requestVisitPrep(input: { visitId: string; locale: Locale }): Promise<SalesAiResponse<VisitPrep>> {
  const env = await invokeAi(SALES_ASSISTANT_FUNCTION, { mode: 'prepare', visit_id: input.visitId, locale: input.locale })
  return { result: parseAiResult(visitPrepSchema, env), system: systemOf(env) }
}

/** Generar seguimiento (BORRADOR). Gasta una consulta. No envía nada. */
export async function requestFollowUp(input: {
  visitId: string
  locale: Locale
  tone: FollowUpTone
  notes?: string | null
}): Promise<SalesAiResponse<FollowUpDraft>> {
  const notes = input.notes?.trim().slice(0, MAX_FOLLOW_UP_NOTES) ?? ''
  const env = await invokeAi(SALES_ASSISTANT_FUNCTION, {
    mode: 'follow_up',
    visit_id: input.visitId,
    locale: input.locale,
    tone: input.tone,
    ...(notes ? { notes } : {}),
  })
  return { result: parseAiResult(followUpDraftSchema, env), system: systemOf(env) }
}

/**
 * Marcadores → texto llano, para un borrador que se edita y se copia. Un
 * marcador desconocido queda en «—» (nunca el marcador crudo).
 */
export function toPlainText(text: string, context: MarkerContext, locale: Locale, days: string): string {
  return renderAnalystText(text, context, locale, { days })
    .map((p) => p.text)
    .join('')
}
