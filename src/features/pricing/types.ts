import { z } from 'zod'
import { moneyText } from '@/shared/lib/money'

/**
 * Vocabulario del motor de precios en el cliente.
 *
 * Todo el dinero entra y sale como TEXTO decimal (`moneyText`): un `numeric`
 * de Postgres convertido a `number` por `JSON.parse` pierde céntimos, y aquí se
 * manejan listas enteras de precios.
 *
 * Este archivo NO decide ningún precio. La resolución vive en el servidor
 * (`ebim.resolve_prices`); lo que hay aquí son las formas que viajan y las
 * reglas de PRESENTACIÓN —cómo se ordena una precedencia para explicarla, cómo
 * se lee un CSV— que no mueven dinero.
 */

export {
  CUSTOMER_SEGMENTS_TABLE,
  PRICE_LISTS_TABLE,
  PRICE_LIST_ITEMS_TABLE,
  PRICE_LIST_ASSIGNMENTS_TABLE,
  PRICE_CHANGE_EVENTS_TABLE,
  CHANNELS_TABLE,
  PRODUCTS_TABLE,
  PRODUCT_VARIANTS_TABLE,
  PRODUCT_UOMS_TABLE,
  UNITS_OF_MEASURE_TABLE,
  PRICE_QUOTE_RPC,
  PRICE_QUOTE_PUBLIC_RPC,
  PROMOTION_QUOTE_PUBLIC_RPC,
  PRICE_LIST_CONFLICTS_RPC,
} from '@/shared/lib/db-schema'

// ---------------------------------------------------------------------------
// Alcances
// ---------------------------------------------------------------------------

/**
 * Los cuatro alcances, del más específico al más general. El ORDEN de esta
 * constante es la precedencia, y no es configurable: está escrito igual en
 * `ebim.active_price_lists`. Un test compara las dos copias.
 */
export const PRICE_SCOPES = ['customer', 'segment', 'channel', 'store'] as const
export type PriceScope = (typeof PRICE_SCOPES)[number]

/** Rango numérico del alcance. Mayor = más específico = gana. */
export const SCOPE_RANK: Record<PriceScope, number> = {
  customer: 40,
  segment: 30,
  channel: 20,
  store: 10,
}

export function scopeRank(scope: PriceScope): number {
  return SCOPE_RANK[scope]
}

/**
 * Ordena una lista de acuerdos como los ordena el motor: especificidad,
 * prioridad, vigencia más reciente y, al final, el id.
 *
 * Existe para EXPLICAR, no para decidir: la pantalla enseña en qué orden se
 * mirarían las listas de un canal. Si esta función y el `order by` de
 * `ebim.resolve_prices` se separaran, lo que se rompería es la explicación, no
 * el cobro — el cobro solo lo decide el servidor.
 */
export function comparePrecedence(
  a: { scope: PriceScope; priority: number; valid_from: string; price_list_id: string },
  b: { scope: PriceScope; priority: number; valid_from: string; price_list_id: string },
): number {
  if (a.scope !== b.scope) return scopeRank(b.scope) - scopeRank(a.scope)
  if (a.priority !== b.priority) return b.priority - a.priority
  if (a.valid_from !== b.valid_from) return a.valid_from < b.valid_from ? 1 : -1
  return a.price_list_id.localeCompare(b.price_list_id)
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export const customerSegmentSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  is_active: z.boolean(),
})
export type CustomerSegment = z.infer<typeof customerSegmentSchema>

export const priceListSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().length(3),
  priority: z.number().int(),
  valid_from: z.string(),
  valid_to: z.string().nullable().default(null),
  is_active: z.boolean(),
  notes: z.string().nullable().default(null),
})
export type PriceList = z.infer<typeof priceListSchema>

/**
 * Estado de vigencia de una lista, para la etiqueta del listado.
 *
 * Se calcula en el cliente y NO decide nada: quien decide es
 * `ebim.resolve_prices`, comparando contra el reloj del SERVIDOR. Aquí solo
 * sirve para que quien mira la tabla vea de un vistazo cuál está viva — si el
 * reloj del navegador va cinco minutos adelantado, lo que se ve mal es una
 * etiqueta, no un precio.
 */
export const VALIDITY_STATES = ['active', 'scheduled', 'expired', 'off'] as const
export type Validity = (typeof VALIDITY_STATES)[number]

export function validityOf(list: PriceList, now = new Date()): Validity {
  if (!list.is_active) return 'off'
  if (new Date(list.valid_from) > now) return 'scheduled'
  if (list.valid_to && new Date(list.valid_to) <= now) return 'expired'
  return 'active'
}

export const priceListItemSchema = z.object({
  id: z.string().uuid(),
  price_list_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  uom_id: z.string().uuid().nullable().default(null),
  min_quantity: moneyText,
  unit_price: moneyText,
  compare_at_price: moneyText.nullable().default(null),
})
export type PriceListItem = z.infer<typeof priceListItemSchema>

export const priceListAssignmentSchema = z.object({
  id: z.string().uuid(),
  price_list_id: z.string().uuid(),
  scope: z.enum(PRICE_SCOPES),
  channel_id: z.string().uuid().nullable().default(null),
  segment_id: z.string().uuid().nullable().default(null),
  customer_id: z.string().uuid().nullable().default(null),
  is_active: z.boolean(),
})
export type PriceListAssignment = z.infer<typeof priceListAssignmentSchema>

export const channelOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['b2c', 'b2b', 'internal']),
  is_default: z.boolean(),
  is_active: z.boolean(),
})
export type ChannelOption = z.infer<typeof channelOptionSchema>

export const priceChangeEventSchema = z.object({
  id: z.string().uuid(),
  price_list_id: z.string().uuid().nullable().default(null),
  product_id: z.string().uuid().nullable().default(null),
  action: z.enum(['insert', 'update', 'delete']),
  old_unit_price: moneyText.nullable().default(null),
  new_unit_price: moneyText.nullable().default(null),
  actor_email: z.string().nullable().default(null),
  occurred_at: z.string(),
})
export type PriceChangeEvent = z.infer<typeof priceChangeEventSchema>

/** Fila de `public.price_list_conflicts`. */
export const CONFLICT_KINDS = [
  'ambiguous_priority',
  'currency_mismatch',
  'expired',
  'unassigned',
  'empty',
] as const
export type ConflictKind = (typeof CONFLICT_KINDS)[number]

export const priceConflictSchema = z.object({
  kind: z.enum(CONFLICT_KINDS),
  price_list_id: z.string().uuid().nullable().default(null),
  price_list_code: z.string().nullable().default(null),
  other_list_id: z.string().uuid().nullable().default(null),
  other_list_code: z.string().nullable().default(null),
  scope: z.string().nullable().default(null),
  detail: z.string().nullable().default(null),
})
export type PriceConflict = z.infer<typeof priceConflictSchema>

/** Un conflicto ambiguo rompe el precio; los otros solo lo dejan sin efecto. */
export function conflictSeverity(kind: ConflictKind): 'error' | 'warning' {
  return kind === 'ambiguous_priority' ? 'error' : 'warning'
}

// ---------------------------------------------------------------------------
// Catálogo mínimo para tarifar: SKU, variante y presentación
// ---------------------------------------------------------------------------

export const pricedProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['simple', 'variant', 'bundle']).default('simple'),
})
export type PricedProduct = z.infer<typeof pricedProductSchema>

export const pricedVariantSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  sku: z.string().min(1),
  name: z.string().min(1),
})
export type PricedVariant = z.infer<typeof pricedVariantSchema>

export const pricedUomSchema = z.object({
  uom_id: z.string().uuid(),
  product_id: z.string().uuid(),
  code: z.string().min(1),
  factor: moneyText,
})
export type PricedUom = z.infer<typeof pricedUomSchema>

// ---------------------------------------------------------------------------
// Cotización (misma forma que devuelve `ebim.build_quote`)
// ---------------------------------------------------------------------------

export const quoteLineSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  name: z.string().min(1),
  uom_code: z.string().nullable().default(null),
  quantity: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  unit_price: moneyText,
  compare_at_price: moneyText.nullable().default(null),
  net_amount: moneyText,
  tax_rate: moneyText,
  source: z.enum(['catalog', 'price_list']),
  price_list_id: z.string().uuid().nullable().default(null),
  price_list_code: z.string().nullable().default(null),
  scope: z.enum(PRICE_SCOPES).nullable().default(null),
  min_quantity: moneyText.nullable().default(null),
})
export type QuoteLine = z.infer<typeof quoteLineSchema>

export const priceQuoteSchema = z.object({
  currency: z.string().length(3),
  channel: z.string().min(1),
  tax_inclusive: z.boolean().default(false),
  quoted_at: z.string(),
  lines: z.array(quoteLineSchema).default([]),
  subtotal: moneyText,
  tax_total: moneyText,
  grand_total: moneyText,
})
export type PriceQuoteResult = z.infer<typeof priceQuoteSchema>

/**
 * Una campaña que SÍ entró en el total.
 *
 * `ebim.apply_promotions` devuelve además las descartadas y por qué; aquí solo
 * se lee lo aplicado, que es lo que la vitrina puede nombrar sin explicarle al
 * comprador reglas que no le afectan.
 */
export const appliedPromotionSchema = z.object({
  promotion_id: z.string().uuid().nullable().default(null),
  code: z.string().nullable().default(null),
  /** Nombre de cara al comprador. En la base es `label`, no `name`. */
  label: z.string().nullable().default(null),
  /** Lo que descontó ESTA campaña. */
  amount: moneyText.nullable().default(null),
  coupon_code: z.string().nullable().default(null),
})

/**
 * La cotización CON promociones (`promotion_quote_for_slug`).
 *
 * Es la de arriba más el descuento: la función de la base devuelve
 * `p_quote || {discount_total, promotions}`, así que todo lo que ya se leía
 * sigue en su sitio. La diferencia importa —`subtotal + impuesto - descuento`—
 * porque es la identidad que usa `create_order` para cobrar.
 */
export const promotionQuoteSchema = priceQuoteSchema.extend({
  discount_total: moneyText.default('0.00'),
  promotions: z
    .object({ applied: z.array(appliedPromotionSchema).default([]) })
    .partial()
    .default({}),
})
export type PromotionQuoteResult = z.infer<typeof promotionQuoteSchema>

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

const codeField = z
  .string()
  .trim()
  .min(1, 'pricing.error.code')
  .max(41, 'pricing.error.code')
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'pricing.error.code')

const decimalField = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,6})?$/, 'pricing.error.amount')

export const priceListFormSchema = z
  .object({
    code: codeField,
    name: z.string().trim().min(1, 'pricing.error.name').max(120, 'pricing.error.name'),
    currency: z.string().trim().length(3, 'pricing.error.currency'),
    priority: z.coerce.number().int().min(0, 'pricing.error.priority').max(1000, 'pricing.error.priority'),
    /** `datetime-local` sin zona: se envía tal cual y Postgres lo interpreta. */
    valid_from: z.string().trim().min(1, 'pricing.error.validFrom'),
    valid_to: z.string().trim(),
    is_active: z.boolean(),
    notes: z.string().trim().max(1000, 'pricing.error.notes'),
  })
  // La base lo rechaza igual; comprobarlo aquí evita que el usuario descubra
  // por un error de Postgres que escribió las fechas al revés.
  .refine((values) => !values.valid_to || values.valid_to > values.valid_from, {
    path: ['valid_to'],
    message: 'pricing.error.period',
  })
export type PriceListFormValues = z.infer<typeof priceListFormSchema>

export function priceListToForm(list: PriceList | null): PriceListFormValues {
  return {
    code: list?.code ?? '',
    name: list?.name ?? '',
    currency: list?.currency ?? '',
    priority: list?.priority ?? 0,
    valid_from: toLocalInput(list?.valid_from) || toLocalInput(new Date().toISOString()),
    valid_to: toLocalInput(list?.valid_to ?? null),
    is_active: list?.is_active ?? true,
    notes: list?.notes ?? '',
  }
}

/** ISO → valor de un `<input type="datetime-local">`, sin segundos. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export const priceItemFormSchema = z.object({
  product_id: z.string().uuid('pricing.error.product'),
  variant_id: z.string(),
  uom_id: z.string(),
  min_quantity: decimalField,
  unit_price: decimalField,
  compare_at_price: z.string().trim(),
})
export type PriceItemFormValues = z.infer<typeof priceItemFormSchema>

export const segmentFormSchema = z.object({
  code: codeField,
  name: z.string().trim().min(1, 'pricing.error.name').max(120, 'pricing.error.name'),
  is_active: z.boolean(),
})
export type SegmentFormValues = z.infer<typeof segmentFormSchema>

export const assignmentFormSchema = z
  .object({
    scope: z.enum(PRICE_SCOPES),
    channel_id: z.string(),
    segment_id: z.string(),
    customer_id: z.string(),
  })
  .refine(
    (values) =>
      (values.scope === 'store' && true) ||
      (values.scope === 'channel' && values.channel_id.length > 0) ||
      (values.scope === 'segment' && values.segment_id.length > 0) ||
      (values.scope === 'customer' && /^[0-9a-fA-F-]{36}$/.test(values.customer_id)),
    { path: ['scope'], message: 'pricing.error.target' },
  )
export type AssignmentFormValues = z.infer<typeof assignmentFormSchema>
