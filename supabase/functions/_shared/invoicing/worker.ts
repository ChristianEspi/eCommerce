/**
 * El trabajador de facturación (fase 2), PURO: la cola, las credenciales, el
 * HTTP y el registro llegan como puertos. `invoicing-worker` los resuelve
 * contra la base y contra Nubefact.
 *
 * Una pasada hace dos cosas:
 *
 *  1. EMITIR. Reclama los `invoice.issue` de Nubefact y los entrega. Si el
 *     emisor responde, el resultado va al comprobante y el mensaje se cierra.
 *     Si dice «ya existe» (código 23), se consulta y se registra lo que tiene:
 *     un reintento NUNCA emite dos veces. Un rechazo por datos cierra el
 *     mensaje sin reintento; uno de credenciales o de cuenta para la sociedad
 *     en esta pasada (los demás de esa sociedad esperan, no gastan intentos
 *     contra un muro).
 *  2. CONFIRMAR. Consulta los comprobantes que el emisor recibió y SUNAT aún
 *     no confirmó (las boletas suelen ir por resumen diario).
 */
import {
  buildConsultarComprobante,
  buildGenerarComprobante,
  parseCredentials,
  parseNubefactResponse,
  type InvoiceIssuePayloadV1,
  type NubefactCredentials,
  type NubefactOutcome,
  type ProviderResult,
} from './nubefact.ts'

export const PROVIDER = 'nubefact'

export interface ClaimedIssue {
  readonly id: string
  readonly organization_id: string
  readonly company_id: string
  readonly payload: Record<string, unknown>
}

export interface AwaitingInvoice {
  readonly invoice_id: string
  readonly organization_id: string
  readonly company_id: string
  readonly document_type: string
  readonly series: string
  readonly number: string
}

export interface InvoicingPorts {
  now(): Date
  reclaimStale(): Promise<void>
  claim(limit: number): Promise<ClaimedIssue[]>
  credentials(org: string, company: string): Promise<unknown>
  post(credentials: NubefactCredentials, body: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  record(invoiceId: string, result: ProviderResult): Promise<void>
  succeed(outboxId: string, latencyMs: number, status: number): Promise<void>
  fail(outboxId: string, error: string, status: number | null): Promise<void>
  giveUp(outboxId: string, error: string, status: number | null): Promise<void>
  awaiting(limit: number): Promise<AwaitingInvoice[]>
}

export interface InvoicingReport {
  readonly claimed: number
  readonly issued: number
  readonly failed: number
  readonly gaveUp: number
  readonly checked: number
  readonly confirmed: number
}

async function call(
  ports: InvoicingPorts,
  creds: NubefactCredentials,
  body: Record<string, unknown>,
): Promise<{ outcome: NubefactOutcome; status: number }> {
  try {
    const response = await ports.post(creds, body)
    return { outcome: parseNubefactResponse(response.status, response.body), status: response.status }
  } catch {
    return {
      outcome: { kind: 'error', code: 'NUBEFACT_SIN_RED', message: 'sin respuesta del emisor', retryable: true, stopTenant: false },
      status: 0,
    }
  }
}

export async function runInvoicingPass(ports: InvoicingPorts, options: { limit?: number } = {}): Promise<InvoicingReport> {
  await ports.reclaimStale()
  const claimed = await ports.claim(options.limit ?? 10)

  const credsCache = new Map<string, NubefactCredentials | null>()
  const tenantStopped = new Map<string, string>()
  const credsFor = async (org: string, company: string) => {
    const key = `${org}|${company}`
    if (!credsCache.has(key)) credsCache.set(key, parseCredentials(await ports.credentials(org, company)))
    return credsCache.get(key) ?? null
  }

  let issued = 0
  let failed = 0
  let gaveUp = 0

  for (const msg of claimed) {
    const tenant = `${msg.organization_id}|${msg.company_id}`
    const stopped = tenantStopped.get(tenant)
    if (stopped) {
      await ports.fail(msg.id, stopped, null)
      failed += 1
      continue
    }

    const creds = await credsFor(msg.organization_id, msg.company_id)
    if (!creds) {
      tenantStopped.set(tenant, 'NUBEFACT_SIN_CREDENCIALES')
      await ports.fail(msg.id, 'NUBEFACT_SIN_CREDENCIALES', null)
      failed += 1
      continue
    }

    const payload = msg.payload as unknown as InvoiceIssuePayloadV1
    const built = buildGenerarComprobante(payload, ports.now())
    if (!built.ok) {
      await ports.giveUp(msg.id, `${built.error.code}: ${built.error.detail}`, null)
      gaveUp += 1
      continue
    }

    const started = ports.now().getTime()
    let { outcome, status } = await call(ports, creds, built.body)

    // «Ya existe»: un envío anterior llegó. Lo que vale es lo que Nubefact tiene.
    if (outcome.kind === 'exists') {
      const consulta = await call(
        ports,
        creds,
        buildConsultarComprobante(payload.document_type, payload.series, payload.number),
      )
      outcome = consulta.outcome.kind === 'exists'
        ? { kind: 'error', code: 'NUBEFACT_23', message: 'existe pero no se pudo consultar', retryable: true, stopTenant: false }
        : consulta.outcome
      status = consulta.status
    }

    if (outcome.kind === 'result') {
      await ports.record(payload.invoice_id, outcome.result)
      await ports.succeed(msg.id, ports.now().getTime() - started, status)
      issued += 1
      continue
    }
    if (outcome.kind === 'error' && !outcome.retryable) {
      await ports.giveUp(msg.id, outcome.message, status || null)
      gaveUp += 1
      continue
    }
    const error = outcome.kind === 'error' ? outcome : { code: 'NUBEFACT_23', message: 'sin resultado', stopTenant: false }
    if (error.stopTenant) tenantStopped.set(tenant, error.code)
    await ports.fail(msg.id, error.message, status || null)
    failed += 1
  }

  // Confirmar lo que SUNAT aún no aceptó. Un fallo aquí no es grave: la base ya
  // marcó la consulta y lo vuelve a ofrecer en 15 minutos.
  const awaiting = await ports.awaiting(20)
  let confirmed = 0
  for (const inv of awaiting) {
    const tenant = `${inv.organization_id}|${inv.company_id}`
    if (tenantStopped.has(tenant)) continue
    const creds = await credsFor(inv.organization_id, inv.company_id)
    if (!creds) continue
    const { outcome } = await call(ports, creds, buildConsultarComprobante(inv.document_type, inv.series, inv.number))
    if (outcome.kind !== 'result') continue
    await ports.record(inv.invoice_id, outcome.result)
    if (outcome.result.status !== 'issued') confirmed += 1
  }

  return { claimed: claimed.length, issued, failed, gaveUp, checked: awaiting.length, confirmed }
}
