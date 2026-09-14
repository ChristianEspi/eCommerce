import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'
import { ORDER_APPROVAL_DECIDE_RPC } from '@/shared/lib/db-schema'
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
  /** Cierre · item 2 (migración 20260914110000). Ausente contra una base anterior. */
  purchase_order_number?: string | null
  /** Solo llega a quien puede decidir; para el resto el servidor manda `null`. */
  buyer_email?: string | null
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
  /** N05 · Solo en el detalle del portal B2B: la orden de compra del pedido. */
  purchase_order_number?: string | null
  /**
   * Cierre · item 2 · Solo en el detalle del portal B2B (migración
   * 20260914110000). `can_decide` lo resuelve el servidor con la misma regla
   * que el candado de `order_approval_decide`; aquí solo se pinta.
   */
  approval_status?: string | null
  can_decide?: boolean
  approval_decided_at?: string | null
  approval_decided_email?: string | null
  approval_reason?: string | null
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
// Bandeja de aprobaciones del comprador B2B (cierre, item 2)
//
// La cola es la MISMA función que «Mis pedidos» con `p_only_pending = true`, y
// la decisión es el MISMO comando que usa el backoffice. No hay un segundo
// motor de aprobación ni un id de cuenta en ninguna de las dos llamadas: quién
// puede decidir lo resuelve el servidor por vínculo.
// ---------------------------------------------------------------------------
export const DECIDE_APPROVAL_RPC = ORDER_APPROVAL_DECIDE_RPC

/** Bajo `my-orders` a propósito: invalidar la lista refresca también la bandeja. */
export const myApprovalsKey = () => ['storefront', 'my-orders', 'pending-approval'] as const

export async function fetchMyPendingApprovals(limit = 100): Promise<MyOrder[]> {
  return rpc<MyOrder[]>(MY_ORDERS_RPC, { p_only_pending: true, p_limit: limit })
}

export interface ApprovalDecision {
  order_id: string
  order_number: string
  approval_status: string
  status: string
  decided_at: string | null
  /** `true` = reintento de una decisión que ya estaba puesta (idempotencia). */
  already_decided?: boolean
}

/**
 * Error de la bandeja con la clave de i18n ya resuelta. La pantalla nunca ve el
 * texto de Postgres: solo el código, traducido aquí.
 */
export class ApprovalError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'orders', key, code })
    this.name = 'ApprovalError'
  }
}

export function mapApprovalCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case 'OPERADOR_NO_ES_ACTOR':
    case '42501':
      return 'account.approvals.error.forbidden'
    // El pedido ya no espera firma: lo decidió otra persona, o se pide lo
    // contrario de lo que ya se firmó. La lista se refresca y el aviso lo dice.
    case 'APROBACION_NO_APLICA':
      return 'account.approvals.error.notApplicable'
    case 'MOTIVO_REQUERIDO':
      return 'account.approvals.error.reasonRequired'
    case 'PEDIDO_NO_ENCONTRADO':
      return 'account.approvals.error.notFound'
    default:
      return 'account.approvals.error.generic'
  }
}

/**
 * Aprobar o rechazar. Solo viajan el pedido, el sentido y el motivo: ni cuenta,
 * ni tenant, ni rol. Rechazar sin motivo se corta aquí para no gastar una ida
 * al servidor que ya se sabe que vuelve con `MOTIVO_REQUERIDO`.
 */
export async function decideMyOrderApproval(input: {
  orderId: string
  approve: boolean
  reason?: string | null
}): Promise<ApprovalDecision> {
  const reason = input.reason?.trim() ?? ''
  if (!input.approve && reason === '') {
    throw new ApprovalError(mapApprovalCode('MOTIVO_REQUERIDO'), 'MOTIVO_REQUERIDO')
  }
  try {
    return await rpc<ApprovalDecision>(DECIDE_APPROVAL_RPC, {
      p_order_id: input.orderId,
      p_approve: input.approve,
      p_reason: reason === '' ? null : reason,
    })
  } catch (error) {
    const code = codeFromDbError(error as PostgrestLike)
    throw new ApprovalError(mapApprovalCode(code), code)
  }
}

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
