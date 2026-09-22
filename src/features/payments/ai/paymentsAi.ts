import { PAYMENTS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { explainClient } from '@/features/ai/explain/explainAi'

export { PAYMENTS_ASSISTANT_FUNCTION }

/**
 * IA de pagos en el CLIENTE (fase 08): explica conciliación, fallos y códigos
 * técnicos. Listas cerradas — espejo de `supabase/functions/_shared/aiPayments.ts`.
 *
 * Ninguna acción escribe: revisar el cobro, consultar al proveedor, revisar la
 * captura o la conciliación, revisar una devolución, verificar el webhook.
 * Marcar como pagado, capturar, devolver o conciliar siguen siendo los
 * controles de la pantalla, con su validación en la base.
 */
export const PAYMENT_AI_SIGNALS = [
  'timeout_unknown',
  'reconciliation_discrepancy',
  'currency_mismatch',
  'refund_failed',
  'failed',
  'repeated_failures',
  'authorized_uncaptured',
  'processing_stale',
  'refund_stuck',
  'unverified_events',
  'reconciliation_unmatched',
  'requires_action_stale',
  'unsettled',
  'expired',
] as const

export const PAYMENT_AI_ACTIONS = [
  'review_intent',
  'check_provider',
  'review_capture',
  'review_reconciliation',
  'review_refund',
  'verify_webhook',
  'monitor',
] as const

export const PAYMENT_AI_TABS = ['cobros', 'medios', 'conciliacion'] as const

export const paymentsAi = explainClient(PAYMENTS_ASSISTANT_FUNCTION, {
  signals: PAYMENT_AI_SIGNALS,
  actions: PAYMENT_AI_ACTIONS,
  tabs: PAYMENT_AI_TABS,
})

export const PAYMENT_STORE_QUESTIONS = ['summary', 'reconciliation', 'errors', 'timeouts'] as const
export const PAYMENT_INTENT_QUESTIONS = ['summary', 'why', 'code'] as const

/** Notas del sistema que son marcas (no texto del proveedor). */
export const PAYMENT_NOTE_TOKENS = ['signature_ok', 'signature_missing', 'settled', 'not_settled'] as const
