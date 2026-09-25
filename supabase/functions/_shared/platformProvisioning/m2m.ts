/**
 * Autenticación máquina-a-máquina de EBIM MasterAdmin.
 *
 * La misma verificación que eSupplier, TMS y eChange certificaron contra
 * MasterAdmin, para que toda la suite rechace exactamente lo mismo.
 *
 * MasterAdmin firma un JWT ES256 de vida corta con SU clave privada; aquí solo
 * existe la clave PÚBLICA, que llega en Base64 por
 * `EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64` (el PEM multilínea no sobrevive bien a
 * `supabase secrets set`). Nunca en el frontend.
 *
 * TypeScript portable —sin `Deno.*` y sin dependencias— para que Vitest lo
 * ejercite desde `supabase/tests/`. La Web Crypto API es la misma en Deno y Node.
 *
 * Qué se rechaza y por qué:
 *   · Cualquier `alg` que no sea exactamente ES256 (HS256, none, RS256…).
 *     Aceptar HS256 con una clave pública permitiría firmar usando la propia
 *     clave pública como secreto HMAC ("algorithm confusion").
 *   · Los JWT de Supabase (anon, authenticated, service_role): los legacy son
 *     HS256 y caen por el algoritmo; los asimétricos van firmados por otra
 *     clave. Aun así se rechaza el claim `role` como defensa extra.
 *   · Tokens sin iss/aud/iat/exp/jti/sub/scope, con vida > MAX_TOKEN_LIFETIME
 *     o caducados.
 *   · Tokens con un `sub` distinto del configurado: el sujeto es el SISTEMA
 *     que llama y se compara por igualdad.
 *
 * Los motivos detallados (INVALID_ISSUER, INVALID_AUDIENCE…) solo se devuelven
 * DESPUÉS de verificar la firma: a quien no tiene la clave privada no se le
 * explica qué le falta.
 */

export type M2MErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_M2M_TOKEN'
  | 'INVALID_ISSUER'
  | 'INVALID_AUDIENCE'
  | 'MISSING_SCOPE'
  | 'M2M_NOT_CONFIGURED'

export interface M2MConfig {
  issuer: string
  audience: string
  /** El SUJETO exacto que se acepta: el sistema que llama, nunca una persona. */
  subject: string
  algorithm: 'ES256'
  maxTokenLifetimeSeconds: number
  createScope: string
  readScope: string
  publicKeyB64: string
}

export interface M2MClaims {
  sub: string
  jti: string
  iat: number
  exp: number
  scopes: string[]
  actorId: string | null
  actorRole: string | null
}

export type M2MResult =
  | { ok: true; claims: M2MClaims }
  // `claims` solo viaja en MISSING_SCOPE: la firma ya se verificó y el rechazo se audita.
  | { ok: false; code: M2MErrorCode; status: number; claims?: M2MClaims }

type Env = { get(key: string): string | undefined }

/** Tolerancia de reloj entre MasterAdmin y Supabase. Solo afecta a iat/nbf futuros. */
export const CLOCK_SKEW_SECONDS = 30
const MAX_TOKEN_BYTES = 8192
const HARD_MAX_LIFETIME = 300

/**
 * Lee la configuración. FAIL-CLOSED: si falta algo o `ENABLED` no es `true`, no
 * hay configuración y la función responde 503 a todo. Un despiste de secretos
 * nunca se convierte en un endpoint abierto.
 */
export function loadM2MConfig(env: Env): M2MConfig | null {
  if ((env.get('EBIM_MASTERADMIN_M2M_ENABLED') || '').toLowerCase() !== 'true') return null

  const issuer = env.get('EBIM_MASTERADMIN_M2M_ISSUER') || ''
  const audience = env.get('EBIM_MASTERADMIN_M2M_AUDIENCE') || ''
  const subject = (env.get('EBIM_MASTERADMIN_M2M_SUBJECT') || '').trim()
  const algorithm = env.get('EBIM_MASTERADMIN_M2M_ALGORITHM') || ''
  const lifetimeRaw = env.get('EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME') || ''
  const createScope = env.get('EBIM_MASTERADMIN_M2M_CREATE_SCOPE') || ''
  const readScope = env.get('EBIM_MASTERADMIN_M2M_READ_SCOPE') || ''
  const publicKeyB64 = (env.get('EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64') || '').trim()

  // Solo ES256. Otro valor es un error de configuración, no una invitación.
  if (algorithm !== 'ES256') return null
  if (!/^\d+$/.test(lifetimeRaw)) return null
  const maxTokenLifetimeSeconds = Number(lifetimeRaw)
  if (maxTokenLifetimeSeconds < 1 || maxTokenLifetimeSeconds > HARD_MAX_LIFETIME) return null
  // Sin sujeto configurado no hay configuración: aceptar «cualquier sujeto»
  // cuando falta la variable sería un permiso silencioso.
  if (!issuer || !audience || !subject || !createScope || !readScope || !publicKeyB64) return null

  return {
    issuer,
    audience,
    subject,
    algorithm,
    maxTokenLifetimeSeconds,
    createScope,
    readScope,
    publicKeyB64,
  }
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('base64url inválido')
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

/**
 * Importa la clave pública P-256 desde el Base64 del PEM completo. Solo
 * `BEGIN PUBLIC KEY` (SPKI): una clave privada cargada por error falla aquí.
 */
export async function importMasterAdminPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  const pem = new TextDecoder().decode(base64ToBytes(publicKeyB64.replace(/\s+/g, '')))
  if (/PRIVATE KEY/.test(pem)) throw new Error('Se esperaba una clave PÚBLICA')
  const match = pem.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/)
  if (!match || !match[1]) throw new Error('PEM sin bloque PUBLIC KEY')
  const der = base64ToBytes(match[1].replace(/\s+/g, ''))
  return crypto.subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ])
}

/** Extrae el token de `Authorization: Bearer <jwt>`. */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null
  const m = header.match(/^Bearer\s+(\S+)\s*$/)
  return m && m[1] ? m[1] : null
}

const fail = (code: M2MErrorCode, status = 401): M2MResult => ({ ok: false, code, status })

function nonEmptyString(v: unknown, max = 200): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}

function parseScopes(claim: unknown): string[] | null {
  if (typeof claim === 'string') {
    const parts = claim.split(' ').filter(Boolean)
    return parts.length ? parts : null
  }
  if (Array.isArray(claim) && claim.length && claim.every((s) => nonEmptyString(s))) {
    return claim as string[]
  }
  return null
}

function optionalText(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v.slice(0, 200) : null
}

/**
 * Verifica el JWT M2M y exige `requiredScope`.
 * `actor_id`/`actor_role` se devuelven SOLO para auditoría: nunca autorizan.
 */
export async function verifyMasterAdminM2M(
  authorizationHeader: string | null,
  config: M2MConfig,
  publicKey: CryptoKey,
  requiredScope: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<M2MResult> {
  const token = extractBearerToken(authorizationHeader)
  if (!token) return fail('UNAUTHENTICATED')
  if (token.length > MAX_TOKEN_BYTES) return fail('INVALID_M2M_TOKEN')

  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || parts[2] === undefined) {
    return fail('INVALID_M2M_TOKEN')
  }

  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  let signature: Uint8Array<ArrayBuffer>
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])))
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])))
    signature = base64UrlToBytes(parts[2])
  } catch {
    return fail('INVALID_M2M_TOKEN')
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
    return fail('INVALID_M2M_TOKEN')
  }

  // Algoritmo: exactamente ES256, sin extensiones críticas.
  if (header.alg !== config.algorithm) return fail('INVALID_M2M_TOKEN')
  if (header.crit !== undefined) return fail('INVALID_M2M_TOKEN')
  // JOSE ES256 = r||s de 32 bytes cada uno. DER u otra longitud no es ES256 válido.
  if (signature.length !== 64) return fail('INVALID_M2M_TOKEN')

  let valid = false
  try {
    valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
  } catch {
    valid = false
  }
  if (!valid) return fail('INVALID_M2M_TOKEN')

  // Identidad humana o de proyecto Supabase: nunca es M2M.
  if (payload.role !== undefined) return fail('INVALID_M2M_TOKEN')

  if (payload.iss !== config.issuer) return fail('INVALID_ISSUER')

  const aud = payload.aud
  const audOk =
    aud === config.audience ||
    (Array.isArray(aud) && aud.length === 1 && aud[0] === config.audience)
  if (!audOk) return fail('INVALID_AUDIENCE')

  const { iat, exp, nbf } = payload
  if (typeof iat !== 'number' || !Number.isInteger(iat)) return fail('INVALID_M2M_TOKEN')
  if (typeof exp !== 'number' || !Number.isInteger(exp)) return fail('INVALID_M2M_TOKEN')
  if (exp <= nowSeconds) return fail('INVALID_M2M_TOKEN')
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) return fail('INVALID_M2M_TOKEN')
  if (exp - iat <= 0 || exp - iat > config.maxTokenLifetimeSeconds) return fail('INVALID_M2M_TOKEN')
  if (nbf !== undefined && (typeof nbf !== 'number' || nbf > nowSeconds + CLOCK_SKEW_SECONDS)) {
    return fail('INVALID_M2M_TOKEN')
  }

  if (!nonEmptyString(payload.jti)) return fail('INVALID_M2M_TOKEN')
  // El sujeto EXACTO, no «alguno».
  if (!nonEmptyString(payload.sub) || payload.sub !== config.subject) {
    return fail('INVALID_M2M_TOKEN')
  }

  const scopes = parseScopes(payload.scope)
  if (!scopes) return fail('INVALID_M2M_TOKEN')

  const claims: M2MClaims = {
    sub: payload.sub,
    jti: payload.jti,
    iat,
    exp,
    scopes,
    actorId: optionalText(payload.actor_id),
    actorRole: optionalText(payload.actor_role),
  }
  if (!scopes.includes(requiredScope)) return { ok: false, code: 'MISSING_SCOPE', status: 403, claims }

  return { ok: true, claims }
}
