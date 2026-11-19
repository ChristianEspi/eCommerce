import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  addAssortmentItem,
  addQuoteItem,
  fetchAssortmentItems,
  fetchAssortments,
  fetchQuoteItems,
  fetchQuotes,
  removeAssortmentItem,
  removeQuoteItem,
  saveAssortment,
  saveQuote,
  searchTradeProducts,
  setQuoteStatus,
  addAssortmentAssignment,
  deleteAssortmentAssignment,
  fetchAssortmentAssignments,
  setAssortmentAssignmentActive,
} from './api'
import type { Assortment, AssortmentAssignment, AssortmentItem, Quote, QuoteItem } from './types'

/**
 * Estado comercial en el cliente.
 *
 * Tocar una línea invalida TODA la rama de cotizaciones y no solo esa lista:
 * añadir o quitar un renglón recalcula el total de la cabecera, así que la
 * tabla de cotizaciones queda desfasada en cuanto se toca el detalle. Una
 * invalidación quirúrgica dejaría el listado enseñando el total de antes, que
 * es exactamente la cifra que alguien acabaría enviando al cliente.
 */
export const TRADE_KEY = ['trade'] as const
export const quotesKey = () => [...TRADE_KEY, 'quotes'] as const
export const quoteItemsKey = (quoteId: string | null) =>
  [...TRADE_KEY, 'quote-items', quoteId ?? 'none'] as const
export const assortmentsKey = () => [...TRADE_KEY, 'assortments'] as const
export const assortmentItemsKey = (assortmentId: string | null) =>
  [...TRADE_KEY, 'assortment-items', assortmentId ?? 'none'] as const
export const tradeProductsKey = (storeId: string | null, term: string) =>
  [...TRADE_KEY, 'products', storeId ?? 'none', term] as const

export function useQuotes(): UseQueryResult<Quote[]> {
  return useQuery({ queryKey: quotesKey(), queryFn: fetchQuotes, retry: false })
}

export function useQuoteItems(quoteId: string | null): UseQueryResult<QuoteItem[]> {
  return useQuery({
    queryKey: quoteItemsKey(quoteId),
    queryFn: () => fetchQuoteItems(quoteId),
    enabled: quoteId !== null,
    retry: false,
  })
}

export function useAssortments(): UseQueryResult<Assortment[]> {
  return useQuery({ queryKey: assortmentsKey(), queryFn: fetchAssortments, retry: false })
}

export function useAssortmentItems(assortmentId: string | null): UseQueryResult<AssortmentItem[]> {
  return useQuery({
    queryKey: assortmentItemsKey(assortmentId),
    queryFn: () => fetchAssortmentItems(assortmentId),
    enabled: assortmentId !== null,
    retry: false,
  })
}

export function useTradeProductSearch(storeId: string | null, term: string) {
  return useQuery({
    queryKey: tradeProductsKey(storeId, term),
    queryFn: () => searchTradeProducts({ storeId, term }),
    enabled: storeId !== null,
    retry: false,
  })
}

function useTradeMutation<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRADE_KEY }),
  })
}

export function useSaveQuote() {
  return useTradeMutation(saveQuote)
}

export function useSetQuoteStatus() {
  return useTradeMutation(setQuoteStatus)
}

export function useAddQuoteItem() {
  return useTradeMutation(addQuoteItem)
}

export function useRemoveQuoteItem() {
  return useTradeMutation(removeQuoteItem)
}

export function useSaveAssortment() {
  return useTradeMutation(saveAssortment)
}

export function useAddAssortmentItem() {
  return useTradeMutation(addAssortmentItem)
}

export function useRemoveAssortmentItem() {
  return useTradeMutation(removeAssortmentItem)
}

export const assortmentAssignmentsKey = (assortmentId: string | null) =>
  [...TRADE_KEY, 'assortment-assignments', assortmentId] as const

/** Con id: las de ese surtido. Con `null`: todas, para la columna «Se aplica a». */
export function useAssortmentAssignments(assortmentId: string | null): UseQueryResult<AssortmentAssignment[]> {
  return useQuery({
    queryKey: assortmentAssignmentsKey(assortmentId),
    queryFn: () => fetchAssortmentAssignments(assortmentId),
    retry: false,
  })
}

export function useAddAssortmentAssignment() {
  return useTradeMutation(addAssortmentAssignment)
}

export function useToggleAssortmentAssignment() {
  return useTradeMutation(setAssortmentAssignmentActive)
}

export function useDeleteAssortmentAssignment() {
  return useTradeMutation(deleteAssortmentAssignment)
}
