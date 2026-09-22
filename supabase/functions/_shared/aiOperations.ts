/**
 * Operaciones con IA (fase 10 de EBIM_AI_SEQUENCE). TypeScript PURO.
 *
 * Sobre `ai_ops_facts` (la salud del tenant con los incidentes AGRUPADOS por
 * tipo y código, o UN incidente con su hilo):
 *
 *  - Resumir incidencias y destacar las relevantes: la gravedad, los picos,
 *    las recurrentes y las viejas las marca el SISTEMA por regla.
 *  - Agrupar errores similares: el grupo (tipo + código) lo hace SQL; la IA
 *    explica qué tienen en común y qué verificar.
 *  - Interpretar un incidente con su hilo (`trace_by_correlation`): qué pasó
 *    antes y después, en minutos relativos.
 *  - Sugerir verificaciones de una lista cerrada (rastrear, revisar el
 *    incidente, mirar la salud, revisar integraciones, verificar la
 *    configuración, vigilar). Ninguna escribe.
 *
 * Todo texto libre (mensaje, resumen del hilo, contexto) llega SANEADO
 * (`aiTechnical.textoSaneado`). La IA no resuelve incidentes: eso es
 * `ops_resolve_event`, con motivo y firma de una persona.
 */
import type { EsquemaIA } from './aiCore.ts'
import type { Metrica } from './aiInsights.ts'
import {
  REGLAS_EXPLICACION,
  booleano,
  entero,
  enumDe,
  esquemaExplicacion,
  lista,
  objeto,
  ordenarSenales,
  poner,
  severidadMaxima,
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
import {
  REGLAS_TECNICAS,
  candadoTecnico,
  contextoPlano,
  etiquetaTecnica,
  nuevoSaneado,
  textoSaneado,
  type Saneado,
} from './aiTechnical.ts'

// ---------------------------------------------------------------------------
// 1 · Listas cerradas y umbrales
// ---------------------------------------------------------------------------

/** Orden = gravedad. */
export const SENALES_OPS = [
  'critical_open',
  'spike',
  'dead_letter',
  'stuck_checkouts',
  'error_open',
  'recurring',
  'related_failures',
  'webhook_rejected',
  'queue_stalled',
  'checkout_failures',
  'payment_failures',
  'integration_failures',
  'stale_platform_context',
  'slow_operations',
  'stale_open',
] as const
export type SenalOps = (typeof SENALES_OPS)[number]

export const ACCIONES_OPS = [
  'review_incident',
  'trace_incident',
  'check_health',
  'review_integrations',
  'verify_configuration',
  'monitor',
] as const
export type AccionOps = (typeof ACCIONES_OPS)[number]

export const SEVERIDAD_OPS: Readonly<Record<SenalOps, 'high' | 'medium' | 'low'>> = {
  critical_open: 'high',
  spike: 'high',
  dead_letter: 'high',
  stuck_checkouts: 'high',
  error_open: 'medium',
  recurring: 'medium',
  related_failures: 'medium',
  webhook_rejected: 'medium',
  queue_stalled: 'medium',
  checkout_failures: 'medium',
  payment_failures: 'medium',
  integration_failures: 'medium',
  stale_platform_context: 'medium',
  slow_operations: 'low',
  stale_open: 'low',
}

/** Los mismos de `ai_ops_facts` (se leen de `thresholds` si llegan). */
export const UMBRALES_OPS = {
  spike_min: 5,
  spike_factor: 3,
  recurring_repeats: 5,
  stale_open_hours: 168,
  queue_stalled_minutes: 15,
  context_stale_hours: 24,
  checkout_failures_min: 3,
  payment_failures_min: 3,
} as const

export const CONFIG_OPS: ConfigExplicacion<SenalOps, AccionOps> = {
  senales: SENALES_OPS,
  severidad: SEVERIDAD_OPS,
  acciones: ACCIONES_OPS,
  accionesDeSenal: {
    critical_open: ['review_incident', 'trace_incident'],
    spike: ['review_incident', 'trace_incident', 'check_health'],
    dead_letter: ['review_integrations', 'check_health'],
    stuck_checkouts: ['check_health', 'trace_incident'],
    error_open: ['review_incident', 'trace_incident'],
    recurring: ['review_incident', 'trace_incident', 'verify_configuration'],
    related_failures: ['trace_incident', 'review_incident'],
    webhook_rejected: ['verify_configuration', 'review_integrations'],
    queue_stalled: ['check_health', 'review_integrations'],
    checkout_failures: ['review_incident', 'trace_incident'],
    payment_failures: ['review_incident', 'verify_configuration'],
    integration_failures: ['review_integrations'],
    stale_platform_context: ['verify_configuration', 'check_health'],
    slow_operations: ['monitor', 'check_health'],
    stale_open: ['review_incident', 'monitor'],
  },
  // Pestañas de `OperationsPage`. Integraciones es OTRA pantalla: sin salto.
  pestanaDeAccion: {
    review_incident: 'incidentes',
    trace_incident: 'rastro',
    check_health: 'salud',
    review_integrations: null,
    verify_configuration: null,
    monitor: null,
  },
  extra: (t) => candadoTecnico(t),
}

// ---------------------------------------------------------------------------
// 2 · De `ai_ops_facts` a hechos
// ---------------------------------------------------------------------------

const TIPOS = [
  'checkout_failed',
  'payment_failed',
  'integration_failed',
  'event_undelivered',
  'webhook_rejected',
  'slow_operation',
] as const
const SEVERIDADES = ['critical', 'error', 'warning', 'info'] as const
const DOMINIOS = ['checkout', 'orders', 'payments', 'fulfillment', 'events', 'integrations', 'audit', 'analytics', 'ops'] as const
const CODIGO = /^[A-Z][A-Z0-9_]{2,80}$/

export interface HechosOps extends HechosExplicables<SenalOps> {
  /** Cuántos textos llevaban secretos/datos tapados y cuántos parecían instrucciones. */
  readonly saneado: Saneado
}

function senal(code: SenalOps, ref: string | null): SenalDetectada<SenalOps> {
  return { code, severity: SEVERIDAD_OPS[code], ref }
}

function codigoOps(v: unknown): string | null {
  return typeof v === 'string' && CODIGO.test(v) ? v : null
}

function umbrales(metrics: Record<string, Metrica>, t: Objeto) {
  poner(metrics, 'spike_min', 'count', entero(t.spike_min) ?? UMBRALES_OPS.spike_min)
  poner(metrics, 'recurring_repeats', 'count', entero(t.recurring_repeats) ?? UMBRALES_OPS.recurring_repeats)
  poner(metrics, 'stale_open_hours', 'count', entero(t.stale_open_hours) ?? UMBRALES_OPS.stale_open_hours)
  poner(metrics, 'queue_stalled_minutes', 'count', entero(t.queue_stalled_minutes) ?? UMBRALES_OPS.queue_stalled_minutes)
  poner(metrics, 'context_stale_hours', 'count', entero(t.context_stale_hours) ?? UMBRALES_OPS.context_stale_hours)
}

/** ¿Pico? ≥ mínimo nuevos en 24 h y ≥ factor × la media diaria de los 6 d previos. */
export function esPico(nuevos24h: number, previos6d: number): boolean {
  return nuevos24h >= UMBRALES_OPS.spike_min && nuevos24h >= UMBRALES_OPS.spike_factor * (previos6d / 6)
}

function empresa(
  r: Objeto,
  metrics: Record<string, Metrica>,
  entities: Record<string, EntidadExplicable>,
  signals: SenalDetectada<SenalOps>[],
  items: ElementoExplicable<SenalOps>[],
  rows: FilaSistema[],
  s: Saneado,
): { contexto: Objeto; noConfiables: Objeto } {
  const sum = objeto(r.summary) ?? {}
  for (const k of ['open_total', 'open_critical', 'open_error', 'open_warning', 'new_24h', 'resolved_7d', 'open_over_7d'] as const) {
    poner(metrics, k, 'count', sum[k])
  }

  const h = objeto(r.health) ?? {}
  const colas = objeto(h.queues) ?? {}
  const eventos = objeto(colas.domain_events) ?? {}
  const salida = objeto(colas.integration_outbox) ?? {}
  const entrada = objeto(colas.integration_inbox) ?? {}
  poner(metrics, 'events_pending', 'count', eventos.pending)
  poner(metrics, 'events_dead', 'count', eventos.dead)
  poner(metrics, 'events_oldest_pending_minutes', 'count', eventos.oldest_pending_minutes)
  poner(metrics, 'outbox_pending', 'count', salida.pending)
  poner(metrics, 'outbox_failed', 'count', salida.failed)
  poner(metrics, 'outbox_dead', 'count', salida.dead)
  poner(metrics, 'outbox_oldest_pending_minutes', 'count', salida.oldest_pending_minutes)
  poner(metrics, 'inbox_unprocessed', 'count', entrada.unprocessed)
  poner(metrics, 'inbox_oldest_pending_minutes', 'count', entrada.oldest_pending_minutes)
  const u24 = objeto(h.last_24h) ?? {}
  poner(metrics, 'checkouts_failed_24h', 'count', u24.checkouts_failed)
  poner(metrics, 'checkouts_total_24h', 'count', u24.checkouts_total)
  poner(metrics, 'payments_failed_24h', 'count', u24.payments_failed)
  poner(metrics, 'integrations_failed_24h', 'count', u24.integrations_failed)
  poner(metrics, 'stuck_checkouts', 'count', h.stuck_checkouts)
  const lentas = objeto(h.slow_operations) ?? {}
  poner(metrics, 'slow_operations_24h', 'count', lentas.count)
  poner(metrics, 'slow_operations_max_ms', 'count', lentas.max_ms)
  const ctx = objeto(h.platform_context) ?? {}
  poner(metrics, 'context_hours_since_sync', 'count', ctx.hours_since_sync)
  const fuenteContexto = etiquetaTecnica(ctx.source, 30)

  const n = (k: string) => valorEntero(metrics, k) ?? 0
  if (n('events_dead') + n('outbox_dead') > 0) signals.push(senal('dead_letter', null))
  if (n('stuck_checkouts') > 0) signals.push(senal('stuck_checkouts', null))
  const parada = UMBRALES_OPS.queue_stalled_minutes
  if (
    n('events_oldest_pending_minutes') > parada ||
    n('outbox_oldest_pending_minutes') > parada ||
    n('inbox_oldest_pending_minutes') > parada
  ) {
    signals.push(senal('queue_stalled', null))
  }
  if (n('checkouts_failed_24h') >= UMBRALES_OPS.checkout_failures_min) signals.push(senal('checkout_failures', null))
  if (n('payments_failed_24h') >= UMBRALES_OPS.payment_failures_min) signals.push(senal('payment_failures', null))
  if (n('integrations_failed_24h') > 0) signals.push(senal('integration_failures', null))
  if (n('slow_operations_24h') > 0) signals.push(senal('slow_operations', null))
  const horasContexto = valorEntero(metrics, 'context_hours_since_sync')
  if (fuenteContexto === 'sin-contexto' || (horasContexto !== null && horasContexto > UMBRALES_OPS.context_stale_hours)) {
    signals.push(senal('stale_platform_context', null))
  }

  const grupos: Objeto[] = []
  const mensajes: Objeto = {}
  for (const g of lista(r.groups, 12)) {
    const kind = enumDe(TIPOS, g.kind)
    const code = codigoOps(g.code)
    const id = uuid(g.latest_event_id)
    if (!kind || !code || !id) continue
    const ref = `G${items.length + 1}`
    const label = `${kind} · ${code}`
    entities[ref] = { kind: 'incident_group', label }
    poner(metrics, `${ref}_open`, 'count', g.open_count)
    poner(metrics, `${ref}_repeats`, 'count', g.repeats)
    poner(metrics, `${ref}_new_24h`, 'count', g.new_24h)
    poner(metrics, `${ref}_prev_6d`, 'count', g.prev_6d)
    poner(metrics, `${ref}_resolved_7d`, 'count', g.resolved_7d)
    poner(metrics, `${ref}_oldest_open_hours`, 'count', g.oldest_open_hours)
    poner(metrics, `${ref}_last_seen_minutes`, 'count', g.last_seen_minutes)
    poner(metrics, `${ref}_max_duration_ms`, 'count', g.max_duration_ms)
    const severidad = enumDe(SEVERIDADES, g.severity)
    const abiertos = entero(g.open_count) ?? 0
    const marcas: SenalOps[] = []
    if (abiertos > 0 && severidad === 'critical') marcas.push('critical_open')
    if (abiertos > 0 && severidad === 'error') marcas.push('error_open')
    if (esPico(entero(g.new_24h) ?? 0, entero(g.prev_6d) ?? 0)) marcas.push('spike')
    if ((entero(g.repeats) ?? 0) >= UMBRALES_OPS.recurring_repeats || abiertos >= UMBRALES_OPS.recurring_repeats) {
      marcas.push('recurring')
    }
    if (abiertos > 0 && (entero(g.oldest_open_hours) ?? 0) > UMBRALES_OPS.stale_open_hours) marcas.push('stale_open')
    if (abiertos > 0 && kind === 'webhook_rejected') marcas.push('webhook_rejected')
    for (const c of marcas) signals.push(senal(c, ref))
    const muestra = textoSaneado(g.sample_message, 200, s)
    if (muestra) mensajes[ref] = muestra
    const operaciones = (Array.isArray(g.operations) ? g.operations : [])
      .map((o) => etiquetaTecnica(o, 60))
      .filter((o): o is string => o !== null)
      .slice(0, 3)
    const fuentes = (Array.isArray(g.sources) ? g.sources : [])
      .map((o) => etiquetaTecnica(o, 60))
      .filter((o): o is string => o !== null)
      .slice(0, 3)
    grupos.push({ ref, kind, code, severity: severidad, open: abiertos > 0, operations: operaciones, sources: fuentes, signals: marcas })
    items.push({
      ref,
      id,
      label,
      severity: marcas.length > 0 ? severidadMaxima(marcas.map((c) => SEVERIDAD_OPS[c])) : 'low',
      signals: SENALES_OPS.filter((c) => marcas.includes(c)),
    })
    rows.push({
      ref,
      group: 'groups',
      label,
      status: severidad,
      metrics: [`${ref}_open`, `${ref}_new_24h`, `${ref}_repeats`, `${ref}_last_seen_minutes`].filter((k) => k in metrics),
      note: muestra,
    })
  }

  return {
    contexto: { platform_context: fuenteContexto, groups: grupos },
    noConfiables: Object.keys(mensajes).length > 0 ? { sample_messages: mensajes } : {},
  }
}

function incidente(
  r: Objeto,
  metrics: Record<string, Metrica>,
  entities: Record<string, EntidadExplicable>,
  signals: SenalDetectada<SenalOps>[],
  rows: FilaSistema[],
  s: Saneado,
): { contexto: Objeto; noConfiables: Objeto } | null {
  const i = objeto(r.incident)
  if (!i || !uuid(i.event_id)) return null
  const kind = enumDe(TIPOS, i.kind)
  const code = codigoOps(i.code)
  if (!kind || !code) return null
  entities.I1 = { kind: 'incident', label: `${kind} · ${code}` }
  poner(metrics, 'I1_age_minutes', 'count', i.age_minutes)
  poner(metrics, 'I1_first_seen_hours', 'count', i.first_seen_hours)
  poner(metrics, 'I1_repeats', 'count', i.repeats)
  poner(metrics, 'I1_similar_7d', 'count', i.similar_7d)
  poner(metrics, 'I1_similar_open', 'count', i.similar_open)
  poner(metrics, 'I1_duration_ms', 'count', i.duration_ms)
  const severidad = enumDe(SEVERIDADES, i.severity)
  const abierto = booleano(i.is_open)

  const traza: Objeto[] = []
  const resumenes: Objeto = {}
  let fallosRelacionados = 0
  lista(r.trace, 20).forEach((t, k) => {
    const dominio = enumDe(DOMINIOS, t.domain)
    if (!dominio) return
    const ref = `T${k + 1}`
    const tipo = etiquetaTecnica(t.entity_type, 40)
    const estado = etiquetaTecnica(t.status, 30)
    const sev = enumDe(SEVERIDADES, t.severity)
    const esEste = booleano(t.is_incident)
    entities[ref] = { kind: 'trace_step', label: `${dominio}${tipo ? ` · ${tipo}` : ''}` }
    poner(metrics, `${ref}_minutes_from_incident`, 'count', t.minutes_from_incident)
    if (!esEste && (sev === 'error' || sev === 'critical')) fallosRelacionados += 1
    const resumen = textoSaneado(t.summary, 120, s)
    if (resumen) resumenes[ref] = resumen
    traza.push({ ref, domain: dominio, entity_type: tipo, status: estado, severity: sev, is_incident: esEste })
    rows.push({
      ref,
      group: 'trace',
      label: entities[ref]!.label,
      status: estado,
      metrics: [`${ref}_minutes_from_incident`].filter((x) => x in metrics),
      note: resumen,
    })
  })

  const repeticiones = entero(i.repeats) ?? 1
  const parecidos = entero(i.similar_7d) ?? 0
  const marcas: SenalOps[] = []
  if (abierto && severidad === 'critical') marcas.push('critical_open')
  if (abierto && severidad === 'error') marcas.push('error_open')
  if (repeticiones >= UMBRALES_OPS.recurring_repeats || parecidos >= UMBRALES_OPS.recurring_repeats) marcas.push('recurring')
  if (fallosRelacionados > 0) marcas.push('related_failures')
  if (abierto && kind === 'webhook_rejected') marcas.push('webhook_rejected')
  if (kind === 'slow_operation') marcas.push('slow_operations')
  if (abierto && (entero(i.age_minutes) ?? 0) > UMBRALES_OPS.stale_open_hours * 60) marcas.push('stale_open')
  for (const c of marcas) signals.push(senal(c, 'I1'))

  const mensaje = textoSaneado(i.message, 400, s)
  const noConfiables: Objeto = {}
  if (mensaje) noConfiables.incident_message = mensaje
  if (Object.keys(resumenes).length > 0) noConfiables.trace_summaries = resumenes
  const contextoIncidente = contextoPlano(i.context, s)
  if (Object.keys(contextoIncidente).length > 0) noConfiables.incident_context = contextoIncidente

  return {
    contexto: {
      incident: {
        ref: 'I1',
        kind,
        code,
        severity: severidad,
        is_open: abierto,
        source: etiquetaTecnica(i.source, 60),
        operation: etiquetaTecnica(i.operation, 60),
        entity_type: etiquetaTecnica(i.entity_type, 40),
        has_trace: booleano(i.has_trace),
        signals: marcas,
      },
      trace: traza,
    },
    noConfiables,
  }
}

/** `null` si la forma no es la esperada. */
export function hechosDeOperaciones(raw: unknown): HechosOps | null {
  const r = objeto(raw)
  if (!r || (r.scope !== 'company' && r.scope !== 'incident')) return null
  const metrics: Record<string, Metrica> = {}
  const entities: Record<string, EntidadExplicable> = {}
  const signals: SenalDetectada<SenalOps>[] = []
  const items: ElementoExplicable<SenalOps>[] = []
  const rows: FilaSistema[] = []
  const s = nuevoSaneado()
  umbrales(metrics, objeto(r.thresholds) ?? {})
  const generatedAt = typeof r.generated_at === 'string' ? r.generated_at : null

  if (r.scope === 'incident') {
    const d = incidente(r, metrics, entities, signals, rows, s)
    if (!d) return null
    return {
      scope: 'incident',
      generatedAt,
      metrics,
      entities,
      signals: ordenarSenales(signals, SENALES_OPS),
      items: [],
      highlights: ['I1_age_minutes', 'I1_repeats', 'I1_similar_7d', 'I1_similar_open', 'I1_duration_ms'].filter((k) => k in metrics),
      rows,
      contexto: { ...d.contexto, sanitized_texts: s.redacted, instruction_like_texts: s.injectionLike },
      noConfiables: d.noConfiables,
      saneado: s,
    }
  }

  const d = empresa(r, metrics, entities, signals, items, rows, s)
  return {
    scope: 'company',
    generatedAt,
    metrics,
    entities,
    signals: ordenarSenales(signals, SENALES_OPS),
    items,
    highlights: [
      'open_critical',
      'open_error',
      'open_warning',
      'new_24h',
      'resolved_7d',
      'events_dead',
      'outbox_dead',
      'stuck_checkouts',
      'checkouts_failed_24h',
      'payments_failed_24h',
      'integrations_failed_24h',
      'slow_operations_24h',
    ].filter((k) => k in metrics),
    rows,
    contexto: { ...d.contexto, sanitized_texts: s.redacted, instruction_like_texts: s.injectionLike },
    noConfiables: d.noConfiables,
    saneado: s,
  }
}

// ---------------------------------------------------------------------------
// 3 · Prompt (constante) y esquema
// ---------------------------------------------------------------------------

const SIGNIFICADO =
  'Significado de las senales: critical_open / error_open = incidentes abiertos de esa gravedad en el grupo; spike = muchos incidentes nuevos en {{spike_min}} o mas en veinticuatro horas frente a la semana previa; recurring = el mismo fallo se repite ({{recurring_repeats}} o mas); stale_open = abierto hace mas de {{stale_open_hours}} horas; dead_letter = hechos o mensajes en cola muerta (no saldran sin una persona); stuck_checkouts = compras atascadas en curso; queue_stalled = el pendiente mas viejo de una cola supera {{queue_stalled_minutes}} minutos; checkout_failures / payment_failures / integration_failures = fallos en las ultimas veinticuatro horas; webhook_rejected = avisos entrantes que no pudieron verificarse (firma o tenant); related_failures = en el hilo del incidente hay otros pasos con error; stale_platform_context = el contexto del hub no se sincroniza hace mas de {{context_stale_hours}} horas; slow_operations = operaciones lentas. Los grupos (G1, G2…) juntan incidentes del mismo tipo y codigo: explica que tienen en comun.'

export const SISTEMA_OPERACIONES = [
  'Eres el asistente tecnico de OPERACIONES del backoffice de una tienda eCommerce. Resumes incidencias, agrupas errores parecidos, interpretas un incidente con su hilo de eventos y sugieres verificaciones.',
  ...REGLAS_EXPLICACION,
  ...REGLAS_TECNICAS,
  SIGNIFICADO,
  'Los minutos del hilo ({{T1_minutes_from_incident}}…) son relativos al incidente: negativos = antes, positivos = despues. Usa el hilo para ordenar lo que paso, sin inventar pasos que no aparecen.',
]
  .join('\n')

export const ESQUEMA_OPERACIONES: EsquemaIA = esquemaExplicacion(SENALES_OPS, ACCIONES_OPS)
