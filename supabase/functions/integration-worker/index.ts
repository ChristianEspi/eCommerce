/**
 * `integration-worker` — el que vacía la cola (P14-SaaS).
 *
 * Es el primer consumidor real de `integration_outbox` en todo el repositorio.
 * Hasta aquí el marco de integraciones estaba completo y sin usar: `ops_health`
 * sabía decir cuántos mensajes había esperando y nadie los entregaba.
 *
 * ## Cómo se invoca, y por qué no es una función pública
 *
 * Lo llama un planificador (cron del proyecto, o el operador durante un
 * incidente). No hay sesión, no hay tenant y no hay nada que un navegador deba
 * poder disparar: entregar la cola es una operación de servidor. La puerta es
 * una clave dedicada en CABECERA —nunca en la URL, que queda en logs y en
 * `Referer`— comparada en tiempo constante, el mismo patrón que
 * `bootstrap-tenant` usa para el aprovisionamiento (contrato §2.6).
 *
 * ## Por qué también rescata huérfanos
 *
 * `integration_reclaim_stale` suelta los mensajes que un trabajador reclamó y
 * nunca cerró —porque se cayó, porque se redesplegó a mitad—. Sin alguien que
 * lo llame, cada caída deja mensajes `in_flight` para siempre y la cola se
 * vacía sola solo en apariencia. Va aquí porque este es el único proceso que
 * corre periódicamente y sabe de esta cola.
 *
 * ## Lo que NO hace
 *
 * Decidir. El reparto, el backoff, el disyuntor y la cola muerta son de la
 * base; la entrega y la firma, de `_shared/webhooks/dispatcher.ts`, que es puro
 * y está probado sin red. Aquí solo se resuelven los puertos.
 */
import { serviceClient } from '../_runtime/clients.ts'
import { timingSafeEqual } from '../_shared/auth.ts'
import { resolveTrace, traceHeaders } from '../_shared/observability/index.ts'
import { edgeSecurityHeaders } from '../_shared/securityHeaders.ts'
import {
  dispatchWebhooks,
  type DispatcherPorts,
  type OutboxMessage,
  type WebhookTarget,
} from '../_shared/webhooks/dispatcher.ts'

const WORKER_KEY_HEADER = 'x-ebim-worker-key'

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

  const expected = Deno.env.get('EBIM_WORKER_KEY') ?? ''
  if (expected.length < 32) {
    return json(
      { error: { code: 'WORKER_NO_CONFIGURADO', message: 'Falta EBIM_WORKER_KEY' } },
      500,
      headers,
    )
  }
  if (!timingSafeEqual(request.headers.get(WORKER_KEY_HEADER) ?? '', expected)) {
    return json(
      { error: { code: 'NO_AUTENTICADO', message: 'Clave de trabajador inválida' } },
      401,
      headers,
    )
  }

  const client = serviceClient(trace)
  const worker = `edge:${trace.requestId}`

  const ports: DispatcherPorts = {
    now: () => Date.now(),

    async claim(providerCode, workerName, limit) {
      const { data, error } = await client.rpc('integration_claim', {
        p_provider_code: providerCode,
        p_worker: workerName,
        p_limit: limit,
      })
      if (error) throw new Error(error.code ?? 'CLAIM_FALLIDO')
      return (data ?? []) as OutboxMessage[]
    },

    async resolveTarget(targetId) {
      const { data, error } = await client
        .from('webhook_endpoints')
        .select('id, name, url, api_version, secret_ref, is_active')
        .eq('id', targetId)
        .maybeSingle()
      if (error) throw new Error(error.code ?? 'DESTINO_NO_LEIDO')
      if (!data || data.is_active !== true) return null
      return data as unknown as WebhookTarget
    },

    // El secreto se resuelve por NOMBRE contra el entorno de la función. La
    // base guarda la referencia y nunca el valor: una tabla con secretos dentro
    // es una filtración esperando a que alguien haga un select. El nombre que
    // llega ya viene encerrado en el espacio de la sociedad del mensaje
    // (`webhookSecretEnvName`): nunca es un `secret_ref` crudo del tenant.
    resolveSecret: (envName) => Deno.env.get(envName) ?? null,

    async send({ url, body, headers: sendHeaders, timeoutMs }) {
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), timeoutMs)
      try {
        const response = await fetch(url, {
          method: 'POST',
          body,
          headers: sendHeaders,
          signal: abort.signal,
          // No se siguen redirecciones: entregar un cuerpo firmado a una URL
          // que el tenant no registró es exactamente lo que la firma existe
          // para impedir.
          redirect: 'manual',
        })
        // El cuerpo se descarta sin leerlo. No se guarda y no se mira.
        await response.body?.cancel()
        return { status: response.status }
      } finally {
        clearTimeout(timer)
      }
    },

    async succeed(outboxId, latencyMs, statusCode) {
      const { error } = await client.rpc('integration_succeed', {
        p_outbox_id: outboxId,
        p_latency_ms: latencyMs,
        p_status_code: statusCode,
      })
      if (error) throw new Error(error.code ?? 'CIERRE_FALLIDO')
    },

    async fail(outboxId, message, statusCode) {
      const { error } = await client.rpc('integration_fail', {
        p_outbox_id: outboxId,
        p_error: message,
        p_status_code: statusCode,
      })
      if (error) throw new Error(error.code ?? 'CIERRE_FALLIDO')
    },
  }

  try {
    // Primero el rescate: un mensaje huérfano de una caída anterior tiene que
    // volver a la cola ANTES de reclamar, o esta pasada lo vuelve a ignorar.
    const { data: rescued } = await client.rpc('integration_reclaim_stale', {})

    const report = await dispatchWebhooks(ports, { worker })

    return json({ data: { ...report, reclaimed: rescued ?? 0, worker } }, 200, headers)
  } catch (error) {
    // 503 y no 500: si esto falló fue la base o la red, y ahí sí conviene que
    // el planificador vuelva a intentarlo en la siguiente pasada.
    console.error('[integration-worker] la pasada no se pudo completar', {
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
