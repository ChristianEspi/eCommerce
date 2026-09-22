import { CREDIT_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { explainClient } from '@/features/ai/explain/explainAi'

export { CREDIT_ASSISTANT_FUNCTION }

/**
 * IA de crédito y cobranza en el CLIENTE (fase 08).
 *
 * Listas cerradas — espejo de `supabase/functions/_shared/aiCredit.ts`
 * (`CreditPaymentsFulfillmentAi.test.tsx` compara las dos copias). Una señal,
 * acción o pestaña fuera de estas listas invalida la respuesta (`esquema`).
 *
 * Ninguna acción escribe: preparar un recordatorio, contactar, revisar
 * documentos o condiciones, aplicar cobros (con el cajón de cobro de siempre).
 * Cambiar el límite, bloquear o desbloquear sigue siendo una decisión humana en
 * la ficha de la cuenta.
 */
export const CREDIT_AI_SIGNALS = [
  'credit_blocked',
  'over_limit',
  'debt_over_90',
  'overdue_debt',
  'no_recent_receipt',
  'credit_watch',
  'unapplied_receipts',
  'due_soon',
  'multi_currency',
  'inactive_customer',
] as const

export const CREDIT_AI_ACTIONS = [
  'prepare_reminder',
  'contact_customer',
  'review_documents',
  'apply_receipts',
  'review_credit_terms',
  'monitor',
] as const

export const CREDIT_AI_TABS = ['cobranza'] as const

export const creditAi = explainClient(CREDIT_ASSISTANT_FUNCTION, {
  signals: CREDIT_AI_SIGNALS,
  actions: CREDIT_AI_ACTIONS,
  tabs: CREDIT_AI_TABS,
})

/** Preguntas sugeridas. `summary` = explicar sin pregunta. */
export const CREDIT_PORTFOLIO_QUESTIONS = ['summary', 'priorities', 'over90', 'unapplied'] as const
export const CREDIT_CUSTOMER_QUESTIONS = ['summary', 'why', 'next'] as const
