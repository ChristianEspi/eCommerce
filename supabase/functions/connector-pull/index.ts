/**
 * `connector-pull` — el que consulta las fuentes de lectura (2026-11-12).
 *
 * Lo llama el planificador de la base cada minuto (`ecommerce-connector-pull`,
 * migración 20261112120000) y solo si hay flujos que tocan. Igual que
 * `integration-worker`: sin sesión ni tenant, servidor a servidor, con una
 * clave dedicada en CABECERA comparada en tiempo constante.
 *
 * Reclama los flujos DE UNO EN UNO mientras quede presupuesto de tiempo: si
 * reclamara cinco y se le acabara el tiempo en el segundo, los otros tres se
 * quedarían con la concesión puesta 15 minutos sin que nadie los atienda.
 *
 * La lógica (paginar, autenticar, topes) es de `_shared/connectors/pull.ts`,
 * que es puro y está probado sin red. Aquí solo se resuelven los puertos.
 */
import { serviceClient } from '../_runtime/clients.ts'
import { timingSafeEqual } from '../_shared/auth.ts'
import { resolveTrace, traceHeaders } from '../_shared/observability/index.ts'
import { edgeSecurityHeaders } from '../_shared/securityHeaders.ts'
import {
  PullError,
  runFeed,
  type ClaimedFeed,
  type HttpRequest,
  type HttpResponse,
  type PageResult,
  type PullPorts,
  type PullReport,
} from '../_shared/connectors/pull.ts'

const WORKER_KEY_HEADER = 'x-ebim-worker-key'
/** Margen bajo el límite de la plataforma para cerrar la última ejecución. */
const TIME_BUDGET_MS = 100_000

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** fetch con tiempo límite, sin redirecciones y leyendo como mucho `maxBytes`. */
async function httpPort(request: HttpRequest): Promise<HttpResponse> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), request.timeoutMs)
  try {
    let response: Response
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: { 'User-Agent': 'eCommerce-by-EBIM-connector/1', ...request.headers },
        body: request.body,
        signal: abort.signal,
        redirect: 'manual',
      })
    } catch (error) {
      if (abort.signal.aborted) {
        throw new PullError('FUENTE_TIEMPO_AGOTADO', `La fuente no respondio en ${request.timeoutMs / 1000} s`)
      }
      throw new PullError(
        'FUENTE_INALCANZABLE',
        error instanceof Error ? `No se pudo conectar con la fuente (${error.name})` : 'No se pudo conectar',
      )
    }

    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > request.maxBytes) {
      await response.body?.cancel()
      throw new PullError('FUENTE_DEMASIADO_GRANDE', 'La respuesta supera el tamano permitido')
    }

    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > request.maxBytes) {
          await reader.cancel()
          throw new PullError('FUENTE_DEMASIADO_GRANDE', 'La respuesta supera el tamano permitido')
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: new TextDecoder().decode(bytes),
    }
  } catch (error) {
    if (error instanceof PullError) throw error
    if (abort.signal.aborted) {
      throw new PullError('FUENTE_TIEMPO_AGOTADO', `La fuente no respondio en ${request.timeoutMs / 1000} s`)
    }
    throw new PullError('FUENTE_INALCANZABLE', 'La conexion con la fuente se corto')
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const trace = resolveTrace(request)
  const headers = { ...edgeSecurityHeaders(), ...traceHeaders(trace) }

  if (request.method !== 'POST') {
    return json({ error: { code: 'METODO_NO_PERMITIDO', message: 'Solo POST' } }, 405, headers)
  }

  const expected = Deno.env.get('EBIM_CONNECTOR_PULL_KEY') ?? ''
  if (expected.length < 32) {
    return json(
      { error: { code: 'WORKER_NO_CONFIGURADO', message: 'Falta EBIM_CONNECTOR_PULL_KEY' } },
      500,
      headers,
    )
  }
  if (!timingSafeEqual(request.headers.get(WORKER_KEY_HEADER) ?? '', expected)) {
    return json({ error: { code: 'NO_AUTENTICADO', message: 'Clave de trabajador invalida' } }, 401, headers)
  }

  const client = serviceClient(trace)
  const started = Date.now()

  const ports: PullPorts = {
    http: httpPort,

    async secret(sourceId) {
      const { data, error } = await client.rpc('connector_secret', { p_source_id: sourceId })
      if (error) throw new PullError('CREDENCIAL_NO_LEIDA', 'No se pudo leer la credencial')
      return typeof data === 'string' ? data : null
    },

    async apply(resource, runId, rows, offset) {
      const rpc = resource === 'stock' ? 'connector_apply_stock' : 'connector_apply_prices'
      const { data, error } = await client.rpc(rpc, { p_run_id: runId, p_rows: rows, p_offset: offset })
      if (error) throw new PullError('APLICAR_FALLIDO', `La base rechazo la pagina (${error.code ?? 'sin codigo'})`)
      return data as PageResult
    },

    async finish(runId, status, watermark, errorCode, errorMessage) {
      const { error } = await client.rpc('connector_finish', {
        p_run_id: runId,
        p_status: status,
        p_watermark: watermark,
        p_error_code: errorCode,
        p_error_message: errorMessage,
      })
      if (error) throw new Error(error.code ?? 'CIERRE_FALLIDO')
    },
  }

  const reports: PullReport[] = []
  try {
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data, error } = await client.rpc('connector_claim', { p_limit: 1 })
      if (error) throw new Error(error.code ?? 'RECLAMO_FALLIDO')
      const claims = (data ?? []) as ClaimedFeed[]
      if (claims.length === 0) break
      for (const claim of claims) {
        reports.push(await runFeed(claim, ports))
      }
    }
    return json({ data: { runs: reports } }, 200, headers)
  } catch (error) {
    console.error('[connector-pull] la pasada no se pudo completar', {
      correlation_id: trace.correlationId,
      name: error instanceof Error ? error.name : 'Error',
    })
    return json(
      { error: { code: 'SERVICIO_NO_DISPONIBLE', message: 'La pasada no se pudo completar' } },
      503,
      headers,
    )
  }
})
