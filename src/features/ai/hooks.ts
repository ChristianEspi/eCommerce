import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { fetchAiEntitlement, fetchAiInteractions, sendAiFeedback } from './api'
import type { AiEntitlement, AiInteraction } from './types'

/**
 * El saldo de IA en el cliente.
 *
 * Se refresca al recuperar el foco porque el saldo lo gasta el SERVIDOR: una
 * pestaña abierta media hora mientras otra persona del mismo tenant usa el
 * asistente enseñaría un saldo que ya no existe. Es lo contrario de lo que
 * hace falta en un medidor.
 */
export const AI_KEY = ['ai'] as const
export const aiEntitlementKey = () => [...AI_KEY, 'entitlement'] as const

export function useAiEntitlement(enabled = true): UseQueryResult<AiEntitlement> {
  return useQuery({
    queryKey: aiEntitlementKey(),
    queryFn: fetchAiEntitlement,
    enabled,
    refetchOnWindowFocus: true,
    // Corto: el saldo cambia con cada acción de cualquiera del tenant.
    staleTime: 30_000,
  })
}

export const aiInteractionsKey = () => [...AI_KEY, 'interactions'] as const

export function useAiInteractions(enabled = true): UseQueryResult<AiInteraction[]> {
  return useQuery({
    queryKey: aiInteractionsKey(),
    queryFn: fetchAiInteractions,
    enabled,
  })
}

export function useAiFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | -1 }) => sendAiFeedback(id, value),
    // No invalida el saldo: opinar no gasta cuota.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiInteractionsKey() }),
  })
}
