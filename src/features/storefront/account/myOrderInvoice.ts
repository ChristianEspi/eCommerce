import { z } from 'zod'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * El comprobante de un pedido del comprador (facturación fase 4, 2026-11-20).
 *
 * `my_order_invoice` solo responde a quien compró o a un miembro activo de la
 * cuenta B2B del pedido. El PDF es el del emisor (Nubefact) y solo se acepta
 * si es https.
 */
export const MY_ORDER_INVOICE_RPC = 'my_order_invoice'

const invoiceSchema = z
  .object({
    id: z.string().uuid(),
    document_type: z.enum(['receipt', 'invoice']).catch('receipt'),
    series: z.string(),
    number: z.string().nullable(),
    status: z.enum(['pending', 'issued', 'accepted', 'rejected', 'cancelled']).catch('pending'),
    pdf_url: z
      .string()
      .nullable()
      .transform((v) => (v && v.startsWith('https://') ? v : null)),
  })
  .nullable()

export type MyOrderInvoice = z.infer<typeof invoiceSchema>

export async function fetchMyOrderInvoice(orderId: string): Promise<MyOrderInvoice> {
  const { data, error } = await getSupabaseClient().rpc(MY_ORDER_INVOICE_RPC, { p_order_id: orderId })
  if (error) throw error
  return invoiceSchema.parse(data ?? null)
}

export const myOrderInvoiceKey = (orderId: string) => ['storefront', 'my-order-invoice', orderId] as const
