import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { codeFromDbError } from '@/shared/lib/appError'
import { PROMOTION_IMPACT_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * ¿Funcionó la campaña? (2026-11-19). Lo calcula la base (`promotion_impact`):
 * vigencia frente al mismo tramo justo anterior, canjes y descuento dado.
 */
const tramo = z.object({ units: z.coerce.number(), revenue: z.coerce.number(), orders: z.coerce.number() })
export const impactSchema = z.object({
  started: z.boolean(),
  days: z.coerce.number().optional(),
  partial_scope: z.boolean().optional(),
  during: tramo.optional(),
  before: tramo.optional(),
  redemptions: z.object({ count: z.coerce.number(), discount: z.coerce.number() }).optional(),
  units_change_pct: z.coerce.number().nullable().optional(),
})
export type PromotionImpactData = z.infer<typeof impactSchema>

export async function fetchPromotionImpact(promotionId: string): Promise<PromotionImpactData> {
  const client = tryGetSupabaseClient()
  if (!client) throw new Error('CONFIG_INCOMPLETA')
  const { data, error } = await client.rpc(PROMOTION_IMPACT_RPC, { p_promotion_id: promotionId })
  if (error) throw new Error(codeFromDbError(error))
  return impactSchema.parse(data)
}

export function usePromotionImpact(promotionId: string) {
  return useQuery({
    queryKey: ['promotions', 'impact', promotionId],
    queryFn: () => fetchPromotionImpact(promotionId),
  })
}
