/**
 * Redaccion del lado del borde.
 *
 * La autoridad sigue siendo la BASE: `ebim.jsonb_is_pii_free` es un CHECK y un
 * CHECK no se puede desplegar mal. Esto es la primera capa, y existe porque hay
 * un destino al que el CHECK no llega: **la salida estandar**. Un
 * `console.error(body)` en una Edge Function acaba en el recolector de logs del
 * proveedor de hosting, fuera de esta base y fuera de sus policies. Ahi es donde
 * de verdad se filtran los correos y los tokens.
 *
 * Las dos listas —claves sensibles y claves de PII— son COPIA de
 * `ebim.sensitive_json_keys()` (P09) y `ebim.pii_json_keys()` (P13). Estan
 * duplicadas a proposito, igual que `CHECKOUT_STAGES` duplica el enum de
 * Postgres, y por la misma razon: el borde no puede consultar la base para
 * decidir si algo se puede escribir en un log. Un test compara las dos copias
 * contra el SQL y falla si se separan.
 */

/** Copia de `ebim.sensitive_json_keys()` — migracion 20260828120000. */
export const SENSITIVE_KEYS: readonly string[] = [
  'pan', 'card_number', 'cardnumber', 'card_no', 'account_number',
  'cvv', 'cvc', 'cvn', 'cvv2', 'csc', 'security_code', 'card_security_code',
  'expiry', 'expiration', 'exp_month', 'exp_year', 'card_expiry',
  'track1', 'track2', 'track_data', 'magstripe', 'pin', 'pin_block',
  'cardholder_name',
  'password', 'secret', 'api_key', 'apikey', 'token', 'access_token',
  'refresh_token', 'client_secret', 'private_key', 'signature_key',
]

/** Copia de `ebim.pii_json_keys()` — migracion 20260828160000. */
export const PII_KEYS: readonly string[] = [
  'email', 'e_mail', 'mail', 'correo', 'customer_email', 'contact_email',
  'phone', 'telephone', 'telefono', 'celular', 'mobile', 'msisdn',
  'customer_phone', 'contact_phone', 'whatsapp',
  'full_name', 'first_name', 'last_name', 'given_name', 'family_name',
  'customer_name', 'contact_name', 'nombre', 'apellido', 'apellidos',
  'dni', 'ruc', 'nif', 'cif', 'document_number', 'documento', 'tax_id',
  'national_id', 'passport',
  'address', 'address_line1', 'address_line2', 'direccion', 'street',
  'postal_code', 'zip', 'zipcode',
  'ip', 'ip_address', 'remote_addr', 'user_agent', 'device_id', 'session_id',
  'birthdate', 'birth_date', 'fecha_nacimiento',
]

export const REDACTED = '[redactado]'

const FORBIDDEN = new Set([...SENSITIVE_KEYS, ...PII_KEYS])

/** Misma forma conservadora que `ebim.looks_like_email`. */
const EMAIL = /[A-Z0-9._+-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)*\.[A-Z]{2,}/i

/**
 * Misma cascada que `ebim.looks_like_pan`: forma, longitud y Luhn. El tercer
 * filtro no es rigor academico — sin el, una marca de tiempo en milisegundos
 * (13 digitos) se redactaria y alguien acabaria quitando la guarda entera.
 */
export function looksLikePan(value: string): boolean {
  if (!/^[0-9][0-9 -]{11,24}$/.test(value)) return false
  const digits = value.replace(/[^0-9]/g, '')
  if (digits.length < 13 || digits.length > 19) return false

  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i])
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

export function looksLikeEmail(value: string): boolean {
  return EMAIL.test(value)
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return REDACTED
  if (typeof value === 'string') {
    return looksLikeEmail(value) || looksLikePan(value) ? REDACTED : value
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isForbiddenLogKey(key) ? REDACTED : redactValue(item, depth + 1)
    }
    return out
  }
  return value
}

/** Deja el objeto limpio en vez de descartarlo: perder el log es peor. */
export function redact<T>(value: T): T {
  return redactValue(value, 0) as T
}

/**
 * Clave que no se escribe en un log. Las listas de la base (copias exactas,
 * comparadas con el SQL) MÁS las cabeceras y credenciales que un log de borde
 * ve de verdad —`authorization`, `cookie`, `x-api-key`, `jwt`…— (fase 12).
 * Normalizada: `X-Api-Key` y `x_api_key` son la misma clave.
 */
function isForbiddenLogKey(key: string): boolean {
  const k = key.toLowerCase()
  return FORBIDDEN.has(k) || AI_FORBIDDEN.has(normalizeKey(key))
}

/**
 * Texto suelto que va a un log: sin correo, sin tarjeta y acotado. Fase 12:
 * además se tapan DENTRO del texto los secretos con forma reconocible
 * (`Bearer …`, JWT, cadenas de conexión, claves de API, `?token=`): un
 * `401: Bearer eyJ…` ya no llega entero al recolector de logs.
 */
export function redactText(value: string | null | undefined, max = 500): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  if (looksLikeEmail(trimmed) || looksLikePan(trimmed)) return REDACTED
  return applySecretRules(trimmed, new Set()).slice(0, max)
}

// ===========================================================================
// Sanitizado ANTES de mandar datos a un modelo de IA (fase 10, deuda D10).
//
// `redact`/`redactText` protegen la salida estandar y replican el CHECK de la
// base: tapan un valor cuando la CLAVE es sensible o cuando TODO el texto es un
// correo o una tarjeta. Para un log eso basta. Para un modelo no: un mensaje de
// error de un ERP o de un webhook lleva DENTRO la cabecera `Authorization`, un
// JWT, una cookie, una cadena de conexion o la URL con `?token=`, y
// `redact_text('401: Bearer eyJ…')` lo deja pasar entero.
//
// Esto no sustituye a nada: se aplica ENCIMA de la redaccion de la base, a
// cada texto libre que vaya a un prompt, y una ultima vez al prompt completo
// (`sanitizePromptForModel`). Lo que se tapa se sustituye por una etiqueta con
// el TIPO (`[redactado:jwt]`) para que el modelo pueda decir «el error traia un
// token» sin ver el token. Sin digitos en las etiquetas: el candado de cifras
// de la IA no las confunde con datos.
// ===========================================================================

/** Claves que, ademas de las de la base, no viajan NUNCA a un modelo. */
export const AI_SECRET_KEYS: readonly string[] = [
  'authorization', 'proxy_authorization', 'cookie', 'set_cookie', 'cookies',
  'jwt', 'id_token', 'bearer', 'x_api_key', 'api_secret', 'app_secret',
  'connection_string', 'connectionstring', 'dsn', 'database_url', 'db_url',
  'db_password', 'service_role', 'service_role_key', 'anon_key', 'session',
  'sessionid', 'session_token', 'credentials', 'credential', 'webhook_secret',
  'signing_secret', 'secret_ref', 'otp', 'code_verifier', 'passphrase',
  'private_key_id', 'client_assertion',
]

/** Fragmentos de clave que delatan un secreto (`x-sap-password`, `erpToken`…). */
const SECRET_KEY_PART = /(pass(word|wd)?|pwd|secret|token|api[-_]?key|apikey|authorization|cookie|credential|private[-_]?key|signature|session)/i

const AI_FORBIDDEN = new Set([...SENSITIVE_KEYS, ...PII_KEYS, ...AI_SECRET_KEYS])

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/-/g, '_')
}

/** ¿Esta clave no puede viajar a un modelo? */
export function isSecretKeyForModel(key: string): boolean {
  const k = normalizeKey(key)
  return AI_FORBIDDEN.has(k) || SECRET_KEY_PART.test(k)
}

export type RedactionKind =
  | 'clave_privada'
  | 'conexion'
  | 'credencial'
  | 'cookie'
  | 'jwt'
  | 'api_key'
  | 'secreto'
  | 'token'
  | 'correo'
  | 'tarjeta'
  | 'telefono'
  | 'ip'
  | 'numero'

export function redactionLabel(kind: RedactionKind): string {
  return `[redactado:${kind}]`
}

interface Rule {
  readonly kind: RedactionKind
  readonly re: RegExp
  /** Reemplazo; por defecto la etiqueta entera. */
  readonly replace?: (label: string, ...groups: string[]) => string
}

/**
 * Orden = de lo mas especifico a lo mas generico. Una cabecera `Authorization`
 * se tapa entera antes de que la regla del JWT vea solo la mitad.
 */
const SECRET_RULES: readonly Rule[] = [
  { kind: 'clave_privada', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  // postgres://usuario:clave@host/db, mongodb+srv://…, redis://…, jdbc:…
  {
    kind: 'conexion',
    re: /\b(?:jdbc:)?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|oracle|sftp|ftps?|smtps?|ldaps?):\/\/[^\s"'<>]+/gi,
  },
  // Cadena ADO/ODBC: Server=…;User Id=…;Password=…;
  { kind: 'conexion', re: /\b(?:server|data source|host)\s*=\s*[^;\s]+;[^\n"']*?(?:password|pwd)\s*=\s*[^;\s"']+;?/gi },
  // Credenciales en la URL: https://usuario:clave@host
  {
    kind: 'credencial',
    re: /\b(https?:\/\/)[^\s/@:"']+:[^\s/@"']+@/gi,
    replace: (label, scheme) => `${scheme}${label}@`,
  },
  // Authorization: Bearer … / Proxy-Authorization: Basic …
  {
    kind: 'credencial',
    re: /\b((?:proxy[-_ ])?authori[sz]ation)(["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|digest|token|apikey)\s+)?[^\s"',;}]+/gi,
    replace: (label, key, sep) => `${key}${sep}${label}`,
  },
  {
    kind: 'cookie',
    re: /\b((?:set[-_ ])?cookie)(["']?\s*[:=]\s*["']?)[^\r\n"'}]+/gi,
    replace: (label, key, sep) => `${key}${sep}${label}`,
  },
  {
    kind: 'credencial',
    re: /\b(bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
    replace: (label, scheme) => `${scheme} ${label}`,
  },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g },
  // Formatos de clave conocidos: sk_live_…, sk-ant-…, AKIA…, ghp_…, xoxb-…, AIza…
  {
    kind: 'api_key',
    re: /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{3,}|sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{20,}|glpat-[A-Za-z0-9_-]{12,})/g,
  },
  // Parametros de consulta con nombre de secreto: ?token=…&sig=…
  {
    kind: 'secreto',
    re: /([?&;](?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|sig|signature|secret|client_secret|password|pwd|auth|code|x-amz-signature|x-amz-credential|x-goog-signature)=)[^&\s#"'<>]+/gi,
    replace: (label, prefix) => `${prefix}${label}`,
  },
  // clave=valor / "clave": "valor" con nombre de secreto.
  {
    kind: 'secreto',
    re: /\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|client[-_]?secret|credential|session[-_]?id|service[-_]?role)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(?!["']?\[redactado)("[^"]*"|'[^']*'|[^\s,;&"'}\]]+)/gi,
    replace: (label, key, sep) => `${key}${sep}${label}`,
  },
]

const EMAIL_G = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi
const IPV4 = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g
/** Móvil local con separadores (987 654 321): sin + no lo ve PHONE. */
const PHONE_LOCAL = /(?<![\w.,:/-])9\d{2}[\s.-]\d{3}[\s.-]\d{3}(?![\w.,:/-])/g
const PHONE = /(?<![\w+])\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,4}\d{2,4}(?!\w)/g
const PAN_CANDIDATE = /(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g
/** Documento, telefono local, cuenta: una serie aislada de 8 a 12 digitos. */
const BARE_NUMBER = /(?<![\w.,:/-])\d{8,12}(?![\w.,:/-])/g
/** Cadena opaca larga (hex o base64) con letras y bastantes digitos. */
const OPAQUE = /(?<![\w/+=-])[A-Za-z0-9+/_=-]{32,}(?![\w/+=-])/g

function looksOpaque(value: string): boolean {
  const digits = (value.match(/\d/g) ?? []).length
  const letters = (value.match(/[A-Za-z]/g) ?? []).length
  return digits >= 4 && letters >= 4 && digits / value.length >= 0.15
}

function applySecretRules(text: string, found: Set<RedactionKind>): string {
  let out = text
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0
    out = out.replace(rule.re, (...args: unknown[]) => {
      found.add(rule.kind)
      const label = redactionLabel(rule.kind)
      if (!rule.replace) return label
      // args = [match, ...grupos, offset, texto]
      const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : ''))
      return rule.replace(label, ...groups)
    })
  }
  return out.replace(OPAQUE, (m) => {
    if (!looksOpaque(m)) return m
    found.add('token')
    return redactionLabel('token')
  })
}

function applyPiiRules(text: string, found: Set<RedactionKind>): string {
  return text
    .replace(EMAIL_G, () => {
      found.add('correo')
      return redactionLabel('correo')
    })
    .replace(PAN_CANDIDATE, (m) => {
      if (!looksLikePan(m)) return m
      found.add('tarjeta')
      return redactionLabel('tarjeta')
    })
    .replace(PHONE, (m) => {
      if ((m.match(/\d/g) ?? []).length < 8) return m
      found.add('telefono')
      return redactionLabel('telefono')
    })
    .replace(PHONE_LOCAL, () => {
      found.add('telefono')
      return redactionLabel('telefono')
    })
    .replace(IPV4, () => {
      found.add('ip')
      return redactionLabel('ip')
    })
    .replace(BARE_NUMBER, () => {
      found.add('numero')
      return redactionLabel('numero')
    })
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export interface SanitizedText {
  readonly text: string
  /** Tipos de dato que se taparon (para contarlo, nunca el dato). */
  readonly redacted: readonly RedactionKind[]
}

/** Sanea un texto y dice QUÉ tipos se taparon. */
export function sanitizeTextDetailed(value: string | null | undefined, max = 500): SanitizedText | null {
  if (typeof value !== 'string') return null
  const found = new Set<RedactionKind>()
  const base = value.replace(CONTROL, ' ')
  const clean = applyPiiRules(applySecretRules(base, found), found).replace(/\s+/g, ' ').trim()
  if (!clean) return null
  // Recortar DESPUES de sanear: cortar antes podria partir un token por la
  // mitad y dejar la otra mitad fuera del alcance de la regla.
  return { text: clean.slice(0, max), redacted: [...found] }
}

/** Texto libre (error de un ERP, mensaje de incidente, resumen del hilo) listo para un prompt. */
export function sanitizeTextForModel(value: string | null | undefined, max = 500): string | null {
  return sanitizeTextDetailed(value, max)?.text ?? null
}

/** ¿El texto lleva algo que el sanitizador taparía? (candado de SALIDA). */
export function containsSecretOrPii(value: string): boolean {
  const found = new Set<RedactionKind>()
  applyPiiRules(applySecretRules(value, found), found)
  return found.size > 0
}

/**
 * Sanea un valor estructurado (contexto de un incidente): claves sensibles
 * fuera, textos saneados, profundidad y tamaño acotados.
 */
export function sanitizeForModel(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (typeof value === 'string') return sanitizeTextForModel(value, 300)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeForModel(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[key] = isSecretKeyForModel(key) && typeof item !== 'boolean' ? REDACTED : sanitizeForModel(item, depth + 1)
    }
    return out
  }
  return null
}

/**
 * Ultima pasada sobre el PROMPT ya compuesto: solo las reglas de secretos
 * (credenciales, JWT, claves, conexiones) mas correos y tarjetas. Las de
 * numeros sueltos no: el prompt lleva cifras legitimas del sistema.
 */
export function sanitizePromptForModel(prompt: string): string {
  const found = new Set<RedactionKind>()
  return applySecretRules(prompt.replace(CONTROL, ' '), found)
    .replace(EMAIL_G, () => redactionLabel('correo'))
    .replace(PAN_CANDIDATE, (m) => (looksLikePan(m) ? redactionLabel('tarjeta') : m))
}
