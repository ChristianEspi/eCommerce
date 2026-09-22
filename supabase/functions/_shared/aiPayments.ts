/**
 * Pagos con IA (fase 08 de EBIM_AI_SEQUENCE). TypeScript PURO.
 *
 * Sobre `ai_payments_facts` (la tienda y, opcionalmente, UN cobro):
 *
 *  - Explicar la conciliación y sus diferencias (con los dos importes por
 *    marcador, nunca escritos a mano).
 *  - Resumir los cobros que piden revisión: fallidos, con tiempo agotado
 *    (resultado DESCONOCIDO), autorizados sin capturar, atascados.
 *  - Interpretar los mensajes técnicos: el CÓDIGO del proveedor (el detalle
 *    libre no sale de la base) viaja como entidad `E#` y el modelo explica su
 *    significado habitual, sin afirmar causas que los datos no muestran.
 *
 * Lo que NO puede: marcar como pagado, capturar, anular, devolver ni conciliar.
 * No hay camino de escritura, y el candado descarta todo texto que dé por
 * cobrado un pago que el sistema no tiene capturado.
 */
import type { EsquemaIA } from './aiCore.ts'
import type { Metrica } from './aiInsights.ts'
import {
  REGLAS_EXPLICACION,
  booleano,
  codigo,
  entero,
  enumDe,
  esquemaExplicacion,
  lista,
  MONEDA,
  objeto,
  ordenarSenales,
  poner,
  severidadMaxima,
  texto,
  uuid,
  valorEntero,
  type ConfigExplicacion,
  type ElementoExplicable,
  type EntidadExplicable,
  type FilaSistema,
  type HechosExplicables,
  type Objeto,
  type SenalDetectada,
} from './aiExplain.ts'

// ---------------------------------------------------------------------------
// 1 · Listas cerradas y umbrales
// ---------------------------------------------------------------------------

/** Orden = gravedad. */
export const SENALES_PAGO = [
  'timeout_unknown',
  'reconciliation_discrepancy',
  'currency_mismatch',
  'refund_failed',
  'failed',
  'repeated_failures',
  'authorized_uncaptured',
  'processing_stale',
  'refund_stuck',
  'unverified_events',
  'reconciliation_unmatched',
  'requires_action_stale',
  'unsettled',
  'expired',
] as const
export type SenalPago = (typeof SENALES_PAGO)[number]

export const ACCIONES_PAGO = [
  'review_intent',
  'check_provider',
  'review_capture',
  'review_reconciliation',
  'review_refund',
  'verify_webhook',
  'monitor',
] as const
export type AccionPago = (typeof ACCIONES_PAGO)[number]

export const SEVERIDAD_PAGO: Readonly<Record<SenalPago, 'high' | 'medium' | 'low'>> = {
  timeout_unknown: 'high',
  reconciliation_discrepancy: 'high',
  currency_mismatch: 'high',
  refund_failed: 'high',
  failed: 'medium',
  repeated_failures: 'medium',
  authorized_uncaptured: 'medium',
  processing_stale: 'medium',
  refund_stuck: 'medium',
  unverified_events: 'medium',
  reconciliation_unmatched: 'medium',
  requires_action_stale: 'low',
  unsettled: 'low',
  expired: 'low',
}

export const UMBRALES_PAGO = {
  window_days: 30,
  stale_days: 1,
  capture_days: 3,
  settlement_days: 7,
  refund_days: 3,
  repeated_failures: 3,
} as const

export const CONFIG_PAGOS: ConfigExplicacion<SenalPago, AccionPago> = {
  senales: SENALES_PAGO,
  severidad: SEVERIDAD_PAGO,
  acciones: ACCIONES_PAGO,
  accionesDeSenal: {
    timeout_unknown: ['check_provider', 'review_intent'],
    reconciliation_discrepancy: ['review_reconciliation'],
    currency_mismatch: ['review_reconciliation'],
    refund_failed: ['review_refund', 'check_provider'],
    failed: ['review_intent', 'check_provider'],
    repeated_failures: ['check_provider', 'review_intent'],
    authorized_uncaptured: ['review_capture'],
    processing_stale: ['check_provider', 'review_intent'],
    refund_stuck: ['review_refund'],
    unverified_events: ['verify_webhook'],
    reconciliation_unmatched: ['review_reconciliation'],
    requires_action_stale: ['review_intent', 'monitor'],
    unsettled: ['review_reconciliation', 'monitor'],
    expired: ['monitor'],
  },
  // Pestañas de `PaymentsPage`.
  pestanaDeAccion: {
    review_intent: 'cobros',
    check_provider: 'medios',
    review_capture: 'cobros',
    review_reconciliation: 'conciliacion',
    review_refund: 'cobros',
    verify_webhook: null,
    monitor: null,
  },
  extra: (t, h) => afirmaCobroSinCaptura(t, h),
}

// ---------------------------------------------------------------------------
// 2 · De `ai_payments_facts` a hechos
// ---------------------------------------------------------------------------

const ESTADOS_INTENTO = ['open', 'processing', 'requires_action', 'authorized', 'captured', 'failed', 'cancelled', 'expired'] as const
const ESTADOS_ATTEMPT = ['pending', 'succeeded', 'declined', 'failed', 'timeout'] as const
const ESTADOS_COBRO = ['captured', 'partially_refunded', 'refunded'] as const
const ESTADOS_DEVOLUCION = ['requested', 'processing', 'succeeded', 'failed', 'cancelled'] as const
const ESTADOS_CONCILIACION = ['unmatched', 'matched', 'discrepancy', 'ignored'] as const
const FUENTES = ['provider_response', 'provider_webhook', 'browser_return', 'operator', 'system'] as const
const TIPOS_MEDIO = ['card', 'wallet', 'bank_transfer', 'cash', 'credit', 'other'] as const

export interface HechosPagos extends HechosExplicables<SenalPago> {
  /** Estado del cobro en el ámbito `intent` (`null` en el de tienda). */
  readonly intentStatus: (typeof ESTADOS_INTENTO)[number] | null
}

function monedaDe(v: unknown): string | null {
  return typeof v === 'string' && MONEDA.test(v) ? v : null
}

function senal(code: SenalPago, ref: string | null): SenalDetectada<SenalPago> {
  return { code, severity: SEVERIDAD_PAGO[code], ref }
}

/** Registra un código técnico como entidad `E#` (reutiliza la misma si se repite). */
function entidadDeCodigo(entities: Record<string, EntidadExplicable>, code: string | null): string | null {
  if (!code) return null
  for (const [ref, e] of Object.entries(entities)) {
    if (e.kind === 'error_code' && e.label === code) return ref
  }
  const n = Object.values(entities).filter((e) => e.kind === 'error_code').length + 1
  const ref = `E${n}`
  entities[ref] = { kind: 'error_code', label: code }
  return ref
}

function umbrales(metrics: Record<string, Metrica>) {
  poner(metrics, 'window_days', 'days', UMBRALES_PAGO.window_days)
  poner(metrics, 'stale_days', 'days', UMBRALES_PAGO.stale_days)
  poner(metrics, 'capture_days', 'days', UMBRALES_PAGO.capture_days)
  poner(metrics, 'settlement_days', 'days', UMBRALES_PAGO.settlement_days)
  poner(metrics, 'refund_days', 'days', UMBRALES_PAGO.refund_days)
}

/** La tienda: resumen, cobros a revisar y liquidaciones sin cruzar. */
function tienda(
  r: Objeto,
  metrics: Record<string, Metrica>,
  entities: Record<string, EntidadExplicable>,
  signals: SenalDetectada<SenalPago>[],
  items: ElementoExplicable<SenalPago>[],
  rows: FilaSistema[],
) {
  const s = objeto(r.summary) ?? {}
  for (const k of [
    'intents_30d',
    'failed_30d',
    'expired_30d',
    'requires_action_stale',
    'processing_stale',
    'authorized_uncaptured',
    'captured_30d',
    'attempts_timeout_30d',
    'attempts_failed_30d',
    'refunds_failed_30d',
    'refunds_stuck',
    'unsettled_7d',
    'unverified_events_30d',
    'reconciliation_unmatched',
    'reconciliation_discrepancy',
    'reconciliation_matched_30d',
  ] as const) {
    poner(metrics, k, 'count', s[k])
  }
  const n = (k: string) => valorEntero(metrics, k) ?? 0
  const deConjunto: [string, SenalPago][] = [
    ['attempts_timeout_30d', 'timeout_unknown'],
    ['reconciliation_discrepancy', 'reconciliation_discrepancy'],
    ['refunds_failed_30d', 'refund_failed'],
    ['failed_30d', 'failed'],
    ['authorized_uncaptured', 'authorized_uncaptured'],
    ['processing_stale', 'processing_stale'],
    ['refunds_stuck', 'refund_stuck'],
    ['unverified_events_30d', 'unverified_events'],
    ['reconciliation_unmatched', 'reconciliation_unmatched'],
    ['requires_action_stale', 'requires_action_stale'],
    ['unsettled_7d', 'unsettled'],
    ['expired_30d', 'expired'],
  ]
  for (const [k, code] of deConjunto) if (n(k) > 0) signals.push(senal(code, null))

  // Códigos más repetidos: entidad + métrica con su conteo.
  for (const x of lista(r.error_codes, 5)) {
    const ref = entidadDeCodigo(entities, codigo(x.code))
    if (ref) poner(metrics, `${ref}_count`, 'count', x.count)
  }

  for (const x of lista(r.intents, 12)) {
    const id = uuid(x.intent_id)
    if (!id) continue
    const marcas = (Array.isArray(x.signals) ? x.signals : [])
      .map((m) => enumDe(SENALES_PAGO, m))
      .filter((m): m is SenalPago => m !== null)
    if (marcas.length === 0) continue
    const ref = `I${items.filter((i) => i.ref.startsWith('I')).length + 1}`
    const label = texto(x.order_number, 40) ?? ref
    entities[ref] = { kind: 'intent', label }
    const mon = monedaDe(x.currency)
    poner(metrics, `${ref}_amount`, 'money', x.amount, mon)
    poner(metrics, `${ref}_failed_attempts`, 'count', x.failed_attempts)
    poner(metrics, `${ref}_days_since_update`, 'days', x.days_since_update)
    const errorRef = entidadDeCodigo(entities, codigo(x.last_error_code))
    for (const c of marcas) signals.push(senal(c, ref))
    items.push({
      ref,
      id,
      label,
      severity: severidadMaxima(marcas.map((c) => SEVERIDAD_PAGO[c])),
      signals: SENALES_PAGO.filter((c) => marcas.includes(c)),
    })
    rows.push({
      ref,
      group: 'intents',
      label,
      status: enumDe(ESTADOS_INTENTO, x.status),
      metrics: [`${ref}_amount`, `${ref}_failed_attempts`, `${ref}_days_since_update`].filter((k) => k in metrics),
      note: errorRef ? entities[errorRef]!.label : null,
    })
  }

  for (const x of lista(r.reconciliation, 10)) {
    const estado = enumDe(ESTADOS_CONCILIACION, x.status)
    const recordId = uuid(x.record_id)
    if (!estado || !recordId) continue
    const ref = `L${items.filter((i) => i.ref.startsWith('L')).length + 1}`
    const label = texto(x.reference, 40) ?? ref
    entities[ref] = { kind: 'settlement', label }
    const mon = monedaDe(x.currency)
    poner(metrics, `${ref}_gross`, 'money', x.gross_amount, mon)
    poner(metrics, `${ref}_fee`, 'money', x.fee_amount, mon)
    poner(metrics, `${ref}_net`, 'money', x.net_amount, mon)
    poner(metrics, `${ref}_payment_amount`, 'money', x.payment_amount, monedaDe(x.payment_currency))
    poner(metrics, `${ref}_days_since_settlement`, 'days', x.days_since_settlement)
    const marcas: SenalPago[] = []
    if (estado === 'discrepancy') marcas.push('reconciliation_discrepancy')
    if (estado === 'unmatched') marcas.push('reconciliation_unmatched')
    if (booleano(x.currency_mismatch)) marcas.push('currency_mismatch')
    for (const c of marcas) signals.push(senal(c, ref))
    if (marcas.length > 0) {
      items.push({
        ref,
        id: recordId,
        label,
        severity: severidadMaxima(marcas.map((c) => SEVERIDAD_PAGO[c])),
        signals: SENALES_PAGO.filter((c) => marcas.includes(c)),
      })
    }
    rows.push({
      ref,
      group: 'reconciliation',
      label,
      status: estado,
      metrics: [`${ref}_gross`, `${ref}_payment_amount`, `${ref}_fee`, `${ref}_days_since_settlement`].filter((k) => k in metrics),
      note: null,
    })
  }
}

/** Un cobro: estado, intentos, eventos, cobro, devoluciones y liquidación. */
function cobro(
  i: Objeto,
  metrics: Record<string, Metrica>,
  entities: Record<string, EntidadExplicable>,
  signals: SenalDetectada<SenalPago>[],
  rows: FilaSistema[],
): { status: (typeof ESTADOS_INTENTO)[number] | null; contexto: Objeto } {
  const status = enumDe(ESTADOS_INTENTO, i.status)
  const label = texto(i.order_number, 40) ?? 'I1'
  entities.I1 = { kind: 'intent', label }
  const mon = monedaDe(i.currency)
  poner(metrics, 'I1_amount', 'money', i.amount, mon)
  poner(metrics, 'I1_authorized', 'money', i.amount_authorized, mon)
  poner(metrics, 'I1_captured', 'money', i.amount_captured, mon)
  poner(metrics, 'I1_refunded', 'money', i.amount_refunded, mon)
  poner(metrics, 'I1_days_since_created', 'days', i.days_since_created)
  poner(metrics, 'I1_days_since_update', 'days', i.days_since_update)
  const errorRef = entidadDeCodigo(entities, codigo(i.last_error_code))
  const diasSinCambios = entero(i.days_since_update) ?? 0

  let fallidos = 0
  let timeouts = 0
  const intentos = lista(i.attempts, 10)
  intentos.forEach((a, k) => {
    const estado = enumDe(ESTADOS_ATTEMPT, a.status)
    if (!estado) return
    const ref = `A${k + 1}`
    if (estado === 'declined' || estado === 'failed') fallidos += 1
    if (estado === 'timeout') timeouts += 1
    poner(metrics, `${ref}_latency_ms`, 'count', a.latency_ms)
    poner(metrics, `${ref}_days_ago`, 'days', a.days_ago)
    const codigoRef = entidadDeCodigo(entities, codigo(a.error_code) ?? codigo(a.provider_result_code))
    rows.push({
      ref: null,
      group: 'attempts',
      label: `${codigo(a.operation, 40) ?? 'payment'} · ${entero(a.attempt_no) ?? k + 1}`,
      status: estado,
      metrics: [`${ref}_days_ago`, `${ref}_latency_ms`].filter((x) => x in metrics),
      note: codigoRef ? entities[codigoRef]!.label : null,
    })
  })
  poner(metrics, 'I1_failed_attempts', 'count', fallidos)
  poner(metrics, 'I1_timeout_attempts', 'count', timeouts)

  let sinVerificar = 0
  for (const e of lista(i.events, 10)) {
    const fuente = enumDe(FUENTES, e.source)
    if (fuente === 'provider_webhook' && !booleano(e.signature_verified)) sinVerificar += 1
    rows.push({
      ref: null,
      group: 'events',
      label: codigo(e.event_type, 60) ?? 'event',
      status: fuente,
      metrics: [],
      note: fuente === 'provider_webhook' ? (booleano(e.signature_verified) ? 'signature_ok' : 'signature_missing') : null,
    })
  }

  let sinLiquidar = false
  lista(i.payments, 3).forEach((p, k) => {
    const ref = `P${k + 1}`
    const m = monedaDe(p.currency)
    poner(metrics, `${ref}_amount`, 'money', p.amount, m)
    poner(metrics, `${ref}_refunded`, 'money', p.amount_refunded, m)
    poner(metrics, `${ref}_days_since_capture`, 'days', p.days_since_capture)
    const dias = entero(p.days_since_capture)
    if (!booleano(p.settled) && dias !== null && dias >= UMBRALES_PAGO.settlement_days) sinLiquidar = true
    rows.push({
      ref: null,
      group: 'payments',
      label: ref,
      status: enumDe(ESTADOS_COBRO, p.status),
      metrics: [`${ref}_amount`, `${ref}_refunded`, `${ref}_days_since_capture`].filter((x) => x in metrics),
      note: booleano(p.settled) ? 'settled' : 'not_settled',
    })
  })

  let devolucionFallida = false
  let devolucionAtascada = false
  lista(i.refunds, 5).forEach((d, k) => {
    const ref = `R${k + 1}`
    const estado = enumDe(ESTADOS_DEVOLUCION, d.status)
    poner(metrics, `${ref}_amount`, 'money', d.amount, monedaDe(d.currency))
    poner(metrics, `${ref}_days_ago`, 'days', d.days_ago)
    const dias = entero(d.days_ago) ?? 0
    if (estado === 'failed') devolucionFallida = true
    if ((estado === 'requested' || estado === 'processing') && dias >= UMBRALES_PAGO.refund_days) devolucionAtascada = true
    const codigoRef = entidadDeCodigo(entities, codigo(d.error_code))
    rows.push({
      ref: null,
      group: 'refunds',
      label: ref,
      status: estado,
      metrics: [`${ref}_amount`, `${ref}_days_ago`].filter((x) => x in metrics),
      note: codigoRef ? entities[codigoRef]!.label : null,
    })
  })

  let diferencia = false
  lista(i.reconciliation, 5).forEach((c, k) => {
    const ref = `L${k + 1}`
    const estado = enumDe(ESTADOS_CONCILIACION, c.status)
    if (estado === 'discrepancy') diferencia = true
    const m = monedaDe(c.currency)
    poner(metrics, `${ref}_gross`, 'money', c.gross_amount, m)
    poner(metrics, `${ref}_fee`, 'money', c.fee_amount, m)
    poner(metrics, `${ref}_net`, 'money', c.net_amount, m)
    poner(metrics, `${ref}_days_since_settlement`, 'days', c.days_since_settlement)
    rows.push({
      ref: null,
      group: 'reconciliation',
      label: ref,
      status: estado,
      metrics: [`${ref}_gross`, `${ref}_fee`, `${ref}_net`].filter((x) => x in metrics),
      note: null,
    })
  })

  const cerrado = status === 'captured' || status === 'cancelled'
  const marcas: SenalPago[] = []
  if (timeouts > 0 && !cerrado) marcas.push('timeout_unknown')
  if (diferencia) marcas.push('reconciliation_discrepancy')
  if (devolucionFallida) marcas.push('refund_failed')
  if (status === 'failed') marcas.push('failed')
  if (fallidos >= UMBRALES_PAGO.repeated_failures) marcas.push('repeated_failures')
  if (status === 'authorized' && diasSinCambios >= UMBRALES_PAGO.capture_days) marcas.push('authorized_uncaptured')
  if ((status === 'open' || status === 'processing') && diasSinCambios >= UMBRALES_PAGO.stale_days) marcas.push('processing_stale')
  if (devolucionAtascada) marcas.push('refund_stuck')
  if (sinVerificar > 0) marcas.push('unverified_events')
  if (status === 'requires_action' && diasSinCambios >= UMBRALES_PAGO.stale_days) marcas.push('requires_action_stale')
  if (sinLiquidar) marcas.push('unsettled')
  if (status === 'expired' || booleano(i.expired)) marcas.push('expired')
  for (const c of marcas) signals.push(senal(c, 'I1'))

  return {
    status,
    contexto: {
      intent: {
        ref: 'I1',
        status,
        capture_mode: i.capture_mode === 'manual' ? 'manual' : 'automatic',
        method_kind: enumDe(TIPOS_MEDIO, i.method_kind),
        provider: codigo(i.provider_code, 40),
        order_payment_status: codigo(i.order_payment_status, 30),
        last_error: errorRef,
        signals: marcas,
      },
    },
  }
}

/** `null` si la forma no es la esperada. */
export function hechosDePagos(raw: unknown): HechosPagos | null {
  const r = objeto(raw)
  if (!r || (r.scope !== 'store' && r.scope !== 'intent')) return null
  const metrics: Record<string, Metrica> = {}
  const entities: Record<string, EntidadExplicable> = {}
  const signals: SenalDetectada<SenalPago>[] = []
  const items: ElementoExplicable<SenalPago>[] = []
  const rows: FilaSistema[] = []
  umbrales(metrics)

  if (r.scope === 'intent') {
    const i = objeto(r.intent)
    if (!i || !uuid(i.intent_id)) return null
    const { status, contexto } = cobro(i, metrics, entities, signals, rows)
    return {
      scope: 'intent',
      generatedAt: typeof r.generated_at === 'string' ? r.generated_at : null,
      metrics,
      entities,
      signals: ordenarSenales(signals, SENALES_PAGO),
      items: [],
      highlights: ['I1_amount', 'I1_authorized', 'I1_captured', 'I1_refunded', 'I1_failed_attempts', 'I1_timeout_attempts', 'I1_days_since_update'].filter(
        (k) => k in metrics,
      ),
      rows,
      contexto,
      noConfiables: {},
      intentStatus: status,
    }
  }

  tienda(r, metrics, entities, signals, items, rows)
  return {
    scope: 'store',
    generatedAt: typeof r.generated_at === 'string' ? r.generated_at : null,
    metrics,
    entities,
    signals: ordenarSenales(signals, SENALES_PAGO),
    items,
    highlights: [
      'failed_30d',
      'attempts_timeout_30d',
      'authorized_uncaptured',
      'processing_stale',
      'requires_action_stale',
      'refunds_failed_30d',
      'refunds_stuck',
      'unsettled_7d',
      'reconciliation_discrepancy',
      'reconciliation_unmatched',
      'unverified_events_30d',
      'captured_30d',
    ].filter((k) => k in metrics),
    rows,
    contexto: {
      intents: items.filter((i) => i.ref.startsWith('I')).map((i) => ({ ref: i.ref, signals: i.signals })),
      reconciliation: items.filter((i) => i.ref.startsWith('L')).map((i) => ({ ref: i.ref, signals: i.signals })),
      error_codes: Object.entries(entities)
        .filter(([, e]) => e.kind === 'error_code')
        .map(([ref]) => ref),
    },
    noConfiables: {},
    intentStatus: null,
  }
}

// ---------------------------------------------------------------------------
// 3 · Candados propios
// ---------------------------------------------------------------------------

/** «Está pagado / se cobró / quedó conciliado». */
const COBRO_AFIRMADO =
  /\b((est[aá]|fue|qued[oó]|ha sido|se ha|ya se)\s+(\w+\s+)?(pagad|cobrad|capturad|liquidad|conciliad)\w*|(is|was|has been|got) (paid|captured|settled|reconciled|charged)|payment (succeeded|went through|was successful))\b/i

/**
 * Con un cobro que el sistema NO tiene capturado, ninguna frase puede darlo por
 * cobrado: un tiempo agotado dice que NO SE SABE, no que se cobró. En el ámbito
 * de tienda (varios cobros) tampoco: la IA no decide qué está pagado.
 */
export function afirmaCobroSinCaptura(t: string, h: HechosExplicables<SenalPago>): boolean {
  const estado = (h as Partial<HechosPagos>).intentStatus ?? null
  if (estado === 'captured') return false
  return COBRO_AFIRMADO.test(t)
}

// ---------------------------------------------------------------------------
// 4 · Prompt (constante) y esquema
// ---------------------------------------------------------------------------

const SIGNIFICADO =
  'Significado de las senales: timeout_unknown = una llamada al proveedor agoto el tiempo: NO se sabe si se cobro (nunca digas que se cobro ni que no); reconciliation_discrepancy = el extracto del proveedor y el cobro no coinciden (compara {{L1_gross}} con {{L1_payment_amount}}); currency_mismatch = monedas distintas entre extracto y cobro; refund_failed / refund_stuck = devolucion fallida o sin cerrar en {{refund_days}}; failed = cobro rechazado; repeated_failures = varios intentos rechazados; authorized_uncaptured = autorizado y sin capturar en {{capture_days}} (captura manual: lo decide una persona); processing_stale / requires_action_stale = sin cambios en {{stale_days}}; unverified_events = avisos del proveedor sin firma valida (no mueven dinero); reconciliation_unmatched = liquidacion sin cobro asociado; unsettled = cobro capturado sin liquidar en {{settlement_days}}; expired = el cobro vencio.'

export const SISTEMA_PAGOS = [
  'Eres el analista de pagos del backoffice de una tienda eCommerce. Explicas cobros, fallos y conciliacion de la TIENDA o de UN cobro.',
  ...REGLAS_EXPLICACION,
  SIGNIFICADO,
  'CODIGOS TECNICOS: las entidades de tipo error_code son codigos del proveedor. Explica su significado HABITUAL en pasarelas de pago (por ejemplo, fondos insuficientes o rechazo del banco emisor) indicando que es la interpretacion usual del codigo; si no conoces un codigo, dilo. No afirmes causas que los datos no muestran.',
  'Nunca des por pagado, cobrado, capturado ni conciliado algo que el sistema no muestra asi. Marcar como pagado, capturar, anular, devolver o conciliar lo hace una persona con los controles de la pantalla.',
].join('\n')

export const ESQUEMA_PAGOS: EsquemaIA = esquemaExplicacion(SENALES_PAGO, ACCIONES_PAGO)
