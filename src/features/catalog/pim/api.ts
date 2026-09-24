import { catalogClient } from '../api/client'
import { catalogErrorFromDb } from '../api/errors'
import {
  ATTRIBUTES_TABLE,
  ATTRIBUTE_VALUES_TABLE,
  BRANDS_TABLE,
  BUNDLE_ITEMS_TABLE,
  PRODUCT_ATTRIBUTE_VALUES_TABLE,
  PRODUCT_FAMILIES_TABLE,
  PRODUCT_RELATIONS_TABLE,
  PRODUCT_UOMS_TABLE,
  PRODUCT_VARIANTS_TABLE,
  UNITS_OF_MEASURE_TABLE,
  VARIANT_ATTRIBUTE_VALUES_TABLE,
  attributeSchema,
  attributeValueSchema,
  brandSchema,
  productFamilySchema,
  bundleItemSchema,
  productAttributeValueSchema,
  productRelationSchema,
  productUomSchema,
  productVariantSchema,
  unitOfMeasureSchema,
  variantAttributeValueSchema,
  type Attribute,
  type AttributeFormValues,
  type AttributeValue,
  type AttributeValueFormValues,
  type Brand,
  type BrandFormValues,
  type BundleItem,
  type BundleItemFormValues,
  type CatalogEntryFormValues,
  type ProductAttributeValue,
  type ProductFamily,
  type ProductRelation,
  type ProductRelationKind,
  type ProductUom,
  type ProductUomFormValues,
  type ProductVariant,
  type UnitFormValues,
  type UnitOfMeasure,
  type VariantAttributeValue,
  type VariantFormValues,
} from './types'

/**
 * Acceso a datos del PIM.
 *
 * Dos reglas, las mismas del resto del catálogo:
 *
 *  1. **Ninguna consulta declara el tenant.** `organization_id` y `company_id`
 *     se ESCRIBEN en los `insert` porque las columnas son NOT NULL, pero salen
 *     del contexto de tenant derivado del JWT (`TenantProvider`), no de nada que
 *     el usuario pueda teclear; y quien decide si esa escritura vale es la RLS,
 *     que compara contra los claims. Ningún `select` filtra por tenant: si lo
 *     hiciera, un filtro olvidado parecería seguridad y no lo sería.
 *  2. **El error de Postgres no llega crudo a la pantalla.** Todo sale como
 *     `CatalogError` con una clave de i18n y un código estable.
 *
 * El alcance de cada consulta sí viaja: `store_id` para lo que cuelga del
 * producto, `product_id` para los hijos. Es alcance de pantalla, no seguridad —
 * pedir la tienda de otro tampoco devolvería filas.
 */

export interface TenantScope {
  organizationId: string
  companyId: string
}

export interface StoreScope extends TenantScope {
  storeId: string
}

// ---------------------------------------------------------------------------
// Vocabulario de la sociedad: marcas, familias, unidades
// ---------------------------------------------------------------------------

const CATALOG_ENTRY_SELECT = 'id, code, name, description, is_active'
/** La marca pide una columna más: su logo es publicable y la familia no tiene. */
const BRAND_SELECT = `${CATALOG_ENTRY_SELECT}, logo_url`
const UNIT_SELECT = 'id, code, name, symbol, is_active'

export async function fetchBrands(): Promise<Brand[]> {
  const { data, error } = await catalogClient()
    .from(BRANDS_TABLE)
    .select(BRAND_SELECT)
    .order('name')
  if (error) throw catalogErrorFromDb(error)
  return brandSchema.array().parse(data ?? [])
}

export async function fetchFamilies(): Promise<ProductFamily[]> {
  const { data, error } = await catalogClient()
    .from(PRODUCT_FAMILIES_TABLE)
    .select(CATALOG_ENTRY_SELECT)
    .order('name')
  if (error) throw catalogErrorFromDb(error)
  // `productFamilySchema` y no `brandSchema`: una familia no tiene logo, y
  // parsearla con el esquema de la marca le añadiría un `logo_url: null` que
  // nadie puede guardar.
  return productFamilySchema.array().parse(data ?? [])
}

export async function fetchUnits(): Promise<UnitOfMeasure[]> {
  const { data, error } = await catalogClient()
    .from(UNITS_OF_MEASURE_TABLE)
    .select(UNIT_SELECT)
    .order('code')
  if (error) throw catalogErrorFromDb(error)
  return unitOfMeasureSchema.array().parse(data ?? [])
}

async function saveCatalogEntry(
  table: string,
  input: { id?: string | null; scope: TenantScope; values: CatalogEntryFormValues },
): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(table).update(fields).eq('id', input.id)
    : await supabase.from(table).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

/**
 * Guardar una marca. Escribe su logo ADEMÁS de lo del vocabulario.
 *
 * No reutiliza `saveCatalogEntry` con un campo extra porque eso obligaría a que
 * la función genérica conociera un campo que solo tiene una de las dos tablas —
 * y el día que se le pasara por error a una familia, el `insert` moriría con
 * «column logo_url does not exist». Son dos escrituras parecidas, no la misma.
 */
export async function saveBrand(input: {
  id?: string | null
  scope: TenantScope
  values: BrandFormValues
}): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    is_active: input.values.is_active,
    logo_url: input.values.logo_url,
  }

  const { error } = input.id
    ? await supabase.from(BRANDS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(BRANDS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

export const saveFamily = (input: {
  id?: string | null
  scope: TenantScope
  values: CatalogEntryFormValues
}) => saveCatalogEntry(PRODUCT_FAMILIES_TABLE, input)

export async function saveUnit(input: {
  id?: string | null
  scope: TenantScope
  values: UnitFormValues
}): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    symbol: input.values.symbol || null,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(UNITS_OF_MEASURE_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(UNITS_OF_MEASURE_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await catalogClient().from(table).delete().eq('id', id)
  if (error) throw catalogErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Atributos y sus valores
// ---------------------------------------------------------------------------

const ATTRIBUTE_SELECT =
  'id, code, name, data_type, unit, is_variant_axis, is_filterable, position, is_active'
const ATTRIBUTE_VALUE_SELECT = 'id, attribute_id, code, label, position, is_active'

export async function fetchAttributes(): Promise<Attribute[]> {
  const { data, error } = await catalogClient()
    .from(ATTRIBUTES_TABLE)
    .select(ATTRIBUTE_SELECT)
    .order('position')
    .order('name')
  if (error) throw catalogErrorFromDb(error)
  return attributeSchema.array().parse(data ?? [])
}

export async function fetchAttributeValues(): Promise<AttributeValue[]> {
  const { data, error } = await catalogClient()
    .from(ATTRIBUTE_VALUES_TABLE)
    .select(ATTRIBUTE_VALUE_SELECT)
    .order('position')
    .order('label')
  if (error) throw catalogErrorFromDb(error)
  return attributeValueSchema.array().parse(data ?? [])
}

export async function saveAttribute(input: {
  id?: string | null
  scope: TenantScope
  values: AttributeFormValues
}): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    data_type: input.values.data_type,
    unit: input.values.unit || null,
    is_variant_axis: input.values.is_variant_axis,
    is_filterable: input.values.is_filterable,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(ATTRIBUTES_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(ATTRIBUTES_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

export async function saveAttributeValue(input: {
  id?: string | null
  attributeId: string
  scope: TenantScope
  values: AttributeValueFormValues
}): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    code: input.values.code,
    label: input.values.label,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(ATTRIBUTE_VALUES_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(ATTRIBUTE_VALUES_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        attribute_id: input.attributeId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

const VARIANT_SELECT = [
  'id',
  'product_id',
  'store_id',
  'sku',
  'name',
  'price::text',
  'compare_at_price::text',
  'stock',
  'barcode',
  'position',
  'is_active',
  'is_default',
].join(', ')

export async function fetchVariants(productId: string | null): Promise<ProductVariant[]> {
  if (!productId) return []
  const { data, error } = await catalogClient()
    .from(PRODUCT_VARIANTS_TABLE)
    .select(VARIANT_SELECT)
    .eq('product_id', productId)
    .order('position')
    .order('name')
  if (error) throw catalogErrorFromDb(error)
  return productVariantSchema.array().parse(data ?? [])
}

export async function saveVariant(input: {
  id?: string | null
  productId: string
  scope: StoreScope
  values: VariantFormValues
}): Promise<{ id: string }> {
  const supabase = catalogClient()
  const fields = {
    sku: input.values.sku,
    name: input.values.name,
    // Vacío = hereda del maestro. Guardar 0 aquí sería regalar el producto.
    price: input.values.price === '' ? null : input.values.price,
    stock: Number(input.values.stock),
    barcode: input.values.barcode || null,
    is_active: input.values.is_active,
    is_default: input.values.is_default,
  }

  // La variante por defecto es única por índice parcial: liberar la anterior
  // antes de marcar la nueva evita el 409 a mitad de camino, igual que hace
  // `set_primary_product_image` con la imagen principal.
  if (input.values.is_default) {
    const { error: clearError } = await supabase
      .from(PRODUCT_VARIANTS_TABLE)
      .update({ is_default: false })
      .eq('product_id', input.productId)
      .eq('is_default', true)
    if (clearError) throw catalogErrorFromDb(clearError)
  }

  const { data, error } = input.id
    ? await supabase
        .from(PRODUCT_VARIANTS_TABLE)
        .update(fields)
        .eq('id', input.id)
        .select('id')
        .single()
    : await supabase
        .from(PRODUCT_VARIANTS_TABLE)
        .insert({
          organization_id: input.scope.organizationId,
          company_id: input.scope.companyId,
          store_id: input.scope.storeId,
          product_id: input.productId,
          ...fields,
        })
        .select('id')
        .single()

  if (error) throw catalogErrorFromDb(error)
  return { id: String((data as { id?: unknown })?.id ?? '') }
}

export async function fetchVariantAxes(productId: string | null): Promise<VariantAttributeValue[]> {
  if (!productId) return []
  const variants = await fetchVariants(productId)
  if (variants.length === 0) return []

  const { data, error } = await catalogClient()
    .from(VARIANT_ATTRIBUTE_VALUES_TABLE)
    .select('id, variant_id, attribute_id, value_id')
    .in(
      'variant_id',
      variants.map((variant) => variant.id),
    )
  if (error) throw catalogErrorFromDb(error)
  return variantAttributeValueSchema.array().parse(data ?? [])
}

/**
 * Fija los ejes de una variante: se borra lo que había y se escribe lo nuevo.
 *
 * Reemplazar es lo correcto aquí y no un `upsert` campo a campo: los ejes de
 * una variante son una combinación completa, y una actualización parcial deja
 * combinaciones a medias ("Rojo" sin talla) que el listado no sabe nombrar.
 */
export async function setVariantAxes(input: {
  variantId: string
  scope: StoreScope
  axes: Array<{ attribute_id: string; value_id: string }>
}): Promise<void> {
  const supabase = catalogClient()

  const { error: clearError } = await supabase
    .from(VARIANT_ATTRIBUTE_VALUES_TABLE)
    .delete()
    .eq('variant_id', input.variantId)
  if (clearError) throw catalogErrorFromDb(clearError)

  if (input.axes.length === 0) return

  const { error } = await supabase.from(VARIANT_ATTRIBUTE_VALUES_TABLE).insert(
    input.axes.map((axis) => ({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      store_id: input.scope.storeId,
      variant_id: input.variantId,
      attribute_id: axis.attribute_id,
      value_id: axis.value_id,
    })),
  )
  if (error) throw catalogErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Unidades de venta del producto
// ---------------------------------------------------------------------------

const PRODUCT_UOM_SELECT = [
  'id',
  'product_id',
  'uom_id',
  'factor::text',
  'is_base',
  'is_sellable',
  'price::text',
  'barcode',
  'position',
].join(', ')

export async function fetchProductUoms(productId: string | null): Promise<ProductUom[]> {
  if (!productId) return []
  const { data, error } = await catalogClient()
    .from(PRODUCT_UOMS_TABLE)
    .select(PRODUCT_UOM_SELECT)
    .eq('product_id', productId)
    .order('is_base', { ascending: false })
    .order('position')
  if (error) throw catalogErrorFromDb(error)
  return productUomSchema.array().parse(data ?? [])
}

export async function saveProductUom(input: {
  id?: string | null
  productId: string
  scope: StoreScope
  values: ProductUomFormValues
}): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    uom_id: input.values.uom_id,
    // La base obliga a factor 1 en la unidad base; se fija aquí para que el
    // usuario no tenga que saberlo y no se coma un error de CHECK.
    factor: input.values.is_base ? '1' : input.values.factor,
    is_base: input.values.is_base,
    is_sellable: input.values.is_sellable,
    price: input.values.price === '' ? null : input.values.price,
  }

  if (input.values.is_base) {
    const { error: clearError } = await supabase
      .from(PRODUCT_UOMS_TABLE)
      .update({ is_base: false })
      .eq('product_id', input.productId)
      .eq('is_base', true)
    if (clearError) throw catalogErrorFromDb(clearError)
  }

  const { error } = input.id
    ? await supabase.from(PRODUCT_UOMS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(PRODUCT_UOMS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        product_id: input.productId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Ficha técnica del producto
// ---------------------------------------------------------------------------

const PRODUCT_ATTRIBUTE_SELECT = [
  'id',
  'product_id',
  'attribute_id',
  'value_id',
  'value_text',
  'value_number::text',
  'value_boolean',
  'value_date',
].join(', ')

export async function fetchProductAttributes(
  productId: string | null,
): Promise<ProductAttributeValue[]> {
  if (!productId) return []
  const { data, error } = await catalogClient()
    .from(PRODUCT_ATTRIBUTE_VALUES_TABLE)
    .select(PRODUCT_ATTRIBUTE_SELECT)
    .eq('product_id', productId)
  if (error) throw catalogErrorFromDb(error)
  return productAttributeValueSchema.array().parse(data ?? [])
}

/**
 * Escribe UN valor de la ficha técnica.
 *
 * El CHECK `product_attribute_values_one_value` exige exactamente una columna
 * rellena, así que las otras cuatro se mandan explícitamente a `null` en vez de
 * omitirse: en un `update` parcial, omitirlas dejaría el valor anterior y la
 * fila tendría dos.
 */
export async function saveProductAttribute(input: {
  id?: string | null
  productId: string
  attributeId: string
  scope: StoreScope
  value: ProductAttributeInput
}): Promise<void> {
  const supabase = catalogClient()
  const fields = {
    value_id: input.value.kind === 'option' ? input.value.optionId : null,
    value_text: input.value.kind === 'text' ? input.value.text : null,
    value_number: input.value.kind === 'number' ? input.value.number : null,
    value_boolean: input.value.kind === 'boolean' ? input.value.boolean : null,
    value_date: input.value.kind === 'date' ? input.value.date : null,
  }

  const { error } = input.id
    ? await supabase.from(PRODUCT_ATTRIBUTE_VALUES_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(PRODUCT_ATTRIBUTE_VALUES_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        product_id: input.productId,
        attribute_id: input.attributeId,
        ...fields,
      })

  if (error) throw catalogErrorFromDb(error)
}

/** Valor tipado de la ficha técnica: uno y solo uno, como exige el CHECK. */
export type ProductAttributeInput =
  | { kind: 'option'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: string }
  | { kind: 'boolean'; boolean: boolean }
  | { kind: 'date'; date: string }

// ---------------------------------------------------------------------------
// Componentes del kit
// ---------------------------------------------------------------------------

const BUNDLE_ITEM_SELECT = [
  'id',
  'bundle_product_id',
  'component_product_id',
  'component_kind',
  'component_variant_id',
  'quantity::text',
  'uom_id',
  'position',
].join(', ')

export async function fetchBundleItems(bundleProductId: string | null): Promise<BundleItem[]> {
  if (!bundleProductId) return []
  const { data, error } = await catalogClient()
    .from(BUNDLE_ITEMS_TABLE)
    .select(BUNDLE_ITEM_SELECT)
    .eq('bundle_product_id', bundleProductId)
    .order('position')
  if (error) throw catalogErrorFromDb(error)
  return bundleItemSchema.array().parse(data ?? [])
}

export async function addBundleItem(input: {
  bundleProductId: string
  scope: StoreScope
  values: BundleItemFormValues
  /** Tipo REAL del componente. Va a la columna denormalizada que la FK valida. */
  componentKind: 'simple' | 'variant'
}): Promise<void> {
  const { error } = await catalogClient()
    .from(BUNDLE_ITEMS_TABLE)
    .insert({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      store_id: input.scope.storeId,
      bundle_product_id: input.bundleProductId,
      component_product_id: input.values.component_product_id,
      component_kind: input.componentKind,
      component_variant_id: input.values.component_variant_id || null,
      quantity: input.values.quantity,
      uom_id: input.values.uom_id || null,
    })
  if (error) throw catalogErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Relaciones
// ---------------------------------------------------------------------------

export async function fetchRelations(productId: string | null): Promise<ProductRelation[]> {
  if (!productId) return []
  const { data, error } = await catalogClient()
    .from(PRODUCT_RELATIONS_TABLE)
    .select('id, product_id, related_product_id, relation_kind, position')
    .eq('product_id', productId)
    .order('position')
  if (error) throw catalogErrorFromDb(error)
  return productRelationSchema.array().parse(data ?? [])
}

export async function addRelation(input: {
  productId: string
  relatedProductId: string
  kind: ProductRelationKind
  scope: StoreScope
  position?: number
}): Promise<void> {
  const { error } = await catalogClient()
    .from(PRODUCT_RELATIONS_TABLE)
    .insert({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      store_id: input.scope.storeId,
      product_id: input.productId,
      related_product_id: input.relatedProductId,
      relation_kind: input.kind,
      // Al final de la lista: la relación nueva no se cuela delante de las que
      // el comercio ya ordenó.
      position: input.position ?? 0,
    })
  if (error) throw catalogErrorFromDb(error)
}

// --- Cierre · quitar y reordenar relaciones ---------------------------------
//
// Sin función DEFINER: la RLS de `product_relations` ya da UPDATE y DELETE a
// `owner`, `admin` y `catalog` de su tenant (20260827170000), que es justo
// quien edita el catálogo. Una puerta nueva sería una segunda regla para lo
// mismo.

export async function deleteRelation(id: string): Promise<void> {
  await deleteRow(PRODUCT_RELATIONS_TABLE, id)
}

/**
 * Posiciones tras mover una relación `delta` puestos. Función PURA.
 *
 * Renumera la lista entera de 1 a n y devuelve SOLO las filas cuya posición
 * cambia: con posiciones repetidas (las altas antiguas nacían todas en 0) mover
 * una sola fila no ordenaría nada.
 */
export function relationPositionsAfterMove(
  list: readonly Pick<ProductRelation, 'id' | 'position'>[],
  index: number,
  delta: -1 | 1,
): { id: string; position: number }[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return []
  const next = [...list]
  const [moved] = next.splice(index, 1)
  if (!moved) return []
  next.splice(target, 0, moved)
  return next
    .map((item, i) => ({ id: item.id, position: i + 1, before: item.position }))
    .filter((item) => item.position !== item.before)
    .map(({ id, position }) => ({ id, position }))
}

export async function reorderRelations(changes: readonly { id: string; position: number }[]): Promise<void> {
  // De una en una y en orden: si una falla, las anteriores ya quedaron y la
  // lista se vuelve a leer —la invalida el hook—, así que la pantalla nunca
  // enseña un orden que la base no tiene.
  for (const change of changes) {
    const { error } = await catalogClient()
      .from(PRODUCT_RELATIONS_TABLE)
      .update({ position: change.position })
      .eq('id', change.id)
    if (error) throw catalogErrorFromDb(error)
  }
}
// --- fin relaciones -----------------------------------------------------------
