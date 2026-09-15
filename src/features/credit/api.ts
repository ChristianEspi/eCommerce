import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { CreditError, creditErrorFromDb } from './errors'
import {
  AR_APPLICATIONS_TABLE,
  AR_DOCUMENTS_TABLE,
  AR_RECEIPTS_TABLE,
  CUSTOMER_AGING_RPC,
  INVOICES_TABLE,
  INVOICE_ISSUE_STATUS_VIEW,
  INVOICE_REQUEST_ISSUE_RPC,
  agingSchema,
  arDocumentSchema,
  arReceiptSchema,
  invoiceIssueResultSchema,
  invoiceIssueStatusSchema,
  invoiceSchema,
  type Aging,
  type ArDocument,
  type ArReceipt,
  type Invoice,
  type InvoiceIssueResult,
  type InvoiceIssueStatus,
  type ReceiptFormValues,
} from './types'

/**
 * Acceso a crédito y cobranza.
 *
 * Los importes salen de la base como TEXTO (`::text` en el select) y así
 * viajan hasta la pantalla. Es la regla del repositorio desde P02: en cuanto un
 * importe pasa por el `number` de JavaScript, `0.1 + 0.2` deja de ser `0.3` y
 * una conciliación de doscientas facturas descuadra por céntimos que nadie
 * encuentra.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new CreditError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export interface CreditScope {
  organizationId: string
  companyId: string
}

/**
 * Aplana la relación anidada que PostgREST devuelve como array.
 *
 * PostgREST tipa la relación anidada como ARRAY aunque la FK sea a uno: el tipo
 * generado no distingue «uno» de «muchos». Se toma el primero en vez de forzar
 * la forma con un `as`, que sería mentirle al compilador sobre lo que llega.
 */
function conCliente(row: unknown) {
  const { customers, ...resto } = row as Record<string, unknown> & {
    customers?: { code?: string; name?: string }[] | { code?: string; name?: string } | null
  }
  const cliente = Array.isArray(customers) ? customers[0] : customers
  return { ...resto, customer_code: cliente?.code ?? null, customer_name: cliente?.name ?? null }
}

// ---------------------------------------------------------------------------
// Documentos por cobrar
// ---------------------------------------------------------------------------

const DOC_SELECT =
  'id, customer_id, order_id, kind, document_number, currency, issued_at, due_at, ' +
  'amount::text, balance::text, customers(code, name)'

export async function fetchArDocuments(options: { onlyOpen: boolean }): Promise<ArDocument[]> {
  let query = client().from(AR_DOCUMENTS_TABLE).select(DOC_SELECT).order('due_at')
  // Lo pendiente primero y por defecto: quien abre cobranza viene a cobrar, no
  // a leer el histórico de lo ya pagado.
  if (options.onlyOpen) query = query.gt('balance', 0)

  const { data, error } = await query
  if (error) throw creditErrorFromDb(error)
  return arDocumentSchema.array().parse((data ?? []).map(conCliente))
}

export async function fetchAging(customerId: string | null): Promise<Aging | null> {
  if (!customerId) return null
  const { data, error } = await client().rpc(CUSTOMER_AGING_RPC, { p_customer: customerId })
  if (error) throw creditErrorFromDb(error)
  return agingSchema.parse(data)
}

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

const RECEIPT_SELECT =
  'id, customer_id, receipt_number, currency, received_at, amount::text, method, ' +
  'reference, customers(name)'

export async function fetchArReceipts(): Promise<ArReceipt[]> {
  const { data, error } = await client()
    .from(AR_RECEIPTS_TABLE)
    .select(RECEIPT_SELECT)
    .order('received_at', { ascending: false })

  if (error) throw creditErrorFromDb(error)
  return arReceiptSchema.array().parse((data ?? []).map(conCliente))
}

/**
 * Registra el cobro y lo aplica a los documentos elegidos.
 *
 * Son dos escrituras y no una transacción, porque PostgREST no las ofrece. El
 * orden importa: primero el recibo, después las aplicaciones. Si la segunda
 * falla, queda un cobro **sin aplicar** —visible, corregible, y con el saldo de
 * las facturas intacto—; al revés quedaría una aplicación huérfana que sí
 * habría movido saldos. Entre dos formas de fallar, se elige la que no miente
 * sobre lo que se debe.
 */
export async function registerReceipt(input: {
  scope: CreditScope
  customerId: string
  currency: string
  values: ReceiptFormValues
  applications: { documentId: string; amount: string }[]
}): Promise<void> {
  const supabase = client()

  const { data, error } = await supabase
    .from(AR_RECEIPTS_TABLE)
    .insert({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      customer_id: input.customerId,
      receipt_number: input.values.receipt_number.trim(),
      currency: input.currency,
      received_at: input.values.received_at,
      amount: input.values.amount,
      method: nullable(input.values.method),
      reference: nullable(input.values.reference),
    })
    .select('id')
    .single()

  if (error) throw creditErrorFromDb(error)
  if (input.applications.length === 0) return

  const { error: applyError } = await supabase.from(AR_APPLICATIONS_TABLE).insert(
    input.applications.map((app) => ({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      receipt_id: (data as { id: string }).id,
      document_id: app.documentId,
      amount: app.amount,
    })),
  )

  if (applyError) throw creditErrorFromDb(applyError)
}

// ---------------------------------------------------------------------------
// Comprobantes
// ---------------------------------------------------------------------------

const INVOICE_SELECT =
  'id, order_id, series, number, status, currency, issued_at, customer_name, ' +
  'customer_tax_id, net_total::text, tax_total::text, gross_total::text, reject_reason'

export async function fetchInvoices(): Promise<Invoice[]> {
  const { data, error } = await client()
    .from(INVOICES_TABLE)
    .select(INVOICE_SELECT)
    .order('issued_at', { ascending: false })

  if (error) throw creditErrorFromDb(error)
  return invoiceSchema.array().parse(data ?? [])
}

/** Estado de emisión de cada comprobante visible. La RLS pone el tenant. */
export async function fetchInvoiceIssueStatuses(): Promise<InvoiceIssueStatus[]> {
  const { data, error } = await client()
    .from(INVOICE_ISSUE_STATUS_VIEW)
    .select('invoice_id, issue_state, blocked_code')

  if (error) throw creditErrorFromDb(error)
  return invoiceIssueStatusSchema.array().parse(data ?? [])
}

/**
 * Pide emitir el comprobante. Solo viaja el id: la sociedad la toma la base de
 * la fila, y sin proveedor fiscal la respuesta es `pending_configuration`, no
 * un error.
 */
export async function requestInvoiceIssue(invoiceId: string): Promise<InvoiceIssueResult> {
  const { data, error } = await client().rpc(INVOICE_REQUEST_ISSUE_RPC, {
    p_invoice_id: invoiceId,
  })
  if (error) throw creditErrorFromDb(error)
  return invoiceIssueResultSchema.parse(data)
}
