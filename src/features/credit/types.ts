import { z } from 'zod'
import type { InvoiceIssueState } from '@/domain/ports/invoicing'

export {
  AR_DOCUMENTS_TABLE,
  AR_RECEIPTS_TABLE,
  AR_APPLICATIONS_TABLE,
  INVOICES_TABLE,
  INVOICE_ITEMS_TABLE,
  INVOICE_ISSUE_STATUS_VIEW,
  INVOICE_REQUEST_ISSUE_RPC,
  CUSTOMER_AGING_RPC,
} from '@/shared/lib/db-schema'

/**
 * Vocabulario de crédito y cobranza en el CLIENTE.
 *
 * Mitad de pantalla de `20260902120000_credit_receivables.sql` y
 * `20260902210000_credit_invoices.sql`. Como en el resto del repositorio: dice
 * que no ANTES de enviar, pero si esto y la base discrepan, manda la base.
 *
 * **Todo importe es TEXTO.** No hay un solo `number` de dinero aquí. Es la regla
 * del repositorio desde P02: el céntimo no pasa por el float del navegador, y
 * una cuenta por cobrar es justo donde un céntimo perdido se convierte en una
 * conciliación que no cuadra.
 */

const money = z.string()

export const AR_DOCUMENT_KINDS = ['invoice', 'debit_note', 'credit_note'] as const
export const CREDIT_STATUSES = ['ok', 'watch', 'blocked'] as const

export const arDocumentSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  order_id: z.string().uuid().nullable().default(null),
  kind: z.enum(AR_DOCUMENT_KINDS).catch('invoice'),
  document_number: z.string(),
  currency: z.string(),
  issued_at: z.string(),
  due_at: z.string(),
  amount: money,
  balance: money,
  customer_code: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
})
export type ArDocument = z.infer<typeof arDocumentSchema>

export const arReceiptSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  receipt_number: z.string(),
  currency: z.string(),
  received_at: z.string(),
  amount: money,
  method: z.string().nullable().default(null),
  reference: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
})
export type ArReceipt = z.infer<typeof arReceiptSchema>

/** Los cinco tramos, tal y como los devuelve `ebim.customer_aging`. */
export const agingSchema = z.object({
  currency: z.string().nullable().default(null),
  total: money,
  current: money,
  due_1_30: money,
  due_31_60: money,
  due_61_90: money,
  due_over_90: money,
  overdue: money,
})
export type Aging = z.infer<typeof agingSchema>

export const INVOICE_STATUSES = ['pending', 'issued', 'accepted', 'rejected', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const invoiceSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  series: z.string(),
  number: z.string().nullable().default(null),
  status: z.enum(INVOICE_STATUSES).catch('pending'),
  currency: z.string(),
  issued_at: z.string(),
  customer_name: z.string(),
  customer_tax_id: z.string().nullable().default(null),
  net_total: money,
  tax_total: money,
  gross_total: money,
  reject_reason: z.string().nullable().default(null),
})
export type Invoice = z.infer<typeof invoiceSchema>

/**
 * Estado de EMISIÓN (vista `invoice_issue_status`, migración 20260914170000).
 * Distinto del estado fiscal del comprobante: dice si se pidió emitir y qué
 * pasó con el mensaje en la cola de integraciones.
 */
export const INVOICE_ISSUE_STATES = [
  'not_requested',
  'pending_configuration',
  'pending',
  'in_flight',
  'succeeded',
  'failed',
  'dead',
] as const satisfies readonly InvoiceIssueState[]

export const invoiceIssueStatusSchema = z.object({
  invoice_id: z.string().uuid(),
  issue_state: z.enum(INVOICE_ISSUE_STATES).catch('not_requested'),
  blocked_code: z.string().nullable().default(null),
})
export type InvoiceIssueStatus = z.infer<typeof invoiceIssueStatusSchema>

export const invoiceIssueResultSchema = z.object({
  state: z.enum(['enqueued', 'pending_configuration']),
  replay: z.boolean().catch(false),
})
export type InvoiceIssueResult = z.infer<typeof invoiceIssueResultSchema>

// ---------------------------------------------------------------------------
// El formulario del cobro
// ---------------------------------------------------------------------------

/** Importe positivo con hasta dos decimales, en texto. */
const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'credit.error.amount')
  .refine((value) => Number(value) > 0, 'credit.error.amount')

export const receiptFormSchema = z.object({
  receipt_number: z.string().trim().min(1, 'credit.error.number').max(60, 'credit.error.number'),
  amount: moneyInput,
  received_at: z.string(),
  method: z.string().trim().max(60, 'credit.error.method'),
  reference: z.string().trim().max(120, 'credit.error.reference'),
})
export type ReceiptFormValues = z.infer<typeof receiptFormSchema>

export function emptyReceiptForm(): ReceiptFormValues {
  return {
    receipt_number: '',
    amount: '',
    received_at: new Date().toISOString().slice(0, 10),
    method: '',
    reference: '',
  }
}

/**
 * ¿Está vencido, y desde cuándo?
 *
 * Se calcula sobre la fecha de vencimiento y no sobre un estado guardado,
 * porque «vencido» no es una propiedad del documento: es una propiedad del día
 * en que se mira. Guardarlo obligaría a un proceso nocturno que actualizara
 * filas, y ese proceso es exactamente lo que falla un fin de semana largo.
 */
export function daysOverdue(dueAt: string, today = new Date()): number {
  const vence = new Date(`${dueAt}T00:00:00`)
  const hoy = new Date(today.toISOString().slice(0, 10) + 'T00:00:00')
  return Math.floor((hoy.getTime() - vence.getTime()) / 86_400_000)
}

/** El tramo de antigüedad de un documento, con los cortes del oficio. */
export function agingBucket(dueAt: string, today = new Date()): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
  const dias = daysOverdue(dueAt, today)
  if (dias <= 0) return 'current'
  if (dias <= 30) return '1-30'
  if (dias <= 60) return '31-60'
  if (dias <= 90) return '61-90'
  return '90+'
}
