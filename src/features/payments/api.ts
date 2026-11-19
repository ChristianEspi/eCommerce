import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { PaymentsError, paymentsErrorFromDb } from './errors'
import {
  INTEGRATION_PROVIDERS_TABLE,
  PAYMENTS_TABLE,
  PAYMENT_ATTEMPTS_TABLE,
  PAYMENT_CONFIRM_OFFLINE_RPC,
  PAYMENT_EVENTS_TABLE,
  PAYMENT_METHODS_TABLE,
  PAYMENT_METHOD_SET_SECRET_RPC,
  PAYMENT_OVERVIEW_VIEW,
  RECONCILIATION_IMPORT_RPC,
  RECONCILIATION_MATCH_RPC,
  RECONCILIATION_TABLE,
  REFUNDS_TABLE,
  REFUND_REQUEST_RPC,
  paymentAttemptSchema,
  paymentEventSchema,
  paymentIntentSchema,
  paymentMethodSchema,
  paymentSchema,
  reconciliationSchema,
  reconciliationSummarySchema,
  refundSchema,
  type Payment,
  type PaymentAttempt,
  type PaymentEvent,
  type PaymentIntent,
  type PaymentMethod,
  type PaymentMethodFormValues,
  type ReconciliationRecord,
  type ReconciliationSummary,
  type Refund,
} from './types'

/**
 * Acceso a datos de pagos.
 *
 * Tres reglas, y las tres son consecuencia de cómo está construido el dominio:
 *
 *  1. **Ninguna consulta declara el tenant.** Ni un `eq('organization_id', …)`.
 *     La RLS decide, y las siete tablas están en `default deny`.
 *  2. **Nada de aquí escribe dinero.** No hay un solo `update` sobre
 *     `payment_intents`, `payments` ni `refunds`: no existe la policy que lo
 *     permitiría. Devolver es un `rpc`, y conciliar también. Lo único que este
 *     módulo escribe directamente son los MEDIOS de pago, que son
 *     configuración.
 *  3. **La clave de idempotencia la pone quien llama.** Va en la firma y no se
 *     genera aquí dentro: si la generara esta función, cada reintento traería
 *     una clave nueva y la idempotencia no protegería de nada.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new PaymentsError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

// ---------------------------------------------------------------------------
// Medios de pago (configuración del tenant)
// ---------------------------------------------------------------------------

const METHOD_SELECT =
  'id, store_id, code, kind, display_name, provider_code, capture_mode, is_active, position, instructions, checkout_public_key, has_secret, secret_hint, secret_set_at'

/** Pasarelas que piden llaves de la tienda en este formulario. */
export const PROVIDERS_WITH_KEYS = new Set(['culqi'])

export async function fetchPaymentMethods(storeId: string | null): Promise<PaymentMethod[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(PAYMENT_METHODS_TABLE)
    .select(METHOD_SELECT)
    .eq('store_id', storeId)
    .order('position', { ascending: true })
    .order('code', { ascending: true })
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => paymentMethodSchema.parse(row))
}

/** Conectores de pago del catálogo GLOBAL. Códigos, nunca marcas en el código. */
export async function fetchPaymentProviders(): Promise<{ code: string; name: string }[]> {
  const { data, error } = await client()
    .from(INTEGRATION_PROVIDERS_TABLE)
    .select('code, name')
    .eq('kind', 'payment')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => ({ code: String(row.code), name: String(row.name) }))
}

export interface MethodScope {
  organizationId: string
  companyId: string
  storeId: string
}

export async function savePaymentMethod(
  scope: MethodScope,
  values: PaymentMethodFormValues,
): Promise<void> {
  const payload = {
    code: values.code.trim().toLowerCase(),
    display_name: values.displayName.trim(),
    kind: values.kind,
    // Sin pasarela, la captura la confirma una persona: la base lo exige con un
    // CHECK y la pantalla no puede ofrecer una combinación que se va a rechazar.
    provider_code: values.providerCode === '' ? null : values.providerCode,
    capture_mode: values.providerCode === '' ? 'manual' : values.captureMode,
    is_active: values.isActive,
    position: values.position,
    instructions: values.instructions.trim() === '' ? null : values.instructions.trim(),
    // La pública viaja con el medio (la base valida el formato `pk_`).
    checkout_public_key: PROVIDERS_WITH_KEYS.has(values.providerCode)
      ? values.publicKey.trim() || null
      : null,
  }

  let id = values.id ?? null
  if (id) {
    const { error } = await client().from(PAYMENT_METHODS_TABLE).update(payload).eq('id', id)
    if (error) throw paymentsErrorFromDb(error)
  } else {
    // El tenant se escribe porque las columnas son NOT NULL, pero sale del
    // contexto derivado del JWT y quien decide si vale es la policy de `insert`.
    const { data, error } = await client()
      .from(PAYMENT_METHODS_TABLE)
      .insert({
        ...payload,
        organization_id: scope.organizationId,
        company_id: scope.companyId,
        store_id: scope.storeId,
      })
      .select('id')
      .single()
    if (error) throw paymentsErrorFromDb(error)
    id = String((data as { id: unknown }).id)
  }

  // La SECRETA no se escribe en la tabla: va a Vault por la función, y solo si
  // se tecleó una nueva (o se pidió quitarla). La pantalla nunca la lee.
  if (PROVIDERS_WITH_KEYS.has(values.providerCode)) {
    const secret = values.secretKey.trim()
    if (secret !== '' || values.clearSecret) {
      await setPaymentMethodSecret(id, values.clearSecret ? null : secret)
    }
  }
}

/** Guarda (o quita, con `null`) la llave secreta del medio en Vault. */
export async function setPaymentMethodSecret(methodId: string, secret: string | null): Promise<void> {
  const { error } = await client().rpc(PAYMENT_METHOD_SET_SECRET_RPC, {
    p_method_id: methodId,
    p_secret: secret ?? '',
  })
  if (error) throw paymentsErrorFromDb(error)
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { error } = await client().from(PAYMENT_METHODS_TABLE).delete().eq('id', id)
  if (error) throw paymentsErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

const INTENT_SELECT =
  'intent_id, order_id, order_number, customer_email, order_payment_status, method_code, ' +
  'method_name, method_kind, provider_code, status, capture_mode, currency, amount, ' +
  'amount_captured, amount_refunded, provider_reference, last_error_code, created_at, ' +
  'attempt_count, failed_attempt_count, refund_count'

export interface IntentFilter {
  storeId: string | null
  status: string
  term: string
}

export async function fetchPaymentIntents(filter: IntentFilter): Promise<PaymentIntent[]> {
  if (!filter.storeId) return []
  let query = client()
    .from(PAYMENT_OVERVIEW_VIEW)
    .select(INTENT_SELECT)
    .eq('store_id', filter.storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (filter.status !== '') query = query.eq('status', filter.status)

  const term = filter.term.trim()
  if (term !== '') {
    // Un solo buscador general (regla de suite §8): número de pedido, correo o
    // referencia del proveedor. `%` y `,` se escapan porque `or` los interpreta.
    const safe = term.replace(/[%,()]/g, ' ')
    query = query.or(
      `order_number.ilike.%${safe}%,customer_email.ilike.%${safe}%,provider_reference.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => paymentIntentSchema.parse(row))
}

export async function fetchPaymentAttempts(intentId: string | null): Promise<PaymentAttempt[]> {
  if (!intentId) return []
  const { data, error } = await client()
    .from(PAYMENT_ATTEMPTS_TABLE)
    .select(
      'id, attempt_no, operation, status, provider_reference, provider_result_code, error_code, latency_ms, created_at',
    )
    .eq('payment_intent_id', intentId)
    .order('attempt_no', { ascending: true })
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => paymentAttemptSchema.parse(row))
}

export async function fetchPaymentEvents(intentId: string | null): Promise<PaymentEvent[]> {
  if (!intentId) return []
  const { data, error } = await client()
    .from(PAYMENT_EVENTS_TABLE)
    // Sin `payload`: el sobre del proveedor no se pinta. Está redactado en la
    // base, pero enseñarlo entero convertiría la pantalla en un visor de
    // integraciones y no en una de cobros.
    .select('id, event_type, source, signature_verified, note, created_at')
    .eq('payment_intent_id', intentId)
    .order('created_at', { ascending: true })
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => paymentEventSchema.parse(row))
}

export async function fetchPaymentsOf(intentId: string | null): Promise<Payment[]> {
  if (!intentId) return []
  const { data, error } = await client()
    .from(PAYMENTS_TABLE)
    .select(
      'id, amount, amount_refunded, currency, status, provider_reference, settlement_reference, captured_at',
    )
    .eq('payment_intent_id', intentId)
    .order('captured_at', { ascending: true })
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => paymentSchema.parse(row))
}

export async function fetchRefundsOf(paymentIds: readonly string[]): Promise<Refund[]> {
  if (paymentIds.length === 0) return []
  const { data, error } = await client()
    .from(REFUNDS_TABLE)
    .select(
      'id, payment_id, amount, currency, status, reason, requested_email, error_code, created_at',
    )
    .in('payment_id', [...paymentIds])
    .order('created_at', { ascending: true })
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => refundSchema.parse(row))
}

export interface RefundRequestInput {
  paymentId: string
  amount: string
  reason: string
  idempotencyKey: string
}

export async function requestRefund(input: RefundRequestInput): Promise<void> {
  const { error } = await client().rpc(REFUND_REQUEST_RPC, {
    p_payment_id: input.paymentId,
    p_amount: input.amount,
    p_idempotency_key: input.idempotencyKey,
    p_reason: input.reason.trim() === '' ? null : input.reason.trim(),
  })
  if (error) throw paymentsErrorFromDb(error)
}

export interface ConfirmOfflineInput {
  intentId: string
  reference: string
  note: string
}

/**
 * 2026-11-17 · Confirmar que el dinero de un medio SIN pasarela llegó. La base
 * escribe el cobro, pone el pedido en pagado y deja quién lo confirmó; una
 * segunda pulsación no cobra dos veces.
 */
export async function confirmOfflinePayment(input: ConfirmOfflineInput): Promise<void> {
  const reference = input.reference.trim()
  const note = input.note.trim()
  const { error } = await client().rpc(PAYMENT_CONFIRM_OFFLINE_RPC, {
    p_intent_id: input.intentId,
    p_reference: reference === '' ? null : reference,
    p_note: note === '' ? null : note,
  })
  if (error) throw paymentsErrorFromDb(error)
}

/** Lo que una persona puede confirmar: sin pasarela y sin cobrar todavía. */
export function canConfirmOffline(intent: {
  provider_code: string | null
  capture_mode: string
  status: string
}): boolean {
  return (
    intent.provider_code === null &&
    intent.capture_mode === 'manual' &&
    ['open', 'processing', 'requires_action', 'authorized'].includes(intent.status)
  )
}

// ---------------------------------------------------------------------------
// Conciliación
// ---------------------------------------------------------------------------

export async function fetchReconciliation(status: string): Promise<ReconciliationRecord[]> {
  let query = client()
    .from(RECONCILIATION_TABLE)
    .select(
      'id, provider_code, settlement_date, external_reference, gross_amount, fee_amount, ' +
        'net_amount, currency, status, payment_id, discrepancy_reason, source_batch',
    )
    .order('settlement_date', { ascending: false })
    .limit(300)
  if (status !== '') query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw paymentsErrorFromDb(error)
  return (data ?? []).map((row) => reconciliationSchema.parse(row))
}

export interface StatementRow {
  settlement_date: string
  external_reference: string
  gross_amount: string
  fee_amount?: string
  net_amount?: string
  currency: string
  source_batch?: string
}

export async function importReconciliation(
  providerCode: string,
  rows: readonly StatementRow[],
): Promise<ReconciliationSummary> {
  const { data, error } = await client().rpc(RECONCILIATION_IMPORT_RPC, {
    p_provider_code: providerCode,
    p_rows: rows,
  })
  if (error) throw paymentsErrorFromDb(error)
  return reconciliationSummarySchema.parse(data ?? {})
}

export async function matchReconciliation(recordId: string, paymentId: string): Promise<void> {
  const { error } = await client().rpc(RECONCILIATION_MATCH_RPC, {
    p_record_id: recordId,
    p_payment_id: paymentId,
  })
  if (error) throw paymentsErrorFromDb(error)
}
