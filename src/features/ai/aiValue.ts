import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { codeFromDbError } from '@/shared/lib/appError'
import { AI_VALUE_SUMMARY_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/** «Lo que aportó la IA» (2026-11-19): lo calcula la base (`ai_value_summary`). */
export const aiValueSchema = z.object({
  days: z.coerce.number(),
  currency: z.string().nullable(),
  attributed_revenue: z.coerce.number().nullable(),
  attributed_orders: z.coerce.number(),
  by_source: z.object({ intake: z.coerce.number(), assistant: z.coerce.number() }),
  marked_lines: z.coerce.number(),
  actions_executed: z.coerce.number(),
  actions_pending: z.coerce.number(),
})
export type AiValue = z.infer<typeof aiValueSchema>

export async function fetchAiValue(storeId: string, days = 30): Promise<AiValue> {
  const client = tryGetSupabaseClient()
  if (!client) throw new Error('CONFIG_INCOMPLETA')
  const { data, error } = await client.rpc(AI_VALUE_SUMMARY_RPC, { p_store_id: storeId, p_days: days })
  if (error) throw new Error(codeFromDbError(error))
  return aiValueSchema.parse(data)
}

export function useAiValue(storeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['ai', 'value', storeId],
    enabled: Boolean(storeId) && enabled,
    queryFn: () => fetchAiValue(storeId as string),
  })
}
