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
    .replace('{grand_total}', valor('grand_total'))
    .replace('{currency}', valor('currency'))
    .replace('{account_name}', valor('account_name'))
    .replace('{customer_name}', valor('customer_name'))
    .replace('{provider_code}', valor('provider_code'))
    .replace('{role}', ROLE_KEY[rol] ? t(ROLE_KEY[rol]) : rol)
}
