import { INTEGRATIONS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { explainClient } from '@/features/ai/explain/explainAi'

export { INTEGRATIONS_ASSISTANT_FUNCTION }

/**
 * Asistente técnico de INTEGRACIONES en el cliente (fase 10). Listas cerradas —
 * espejo de `supabase/functions/_shared/aiIntegrations.ts` (un test compara las
 * dos copias).
 *
 * Ninguna acción escribe: revisar el mensaje, verificar credenciales o el
 * endpoint, consultar al sistema remoto, revisar el formato del contenido, la
 * salud o los clientes de la API, vigilar. Reintentar, reproducir y cerrar un
 * disyuntor siguen siendo los botones de la cola y de webhooks, con motivo.
 */
export const INTEGRATION_AI_SIGNALS = [
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

export const INTEGRATION_AI_ACTIONS = [
  'review_message',
  'check_credentials',
  'check_endpoint',
  'check_remote_system',
  'review_payload_mapping',
  'review_health',
  'review_api_clients',
  'monitor',
] as const

/** Pestañas de `IntegrationsPage` a las que una acción puede llevar. */
export const INTEGRATION_AI_TABS = ['cola', 'webhooks', 'salud', 'api'] as const

export const integrationsAi = explainClient(INTEGRATIONS_ASSISTANT_FUNCTION, {
  signals: INTEGRATION_AI_SIGNALS,
  actions: INTEGRATION_AI_ACTIONS,
  tabs: INTEGRATION_AI_TABS,
})

export const INTEGRATION_COMPANY_QUESTIONS = ['summary', 'errors', 'patterns', 'checks'] as const
export const INTEGRATION_MESSAGE_QUESTIONS = ['summary', 'why', 'code', 'checks'] as const

/** Clases de error (regla del sistema) que llegan como `status` de un grupo. */
export const INTEGRATION_ERROR_CLASSES = [
  'auth',
  'not_found',
  'connectivity',
  'timeout',
  'rate_limit',
  'validation',
  'remote_error',
  'unknown',
] as const
