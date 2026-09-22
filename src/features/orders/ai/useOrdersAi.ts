import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import {
  fetchOrderSignals,
  requestOrderInsight,
  requestOrdersAttention,
  searchOrdersNatural,
} from './ordersAi'

export const orderSignalsKey = (orderId: string | null) => [...AI_KEY, 'order-signals', orderId] as const

/**
 * Lo que el SISTEMA detecta en el pedido. No gasta cuota (no hay modelo), así
 * que sí se pide al abrir la pestaña. `staleTime` corto: tras mover un eje en
 * otra pestaña del cajón, volver aquí lo relee.
 */
export function useOrderSignals(orderId: string | null, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: [...orderSignalsKey(orderId), locale],
    queryFn: () => fetchOrderSignals(orderId as string, locale),
    enabled: enabled && Boolean(orderId),
    retry: false,
    staleTime: 15_000,
  })
}

/**
 * Interpretación IA de un pedido, BAJO DEMANDA: cada petición gasta una
 * consulta de la cuota. Tras cada intento se vuelve a leer el saldo.
 */
export function useOrderInsight(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { orderId: string; question?: string | null }) =>
      requestOrderInsight({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}

export function useOrdersAttention(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; question?: string | null }) =>
      requestOrdersAttention({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}

export function useOrdersNaturalSearch(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; question: string }) => searchOrdersNatural({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
