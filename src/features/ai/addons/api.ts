import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { AUDIT_LOG_TABLE } from '@/shared/lib/db-schema'
import { AiError, aiErrorFromDb } from '../errors'
import { AI_KEY } from '../hooks'
import type { AiFeature } from '../features'

/**
 * Complementos IA: encender/apagar, consumo del mes e historial.
 *
 * Nada filtra por sociedad aquí: lo hacen el JWT y la RLS. `ai_feature_set`
 * vuelve a comprobar el rol dentro de la base.
 */

function client() {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AiError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

export const aiUsageRowSchema = z.object({
  feature: z.string(),
  calls: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  input_tokens: z.coerce.number().nonnegative(),
  output_tokens: z.coerce.number().nonnegative(),
  last_at: z.string().nullable(),
})
export type AiUsageRow = z.infer<typeof aiUsageRowSchema>

export async function fetchAiUsageThisMonth(): Promise<AiUsageRow[]> {
  const { data, error } = await client().rpc('ai_usage_this_month')
  if (error) throw aiErrorFromDb(error)
  return z.array(aiUsageRowSchema).parse(data ?? [])
}

export const aiAddonChangeSchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  actor_email: z.string().nullable(),
  action: z.enum(['ai_feature.enabled', 'ai_feature.disabled']),
  entity_label: z.string().nullable(),
})
export type AiAddonChange = z.infer<typeof aiAddonChangeSchema>

export async function fetchAiAddonHistory(): Promise<AiAddonChange[]> {
  const { data, error } = await client()
    .from(AUDIT_LOG_TABLE)
    .select('id, occurred_at, actor_email, action, entity_label')
    .eq('entity_type', 'ai_feature')
    .order('occurred_at', { ascending: false })
    .limit(100)
  if (error) throw aiErrorFromDb(error)
  return (data ?? []).flatMap((row: unknown) => {
    const parsed = aiAddonChangeSchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

export async function setAiFeature(feature: AiFeature, enabled: boolean): Promise<void> {
  const { error } = await client().rpc('ai_feature_set', { p_feature: feature, p_enabled: enabled })
  if (error) throw aiErrorFromDb(error)
}

const addonsKey = [...AI_KEY, 'addons'] as const

export function useAiUsageThisMonth(enabled: boolean) {
  return useQuery({ queryKey: [...addonsKey, 'usage'], queryFn: fetchAiUsageThisMonth, enabled })
}

export function useAiAddonHistory(enabled: boolean) {
  return useQuery({ queryKey: [...addonsKey, 'history'], queryFn: fetchAiAddonHistory, enabled })
}

export function useSetAiFeature() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ feature, enabled }: { feature: AiFeature; enabled: boolean }) => setAiFeature(feature, enabled),
    // El saldo trae `states` y `features`: todas las pantallas de IA se enteran.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AI_KEY }),
  })
}
