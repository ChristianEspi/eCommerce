/**
 * Espejo del vocabulario de hechos que publica el dominio. Cerrado a propósito:
 * suscribirse a `order.creted` con una errata produce un destino que nunca
 * recibe nada. Lo usan el formulario de webhooks y la guía pública de la API
 * (`/api`), para que las dos digan lo mismo.
 */
export const WEBHOOK_EVENT_TYPES = [
  // 2026-11-12 · Solo lo que `domain_events` publica de verdad (comprobado en
  // QAS). Antes ofrecía `shipment.dispatched` y `shipment.delivered`, que no se
  // emiten nunca: un destino suscrito a ellos no recibía nada y nadie sabía por qué.
  'order.*',
  'order.created',
  'order.status_changed',
  'order.payment_status_changed',
  'order.fulfillment_status_changed',
  'order.approval_requested',
  'order.approval_decided',
  'payment.*',
  'payment.captured',
  'payment.failed',
  'fulfillment.*',
  'fulfillment.created',
  // 2026-11-20 · Cada paso de la entrega (empacada, lista, en camino…).
  'fulfillment.state_changed',
  'fulfillment.delivered',
  'return.*',
  'return.requested',
  'return.approved',
  'return.completed',
  'quote.*',
  'quote.requested',
  'quote.accepted',
  'quote.converted',
] as const
