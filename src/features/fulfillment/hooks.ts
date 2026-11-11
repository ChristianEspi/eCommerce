import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  assignFulfillment,
  cancelReturn,
  completeReturn,
  createFulfillment,
  decideReturn,
  deleteMethod,
  deletePickupPoint,
  deleteRate,
  deleteZone,
  fetchCarriers,
  fetchFulfillmentItems,
  fetchFulfillments,
  fetchMethods,
  fetchOrderFacts,
  fetchPickupPoints,
  fetchRates,
  fetchReturnEvents,
  fetchReturnItems,
  fetchReturnReasons,
  fetchReturns,
  fetchShipments,
  fetchTrackingEvents,
  fetchWarehouses,
  fetchZones,
  inspectReturn,
  noteTracking,
  openShipment,
  receiveReturn,
  saveMethod,
  savePickupPoint,
  saveRate,
  saveZone,
  transitionFulfillment,
  type FulfillmentCreateInput,
  type InspectLine,
  type QueueFilter,
  type StoreScope,
  openReturn,
} from './api'
import type {
  MethodFormValues,
  PickupPointFormValues,
  RateFormValues,
  ZoneFormValues,
} from './types'

/**
 * Estado del dominio logístico en el cliente.
 *
 * Toda escritura invalida el árbol entero de `fulfillment` y además
 * `storefront`: activar una zona, un método o una tarifa cambia lo que el
 * comprador ve en el checkout, y una vitrina que siga ofreciendo un método
 * retirado es peor que una que tarde un segundo más en refrescar.
 *
 * Las acciones sobre una entrega invalidan también `orders`, y esto sí es
 * distinto de lo que hace pagos: mover una entrega mueve el eje
 * `fulfillment_status` del pedido en la MISMA transacción, así que el listado
 * de pedidos abierto en otra pestaña está mostrando un dato que ya cambió.
 */
export const FULFILLMENT_KEY = ['fulfillment'] as const

export const zonesKey = (storeId: string | null) => [...FULFILLMENT_KEY, 'zones', storeId] as const
export const methodsKey = (storeId: string | null) =>
  [...FULFILLMENT_KEY, 'methods', storeId] as const
export const ratesKey = (storeId: string | null) => [...FULFILLMENT_KEY, 'rates', storeId] as const
export const pointsKey = (storeId: string | null) => [...FULFILLMENT_KEY, 'points', storeId] as const
export const carriersKey = () => [...FULFILLMENT_KEY, 'carriers'] as const
export const warehousesKey = () => [...FULFILLMENT_KEY, 'warehouses'] as const
export const queueKey = (filter: QueueFilter) =>
  [...FULFILLMENT_KEY, 'queue', filter.storeId, filter.state, filter.term] as const
export const itemsKey = (id: string | null) => [...FULFILLMENT_KEY, 'items', id] as const
export const shipmentsKey = (id: string | null) => [...FULFILLMENT_KEY, 'shipments', id] as const
export const trackingKey = (ids: readonly string[]) =>
  [...FULFILLMENT_KEY, 'tracking', [...ids].sort().join(',')] as const
export const factsKey = (orderId: string | null) => [...FULFILLMENT_KEY, 'facts', orderId] as const
export const returnsKey = (filter: QueueFilter) =>
  [...FULFILLMENT_KEY, 'returns', filter.storeId, filter.state, filter.term] as const
export const returnItemsKey = (id: string | null) =>
  [...FULFILLMENT_KEY, 'return-items', id] as const
export const returnEventsKey = (id: string | null) =>
  [...FULFILLMENT_KEY, 'return-events', id] as const
export const reasonsKey = (storeId: string | null) =>
  [...FULFILLMENT_KEY, 'reasons', storeId] as const

function useInvalidateFulfillment() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: FULFILLMENT_KEY })
    void queryClient.invalidateQueries({ queryKey: ['storefront'] })
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
  }
}

// --- Configuración ---------------------------------------------------------

export function useDeliveryZones(storeId: string | null) {
  return useQuery({
    queryKey: zonesKey(storeId),
    queryFn: () => fetchZones(storeId),
    enabled: storeId !== null,
  })
}

export function useDeliveryMethods(storeId: string | null) {
  return useQuery({
    queryKey: methodsKey(storeId),
    queryFn: () => fetchMethods(storeId),
    enabled: storeId !== null,
  })
}

export function useDeliveryRates(storeId: string | null) {
  return useQuery({
    queryKey: ratesKey(storeId),
    queryFn: () => fetchRates(storeId),
    enabled: storeId !== null,
  })
}

export function usePickupPoints(storeId: string | null) {
  return useQuery({
    queryKey: pointsKey(storeId),
    queryFn: () => fetchPickupPoints(storeId),
    enabled: storeId !== null,
  })
}

export function useCarriers() {
  return useQuery({ queryKey: carriersKey(), queryFn: fetchCarriers })
}

export function useWarehouses() {
  return useQuery({ queryKey: warehousesKey(), queryFn: fetchWarehouses })
}

export function useSaveZone(scope: StoreScope | null) {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (values: ZoneFormValues) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return saveZone(scope, values)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteZone() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({ mutationFn: deleteZone, onSuccess: invalidate })
}

export function useSaveMethod(scope: StoreScope | null) {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (values: MethodFormValues) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return saveMethod(scope, values)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteMethod() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({ mutationFn: deleteMethod, onSuccess: invalidate })
}

export function useSaveRate(scope: StoreScope | null) {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (values: RateFormValues) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return saveRate(scope, values)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteRate() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({ mutationFn: deleteRate, onSuccess: invalidate })
}

export function useSavePickupPoint(scope: StoreScope | null) {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (values: PickupPointFormValues) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return savePickupPoint(scope, values)
    },
    onSuccess: invalidate,
  })
}

export function useDeletePickupPoint() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({ mutationFn: deletePickupPoint, onSuccess: invalidate })
}

// --- Cola de preparación ---------------------------------------------------

export function useFulfillments(filter: QueueFilter) {
  return useQuery({
    queryKey: queueKey(filter),
    queryFn: () => fetchFulfillments(filter),
    enabled: filter.storeId !== null,
  })
}

export function useFulfillmentItems(id: string | null) {
  return useQuery({
    queryKey: itemsKey(id),
    queryFn: () => fetchFulfillmentItems(id),
    enabled: id !== null,
  })
}

export function useShipments(id: string | null) {
  return useQuery({
    queryKey: shipmentsKey(id),
    queryFn: () => fetchShipments(id),
    enabled: id !== null,
  })
}

export function useTrackingEvents(shipmentIds: readonly string[]) {
  return useQuery({
    queryKey: trackingKey(shipmentIds),
    queryFn: () => fetchTrackingEvents(shipmentIds),
    enabled: shipmentIds.length > 0,
  })
}

export function useOrderFacts(orderId: string | null) {
  return useQuery({
    queryKey: factsKey(orderId),
    queryFn: () => fetchOrderFacts(orderId),
    enabled: orderId !== null,
  })
}

export function useCreateFulfillment() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: FulfillmentCreateInput) => createFulfillment(input),
    onSuccess: invalidate,
  })
}

export function useTransitionFulfillment() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { fulfillmentId: string; to: string; reason: string }) =>
      transitionFulfillment(input),
    onSuccess: invalidate,
  })
}

export function useAssignFulfillment() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { fulfillmentId: string; warehouseId: string | null }) =>
      assignFulfillment(input),
    onSuccess: invalidate,
  })
}

export function useOpenShipment() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { fulfillmentId: string; idempotencyKey: string; serviceCode: string }) =>
      openShipment(input),
    onSuccess: invalidate,
  })
}

export function useNoteTracking() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { shipmentId: string; status: string; description: string }) =>
      noteTracking(input),
    onSuccess: invalidate,
  })
}

// --- Devoluciones ----------------------------------------------------------

export function useReturns(filter: QueueFilter) {
  return useQuery({
    queryKey: returnsKey(filter),
    queryFn: () => fetchReturns(filter),
    enabled: filter.storeId !== null,
  })
}

export function useReturnItems(id: string | null) {
  return useQuery({
    queryKey: returnItemsKey(id),
    queryFn: () => fetchReturnItems(id),
    enabled: id !== null,
  })
}

export function useReturnEvents(id: string | null) {
  return useQuery({
    queryKey: returnEventsKey(id),
    queryFn: () => fetchReturnEvents(id),
    enabled: id !== null,
  })
}

export function useReturnReasons(storeId: string | null) {
  return useQuery({
    queryKey: reasonsKey(storeId),
    queryFn: () => fetchReturnReasons(storeId),
    enabled: storeId !== null,
  })
}

export function useOpenReturn() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({ mutationFn: openReturn, onSuccess: invalidate })
}

export function useDecideReturn() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { returnId: string; decision: 'approve' | 'reject'; note: string }) =>
      decideReturn(input),
    onSuccess: invalidate,
  })
}

export function useReceiveReturn() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({ mutationFn: receiveReturn, onSuccess: invalidate })
}

export function useInspectReturn() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: {
      returnId: string
      lines: readonly InspectLine[]
      refundAmount: string | null
    }) => inspectReturn(input),
    onSuccess: invalidate,
  })
}

export function useCompleteReturn() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { returnId: string; resolution: string }) => completeReturn(input),
    onSuccess: invalidate,
  })
}

export function useCancelReturn() {
  const invalidate = useInvalidateFulfillment()
  return useMutation({
    mutationFn: (input: { returnId: string; reason: string }) => cancelReturn(input),
    onSuccess: invalidate,
  })
}
