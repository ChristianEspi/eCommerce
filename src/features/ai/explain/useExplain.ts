import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { DraftTone, ExplainClient } from './explainAi'

export const explainSignalsKey = (fn: string, params: Record<string, unknown>) =>
  [...AI_KEY, 'explain', fn, JSON.stringify(params)] as const

/** CÁLCULO DEL SISTEMA: sin modelo ni cuota, se pide al abrir. */
export function useExplainSignals(client: ExplainClient, params: Record<string, unknown>, enabled: boolean) {
  return useQuery({
    queryKey: explainSignalsKey(client.fn, params),
    queryFn: () => client.signals(params),
    enabled,
    retry: false,
    staleTime: 15_000,
  })
}

/** INTERPRETACIÓN IA, bajo demanda: cada petición gasta una consulta. */
export function useExplainInsight(client: ExplainClient, params: Record<string, unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (question: string | null) => client.explain(params, question),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}

/** BORRADOR, bajo demanda: gasta una consulta y nunca se envía. */
export function useExplainDraft(client: ExplainClient, params: Record<string, unknown>, mode: 'reminder' | 'message') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { tone: DraftTone; notes: string | null }) => client.draft(params, mode, input.tone, input.notes),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
