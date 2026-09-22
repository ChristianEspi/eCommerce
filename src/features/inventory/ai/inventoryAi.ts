import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { metricSchema } from '@/features/admin/dashboard/aiAnalyst'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { INVENTORY_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

export { INVENTORY_ASSISTANT_FUNCTION }

/**
 * IA de inventario en el CLIENTE (fase 05).
 *
 * El navegador no habla con ningún proveedor: invoca `inventory-assistant`,
 * que lee `ai_inventory_facts` con el JWT del usuario y revisa lo que dice el
 * modelo. Aquí se vuelve a validar con zod antes de pintar.
 *
 * Dos capas que la pantalla NO mezcla:
 *  - `system` — CÁLCULO DEL SISTEMA: señales, severidad y revisión por regla.
 *    Llega siempre (también sin IA) y no gasta cuota.
 *  - `data`   — INTERPRETACIÓN IA: texto con marcadores `{{clave}}` que se
 *    sustituyen por la cifra de la base (`metrics`). Ninguna cantidad sale del
 *    modelo, y no hay cantidades de reposición.
 */

// Listas cerradas — espejo de `supabase/functions/_shared/aiInventory.ts`
// (`InventoryAi.test.tsx` compara las dos copias).
export const INVENTORY_AI_SIGNALS = [
  'stockout',
  'negative',
  'stockout_risk',
  'below_reorder',
  'stale',
  'atypical_movement',
  'excess',
  'stagnant',
  'high_rotation',
] as const
export type InventoryAiSignal = (typeof INVENTORY_AI_SIGNALS)[number]

export const INVENTORY_AI_REVIEWS = [
  'review_replenishment',
  'review_reorder_point',
  'review_excess',
  'review_stagnant',
  'review_movement',
  'review_sync',
  'monitor',
  'none',
] as const
export type InventoryAiReview = (typeof INVENTORY_AI_REVIEWS)[number]

/** Pestañas de `InventoryPage` (`#hash`) a las que lleva una revisión. */
export const INVENTORY_TABS = ['existencias', 'movimientos', 'almacenes'] as const
export type InventoryTab = (typeof INVENTORY_TABS)[number]

export const INVENTORY_AI_REVIEW_TAB: Readonly<Record<InventoryAiReview, InventoryTab | null>> = {
  review_replenishment: 'existencias',
  review_reorder_point: 'existencias',
  review_excess: 'existencias',
  review_stagnant: 'existencias',
  review_movement: 'movimientos',
  review_sync: 'almacenes',
  monitor: null,
  none: null,
}

export const INVENTORY_AI_SEVERITIES = ['high', 'medium', 'low'] as const
export type InventoryAiSeverity = (typeof INVENTORY_AI_SEVERITIES)[number]

export const MAX_INVENTORY_QUESTION = 300

const reviewSchema = z.object({
  kind: z.enum(INVENTORY_AI_REVIEWS),
  tab: z.enum(INVENTORY_TABS).nullable(),
})
export type InventoryReview = z.infer<typeof reviewSchema>

const entitySchema = z.object({
  kind: z.enum(['product', 'movement']),
  label: z.string().min(1).max(160),
})

const contextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(8), entitySchema),
})
export type InventoryAiContext = z.infer<typeof contextSchema>

const productBase = {
  ref: z.string().max(8),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  name: z.string().min(1).max(80),
  sku: z.string().max(60).nullable(),
  severity: z.enum(INVENTORY_AI_SEVERITIES),
  signals: z.array(z.enum(INVENTORY_AI_SIGNALS)).min(1).max(INVENTORY_AI_SIGNALS.length),
}

/** Bloque `system`: CÁLCULO DEL SISTEMA, haya IA o no. */
export const inventorySystemSchema = contextSchema.extend({
  total_tracked: z.number().int().min(0).nullable(),
  items: z.array(z.object({ ...productBase, system_review: reviewSchema })).max(25),
})
export type InventorySystem = z.infer<typeof inventorySystemSchema>

/** `data`: INTERPRETACIÓN IA, ya revisada por el servidor. */
export const inventoryInsightSchema = contextSchema.extend({
  overview: z.string().max(600),
  answer: z.string().max(1000),
  items: z
    .array(
      z.object({
        ...productBase,
        explanation: z.string().min(1).max(450),
        suggested_review: reviewSchema,
        overridden: z.boolean(),
      }),
    )
    .max(15),
  discarded: z.number().int().min(0).max(100),
})
export type InventoryInsight = z.infer<typeof inventoryInsightSchema>

export interface InventoryAiResponse {
  readonly result: AiResult<InventoryInsight>
  readonly system: InventorySystem | null
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AppError({ boundary: 'ai', code: 'CONFIG_INCOMPLETA' })
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(INVENTORY_ASSISTANT_FUNCTION, { body })
  if (error) throw new AppError({ boundary: 'ai', code: await codeFromInvokeError(error) })
  const d = data?.data
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
}

function systemOf(env: Record<string, unknown> | null): InventorySystem | null {
  const parsed = inventorySystemSchema.safeParse(env?.system)
  // Un bloque del sistema roto no se pinta a medias: se omite.
  return parsed.success ? parsed.data : null
}

/** CÁLCULO DEL SISTEMA. Sin IA y sin cuota. */
export async function fetchInventorySignals(storeId: string, locale: Locale): Promise<InventorySystem | null> {
  return systemOf(await invoke({ mode: 'signals', store_id: storeId, locale }))
}

/** INTERPRETACIÓN IA del lote, con pregunta opcional. Gasta una consulta. */
export async function requestInventoryInsight(input: {
  storeId: string
  locale: Locale
  question?: string | null
}): Promise<InventoryAiResponse> {
  const question = input.question?.trim().slice(0, MAX_INVENTORY_QUESTION) ?? ''
  const env = await invoke({
    mode: 'analyze',
    store_id: input.storeId,
    locale: input.locale,
    ...(question ? { question } : {}),
  })
  return { result: parseAiResult(inventoryInsightSchema, env), system: systemOf(env) }
}
