import { FULFILLMENT_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { explainClient } from '@/features/ai/explain/explainAi'

export { FULFILLMENT_ASSISTANT_FUNCTION }

/**
 * IA de entregas en el CLIENTE (fase 08): explica atrasos, parciales,
 * incidencias y falta de avance; prepara BORRADORES para el cliente. Listas
 * cerradas — espejo de `supabase/functions/_shared/aiFulfillment.ts`.
 *
 * Ninguna acción escribe: revisar la entrega, contactar al operador,
 * replanificar (en la pestaña de reparto), revisar la prueba de entrega o la
 * devolución. Despachar, cancelar o cambiar un estado siguen siendo los
 * controles del cajón de la entrega, con su validación en la base.
 */
export const FULFILLMENT_AI_SIGNALS = [
  'failed',
  'delivery_failed',
  'carrier_incident',
  'late',
  'shipment_error',
  'long_transit',
  'stalled',
  'partial',
  'returns_undecided',
  'returns_open',
] as const

export const FULFILLMENT_AI_ACTIONS = [
  'review_fulfillment',
  'contact_carrier',
  'prepare_customer_message',
  'replan_delivery',
  'review_pod',
  'review_return',
  'monitor',
] as const

export const FULFILLMENT_AI_TABS = ['entregas', 'reparto', 'devoluciones'] as const

export const fulfillmentAi = explainClient(FULFILLMENT_ASSISTANT_FUNCTION, {
  signals: FULFILLMENT_AI_SIGNALS,
  actions: FULFILLMENT_AI_ACTIONS,
  tabs: FULFILLMENT_AI_TABS,
})

export const FULFILLMENT_STORE_QUESTIONS = ['summary', 'late', 'stalled', 'incidents'] as const
export const FULFILLMENT_ITEM_QUESTIONS = ['summary', 'why', 'next'] as const
