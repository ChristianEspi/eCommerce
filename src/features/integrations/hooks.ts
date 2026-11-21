import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createApiClient,
  createEndpoint,
  fetchApiClients,
  fetchDeliveries,
  fetchEndpoints,
  fetchIntegrationHealth,
  fetchMessageDetail,
  fetchQueue,
  fetchSubscriptions,
  replayDelivery,
  resetCircuit,
  retryMessage,
  rotateApiClientSecret,
  setApiClientActive,
  setEndpointActive,
  updateEndpoint,
  type EndpointDraft,
  type QueueFilter,
} from './api'
import { isForbidden, isMissingModule } from './errors'

/**
 * Estado del Monitor de Integraciones.
 *
 * `retry: false` cuando el error es de PERMISO o de MÓDULO: reintentar cuatro
 * veces un 403 solo retrasa el mensaje, y aquí los dos son respuestas
 * legítimas —la cola la ven `owner` y `admin`; publicar exige el addon—.
 *
 * El detalle de un mensaje se pide de UNO en uno y solo cuando se abre, porque
 * pedirlo escribe en la bitácora: `integration_message_detail` audita cada
 * consulta. Un `useQuery` por fila del listado llenaría la auditoría de ruido y
 * dejaría de distinguir «alguien miró este mensaje» de «alguien abrió la
 * pantalla».
 */
export const INTEGRATIONS_KEY = ['integrations'] as const

export const healthKey = () => [...INTEGRATIONS_KEY, 'health'] as const
export const queueKey = (filter: QueueFilter) =>
  [...INTEGRATIONS_KEY, 'queue', filter.status, filter.term] as const
export const detailKey = (id: string) => [...INTEGRATIONS_KEY, 'detail', id] as const
export const endpointsKey = () => [...INTEGRATIONS_KEY, 'endpoints'] as const
export const subscriptionsKey = () => [...INTEGRATIONS_KEY, 'subscriptions'] as const
export const deliveriesKey = (term: string) => [...INTEGRATIONS_KEY, 'deliveries', term] as const
export const apiClientsKey = () => [...INTEGRATIONS_KEY, 'clients'] as const

const noRetryOnDenied = (count: number, error: unknown) =>
  !isForbidden(error) && !isMissingModule(error) && count < 1

export function useIntegrationHealth() {
  return useQuery({
    queryKey: healthKey(),
    queryFn: fetchIntegrationHealth,
    retry: noRetryOnDenied,
    // La salud caduca rápido: mirar una cola de hace cinco minutos durante un
    // incidente es peor que no mirarla, porque parece actual (P13).
    staleTime: 15_000,
  })
}

export function useQueue(filter: QueueFilter) {
  return useQuery({
    queryKey: queueKey(filter),
    queryFn: () => fetchQueue(filter),
    retry: noRetryOnDenied,
    staleTime: 15_000,
  })
}

export function useMessageDetail(outboxId: string | null) {
  return useQuery({
    queryKey: detailKey(outboxId ?? ''),
    queryFn: () => fetchMessageDetail(outboxId as string),
    enabled: outboxId !== null,
    retry: noRetryOnDenied,
  })
}

export function useEndpoints() {
  return useQuery({ queryKey: endpointsKey(), queryFn: fetchEndpoints, retry: noRetryOnDenied })
}

export function useSubscriptions() {
  return useQuery({
    queryKey: subscriptionsKey(),
    queryFn: fetchSubscriptions,
    retry: noRetryOnDenied,
  })
}

export function useDeliveries(term: string) {
  return useQuery({
    queryKey: deliveriesKey(term),
    queryFn: () => fetchDeliveries(term),
    retry: noRetryOnDenied,
    staleTime: 15_000,
  })
}

export function useApiClients() {
  return useQuery({ queryKey: apiClientsKey(), queryFn: fetchApiClients, retry: noRetryOnDenied })
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY })
}

export function useRetryMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => retryMessage(id, reason),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useResetCircuit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => resetCircuit(id, reason),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useReplayDelivery() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => replayDelivery(id, reason),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useCreateEndpoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: EndpointDraft) => createEndpoint(draft),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useUpdateEndpoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; draft: EndpointDraft; previousEvents: readonly string[] }) =>
      updateEndpoint(input.id, input.draft, input.previousEvents),
    // También tras un fallo: si las altas entraron y la baja no, la tabla
    // debe enseñar lo que de verdad quedó.
    onSettled: () => invalidateAll(queryClient),
  })
}

export function useSetEndpointActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setEndpointActive(id, isActive),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useCreateApiClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; scopes: string[]; description?: string }) =>
      createApiClient(input),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useRotateApiClientSecret() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rotateApiClientSecret(id),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useSetApiClientActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setApiClientActive(id, isActive),
    onSuccess: () => invalidateAll(queryClient),
  })
}
