import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import { fetchForecastSignals, requestForecastInsight, requestSuggestionInsight } from './planningAi'

export const forecastSignalsKey = (storeId: string | null) => [...AI_KEY, 'forecast-signals', storeId] as const

/** CÁLCULO DEL SISTEMA: sin modelo ni cuota, se pide al abrir la pestaña. */
export function useForecastSignals(storeId: string | null, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: [...forecastSignalsKey(storeId), locale],
    queryFn: () => fetchForecastSignals(storeId as string, locale),
    enabled: enabled && Boolean(storeId),
    retry: false,
    staleTime: 30_000,
  })
}

/** INTERPRETACIÓN IA de la previsión, bajo demanda (una consulta). */
export function useForecastInsight(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; question?: string | null }) => requestForecastInsight({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}

/** Explicación del sugerido v2, bajo demanda (una consulta). */
export function useSuggestionInsight(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; customerId: string; days: number }) =>
      requestSuggestionInsight({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
