import { z } from 'zod'
import { moneyText } from '@/shared/lib/money'
import type { MessageKey } from '@/shared/i18n/messages'

/**
 * Vocabulario del PIM en el cliente (P03-SaaS).
 *
 * Los nombres de columna son los reales de las migraciones 170000-170200. Como
 * en el resto del catálogo, `organization_id`/`company_id` viajan en la fila
 * solo de lectura: el filtro de tenant lo aplica la RLS con los claims del
 * JWT, nunca una condición que arme el cliente.
 *
 * Los importes son TEXTO decimal (`moneyText`) y los factores de conversión
 * también: `numeric(18,6)` pasado por el float del navegador es exactamente el
 * bug que la columna evita en la base.
 */

export {
  BRANDS_TABLE,
  PRODUCT_FAMILIES_TABLE,
  ATTRIBUTES_TABLE,
  ATTRIBUTE_VALUES_TABLE,
  UNITS_OF_MEASURE_TABLE,
  PRODUCT_VARIANTS_TABLE,
  VARIANT_ATTRIBUTE_VALUES_TABLE,
  PRODUCT_ATTRIBUTE_VALUES_TABLE,
  PRODUCT_UOMS_TABLE,
  BUNDLE_ITEMS_TABLE,
  PRODUCT_RELATIONS_TABLE,
} from '@/shared/lib/db-schema'

// ---------------------------------------------------------------------------
// Enumeraciones — copia exacta de los tipos de la base
// ---------------------------------------------------------------------------

export const PRODUCT_KINDS = ['simple', 'variant', 'bundle'] as const
export type ProductKind = (typeof PRODUCT_KINDS)[number]

export const ATTRIBUTE_DATA_TYPES = ['text', 'number', 'boolean', 'date', 'option'] as const
export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number]

export const PRODUCT_RELATION_KINDS = [
  'related',
  'cross_sell',
  'up_sell',
  'accessory',
  'substitute',
  'spare_part',
] as const
export type ProductRelationKind = (typeof PRODUCT_RELATION_KINDS)[number]

/** Decimal como texto: mismo motivo que `moneyText`, más decimales. */
export const factorText = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toString() : value.trim()))

// ---------------------------------------------------------------------------
// Vocabulario de la sociedad
// ---------------------------------------------------------------------------

export const brandSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  is_active: z.boolean(),
})
export type Brand = z.infer<typeof brandSchema>

export const productFamilySchema = brandSchema
export type ProductFamily = Brand

export const unitOfMeasureSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  symbol: z.string().nullable().default(null),
  is_active: z.boolean(),
})
export type UnitOfMeasure = z.infer<typeof unitOfMeasureSchema>

export const attributeSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  data_type: z.enum(ATTRIBUTE_DATA_TYPES),
  unit: z.string().nullable().default(null),
  is_variant_axis: z.boolean(),
  is_filterable: z.boolean(),
  position: z.number().int(),
  is_active: z.boolean(),
})
export type Attribute = z.infer<typeof attributeSchema>

export const attributeValueSchema = z.object({
  id: z.string().uuid(),
  attribute_id: z.string().uuid(),
  code: z.string(),
  label: z.string(),
  position: z.number().int(),
  is_active: z.boolean(),
})
export type AttributeValue = z.infer<typeof attributeValueSchema>

// ---------------------------------------------------------------------------
// Lo que cuelga del producto
// ---------------------------------------------------------------------------

export const productVariantSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  store_id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  /** `null` = hereda el precio del producto maestro. */
  price: moneyText.nullable().default(null),
  compare_at_price: moneyText.nullable().default(null),
  stock: z.number().int(),
  barcode: z.string().nullable().default(null),
  position: z.number().int(),
  is_active: z.boolean(),
  is_default: z.boolean(),
})
export type ProductVariant = z.infer<typeof productVariantSchema>

export const variantAttributeValueSchema = z.object({
  id: z.string().uuid(),
  variant_id: z.string().uuid(),
  attribute_id: z.string().uuid(),
  value_id: z.string().uuid(),
})
export type VariantAttributeValue = z.infer<typeof variantAttributeValueSchema>

export const productAttributeValueSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  attribute_id: z.string().uuid(),
  value_id: z.string().uuid().nullable().default(null),
  value_text: z.string().nullable().default(null),
  value_number: factorText.nullable().default(null),
  value_boolean: z.boolean().nullable().default(null),
  value_date: z.string().nullable().default(null),
})
export type ProductAttributeValue = z.infer<typeof productAttributeValueSchema>

export const productUomSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  uom_id: z.string().uuid(),
  factor: factorText,
  is_base: z.boolean(),
  is_sellable: z.boolean(),
  price: moneyText.nullable().default(null),
  barcode: z.string().nullable().default(null),
  position: z.number().int(),
})
export type ProductUom = z.infer<typeof productUomSchema>

export const bundleItemSchema = z.object({
  id: z.string().uuid(),
  bundle_product_id: z.string().uuid(),
  component_product_id: z.string().uuid(),
  component_kind: z.enum(PRODUCT_KINDS),
  component_variant_id: z.string().uuid().nullable().default(null),
  quantity: factorText,
  uom_id: z.string().uuid().nullable().default(null),
  position: z.number().int(),
})
export type BundleItem = z.infer<typeof bundleItemSchema>

export const productRelationSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  related_product_id: z.string().uuid(),
  relation_kind: z.enum(PRODUCT_RELATION_KINDS),
  position: z.number().int(),
})
export type ProductRelation = z.infer<typeof productRelationSchema>

// ---------------------------------------------------------------------------
// Formularios. Los mensajes de error son CLAVES de i18n, no texto.
// ---------------------------------------------------------------------------

/** Mismo formato que `brands_code_fmt` / `product_families_code_fmt`. */
export const CATALOG_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/
/** Mismo formato que `attributes_code_fmt`: identificador, no etiqueta. */
export const ATTRIBUTE_CODE_RE = /^[a-z][a-z0-9_]{0,40}$/
/** Mismo formato que `units_of_measure_code_fmt`. */
export const UOM_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/
/** `numeric(18,6)` positivo: hasta 12 enteros y 6 decimales. */
export const FACTOR_RE = /^\d{1,12}(\.\d{1,6})?$/
export const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/

const errorKey = (key: MessageKey) => key

export const catalogEntryFormSchema = z.object({
  code: z.string().trim().toLowerCase().regex(CATALOG_CODE_RE, errorKey('pim.error.code')),
  name: z.string().trim().min(1, errorKey('pim.error.name')).max(160, errorKey('pim.error.name')),
  is_active: z.boolean(),
})
export type CatalogEntryFormValues = z.infer<typeof catalogEntryFormSchema>

export const unitFormSchema = z.object({
  code: z.string().trim().regex(UOM_CODE_RE, errorKey('pim.error.uomCode')),
  name: z.string().trim().min(1, errorKey('pim.error.name')).max(80, errorKey('pim.error.name')),
  symbol: z.string().trim().max(12, errorKey('pim.error.symbol')),
  is_active: z.boolean(),
})
export type UnitFormValues = z.infer<typeof unitFormSchema>

export const attributeFormSchema = z
  .object({
    code: z.string().trim().toLowerCase().regex(ATTRIBUTE_CODE_RE, errorKey('pim.error.attributeCode')),
    name: z.string().trim().min(1, errorKey('pim.error.name')).max(120, errorKey('pim.error.name')),
    data_type: z.enum(ATTRIBUTE_DATA_TYPES),
    unit: z.string().trim().max(16, errorKey('pim.error.symbol')),
    is_variant_axis: z.boolean(),
    is_filterable: z.boolean(),
    is_active: z.boolean(),
  })
  // La misma regla que el CHECK `attributes_axis_is_option`, para que el error
  // salga en el campo y no como un fallo de la base al guardar.
  .refine((values) => !values.is_variant_axis || values.data_type === 'option', {
    path: ['is_variant_axis'],
    message: errorKey('pim.error.axisNeedsOptions'),
  })
export type AttributeFormValues = z.infer<typeof attributeFormSchema>

export const attributeValueFormSchema = z.object({
  code: z.string().trim().toLowerCase().regex(CATALOG_CODE_RE, errorKey('pim.error.code')),
  label: z.string().trim().min(1, errorKey('pim.error.name')).max(120, errorKey('pim.error.name')),
  is_active: z.boolean(),
})
export type AttributeValueFormValues = z.infer<typeof attributeValueFormSchema>

export const variantFormSchema = z.object({
  sku: z.string().trim().min(1, errorKey('catalog.error.sku')).max(64, errorKey('catalog.error.sku')),
  name: z.string().trim().min(1, errorKey('pim.error.name')).max(240, errorKey('pim.error.name')),
  /** Vacío = hereda el precio del maestro. No es lo mismo que cero. */
  price: z.string().trim().refine((v) => v === '' || MONEY_RE.test(v), errorKey('catalog.error.price')),
  stock: z.string().trim().regex(/^\d{1,9}$/, errorKey('catalog.error.stock')),
  barcode: z.string().trim().refine((v) => v === '' || (v.length >= 4 && v.length <= 64), errorKey('pim.error.barcode')),
  is_active: z.boolean(),
  is_default: z.boolean(),
})
export type VariantFormValues = z.infer<typeof variantFormSchema>

export const productUomFormSchema = z.object({
  uom_id: z.string().uuid(errorKey('pim.error.uomRequired')),
  factor: z.string().trim().regex(FACTOR_RE, errorKey('pim.error.factor')).refine((v) => Number(v) > 0, errorKey('pim.error.factor')),
  is_base: z.boolean(),
  is_sellable: z.boolean(),
  price: z.string().trim().refine((v) => v === '' || MONEY_RE.test(v), errorKey('catalog.error.price')),
})
export type ProductUomFormValues = z.infer<typeof productUomFormSchema>

export const bundleItemFormSchema = z.object({
  component_product_id: z.string().uuid(errorKey('pim.error.componentRequired')),
  component_variant_id: z.string(),
  quantity: z.string().trim().regex(FACTOR_RE, errorKey('pim.error.quantity')).refine((v) => Number(v) > 0, errorKey('pim.error.quantity')),
  uom_id: z.string(),
})
export type BundleItemFormValues = z.infer<typeof bundleItemFormSchema>

// ---------------------------------------------------------------------------
// Reglas de negocio PURAS. Sin React, sin Supabase: son las que se prueban solas.
// ---------------------------------------------------------------------------

/**
 * Precio efectivo de una variante: el suyo si lo tiene, y si no el del maestro.
 *
 * Es la MISMA herencia que aplican `public_product_variants` y `create_order`.
 * Está escrita aquí para pintar el listado del backoffice sin ir a la base, no
 * para decidir el cobro: quien cobra es la base.
 */
export function effectiveVariantPrice(
  variant: Pick<ProductVariant, 'price'>,
  productPrice: string | null,
): string | null {
  // Sin precio propio ni precio base (el maestro no está publicado en su tienda
  // de origen) no hay nada que heredar: `null`, no un cero que parezca un precio.
  return variant.price ?? productPrice
}

/**
 * Convierte un decimal en TEXTO a un entero con `scale` decimales, sin pasar
 * por una multiplicación en coma flotante.
 *
 * `Number('19.99') * 100` no es 1999, es 1998.9999999999998, y redondear
 * después de multiplicar por el factor arrastra ese error hasta el céntimo:
 * 19,99 x 0,5 daba 9,99 en vez de 9,995 → 10,00. El importe viaja como texto
 * desde la base justamente para no perder precisión; convertirlo con `Number`
 * a mitad de camino tira esa garantía por la ventana.
 */
function toScaledInt(value: string, scale: number): number {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const [whole = '0', fraction = ''] = trimmed.replace(/^[+-]/, '').split('.')
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale)
  const magnitude = Number(whole || '0') * 10 ** scale + Number(padded || '0')
  return negative ? -magnitude : magnitude
}

/** Escala del factor: `numeric(18,6)` en la base. */
const FACTOR_SCALE = 6

/**
 * Precio efectivo de una unidad de venta: el suyo si lo tiene, y si no el
 * precio base por el factor.
 *
 * Se calcula en céntimos enteros por micro-unidades enteras y se redondea UNA
 * vez, al final. Es un precio de PANTALLA: quien cobra es `create_order`, que
 * hace la misma cuenta en `numeric`.
 */
export function effectiveUomPrice(
  uom: Pick<ProductUom, 'price' | 'factor'>,
  basePrice: string | null,
): string | null {
  if (uom.price !== null) return uom.price
  if (basePrice === null) return null
  const cents = toScaledInt(basePrice, 2)
  const micros = toScaledInt(uom.factor, FACTOR_SCALE)
  if (!Number.isFinite(cents) || !Number.isFinite(micros)) return basePrice
  const result = Math.round((cents * micros) / 10 ** FACTOR_SCALE)
  if (!Number.isFinite(result)) return basePrice
  return (result / 100).toFixed(2)
}

/**
 * Cuántas unidades base entrega una cantidad expresada en otra unidad.
 * Devuelve `null` si la conversión no da un número entero: `stock` es entero en
 * la base y `create_order` rechaza exactamente ese caso en vez de redondear.
 */
export function baseUnitsFor(quantity: number, factor: string): number | null {
  const result = quantity * Number(factor)
  if (!Number.isFinite(result)) return null
  // Tolerancia de un microunidad: el factor tiene 6 decimales en la base y el
  // producto de dos decimales exactos puede caer en 23.999999999999996.
  const rounded = Math.round(result)
  return Math.abs(result - rounded) < 1e-6 ? rounded : null
}

export interface BundleComponentStock {
  /** Cantidad del componente por unidad de kit, ya en unidades base. */
  readonly requiredPerUnit: number
  /** Existencia disponible del componente (producto o variante). */
  readonly available: number
}

/**
 * Cuántos kits se pueden armar con lo que hay. Es el "stock futuro calculado
 * por componentes" de la regla 4: el kit no tiene existencia propia, la deriva.
 *
 * Un kit SIN componentes devuelve 0 y no infinito: no se puede armar algo que
 * no tiene receta, y `create_order` lo rechaza con `KIT_SIN_COMPONENTES`.
 */
export function assemblableUnits(components: readonly BundleComponentStock[]): number {
  const usable = components.filter((component) => component.requiredPerUnit > 0)
  if (usable.length === 0) return 0
  return usable.reduce(
    (min, component) =>
      Math.min(min, Math.floor(Math.max(0, component.available) / component.requiredPerUnit)),
    Number.MAX_SAFE_INTEGER,
  )
}

/**
 * Nombre sugerido de una variante a partir de los valores de sus ejes:
 * "Rojo · M". Solo sugiere — el usuario puede escribir el que quiera, igual que
 * con el slug del producto.
 */
export function suggestVariantName(labels: readonly string[]): string {
  return labels.filter((label) => label.trim().length > 0).join(' · ')
}

/**
 * SKU sugerido de una variante: el del maestro más los códigos de sus ejes.
 * Se recorta a los 64 caracteres que admite la columna.
 */
export function suggestVariantSku(productSku: string, codes: readonly string[]): string {
  const suffix = codes
    .filter((code) => code.trim().length > 0)
    .map((code) => code.toUpperCase().replace(/[^A-Z0-9]+/g, ''))
    .join('-')
  return (suffix ? `${productSku}-${suffix}` : productSku).slice(0, 64)
}

export function variantToForm(variant: ProductVariant | null): VariantFormValues {
  return {
    sku: variant?.sku ?? '',
    name: variant?.name ?? '',
    price: variant?.price ?? '',
    stock: String(variant?.stock ?? 0),
    barcode: variant?.barcode ?? '',
    is_active: variant?.is_active ?? true,
    is_default: variant?.is_default ?? false,
  }
}

export function catalogEntryToForm(entry: Brand | null): CatalogEntryFormValues {
  return {
    code: entry?.code ?? '',
    name: entry?.name ?? '',
    is_active: entry?.is_active ?? true,
  }
}

export function unitToForm(unit: UnitOfMeasure | null): UnitFormValues {
  return {
    code: unit?.code ?? '',
    name: unit?.name ?? '',
    symbol: unit?.symbol ?? '',
    is_active: unit?.is_active ?? true,
  }
}

export function attributeToForm(attribute: Attribute | null): AttributeFormValues {
  return {
    code: attribute?.code ?? '',
    name: attribute?.name ?? '',
    data_type: attribute?.data_type ?? 'option',
    unit: attribute?.unit ?? '',
    is_variant_axis: attribute?.is_variant_axis ?? false,
    is_filterable: attribute?.is_filterable ?? true,
    is_active: attribute?.is_active ?? true,
  }
}
