import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import { fetchInventorySignals, requestInventoryInsight } from './inventoryAi'

export const inventorySignalsKey = (storeId: string | null) => [...AI_KEY, 'inventory-signals', storeId] as const

/**
 * CÁLCULO DEL SISTEMA: no hay modelo ni cuota, así que se pide al abrir la
 * pestaña. `staleTime` corto: tras un ajuste en Existencias, volver aquí lo
 * relee.
 */
export function useInventorySignals(storeId: string | null, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: [...inventorySignalsKey(storeId), locale],
    queryFn: () => fetchInventorySignals(storeId as string, locale),
    enabled: enabled && Boolean(storeId),
    retry: false,
    staleTime: 15_000,
  })
}

/** INTERPRETACIÓN IA, bajo demanda: cada petición gasta una consulta. */
export function useInventoryInsight(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; question?: string | null }) => requestInventoryInsight({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
