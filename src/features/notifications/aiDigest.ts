import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { codeFromDbError } from '@/shared/lib/appError'
import { AI_DIGEST_CONFIGURE_RPC, AI_DIGEST_SETTINGS_TABLE } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Resumen diario por correo (2026-11-19): lectura de la configuración por
 * tienda y el comando que la guarda (`ai_digest_configure`, con rol y tienda
 * comprobados en la base).
 */
export const digestSettingsSchema = z.object({ enabled: z.boolean(), send_hour: z.number().int().min(0).max(23) })
export type DigestSettings = z.infer<typeof digestSettingsSchema>

const DEFAULTS: DigestSettings = { enabled: false, send_hour: 8 }

function client() {
  const c = tryGetSupabaseClient()
  if (!c) throw new Error('CONFIG_INCOMPLETA')
  return c
}

export async function fetchDigestSettings(storeId: string): Promise<DigestSettings> {
  const { data, error } = await client()
    .from(AI_DIGEST_SETTINGS_TABLE)
    .select('enabled, send_hour')
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(codeFromDbError(error))
  return data ? digestSettingsSchema.parse(data) : DEFAULTS
}

export async function configureDigest(storeId: string, values: DigestSettings): Promise<void> {
  const { error } = await client().rpc(AI_DIGEST_CONFIGURE_RPC, {
    p_store_id: storeId,
    p_enabled: values.enabled,
    p_send_hour: values.send_hour,
  })
  if (error) throw new Error(codeFromDbError(error))
}

const keyOf = (storeId: string | null) => ['ai', 'digest-settings', storeId] as const

export function useDigestSettings(storeId: string | null) {
  return useQuery({
    queryKey: keyOf(storeId),
    enabled: Boolean(storeId),
    queryFn: () => fetchDigestSettings(storeId as string),
  })
}

export function useConfigureDigest(storeId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: DigestSettings) => configureDigest(storeId as string, values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keyOf(storeId) }),
  })
}
