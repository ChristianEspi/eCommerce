import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  fetchForecasts,
  fetchProductLabels,
  fetchSuggestionItems,
  fetchSuggestions,
  previewSuggestion,
  saveSuggestion,
  setSuggestionStatus,
} from './api'
import type { Forecast, Suggestion, SuggestionItem } from './types'

/**
 * Estado de planificación en el cliente.
 *
 * La PREVISUALIZACIÓN es una mutación, no una query, y no es un capricho: pedir
 * el sugerido es una acción que alguien dispara, no un dato que la pantalla
 * necesita para pintarse. Como query se lanzaría sola al abrir el cajón y
 * volvería a lanzarse en cada refoco, gastando una consulta pesada sobre el
 * histórico de pedidos para responder algo que nadie preguntó.
 */
export const PLANNING_KEY = ['planning'] as const
export const suggestionsKey = () => [...PLANNING_KEY, 'suggestions'] as const
export const suggestionItemsKey = (id: string | null) =>
  [...PLANNING_KEY, 'items', id ?? 'none'] as const
export const forecastsKey = () => [...PLANNING_KEY, 'forecasts'] as const
export const productLabelsKey = (ids: readonly string[]) =>
  [...PLANNING_KEY, 'product-labels', [...ids].sort().join(',')] as const

function useInvalidatePlanning() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: PLANNING_KEY })
}

export function useSuggestions(): UseQueryResult<Suggestion[]> {
  return useQuery({ queryKey: suggestionsKey(), queryFn: fetchSuggestions, retry: false })
}

export function useSuggestionItems(id: string | null): UseQueryResult<SuggestionItem[]> {
  return useQuery({
    queryKey: suggestionItemsKey(id),
    queryFn: () => fetchSuggestionItems(id),
    enabled: id !== null,
    retry: false,
  })
}

export function useForecasts(): UseQueryResult<Forecast[]> {
  return useQuery({ queryKey: forecastsKey(), queryFn: fetchForecasts, retry: false })
}

export function usePreviewSuggestion() {
  return useMutation({ mutationFn: previewSuggestion })
}

export function useSaveSuggestion() {
  const invalidate = useInvalidatePlanning()
  return useMutation({ mutationFn: saveSuggestion, onSuccess: invalidate })
}

export function useSetSuggestionStatus() {
  const invalidate = useInvalidatePlanning()
  return useMutation({ mutationFn: setSuggestionStatus, onSuccess: invalidate })
}

/** Nombres de las líneas propuestas (cierre · item 11). Solo con líneas a la vista. */
export function useProductLabels(ids: readonly string[]) {
  return useQuery({
    queryKey: productLabelsKey(ids),
    queryFn: () => fetchProductLabels(ids),
    enabled: ids.length > 0,
    retry: false,
  })
}