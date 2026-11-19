import { AI_ATTRIBUTION_MARK_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Anota que unos productos llegaron al comprador con ayuda de la IA
 * (2026-11-19). Sirve para medir el valor de la IA (`ai_value_summary`): se
 * cuenta lo que ese mismo comprador pide de ESOS productos en los 7 días
 * siguientes.
 *
 * Es una anotación, no una operación: nunca bloquea ni avisa. Sin sesión no se
 * llama (la base tampoco anotaría) y cualquier fallo se ignora.
 */
export type AiAttributionSource = 'intake' | 'assistant'

export function markAiAttribution(storeSlug: string, productIds: readonly string[], source: AiAttributionSource): void {
  const ids = [...new Set(productIds)].slice(0, 100)
  if (!storeSlug || ids.length === 0) return
  const client = tryGetSupabaseClient()
  if (!client) return
  void Promise.resolve(
    client.rpc(AI_ATTRIBUTION_MARK_RPC, { p_store_slug: storeSlug, p_product_ids: ids, p_source: source }),
  ).catch(() => undefined)
}
