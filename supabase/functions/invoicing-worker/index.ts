/**
 * `invoicing-worker` — entrega los comprobantes a Nubefact (facturación fase 2).
 *
 * Toda la decisión vive en `_shared/invoicing/worker.ts` y la traducción a la
 * API en `_shared/invoicing/nubefact.ts`, los dos puros y probados sin red.
 * Aquí solo se resuelven los puertos contra la base y contra Nubefact.
 *
 * ## Quién lo llama
 *
 * El planificador (`ecommerce-invoicing-worker`, cada 2 minutos y solo si hay
 * trabajo). No hay sesión ni tenant: el tenant es el de cada fila del outbox,
 * que escribió la base. La puerta es una clave dedicada en CABECERA comparada
 * en tiempo constante, el patrón de `notifications-dispatch`.
 *
 * ## Las credenciales
 *
 * Por sociedad, de Vault, vía `invoicing_credentials_for` (solo service_role).
 * Nunca se registran: ni la ruta ni el token salen en un log.
 */
import { serviceClient } from '../_runtime/clients.ts'
import { timingSafeEqual } from '../_shared/auth.ts'
import { authHeader } from '../_shared/invoicing/nubefact.ts'
import { PROVIDER, runInvoicingPass, type AwaitingInvoice, type ClaimedIssue } from '../_shared/invoicing/worker.ts'
import { resolveTrace, traceHeaders } from '../_shared/observability/index.ts'
import { edgeSecurityHeaders } from '../_shared/securityHeaders.ts'

const KEY_HEADER = 'x-ebim-worker-key'
const TIMEOUT_MS = 25_000

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

Deno.serve(async (request: Request): Promise<Response> => {
  const trace = resolveTrace(request)
  const headers = { ...edgeSecurityHeaders(), ...traceHeaders(trace) }

  if (request.method !== 'POST') {
    return json({ error: { code: 'METODO_NO_PERMITIDO', message: 'Solo POST' } }, 405, headers)
  }
  const expected = Deno.env.get('EBIM_INVOICING_WORKER_KEY') ?? ''
  if (expected.length < 32) {
    return json({ error: { code: 'WORKER_NO_CONFIGURADO', message: 'Falta EBIM_INVOICING_WORKER_KEY' } }, 500, headers)
  }
  if (!timingSafeEqual(request.headers.get(KEY_HEADER) ?? '', expected)) {
    return json({ error: { code: 'NO_AUTENTICADO', message: 'Clave inválida' } }, 401, headers)
  }

  const client = serviceClient(trace)
  const worker = `edge:${trace.requestId}`
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new Error(error.code ?? `${fn}_FALLIDO`)
    return data
  }

  try {
    const report = await runInvoicingPass({
      now: () => new Date(),
      reclaimStale: async () => {
        await rpc('integration_reclaim_stale', {})
      },
      claim: async (limit) =>
        ((await rpc('integration_claim', { p_provider_code: PROVIDER, p_worker: worker, p_limit: limit })) ?? []) as ClaimedIssue[],
      credentials: (org, company) =>
        rpc('invoicing_credentials_for', { p_org: org, p_company: company, p_provider: PROVIDER }),
      post: async (creds, body) => {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
        try {
          const response = await fetch(creds.ruta, {
            method: 'POST',
            headers: { Authorization: authHeader(creds.token), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abort.signal,
            redirect: 'manual',
          })
          let parsed: unknown = null
          try {
            parsed = await response.json()
          } catch {
            parsed = null
          }
          return { status: response.status, body: parsed }
        } finally {
          clearTimeout(timer)
        }
      },
      record: async (invoiceId, result) => {
        await rpc('invoice_record_provider_result', { p_invoice_id: invoiceId, p_result: result })
      },
      succeed: async (id, latency, status) => {
        await rpc('integration_succeed', { p_outbox_id: id, p_latency_ms: latency, p_status_code: status })
      },
      fail: async (id, error, status) => {
        await rpc('integration_fail', { p_outbox_id: id, p_error: error, p_status_code: status })
      },
      giveUp: async (id, error, status) => {
        await rpc('invoice_issue_give_up', { p_outbox_id: id, p_error: error, p_status_code: status })
      },
      awaiting: async (limit) =>
        ((await rpc('invoice_awaiting_confirmation', { p_provider: PROVIDER, p_limit: limit })) ?? []) as AwaitingInvoice[],
    })
    return json({ data: { ...report, worker } }, 200, headers)
  } catch (error) {
    console.error('[invoicing-worker] la pasada no se pudo completar', {
      correlation_id: trace.correlationId,
      name: error instanceof Error ? error.message : 'Error',
    })
    return json({ error: { code: 'SERVICIO_NO_DISPONIBLE', message: 'La pasada no se pudo completar' } }, 503, headers)
  }
})
