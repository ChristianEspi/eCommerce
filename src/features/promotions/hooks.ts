import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addChannelAudience,
  addScope,
  addTier,
  adjustGiftCard,
  cancelGiftCard,
  createCoupon,
  createPromotion,
  deleteCoupon,
  deletePromotion,
  fetchCoupons,
  fetchGiftCardMovements,
  fetchGiftCards,
  fetchPromotionEvents,
  fetchPromotions,
  fetchScopeVariants,
  fetchScopes,
  searchScopeTargets,
  fetchTiers,
  issueGiftCard,
  removeScope,
  removeTier,
  setCouponActive,
  setPromotionStatus,
  simulate,
  updatePromotion,
  type PromotionFilter,
  type PromotionScopeIds,
  type ScopeInput,
} from './api'
import type { PromotionFormValues, ScopeKind } from './types'

/**
 * Estado de promociones en el cliente.
 *
 * Toda escritura invalida el árbol entero de `promotions` **y** el de
 * `storefront`: encender una campaña cambia lo que el comprador ve en el
 * carrito, y una vitrina que siga enseñando el precio de ayer es peor que una
 * que tarde un segundo más en refrescar.
 *
 * Ninguna mutación toca el árbol de `orders` aunque un canje escriba en
 * `promotion_redemptions`: quien lo escribió fue la base al crear un pedido, y
 * refrescar los pedidos desde aquí sería adivinar cuándo.
 */
export const PROMOTIONS_KEY = ['promotions'] as const

export const promotionsKey = (filter: PromotionFilter) =>
  [...PROMOTIONS_KEY, 'list', filter.storeId, filter.status, filter.term] as const
export const scopesKey = (promotionId: string | null) =>
  [...PROMOTIONS_KEY, 'scopes', promotionId] as const
export const tiersKey = (promotionId: string | null) =>
  [...PROMOTIONS_KEY, 'tiers', promotionId] as const
export const couponsKey = (storeId: string | null, term: string) =>
  [...PROMOTIONS_KEY, 'coupons', storeId, term] as const
export const eventsKey = (storeId: string | null) =>
  [...PROMOTIONS_KEY, 'events', storeId] as const
export const giftCardsKey = (storeId: string | null, status: string, term: string) =>
  [...PROMOTIONS_KEY, 'gift-cards', storeId, status, term] as const
export const giftCardMovementsKey = (giftCardId: string | null) =>
  [...PROMOTIONS_KEY, 'gift-card-movements', giftCardId] as const

/**
 * Devuelve la PROMESA de las dos invalidaciones, y eso importa.
 *
 * Con `void` la mutación terminaba antes que el refresco: el panel se daba por
 * hecho mientras la lista seguía enseñando lo viejo, así que un alcance recién
 * añadido tardaba en aparecer y uno recién borrado seguía ahí. No era lentitud
 * de la red, era que nadie esperaba a la relectura.
 *
 * Devolviéndola desde `onSuccess`, react-query mantiene `isPending` hasta que
 * los datos están al día — y con eso el botón puede quedarse quieto en vez de
 * invitar a pulsarlo otra vez.
 */
function useInvalidatePromotions() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: ['storefront'] }),
    ])
}

export function usePromotions(filter: PromotionFilter) {
  return useQuery({
    queryKey: promotionsKey(filter),
    queryFn: () => fetchPromotions(filter),
    enabled: filter.storeId !== null,
  })
}

export function useSavePromotion(scope: PromotionScopeIds | null) {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: {
      id: string | null
      values: PromotionFormValues
      /** La campaña tal como estaba: sin ella se manda la foto aunque no cambie. */
      previa?: { image_url: string | null } | null
    }) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return input.id === null
        ? createPromotion(scope, input.values)
        : updatePromotion(scope, input.id, input.values, input.previa).then(
            () => input.id as string,
          )
    },
    onSuccess: invalidate,
  })
}

export function useSetPromotionStatus() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      setPromotionStatus(input.id, input.status),
    onSuccess: invalidate,
  })
}

export function useDeletePromotion() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: deletePromotion, onSuccess: invalidate })
}

export function useScopes(promotionId: string | null) {
  return useQuery({
    queryKey: scopesKey(promotionId),
    queryFn: () => fetchScopes(promotionId),
    enabled: promotionId !== null,
  })
}

/** Candidatos para el alcance: productos, categorías o marcas, según el tipo. */
export function useScopeTargets(storeId: string | null, kind: ScopeKind, term: string) {
  return useQuery({
    queryKey: [...PROMOTIONS_KEY, 'scope-targets', storeId, kind, term] as const,
    queryFn: () => searchScopeTargets({ storeId, kind, term }),
    enabled: Boolean(storeId) && kind !== 'all',
  })
}

export function useScopeVariants(productId: string | null) {
  return useQuery({
    queryKey: [...PROMOTIONS_KEY, 'scope-variants', productId] as const,
    queryFn: () => fetchScopeVariants(productId),
    enabled: productId !== null,
  })
}

export function useAddScope(scope: PromotionScopeIds | null) {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: ScopeInput) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return addScope(scope, input)
    },
    onSuccess: invalidate,
  })
}

export function useRemoveScope() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: removeScope, onSuccess: invalidate })
}

export function useTiers(promotionId: string | null) {
  return useQuery({
    queryKey: tiersKey(promotionId),
    queryFn: () => fetchTiers(promotionId),
    enabled: promotionId !== null,
  })
}

export function useAddTier(scope: PromotionScopeIds | null) {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: {
      promotionId: string
      minQuantity: string
      discountPercent: string | null
      discountAmount: string | null
    }) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return addTier(scope, input)
    },
    onSuccess: invalidate,
  })
}

export function useRemoveTier() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: removeTier, onSuccess: invalidate })
}

export function useAddChannelAudience(scope: PromotionScopeIds | null) {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: { promotionId: string; channelId: string }) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return addChannelAudience(scope, input)
    },
    onSuccess: invalidate,
  })
}

export function useCoupons(storeId: string | null, term: string) {
  return useQuery({
    queryKey: couponsKey(storeId, term),
    queryFn: () => fetchCoupons(storeId, term),
    enabled: storeId !== null,
  })
}

export function useCreateCoupon(scope: PromotionScopeIds | null) {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: {
      promotionId: string
      code: string
      validFrom: string
      validTo: string
      usageLimit: string
      usageLimitPerCustomer: string
      notes: string
    }) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return createCoupon(scope, input)
    },
    onSuccess: invalidate,
  })
}

export function useSetCouponActive() {
  const invalidate = useInvalidatePromotions()
  return useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      setCouponActive(input.id, input.isActive),
    onSuccess: invalidate,
  })
}

export function useDeleteCoupon() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: deleteCoupon, onSuccess: invalidate })
}

export function usePromotionEvents(storeId: string | null) {
  return useQuery({
    queryKey: eventsKey(storeId),
    queryFn: () => fetchPromotionEvents(storeId),
    enabled: storeId !== null,
  })
}

export function useGiftCards(storeId: string | null, status: string, term: string) {
  return useQuery({
    queryKey: giftCardsKey(storeId, status, term),
    queryFn: () => fetchGiftCards(storeId, status, term),
    enabled: storeId !== null,
  })
}

export function useGiftCardMovements(giftCardId: string | null) {
  return useQuery({
    queryKey: giftCardMovementsKey(giftCardId),
    queryFn: () => fetchGiftCardMovements(giftCardId),
    enabled: giftCardId !== null,
  })
}

export function useIssueGiftCard() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: issueGiftCard, onSuccess: invalidate })
}

export function useAdjustGiftCard() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: adjustGiftCard, onSuccess: invalidate })
}

export function useCancelGiftCard() {
  const invalidate = useInvalidatePromotions()
  return useMutation({ mutationFn: cancelGiftCard, onSuccess: invalidate })
}

/**
 * La simulación NO se cachea por defecto y se dispara a mano.
 *
 * Es una mutación y no una consulta a propósito: «¿qué pasaría con este
 * carrito?» es una pregunta que el operador hace cuando quiere, sobre datos que
 * él acaba de escribir, y refrescarla sola al volver a la pestaña daría un
 * resultado distinto sin que nadie hubiera pedido nada.
 */
export function useSimulate() {
  return useMutation({ mutationFn: simulate })
}
