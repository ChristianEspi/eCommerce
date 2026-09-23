import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import { fetchDashboardSignals, requestAnalystSummary } from './aiAnalyst'

export const analystSummaryKey = (storeId: string | null, locale: Locale) =>
  [...AI_KEY, 'dashboard-summary', storeId, locale] as const

/**
 * El resumen del analista, BAJO DEMANDA.
 *
 * `enabled: false`: cada análisis gasta una consulta de la cuota (y corre en el
 * modelo de análisis), así que no se dispara al abrir el dashboard; lo pide la
 * persona con un botón. El resultado se conserva en caché mientras dure la
 * sesión para no pagar dos veces lo mismo al volver a la pantalla.
 */
export function useAnalystSummary(storeId: string | null, locale: Locale) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: analystSummaryKey(storeId, locale),
    queryFn: async () => {
      try {
        return await requestAnalystSummary({ storeId, locale })
      } finally {
        // El saldo lo gasta el servidor: se vuelve a leer tras cada intento.
        void queryClient.invalidateQueries({ queryKey: aiEntitlementKey() })
      }
    },
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
  return query
}

/**
 * «Hoy en tu tienda»: cifras del SISTEMA (sin modelo ni cuota), así que sí se
 * piden al abrir el dashboard. Las preguntas libres son del Copilot.
 */
export function useDashboardSignals(storeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...AI_KEY, 'dashboard-signals', storeId],
    queryFn: () => fetchDashboardSignals(storeId),
    enabled,
    retry: false,
    staleTime: 60_000,
  })
}
