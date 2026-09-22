/**
 * Integraciones con IA (fase 10 de EBIM_AI_SEQUENCE). TypeScript PURO.
 *
 * Sobre `ai_integrations_facts` (la sociedad: proveedores, mensajes fallidos,
 * disyuntores, webhooks, bandeja y API de socio; o UN mensaje con sus
 * intentos):
 *
 *  - Agrupar errores similares: el SISTEMA agrupa los mensajes por proveedor,
 *    operación, clase de error (código HTTP + patrones) y HUELLA del texto
 *    (`aiTechnical.huellaDeError`). La IA explica cada grupo.
 *  - Interpretar errores de API, webhook y ERP: el código HTTP viaja como
 *    entidad (`H1` = «HTTP 401») y la clase (`auth`, `timeout`,
 *    `validation`…) la decide la regla, no el modelo.
 *  - Detectar patrones observables: disyuntores abiertos, proveedores sin
 *    éxito reciente, colas paradas, reproducciones repetidas, errores de la
 *    API por ruta.
 *  - Sugerir verificaciones de una lista cerrada. Ninguna escribe.
 *
 * Todo texto de error llega SANEADO. La IA no reintenta, no reproduce, no
 * cierra disyuntores, no rota credenciales ni modifica una integración: esos
 * son `integration_retry`, `webhook_replay`, `integration_circuit_reset` y la
 * pantalla de configuración, con motivo y auditoría.
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
  clasificarError,
  codigoHttp,
  entidadHttp,
  etiquetaTecnica,
  huellaDeError,
  nuevoSaneado,
  textoSaneado,
  type ClaseError,
  type Saneado,
} from './aiTechnical.ts'

// ---------------------------------------------------------------------------
// 1 · Listas cerradas y umbrales
// ---------------------------------------------------------------------------

/** Orden = gravedad. */
export const SENALES_INTEGRACION = [
  'auth_failure',
  'endpoint_not_found',
  'connectivity',
  'dead_messages',
  'open_circuit',
  'no_recent_success',
  'remote_error',
  'timeout',
  'rate_limited',
  'validation_error',
  'webhook_failures',
  'api_auth_errors',
  'api_errors',
  'queue_stalled',
  'inbox_backlog',
  'retrying_backlog',
  'repeated_replays',
  'unknown_error',
] as const
export type SenalIntegracion = (typeof SENALES_INTEGRACION)[number]

export const ACCIONES_INTEGRACION = [
  'review_message',
  'check_credentials',
  'check_endpoint',
  'check_remote_system',
  'review_payload_mapping',
  'review_health',
  'review_api_clients',
  'monitor',
] as const
export type AccionIntegracion = (typeof ACCIONES_INTEGRACION)[number]

export const SEVERIDAD_INTEGRACION: Readonly<Record<SenalIntegracion, 'high' | 'medium' | 'low'>> = {
  auth_failure: 'high',
  endpoint_not_found: 'high',
  connectivity: 'high',
  dead_messages: 'high',
  open_circuit: 'high',
  no_recent_success: 'medium',
  remote_error: 'medium',
  timeout: 'medium',
  rate_limited: 'medium',
  validation_error: 'medium',
  webhook_failures: 'medium',
  api_auth_errors: 'medium',
  api_errors: 'medium',
  queue_stalled: 'medium',
  inbox_backlog: 'medium',
  retrying_backlog: 'low',
  repeated_replays: 'low',
  unknown_error: 'low',
}

/** Los mismos de `ai_integrations_facts`. */
export const UMBRALES_INTEGRACION = {
  queue_stalled_minutes: 15,
  api_error_min: 5,
  api_error_percent: 10,
  api_auth_min: 3,
  replays_min: 3,
} as const

/** La clase de error (regla) → la señal que la representa. */
export const SENAL_DE_CLASE: Readonly<Record<ClaseError, SenalIntegracion>> = {
  auth: 'auth_failure',
  not_found: 'endpoint_not_found',
  connectivity: 'connectivity',
  timeout: 'timeout',
  rate_limit: 'rate_limited',
  validation: 'validation_error',
  remote_error: 'remote_error',
  unknown: 'unknown_error',
}

export const CONFIG_INTEGRACIONES: ConfigExplicacion<SenalIntegracion, AccionIntegracion> = {
  senales: SENALES_INTEGRACION,
  severidad: SEVERIDAD_INTEGRACION,
  acciones: ACCIONES_INTEGRACION,
  accionesDeSenal: {
    auth_failure: ['check_credentials', 'review_message'],
    endpoint_not_found: ['check_endpoint', 'check_remote_system'],
    connectivity: ['check_endpoint', 'check_remote_system'],
    dead_messages: ['review_message', 'review_health'],
    open_circuit: ['review_health', 'check_remote_system'],
    no_recent_success: ['review_health', 'check_remote_system'],
    remote_error: ['check_remote_system', 'monitor'],
    timeout: ['check_remote_system', 'monitor'],
    rate_limited: ['monitor', 'check_remote_system'],
    validation_error: ['review_payload_mapping', 'review_message'],
    webhook_failures: ['check_endpoint', 'review_message'],
    api_auth_errors: ['review_api_clients', 'check_credentials'],
    api_errors: ['review_api_clients', 'monitor'],
    queue_stalled: ['review_health', 'monitor'],
    inbox_backlog: ['review_health'],
    retrying_backlog: ['monitor', 'review_message'],
    repeated_replays: ['check_endpoint', 'monitor'],
    unknown_error: ['review_message'],
  },
  // Pestañas de `IntegrationsPage`.
  pestanaDeAccion: {
    review_message: 'cola',
    check_credentials: null,
    check_endpoint: 'webhooks',
    check_remote_system: null,
    review_payload_mapping: 'cola',
    review_health: 'salud',
    review_api_clients: 'api',
    monitor: null,
  },
  extra: (t) => candadoTecnico(t),
}

// ---------------------------------------------------------------------------
// 2 · De `ai_integrations_facts` a hechos
// ---------------------------------------------------------------------------

const ESTADOS_MENSAJE = ['pending', 'in_flight', 'succeeded', 'failed', 'dead'] as const
const ESTADOS_CIRCUITO = ['closed', 'open', 'half_open'] as const
const TIPOS_PROVEEDOR = ['erp', 'payment', 'invoicing', 'logistics', 'messaging', 'identity', 'webhook'] as const
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export interface HechosIntegraciones extends HechosExplicables<SenalIntegracion> {
  readonly saneado: Saneado
}

function senal(code: SenalIntegracion, ref: string | null): SenalDetectada<SenalIntegracion> {
  return { code, severity: SEVERIDAD_INTEGRACION[code], ref }
}

/** Ruta de la API sin ids: `/v1/orders/{id}`. Lo que no tenga forma de ruta, fuera. */
export function rutaSegura(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const r = v
    .replace(UUID_G, '{id}')
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg) ? '{id}' : seg))
    .join('/')
  return /^\/v\d{1,3}(\/[A-Za-z0-9_{}.-]+)*$/.test(r) && r.length <= 80 ? r : null
}

function nombreDestino(v: unknown): string | null {
  return textoSaneado(v, 60, { redacted: 0, injectionLike: 0 })
}

interface GrupoError {
  ref: string
  id: string
  provider: string
  operation: string
  clase: ClaseError
  estados: Set<number>
  mensajes: number
  muertos: number
  reintentando: number
  maxIntentos: number
  ultimaActualizacion: number | null
  circuitoAbierto: boolean
  muestra: string | null
  label: string
}

function empresa(
  r: Objeto,
  metrics: Record<string, Metrica>,
  entities: Record<string, EntidadExplicable>,
  signals: SenalDetectada<SenalIntegracion>[],
  items: ElementoExplicable<SenalIntegracion>[],
  rows: FilaSistema[],
  s: Saneado,
): { contexto: Objeto; noConfiables: Objeto } {
  const sum = objeto(r.summary) ?? {}
  for (const k of ['pending', 'in_flight', 'retrying', 'failed', 'dead', 'oldest_pending_minutes', 'succeeded_24h', 'failed_attempts_24h'] as const) {
    poner(metrics, k, 'count', sum[k])
  }
  const inbox = objeto(r.inbox) ?? {}
  poner(metrics, 'inbox_unprocessed', 'count', inbox.unprocessed)
  poner(metrics, 'inbox_oldest_pending_minutes', 'count', inbox.oldest_pending_minutes)
  const api = objeto(r.api) ?? {}
  poner(metrics, 'api_requests_24h', 'count', api.requests_24h)
  poner(metrics, 'api_errors_4xx_24h', 'count', api.errors_4xx_24h)
  poner(metrics, 'api_errors_5xx_24h', 'count', api.errors_5xx_24h)
  poner(metrics, 'api_auth_errors_24h', 'count', api.auth_errors_24h)
  poner(metrics, 'api_rate_limited_24h', 'count', api.rate_limited_24h)

  const n = (k: string) => valorEntero(metrics, k) ?? 0
  if (n('oldest_pending_minutes') > UMBRALES_INTEGRACION.queue_stalled_minutes) signals.push(senal('queue_stalled', null))
  if (n('inbox_unprocessed') > 0 && n('inbox_oldest_pending_minutes') > UMBRALES_INTEGRACION.queue_stalled_minutes) {
    signals.push(senal('inbox_backlog', null))
  }
  const erroresApi = n('api_errors_4xx_24h') + n('api_errors_5xx_24h')
  if (
    erroresApi >= UMBRALES_INTEGRACION.api_error_min &&
    erroresApi * 100 >= UMBRALES_INTEGRACION.api_error_percent * Math.max(n('api_requests_24h'), 1)
  ) {
    signals.push(senal('api_errors', null))
  }
  if (n('api_auth_errors_24h') >= UMBRALES_INTEGRACION.api_auth_min) signals.push(senal('api_auth_errors', null))

  // Proveedores.
  const proveedores: Objeto[] = []
  lista(r.providers, 20).forEach((p, k) => {
    const code = etiquetaTecnica(p.provider_code, 40)
    if (!code) return
    const ref = `P${k + 1}`
    const label = nombreDestino(p.provider_name) ?? code
    entities[ref] = { kind: 'provider', label }
    for (const m of ['pending', 'dead', 'succeeded_24h', 'failed_24h', 'hours_since_success', 'open_circuits'] as const) {
      poner(metrics, `${ref}_${m}`, 'count', p[m])
    }
    const marcas: SenalIntegracion[] = []
    if ((entero(p.failed_24h) ?? 0) > 0 && (entero(p.succeeded_24h) ?? 0) === 0) marcas.push('no_recent_success')
    for (const c of marcas) signals.push(senal(c, ref))
    proveedores.push({
      ref,
      code,
      kind: enumDe(TIPOS_PROVEEDOR, p.provider_kind),
      active: booleano(p.is_active),
      direction: etiquetaTecnica(p.direction, 20),
      signals: marcas,
    })
    rows.push({
      ref,
      group: 'providers',
      label,
      status: booleano(p.is_active) ? 'active' : 'inactive',
      metrics: [`${ref}_pending`, `${ref}_dead`, `${ref}_failed_24h`, `${ref}_succeeded_24h`, `${ref}_hours_since_success`].filter(
        (x) => x in metrics,
      ),
      note: null,
    })
  })

  // Mensajes → grupos de errores parecidos (regla del sistema).
  const grupos = new Map<string, GrupoError>()
  for (const m of lista(r.messages, 25)) {
    const id = uuid(m.outbox_id)
    const estado = enumDe(ESTADOS_MENSAJE, m.status)
    const provider = etiquetaTecnica(m.provider_code, 40)
    const operation = etiquetaTecnica(m.operation, 60)
    if (!id || !estado || !provider || !operation) continue
    const status = codigoHttp(m.last_status_code)
    const error = textoSaneado(m.last_error, 200, s)
    const clase = clasificarError(status, error)
    const clave = `${provider}|${operation}|${clase}|${status ?? ''}|${huellaDeError(error)}`
    let g = grupos.get(clave)
    if (!g) {
      // Diez grupos como mucho; el resto de mensajes solo suma a los que hay.
      if (grupos.size >= 10) continue
      const ref = `G${grupos.size + 1}`
      const destino = nombreDestino(m.target_label) ?? nombreDestino(m.provider_name) ?? provider
      g = {
        ref,
        id,
        provider,
        operation,
        clase,
        estados: new Set(),
        mensajes: 0,
        muertos: 0,
        reintentando: 0,
        maxIntentos: 0,
        ultimaActualizacion: null,
        circuitoAbierto: false,
        muestra: error,
        label: `${destino} · ${operation}`,
      }
      grupos.set(clave, g)
    }
    if (status !== null) g.estados.add(status)
    g.mensajes += 1
    if (estado === 'dead') g.muertos += 1
    if (estado === 'pending' && (entero(m.attempts) ?? 0) > 0) g.reintentando += 1
    g.maxIntentos = Math.max(g.maxIntentos, entero(m.attempts) ?? 0)
    const act = entero(m.minutes_since_update)
    if (act !== null) g.ultimaActualizacion = g.ultimaActualizacion === null ? act : Math.min(g.ultimaActualizacion, act)
    const circuito = enumDe(ESTADOS_CIRCUITO, m.circuit_state)
    if (circuito === 'open' || circuito === 'half_open') g.circuitoAbierto = true
  }

  const contextoGrupos: Objeto[] = []
  const muestras: Objeto = {}
  for (const g of grupos.values()) {
    entities[g.ref] = { kind: 'error_group', label: g.label }
    poner(metrics, `${g.ref}_messages`, 'count', g.mensajes)
    poner(metrics, `${g.ref}_dead`, 'count', g.muertos)
    poner(metrics, `${g.ref}_retrying`, 'count', g.reintentando)
    poner(metrics, `${g.ref}_max_attempts`, 'count', g.maxIntentos)
    poner(metrics, `${g.ref}_last_update_minutes`, 'count', g.ultimaActualizacion)
    const http = [...g.estados].sort((a, b) => a - b).map((c) => entidadHttp(entities, c)).filter((x): x is string => x !== null)
    const marcas: SenalIntegracion[] = [SENAL_DE_CLASE[g.clase]]
    if (g.muertos > 0) marcas.push('dead_messages')
    if (g.circuitoAbierto) marcas.push('open_circuit')
    if (g.reintentando > 0) marcas.push('retrying_backlog')
    for (const c of marcas) signals.push(senal(c, g.ref))
    if (g.muestra) muestras[g.ref] = g.muestra
    contextoGrupos.push({ ref: g.ref, provider: g.provider, operation: g.operation, error_class: g.clase, http, signals: marcas })
    items.push({
      ref: g.ref,
      id: g.id,
      label: g.label,
      severity: severidadMaxima(marcas.map((c) => SEVERIDAD_INTEGRACION[c])),
      signals: SENALES_INTEGRACION.filter((c) => marcas.includes(c)),
    })
    rows.push({
      ref: g.ref,
      group: 'errors',
      label: g.label,
      status: g.clase,
      metrics: [`${g.ref}_messages`, `${g.ref}_dead`, `${g.ref}_retrying`, `${g.ref}_max_attempts`].filter((k) => k in metrics),
      note: [http.map((h) => entities[h]!.label).join(', '), g.muestra].filter(Boolean).join(' · ').slice(0, 200) || null,
    })
  }

  // Disyuntores abiertos.
  const circuitos: Objeto[] = []
  lista(r.circuits, 10).forEach((c, k) => {
    const estado = enumDe(ESTADOS_CIRCUITO, c.state)
    const provider = etiquetaTecnica(c.provider_code, 40)
    const operation = etiquetaTecnica(c.operation, 60)
    if (!estado || estado === 'closed' || !provider || !operation) return
    const ref = `C${k + 1}`
    const label = `${nombreDestino(c.target_label) ?? provider} · ${operation}`
    entities[ref] = { kind: 'circuit', label }
    poner(metrics, `${ref}_consecutive_fail`, 'count', c.consecutive_fail)
    poner(metrics, `${ref}_threshold`, 'count', c.threshold)
    poner(metrics, `${ref}_minutes_open`, 'count', c.minutes_open)
    signals.push(senal('open_circuit', ref))
    circuitos.push({ ref, provider, operation, state: estado })
    rows.push({
      ref,
      group: 'circuits',
      label,
      status: estado,
      metrics: [`${ref}_consecutive_fail`, `${ref}_threshold`, `${ref}_minutes_open`].filter((x) => x in metrics),
      note: null,
    })
  })

  // Webhooks salientes con entregas fallidas o reproducciones.
  const webhooks: Objeto[] = []
  lista(r.webhooks, 10).forEach((w, k) => {
    const nombre = nombreDestino(w.endpoint_name)
    if (!nombre) return
    const ref = `W${k + 1}`
    entities[ref] = { kind: 'webhook_endpoint', label: nombre }
    for (const m of ['deliveries_7d', 'failed_7d', 'dead_7d', 'retrying', 'replays_7d', 'subscriptions'] as const) {
      poner(metrics, `${ref}_${m}`, 'count', w[m])
    }
    const status = codigoHttp(w.last_status_code)
    const http = entidadHttp(entities, status)
    const marcas: SenalIntegracion[] = []
    const fallidas = (entero(w.failed_7d) ?? 0) + (entero(w.retrying) ?? 0)
    if (fallidas > 0) {
      marcas.push('webhook_failures')
      if (status !== null && status >= 400) marcas.push(SENAL_DE_CLASE[clasificarError(status, null)])
    }
    if ((entero(w.replays_7d) ?? 0) >= UMBRALES_INTEGRACION.replays_min) marcas.push('repeated_replays')
    for (const c of marcas) signals.push(senal(c, ref))
    webhooks.push({ ref, active: booleano(w.is_active), http, signals: marcas })
    rows.push({
      ref,
      group: 'webhooks',
      label: nombre,
      status: booleano(w.is_active) ? 'active' : 'inactive',
      metrics: [`${ref}_deliveries_7d`, `${ref}_failed_7d`, `${ref}_replays_7d`].filter((x) => x in metrics),
      note: http ? entities[http]!.label : null,
    })
  })

  // Errores de la API de socio por ruta.
  const rutas: Objeto[] = []
  lista(api.top_errors, 8).forEach((e, k) => {
    const metodo = enumDe(METODOS, e.method)
    const ruta = rutaSegura(e.route)
    const status = codigoHttp(e.status)
    if (!metodo || !ruta || status === null) return
    const ref = `A${k + 1}`
    const label = `${metodo} ${ruta}`
    entities[ref] = { kind: 'api_route', label }
    poner(metrics, `${ref}_count`, 'count', e.count)
    const http = entidadHttp(entities, status)
    rutas.push({ ref, http, error_class: clasificarError(status, null) })
    rows.push({ ref, group: 'api', label, status: http ? entities[http]!.label : null, metrics: [`${ref}_count`].filter((x) => x in metrics), note: null })
  })

  return {
    contexto: { providers: proveedores, error_groups: contextoGrupos, circuits: circuitos, webhooks, api_routes: rutas },
    noConfiables: Object.keys(muestras).length > 0 ? { error_samples: muestras } : {},
  }
}

function mensaje(
  r: Objeto,
  metrics: Record<string, Metrica>,
  entities: Record<string, EntidadExplicable>,
  signals: SenalDetectada<SenalIntegracion>[],
  rows: FilaSistema[],
  s: Saneado,
): { contexto: Objeto; noConfiables: Objeto } | null {
  const m = objeto(r.message)
  if (!m || !uuid(m.outbox_id)) return null
  const estado = enumDe(ESTADOS_MENSAJE, m.status)
  const operation = etiquetaTecnica(m.operation, 60)
  const provider = etiquetaTecnica(m.provider_code, 40)
  if (!estado || !operation || !provider) return null
  const destino = nombreDestino(m.target_label) ?? nombreDestino(m.provider_name) ?? provider
  entities.M1 = { kind: 'message', label: `${destino} · ${operation}` }
  for (const k of ['attempts', 'max_attempts', 'age_minutes', 'minutes_since_update', 'next_retry_minutes', 'consecutive_fail', 'replays'] as const) {
    poner(metrics, `M1_${k}`, 'count', m[k])
  }

  const errores: Objeto = {}
  const intentos: Objeto[] = []
  let fallo: { status: number | null; error: string | null } | null = null
  lista(r.attempts, 10).forEach((a, k) => {
    const ref = `R${k + 1}`
    const status = codigoHttp(a.status_code)
    const http = entidadHttp(entities, status)
    const ok = booleano(a.succeeded)
    poner(metrics, `${ref}_latency_ms`, 'count', a.latency_ms)
    poner(metrics, `${ref}_minutes_ago`, 'count', a.minutes_ago)
    const error = textoSaneado(a.error, 200, s)
    if (error) errores[ref] = error
    // Los intentos llegan del más reciente al más viejo.
    if (!ok && fallo === null) fallo = { status, error }
    intentos.push({ ref, attempt: entero(a.attempt), succeeded: ok, http })
    rows.push({
      ref,
      group: 'attempts',
      label: `#${entero(a.attempt) ?? k + 1}`,
      status: ok ? 'succeeded' : 'failed',
      metrics: [`${ref}_minutes_ago`, `${ref}_latency_ms`].filter((x) => x in metrics),
      note: [http ? entities[http]!.label : null, error].filter(Boolean).join(' · ').slice(0, 200) || null,
    })
  })

  const ultimoError = textoSaneado(m.last_error, 400, s)
  const ultimoFallo = fallo as { status: number | null; error: string | null } | null
  const clase = estado === 'succeeded' ? null : clasificarError(ultimoFallo?.status ?? null, ultimoFallo?.error ?? ultimoError)
  const circuito = enumDe(ESTADOS_CIRCUITO, m.circuit_state)
  const marcas: SenalIntegracion[] = []
  if (clase && (estado === 'failed' || estado === 'dead' || (estado === 'pending' && (entero(m.attempts) ?? 0) > 0))) {
    marcas.push(SENAL_DE_CLASE[clase])
  }
  if (estado === 'dead') marcas.push('dead_messages')
  if (circuito === 'open' || circuito === 'half_open') marcas.push('open_circuit')
  if (estado === 'pending' && (entero(m.attempts) ?? 0) > 0) marcas.push('retrying_backlog')
  if ((entero(m.replays) ?? 0) >= UMBRALES_INTEGRACION.replays_min) marcas.push('repeated_replays')
  for (const c of marcas) signals.push(senal(c, 'M1'))

  const noConfiables: Objeto = {}
  if (ultimoError) noConfiables.last_error = ultimoError
  if (Object.keys(errores).length > 0) noConfiables.attempt_errors = errores
  const eventType = etiquetaTecnica(m.event_type, 60)
  return {
    contexto: {
      message: {
        ref: 'M1',
        provider,
        provider_kind: enumDe(TIPOS_PROVEEDOR, m.provider_kind),
        operation,
        status: estado,
        circuit_state: circuito,
        event_type: eventType,
        error_class: clase,
        http: ultimoFallo ? entidadHttp(entities, ultimoFallo.status) : null,
        signals: marcas,
      },
      attempts: intentos,
    },
    noConfiables,
  }
}

/** `null` si la forma no es la esperada. */
export function hechosDeIntegraciones(raw: unknown): HechosIntegraciones | null {
  const r = objeto(raw)
  if (!r || (r.scope !== 'company' && r.scope !== 'message')) return null
  const metrics: Record<string, Metrica> = {}
  const entities: Record<string, EntidadExplicable> = {}
  const signals: SenalDetectada<SenalIntegracion>[] = []
  const items: ElementoExplicable<SenalIntegracion>[] = []
  const rows: FilaSistema[] = []
  const s = nuevoSaneado()
  poner(metrics, 'queue_stalled_minutes', 'count', UMBRALES_INTEGRACION.queue_stalled_minutes)
  poner(metrics, 'replays_min', 'count', UMBRALES_INTEGRACION.replays_min)
  const generatedAt = typeof r.generated_at === 'string' ? r.generated_at : null

  if (r.scope === 'message') {
    const d = mensaje(r, metrics, entities, signals, rows, s)
    if (!d) return null
    return {
      scope: 'message',
      generatedAt,
      metrics,
      entities,
      signals: ordenarSenales(signals, SENALES_INTEGRACION),
      items: [],
      highlights: ['M1_attempts', 'M1_max_attempts', 'M1_minutes_since_update', 'M1_next_retry_minutes', 'M1_consecutive_fail', 'M1_age_minutes'].filter(
        (k) => k in metrics,
      ),
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
    signals: ordenarSenales(signals, SENALES_INTEGRACION),
    items,
    highlights: [
      'dead',
      'failed',
      'retrying',
      'pending',
      'oldest_pending_minutes',
      'failed_attempts_24h',
      'succeeded_24h',
      'inbox_unprocessed',
      'api_errors_4xx_24h',
      'api_errors_5xx_24h',
      'api_auth_errors_24h',
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
  'Significado de las senales (las decide una regla sobre el codigo HTTP y el texto del error): auth_failure = el destino rechazo la credencial o la firma; endpoint_not_found = la ruta o el recurso no existe en el destino; connectivity = no se pudo conectar (DNS, conexion rechazada, certificado); timeout = el destino no respondio a tiempo; rate_limited = el destino limita las peticiones; validation_error = el destino rechazo el contenido o su formato; remote_error = error interno del sistema destino; unknown_error = no se reconoce la clase; dead_messages = mensajes que agotaron reintentos (no saldran sin una persona); open_circuit = el disyuntor corto los envios a ese destino tras fallos seguidos; no_recent_success = el proveedor fallo en veinticuatro horas sin ningun exito; retrying_backlog = mensajes reintentando; queue_stalled / inbox_backlog = el pendiente mas viejo supera {{queue_stalled_minutes}} minutos; webhook_failures = entregas fallidas a un endpoint del cliente; repeated_replays = el mismo endpoint necesito {{replays_min}} o mas reproducciones manuales; api_errors / api_auth_errors = la API de socio devuelve errores (o de credencial) a un sistema externo. Los grupos (G1…) juntan mensajes con el mismo proveedor, operacion, clase y error parecido: explica que tienen en comun.'

export const SISTEMA_INTEGRACIONES = [
  'Eres el asistente tecnico de INTEGRACIONES del backoffice de una tienda eCommerce (ERP, facturacion, pasarelas, logistica, webhooks salientes y API de socio). Interpretas errores de API, webhook y ERP, explicas los grupos de errores parecidos, detectas patrones observables y sugieres verificaciones.',
  ...REGLAS_EXPLICACION,
  ...REGLAS_TECNICAS,
  SIGNIFICADO,
  'Nunca propongas cambiar ni desactivar una integracion por tu cuenta: sugiere que verificar (credencial, endpoint, formato del contenido, estado del sistema remoto) y deja la decision de reintentar, reproducir o cerrar el disyuntor a una persona.',
].join('\n')

export const ESQUEMA_INTEGRACIONES: EsquemaIA = esquemaExplicacion(SENALES_INTEGRACION, ACCIONES_INTEGRACION)
