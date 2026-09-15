import { z } from 'zod'
import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError } from '@/shared/lib/appError'
import {
  MY_PRODUCT_REVIEW_RPC,
  PRODUCT_REVIEWS_PUBLIC_RPC,
  SUBMIT_PRODUCT_REVIEW_RPC,
} from '@/shared/lib/db-schema'
import { tryGetStorefrontRpcClient } from '@/shared/lib/supabase'
import { StorefrontError, storefrontClient } from '../api'

/**
 * Reseñas en la vitrina: leer las publicadas, leer la propia y enviar.
 *
 * ## Dos clientes, a propósito
 *
 * La lista pública (`product_reviews_for_slug`) no depende de quién mira: va
 * con el cliente ANÓNIMO, el mismo que lee `public_products`. Leer la propia y
 * enviar dependen de QUIÉN es —el servidor lo saca de `ebim.user_id()`—, así
 * que van con el cliente que lleva la sesión (`tryGetStorefrontRpcClient`),
 * igual que los favoritos: con el anónimo la función se quedaría sin usuario.
 *
 * ## Lo que viaja
 *
 * Solo `rating`, `title`, `body` y `display_name`. Ni la tienda (sale del
 * slug), ni el usuario, ni el tenant, ni `verified_purchase`: la base rechaza
 * cualquier otra clave con `CAMPO_NO_PERMITIDO` y calcula la compra verificada
 * por su cuenta (migración 20260914141000).
 */

export const REVIEWS_PAGE_SIZE = 5

export const BODY_MIN = 10
export const BODY_MAX = 2000
export const TITLE_MAX = 120

const publicReviewSchema = z.object({
  review_id: z.string().uuid(),
  display_name: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  verified_purchase: z.boolean(),
  published_at: z.string(),
})
export type PublicReview = z.infer<typeof publicReviewSchema>

const reviewPageSchema = z.object({
  summary: z.object({
    count: z.number().int().min(0),
    // Texto con dos decimales, como el dinero: el redondeo lo decide la base.
    average: z.string().nullable(),
    distribution: z.record(z.string(), z.number().int().min(0)),
  }),
  reviews: z.array(publicReviewSchema),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  total: z.number().int().min(0),
})
export type ReviewPage = z.infer<typeof reviewPageSchema>

const ownReviewSchema = z.object({
  review_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  display_name: z.string().nullable(),
  status: z.enum(['pending', 'published', 'rejected']),
  verified_purchase: z.boolean(),
  rejection_reason: z.string().nullable(),
})
export type OwnReview = z.infer<typeof ownReviewSchema>

/** Error de envío con su clave de i18n ya resuelta a partir del CÓDIGO. */
export class ReviewError extends UiError {
  constructor(code: string) {
    super({ boundary: 'content', key: reviewErrorKey(code), code })
    this.name = 'ReviewError'
  }
}

export function reviewErrorKey(code: string): MessageKey {
  switch (code) {
    case 'CALIFICACION_INVALIDA':
      return 'store.reviews.error.rating'
    case 'RESENA_TEXTO_INVALIDO':
      return 'store.reviews.error.body'
    case 'NOMBRE_INVALIDO':
      return 'store.reviews.error.displayName'
    case 'RESENA_NO_PERMITIDA':
      return 'store.reviews.error.forbidden'
    case 'LIMITE_DE_TASA':
      return 'store.reviews.error.rateLimited'
    case 'PRODUCTO_NO_DISPONIBLE':
    case 'TIENDA_NO_DISPONIBLE':
      return 'store.reviews.error.unavailable'
    default:
      return 'store.reviews.error.generic'
  }
}

export async function fetchProductReviews(input: {
  storeSlug: string
  productId: string
  page: number
}): Promise<ReviewPage> {
  const { data, error } = await storefrontClient().rpc(PRODUCT_REVIEWS_PUBLIC_RPC, {
    p_store_slug: input.storeSlug,
    p_product_id: input.productId,
    p_page: input.page,
    p_page_size: REVIEWS_PAGE_SIZE,
  })
  if (error) throw new StorefrontError(error)
  return reviewPageSchema.parse(data)
}

export async function fetchMyReview(storeSlug: string, productId: string): Promise<OwnReview | null> {
  const supabase = tryGetStorefrontRpcClient()
  if (!supabase) return null
  const { data, error } = await supabase.rpc(MY_PRODUCT_REVIEW_RPC, {
    p_store_slug: storeSlug,
    p_product_id: productId,
  })
  if (error) throw new ReviewError(codeFromDbError(error))
  return data ? ownReviewSchema.parse(data) : null
}

export interface ReviewDraft {
  readonly rating: number | null
  readonly title: string
  readonly body: string
  readonly displayName: string
}

export type ReviewDraftErrors = Partial<Record<keyof ReviewDraft, MessageKey>>

const MARKUP = /<[A-Za-z/!?]/
const NAME_FORBIDDEN = /[@<>/\\:;{}0-9]/

/**
 * La misma validación que hace la base, antes de mandar nada. Función PURA.
 *
 * No es la frontera —la base vuelve a comprobarlo todo—: es lo que evita que el
 * comprador escriba dos párrafos y se entere del límite al pulsar «Enviar».
 */
export function validateReviewDraft(draft: ReviewDraft): ReviewDraftErrors {
  const errors: ReviewDraftErrors = {}
  if (draft.rating === null || !Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
    errors.rating = 'store.reviews.error.rating'
  }
  const body = draft.body.trim()
  if (body.length < BODY_MIN || body.length > BODY_MAX || MARKUP.test(body)) {
    errors.body = 'store.reviews.error.body'
  }
  const title = draft.title.trim()
  if (title.length > TITLE_MAX || MARKUP.test(title)) {
    errors.title = 'store.reviews.error.headline'
  }
  const name = draft.displayName.trim().replace(/\s+/g, ' ')
  if (name && (name.length < 2 || name.length > 40 || NAME_FORBIDDEN.test(name))) {
    errors.displayName = 'store.reviews.error.displayName'
  }
  return errors
}

export async function submitReview(input: {
  storeSlug: string
  productId: string
  draft: ReviewDraft
}): Promise<OwnReview> {
  const supabase = tryGetStorefrontRpcClient()
  if (!supabase) throw new ReviewError('CONFIG_INCOMPLETA')
  const title = input.draft.title.trim()
  const name = input.draft.displayName.trim()
  const { data, error } = await supabase.rpc(SUBMIT_PRODUCT_REVIEW_RPC, {
    p_store_slug: input.storeSlug,
    p_product_id: input.productId,
    p_review: {
      rating: input.draft.rating,
      title: title || null,
      body: input.draft.body.trim(),
      display_name: name || null,
    },
  })
  if (error) throw new ReviewError(codeFromDbError(error))
  return ownReviewSchema.parse(data)
}
