import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CATALOG_KEY } from '../useProducts'
import { fetchReviewQueue, moderateReview, type QueueReview } from './api'

/**
 * La cola cuelga de `CATALOG_KEY`: cambiar de sociedad activa invalida el
 * catálogo entero, y la cola de otra sociedad no puede quedarse en pantalla.
 */
export const REVIEW_QUEUE_KEY = [...CATALOG_KEY, 'reviews'] as const

export function useReviewQueue(enabled = true) {
  return useQuery<QueueReview[]>({ queryKey: REVIEW_QUEUE_KEY, queryFn: fetchReviewQueue, enabled })
}

export function useModerateReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: moderateReview,
    // También al fallar: un SIN_CAMBIOS dice que otra persona ya decidió, y la
    // lista tiene que enseñarlo.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: REVIEW_QUEUE_KEY }),
  })
}
