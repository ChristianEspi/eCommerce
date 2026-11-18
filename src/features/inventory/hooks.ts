import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adjustInventory,
  commitReservation,
  deleteWarehouse,
  fetchAlerts,
  fetchLevels,
  fetchMovements,
  fetchReservations,
  fetchStockLevel,
  fetchStockVariants,
  fetchStoreWarehouses,
  fetchWarehouses,
  linkStoreWarehouse,
  releaseReservation,
  saveWarehouse,
  searchStockProducts,
  seedInventory,
  setInventoryPolicy,
  transferInventory,
  unlinkStoreWarehouse,
  type StockProduct,
  type StockVariant,
  type StoreWarehouseLink,
} from './api'
import type {
  InventoryAlert,
  InventoryMovement,
  LevelRow,
  Reservation,
  Warehouse,
} from './types'

/**
 * Estado del inventario en el cliente.
 *
 * Toda escritura invalida además el catálogo público: cambiar una existencia
 * cambia el semáforo que la vitrina enseña, y una tarjeta que siga diciendo
 * «disponible» después de un ajuste se lee como «no se guardó». Es la misma
 * razón por la que el motor de precios invalida `storefront`.
 */
export const INVENTORY_KEY = ['inventory'] as const

export const warehousesKey = () => [...INVENTORY_KEY, 'warehouses'] as const
export const storeWarehousesKey = (storeId: string | null) =>
  [...INVENTORY_KEY, 'store-warehouses', storeId] as const
export const levelsKey = (storeId: string | null, warehouseId: string | null, term: string) =>
  [...INVENTORY_KEY, 'levels', storeId, warehouseId, term] as const
export const movementsKey = (storeId: string | null, warehouseId: string | null) =>
  [...INVENTORY_KEY, 'movements', storeId, warehouseId] as const
export const reservationsKey = (storeId: string | null) =>
  [...INVENTORY_KEY, 'reservations', storeId] as const
export const alertsKey = (storeId: string | null) => [...INVENTORY_KEY, 'alerts', storeId] as const
export const stockSearchKey = (storeId: string | null, term: string) =>
  [...INVENTORY_KEY, 'product-search', storeId, term] as const
export const stockVariantsKey = (productId: string | null) =>
  [...INVENTORY_KEY, 'variants', productId] as const

function useInvalidateInventory() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['storefront'] })
  }
}

export function useWarehouses(enabled = true) {
  return useQuery<Warehouse[]>({
    queryKey: warehousesKey(),
    queryFn: fetchWarehouses,
    enabled,
  })
}

export function useStoreWarehouses(storeId: string | null) {
  return useQuery<StoreWarehouseLink[]>({
    queryKey: storeWarehousesKey(storeId),
    queryFn: () => fetchStoreWarehouses(storeId),
    enabled: Boolean(storeId),
  })
}

export function useLevels(storeId: string | null, warehouseId: string | null, term: string) {
  return useQuery<LevelRow[]>({
    queryKey: levelsKey(storeId, warehouseId, term),
    queryFn: () => fetchLevels({ storeId, warehouseId, term }),
    enabled: Boolean(storeId),
  })
}

export function useMovements(storeId: string | null, warehouseId: string | null, enabled = true) {
  return useQuery<InventoryMovement[]>({
    queryKey: movementsKey(storeId, warehouseId),
    queryFn: () => fetchMovements({ storeId, warehouseId }),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useReservations(storeId: string | null, enabled = true) {
  return useQuery<Reservation[]>({
    queryKey: reservationsKey(storeId),
    queryFn: () => fetchReservations(storeId),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useInventoryAlerts(storeId: string | null, enabled = true) {
  return useQuery<InventoryAlert[]>({
    queryKey: alertsKey(storeId),
    queryFn: () => fetchAlerts(storeId),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useStockProductSearch(storeId: string | null, term: string, enabled = true) {
  return useQuery<StockProduct[]>({
    queryKey: stockSearchKey(storeId, term),
    queryFn: () => searchStockProducts({ storeId, term }),
    enabled: Boolean(storeId) && enabled,
  })
}

export function useStockVariants(productId: string | null) {
  return useQuery<StockVariant[]>({
    queryKey: stockVariantsKey(productId),
    queryFn: () => fetchStockVariants(productId),
    enabled: Boolean(productId),
  })
}

export function useSaveWarehouse() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: saveWarehouse, onSuccess: invalidate })
}

export function useDeleteWarehouse() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: deleteWarehouse, onSuccess: invalidate })
}

export function useLinkStoreWarehouse() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: linkStoreWarehouse, onSuccess: invalidate })
}

export function useUnlinkStoreWarehouse() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: unlinkStoreWarehouse, onSuccess: invalidate })
}

export function useAdjustInventory() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: adjustInventory, onSuccess: invalidate })
}

export function useStockLevel(warehouseId: string | null, productId: string | null, variantId: string | null) {
  return useQuery({
    queryKey: [...INVENTORY_KEY, 'level', warehouseId, productId, variantId] as const,
    queryFn: () => fetchStockLevel(warehouseId!, productId!, variantId),
    enabled: Boolean(warehouseId && productId),
  })
}

export function useTransferInventory() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: transferInventory, onSuccess: invalidate })
}

export function useSetInventoryPolicy() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: setInventoryPolicy, onSuccess: invalidate })
}

export function useSeedInventory() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: seedInventory, onSuccess: invalidate })
}

export function useReleaseReservation() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: releaseReservation, onSuccess: invalidate })
}

export function useCommitReservation() {
  const invalidate = useInvalidateInventory()
  return useMutation({ mutationFn: commitReservation, onSuccess: invalidate })
}
