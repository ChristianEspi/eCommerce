import { z } from 'zod'
import { metricSchema, plainAnalystText } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import { invokeAi } from '@/features/customers/ai/customersAi'

/**
 * «Explicar lo que calculó el sistema» en el CLIENTE (fase 08: Crédito, Pagos
 * y Entregas). Espejo de `supabase/functions/_shared/aiExplain.ts`.
 *
 * El navegador no habla con ningún proveedor: invoca la Edge Function de su
 * superficie (`credit-assistant`, `payments-assistant`,
 * `fulfillment-assistant`), que lee el dataset con el JWT del usuario y revisa
 * lo que dice el modelo. Aquí se vuelve a validar con zod ANTES de pintar, con
 * las listas cerradas de la superficie: una señal, una acción o una pestaña
 * que no están en la lista ⇒ `esquema` (no se pinta a medias).
 *
 * Dos capas que la pantalla NO mezcla:
 *  - `system` — CÁLCULO DEL SISTEMA: señales por regla, cifras, filas. Llega
 *    siempre (también sin IA) y no gasta cuota.
 *  - `data`   — INTERPRETACIÓN IA o BORRADOR: texto con marcadores `{{clave}}`
 *    que se sustituyen por la cifra de la base (`metrics`).
 *
 * Nada de aquí escribe: no hay ninguna llamada que cambie un estado.
 */

export const EXPLAIN_SEVERITIES = ['high', 'medium', 'low'] as const
export type ExplainSeverity = (typeof EXPLAIN_SEVERITIES)[number]

export const MAX_EXPLAIN_QUESTION = 300
export const MAX_DRAFT_NOTES = 800
export const DRAFT_TONES = ['formal', 'friendly'] as const
export type DraftTone = (typeof DRAFT_TONES)[number]

const ref = z.string().max(12)
const entitySchema = z.object({ kind: z.string().min(1).max(20), label: z.string().min(1).max(160) })

export const explainContextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(ref, entitySchema),
})
export type ExplainContext = z.infer<typeof explainContextSchema>

/** Las listas cerradas de una superficie (las mismas del servidor). */
export interface ExplainLists<S extends string, A extends string> {
  readonly signals: readonly [S, ...S[]]
  readonly actions: readonly [A, ...A[]]
  readonly tabs: readonly [string, ...string[]]
}

export function explainSchemas<S extends string, A extends string>(lists: ExplainLists<S, A>) {
  const signal = z.enum(lists.signals)
  const system = explainContextSchema.extend({
    scope: z.string().min(1).max(20),
    signals: z
      .array(z.object({ code: signal, severity: z.enum(EXPLAIN_SEVERITIES), ref: ref.nullable() }))
      .max(200),
    highlights: z.array(z.string().max(60)).max(20),
    items: z
      .array(
        z.object({
          ref,
          id: z.string().uuid(),
          label: z.string().min(1).max(160),
          severity: z.enum(EXPLAIN_SEVERITIES),
          signals: z.array(signal).max(lists.signals.length),
        }),
      )
      .max(30),
    rows: z
      .array(
        z.object({
          ref: ref.nullable(),
          group: z.string().min(1).max(30),
          label: z.string().min(1).max(160),
          status: z.string().max(40).nullable(),
          metrics: z.array(z.string().max(60)).max(8),
          note: z.string().max(200).nullable(),
        }),
      )
      .max(80),
  })
  const insight = explainContextSchema.extend({
    overview: z.string().max(700),
    findings: z
      .array(
        z.object({
          signal,
          severity: z.enum(EXPLAIN_SEVERITIES),
          ref: ref.nullable(),
          text: z.string().min(1).max(350),
        }),
      )
      .max(6),
    actions: z
      .array(
        z.object({
          kind: z.enum(lists.actions),
          ref: ref.nullable(),
          target_id: z.string().uuid().nullable(),
          tab: z.enum(lists.tabs).nullable(),
          text: z.string().min(1).max(300),
        }),
      )
      .max(5),
    answer: z.string().max(1000),
    discarded: z.number().int().min(0).max(100),
  })
  return { system, insight }
}

/** El borrador: `draft: true` o no es un borrador (y no se pinta). */
export const explainDraftSchema = z.object({
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(1600),
  points: z.array(z.string().min(1).max(220)).max(5),
  discarded: z.number().int().min(0).max(100),
  draft: z.literal(true),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(ref, entitySchema),
})
export type ExplainDraft = z.infer<typeof explainDraftSchema>

type Schemas<S extends string, A extends string> = ReturnType<typeof explainSchemas<S, A>>
export type ExplainSystem<S extends string = string, A extends string = string> = z.infer<Schemas<S, A>['system']>
export type ExplainInsight<S extends string = string, A extends string = string> = z.infer<Schemas<S, A>['insight']>
export type ExplainItem = ExplainSystem['items'][number]
export type ExplainAction = ExplainInsight['actions'][number]

export interface ExplainResponse<T> {
  readonly result: AiResult<T>
  readonly system: ExplainSystem | null
}

/** Cliente de una superficie: su función, sus listas y sus parámetros fijos. */
export function explainClient<S extends string, A extends string>(fn: string, lists: ExplainLists<S, A>) {
  const schemas = explainSchemas(lists)
  const systemOf = (env: Record<string, unknown> | null): ExplainSystem | null => {
    const parsed = schemas.system.safeParse(env?.system)
    // Un bloque del sistema roto no se pinta a medias: se omite.
    return parsed.success ? (parsed.data as ExplainSystem) : null
  }
  return {
    fn,
    lists,
    schemas,
    systemOf,
    /** CÁLCULO DEL SISTEMA. Sin IA y sin cuota. */
    async signals(params: Record<string, unknown>): Promise<ExplainSystem | null> {
      return systemOf(await invokeAi(fn, { ...params, mode: 'signals' }))
    },
    /** INTERPRETACIÓN IA con pregunta opcional. Gasta una consulta. */
    async explain(params: Record<string, unknown>, question?: string | null): Promise<ExplainResponse<ExplainInsight>> {
      const q = question?.trim().slice(0, MAX_EXPLAIN_QUESTION) ?? ''
      const env = await invokeAi(fn, { ...params, mode: 'explain', ...(q ? { question: q } : {}) })
      return { result: parseAiResult(schemas.insight, env) as AiResult<ExplainInsight>, system: systemOf(env) }
    },
    /** BORRADOR (recordatorio, mensaje). Gasta una consulta. Nunca se envía. */
    async draft(
      params: Record<string, unknown>,
      mode: 'reminder' | 'message',
      tone: DraftTone,
      notes?: string | null,
    ): Promise<ExplainResponse<ExplainDraft>> {
      const n = notes?.trim().slice(0, MAX_DRAFT_NOTES) ?? ''
      const env = await invokeAi(fn, { ...params, mode, tone, ...(n ? { notes: n } : {}) })
      return { result: parseAiResult(explainDraftSchema, env), system: systemOf(env) }
    },
  }
}
export type ExplainClient = ReturnType<typeof explainClient<string, string>>

/** Etiqueta de una métrica: `D1_balance` → `balance` (el prefijo es la referencia de la fila). */
export function metricSuffix(key: string): string {
  return key.replace(/^[A-Z]\d{1,2}_/, '')
}

/** Texto plano del borrador: marcadores → valores de la base (para editar y copiar). */
export function draftToPlainText(text: string, draft: ExplainDraft, locale: 'es' | 'en', days: string): string {
  return plainAnalystText(text, draft, locale, { days })
}
