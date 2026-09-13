import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * Portal del comprador: sus pedidos, su estado de cuenta y sus cupones.
 *
 * ## Por qué el cliente CON SESIÓN y no el de la vitrina
 *
 * El catálogo lo lee un cliente anónimo a propósito. Esto no: las tres llamadas
 * son funciones de servidor que arrancan preguntando quién eres, y sin JWT no
 * hay a quién responder. Ninguna acepta un id de cuenta — el vínculo entre la
 * persona y su empresa lo resuelve la base contra `business_account_users`, que
 * es lo que impide que alguien vea la deuda de otra botica escribiendo un uuid.
 *
 * ## Todo llega como texto
 *
 * Los importes viajan en `text` desde Postgres y aquí se quedan así. Un
 * `numeric(14,2)` convertido a `number` de JavaScript pierde precisión en
 * cuanto la cifra crece, y esto es dinero que alguien va a cuadrar contra su
 * ERP. Se formatea para pintar; no se opera.
 */

export const MY_ORDERS_RPC = 'my_business_orders'
export const MY_STATEMENT_RPC = 'my_account_statement'
export const MY_COUPONS_RPC = 'my_coupons'
export const MY_ORDER_DETAIL_RPC = 'my_business_order_detail'

export interface MyOrder {
  order_id: string
  order_number: string
  status: string
  payment_status: string
  fulfillment_status: string | null
  approval_status: string | null
  currency: string
  grand_total: string
  placed_at: string
  account_name: string
  my_role: string
  can_decide: boolean
}

export interface StatementDocument {
  order_id: string
  order_number: string
  placed_at: string
  due_at: string | null
  days_overdue: number
  total: string
  currency: string
  status: string
  payment_status: string
}

export interface AccountStatement {
  account_id: string
  account_name: string
  account_code: string | null
  credit_limit: string | null
  payment_terms_days: number
  balance_due: string
  credit_available: string | null
  overdue_amount: string
  documents: StatementDocument[]
  purchased_12m: string
  paid_12m: string
  currency: string | null
}

export interface MyCoupon {
  code: string
  promotion_name: string
  promotion_description: string | null
  kind: string
  value_percent: string | null
  value_amount: string | null
  min_subtotal: string | null
  valid_to: string | null
  remaining_uses: number | null
}

export interface MyOrderDetail {
  order_id: string
  order_number: string
  status: string
  payment_status: string
  fulfillment_status: string | null
  placed_at: string
  currency: string
  subtotal: string
  discount_total: string
  tax_total: string
  shipping_total: string
  grand_total: string
  items: Array<{
    /** Solo en el detalle del consumidor: hace falta para volver a comprar. */
    product_id?: string | null
    variant_id?: string | null
    name: string
    sku: string | null
    variant_label: string | null
    quantity: number
    unit_price: string
    total: string
  }>
  /** Solo en el detalle del consumidor (H03). El portal B2B no la devuelve. */
  shipping_address?: Record<string, unknown> | null
  deliveries?: Array<{ method_name: string | null; state: string | null }>
}

async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data as T
}

export async function fetchMyOrders(limit = 50): Promise<MyOrder[]> {
  return rpc<MyOrder[]>(MY_ORDERS_RPC, { p_only_pending: false, p_limit: limit })
}

export async function fetchMyStatement(): Promise<AccountStatement[]> {
  return rpc<AccountStatement[]>(MY_STATEMENT_RPC)
}

export async function fetchMyCoupons(storeId: string): Promise<MyCoupon[]> {
  return rpc<MyCoupon[]>(MY_COUPONS_RPC, { p_store_id: storeId })
}

export async function fetchMyOrderDetail(orderId: string): Promise<MyOrderDetail> {
  return rpc<MyOrderDetail>(MY_ORDER_DETAIL_RPC, { p_order_id: orderId })
}

// ---------------------------------------------------------------------------
// Hooks. Claves por seccion: el estado de cuenta y los cupones cambian a ritmos
// distintos que los pedidos, y mezclarlos en una sola clave obligaria a
// recargar los tres cuando solo cambia uno.
// ---------------------------------------------------------------------------
export const myOrdersKey = () => ['storefront', 'my-orders'] as const
export const myStatementKey = () => ['storefront', 'my-statement'] as const
export const myCouponsKey = (storeId: string) => ['storefront', 'my-coupons', storeId] as const
export const myOrderDetailKey = (orderId: string) =>
  ['storefront', 'my-order', orderId] as const

// ---------------------------------------------------------------------------
// Sugeridos de pedido, del lado del comprador
// ---------------------------------------------------------------------------

export const MY_SUGGESTIONS_RPC = 'my_order_suggestions'
export const ACCEPT_SUGGESTION_RPC = 'accept_order_suggestion'
export const DISCARD_SUGGESTION_RPC = 'discard_order_suggestion'

export interface MySuggestionItem {
  product_id: string
  variant_id: string | null
  name: string
  sku: string
  /** Decimal como texto, tal como lo guarda la base. */
  quantity: string
  reason: string
}

export interface MySuggestion {
  id: string
  store_id: string
  generated_at: string
  customer_name: string
  items: MySuggestionItem[]
}

/** Los sugeridos ENVIADOS a la empresa del comprador. Sin argumentos: sale del token. */
export async function fetchMySuggestions(): Promise<MySuggestion[]> {
  return rpc<MySuggestion[]>(MY_SUGGESTIONS_RPC)
}

/**
 * Aceptar marca el sugerido y devuelve las líneas para el CARRITO.
 *
 * No crea un pedido, y es la regla de la frontera de planificación: el pedido
 * lo confirma el comprador en el checkout de siempre, con el precio y el stock
 * de ese momento.
 */
export async function acceptSuggestion(
  suggestionId: string,
): Promise<Array<{ product_id: string; variant_id: string | null; quantity: string }>> {
  return rpc(ACCEPT_SUGGESTION_RPC, { p_suggestion_id: suggestionId })
}

export async function discardSuggestion(suggestionId: string): Promise<void> {
  await rpc(DISCARD_SUGGESTION_RPC, { p_suggestion_id: suggestionId })
}
