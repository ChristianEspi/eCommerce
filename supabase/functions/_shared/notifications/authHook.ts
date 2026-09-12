/**
 * Hook de envío de correo de Supabase Auth.
 *
 * ## Por qué hace falta
 *
 * Los correos de Auth —recuperar contraseña, confirmar— los envía el propio
 * servidor de Auth, y por defecto lo hace por SMTP o con su remitente genérico.
 * El contrato §14 exige Microsoft Graph y un buzón dedicado, y Graph no es SMTP.
 * El *Send Email Hook* es la puerta: Auth llama a una Edge Function con los
 * datos del correo y la función lo envía por Graph.
 *
 * ## La firma es la única autenticación
 *
 * Esta función no recibe un JWT de usuario: la llama Auth. Lo que demuestra que
 * la llamada viene de Auth y no de cualquiera es la firma *Standard Webhooks*
 * con el secreto del hook. Sin verificarla, cualquiera podría usar el buzón de
 * la empresa para mandar «restablece tu contraseña» con el enlace que quisiera.
 */

export interface AuthHookPayload {
  readonly user: { readonly email?: string; readonly new_email?: string }
  readonly email_data: {
    readonly token_hash?: string
    readonly token_hash_new?: string
    readonly redirect_to?: string
    readonly email_action_type?: string
  }
}

const TOLERANCIA_SEGUNDOS = 5 * 60

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Comparación en tiempo constante: no filtrar cuántos caracteres acertó el atacante. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Verifica una firma Standard Webhooks.
 *
 * El secreto llega como `v1,whsec_<base64>`, que es como lo muestra el panel de
 * Supabase. Se firma `id.timestamp.cuerpo` con HMAC-SHA256 y la cabecera puede
 * traer varias firmas separadas por espacio, para poder rotar el secreto.
 *
 * El `timestamp` se comprueba: una firma válida de hace una hora es una llamada
 * repetida, no una nueva.
 */
export async function verifyAuthHookSignature(input: {
  secret: string
  id: string | null
  timestamp: string | null
  signature: string | null
  body: string
  nowSeconds: number
}): Promise<boolean> {
  const { id, timestamp, signature, body } = input
  if (!id || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(input.nowSeconds - ts) > TOLERANCIA_SEGUNDOS) return false

  const raw = input.secret.replace(/^v1,/, '').replace(/^whsec_/, '')
  let keyBytes: Uint8Array<ArrayBuffer>
  try {
    keyBytes = base64ToBytes(raw)
  } catch {
    return false
  }
  if (keyBytes.length === 0) return false

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const firmado = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  const esperada = bytesToBase64(firmado)

  return signature
    .split(' ')
    .map((parte) => parte.split(',', 2))
    .some(([version, valor]) => version === 'v1' && typeof valor === 'string' && iguales(valor, esperada))
}

const ACCION_A_PLANTILLA: Record<string, string> = {
  recovery: 'auth.recovery',
  signup: 'auth.signup',
  invite: 'auth.invite',
  magiclink: 'auth.magiclink',
  email_change: 'auth.email_change',
}

/**
 * Del payload del hook a qué correo mandar y a quién.
 *
 * El enlace se arma contra `/auth/v1/verify` del proyecto, que es donde Auth
 * canjea el token y redirige a `redirect_to`. `redirect_to` ya lo validó Auth
 * contra la lista de redirecciones permitidas antes de llamar al hook.
 */
export function buildAuthEmail(
  payload: AuthHookPayload,
  supabaseUrl: string,
): { to: string; kind: string; params: { action_url: string } } | null {
  const tipo = payload.email_data?.email_action_type ?? ''
  const kind = ACCION_A_PLANTILLA[tipo]
  if (!kind) return null

  const cambio = tipo === 'email_change'
  const to = (cambio ? payload.user?.new_email || payload.user?.email : payload.user?.email) ?? ''
  const tokenHash = cambio
    ? payload.email_data.token_hash_new || payload.email_data.token_hash
    : payload.email_data.token_hash
  if (!to.includes('@') || !tokenHash) return null

  const url = new URL(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', tipo)
  if (payload.email_data.redirect_to) url.searchParams.set('redirect_to', payload.email_data.redirect_to)

  return { to, kind, params: { action_url: url.toString() } }
}
