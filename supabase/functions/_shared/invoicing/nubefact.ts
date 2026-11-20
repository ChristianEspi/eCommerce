/**
 * Nubefact — traducción PURA entre el mensaje `invoice.issue` v2 y su API
 * (manual oficial «API JSON» v3.1, 04/11/2026). Sin red y sin secretos: el
 * trabajador (`invoicing-worker`) pone el `fetch` y las credenciales.
 *
 * ## Decisiones
 *
 *  · `numero` sale de la base (correlativo por sociedad y serie, fase 1) y va
 *    como ENTERO sin ceros a la izquierda, como pide el manual.
 *  · Los importes del comprobante ya cuadran en la base (líneas = cabecera).
 *    Aquí solo se reparten por afectación: gravada, exonerada, inafecta.
 *  · `valor_unitario`/`precio_unitario` con 10 decimales: el neto de la línea
 *    dividido entre la cantidad casi nunca es exacto a 2.
 *  · `enviar_automaticamente_al_cliente: false`: el correo al comprador lo
 *    manda la tienda, con su marca, no Nubefact.
 *  · Fecha de emisión = HOY en Lima (el manual: «Debe ser la fecha actual»).
 *
 * ## Errores (`{ errors, codigo }`)
 *
 *  · 10, 11, 12, 50, 51 — credenciales, ruta o cuenta: no es culpa de este
 *    comprobante. Se para la pasada y se reintenta con espera.
 *  · 20, 21, 22 — el documento no pasa: reintentar lo mismo no lo arregla.
 *  · 23 — «ya existe en Nubefact»: un envío anterior llegó y su respuesta se
 *    perdió. Se CONSULTA y se registra lo que Nubefact ya tiene.
 *  · 40 o HTTP 5xx — del emisor: reintento con espera.
 */
/**
 * El mensaje `invoice.issue` v2 tal como lo lee el trabajador. Es el MISMO
 * contrato que `InvoiceIssuePayloadV1` de `src/domain/ports/invoicing.ts` (Deno
 * no importa desde `src/`); `supabase/tests/invoicing-nubefact.test.ts`
 * comprueba en tipos que los dos encajan.
 */
export interface InvoiceIssueLineV1 {
  readonly position: number
  readonly description: string
  readonly quantity: string
  readonly unit_price: string
  readonly net_amount: string
  readonly tax_rate: string
  readonly tax_amount: string
  readonly tax_affectation: 'gravado' | 'exonerado' | 'inafecto'
  readonly line_kind: 'item' | 'shipping'
}

export interface InvoiceIssuePayloadV1 {
  readonly schema_version: number
  readonly operation: 'invoice.issue'
  readonly idempotency_key: string
  readonly store_id: string
  readonly invoice_id: string
  readonly order_id: string
  readonly document_type: 'receipt' | 'invoice' | 'credit_note'
  readonly series: string
  readonly number: string
  readonly issued_at: string
  readonly currency: string
  readonly customer: {
    readonly name: string
    readonly tax_id: string | null
    readonly doc_type: 'ruc' | 'dni' | 'ce' | 'passport' | null
    readonly address: string | null
  }
  readonly totals: { readonly net: string; readonly tax: string; readonly gross: string }
  readonly lines: readonly InvoiceIssueLineV1[]
  /** v3 · solo en notas de crédito. */
  readonly reference?: { readonly document_type: 'receipt' | 'invoice'; readonly series: string; readonly number: string } | null
  readonly credit_note?: { readonly type: number; readonly reason: string } | null
}

/** `tipo_de_comprobante` de Nubefact: 1 factura, 2 boleta, 3 nota de crédito. */
export function tipoDeComprobante(documentType: string): number {
  return documentType === 'invoice' ? 1 : documentType === 'credit_note' ? 3 : 2
}

export interface NubefactCredentials {
  readonly ruta: string
  readonly token: string
}

const RUTA = /^https:\/\/(api\.nubefact\.com|[a-z0-9-]+\.pse\.pe)\/api\/v1\/[A-Za-z0-9-]{8,80}$/

export function parseCredentials(raw: unknown): NubefactCredentials | null {
  if (!raw || typeof raw !== 'object') return null
  const { ruta, token } = raw as { ruta?: unknown; token?: unknown }
  if (typeof ruta !== 'string' || !RUTA.test(ruta)) return null
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]{20,200}$/.test(token)) return null
  return { ruta, token }
}

/** Cabecera de autenticación de Nubefact. */
export function authHeader(token: string): string {
  return `Token token="${token}"`
}

const TIPO_DOC_CLIENTE: Record<string, string> = { ruc: '6', dni: '1', ce: '4', passport: '7' }
const MONEDA: Record<string, number> = { PEN: 1, USD: 2, EUR: 3 }
const TIPO_IGV: Record<string, number> = { gravado: 1, exonerado: 8, inafecto: 9 }

const num = (value: string | number): number => Number(value)
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const round10 = (value: number): number => Number(value.toFixed(10))
const cut = (value: string | null | undefined, max: number): string => (value ?? '').trim().slice(0, max)

/** `DD-MM-AAAA` en hora de Lima. */
export function fechaNubefact(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}-${get('month')}-${get('year')}`
}

export type NubefactIssueError =
  | { readonly code: 'PAYLOAD_NO_SOPORTADO'; readonly detail: string }

/** El cuerpo de `generar_comprobante`, o por qué no se puede armar. */
export function buildGenerarComprobante(
  payload: InvoiceIssuePayloadV1,
  now: Date,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: NubefactIssueError } {
  if (payload.schema_version !== 2 && payload.schema_version !== 3) {
    return { ok: false, error: { code: 'PAYLOAD_NO_SOPORTADO', detail: `schema_version ${String(payload.schema_version)}` } }
  }
  const nota = payload.document_type === 'credit_note'
  const ref = payload.reference
  const refNumero = ref ? Number.parseInt(ref.number, 10) : Number.NaN
  if (nota && (!ref || !Number.isInteger(refNumero) || !payload.credit_note)) {
    return { ok: false, error: { code: 'PAYLOAD_NO_SOPORTADO', detail: 'nota sin referencia' } }
  }
  const moneda = MONEDA[payload.currency.toUpperCase()]
  if (!moneda) return { ok: false, error: { code: 'PAYLOAD_NO_SOPORTADO', detail: `moneda ${payload.currency}` } }
  const numero = Number.parseInt(payload.number, 10)
  if (!Number.isInteger(numero) || numero < 1 || numero > 99_999_999) {
    return { ok: false, error: { code: 'PAYLOAD_NO_SOPORTADO', detail: `numero ${payload.number}` } }
  }

  const docType = payload.customer.doc_type ? TIPO_DOC_CLIENTE[payload.customer.doc_type] : undefined
  const sinDocumento = !docType || !payload.customer.tax_id

  let gravada = 0
  let exonerada = 0
  let inafecta = 0
  let igv = 0
  let tasa = 0
  const items = payload.lines.map((line: InvoiceIssueLineV1) => {
    const cantidad = num(line.quantity)
    const neto = num(line.net_amount)
    const impuesto = num(line.tax_amount)
    const afectacion = line.tax_affectation ?? (num(line.tax_rate) > 0 ? 'gravado' : 'exonerado')
    if (afectacion === 'gravado') {
      gravada += neto
      tasa = Math.max(tasa, num(line.tax_rate))
    } else if (afectacion === 'inafecto') inafecta += neto
    else exonerada += neto
    igv += impuesto
    return {
      unidad_de_medida: line.line_kind === 'shipping' ? 'ZZ' : 'NIU',
      codigo: '',
      descripcion: cut(line.description, 250),
      cantidad,
      valor_unitario: round10(neto / cantidad),
      precio_unitario: round10((neto + impuesto) / cantidad),
      descuento: '',
      subtotal: round2(neto),
      tipo_de_igv: TIPO_IGV[afectacion] ?? 1,
      igv: round2(impuesto),
      total: round2(neto + impuesto),
      anticipo_regularizacion: false,
    }
  })

  const body: Record<string, unknown> = {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: tipoDeComprobante(payload.document_type),
    serie: payload.series,
    numero,
    sunat_transaction: 1,
    cliente_tipo_de_documento: sinDocumento ? '-' : docType,
    cliente_numero_de_documento: sinDocumento ? '-' : cut(payload.customer.tax_id, 15),
    cliente_denominacion: cut(payload.customer.name, 100) || 'CLIENTES VARIOS',
    cliente_direccion: cut(payload.customer.address, 100),
    cliente_email: '',
    fecha_de_emision: fechaNubefact(now),
    moneda,
    porcentaje_de_igv: round2((tasa || 0.18) * 100),
    total_gravada: gravada > 0 ? round2(gravada) : '',
    total_exonerada: exonerada > 0 ? round2(exonerada) : '',
    total_inafecta: inafecta > 0 ? round2(inafecta) : '',
    total_igv: round2(igv),
    total: round2(num(payload.totals.gross)),
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    items,
  }
  if (nota && ref && payload.credit_note) {
    body.documento_que_se_modifica_tipo = ref.document_type === 'invoice' ? 1 : 2
    body.documento_que_se_modifica_serie = ref.series
    body.documento_que_se_modifica_numero = refNumero
    body.tipo_de_nota_de_credito = payload.credit_note.type
    body.observaciones = cut(payload.credit_note.reason, 1000)
  }
  return { ok: true, body }
}

export function buildConsultarComprobante(documentType: string, series: string, number: string) {
  return {
    operacion: 'consultar_comprobante',
    tipo_de_comprobante: tipoDeComprobante(documentType),
    serie: series,
    numero: Number.parseInt(number, 10),
  }
}

/** Lo que se guarda en el comprobante (`invoice_record_provider_result`). */
export interface ProviderResult {
  readonly status: 'accepted' | 'issued' | 'rejected'
  readonly number?: string
  readonly document_ref?: string
  readonly pdf_url?: string
  readonly xml_url?: string
  readonly cdr_url?: string
  readonly sunat_code?: string
  readonly sunat_description?: string
  readonly qr_string?: string
  readonly hash_code?: string
  readonly detail?: string
}

export type NubefactOutcome =
  | { readonly kind: 'result'; readonly result: ProviderResult }
  /** Ya existía: hay que consultarlo. */
  | { readonly kind: 'exists' }
  | {
      readonly kind: 'error'
      readonly code: string
      readonly message: string
      /** Reintentar con espera tiene sentido. */
      readonly retryable: boolean
      /** No es culpa de este comprobante: parar la pasada de esta sociedad. */
      readonly stopTenant: boolean
    }

const https = (value: unknown): string | undefined =>
  typeof value === 'string' && value.startsWith('https://') ? value : undefined
const text = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : undefined

/**
 * Estado del comprobante según la respuesta de SUNAT que reenvía Nubefact:
 * aceptado si SUNAT lo aceptó; rechazado si SUNAT devolvió un código de
 * RECHAZO (2000–3999); si no, recibido por el emisor y pendiente de SUNAT
 * (las boletas suelen ir por resumen diario).
 */
function estado(body: Record<string, unknown>): ProviderResult['status'] {
  if (body.aceptada_por_sunat === true) return 'accepted'
  const code = Number.parseInt(String(body.sunat_responsecode ?? ''), 10)
  if (Number.isInteger(code) && code >= 2000 && code <= 3999) return 'rejected'
  return 'issued'
}

export function parseNubefactResponse(httpStatus: number, raw: unknown): NubefactOutcome {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const codigo = typeof body.codigo === 'number' ? body.codigo : Number.parseInt(String(body.codigo ?? ''), 10)
  const errors = Array.isArray(body.errors) ? body.errors.join('; ') : text(body.errors, 500)

  if (errors !== undefined || (Number.isInteger(codigo) && httpStatus !== 200)) {
    const message = `${Number.isInteger(codigo) ? codigo : httpStatus}: ${errors ?? 'sin detalle'}`.slice(0, 500)
    if (codigo === 23) return { kind: 'exists' }
    if ([10, 11, 12, 50, 51].includes(codigo) || httpStatus === 401) {
      return { kind: 'error', code: `NUBEFACT_${codigo || httpStatus}`, message, retryable: true, stopTenant: true }
    }
    if ([20, 21, 22, 24].includes(codigo) || httpStatus === 400) {
      return { kind: 'error', code: `NUBEFACT_${codigo || httpStatus}`, message, retryable: false, stopTenant: false }
    }
    return { kind: 'error', code: `NUBEFACT_${codigo || httpStatus}`, message, retryable: true, stopTenant: false }
  }
  if (httpStatus >= 500) {
    return { kind: 'error', code: `NUBEFACT_HTTP_${httpStatus}`, message: `HTTP ${httpStatus}`, retryable: true, stopTenant: false }
  }
  if (httpStatus !== 200 || body.numero === undefined) {
    return {
      kind: 'error',
      code: `NUBEFACT_RESPUESTA_INESPERADA`,
      message: `HTTP ${httpStatus}`,
      retryable: true,
      stopTenant: false,
    }
  }

  const enlace = https(body.enlace)
  return {
    kind: 'result',
    result: {
      status: estado(body),
      number: text(body.numero, 20),
      document_ref: enlace,
      pdf_url: https(body.enlace_del_pdf) ?? (enlace ? `${enlace}.pdf` : undefined),
      xml_url: https(body.enlace_del_xml),
      cdr_url: https(body.enlace_del_cdr),
      sunat_code: text(body.sunat_responsecode, 20),
      sunat_description: text(body.sunat_description) ?? text(body.sunat_soap_error),
      qr_string: text(body.cadena_para_codigo_qr, 1000),
      hash_code: text(body.codigo_hash, 200),
      detail: text(body.sunat_note) ?? text(body.sunat_description),
    },
  }
}
