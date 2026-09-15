import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addAssignment,
  deleteAssignment,
  deletePriceItem,
  deletePriceList,
  fetchAssignments,
  fetchConflicts,
  fetchPriceChanges,
  fetchPriceItems,
  fetchPriceLists,
  fetchPricingCatalog,
  fetchProductUoms,
  fetchProductVariants,
  fetchSegments,
  importPriceItems,
  savePriceItem,
  savePriceList,
  saveSegment,
  searchPricedProducts,
} from './api'
import type {
  CustomerSegment,
  PriceChangeEvent,
  PriceConflict,
  PriceList,
  PriceListAssignment,
  PriceListItem,
  PricedProduct,
  PricedUom,
  PricedVariant,
} from './types'

/**
 * Estado del motor de precios en el cliente.
 *
 * Todas las claves cuelgan de `PRICING_KEY`, y una escritura invalida además el
 * catálogo público: cambiar un precio cambia lo que la vitrina enseña, y una
 * pantalla que siga mostrando el anterior se lee como «no se guardó».
 */
export const PRICING_KEY = ['pricing'] as const

export const segmentsKey = () => [...PRICING_KEY, 'segments'] as const
export const listsKey = (storeId: string | null) => [...PRICING_KEY, 'lists', storeId] as const
export const itemsKey = (listId: string | null) => [...PRICING_KEY, 'items', listId] as const
export const assignmentsKey = (listId: string | null) =>
  [...PRICING_KEY, 'assignments', listId] as const
export const conflictsKey = (storeId: string | null) =>
  [...PRICING_KEY, 'conflicts', storeId] as const
export const changesKey = (storeId: string | null) => [...PRICING_KEY, 'changes', storeId] as const
export const productSearchKey = (storeId: string | null, term: string) =>
  [...PRICING_KEY, 'product-search', storeId, term] as const
export const variantsKey = (productId: string | null) =>
  [...PRICING_KEY, 'variants', productId] as const
export const uomsKey = (productId: string | null) => [...PRICING_KEY, 'uoms', productId] as const
export const catalogKey = (storeId: string | null) => [...PRICING_KEY, 'catalog', storeId] as const

function useInvalidatePricing() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: PRICING_KEY })
    void queryClient.invalidateQueries({ queryKey: ['storefront'] })
  }
}

export function useSegments(enabled = true) {
  return useQuery<CustomerSegment[]>({
    queryKey: segmentsKey(),
    queryFn: fetchSegments,
    enabled,
  })
}

export function usePriceLists(storeId: string | null) {
  return useQuery<PriceList[]>({
    queryKey: listsKey(storeId),
    queryFn: () => fetchPriceLists(storeId),
    enabled: Boolean(storeId),
  })
}

export function usePriceItems(listId: string | null) {
  return useQuery<PriceListItem[]>({
    queryKey: itemsKey(listId),
    queryFn: () => fetchPriceItems(listId),
    enabled: Boolean(listId),
  })
}

export function useAssignments(listId: string | null) {
  return useQuery<PriceListAssignment[]>({
    queryKey: assignmentsKey(listId),
    queryFn: () => fetchAssignments(listId),
    enabled: Boolean(listId),
  })
}

// Cierre · item 7: la lectura de canales es de `features/channels`. Se
// reexporta con la MISMA clave de cache, asi un canal creado alli aparece en
// los desplegables de precios sin recargar.
export { useChannels, channelsKey } from '@/features/channels/hooks'

export function useConflicts(storeId: string | null, enabled = true) {
  return useQuery<PriceConflict[]>({
    queryKey: conflictsKey(storeId),
    queryFn: () => fetchConflicts(storeId),
    enabled: Boolean(storeId) && enabled,
  })
}

export function usePriceChanges(storeId: string | null, enabled = true) {
  return useQuery<PriceChangeEvent[]>({
    queryKey: changesKey(storeId),
    queryFn: () => fetchPriceChanges(storeId),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useProductSearch(storeId: string | null, term: string, enabled = true) {
  return useQuery<PricedProduct[]>({
    queryKey: productSearchKey(storeId, term),
    queryFn: () => searchPricedProducts({ storeId, term }),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useProductVariants(productId: string | null) {
  return useQuery<PricedVariant[]>({
    queryKey: variantsKey(productId),
    queryFn: () => fetchProductVariants(productId),
    enabled: Boolean(productId),
  })
}

export function useProductUoms(productId: string | null) {
  return useQuery<PricedUom[]>({
    queryKey: uomsKey(productId),
    queryFn: () => fetchProductUoms(productId),
    enabled: Boolean(productId),
  })
}

/** Solo se pide cuando hay un archivo que resolver: son miles de filas. */
export function usePricingCatalog(storeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: catalogKey(storeId),
    queryFn: () => fetchPricingCatalog(storeId),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useSaveSegment() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: saveSegment, onSuccess: invalidate })
}

export function useSavePriceList() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: savePriceList, onSuccess: invalidate })
}

export function useDeletePriceList() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: deletePriceList, onSuccess: invalidate })
}

export function useSavePriceItem() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: savePriceItem, onSuccess: invalidate })
}

export function useDeletePriceItem() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: deletePriceItem, onSuccess: invalidate })
}

export function useImportPriceItems() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: importPriceItems, onSuccess: invalidate })
}

export function useAddAssignment() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: addAssignment, onSuccess: invalidate })
}

export function useDeleteAssignment() {
  const invalidate = useInvalidatePricing()
  return useMutation({ mutationFn: deleteAssignment, onSuccess: invalidate })
}
