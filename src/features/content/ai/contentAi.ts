import { z } from 'zod'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import { invokeAi } from '@/features/customers/ai/customersAi'
import type { Locale } from '@/shared/i18n/messages'
import { CONTENT_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'

/**
 * CMS con IA en el CLIENTE (fase 09). Espejo de
 * `supabase/functions/_shared/aiContent.ts`.
 *
 * El navegador invoca `content-assistant` con lo que la persona está
 * escribiendo en el formulario; el servidor redacta, revisa (sin cifras
 * nuevas, sin promesas nuevas, sin enlaces, sin «publicado») y devuelve un
 * BORRADOR. Aquí se valida con zod antes de pintar. Nada se guarda ni se
 * publica desde aquí: «Aplicar» escribe en el formulario.
 */

export { CONTENT_ASSISTANT_FUNCTION }

export const CMS_TASKS = ['banner', 'landing', 'seo', 'translate'] as const
export type CmsTask = (typeof CMS_TASKS)[number]
export const CMS_FIELDS = ['title', 'subtitle', 'cta_label', 'media_alt', 'seo_title', 'seo_description', 'body'] as const
export type CmsField = (typeof CMS_FIELDS)[number]
export const CMS_TONES = ['neutral', 'friendly', 'premium'] as const
export type CmsTone = (typeof CMS_TONES)[number]
export const MAX_CMS_BRIEF = 600

/** Qué tareas tienen sentido en cada destino (las mismas del servidor). */
export const CMS_TASKS_BY_TARGET = {
  block: ['banner', 'landing', 'translate'],
  page: ['landing', 'seo', 'translate'],
} as const satisfies Record<'block' | 'page', readonly CmsTask[]>

/** Lo que el navegador puede mandar de cada campo (CHECK de la base). */
export const CMS_INPUT_LIMITS: Readonly<Record<CmsField, number>> = {
  title: 160,
  subtitle: 320,
  cta_label: 60,
  media_alt: 200,
  seo_title: 160,
  seo_description: 320,
  body: 2000,
}

export const cmsDraftSchema = z.object({
  task: z.enum(CMS_TASKS),
  fields: z.object({
    title: z.string().min(1).max(160).optional(),
    subtitle: z.string().min(1).max(320).optional(),
    cta_label: z.string().min(1).max(60).optional(),
    media_alt: z.string().min(1).max(200).optional(),
    seo_title: z.string().min(1).max(160).optional(),
    seo_description: z.string().min(1).max(320).optional(),
    body: z.string().min(1).max(2000).optional(),
  }),
  notes: z.array(z.string().min(1).max(240)).max(3),
  discarded: z.number().int().min(0).max(100),
  locale: z.enum(['es', 'en']),
  draft: z.literal(true),
})
export type CmsDraft = z.infer<typeof cmsDraftSchema>

export interface CmsRequest {
  readonly task: CmsTask
  readonly target: 'block' | 'page'
  readonly pageId?: string | null
  readonly blockId?: string | null
  readonly blockType?: string | null
  readonly fields: Readonly<Partial<Record<CmsField, string>>>
  readonly brief?: string | null
  readonly tone: CmsTone
  readonly locale: Locale
  readonly targetLocale?: Locale | null
}

/** Solo campos con texto, recortados al CHECK de la base. */
export function cleanFields(fields: Readonly<Partial<Record<CmsField, string>>>): Partial<Record<CmsField, string>> {
  const out: Partial<Record<CmsField, string>> = {}
  for (const f of CMS_FIELDS) {
    const v = (fields[f] ?? '').trim()
    if (v) out[f] = v.slice(0, CMS_INPUT_LIMITS[f])
  }
  return out
}

/** BORRADOR para el formulario. Gasta una consulta. */
export async function requestCmsDraft(input: CmsRequest): Promise<AiResult<CmsDraft>> {
  const brief = input.brief?.trim().slice(0, MAX_CMS_BRIEF) ?? ''
  const env = await invokeAi(CONTENT_ASSISTANT_FUNCTION, {
    task: input.task,
    target: input.target,
    ...(input.blockId ? { block_id: input.blockId } : {}),
    ...(input.target === 'page' && input.pageId ? { page_id: input.pageId } : {}),
    ...(input.target === 'block' && input.blockType ? { block_type: input.blockType } : {}),
    fields: cleanFields(input.fields),
    tone: input.tone,
    locale: input.locale,
    ...(input.task === 'translate' && input.targetLocale ? { target_locale: input.targetLocale } : {}),
    ...(brief ? { brief } : {}),
  })
  return parseAiResult(cmsDraftSchema, env)
}
