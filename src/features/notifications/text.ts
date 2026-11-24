import type { MessageKey } from '@/shared/i18n/messages'
import type { AppNotification } from './api'

/**
 * De un aviso guardado al texto que se lee.
 *
 * La base guarda el TIPO y unos pocos datos, nunca la frase: así el mismo aviso
 * se lee en español o en inglés según quien lo mire, y cambiar una redacción no
 * exige tocar filas ya escritas.
 *
 * La tabla de abajo es cerrada a propósito. Un tipo nuevo que la base empiece a
 * generar sin texto aquí cae en «Tienes un aviso nuevo» en vez de enseñar una
 * clave técnica, y la prueba de este módulo exige que cada tipo que produce la
 * base tenga su texto.
 */
const KIND_KEY: Record<string, MessageKey> = {
  'order.received': 'notifications.kind.orderReceived',
  'order.approval_requested': 'notifications.kind.orderApprovalRequested',
  'order.payment_failed': 'notifications.kind.orderPaymentFailed',
  'return.requested': 'notifications.kind.returnRequested',
  'integration.circuit_opened': 'notifications.kind.integrationDown',
  'member.access_granted': 'notifications.kind.memberGranted',
  'member.role_changed': 'notifications.kind.memberRoleChanged',
  'suggestion.generated': 'notifications.kind.suggestionGenerated',
  'order.confirmed': 'notifications.kind.orderConfirmed',
  'order.approval_pending': 'notifications.kind.orderApprovalPending',
  'order.approved': 'notifications.kind.orderApproved',
  'order.rejected': 'notifications.kind.orderRejected',
  'order.shipped': 'notifications.kind.orderShipped',
  'order.delivered': 'notifications.kind.orderDelivered',
  'business_account.invited': 'notifications.kind.accountInvited',
  'business_account.activated': 'notifications.kind.accountActivated',
  'suggestion.sent': 'notifications.kind.suggestionSent',
  // Cierre 4: lo genera `ebim.run_order_schedules`, no el reparto de eventos.
  'order_schedule.run_ready': 'notifications.kind.orderScheduleReady',
  // 2026-11-22: lo genera `ebim.notify_quote_requested` (vitrina: pedir cotización o mejor precio).
  'quote.requested': 'notifications.kind.quoteRequested',
}

export const KNOWN_KINDS = Object.freeze(Object.keys(KIND_KEY))

const ROLE_KEY: Record<string, MessageKey> = {
  owner: 'settings.members.role.owner',
  admin: 'settings.members.role.admin',
  catalog: 'settings.members.role.catalog',
  orders: 'settings.members.role.orders',
  viewer: 'settings.members.role.viewer',
}

export function notificationText(
  notification: Pick<AppNotification, 'kind' | 'params'>,
  t: (key: MessageKey) => string,
): string {
  const key = KIND_KEY[notification.kind]
  if (!key) return t('notifications.kind.unknown')

  const p = notification.params
  const valor = (name: string) => {
    const v = p[name]
    return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
  }
  const rol = valor('role')

  return t(key)
    .replace('{order_number}', valor('order_number'))
    .replace('{quote_number}', valor('quote_number'))
    .replace('{grand_total}', valor('grand_total'))
    .replace('{currency}', valor('currency'))
    .replace('{account_name}', valor('account_name'))
    .replace('{customer_name}', valor('customer_name'))
    .replace('{provider_code}', valor('provider_code'))
    .replace('{template_name}', valor('template_name'))
    .replace('{role}', ROLE_KEY[rol] ? t(ROLE_KEY[rol]) : rol)
}

/** Una ruta interna segura: empieza por `/` y no por `//` (que saldría a otro dominio). */
function rutaInterna(link: string | null | undefined): link is string {
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//')
}

/**
 * A dónde lleva un aviso al pulsarlo (2026-11-24).
 *
 * Manda el enlace que guardó la base. Si un aviso antiguo se guardó sin él, se
 * deduce de su tipo y sus datos, para que TODOS los avisos lleven a algún sitio
 * en vez de cerrarse sin más. Solo se construyen rutas internas.
 */
export function notificationHref(
  notification: Pick<AppNotification, 'kind' | 'params' | 'link'>,
): string | null {
  if (rutaInterna(notification.link)) return notification.link

  const p = notification.params
  const texto = (name: string) => {
    const v = p[name]
    return typeof v === 'string' && v !== '' ? encodeURIComponent(v) : ''
  }
  const tienda = texto('store_slug')
  const cuenta = tienda ? `/s/${tienda}/account` : ''

  switch (notification.kind) {
    case 'order.received':
    case 'order.approval_requested':
    case 'order.payment_failed':
    case 'return.requested':
      return texto('order_id') ? `/app/orders?order=${texto('order_id')}` : '/app/orders'
    case 'quote.requested':
      return texto('quote_number') ? `/app/quotes?q=${texto('quote_number')}` : '/app/quotes'
    case 'integration.circuit_opened':
      return '/app/integrations'
    case 'member.access_granted':
    case 'member.role_changed':
      return '/app'
    case 'suggestion.generated':
      return '/app/planning'
    case 'order.confirmed':
    case 'order.approval_pending':
    case 'order.approved':
    case 'order.rejected':
    case 'order.shipped':
    case 'order.delivered':
      if (!cuenta) return null
      return texto('order_number') ? `${cuenta}?pedido=${texto('order_number')}#pedidos` : `${cuenta}#pedidos`
    case 'suggestion.sent':
      return cuenta ? `${cuenta}#sugeridos` : null
    case 'order_schedule.run_ready':
      return cuenta ? `${cuenta}#programados` : null
    case 'business_account.invited':
    case 'business_account.activated':
      return cuenta || null
    default:
      return null
  }
}
