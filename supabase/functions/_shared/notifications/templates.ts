/**
 * Plantillas de correo: de un `kind` y unos parámetros a asunto y cuerpo.
 *
 * ## Por qué aquí y no en el dominio
 *
 * El puerto de avisos fija que se envía una PLANTILLA con variables y nunca un
 * cuerpo compuesto en el dominio. El reparto de la base solo dice
 * `order.confirmed` y pasa el número de pedido; el texto, el idioma y la marca
 * se deciden aquí, y se cambian sin tocar una migración.
 *
 * ## La marca del comercio va DENTRO
 *
 * El remitente es «eCommerce by EBIM», como exige el contrato §14. Pero quien
 * compra en Química Suiza no conoce a EBIM, así que el correo abre con el
 * nombre y el logo de la tienda. Es la decisión 2 del análisis.
 *
 * ## Todo se escapa
 *
 * Los parámetros vienen de datos que escribió alguien: el nombre de una tienda,
 * el motivo de un rechazo. Un `<script>` en el nombre de la tienda no puede
 * acabar dentro del HTML de un correo.
 */

export type Locale = 'es' | 'en'

export interface RenderedEmail {
  readonly subject: string
  readonly html: string
}

type Params = Readonly<Record<string, unknown>>

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const text = (params: Params, key: string): string => {
  const value = params[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** Solo `http(s)`: un `javascript:` en un botón de correo es exactamente lo que no puede salir. */
export function isSafeAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const ROLE_LABEL: Record<Locale, Record<string, string>> = {
  es: {
    owner: 'Propietario',
    admin: 'Administrador',
    catalog: 'Catálogo',
    orders: 'Pedidos',
    viewer: 'Solo lectura',
    sales_rep: 'Vendedor',
  },
  en: {
    owner: 'Owner',
    admin: 'Administrator',
    catalog: 'Catalog',
    orders: 'Orders',
    viewer: 'Read only',
    sales_rep: 'Sales rep',
  },
}

interface Copy {
  readonly subject: string
  readonly title: string
  readonly body: string
  readonly action: string
  readonly note?: string
}

/**
 * Los textos. Cada función recibe los parámetros YA escapados en lo que va a
 * HTML; el asunto se arma con los valores en claro, porque no es HTML.
 */
type CopyBuilder = (p: Params, locale: Locale, esc: (key: string) => string) => Copy

const COPY: Record<string, Record<Locale, CopyBuilder>> = {
  'order.confirmed': {
    es: (p, _l, e) => ({
      subject: `Recibimos tu pedido ${text(p, 'order_number')}`,
      title: 'Recibimos tu pedido',
      body: `Tu pedido <strong>${e('order_number')}</strong> por <strong>${e('grand_total')} ${e('currency')}</strong> quedó registrado. Te avisaremos cuando salga.`,
      action: 'Ver mi pedido',
    }),
    en: (p, _l, e) => ({
      subject: `We received your order ${text(p, 'order_number')}`,
      title: 'We received your order',
      body: `Your order <strong>${e('order_number')}</strong> for <strong>${e('grand_total')} ${e('currency')}</strong> is confirmed. We will let you know when it ships.`,
      action: 'View my order',
    }),
  },
  'order.approval_requested': {
    es: (p, _l, e) => ({
      subject: `Pedido ${text(p, 'order_number')} espera aprobación`,
      title: 'Un pedido espera tu aprobación',
      body: `El pedido <strong>${e('order_number')}</strong> por <strong>${e('grand_total')} ${e('currency')}</strong> está detenido hasta que alguien lo apruebe o lo rechace. Mientras tanto no se cobra ni se prepara.`,
      action: 'Revisar el pedido',
    }),
    en: (p, _l, e) => ({
      subject: `Order ${text(p, 'order_number')} awaits approval`,
      title: 'An order is waiting for your approval',
      body: `Order <strong>${e('order_number')}</strong> for <strong>${e('grand_total')} ${e('currency')}</strong> is on hold until someone approves or rejects it. It will not be charged or prepared until then.`,
      action: 'Review the order',
    }),
  },
  'order.approved': {
    es: (p, _l, e) => ({
      subject: `Tu pedido ${text(p, 'order_number')} fue aprobado`,
      title: 'Tu pedido fue aprobado',
      body: `El pedido <strong>${e('order_number')}</strong> ya tiene la aprobación que necesitaba y sigue su curso.`,
      action: 'Ver mi pedido',
    }),
    en: (p, _l, e) => ({
      subject: `Your order ${text(p, 'order_number')} was approved`,
      title: 'Your order was approved',
      body: `Order <strong>${e('order_number')}</strong> has the approval it needed and is moving forward.`,
      action: 'View my order',
    }),
  },
  'order.rejected': {
    es: (p, _l, e) => ({
      subject: `Tu pedido ${text(p, 'order_number')} no fue aprobado`,
      title: 'Tu pedido no fue aprobado',
      body: `El pedido <strong>${e('order_number')}</strong> fue rechazado${text(p, 'reason') ? ` con este motivo: <em>${e('reason')}</em>` : ''}. No se cobró nada.`,
      action: 'Ver mi pedido',
    }),
    en: (p, _l, e) => ({
      subject: `Your order ${text(p, 'order_number')} was not approved`,
      title: 'Your order was not approved',
      body: `Order <strong>${e('order_number')}</strong> was rejected${text(p, 'reason') ? ` with this reason: <em>${e('reason')}</em>` : ''}. Nothing was charged.`,
      action: 'View my order',
    }),
  },
  'order.shipped': {
    es: (p, _l, e) => ({
      subject: `Tu pedido ${text(p, 'order_number')} está en camino`,
      title: 'Tu pedido está en camino',
      body: `El pedido <strong>${e('order_number')}</strong> ya salió.`,
      action: 'Ver mi pedido',
    }),
    en: (p, _l, e) => ({
      subject: `Your order ${text(p, 'order_number')} is on its way`,
      title: 'Your order is on its way',
      body: `Order <strong>${e('order_number')}</strong> has shipped.`,
      action: 'View my order',
    }),
  },
  'member.access_granted': {
    es: (p, l) => ({
      subject: 'Te dieron acceso al backoffice',
      title: 'Te dieron acceso',
      body: `Ya puedes entrar al backoffice con el rol <strong>${escapeHtml(ROLE_LABEL[l][text(p, 'role')] ?? text(p, 'role'))}</strong>.`,
      action: 'Entrar',
    }),
    en: (p, l) => ({
      subject: 'You were given access to the back office',
      title: 'You were given access',
      body: `You can now sign in to the back office with the <strong>${escapeHtml(ROLE_LABEL[l][text(p, 'role')] ?? text(p, 'role'))}</strong> role.`,
      action: 'Sign in',
    }),
  },
  'member.role_changed': {
    es: (p, l) => ({
      subject: 'Cambió tu rol en el backoffice',
      title: 'Cambió tu rol',
      body: `Tu rol ahora es <strong>${escapeHtml(ROLE_LABEL[l][text(p, 'role')] ?? text(p, 'role'))}</strong>. Lo que puedes ver y cambiar se ajustó a ese rol.`,
      action: 'Entrar',
      note: 'Si no esperabas este cambio, avisa a quien administra la tienda.',
    }),
    en: (p, l) => ({
      subject: 'Your back office role changed',
      title: 'Your role changed',
      body: `Your role is now <strong>${escapeHtml(ROLE_LABEL[l][text(p, 'role')] ?? text(p, 'role'))}</strong>. What you can see and change now follows that role.`,
      action: 'Sign in',
      note: 'If you did not expect this change, tell whoever runs the store.',
    }),
  },
  'member.access_revoked': {
    es: () => ({
      subject: 'Se retiró tu acceso al backoffice',
      title: 'Se retiró tu acceso',
      body: 'Ya no puedes entrar al backoffice de esta tienda.',
      action: '',
      note: 'Si crees que es un error, avisa a quien administra la tienda.',
    }),
    en: () => ({
      subject: 'Your back office access was removed',
      title: 'Your access was removed',
      body: 'You can no longer sign in to this store’s back office.',
      action: '',
      note: 'If you think this is a mistake, tell whoever runs the store.',
    }),
  },
  'business_account.invited': {
    es: (p, _l, e) => ({
      subject: `Te vincularon a ${text(p, 'account_name')}`,
      title: 'Te vincularon a una empresa',
      body: `Te vincularon a <strong>${e('account_name')}</strong>. Tu acceso está pendiente de activación: cuando lo activen podrás comprar a nombre de la empresa.`,
      action: 'Ir a la tienda',
    }),
    en: (p, _l, e) => ({
      subject: `You were linked to ${text(p, 'account_name')}`,
      title: 'You were linked to a company',
      body: `You were linked to <strong>${e('account_name')}</strong>. Your access is waiting for activation; once it is active you can buy on behalf of the company.`,
      action: 'Go to the store',
    }),
  },
  'business_account.activated': {
    es: (p, _l, e) => ({
      subject: `Ya puedes comprar a nombre de ${text(p, 'account_name')}`,
      title: 'Tu acceso está activo',
      body: `Ya puedes comprar a nombre de <strong>${e('account_name')}</strong>.`,
      action: 'Ir a mi cuenta',
    }),
    en: (p, _l, e) => ({
      subject: `You can now buy on behalf of ${text(p, 'account_name')}`,
      title: 'Your access is active',
      body: `You can now buy on behalf of <strong>${e('account_name')}</strong>.`,
      action: 'Go to my account',
    }),
  },
  'integration.circuit_opened': {
    es: (p, _l, e) => ({
      subject: `Una integración dejó de responder: ${text(p, 'provider_code')}`,
      title: 'Una integración dejó de responder',
      body: `La integración <strong>${e('provider_code')}</strong> falló varias veces seguidas en <strong>${e('operation')}</strong> y se pausó para no insistir. Lo pendiente queda en cola.`,
      action: 'Ver integraciones',
    }),
    en: (p, _l, e) => ({
      subject: `An integration stopped responding: ${text(p, 'provider_code')}`,
      title: 'An integration stopped responding',
      body: `The <strong>${e('provider_code')}</strong> integration failed repeatedly on <strong>${e('operation')}</strong> and was paused. Pending work stays queued.`,
      action: 'View integrations',
    }),
  },
  'suggestion.sent': {
    es: () => ({
      subject: 'Tienes un pedido sugerido para revisar',
      title: 'Tienes un pedido sugerido',
      body: 'Preparamos una propuesta de pedido a partir de lo que tu empresa ya compró. Revísala y, si te sirve, pásala al carrito.',
      action: 'Ver el sugerido',
    }),
    en: () => ({
      subject: 'You have a suggested order to review',
      title: 'You have a suggested order',
      body: 'We prepared an order proposal based on what your company already bought. Review it and, if it works for you, move it to your cart.',
      action: 'View the suggestion',
    }),
  },
  'mail.test': {
    es: () => ({
      subject: 'Prueba de correo de eCommerce',
      title: 'El correo funciona',
      body: 'Si lees esto, el envío por Microsoft Graph está bien configurado.',
      action: 'Abrir el backoffice',
    }),
    en: () => ({
      subject: 'eCommerce email test',
      title: 'Email is working',
      body: 'If you are reading this, sending through Microsoft Graph is configured correctly.',
      action: 'Open the back office',
    }),
  },
  'auth.recovery': {
    es: () => ({
      subject: 'Restablece tu contraseña',
      title: 'Restablece tu contraseña',
      body: 'Alguien pidió cambiar la contraseña de esta cuenta. Para elegir una nueva, pulsa el botón.',
      action: 'Elegir una nueva contraseña',
      note: 'Si no fuiste tú, ignora este correo: tu contraseña no cambia hasta que alguien use este enlace.',
    }),
    en: () => ({
      subject: 'Reset your password',
      title: 'Reset your password',
      body: 'Someone asked to change the password for this account. Press the button to choose a new one.',
      action: 'Choose a new password',
      note: 'If it was not you, ignore this email: your password does not change until someone uses this link.',
    }),
  },
  'auth.signup': {
    es: () => ({
      subject: 'Confirma tu correo',
      title: 'Confirma tu correo',
      body: 'Se creó una cuenta con este correo. Para activarla, confirma que es tuyo.',
      action: 'Confirmar mi correo',
      note: 'Si no creaste ninguna cuenta, ignora este correo.',
    }),
    en: () => ({
      subject: 'Confirm your email',
      title: 'Confirm your email',
      body: 'An account was created with this email. Confirm it is yours to activate it.',
      action: 'Confirm my email',
      note: 'If you did not create an account, ignore this email.',
    }),
  },
  'auth.invite': {
    es: () => ({
      subject: 'Te dieron acceso',
      title: 'Te dieron acceso',
      body: 'Te invitaron a entrar. Pulsa el botón para aceptar la invitación y elegir tu contraseña.',
      action: 'Aceptar la invitación',
    }),
    en: () => ({
      subject: 'You were given access',
      title: 'You were given access',
      body: 'You were invited to sign in. Press the button to accept and choose your password.',
      action: 'Accept the invitation',
    }),
  },
  'auth.magiclink': {
    es: () => ({
      subject: 'Tu enlace para entrar',
      title: 'Tu enlace para entrar',
      body: 'Pediste entrar sin contraseña. Pulsa el botón para iniciar sesión.',
      action: 'Entrar',
      note: 'Si no lo pediste, ignora este correo. El enlace sirve una sola vez.',
    }),
    en: () => ({
      subject: 'Your sign-in link',
      title: 'Your sign-in link',
      body: 'You asked to sign in without a password. Press the button to sign in.',
      action: 'Sign in',
      note: 'If you did not ask for it, ignore this email. The link works once.',
    }),
  },
  'auth.email_change': {
    es: () => ({
      subject: 'Confirma tu nuevo correo',
      title: 'Confirma tu nuevo correo',
      body: 'Pediste cambiar el correo de tu cuenta. Pulsa el botón para confirmarlo.',
      action: 'Confirmar el cambio',
      note: 'Si no pediste este cambio, ignora este correo.',
    }),
    en: () => ({
      subject: 'Confirm your new email',
      title: 'Confirm your new email',
      body: 'You asked to change your account email. Press the button to confirm.',
      action: 'Confirm the change',
      note: 'If you did not ask for this change, ignore this email.',
    }),
  },
}

/** Las plantillas que existen. El reparto de la base no puede usar otra. */
export const TEMPLATE_KINDS = Object.freeze(Object.keys(COPY))

const STOREFRONT_KINDS = new Set([
  'order.confirmed',
  'order.approved',
  'order.rejected',
  'order.shipped',
  'business_account.invited',
  'business_account.activated',
  'suggestion.sent',
])

/**
 * A dónde lleva el botón.
 *
 * Tienda: la cuenta del comprador en la tienda que corresponde. Backoffice: la
 * ruta que dejó el reparto. Auth: el enlace que genera Supabase. Si no se puede
 * construir un enlace seguro, el correo sale sin botón antes que con uno roto.
 */
export function actionUrl(kind: string, params: Params, baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, '')
  if (kind.startsWith('auth.')) {
    const url = text(params, 'action_url')
    return isSafeAbsoluteUrl(url) ? url : null
  }
  if (!isSafeAbsoluteUrl(base)) return null
  if (STOREFRONT_KINDS.has(kind)) {
    const slug = text(params, 'store_slug')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null
    return `${base}/s/${slug}/account${kind === 'suggestion.sent' ? '#sugeridos' : ''}`
  }
  if (kind === 'mail.test') return `${base}/app`
  const path = text(params, 'path')
  return /^\/[A-Za-z0-9/_?=&#.%-]*$/.test(path) && !path.startsWith('//') ? `${base}${path}` : null
}

export function renderEmail(
  kind: string,
  locale: string,
  params: Params,
  baseUrl: string,
): RenderedEmail | null {
  const builders = COPY[kind]
  if (!builders) return null
  const lang: Locale = locale === 'en' ? 'en' : 'es'
  const esc = (key: string) => escapeHtml(text(params, key))
  const copy = builders[lang](params, lang, esc)
  const href = copy.action ? actionUrl(kind, params, baseUrl) : null

  const storeName = text(params, 'store_name')
  const logo = text(params, 'store_logo')
  const logoOk = logo.startsWith('https://')
  const footer =
    lang === 'es'
      ? storeName
        ? `Enviado por eCommerce by EBIM en nombre de ${escapeHtml(storeName)}.`
        : 'Enviado por eCommerce by EBIM.'
      : storeName
        ? `Sent by eCommerce by EBIM on behalf of ${escapeHtml(storeName)}.`
        : 'Sent by eCommerce by EBIM.'

  const header = storeName
    ? `<tr><td style="padding:24px 32px 0 32px;">${
        logoOk
          ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(storeName)}" height="36" style="display:block;height:36px;max-width:180px;border:0;" />`
          : `<div style="font-size:16px;font-weight:700;color:#1c2421;">${escapeHtml(storeName)}</div>`
      }</td></tr>`
    : ''

  const button = href
    ? `<tr><td style="padding:8px 32px 24px 32px;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#056769;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(copy.action)}</a></td></tr>`
    : ''

  const fallback = href
    ? `<p style="margin:0;font-size:12px;line-height:1.6;color:#55615c;word-break:break-all;">${
        lang === 'es' ? 'Si el botón no funciona, copia esta dirección:' : 'If the button does not work, copy this address:'
      }<br />${escapeHtml(href)}</p>`
    : ''

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(copy.title)}</title></head><body style="margin:0;padding:0;background:#f4f6f5;font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#1c2421;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8e5;">${header}<tr><td style="padding:24px 32px 8px 32px;"><h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:#1c2421;">${escapeHtml(copy.title)}</h1><p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${copy.body}</p></td></tr>${button}<tr><td style="padding:0 32px 32px 32px;">${
    copy.note ? `<p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:#55615c;">${escapeHtml(copy.note)}</p>` : ''
  }${fallback}<p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:#8a948f;">${footer}</p></td></tr></table></td></tr></table></body></html>`

  return { subject: copy.subject, html }
}
