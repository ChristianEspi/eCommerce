import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import { fetchVisitSignals, requestFollowUp, requestVisitPrep, type FollowUpTone } from './salesAi'

export const visitSignalsKey = (visitId: string | null) => [...AI_KEY, 'visit-signals', visitId] as const

/** CÁLCULO DEL SISTEMA de la visita: sin modelo ni cuota, al abrir el cajón. */
export function useVisitSignals(visitId: string | null, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: [...visitSignalsKey(visitId), locale],
    queryFn: () => fetchVisitSignals(visitId as string, locale),
    enabled: enabled && Boolean(visitId),
    retry: false,
    staleTime: 15_000,
  })
}

/** Preparar visita, bajo demanda: gasta una consulta. */
export function useVisitPrep(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (visitId: string) => requestVisitPrep({ visitId, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}

/** Generar seguimiento (BORRADOR), bajo demanda: gasta una consulta. */
export function useFollowUp(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { visitId: string; tone: FollowUpTone; notes?: string | null }) =>
      requestFollowUp({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
