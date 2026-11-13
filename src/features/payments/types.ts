import { z } from 'zod'

/**
 * Tipos y esquemas del dominio de pagos en el backoffice.
 *
 * Dos reglas propias de esta pantalla, y las dos vienen de la fase:
 *
 *  1. **Los importes son TEXTO.** Vienen como `numeric` de Postgres y se
 *     formatean, nunca se suman aquí. Un total de pagos recalculado en el
 *     navegador es un segundo número que puede discrepar del que se cobró.
 *  2. **Aquí no hay ni un secreto.** Ni `secret_ref`, ni `provider_token_ref`,
 *     ni el sobre crudo del proveedor. Lo que la pantalla enseña es estado,
 *     referencia y código de resultado: exactamente lo que hace falta para
 *     llamar al banco y nada de lo que serviría para suplantar al comercio.
 */

// Los nombres de persistencia viven en `db-schema.ts` y se reexportan aquí,
// igual que hacen catálogo, precios e inventario: dos copias de un nombre de
// tabla no se separan el día que se escriben, se separan el día que una cambia.
export {
  INTEGRATION_PROVIDERS_TABLE,
  PAYMENTS_TABLE,
  PAYMENT_ATTEMPTS_TABLE,
  PAYMENT_EVENTS_TABLE,
  PAYMENT_METHODS_TABLE,
  PAYMENT_METHOD_SET_SECRET_RPC,
  PAYMENT_OVERVIEW_VIEW,
  RECONCILIATION_IMPORT_RPC,
  RECONCILIATION_MATCH_RPC,
  RECONCILIATION_TABLE,
  REFUNDS_TABLE,
  REFUND_REQUEST_RPC,
} from '@/shared/lib/db-schema'

export const PAYMENT_METHOD_KINDS = [
  'card',
  'wallet',
  'bank_transfer',
  'cash',
  'credit',
  'other',
] as const
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number]

export const INTENT_STATUSES = [
  'open',
  'processing',
  'requires_action',
  'authorized',
  'captured',
  'failed',
  'cancelled',
  'expired',
] as const
export type IntentStatus = (typeof INTENT_STATUSES)[number]

export const paymentMethodSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code: z.string(),
  kind: z.enum(PAYMENT_METHOD_KINDS),
  display_name: z.string(),
  provider_code: z.string().nullable(),
  capture_mode: z.enum(['automatic', 'manual']),
  is_active: z.boolean(),
  position: z.number(),
  instructions: z.string().nullable(),
  /** Llave PÚBLICA de la pasarela (Culqi `pk_…`). La secreta nunca se lee. */
  checkout_public_key: z.string().nullable().default(null),
  /** Hay llave secreta en Vault. Solo se sabe que existe y su pista. */
  has_secret: z.boolean().default(false),
  secret_hint: z.string().nullable().default(null),
  secret_set_at: z.string().nullable().default(null),
})
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const paymentIntentSchema = z.object({
  intent_id: z.string(),
  order_id: z.string().nullable(),
  order_number: z.string().nullable(),
  customer_email: z.string().nullable(),
  order_payment_status: z.string().nullable(),
  method_code: z.string(),
  method_name: z.string(),
  method_kind: z.enum(PAYMENT_METHOD_KINDS),
  provider_code: z.string().nullable(),
  status: z.enum(INTENT_STATUSES),
  capture_mode: z.enum(['automatic', 'manual']),
  currency: z.string(),
  amount: z.coerce.string(),
  amount_captured: z.coerce.string(),
  amount_refunded: z.coerce.string(),
  provider_reference: z.string().nullable(),
  last_error_code: z.string().nullable(),
  created_at: z.string(),
  attempt_count: z.coerce.number(),
  failed_attempt_count: z.coerce.number(),
  refund_count: z.coerce.number(),
})
export type PaymentIntent = z.infer<typeof paymentIntentSchema>

export const paymentAttemptSchema = z.object({
  id: z.string(),
  attempt_no: z.number(),
  operation: z.string(),
  status: z.enum(['pending', 'succeeded', 'declined', 'failed', 'timeout']),
  provider_reference: z.string().nullable(),
  provider_result_code: z.string().nullable(),
  error_code: z.string().nullable(),
  latency_ms: z.number().nullable(),
  created_at: z.string(),
})
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>

export const paymentEventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  source: z.enum([
    'provider_response',
    'provider_webhook',
    'browser_return',
    'operator',
    'system',
  ]),
  signature_verified: z.boolean(),
  note: z.string().nullable(),
  created_at: z.string(),
})
export type PaymentEvent = z.infer<typeof paymentEventSchema>

export const paymentSchema = z.object({
  id: z.string(),
  amount: z.coerce.string(),
  amount_refunded: z.coerce.string(),
  currency: z.string(),
  status: z.enum(['captured', 'partially_refunded', 'refunded']),
  provider_reference: z.string().nullable(),
  settlement_reference: z.string().nullable(),
  captured_at: z.string(),
})
export type Payment = z.infer<typeof paymentSchema>

export const refundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.coerce.string(),
  currency: z.string(),
  status: z.enum(['requested', 'processing', 'succeeded', 'failed', 'cancelled']),
  reason: z.string().nullable(),
  requested_email: z.string().nullable(),
  error_code: z.string().nullable(),
  created_at: z.string(),
})
export type Refund = z.infer<typeof refundSchema>

export const reconciliationSchema = z.object({
  id: z.string(),
  provider_code: z.string(),
  settlement_date: z.string(),
  external_reference: z.string(),
  gross_amount: z.coerce.string(),
  fee_amount: z.coerce.string(),
  net_amount: z.coerce.string(),
  currency: z.string(),
  status: z.enum(['unmatched', 'matched', 'discrepancy', 'ignored']),
  payment_id: z.string().nullable(),
  discrepancy_reason: z.string().nullable(),
  source_batch: z.string().nullable(),
})
export type ReconciliationRecord = z.infer<typeof reconciliationSchema>

export const reconciliationSummarySchema = z.object({
  imported: z.coerce.number(),
  duplicated: z.coerce.number(),
  matched: z.coerce.number(),
  discrepancy: z.coerce.number(),
  unmatched: z.coerce.number(),
})
export type ReconciliationSummary = z.infer<typeof reconciliationSummarySchema>

export interface PaymentMethodFormValues {
  id?: string
  code: string
  displayName: string
  kind: PaymentMethodKind
  providerCode: string
  captureMode: 'automatic' | 'manual'
  isActive: boolean
  position: number
  instructions: string
  /** Llave pública de Culqi. Vacía = sin llave. */
  publicKey: string
  /**
   * Llave secreta NUEVA tecleada en este guardado. Vacía = no se toca la que
   * hubiera. Nunca se rellena desde la base: la secreta no se lee.
   */
  secretKey: string
  /** Quitar la llave secreta guardada. */
  clearSecret: boolean
}

/**
 * Clave de idempotencia de una devolución.
 *
 * La genera el navegador —igual que la del checkout— porque tiene que
 * sobrevivir a que el operador pulse dos veces o se le corte la red a media
 * respuesta. No identifica a nadie y no autoriza nada: solo ancla la petición.
 * El formato coincide con `refunds_idem_fmt` (8 a 200 caracteres).
 */
export function newIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2).padEnd(24, '0')
  return `${prefix}-${random}`.slice(0, 200)
}
