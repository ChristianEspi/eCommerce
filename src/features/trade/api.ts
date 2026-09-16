import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN_STORE_PRODUCTS_VIEW } from '@/shared/lib/db-schema'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { TradeError, tradeErrorFromDb } from './errors'
import {
  ASSORTMENTS_TABLE,
  ASSORTMENT_ITEMS_TABLE,
  QUOTES_TABLE,
  QUOTE_ITEMS_TABLE,
  assortmentItemSchema,
  assortmentSchema,
  lineTotal,
  quoteItemSchema,
  quoteSchema,
  type Assortment,
  type AssortmentFormValues,
  type AssortmentItem,
  type Quote,
  type QuoteFormValues,
  type QuoteItem,
  type QuoteItemFormValues,
  type QuoteStatus,
} from './types'

/**
 * Acceso comercial: cotizaciones y surtidos.
 *
 * Ninguna consulta filtra por `organization_id`: el tenant lo pone la RLS desde
 * el JWT. Filtrarlo aquí daría la falsa impresión de que este archivo aísla, y
 * el día que alguien lo quitara «porque es redundante» no pasaría nada — hasta
 * que una policy tuviera un fallo. El tenant sí viaja en el INSERT, porque una
 * fila nueva tiene que decir de quién es.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new TradeError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export interface TradeScope {
  organizationId: string
  companyId: string
  storeId: string
}

/** Aplana la relación anidada que PostgREST devuelve como array. */
function primero<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// ---------------------------------------------------------------------------
// Cotizaciones
// ---------------------------------------------------------------------------

const QUOTE_SELECT =
  'id, store_id, customer_id, sales_rep_id, quote_number, status, currency, issued_at, ' +
  'valid_until, subtotal::text, tax_total::text, grand_total::text, order_id, notes, ' +
  'customers(code, name)'

export async function fetchQuotes(): Promise<Quote[]> {
  const { data, error } = await client()
    .from(QUOTES_TABLE)
    .select(QUOTE_SELECT)
    .order('issued_at', { ascending: false })

  if (error) throw tradeErrorFromDb(error)

  const filas = (data ?? []).map((row) => {
    const { customers, ...resto } = row as unknown as Record<string, unknown> & {
      customers?: { code?: string; name?: string }[] | { code?: string; name?: string } | null
    }
    const cliente = primero(customers)
    return { ...resto, customer_code: cliente?.code ?? null, customer_name: cliente?.name ?? null }
  })

  return quoteSchema.array().parse(filas)
}

const ITEM_SELECT =
  'id, quote_id, product_id, variant_id, uom_code, quantity::text, unit_price::text, ' +
  'tax_rate::text, tax_amount::text, line_total::text, position, products(name)'

export async function fetchQuoteItems(quoteId: string | null): Promise<QuoteItem[]> {
  if (!quoteId) return []

  const { data, error } = await client()
    .from(QUOTE_ITEMS_TABLE)
    .select(ITEM_SELECT)
    .eq('quote_id', quoteId)
    .order('position')

  if (error) throw tradeErrorFromDb(error)

  const filas = (data ?? []).map((row) => {
    const { products, ...resto } = row as unknown as Record<string, unknown> & {
      products?: { name?: string }[] | { name?: string } | null
    }
    return { ...resto, product_name: primero(products)?.name ?? null }
  })

  return quoteItemSchema.array().parse(filas)
}

export async function saveQuote(input: {
  scope: TradeScope
  id: string | null
  values: QuoteFormValues
}): Promise<string> {
  const fila = {
    quote_number: input.values.quote_number.trim(),
    customer_id: input.values.customer_id,
    currency: input.values.currency.trim().toUpperCase(),
    issued_at: input.values.issued_at,
    valid_until: input.values.valid_until,
    notes: nullable(input.values.notes),
  }

  const supabase = client()
  if (input.id) {
    const { error } = await supabase.from(QUOTES_TABLE).update(fila).eq('id', input.id)
    if (error) throw tradeErrorFromDb(error)
    return input.id
  }

  const { data, error } = await supabase
    .from(QUOTES_TABLE)
    .insert({
      organization_id: input.scope.organizationId,
      company_id: input.scope.companyId,
      store_id: input.scope.storeId,
      ...fila,
    })
    .select('id')
    .single()

  if (error) throw tradeErrorFromDb(error)
  return (data as { id: string }).id
}

/**
 * Cambia el estado. La transición la valida el trigger `quote_status_guard`;
 * aquí solo se manda la que la pantalla ya ha decidido ofrecer.
 */
export async function setQuoteStatus(input: { id: string; status: QuoteStatus }): Promise<void> {
  const { error } = await client()
    .from(QUOTES_TABLE)
    .update({ status: input.status })
    .eq('id', input.id)
  if (error) throw tradeErrorFromDb(error)
}

/**
 * Añade una línea y recalcula el total de la cabecera.
 *
 * Son dos escrituras porque PostgREST no da transacción, y el orden importa: la
 * línea primero. Si el recálculo falla, la cotización queda con una línea más y
 * un total viejo —visible, y la siguiente escritura lo arregla—; al revés
 * quedaría un total que no corresponde a ninguna línea, que es una cifra que
 * nadie puede explicar.
 */
export async function addQuoteItem(input: {
  scope: TradeScope
  quoteId: string
  values: QuoteItemFormValues
  position: number
}): Promise<void> {
  const supabase = client()
  const total = lineTotal(input.values.quantity, input.values.unit_price)

  const { error } = await supabase.from(QUOTE_ITEMS_TABLE).insert({
    organization_id: input.scope.organizationId,
    company_id: input.scope.companyId,
    quote_id: input.quoteId,
    product_id: input.values.product_id,
    quantity: input.values.quantity,
    unit_price: input.values.unit_price,
    line_total: total,
    position: input.position,
  })

  if (error) throw tradeErrorFromDb(error)
  await recalcQuoteTotals(input.quoteId)
}

export async function removeQuoteItem(input: { id: string; quoteId: string }): Promise<void> {
  const { error } = await client().from(QUOTE_ITEMS_TABLE).delete().eq('id', input.id)
  if (error) throw tradeErrorFromDb(error)
  await recalcQuoteTotals(input.quoteId)
}

/**
 * Suma las líneas en CÉNTIMOS enteros y guarda el total de la cabecera.
 *
 * El impuesto se suma tal y como quedó guardado POR LÍNEA; no se recalcula. El
 * IGV de una cotización es el del día en que se cotizó, y una tasa que cambia
 * en enero no puede reescribir lo que se ofreció en diciembre.
 */
async function recalcQuoteTotals(quoteId: string): Promise<void> {
  const supabase = client()
  const { data, error } = await supabase
    .from(QUOTE_ITEMS_TABLE)
    .select('line_total::text, tax_amount::text')
    .eq('quote_id', quoteId)

  if (error) throw tradeErrorFromDb(error)

  const filas = (data ?? []) as unknown as { line_total: string; tax_amount: string | null }[]
  const subtotal = filas.reduce((suma, fila) => suma + Math.round(Number(fila.line_total) * 100), 0)
  const impuesto = filas.reduce(
    (suma, fila) => suma + Math.round(Number(fila.tax_amount ?? 0) * 100),
    0,
  )

  const { error: updateError } = await supabase
    .from(QUOTES_TABLE)
    .update({
      subtotal: (subtotal / 100).toFixed(2),
      tax_total: (impuesto / 100).toFixed(2),
      grand_total: ((subtotal + impuesto) / 100).toFixed(2),
    })
    .eq('id', quoteId)

  if (updateError) throw tradeErrorFromDb(updateError)
}

// ---------------------------------------------------------------------------
// Buscador de producto para los desplegables
//
// El de CLIENTES no se escribe aquí: `features/customers` ya tiene
// `useCustomerOptions`, que consulta la misma tabla con el mismo límite.
// Duplicarlo sería un segundo sitio que arreglar el día que ese buscador cambie.
// ---------------------------------------------------------------------------

export interface TradeProductOption {
  id: string
  sku: string
  name: string
}

export async function searchTradeProducts(input: {
  storeId: string | null
  term: string
}): Promise<TradeProductOption[]> {
  if (!input.storeId) return []

  // ADR 018: surtidos y cotizaciones de una tienda ofrecen lo PUBLICADO en
  // ella. La vista de publicaciones expone el producto como `product_id`.
  let query = client()
    .from(ADMIN_STORE_PRODUCTS_VIEW)
    .select('product_id, sku, name')
    .eq('store_id', input.storeId)
    .order('name')
    .limit(20)

  const filter = buildTextSearchFilter(input.term, ['name', 'sku'])
  if (filter) query = query.or(filter)

  const { data, error } = await query
  if (error) throw tradeErrorFromDb(error)
  return (data ?? []).map((row) => {
    const { product_id: id, sku, name } = row as { product_id: string; sku: string; name: string }
    return { id, sku, name }
  })
}

// ---------------------------------------------------------------------------
// Surtidos
// ---------------------------------------------------------------------------

export async function fetchAssortments(): Promise<Assortment[]> {
  const { data, error } = await client()
    .from(ASSORTMENTS_TABLE)
    .select('id, store_id, code, name, is_allow_list, is_active')
    .order('code')

  if (error) throw tradeErrorFromDb(error)
  return assortmentSchema.array().parse(data ?? [])
}

export async function saveAssortment(input: {
  scope: TradeScope
  id: string | null
  values: AssortmentFormValues
}): Promise<void> {
  const fila = {
    code: input.values.code.trim(),
    name: input.values.name.trim(),
    is_allow_list: input.values.is_allow_list,
    is_active: input.values.is_active,
  }

  const supabase = client()
  const { error } = input.id
    ? await supabase.from(ASSORTMENTS_TABLE).update(fila).eq('id', input.id)
    : await supabase.from(ASSORTMENTS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        ...fila,
      })

  if (error) throw tradeErrorFromDb(error)
}

export async function fetchAssortmentItems(
  assortmentId: string | null,
): Promise<AssortmentItem[]> {
  if (!assortmentId) return []

  const { data, error } = await client()
    .from(ASSORTMENT_ITEMS_TABLE)
    .select('id, assortment_id, product_id, variant_id, products(name, sku)')
    .eq('assortment_id', assortmentId)

  if (error) throw tradeErrorFromDb(error)

  const filas = (data ?? []).map((row) => {
    const { products, ...resto } = row as unknown as Record<string, unknown> & {
      products?: { name?: string; sku?: string }[] | { name?: string; sku?: string } | null
    }
    const producto = primero(products)
    return { ...resto, product_name: producto?.name ?? null, product_sku: producto?.sku ?? null }
  })

  return assortmentItemSchema.array().parse(filas)
}

export async function addAssortmentItem(input: {
  scope: TradeScope
  assortmentId: string
  productId: string
}): Promise<void> {
  const { error } = await client().from(ASSORTMENT_ITEMS_TABLE).insert({
    organization_id: input.scope.organizationId,
    company_id: input.scope.companyId,
    assortment_id: input.assortmentId,
    product_id: input.productId,
  })
  if (error) throw tradeErrorFromDb(error)
}

export async function removeAssortmentItem(id: string): Promise<void> {
  const { error } = await client().from(ASSORTMENT_ITEMS_TABLE).delete().eq('id', id)
  if (error) throw tradeErrorFromDb(error)
}
