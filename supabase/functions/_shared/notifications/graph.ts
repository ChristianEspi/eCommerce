/**
 * Envío de correo por Microsoft Graph — el método único de la suite (contrato §14).
 *
 * `sendMail` en modo aplicación, con la App Registration de suite y una
 * Application Access Policy que solo deja enviar como el buzón de esta app.
 * Nada de SMTP ni de proveedores genéricos: el contrato los prohíbe.
 *
 * TypeScript puro con `fetch` inyectado. Así se prueba sin red y sin secretos,
 * que es lo único que permite comprobar de verdad qué se hace con un 401 o con
 * un 429 antes de que ocurra en producción.
 */

/** Los cinco secretos que carga el operador en las Edge Functions (§14). */
export const GRAPH_ENV_KEYS = [
  'MS_TENANT_ID',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MS_SENDER_EMAIL',
  'MS_SENDER_NAME',
] as const

export interface GraphConfig {
  readonly tenantId: string
  readonly clientId: string
  readonly clientSecret: string
  readonly senderEmail: string
  readonly senderName: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Lee la configuración y dice QUÉ falta.
 *
 * Devolver la lista y no un booleano es lo que hace útil el botón «Probar»:
 * «falta MS_CLIENT_SECRET» se arregla; «no está configurado» manda a revisar
 * los cinco.
 */
export function graphConfigFromEnv(get: (key: string) => string | undefined): {
  config: GraphConfig | null
  missing: string[]
} {
  const valores = Object.fromEntries(GRAPH_ENV_KEYS.map((key) => [key, (get(key) ?? '').trim()]))
  const missing = GRAPH_ENV_KEYS.filter((key) => valores[key] === '')
  if (missing.length > 0) return { config: null, missing: [...missing] }
  return {
    config: {
      tenantId: valores.MS_TENANT_ID as string,
      clientId: valores.MS_CLIENT_ID as string,
      clientSecret: valores.MS_CLIENT_SECRET as string,
      senderEmail: valores.MS_SENDER_EMAIL as string,
      senderName: valores.MS_SENDER_NAME as string,
    },
    missing: [],
  }
}

export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly html: string
}

export type SendOutcome =
  | { readonly ok: true; readonly reference: string | null }
  | {
      readonly ok: false
      /** Código estable, sin datos del destinatario. */
      readonly code: string
      /** Si insistir tiene sentido. */
      readonly retryable: boolean
      /** La configuración está mal: seguir enviando solo gasta intentos. */
      readonly stopBatch: boolean
    }

/** Token de aplicación. Se pide una vez por pasada, no una vez por correo. */
export async function graphToken(config: GraphConfig, fetchFn: FetchLike): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const response = await fetchFn(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    return null
  }
  const payload = (await response.json()) as { access_token?: unknown }
  return typeof payload.access_token === 'string' ? payload.access_token : null
}

/**
 * Envía un correo como el buzón de la app.
 *
 * Graph responde 202 sin cuerpo. La referencia es la cabecera `request-id`, que
 * es lo que pide soporte de Microsoft para rastrear un envío.
 */
export async function sendGraphMail(
  config: GraphConfig,
  token: string,
  message: MailMessage,
  fetchFn: FetchLike,
): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetchFn(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}/sendMail`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            from: { emailAddress: { address: config.senderEmail, name: config.senderName } },
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          // Un buzón de envío no necesita una copia de cada aviso en Enviados.
          saveToSentItems: false,
        }),
      },
    )
  } catch {
    return { ok: false, code: 'GRAPH_SIN_RED', retryable: true, stopBatch: true }
  }

  const reference = response.headers.get('request-id')
  // El cuerpo de error de Graph puede traer la dirección: no se lee.
  await response.body?.cancel()

  if (response.status === 202 || response.status === 200) return { ok: true, reference }
  if (response.status === 401 || response.status === 403) {
    // Casi siempre es la Application Access Policy o un secreto vencido. No es
    // culpa de este correo, así que no se le gasta un intento definitivo.
    return { ok: false, code: 'GRAPH_NO_AUTORIZADO', retryable: true, stopBatch: true }
  }
  if (response.status === 429) {
    return { ok: false, code: 'GRAPH_LIMITE', retryable: true, stopBatch: true }
  }
  if (response.status >= 500) {
    return { ok: false, code: `GRAPH_${response.status}`, retryable: true, stopBatch: false }
  }
  return { ok: false, code: `GRAPH_${response.status}`, retryable: false, stopBatch: false }
}
