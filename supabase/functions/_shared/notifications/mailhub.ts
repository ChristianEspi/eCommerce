/**
 * Envío de correo por EBIM MailHub (2026-11-20).
 *
 * MailHub es la plataforma de correo transaccional de EBIM: la app le manda el
 * código de una plantilla y sus variables, y MailHub arma el correo, pone el
 * remitente del proyecto (`ecommerce@ebim.pe`), lo envía y lleva el estado por
 * destinatario. Mientras el contrato §14 siga diciendo Graph, esto es la vía de
 * QAS: `notifications-dispatch` usa Graph si sus secretos están, y MailHub solo
 * si no lo están. La propuesta de cambio de canal va al buzón de la suite.
 *
 * ## Plantilla cuando existe, HTML cuando no
 *
 * Los avisos con plantilla publicada en MailHub (`MAILHUB_TEMPLATES`) se envían
 * por `templateKey`: el texto se cambia en MailHub sin desplegar. El resto sale
 * con el asunto y el HTML que ya arma `templates.ts`, así ningún aviso se queda
 * sin enviar mientras se crean sus plantillas.
 *
 * ## Reintentos sin duplicados
 *
 * `idempotencyKey` = id del correo en la cola. Un reintento tras un 5xx o un
 * corte de red devuelve el mismo envío en MailHub, nunca uno segundo.
 *
 * TypeScript puro con `fetch` inyectado: se prueba sin red y sin secretos.
 */
import type { FetchLike, SendOutcome } from './graph.ts'
import { fechaLima, formatTotal } from './customCopy.ts'
import { actionUrl } from './templates.ts'

/** Secretos de las Edge Functions. El token NUNCA va al front ni a git. */
export const MAILHUB_ENV_KEYS = ['EBIM_MAILHUB_URL', 'EBIM_MAILHUB_TOKEN'] as const

export interface MailhubConfig {
  /** `https://<hub>.supabase.co/functions/v1/mailhub-send` */
  readonly url: string
  readonly token: string
}

export function mailhubConfigFromEnv(get: (key: string) => string | undefined): {
  config: MailhubConfig | null
  missing: string[]
} {
  const url = (get('EBIM_MAILHUB_URL') ?? '').trim()
  const token = (get('EBIM_MAILHUB_TOKEN') ?? '').trim()
  const missing = MAILHUB_ENV_KEYS.filter((key) => (key === 'EBIM_MAILHUB_URL' ? !url : !token))
  if (missing.length > 0) return { config: null, missing: [...missing] }
  // Solo https: el token viaja en una cabecera.
  if (!/^https:\/\//.test(url)) return { config: null, missing: ['EBIM_MAILHUB_URL'] }
  return { config: { url, token }, missing: [] }
}

/** Lo que se envía con plantilla de MailHub. */
export interface MailhubTemplate {
  readonly templateKey: string
  readonly variables: Readonly<Record<string, unknown>>
}

export interface MailhubMessage {
  readonly to: string
  readonly subject: string
  readonly html: string
  /** Id del correo en la cola: idempotencia y búsqueda en MailHub. */
  readonly emailId: string
  /** Lo que el negocio reconoce (nº de pedido); si no, el id. */
  readonly referenceId: string
  readonly template: MailhubTemplate | null
}

const str = (params: Readonly<Record<string, unknown>>, key: string): string => {
  const value = params[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

// MailHub no da formato: el total y la fecha llegan ya escritos.
export { fechaLima, formatTotal }

/**
 * Plantillas publicadas en MailHub, por `kind` de la cola. Solo en español:
 * las de MailHub están escritas en español, y un aviso en inglés sale con el
 * HTML propio, que sí tiene las dos lenguas.
 *
 * Todas sus variables son OBLIGATORIAS en MailHub: si falta una, aquí se
 * devuelve `null` y el aviso sale como HTML, en vez de que MailHub lo rechace
 * con `template_variables_missing` y el comprador se quede sin correo.
 */
export function mailhubTemplateFor(
  kind: string,
  locale: string,
  params: Readonly<Record<string, unknown>>,
  baseUrl: string,
  now: Date,
): MailhubTemplate | null {
  if (locale === 'en') return null
  if (kind === 'order.confirmed') {
    const pedido = str(params, 'order_number')
    const total = formatTotal(str(params, 'grand_total'), str(params, 'currency'))
    const tienda = str(params, 'store_name')
    const enlace = actionUrl(kind, params, baseUrl)
    if (!pedido || !total || !tienda || !enlace) return null
    return {
      templateKey: 'pedido-recibido',
      variables: { pedido, fecha: fechaLima(now), total, tienda: { nombre: tienda }, enlace },
    }
  }
  return null
}

/** Lo que identifica el correo en el panel de MailHub: el pedido si lo hay. */
export function referenceFor(emailId: string, params: Readonly<Record<string, unknown>>): string {
  return str(params, 'order_number') || emailId
}

/**
 * Dominios reservados para pruebas (RFC 2606/6761) y los `.demo` de QAS. Un
 * correo a esas direcciones rebota y cada rebote resta reputación al remitente
 * de TODA la suite: no se envía.
 */
export function isTestAddress(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase().trim() ?? ''
  if (!domain) return true
  return (
    /\.(demo|test|example|invalid|localhost)$/.test(domain) ||
    /(^|\.)example\.(com|net|org)$/.test(domain)
  )
}

/** Códigos de MailHub que dependen de la configuración y no de este correo. */
const CONFIG_CODES = new Set([
  'invalid_token',
  'insufficient_scope',
  'sender_not_configured',
  'from_not_allowed',
  'template_not_found',
  'template_not_published',
])

function codigo(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as { code?: unknown; error?: unknown }
  if (typeof body.code === 'string') return body.code
  if (body.error && typeof body.error === 'object') {
    const inner = (body.error as { code?: unknown }).code
    if (typeof inner === 'string') return inner
  }
  return null
}

function stable(code: string): string {
  return `MAILHUB_${code.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40)}`
}

export async function sendMailhubMail(
  config: MailhubConfig,
  message: MailhubMessage,
  fetchFn: FetchLike,
): Promise<SendOutcome> {
  if (isTestAddress(message.to)) {
    return { ok: false, code: 'DESTINO_DE_PRUEBA', retryable: false, stopBatch: false }
  }

  const content = message.template
    ? { type: 'template', templateKey: message.template.templateKey, variables: message.template.variables }
    : { type: 'html', html: message.html }

  let response: Response
  try {
    response = await fetchFn(config.url, {
      method: 'POST',
      headers: { 'X-MailHub-Key': config.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: [message.to],
        // Con plantilla, el asunto lo pone MailHub; con HTML, va aquí.
        ...(message.template ? {} : { subject: message.subject }),
        content,
        referenceId: message.referenceId,
        idempotencyKey: `ecommerce-${message.emailId}`,
      }),
    })
  } catch {
    return { ok: false, code: 'MAILHUB_SIN_RED', retryable: true, stopBatch: true }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.status === 202 || response.status === 200) {
    const emailId = (payload as { emailId?: unknown } | null)?.emailId
    return { ok: true, reference: typeof emailId === 'string' ? emailId : null }
  }

  const code = codigo(payload)
  if (response.status === 401 || response.status === 403 || (code && CONFIG_CODES.has(code))) {
    // Token, permisos, remitente o plantilla: no es culpa de este correo. Se
    // para la pasada y nadie gasta un intento definitivo.
    return { ok: false, code: stable(code ?? `http_${response.status}`), retryable: true, stopBatch: true }
  }
  if (response.status === 429) {
    return { ok: false, code: stable(code ?? 'rate_limited'), retryable: true, stopBatch: true }
  }
  if (response.status >= 500) {
    return { ok: false, code: stable(code ?? `http_${response.status}`), retryable: true, stopBatch: false }
  }
  // 409 por idempotencia con otro contenido, variables que faltan, destinatario
  // inválido…: reintentar lo mismo no lo arregla.
  return { ok: false, code: stable(code ?? `http_${response.status}`), retryable: false, stopBatch: false }
}
