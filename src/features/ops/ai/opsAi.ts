import { OPERATIONS_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { explainClient } from '@/features/ai/explain/explainAi'

export { OPERATIONS_ASSISTANT_FUNCTION }

/**
 * Asistente técnico de OPERACIONES en el cliente (fase 10). Listas cerradas —
 * espejo de `supabase/functions/_shared/aiOperations.ts` (un test compara las
 * dos copias).
 *
 * Ninguna acción escribe: revisar el incidente, rastrear su hilo, mirar la
 * salud, revisar integraciones, verificar configuración, vigilar. Resolver un
 * incidente sigue siendo el botón «Atender» (`ops_resolve_event`, con motivo).
 * El servidor sanea todo texto antes de mandarlo al modelo.
 */
export const OPS_AI_SIGNALS = [
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

export const OPS_AI_ACTIONS = [
  'review_incident',
  'trace_incident',
  'check_health',
  'review_integrations',
  'verify_configuration',
  'monitor',
] as const

/** Pestañas de `OperationsPage` a las que una acción puede llevar. */
export const OPS_AI_TABS = ['incidentes', 'rastro', 'salud'] as const

export const opsAi = explainClient(OPERATIONS_ASSISTANT_FUNCTION, {
  signals: OPS_AI_SIGNALS,
  actions: OPS_AI_ACTIONS,
  tabs: OPS_AI_TABS,
})

export const OPS_COMPANY_QUESTIONS = ['summary', 'relevant', 'groups', 'checks'] as const
export const OPS_INCIDENT_QUESTIONS = ['summary', 'why', 'trace', 'checks'] as const
