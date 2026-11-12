/**
 * Conector de lectura — el lado que HABLA con la API del ERP (2026-11-12).
 *
 * Puro: no sabe de Deno, de Supabase ni de la red. Recibe un flujo ya
 * reclamado (`connector_claim`) y unos puertos, pide las páginas del contrato
 * estándar (Estándar de integración ERP §11) y entrega cada página a la base,
 * que es quien decide qué entra. Así se prueba entero sin red.
 *
 * Contrato que se espera de la fuente:
 *
 *   GET {base_url}{path}?limit=N[&updated_since=ISO][&cursor=X]
 *   200 application/json  { "data": [ ... ], "next_cursor": "X" | null }
 *
 * Reglas que no dependen de la fuente:
 *  · solo https y nunca direcciones privadas (la base ya lo impide; se vuelve
 *    a comprobar aquí porque este es el código que de verdad llama);
 *  · no se siguen redirecciones (una 3xx es un error, no un salto);
 *  · topes de páginas, filas y bytes por ejecución;
 *  · la credencial no aparece en ningún mensaje de error ni en el informe.
 */

export type Resource = 'stock' | 'prices'
export type AuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2'

export interface ClaimedFeed {
  run_id: string
  feed: {
    id: string
    resource: Resource
    path: string
    page_size: number
    watermark: string | null
  }
  source: {
    id: string
    base_url: string
    auth_type: AuthType
    auth_header: string | null
    auth_username: string | null
    oauth_token_url: string | null
    oauth_scope: string | null
    timeout_seconds: number
    has_secret: boolean
  }
}

export interface HttpResponse {
  status: number
  contentType: string | null
  /** Cuerpo como texto, cortando en `maxBytes` (lanza `PullError` si se pasa). */
  body: string
}

export interface HttpRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
  maxBytes: number
}

export interface PageResult {
  received: number
  applied: number
  unchanged: number
  rejected: number
  max_updated_at: string | null
}

export interface PullPorts {
  http(request: HttpRequest): Promise<HttpResponse>
  secret(sourceId: string): Promise<string | null>
  apply(resource: Resource, runId: string, rows: unknown[], offset: number): Promise<PageResult>
  finish(
    runId: string,
    status: 'succeeded' | 'partial' | 'failed',
    watermark: string | null,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void>
}

export interface PullLimits {
  maxPages: number
  maxRows: number
  maxBytes: number
}

export const DEFAULT_LIMITS: PullLimits = { maxPages: 50, maxRows: 20_000, maxBytes: 5_000_000 }

export interface PullReport {
  runId: string
  status: 'succeeded' | 'partial' | 'failed'
  pages: number
  received: number
  applied: number
  unchanged: number
  rejected: number
  watermark: string | null
  errorCode: string | null
}

export class PullError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PullError'
  }
}

const PRIVATE_HOST =
  /^https:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)/i
const INTERNAL_TLD = /^https:\/\/[A-Za-z0-9.-]*\.(local|internal|localdomain)([:/]|$)/i
const HTTPS_URL = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(\/[^\s#]*)?$/

/** Mismo criterio que el CHECK de la base. */
export function assertPublicHttps(url: string): void {
  if (!HTTPS_URL.test(url) || PRIVATE_HOST.test(url) || INTERNAL_TLD.test(url)) {
    throw new PullError('URL_NO_PERMITIDA', 'La URL tiene que ser https y publica')
  }
}

/**
 * URL de una página. La ruta se pega a la base SIN poder salir de su origen:
 * `//otro.host` o `https://…` en la ruta no cambian a dónde se llama.
 */
export function buildPageUrl(
  baseUrl: string,
  path: string,
  params: { limit: number; updatedSince: string | null; cursor: string | null },
): string {
  const base = new URL(baseUrl)
  const cleanPath = `/${path.replace(/^\/+/, '')}`
  const url = new URL(base.origin)
  url.pathname = `${base.pathname.replace(/\/+$/, '')}${cleanPath}`.replace(/\/{2,}/g, '/')
  url.searchParams.set('limit', String(params.limit))
  if (params.updatedSince) url.searchParams.set('updated_since', params.updatedSince)
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
  if (url.origin !== base.origin) {
    throw new PullError('URL_NO_PERMITIDA', 'La ruta no puede cambiar el servidor de la fuente')
  }
  return url.toString()
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function statusError(status: number, what: string): PullError {
  if (status === 401 || status === 403) {
    return new PullError('FUENTE_NO_AUTORIZADA', `${what} respondio ${status}: revisa la credencial`)
  }
  if (status === 404) return new PullError('FUENTE_RUTA_NO_ENCONTRADA', `${what} respondio 404: revisa la ruta`)
  if (status >= 300 && status < 400) {
    return new PullError('FUENTE_REDIRECCION', `${what} respondio ${status}: no se siguen redirecciones`)
  }
  return new PullError(`FUENTE_HTTP_${status}`, `${what} respondio ${status}`)
}

function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new PullError('FUENTE_FORMATO', `${what} no devolvio JSON valido`)
  }
}

/** Cabeceras de autenticación de la fuente (con OAuth, pide el token antes). */
export async function authHeaders(
  claim: ClaimedFeed,
  ports: Pick<PullPorts, 'http' | 'secret'>,
): Promise<Record<string, string>> {
  const { source } = claim
  if (source.auth_type === 'none') return {}

  const secret = await ports.secret(source.id)
  if (!secret) {
    throw new PullError('CREDENCIAL_FALTANTE', 'La fuente pide autenticacion y no tiene credencial guardada')
  }

  switch (source.auth_type) {
    case 'api_key':
      if (!source.auth_header) throw new PullError('CONFIG_INCOMPLETA', 'Falta el nombre de la cabecera')
      return { [source.auth_header]: secret }
    case 'bearer':
      return { Authorization: `Bearer ${secret}` }
    case 'basic':
      return { Authorization: `Basic ${base64(`${source.auth_username ?? ''}:${secret}`)}` }
    case 'oauth2': {
      if (!source.oauth_token_url || !source.auth_username) {
        throw new PullError('CONFIG_INCOMPLETA', 'Falta la URL del token o el client_id')
      }
      assertPublicHttps(source.oauth_token_url)
      const form = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: source.auth_username,
        client_secret: secret,
      })
      if (source.oauth_scope) form.set('scope', source.oauth_scope)
      const response = await ports.http({
        method: 'POST',
        url: source.oauth_token_url,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
        timeoutMs: source.timeout_seconds * 1000,
        maxBytes: 100_000,
      })
      if (response.status !== 200) {
        const error = statusError(response.status, 'El servidor de tokens')
        throw new PullError(error.code === 'FUENTE_NO_AUTORIZADA' ? 'AUTH_FALLIDA' : error.code, error.message)
      }
      const token = parseJson(response.body, 'El servidor de tokens') as { access_token?: unknown }
      if (typeof token?.access_token !== 'string' || token.access_token === '') {
        throw new PullError('AUTH_FALLIDA', 'El servidor de tokens no devolvio access_token')
      }
      return { Authorization: `Bearer ${token.access_token}` }
    }
    default:
      throw new PullError('CONFIG_INCOMPLETA', 'Tipo de autenticacion desconocido')
  }
}

interface Page {
  data: unknown[]
  nextCursor: string | null
}

export function parsePage(body: string): Page {
  const parsed = parseJson(body, 'La fuente') as { data?: unknown; next_cursor?: unknown } | null
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data)) {
    throw new PullError('FUENTE_FORMATO', 'La respuesta tiene que ser un objeto con la lista "data"')
  }
  const next = parsed.next_cursor
  if (next !== undefined && next !== null && typeof next !== 'string') {
    throw new PullError('FUENTE_FORMATO', '"next_cursor" tiene que ser texto o null')
  }
  return { data: parsed.data, nextCursor: next ? next : null }
}

const later = (a: string | null, b: string | null): string | null => {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

/**
 * Una ejecución completa de un flujo. NUNCA lanza: cualquier fallo cierra la
 * ejecución como `failed` con su código, y lo aplicado hasta ahí se queda.
 */
export async function runFeed(
  claim: ClaimedFeed,
  ports: PullPorts,
  limits: PullLimits = DEFAULT_LIMITS,
): Promise<PullReport> {
  const report: PullReport = {
    runId: claim.run_id,
    status: 'succeeded',
    pages: 0,
    received: 0,
    applied: 0,
    unchanged: 0,
    rejected: 0,
    watermark: null,
    errorCode: null,
  }
  let errorMessage: string | null = null

  try {
    assertPublicHttps(claim.source.base_url)
    const auth = await authHeaders(claim, ports)
    let cursor: string | null = null
    const seen = new Set<string>()

    for (;;) {
      if (report.pages >= limits.maxPages) {
        report.status = 'partial'
        report.errorCode = 'LIMITE_PAGINAS'
        errorMessage = `Se cortó en ${limits.maxPages} paginas; sigue en la proxima ejecucion`
        break
      }

      const url = buildPageUrl(claim.source.base_url, claim.feed.path, {
        limit: claim.feed.page_size,
        updatedSince: claim.feed.watermark,
        cursor,
      })
      const response = await ports.http({
        method: 'GET',
        url,
        headers: { Accept: 'application/json', ...auth },
        timeoutMs: claim.source.timeout_seconds * 1000,
        maxBytes: limits.maxBytes,
      })
      if (response.status !== 200) throw statusError(response.status, 'La fuente')

      const page = parsePage(response.body)
      if (report.received + page.data.length > limits.maxRows) {
        throw new PullError('LIMITE_FILAS', `Mas de ${limits.maxRows} registros en una ejecucion`)
      }

      if (page.data.length > 0) {
        const result = await ports.apply(claim.feed.resource, claim.run_id, page.data, report.received)
        report.applied += result.applied
        report.unchanged += result.unchanged
        report.rejected += result.rejected
        report.watermark = later(report.watermark, result.max_updated_at)
      }
      report.received += page.data.length
      report.pages += 1

      if (!page.nextCursor || page.data.length === 0) break
      if (seen.has(page.nextCursor)) {
        throw new PullError('FUENTE_CURSOR_REPETIDO', 'La fuente devolvio un cursor que ya se habia pedido')
      }
      seen.add(page.nextCursor)
      cursor = page.nextCursor
    }

    if (report.status === 'succeeded' && report.rejected > 0) report.status = 'partial'
  } catch (error) {
    report.status = 'failed'
    if (error instanceof PullError) {
      report.errorCode = error.code
      errorMessage = error.message
    } else {
      report.errorCode = 'ERROR_INTERNO'
      errorMessage = 'Fallo inesperado del conector'
    }
  }

  await ports.finish(
    claim.run_id,
    report.status,
    report.status === 'failed' ? null : report.watermark,
    report.errorCode,
    errorMessage,
  )
  return report
}
