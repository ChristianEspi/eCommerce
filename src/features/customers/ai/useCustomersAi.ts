import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import { fetchCustomerSignals, requestCustomerInsight } from './customersAi'

export const customerSignalsKey = (customerId: string | null) => [...AI_KEY, 'customer-signals', customerId] as const

/** CÁLCULO DEL SISTEMA: sin modelo ni cuota, se pide al abrir la pestaña. */
export function useCustomerSignals(customerId: string | null, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: [...customerSignalsKey(customerId), locale],
    queryFn: () => fetchCustomerSignals(customerId as string, locale),
    enabled: enabled && Boolean(customerId),
    retry: false,
    staleTime: 15_000,
  })
}

/** INTERPRETACIÓN IA, bajo demanda: cada petición gasta una consulta. */
export function useCustomerInsight(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { customerId: string; question?: string | null }) => requestCustomerInsight({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
