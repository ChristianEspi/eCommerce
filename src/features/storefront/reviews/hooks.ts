import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyReview, fetchProductReviews, submitReview, type OwnReview, type ReviewPage } from './api'

/**
 * Estado de las reseñas en la ficha. Las claves cuelgan de la tienda y el
 * producto: una reseña enviada invalida SU producto y nada más.
 */
export const reviewsKey = (storeSlug: string, productId: string) =>
  ['storefront', 'reviews', storeSlug, productId] as const
export const myReviewKey = (storeSlug: string, productId: string, userId: string) =>
  ['storefront', 'my-review', storeSlug, productId, userId] as const

export function useProductReviews(storeSlug: string, productId: string | null, page: number) {
  return useQuery<ReviewPage>({
    queryKey: [...reviewsKey(storeSlug, productId ?? ''), page],
    queryFn: () => fetchProductReviews({ storeSlug, productId: productId as string, page }),
    enabled: Boolean(storeSlug && productId),
    // Al pasar de página la lista anterior se queda hasta que llega la nueva:
    // sin esto la sección se vacía y la página salta hacia arriba.
    placeholderData: keepPreviousData,
    retry: false,
  })
}

/** La reseña propia. Solo con sesión: sin ella no hay «propia» que pedir. */
export function useMyReview(storeSlug: string, productId: string | null, userId: string | null) {
  return useQuery<OwnReview | null>({
    queryKey: myReviewKey(storeSlug, productId ?? '', userId ?? ''),
    queryFn: () => fetchMyReview(storeSlug, productId as string),
    enabled: Boolean(storeSlug && productId && userId),
    retry: false,
  })
}

export function useSubmitReview(storeSlug: string, productId: string, userId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitReview,
    onSuccess: (review) => {
      queryClient.setQueryData(myReviewKey(storeSlug, productId, userId ?? ''), review)
      // La lista pública no cambia hasta que se modere, pero si la reseña
      // estaba publicada y se editó, deja de estarlo: se vuelve a leer.
      void queryClient.invalidateQueries({ queryKey: reviewsKey(storeSlug, productId) })
    },
  })
}
