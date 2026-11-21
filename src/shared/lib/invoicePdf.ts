import { z } from 'zod'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { bytesFromBase64 } from '@/shared/lib/pdf/renderPdf'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * El PDF de un comprobante para el visor (2026-11-20). Lo trae la Edge
 * Function `invoice-pdf` con la sesión de quien lo pide; la base decide si
 * puede verlo (personal de la sociedad o el comprador del pedido). Sirve igual
 * al backoffice y a «Mi cuenta».
 */
export const INVOICE_PDF_FUNCTION = 'invoice-pdf'

const responseSchema = z.object({
  filename: z.string(),
  title: z.string(),
  content_base64: z.string().min(1),
})

export class InvoicePdfError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'InvoicePdfError'
    this.code = code
  }
}

export async function fetchInvoicePdf(invoiceId: string): Promise<{ bytes: Uint8Array; filename: string; title: string }> {
  const { data, error } = await getSupabaseClient().functions.invoke<{ data: unknown }>(INVOICE_PDF_FUNCTION, {
    body: { invoice_id: invoiceId },
  })
  if (error) throw new InvoicePdfError(await codeFromInvokeError(error))
  const parsed = responseSchema.safeParse(data?.data)
  if (!parsed.success) throw new InvoicePdfError('RESPUESTA_INVALIDA')
  return { bytes: bytesFromBase64(parsed.data.content_base64), filename: parsed.data.filename, title: parsed.data.title }
}
