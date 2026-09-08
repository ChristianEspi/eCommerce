import type { MessageKey } from '@/shared/i18n/messages'
import type {
  ApprovalStatus,
  FulfillmentStatus,
  OrderAxis,
  OrderEventSource,
  OrderSource,
  OrderStatus,
  PaymentStatus,
} from './types'

/**
 * Etiquetas y color de cada estado. Una sola tabla por eje, usada por el
 * listado y por el detalle: dos tablas se separan el día que alguien añade un
 * estado en una de ellas.
 */
export const STATUS_LABEL: Record<OrderStatus, MessageKey> = {
  pending: 'orders.status.pending',
  paid: 'orders.status.paid',
  fulfilled: 'orders.status.fulfilled',
  cancelled: 'orders.status.cancelled',
  refunded: 'orders.status.refunded',
}

export type StatusColor = 'default' | 'info' | 'success' | 'warning' | 'error'

export const STATUS_COLOR: Record<OrderStatus, StatusColor> = {
  pending: 'warning',
  paid: 'info',
  fulfilled: 'success',
  cancelled: 'default',
  refunded: 'error',
}

export const PAYMENT_LABEL: Record<PaymentStatus, MessageKey> = {
  pending: 'orders.payment.pending',
  authorized: 'orders.payment.authorized',
  paid: 'orders.payment.paid',
  partially_refunded: 'orders.payment.partiallyRefunded',
  refunded: 'orders.payment.refunded',
  failed: 'orders.payment.failed',
  voided: 'orders.payment.voided',
}

export const PAYMENT_COLOR: Record<PaymentStatus, StatusColor> = {
  pending: 'warning',
  authorized: 'info',
  paid: 'success',
  partially_refunded: 'warning',
  refunded: 'error',
  failed: 'error',
  voided: 'default',
}

export const FULFILLMENT_LABEL: Record<FulfillmentStatus, MessageKey> = {
  unfulfilled: 'orders.fulfillment.unfulfilled',
  in_progress: 'orders.fulfillment.inProgress',
  partially_fulfilled: 'orders.fulfillment.partiallyFulfilled',
  fulfilled: 'orders.fulfillment.fulfilled',
  returned: 'orders.fulfillment.returned',
  cancelled: 'orders.fulfillment.cancelled',
}

export const FULFILLMENT_COLOR: Record<FulfillmentStatus, StatusColor> = {
  unfulfilled: 'default',
  in_progress: 'info',
  partially_fulfilled: 'warning',
  fulfilled: 'success',
  returned: 'error',
  cancelled: 'default',
}

export const APPROVAL_LABEL: Record<ApprovalStatus, MessageKey> = {
  not_required: 'orders.approval.notRequired',
  pending: 'orders.approval.pending',
  approved: 'orders.approval.approved',
  rejected: 'orders.approval.rejected',
}

export const APPROVAL_COLOR: Record<ApprovalStatus, StatusColor> = {
  not_required: 'default',
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
}

export const SOURCE_LABEL: Record<OrderSource, MessageKey> = {
  storefront: 'orders.source.storefront',
  backoffice: 'orders.source.backoffice',
  api: 'orders.source.api',
  import: 'orders.source.import',
  scheduled: 'orders.source.scheduled',
  repeat: 'orders.source.repeat',
}

export const EVENT_SOURCE_LABEL: Record<OrderEventSource, MessageKey> = {
  storefront: 'orders.history.storefront',
  backoffice: 'orders.history.backoffice',
  system: 'orders.history.system',
  api: 'orders.history.api',
  import: 'orders.history.import',
}

export const AXIS_LABEL: Record<OrderAxis, MessageKey> = {
  order_status: 'orders.axis.order',
  payment_status: 'orders.axis.payment',
  fulfillment_status: 'orders.axis.fulfillment',
}

/**
 * Etiqueta de un valor de estado sea cual sea su eje.
 *
 * Existe para la línea de tiempo, que pinta transiciones de los cuatro ejes en
 * un solo hilo y recibe el eje y el valor como texto. El fallback es el valor
 * crudo: un estado que la base ya tiene y este bundle todavía no se lee feo,
 * pero se lee — que es mejor que una fila vacía.
 */
export function valueLabel(axis: string | null, value: string | null): MessageKey | string {
  if (!value) return '—'
  if (axis === 'order_status') return STATUS_LABEL[value as OrderStatus] ?? value
  if (axis === 'payment_status') return PAYMENT_LABEL[value as PaymentStatus] ?? value
  if (axis === 'fulfillment_status') return FULFILLMENT_LABEL[value as FulfillmentStatus] ?? value
  if (axis === 'approval_status') return APPROVAL_LABEL[value as ApprovalStatus] ?? value
  return value
}

/**
 * Texto del titular de un evento que NO es un cambio de estado.
 *
 * Los `fulfillment.*`, `shipment.*` y `return.*` los escribe
 * `ebim.log_order_fact` sin `axis`, porque no mueven ninguno de los cuatro ejes
 * del pedido. Sin ellos aquí caían todos en el mismo cajón —«Movimiento del
 * pedido»—, que es la respuesta que no sirve: un pedido preparado, empaquetado
 * y enviado se leía como tres líneas idénticas.
 */
export const EVENT_TYPE_LABEL: Record<string, MessageKey> = {
  'order.created': 'orders.history.created',
  'order.details_updated': 'orders.history.detailsUpdated',
  'order.approval_requested': 'orders.history.approvalRequested',
  'order.approval_decided': 'orders.history.approvalDecided',
  'fulfillment.created': 'fulfillment.event.created',
  'fulfillment.assigned': 'fulfillment.event.assigned',
  'fulfillment.state_changed': 'fulfillment.event.stateChanged',
  'fulfillment.delivered': 'fulfillment.event.delivered',
  'shipment.opened': 'fulfillment.event.shipmentOpened',
  'shipment.updated': 'fulfillment.event.shipmentUpdated',
  'shipment.tracking': 'fulfillment.event.shipmentTracking',
  'return.requested': 'orders.history.returnRequested',
  'return.inspected': 'orders.history.returnInspected',
  'return.completed': 'orders.history.returnCompleted',
}

/**
 * De qué habla un hecho sin eje, para la pastilla de la línea de tiempo.
 *
 * Las filas con eje ya llevan la suya —Pedido, Pago, Entrega— y sin esto los
 * hechos quedaban como las únicas líneas sin decir de qué parte del pedido
 * hablan, mezcladas en el mismo hilo.
 */
export const EVENT_SCOPE_LABEL: Record<string, MessageKey> = {
  'fulfillment.created': 'orders.axis.fulfillment',
  'fulfillment.assigned': 'orders.axis.fulfillment',
  'fulfillment.state_changed': 'orders.axis.fulfillment',
  'fulfillment.delivered': 'orders.axis.fulfillment',
  'shipment.opened': 'orders.axis.fulfillment',
  'shipment.updated': 'orders.axis.fulfillment',
  'shipment.tracking': 'orders.axis.fulfillment',
  'return.requested': 'orders.history.returns',
  'return.inspected': 'orders.history.returns',
  'return.completed': 'orders.history.returns',
}

/**
 * El destino de un hecho de logística, que NO está en `to_value`.
 *
 * Esa columna es de los ejes del pedido y `ebim.log_order_fact` la deja nula;
 * el estado viaja en `payload`. Sin esto, cinco pasos seguidos de la entrega se
 * leían como cinco «Cambio de estado» iguales.
 */
export function factMove(
  eventType: string,
  payload: Record<string, unknown>,
): { from: MessageKey | null; to: MessageKey } | null {
  if (eventType !== 'fulfillment.state_changed') return null
  const to = payload.to
  if (typeof to !== 'string') return null
  const from = payload.from
  return {
    from: typeof from === 'string' ? (`fulfillment.state.${from}` as MessageKey) : null,
    to: `fulfillment.state.${to}` as MessageKey,
  }
}
