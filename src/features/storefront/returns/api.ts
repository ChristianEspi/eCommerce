import { z } from 'zod'
import { RETURN_REQUEST_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { storefrontClient } from '../api'

/**
 * Devoluciones desde la página del pedido (2026-11-11 · 20261111130000).
 *
 * Las dos llamadas exigen tienda + número + token del pedido, como
 * `order_by_token`: el token ES la autorización, y el servidor no distingue
 * «no existe» de «token incorrecto». El navegador no manda ni tenant ni
 * importes; solo qué líneas, cuántas unidades y por qué.
 */
export const RETURN_OPTIONS_RPC = 'return_options_for_slug'

const itemSchema = z.object({
  order_item_id: z.string().uuid(),
  sku: z.string().nullable().default(null),
  name: z.string(),
  variant_label: z.string().nullable().default(null),
  quantity: z.coerce.number(),
  available: z.coerce.number(),
})

const reasonSchema = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string().nullable().default(null),
  requires_evidence: z.boolean().default(false),
})

const requestSchema = z.object({
  rma_number: z.string(),
  state: z.string(),
  reason_label: z.string().nullable().default(null),
  created_at: z.string(),
})

export const returnOptionsSchema = z.object({
  returnable: z.boolean(),
  reason: z.enum(['cancelled', 'not_delivered']).nullable().default(null),
  items: z.array(itemSchema).default([]),
  reasons: z.array(reasonSchema).default([]),
  requests: z.array(requestSchema).default([]),
})
export type ReturnOptions = z.infer<typeof returnOptionsSchema>

export interface OrderRef {
  storeSlug: string
  orderNumber: string
  token: string
}

export async function fetchReturnOptions(ref: OrderRef): Promise<ReturnOptions> {
  const { data, error } = await storefrontClient().rpc(RETURN_OPTIONS_RPC, {
    p_store_slug: ref.storeSlug,
    p_order_number: ref.orderNumber,
    p_token: ref.token,
  })
  if (error) throw new Error('RETURN_OPTIONS_UNAVAILABLE')
  return returnOptionsSchema.parse(data)
}

export async function requestReturn(
  ref: OrderRef & {
    reasonCode: string
    items: Array<{ order_item_id: string; quantity: number }>
    note: string
  },
): Promise<{ rma_number: string }> {
  const { data, error } = await storefrontClient().rpc(RETURN_REQUEST_PUBLIC_RPC, {
    p_store_slug: ref.storeSlug,
    p_order_number: ref.orderNumber,
    p_token: ref.token,
    p_reason_code: ref.reasonCode,
    p_items: ref.items,
    p_note: ref.note.trim() || null,
  })
  if (error) throw new Error('RETURN_REQUEST_FAILED')
  return z.object({ rma_number: z.string() }).parse(data)
}
