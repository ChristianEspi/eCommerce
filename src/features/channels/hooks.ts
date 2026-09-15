import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  fetchChannelCatalogSummary,
  fetchChannels,
  saveChannel,
  setChannelActive,
  setDefaultChannel,
} from './api'
import type { Channel, ChannelCatalogCount } from './types'

/**
 * Estado de canales en el cliente.
 *
 * Todas las claves cuelgan de `CHANNELS_KEY`, y Precios lee de la MISMA
 * (`useChannels` se reexporta alli): dar de alta un canal aqui lo pone en el
 * desplegable de asignaciones sin recargar. Una escritura invalida ademas la
 * vitrina, porque el canal por defecto decide por donde vende la tienda
 * publica.
 */
export const CHANNELS_KEY = ['channels'] as const
export const channelsKey = (storeId: string | null) =>
  [...CHANNELS_KEY, 'list', storeId ?? 'none'] as const
export const channelSummaryKey = (storeId: string | null) =>
  [...CHANNELS_KEY, 'summary', storeId ?? 'none'] as const

function useInvalidateChannels() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['storefront'] })
  }
}

export function useChannels(storeId: string | null): UseQueryResult<Channel[]> {
  return useQuery({
    queryKey: channelsKey(storeId),
    queryFn: () => fetchChannels(storeId),
    enabled: Boolean(storeId),
  })
}

export function useChannelCatalogSummary(storeId: string | null): UseQueryResult<ChannelCatalogCount[]> {
  return useQuery({
    queryKey: channelSummaryKey(storeId),
    queryFn: () => fetchChannelCatalogSummary(storeId),
    enabled: Boolean(storeId),
    retry: false,
  })
}

export function useSaveChannel() {
  const invalidate = useInvalidateChannels()
  return useMutation({ mutationFn: saveChannel, onSuccess: invalidate })
}

export function useSetChannelActive() {
  const invalidate = useInvalidateChannels()
  return useMutation({ mutationFn: setChannelActive, onSuccess: invalidate })
}

export function useSetDefaultChannel() {
  const invalidate = useInvalidateChannels()
  return useMutation({ mutationFn: setDefaultChannel, onSuccess: invalidate })
}