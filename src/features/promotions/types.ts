import { z } from 'zod'
import { moneyText } from '@/shared/lib/money'

/**
 * Tipos, esquemas y reglas PURAS del motor de promociones en el backoffice.
 *
 * Tres reglas propias de esta pantalla, y las tres vienen de la fase:
 *
 *  1. **Los importes son TEXTO.** Vienen como `numeric` de Postgres y se
 *     formatean, nunca se suman aquí. Un descuento recalculado en el navegador
 *     es un segundo número que puede discrepar del que se cobró.
 *  2. **Aquí no se decide ningún descuento.** Esta capa escribe la CONFIGURACIÓN
 *     de una campaña y lee lo que el servidor calculó. La única aritmética que
 *     hay es la del formulario: comprobar que un porcentaje está entre 0 y 100
 *     antes de mandarlo, para que el error salga en el campo y no en un 400.
 *  3. **Los mensajes de validación son CLAVES de i18n**, no textos. El mismo
 *     esquema sirve en ES y EN, que es lo que P04 estableció para el formulario
 *     de precios y por lo mismo: dos copias de una regla se separan.
 */

// Los nombres de persistencia viven en `db-schema.ts` y se reexportan aquí,
// igual que hacen catálogo, precios, inventario y pagos: dos copias de un
// nombre de tabla no se separan el día que se escriben, se separan el día que
// una cambia.
export {
  COUPONS_TABLE,
  GIFT_CARDS_TABLE,
  GIFT_CARD_ADJUST_RPC,
  GIFT_CARD_CANCEL_RPC,
  GIFT_CARD_ISSUE_RPC,
  GIFT_CARD_OVERVIEW_VIEW,
  GIFT_CARD_TRANSACTIONS_TABLE,
  PROMOTIONS_TABLE,
  PROMOTION_AUDIENCES_TABLE,
  PROMOTION_EVENTS_TABLE,
  PROMOTION_OVERVIEW_VIEW,
  PROMOTION_REDEMPTIONS_TABLE,
  PROMOTION_SCOPES_TABLE,
  PROMOTION_SIMULATE_RPC,
  PROMOTION_TIERS_TABLE,
} from '@/shared/lib/db-schema'

// ---------------------------------------------------------------------------
// Vocabulario. Copia EXACTA de los enums de `20260828130000`; un test lo compara
// contra el catálogo de Postgres para que las dos listas no se separen.
// ---------------------------------------------------------------------------
export const PROMOTION_KINDS = [
  'percentage',
  'fixed_amount',
  'volume_tier',
  'x_for_y',
  'bundle',
] as const
export type PromotionKind = (typeof PROMOTION_KINDS)[number]

export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'archived'] as const
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number]

/**
 * El estado EFECTIVO que devuelve `promotion_overview`. No es el mismo eje que
 * `status`: `status` responde «¿la encendió alguien?» y esto responde «¿está
 * descontando ahora mismo?». Se derivan en la base, no aquí, para que la
 * pantalla no pueda decir una cosa distinta de la que dice el motor.
 */
export const EFFECTIVE_STATUSES = [
  'live',
  'scheduled',
  'expired',
  'exhausted',
  'draft',
  'paused',
  'archived',
] as const
export type EffectiveStatus = (typeof EFFECTIVE_STATUSES)[number]

export const SCOPE_KINDS = ['all', 'product', 'variant', 'category', 'brand'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

export const AUDIENCE_KINDS = [
  'all',
  'channel',
  'segment',
  'customer',
  'business_account',
] as const
export type AudienceKind = (typeof AUDIENCE_KINDS)[number]

export const GIFT_CARD_STATUSES = ['active', 'depleted', 'expired', 'cancelled'] as const
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number]

// ---------------------------------------------------------------------------
// Esquemas de lectura
// ---------------------------------------------------------------------------
export const promotionSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  /** Foto de la campaña. Una oferta sin imagen es un cartel de texto. */
  image_url: z.string().nullable().default(null),
  /** 2026-10-04 · Video de fondo (mudo, en bucle). Exige imagen de respaldo. */
  video_url: z.string().nullable().default(null),
  kind: z.enum(PROMOTION_KINDS),
  status: z.enum(PROMOTION_STATUSES),
  effective_status: z.enum(EFFECTIVE_STATUSES),
  priority: z.number(),
  stack_group: z.string().nullable().default(null),
  is_exclusive: z.boolean(),
  requires_coupon: z.boolean(),
  value_percent: moneyText.nullable().default(null),
  value_amount: moneyText.nullable().default(null),
  max_discount_amount: moneyText.nullable().default(null),
  buy_quantity: moneyText.nullable().default(null),
  free_quantity: moneyText.nullable().default(null),
  min_subtotal: moneyText.nullable().default(null),
  min_quantity: moneyText.nullable().default(null),
  valid_from: z.string(),
  valid_to: z.string().nullable().default(null),
  usage_limit: z.number().nullable().default(null),
  usage_limit_per_customer: z.number().nullable().default(null),
  usage_count: z.number(),
  scope_count: z.number().default(0),
  exclusion_count: z.number().default(0),
  audience_count: z.number().default(0),
  tier_count: z.number().default(0),
  coupon_count: z.number().default(0),
  redemption_count: z.number().default(0),
  discount_granted: moneyText.default('0.00'),
})
export type Promotion = z.infer<typeof promotionSchema>

export const promotionScopeSchema = z.object({
  id: z.string(),
  promotion_id: z.string(),
  scope_kind: z.enum(SCOPE_KINDS),
  product_id: z.string().nullable().default(null),
  variant_id: z.string().nullable().default(null),
  category_id: z.string().nullable().default(null),
  brand_id: z.string().nullable().default(null),
  required_quantity: moneyText.nullable().default(null),
  is_exclusion: z.boolean(),
  /**
   * Solo en un alcance de categoría: la campaña cubre también las
   * subcategorías. Apagada por defecto — una campaña guardada no puede
   * ampliarse sola a lo que alguien cuelgue mañana.
   */
  include_descendants: z.boolean().default(false),
})
export type PromotionScope = z.infer<typeof promotionScopeSchema>

export const promotionTierSchema = z.object({
  id: z.string(),
  promotion_id: z.string(),
  min_quantity: moneyText,
  discount_percent: moneyText.nullable().default(null),
  discount_amount: moneyText.nullable().default(null),
})
export type PromotionTier = z.infer<typeof promotionTierSchema>

/**
 * «Dirigida a» (2026-11-18). `all` lo admite la base y se pinta si alguien lo
 * guardó, pero no se ofrece: sin destinatarios la campaña ya vale para todos.
 */
export const TARGET_AUDIENCE_KINDS = ['channel', 'segment', 'customer', 'business_account'] as const satisfies readonly AudienceKind[]
export type TargetAudienceKind = (typeof TARGET_AUDIENCE_KINDS)[number]

export const promotionAudienceSchema = z.object({
  id: z.string(),
  promotion_id: z.string(),
  audience_kind: z.enum(AUDIENCE_KINDS),
  channel_id: z.string().nullable().default(null),
  segment_id: z.string().nullable().default(null),
  customer_id: z.string().nullable().default(null),
  business_account_id: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  account_name: z.string().nullable().default(null),
})
export type PromotionAudience = z.infer<typeof promotionAudienceSchema>

export const couponSchema = z.object({
  id: z.string(),
  promotion_id: z.string(),
  code: z.string(),
  code_normalized: z.string(),
  is_active: z.boolean(),
  valid_from: z.string().nullable().default(null),
  valid_to: z.string().nullable().default(null),
  usage_limit: z.number().nullable().default(null),
  usage_limit_per_customer: z.number().nullable().default(null),
  usage_count: z.number(),
  notes: z.string().nullable().default(null),
})
export type Coupon = z.infer<typeof couponSchema>

export const promotionEventSchema = z.object({
  id: z.string(),
  promotion_id: z.string().nullable().default(null),
  entity: z.string(),
  action: z.string(),
  promotion_status: z.string().nullable().default(null),
  actor_email: z.string().nullable().default(null),
  occurred_at: z.string(),
  before_state: z.record(z.unknown()).nullable().default(null),
  after_state: z.record(z.unknown()).nullable().default(null),
})
export type PromotionEvent = z.infer<typeof promotionEventSchema>

export const giftCardSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code_last4: z.string(),
  currency: z.string(),
  initial_amount: moneyText,
  balance: moneyText,
  status: z.enum(GIFT_CARD_STATUSES),
  effective_status: z.string(),
  issued_to_email: z.string().nullable().default(null),
  expires_at: z.string(),
  notes: z.string().nullable().default(null),
  movement_count: z.number().default(0),
  redeemed_amount: moneyText.default('0.00'),
  last_redeemed_at: z.string().nullable().default(null),
  created_at: z.string(),
})
export type GiftCard = z.infer<typeof giftCardSchema>

// ---------------------------------------------------------------------------
// Simulación (regla 9 del encargo)
// ---------------------------------------------------------------------------
export const simulationAdjustmentSchema = z.object({
  promotion_id: z.string(),
  code: z.string(),
  label: z.string(),
  kind: z.string(),
  amount: moneyText,
  coupon_code: z.string().nullable().default(null),
})

export const simulationSchema = z.object({
  currency: z.string(),
  subtotal: moneyText,
  discount_total: moneyText.default('0.00'),
  tax_total: moneyText,
  grand_total: moneyText,
  lines: z
    .array(
      z.object({
        product_id: z.string(),
        name: z.string(),
        quantity: z.union([z.string(), z.number()]).transform(Number),
        unit_price: moneyText,
        net_amount: moneyText,
        discount: moneyText.default('0'),
      }),
    )
    .default([]),
  promotions: z
    .object({
      entitled: z.boolean().default(true),
      applied: z.array(simulationAdjustmentSchema).default([]),
      skipped: z
        .array(z.object({ code: z.string(), reason: z.string() }))
        .default([]),
      coupons: z
        .array(z.object({ code: z.string(), status: z.string() }))
        .default([]),
    })
    .default({ entitled: true, applied: [], skipped: [], coupons: [] }),
})
export type Simulation = z.infer<typeof simulationSchema>

// ---------------------------------------------------------------------------
// El formulario de campaña
// ---------------------------------------------------------------------------
export interface PromotionFormValues {
  code: string
  name: string
  description: string
  /** Ruta del bucket de la tienda o URL https. `null` = sin foto. */
  imageUrl: string | null
  /** Ruta del video de fondo en el bucket de la tienda. `null` = sin video. */
  videoUrl: string | null
  kind: PromotionKind
  status: PromotionStatus
  priority: number
  stackGroup: string
  isExclusive: boolean
  requiresCoupon: boolean
  valuePercent: string
  valueAmount: string
  maxDiscountAmount: string
  buyQuantity: string
  freeQuantity: string
  minSubtotal: string
  minQuantity: string
  validFrom: string
  validTo: string
  usageLimit: string
  usageLimitPerCustomer: string
}

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/
const DECIMAL_RE = /^\d{1,12}(\.\d{1,4})?$/
const INTEGER_RE = /^\d{1,9}$/

/**
 * Validación del formulario, PURA y con mensajes que son claves de i18n.
 *
 * Lo que comprueba es exactamente lo que la base impone en
 * `promotions_kind_shape`: cada tipo de campaña necesita sus campos y no admite
 * los de los demás. Está escrito dos veces a propósito —aquí y en el CHECK— y
 * la que manda es la de la base; ésta existe para que el error salga en el
 * campo, con el foco puesto, en vez de como un 400 con un nombre de
 * restricción dentro.
 */
export function validatePromotionForm(
  values: PromotionFormValues,
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!CODE_RE.test(values.code)) errors.code = 'promotions.invalid.code'
  const name = values.name.trim()
  if (name.length < 1 || name.length > 160) errors.name = 'promotions.invalid.name'
  if (values.description.length > 2000) errors.description = 'promotions.invalid.description'
  if (!Number.isInteger(values.priority) || values.priority < 0 || values.priority > 1000) {
    errors.priority = 'promotions.invalid.priority'
  }
  if (values.stackGroup !== '' && !CODE_RE.test(values.stackGroup)) {
    errors.stackGroup = 'promotions.invalid.stackGroup'
  }

  const percent = values.valuePercent.trim()
  const amount = values.valueAmount.trim()

  if (values.kind === 'percentage') {
    if (!DECIMAL_RE.test(percent) || Number(percent) <= 0 || Number(percent) > 100) {
      errors.valuePercent = 'promotions.invalid.percent'
    }
  }
  if (values.kind === 'fixed_amount') {
    if (!DECIMAL_RE.test(amount) || Number(amount) <= 0) {
      errors.valueAmount = 'promotions.invalid.amount'
    }
  }
  if (values.kind === 'bundle') {
    const hasPercent = percent !== ''
    const hasAmount = amount !== ''
    if (hasPercent === hasAmount) {
      errors.valuePercent = 'promotions.invalid.bundleValue'
    } else if (hasPercent && (!DECIMAL_RE.test(percent) || Number(percent) <= 0 || Number(percent) > 100)) {
      errors.valuePercent = 'promotions.invalid.percent'
    } else if (hasAmount && (!DECIMAL_RE.test(amount) || Number(amount) <= 0)) {
      errors.valueAmount = 'promotions.invalid.amount'
    }
  }
  if (values.kind === 'x_for_y') {
    const buy = values.buyQuantity.trim()
    const free = values.freeQuantity.trim()
    if (!INTEGER_RE.test(buy) || Number(buy) <= 0) errors.buyQuantity = 'promotions.invalid.quantity'
    if (!INTEGER_RE.test(free) || Number(free) <= 0) {
      errors.freeQuantity = 'promotions.invalid.quantity'
    } else if (INTEGER_RE.test(buy) && Number(free) >= Number(buy)) {
      // Es el CHECK `promotions_free_below_buy`: si lo gratis es todo, el
      // precio es cero y eso no es un 3x2, es un regalo.
      errors.freeQuantity = 'promotions.invalid.freeBelowBuy'
    }
  }

  for (const [field, value] of [
    ['maxDiscountAmount', values.maxDiscountAmount],
    ['minSubtotal', values.minSubtotal],
  ] as const) {
    const raw = value.trim()
    if (raw !== '' && (!DECIMAL_RE.test(raw) || Number(raw) < 0)) {
      errors[field] = 'promotions.invalid.amount'
    }
  }
  // Un tope sobre un importe fijo no significa nada: el importe YA es el tope.
  // Es el CHECK `promotions_cap_only_percent`.
  if (
    values.maxDiscountAmount.trim() !== '' &&
    values.kind !== 'percentage' &&
    values.kind !== 'volume_tier'
  ) {
    errors.maxDiscountAmount = 'promotions.invalid.capOnlyPercent'
  }

  const minQty = values.minQuantity.trim()
  if (minQty !== '' && (!DECIMAL_RE.test(minQty) || Number(minQty) <= 0)) {
    errors.minQuantity = 'promotions.invalid.quantity'
  }

  for (const [field, value] of [
    ['usageLimit', values.usageLimit],
    ['usageLimitPerCustomer', values.usageLimitPerCustomer],
  ] as const) {
    const raw = value.trim()
    if (raw !== '' && (!INTEGER_RE.test(raw) || Number(raw) <= 0)) {
      errors[field] = 'promotions.invalid.limit'
    }
  }

  if (values.validFrom === '') {
    errors.validFrom = 'promotions.invalid.validFrom'
  } else if (values.validTo !== '' && values.validTo <= values.validFrom) {
    errors.validTo = 'promotions.invalid.period'
  }

  return errors
}

/**
 * La MISMA normalización que `coupons.code_normalized` en la base.
 *
 * Está aquí para que la pantalla pueda avisar de un duplicado antes de mandarlo
 * y para que el campo enseñe lo que de verdad se va a guardar. La autoridad
 * sigue siendo el índice único de la base: esta función previene el error, no
 * lo impide.
 */
export function normalizeCouponCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Un código de tarjeta regalo, agrupado de cuatro en cuatro para poder leerlo. */
export function formatGiftCardCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-')
}

/**
 * Cómo se resume una campaña en una fila del listado.
 *
 * Devuelve una clave de i18n y sus parámetros, nunca un texto: la misma
 * campaña tiene que leerse igual en las dos lenguas de la suite.
 */
export function promotionSummary(promotion: Promotion): {
  key: string
  params: Record<string, string>
} {
  switch (promotion.kind) {
    case 'percentage':
      return {
        key: 'promotions.summary.percentage',
        params: { value: trimDecimals(promotion.value_percent ?? '0') },
      }
    case 'fixed_amount':
      return {
        key: 'promotions.summary.fixed',
        params: { value: promotion.value_amount ?? '0.00' },
      }
    case 'volume_tier':
      return {
        key: 'promotions.summary.volume',
        params: { tiers: String(promotion.tier_count) },
      }
    case 'x_for_y':
      return {
        key: 'promotions.summary.xForY',
        params: {
          buy: trimDecimals(promotion.buy_quantity ?? '0'),
          pay: trimDecimals(
            String(Number(promotion.buy_quantity ?? 0) - Number(promotion.free_quantity ?? 0)),
          ),
        },
      }
    case 'bundle':
      return {
        key: 'promotions.summary.bundle',
        params: { items: String(promotion.scope_count) },
      }
  }
}

/** `10.0000` → `10`. Un porcentaje con cuatro decimales de cola no se lee. */
export function trimDecimals(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/\.?0+$/, '')
}

/**
 * ¿Esta campaña puede combinarse con otra?
 *
 * Función pura y compartida por el listado y por el simulador para que las dos
 * digan lo mismo. Devuelve la clave del texto, no el texto.
 */
export function combinationLabel(promotion: Promotion): string {
  if (promotion.is_exclusive) return 'promotions.stack.exclusive'
  if (promotion.stack_group) return 'promotions.stack.group'
  return 'promotions.stack.free'
}
