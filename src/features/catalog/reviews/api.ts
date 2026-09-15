import { z } from 'zod'
import type { MessageKey } from '@/shared/i18n/messages'
import { codeFromDbError } from '@/shared/lib/appError'
import { toCsv } from '@/shared/lib/csv'
import { MODERATE_PRODUCT_REVIEW_RPC, PRODUCT_REVIEWS_TABLE, PRODUCTS_TABLE } from '@/shared/lib/db-schema'
import { catalogClient } from '../api/client'
import { CatalogError } from '../api/errors'

/**
 * Cola de moderación de reseñas (backoffice).
 *
 * ## Leer: la tabla, bajo su RLS
 *
 * `product_reviews` tiene UNA policy de lectura, la de miembros del tenant del
 * JWT (migración 20260914141000). Ninguna consulta de aquí filtra por tenant:
 * si lo hiciera, un filtro olvidado parecería seguridad y no lo sería.
 *
 * ## Decidir: la función, nunca un UPDATE
 *
 * No hay GRANT de escritura sobre la tabla. Publicar o rechazar pasa por
 * `moderate_product_review`, que comprueba el rol de catálogo, exige motivo al
 * rechazar y deja quién, cuándo y un hecho en la bitácora.
 */

export const REVIEW_STATUSES = ['pending', 'published', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

const queueRowSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  display_name: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  status: z.enum(REVIEW_STATUSES),
  verified_purchase: z.boolean(),
  rejection_reason: z.string().nullable(),
  moderated_at: z.string().nullable(),
  created_at: z.string(),
})

export interface QueueReview extends z.infer<typeof queueRowSchema> {
  readonly product_name: string | null
}

const productNameSchema = z.object({ id: z.string().uuid(), name: z.string() })

/** Techo de la cola: la moderación es de lo reciente, no un archivo histórico. */
const QUEUE_LIMIT = 500

export async function fetchReviewQueue(): Promise<QueueReview[]> {
  const { data, error } = await catalogClient()
    .from(PRODUCT_REVIEWS_TABLE)
    .select(
      'id, product_id, display_name, rating, title, body, status, verified_purchase, rejection_reason, moderated_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(QUEUE_LIMIT)
  if (error) throw reviewAdminError(codeFromDbError(error))
  const rows = queueRowSchema.array().parse(data ?? [])

  const ids = [...new Set(rows.map((row) => row.product_id))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const products = await catalogClient().from(PRODUCTS_TABLE).select('id, name').in('id', ids)
    if (products.error) throw reviewAdminError(codeFromDbError(products.error))
    for (const product of productNameSchema.array().parse(products.data ?? [])) names.set(product.id, product.name)
  }
  return rows.map((row) => ({ ...row, product_name: names.get(row.product_id) ?? null }))
}

export function reviewAdminErrorKey(code: string): MessageKey {
  switch (code) {
    case 'RESENA_NO_ENCONTRADA':
      return 'admin.reviews.error.notFound'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'admin.reviews.error.forbidden'
    case 'MOTIVO_REQUERIDO':
      return 'admin.reviews.error.reason'
    case 'SIN_CAMBIOS':
      return 'admin.reviews.error.noChanges'
    default:
      return 'admin.reviews.error.generic'
  }
}

function reviewAdminError(code: string): CatalogError {
  return new CatalogError(reviewAdminErrorKey(code), code)
}

export const REASON_MIN = 3
export const REASON_MAX = 500

export async function moderateReview(input: {
  reviewId: string
  decision: 'publish' | 'reject'
  reason?: string
}): Promise<void> {
  const { error } = await catalogClient().rpc(MODERATE_PRODUCT_REVIEW_RPC, {
    p_review_id: input.reviewId,
    p_decision: input.decision,
    p_reason: input.decision === 'reject' ? (input.reason ?? '').trim() : null,
  })
  if (error) throw reviewAdminError(codeFromDbError(error))
}

/** Búsqueda general sobre lo ya cargado: producto, autor, título o texto. */
export function filterQueue(rows: readonly QueueReview[], status: ReviewStatus, term: string): QueueReview[] {
  const needle = term.trim().toLocaleLowerCase()
  return rows.filter(
    (row) =>
      row.status === status &&
      (!needle ||
        [row.product_name, row.display_name, row.title, row.body].some((value) =>
          (value ?? '').toLocaleLowerCase().includes(needle),
        )),
  )
}

const CSV_HEADERS = ['product', 'rating', 'title', 'body', 'author', 'verified_purchase', 'status', 'created_at'] as const

export function reviewsToCsv(rows: readonly QueueReview[]): string {
  return toCsv(
    CSV_HEADERS,
    rows.map((row) => [
      row.product_name ?? row.product_id,
      String(row.rating),
      row.title ?? '',
      row.body,
      row.display_name ?? '',
      String(row.verified_purchase),
      row.status,
      row.created_at,
    ]),
  )
}
