import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AI_KEY, aiEntitlementKey } from '@/features/ai/hooks'
import type { Locale } from '@/shared/i18n/messages'
import { TRADE_KEY } from '../hooks'
import {
  createQuoteFromDraft,
  fetchAssortmentSignals,
  previewQuoteDraft,
  requestAssortmentSuggestions,
  requestQuoteDraft,
  type DraftLineInput,
} from './quotesAi'

export const assortmentSignalsKey = (storeId: string | null, customerId: string | null) =>
  [...AI_KEY, 'assortment-signals', storeId, customerId] as const

export const draftPreviewKey = (storeId: string | null, customerId: string | null, lines: readonly DraftLineInput[]) =>
  [...TRADE_KEY, 'draft-preview', storeId, customerId, lines] as const

/** INTERPRETAR la instrucción: bajo demanda, gasta una consulta. */
export function useQuoteDraft(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; instruction: string; customerId?: string | null }) =>
      requestQuoteDraft({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}

/**
 * PRECIO DEL SISTEMA: se vuelve a pedir cada vez que cambian cliente o líneas.
 * No es IA ni gasta cuota; la respuesta anterior se mantiene mientras llega la
 * nueva para que la tabla no parpadee.
 */
export function useDraftPreview(storeId: string | null, customerId: string | null, lines: readonly DraftLineInput[]) {
  return useQuery({
    queryKey: draftPreviewKey(storeId, customerId, lines),
    queryFn: () => previewQuoteDraft({ storeId: storeId as string, customerId: customerId as string, lines }),
    enabled: Boolean(storeId && customerId) && lines.length > 0,
    retry: false,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })
}

/** EJECUTAR: crea la cotización en `draft`. Refresca el listado. */
export function useCreateQuoteFromDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createQuoteFromDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRADE_KEY }),
  })
}

/** CÁLCULO DEL SISTEMA del surtido: sin modelo ni cuota. */
export function useAssortmentSignals(storeId: string | null, customerId: string | null, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: [...assortmentSignalsKey(storeId, customerId), locale],
    queryFn: () => fetchAssortmentSignals({ storeId: storeId as string, customerId: customerId as string, locale }),
    enabled: enabled && Boolean(storeId && customerId),
    retry: false,
    staleTime: 30_000,
  })
}

/** PRIORIZAR con IA: bajo demanda, gasta una consulta. */
export function useAssortmentSuggestions(locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { storeId: string; customerId: string; question?: string | null }) =>
      requestAssortmentSuggestions({ ...input, locale }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
}
