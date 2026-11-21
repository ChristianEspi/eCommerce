import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { IntegrationsError, integrationsErrorFromDb } from './errors'
import {
  API_CLIENTS_TABLE,
  API_CLIENT_CREATE_RPC,
  API_CLIENT_ROTATE_SECRET_RPC,
  INTEGRATION_CIRCUIT_RESET_RPC,
  INTEGRATION_HEALTH_RPC,
  INTEGRATION_MESSAGE_DETAIL_RPC,
  INTEGRATION_MONITOR_VIEW,
  INTEGRATION_RETRY_RPC,
  WEBHOOK_ENDPOINTS_TABLE,
  WEBHOOK_MONITOR_VIEW,
  WEBHOOK_REPLAY_RPC,
  WEBHOOK_SUBSCRIPTIONS_TABLE,
  apiClientSchema,
  integrationHealthSchema,
  messageDetailSchema,
  newCredentialSchema,
  queueMessageSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  webhookSubscriptionSchema,
  type ApiClientRow,
  type IntegrationHealth,
  type MessageDetail,
  type NewCredential,
  type QueueMessage,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookSubscription,
} from './types'

/**
 * Acceso a datos del Monitor de Integraciones.
 *
 * Cuatro reglas, y las cuatro son consecuencia de cómo está construido el
 * dominio, no preferencias de este archivo:
 *
 *  1. **Ninguna consulta declara el tenant.** `integration_health` ni siquiera
 *     lo ACEPTA: lo deriva del JWT. El resto va por RLS sobre vistas
 *     `security_invoker`, que no amplían ni un permiso.
 *  2. **Ningún `update` sobre la cola.** `integration_outbox` no tiene GRANT de
 *     escritura para `authenticated`, y no lo tendrá: una cola que el cliente
 *     puede reescribir no garantiza nada. Reintentar y reproducir son `rpc`
 *     porque son tres cosas que pasan juntas —autorizar, mover el estado y
 *     firmar quién lo hizo— y un `update` deja elegir cuál se omite.
 *  3. **El secreto de una credencial se pide UNA vez y no se guarda.**
 *     `api_client_create` lo devuelve; la tabla guarda su sha256 y no puede
 *     devolverlo aunque alguien lo pida. Aquí ni se cachea ni se mete en el
 *     árbol de consultas.
 *  4. **El detalle de un mensaje llega ya redactado.** No se filtra nada en el
 *     navegador: un filtro de pantalla se salta abriendo la pestaña de red.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new IntegrationsError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

// --- Salud ------------------------------------------------------------------

export async function fetchIntegrationHealth(): Promise<IntegrationHealth> {
  const { data, error } = await client().rpc(INTEGRATION_HEALTH_RPC, {})
  if (error) throw integrationsErrorFromDb(error)
  return integrationHealthSchema.parse(data)
}

// --- La cola ----------------------------------------------------------------

const QUEUE_SELECT =
  'id, provider_code, provider_name, provider_kind, operation, target, target_label, ' +
  'status, attempts, max_attempts, next_retry_at, completed_at, correlation_id, ' +
  'created_at, last_error, circuit_state, age_seconds, is_open, is_dead, is_retrying'

/** Pestañas de estado, no un panel de filtros multi-campo (regla de suite §8). */
export type QueueFilter = { status: 'open' | 'dead' | 'succeeded' | ''; term: string }

export async function fetchQueue(filter: QueueFilter): Promise<QueueMessage[]> {
  let query = client()
    .from(INTEGRATION_MONITOR_VIEW)
    .select(QUEUE_SELECT)
    .order('created_at', { ascending: false })
    .limit(200)

  if (filter.status === 'open') query = query.eq('is_open', true)
  if (filter.status === 'dead') query = query.eq('is_dead', true)
  if (filter.status === 'succeeded') query = query.eq('status', 'succeeded')

  const term = filter.term.trim()
  if (term !== '') {
    // Un solo buscador general: proveedor, operación, destino o el HILO — que
    // es el caso que de verdad importa cuando alguien llama por un incidente.
    const safe = term.replace(/[%,()]/g, ' ')
    query = query.or(
      `provider_code.ilike.%${safe}%,operation.ilike.%${safe}%,` +
        `target_label.ilike.%${safe}%,correlation_id.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => queueMessageSchema.parse(row))
}

export async function fetchMessageDetail(outboxId: string): Promise<MessageDetail> {
  const { data, error } = await client().rpc(INTEGRATION_MESSAGE_DETAIL_RPC, {
    p_outbox_id: outboxId,
  })
  if (error) throw integrationsErrorFromDb(error)
  return messageDetailSchema.parse(data)
}

export async function retryMessage(outboxId: string, reason: string): Promise<void> {
  const { error } = await client().rpc(INTEGRATION_RETRY_RPC, {
    p_outbox_id: outboxId,
    p_reason: reason,
  })
  if (error) throw integrationsErrorFromDb(error)
}

export async function resetCircuit(circuitId: string, reason: string): Promise<void> {
  const { error } = await client().rpc(INTEGRATION_CIRCUIT_RESET_RPC, {
    p_circuit_id: circuitId,
    p_reason: reason,
  })
  if (error) throw integrationsErrorFromDb(error)
}

// --- Webhooks ---------------------------------------------------------------

const ENDPOINT_SELECT =
  'id, name, url, secret_ref, api_version, description, is_active, max_attempts, created_at'

export async function fetchEndpoints(): Promise<WebhookEndpoint[]> {
  const { data, error } = await client()
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .select(ENDPOINT_SELECT)
    .order('name')
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => webhookEndpointSchema.parse(row))
}

export interface EndpointDraft {
  name: string
  url: string
  secretRef: string
  description: string
  eventTypes: string[]
}

/**
 * Alta de endpoint con sus suscripciones.
 *
 * NO viaja ni un identificador de tenant en el payload: lo pone la RLS al
 * escribir (`with check` sobre `has_role` y la capacidad) y lo deriva la base.
 * Un test comprueba exactamente eso sobre el cuerpo enviado.
 */
export async function createEndpoint(draft: EndpointDraft): Promise<WebhookEndpoint> {
  const { data, error } = await client()
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .insert({
      name: draft.name.trim().toLowerCase(),
      url: draft.url.trim(),
      secret_ref: draft.secretRef.trim().toUpperCase(),
      description: draft.description.trim() === '' ? null : draft.description.trim(),
    })
    .select(ENDPOINT_SELECT)
    .single()
  if (error) throw integrationsErrorFromDb(error)

  const endpoint = webhookEndpointSchema.parse(data)

  if (draft.eventTypes.length > 0) {
    const { error: subError } = await client()
      .from(WEBHOOK_SUBSCRIPTIONS_TABLE)
      .insert(
        draft.eventTypes.map((eventType) => ({
          endpoint_id: endpoint.id,
          event_type: eventType,
        })),
      )
    if (subError) throw integrationsErrorFromDb(subError)
  }

  return endpoint
}

/**
 * Edición de un destino (2026-11-20): datos y eventos.
 *
 * Los eventos se aplican por DIFERENCIA con los que tenía: se suscriben los
 * nuevos y se dan de baja los quitados, sin tocar los que siguen. Primero las
 * altas: si la baja fallara, el destino recibe de más y no se pierde nada. Como
 * en el alta, no viaja ningún identificador de tenant: lo decide la RLS.
 */
export async function updateEndpoint(
  id: string,
  draft: EndpointDraft,
  previousEvents: readonly string[],
): Promise<void> {
  const { error } = await client()
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .update({
      name: draft.name.trim().toLowerCase(),
      url: draft.url.trim(),
      secret_ref: draft.secretRef.trim().toUpperCase(),
      description: draft.description.trim() === '' ? null : draft.description.trim(),
    })
    .eq('id', id)
  if (error) throw integrationsErrorFromDb(error)

  const added = draft.eventTypes.filter((eventType) => !previousEvents.includes(eventType))
  const removed = previousEvents.filter((eventType) => !draft.eventTypes.includes(eventType))

  if (added.length > 0) {
    const { error: addError } = await client()
      .from(WEBHOOK_SUBSCRIPTIONS_TABLE)
      .insert(added.map((eventType) => ({ endpoint_id: id, event_type: eventType })))
    if (addError) throw integrationsErrorFromDb(addError)
  }
  if (removed.length > 0) {
    const { error: removeError } = await client()
      .from(WEBHOOK_SUBSCRIPTIONS_TABLE)
      .delete()
      .eq('endpoint_id', id)
      .in('event_type', removed)
    if (removeError) throw integrationsErrorFromDb(removeError)
  }
}

export async function setEndpointActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await client()
    .from(WEBHOOK_ENDPOINTS_TABLE)
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw integrationsErrorFromDb(error)
}

export async function fetchSubscriptions(): Promise<WebhookSubscription[]> {
  const { data, error } = await client()
    .from(WEBHOOK_SUBSCRIPTIONS_TABLE)
    .select('id, endpoint_id, event_type, is_active')
    .order('event_type')
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => webhookSubscriptionSchema.parse(row))
}

const DELIVERY_SELECT =
  'id, endpoint_id, endpoint_name, event_id, event_type, outbox_id, is_replay, ' +
  'replay_reason, correlation_id, created_at, status, attempts, last_status_code, ' +
  'last_error, age_seconds'

export async function fetchDeliveries(term: string): Promise<WebhookDelivery[]> {
  let query = client()
    .from(WEBHOOK_MONITOR_VIEW)
    .select(DELIVERY_SELECT)
    .order('created_at', { ascending: false })
    .limit(200)

  const clean = term.trim()
  if (clean !== '') {
    const safe = clean.replace(/[%,()]/g, ' ')
    query = query.or(
      `endpoint_name.ilike.%${safe}%,event_type.ilike.%${safe}%,correlation_id.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => webhookDeliverySchema.parse(row))
}

export async function replayDelivery(deliveryId: string, reason: string): Promise<void> {
  const { error } = await client().rpc(WEBHOOK_REPLAY_RPC, {
    p_delivery_id: deliveryId,
    p_reason: reason,
  })
  if (error) throw integrationsErrorFromDb(error)
}

// --- Credenciales de la API -------------------------------------------------

const CLIENT_SELECT =
  'id, name, description, client_id, secret_hint, scopes, is_active, ' +
  'rate_limit_per_minute, expires_at, last_used_at, created_at'

export async function fetchApiClients(): Promise<ApiClientRow[]> {
  const { data, error } = await client()
    .from(API_CLIENTS_TABLE)
    .select(CLIENT_SELECT)
    .order('created_at', { ascending: false })
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => apiClientSchema.parse(row))
}

export async function createApiClient(input: {
  name: string
  scopes: string[]
  description?: string
}): Promise<NewCredential> {
  const { data, error } = await client().rpc(API_CLIENT_CREATE_RPC, {
    p_name: input.name.trim(),
    p_scopes: input.scopes,
    p_description: input.description?.trim() === '' ? null : (input.description ?? null),
  })
  if (error) throw integrationsErrorFromDb(error)
  return newCredentialSchema.parse(data)
}

export async function rotateApiClientSecret(id: string): Promise<NewCredential> {
  const { data, error } = await client().rpc(API_CLIENT_ROTATE_SECRET_RPC, { p_client_ref: id })
  if (error) throw integrationsErrorFromDb(error)
  return newCredentialSchema.parse(data)
}

export async function setApiClientActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await client()
    .from(API_CLIENTS_TABLE)
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw integrationsErrorFromDb(error)
}
