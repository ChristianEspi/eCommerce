/**
 * `notifications-dispatch` — el que vacía la cola de correo.
 *
 * Toda la decisión vive en `_shared/notifications/dispatch.ts`, que está
 * probado sin red. Aquí solo se resuelven los puertos contra la base y contra
 * Microsoft Graph.
 *
 * ## Quién lo llama
 *
 * El planificador del proyecto, cada minuto (`pg_cron` + `pg_net`, ver la
 * migración de programación). No hay sesión ni tenant: es una operación de
 * servidor. La puerta es una clave dedicada en CABECERA comparada en tiempo
 * constante, el mismo patrón que `integration-worker`.
 *
 * ## Sin Graph configurado no reclama nada
 *
 * Si faltan los secretos `MS_*`, responde qué falta y NO toca la cola. Reclamar
 * y devolver cada minuto gastaría los intentos de todos los correos sin haber
 * podido enviar ninguno, y el día que se configurara ya estarían agotados.
 */
import { serviceClient } from '../_runtime/clients.ts'
import { timingSafeEqual } from '../_shared/auth.ts'
import { dispatchPendingEmails, type ClaimedEmail, type DispatchPorts } from '../_shared/notifications/dispatch.ts'
import { graphConfigFromEnv, graphToken, sendGraphMail } from '../_shared/notifications/graph.ts'
import { isEditableKind, type CustomCopy } from '../_shared/notifications/customCopy.ts'
import {
  mailhubConfigFromEnv,
  mailhubTemplateFor,
  referenceFor,
  sendMailhubMail,
} from '../_shared/notifications/mailhub.ts'
import { resolveTrace, traceHeaders } from '../_shared/observability/index.ts'
import { edgeSecurityHeaders } from '../_shared/securityHeaders.ts'

const KEY_HEADER = 'x-ebim-worker-key'

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

  const expected = Deno.env.get('EBIM_NOTIFICATIONS_KEY') ?? ''
  if (expected.length < 32) {
    return json({ error: { code: 'ENVIO_NO_CONFIGURADO', message: 'Falta EBIM_NOTIFICATIONS_KEY' } }, 500, headers)
  }
  if (!timingSafeEqual(request.headers.get(KEY_HEADER) ?? '', expected)) {
    return json({ error: { code: 'NO_AUTENTICADO', message: 'Clave inválida' } }, 401, headers)
  }

  // Graph es el método del contrato (§14) y manda si está configurado. Sin
  // Graph, MailHub (vía de QAS, 2026-11-20). Sin ninguno, no se toca la cola.
  const env = (key: string) => Deno.env.get(key)
  const graph = graphConfigFromEnv(env)
  const mailhub = graph.config ? null : mailhubConfigFromEnv(env).config
  if (!graph.config && !mailhub) {
    return json(
      { data: { configured: false, missing: [...graph.missing, ...mailhubConfigFromEnv(env).missing] } },
      200,
      headers,
    )
  }

  const baseUrl = Deno.env.get('EBIM_APP_BASE_URL') ?? ''
  const transporte: Pick<DispatchPorts, 'token' | 'send'> = graph.config
    ? {
        token: () => graphToken(graph.config!, fetch),
        send: (token, message) => sendGraphMail(graph.config!, token, message, fetch),
      }
    : {
        token: () => Promise.resolve(mailhub!.token),
        send: (_token, message, email) =>
          sendMailhubMail(
            mailhub!,
            {
              ...message,
              emailId: email.id,
              referenceId: referenceFor(email.id, email.params),
              // Si la tienda escribió su texto, manda el suyo (HTML); si no, la
              // plantilla publicada en MailHub cuando la hay.
              template: message.custom
                ? null
                : mailhubTemplateFor(email.kind, email.locale, email.params, baseUrl, new Date()),
            },
            fetch,
          ),
      }

  const client = serviceClient(trace)

  try {
    const report = await dispatchPendingEmails(
      {
        async claim(limit) {
          const { data, error } = await client.rpc('notification_email_claim', { p_limit: limit })
          if (error) throw new Error(error.code ?? 'CLAIM_FALLIDO')
          return (data ?? []) as ClaimedEmail[]
        },
        async complete(id, reference) {
          const { error } = await client.rpc('notification_email_complete', { p_id: id, p_reference: reference })
          if (error) throw new Error(error.code ?? 'CIERRE_FALLIDO')
        },
        async fail(id, code, retryable) {
          const { error } = await client.rpc('notification_email_fail', {
            p_id: id,
            p_error: code,
            p_retryable: retryable,
          })
          if (error) throw new Error(error.code ?? 'CIERRE_FALLIDO')
        },
        ...transporte,
        async customCopies(emails) {
          const ids = emails.filter((e) => isEditableKind(e.kind)).map((e) => e.id)
          if (ids.length === 0) return new Map()
          // La tienda de cada correo y el texto que guardó para ese aviso e idioma.
          const { data: filas, error: e1 } = await client
            .from('notification_emails')
            .select('id, store_id, kind, locale')
            .in('id', ids)
          if (e1) throw new Error(e1.code ?? 'TEXTOS_FALLIDOS')
          const tiendas = [...new Set((filas ?? []).map((f) => f.store_id).filter(Boolean))]
          if (tiendas.length === 0) return new Map()
          const { data: textos, error: e2 } = await client
            .from('email_templates')
            .select('store_id, kind, locale, subject, title, body')
            .in('store_id', tiendas)
          if (e2) throw new Error(e2.code ?? 'TEXTOS_FALLIDOS')
          const porClave = new Map(
            (textos ?? []).map((t) => [`${t.store_id}|${t.kind}|${t.locale}`, { subject: t.subject, title: t.title, body: t.body }]),
          )
          const resultado = new Map<string, CustomCopy>()
          for (const f of filas ?? []) {
            const locale = f.locale === 'en' ? 'en' : 'es'
            const texto = porClave.get(`${f.store_id}|${f.kind}|${locale}`)
            if (texto) resultado.set(f.id, texto)
          }
          return resultado
        },
      },
      { limit: 25, baseUrl },
    )
    return json({ data: { configured: true, provider: graph.config ? 'graph' : 'mailhub', ...report } }, 200, headers)
  } catch (error) {
    // 503: fue la base o la red, y ahí sí conviene que el planificador vuelva a
    // intentarlo en la siguiente pasada. Sin detalle: no se registra ni una
    // dirección.
    console.error('[notifications-dispatch] la pasada no se pudo completar', {
      correlation_id: trace.correlationId,
      name: error instanceof Error ? error.message : 'Error',
    })
    return json({ error: { code: 'SERVICIO_NO_DISPONIBLE', message: 'La pasada no se pudo completar' } }, 503, headers)
  }
})
