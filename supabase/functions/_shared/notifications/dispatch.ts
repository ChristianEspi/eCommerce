/**
 * Vaciar la cola de correo.
 *
 * Puro: la cola, el token y el envío llegan como puertos. La Edge Function
 * `notifications-dispatch` solo los resuelve contra la base y contra Graph.
 *
 * ## Tres decisiones
 *
 *  · **Un token por pasada**, no uno por correo: Microsoft limita las
 *    peticiones de token y pedir cien seguidas es la forma de conseguir un 429.
 *  · **Si la configuración está mal, se para la pasada.** Un 401 no es culpa del
 *    correo número tres; seguir enviando solo gasta intentos de los demás.
 *  · **Una plantilla desconocida falla sin reintento.** Reintentarla no la va a
 *    hacer existir.
 */
import type { MailMessage, SendOutcome } from './graph.ts'
import { renderEmail } from './templates.ts'

export interface ClaimedEmail {
  readonly id: string
  readonly kind: string
  readonly locale: string
  readonly to_address: string
  readonly params: Record<string, unknown>
  readonly attempts: number
}

export interface DispatchPorts {
  claim(limit: number): Promise<ClaimedEmail[]>
  complete(id: string, reference: string | null): Promise<void>
  fail(id: string, code: string, retryable: boolean): Promise<void>
  token(): Promise<string | null>
  send(token: string, message: MailMessage): Promise<SendOutcome>
}

export interface DispatchReport {
  readonly claimed: number
  readonly sent: number
  readonly failed: number
  readonly stoppedBy: string | null
}

export async function dispatchPendingEmails(
  ports: DispatchPorts,
  options: { limit: number; baseUrl: string },
): Promise<DispatchReport> {
  const claimed = await ports.claim(options.limit)
  if (claimed.length === 0) return { claimed: 0, sent: 0, failed: 0, stoppedBy: null }

  const token = await ports.token()
  if (!token) {
    for (const email of claimed) await ports.fail(email.id, 'GRAPH_TOKEN', true)
    return { claimed: claimed.length, sent: 0, failed: claimed.length, stoppedBy: 'GRAPH_TOKEN' }
  }

  let sent = 0
  let failed = 0
  for (let i = 0; i < claimed.length; i += 1) {
    const email = claimed[i] as ClaimedEmail
    const rendered = renderEmail(email.kind, email.locale, email.params, options.baseUrl)
    if (!rendered) {
      await ports.fail(email.id, 'PLANTILLA_DESCONOCIDA', false)
      failed += 1
      continue
    }

    const outcome = await ports.send(token, { to: email.to_address, ...rendered })
    if (outcome.ok) {
      await ports.complete(email.id, outcome.reference)
      sent += 1
      continue
    }

    await ports.fail(email.id, outcome.code, outcome.retryable)
    failed += 1

    if (outcome.stopBatch) {
      // Lo que quedaba vuelve a la cola sin gastar un intento definitivo.
      for (const resto of claimed.slice(i + 1)) {
        await ports.fail(resto.id, outcome.code, true)
        failed += 1
      }
      return { claimed: claimed.length, sent, failed, stoppedBy: outcome.code }
    }
  }

  return { claimed: claimed.length, sent, failed, stoppedBy: null }
}
