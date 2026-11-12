import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isForbidden, isMissingModule } from '../errors'
import { INTEGRATIONS_KEY } from '../hooks'
import {
  deleteFeed,
  deleteSource,
  fetchFeeds,
  fetchRejects,
  fetchRuns,
  fetchSources,
  runFeedNow,
  saveFeed,
  saveSource,
} from './api'
import type { FeedDraft, SourceDraft } from './types'

export const sourcesKey = () => [...INTEGRATIONS_KEY, 'sources'] as const
export const feedsKey = () => [...INTEGRATIONS_KEY, 'feeds'] as const
export const runsKey = (feedId: string) => [...INTEGRATIONS_KEY, 'runs', feedId] as const
export const rejectsKey = (runId: string) => [...INTEGRATIONS_KEY, 'rejects', runId] as const

const noRetryOnDenied = (count: number, error: unknown) =>
  !isForbidden(error) && !isMissingModule(error) && count < 1

export function useSources() {
  return useQuery({ queryKey: sourcesKey(), queryFn: fetchSources, retry: noRetryOnDenied })
}

/**
 * Los flujos se refrescan solos cada 20 s mientras la pantalla está abierta:
 * después de «Sincronizar ahora» el resultado llega en menos de un minuto y
 * obligar a recargar para verlo haría pensar que no pasó nada.
 */
export function useFeeds() {
  return useQuery({
    queryKey: feedsKey(),
    queryFn: fetchFeeds,
    retry: noRetryOnDenied,
    refetchInterval: 20_000,
  })
}

export function useRuns(feedId: string | null) {
  return useQuery({
    queryKey: runsKey(feedId ?? ''),
    queryFn: () => fetchRuns(feedId ?? ''),
    enabled: Boolean(feedId),
    refetchInterval: 15_000,
  })
}

export function useRejects(runId: string | null) {
  return useQuery({
    queryKey: rejectsKey(runId ?? ''),
    queryFn: () => fetchRejects(runId ?? ''),
    enabled: Boolean(runId),
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY })
}

export function useSaveSource() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: SourceDraft }) => saveSource(id, draft),
    onSuccess: invalidate,
  })
}

export function useDeleteSource() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => deleteSource(id), onSuccess: invalidate })
}

export function useSaveFeed() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: FeedDraft }) => saveFeed(id, draft),
    onSuccess: invalidate,
  })
}

export function useDeleteFeed() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => deleteFeed(id), onSuccess: invalidate })
}

export function useRunFeedNow() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, full }: { id: string; full: boolean }) => runFeedNow(id, full),
    onSuccess: invalidate,
  })
}
