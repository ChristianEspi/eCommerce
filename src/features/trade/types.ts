import { z } from 'zod'

export {
  QUOTES_TABLE,
  QUOTE_ITEMS_TABLE,
  ASSORTMENTS_TABLE,
  ASSORTMENT_ITEMS_TABLE,
  ASSORTMENT_ASSIGNMENTS_TABLE,
} from '@/shared/lib/db-schema'

/**
 * Vocabulario comercial en el CLIENTE: cotizaciones y surtidos.
 *
 * Mitad de pantalla de `20260902130000_trade_quotes.sql` y
 * `20260902140000_trade_assortments.sql`. Dice que no ANTES de enviar, pero si
 * esto y la base discrepan, manda la base.
 *
 * Los importes son TEXTO, como en todo el repositorio desde P02: el céntimo no
 * pasa por el float del navegador. En una cotización importa el doble, porque
 * el total que se le enseña al cliente es el que se le va a cobrar.
 */

const money = z.string()

// ---------------------------------------------------------------------------
// Cotizaciones
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * A dónde puede ir cada estado, calcado del trigger `ebim.quote_status_guard`.
 *
 * Está aquí para que la pantalla no ofrezca un botón que la base va a rechazar,
 * no para autorizar: la autoridad es el trigger. `accepted`, `rejected` y
 * `expired` son terminales — cambiar el precio de algo que el cliente ya aceptó
 * es lo que destruye la confianza en un precio dado.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent', 'accepted', 'rejected', 'expired'],
  // De `sent` no se vuelve a borrador: el cliente ya lo vio.
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: [],
  expired: [],
}

export function nextStatuses(status: QuoteStatus): QuoteStatus[] {
  return QUOTE_TRANSITIONS[status]
}

/** Una cotización se edita solo mientras no esté cerrada (`quote_is_editable`). */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'sent'
}

export const quoteSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  sales_rep_id: z.string().uuid().nullable().default(null),
  quote_number: z.string(),
  status: z.enum(QUOTE_STATUSES).catch('draft'),
  currency: z.string(),
  issued_at: z.string(),
  valid_until: z.string(),
  subtotal: money,
  tax_total: money,
  grand_total: money,
  order_id: z.string().uuid().nullable().default(null),
  notes: z.string().nullable().default(null),
  customer_code: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
})
export type Quote = z.infer<typeof quoteSchema>

export const quoteItemSchema = z.object({
  id: z.string().uuid(),
  quote_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  uom_code: z.string().nullable().default(null),
  quantity: z.string(),
  unit_price: money,
  tax_rate: z.string().nullable().default(null),
  tax_amount: money.nullable().default(null),
  line_total: money,
  position: z.number().default(0),
  product_name: z.string().nullable().default(null),
})
export type QuoteItem = z.infer<typeof quoteItemSchema>

/** Importe positivo o cero con hasta dos decimales, en texto. */
const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'trade.error.amount')

const quantityInput = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'trade.error.quantity')
  .refine((value) => Number(value) > 0, 'trade.error.quantity')

export const quoteFormSchema = z
  .object({
    quote_number: z.string().trim().min(1, 'trade.error.number').max(60, 'trade.error.number'),
    customer_id: z.string().uuid('trade.error.customer'),
    currency: z.string().trim().length(3, 'trade.error.currency'),
    issued_at: z.string().min(1, 'trade.error.date'),
    valid_until: z.string().min(1, 'trade.error.date'),
    notes: z.string().trim().max(2000, 'trade.error.notes'),
  })
  // El mismo CHECK que la base (`quotes_valid_after_issue`). Se comprueba aquí
  // para poder señalar el CAMPO: la base solo puede decir que la fila no vale.
  .refine((values) => values.valid_until >= values.issued_at, {
    path: ['valid_until'],
    message: 'trade.error.validity',
  })
export type QuoteFormValues = z.infer<typeof quoteFormSchema>

/**
 * Número sugerido para una cotización nueva: COT-AAAAMMDD-HHMMSS. Solo
 * sugiere —se puede cambiar por el del ERP—; antes el campo nacía vacío y era
 * obligatorio, y en Clientes el código sí se sugería.
 */
export function suggestQuoteNumber(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `COT-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

export function emptyQuoteForm(currency: string): QuoteFormValues {
  const hoy = new Date()
  const dentroDeQuince = new Date(hoy)
  dentroDeQuince.setDate(dentroDeQuince.getDate() + 15)
  return {
    quote_number: '',
    customer_id: '',
    currency,
    issued_at: hoy.toISOString().slice(0, 10),
    // Quince días es el defecto del oficio, no una regla: se cambia a mano.
    valid_until: dentroDeQuince.toISOString().slice(0, 10),
    notes: '',
  }
}

export const quoteItemFormSchema = z.object({
  product_id: z.string().uuid('trade.error.product'),
  quantity: quantityInput,
  unit_price: moneyInput,
})
export type QuoteItemFormValues = z.infer<typeof quoteItemFormSchema>

export function emptyQuoteItemForm(): QuoteItemFormValues {
  return { product_id: '', quantity: '1', unit_price: '' }
}

/**
 * El total de una línea, en céntimos enteros.
 *
 * `0.1 * 3` en JavaScript no es `0.3`, y una cotización de veinte líneas con
 * ese error se firma con un total que no cuadra con la suma de sus renglones.
 */
export function lineTotal(quantity: string, unitPrice: string): string {
  const centimos = Math.round(Number(quantity) * Math.round(Number(unitPrice) * 100))
  return (centimos / 100).toFixed(2)
}

/** ¿Ya venció? Se calcula al pintar, no se lee de una columna. */
export function isExpired(validUntil: string, today = new Date()): boolean {
  return validUntil < today.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Surtidos
// ---------------------------------------------------------------------------

export const ASSORTMENT_SCOPES = ['customer', 'segment', 'territory', 'channel', 'store'] as const
export type AssortmentScope = (typeof ASSORTMENT_SCOPES)[number]

/**
 * La precedencia, calcada de `ebim.assortment_for_customer`.
 *
 * De lo particular a lo general. Vive en la base; se repite aquí SOLO para
 * ordenar la lista de asignaciones como la ordena el servidor — la pantalla
 * nunca decide cuál gana, únicamente lo enseña en el mismo orden.
 */
export const SCOPE_PRECEDENCE: Record<AssortmentScope, number> = {
  customer: 1,
  segment: 2,
  territory: 3,
  channel: 4,
  store: 5,
}

export const assortmentSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  is_allow_list: z.boolean().default(true),
  is_active: z.boolean().default(true),
})
export type Assortment = z.infer<typeof assortmentSchema>

export const assortmentItemSchema = z.object({
  id: z.string().uuid(),
  assortment_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  product_name: z.string().nullable().default(null),
  product_sku: z.string().nullable().default(null),
})
export type AssortmentItem = z.infer<typeof assortmentItemSchema>

export const assortmentFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/, 'trade.error.code'),
  name: z.string().trim().min(1, 'trade.error.name').max(120, 'trade.error.name'),
  is_allow_list: z.boolean(),
  is_active: z.boolean(),
})
export type AssortmentFormValues = z.infer<typeof assortmentFormSchema>

export function emptyAssortmentForm(): AssortmentFormValues {
  return { code: '', name: '', is_allow_list: true, is_active: true }
}

/** A quién se aplica un surtido (2026-11-16). Solo la columna del ámbito viene llena. */
export const assortmentAssignmentSchema = z.object({
  id: z.string().uuid(),
  assortment_id: z.string().uuid(),
  scope: z.enum(ASSORTMENT_SCOPES),
  channel_id: z.string().uuid().nullable().default(null),
  territory_id: z.string().uuid().nullable().default(null),
  segment_id: z.string().uuid().nullable().default(null),
  customer_id: z.string().uuid().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
})
export type AssortmentAssignment = z.infer<typeof assortmentAssignmentSchema>
