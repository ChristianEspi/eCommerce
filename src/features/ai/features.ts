import type { AppRole } from '@/shared/lib/roles'
import { agotado, type AiEntitlement } from './types'

/**
 * Las funcionalidades de IA, vistas desde el CLIENTE.
 *
 * Espejo de `AI_FEATURES` (`supabase/functions/_shared/aiCore.ts`) y de
 * `ebim.ai_features()` / `ebim.ai_feature_roles()`. El test
 * `ai-core-front.test.ts` compara las tres copias. Aquí solo sirve para
 * decidir QUÉ ENSEÑAR (botón activo, aviso de contratar, sin permiso): quien
 * autoriza de verdad es `ebim.ai_consume`, en el servidor.
 */
export const AI_FEATURE_ROLES = {
  assistant: ['owner', 'admin'],
  'catalog.copy': ['owner', 'admin', 'catalog'],
  insights: ['owner', 'admin'],
  orders: ['owner', 'admin', 'orders', 'viewer'],
  inventory: ['owner', 'admin', 'catalog', 'orders', 'viewer'],
  planning: ['owner', 'admin', 'catalog', 'orders'],
  customers: ['owner', 'admin', 'orders', 'viewer', 'sales_rep'],
  sales: ['owner', 'admin', 'sales_rep'],
  quotes: ['owner', 'admin', 'orders', 'sales_rep'],
  credit: ['owner', 'admin'],
  payments: ['owner', 'admin', 'orders'],
  fulfillment: ['owner', 'admin', 'orders'],
  operations: ['owner', 'admin'],
  integrations: ['owner', 'admin'],
  content: ['owner', 'admin'],
  promotions: ['owner', 'admin'],
  reviews: ['owner', 'admin', 'catalog'],
  copilot: ['owner', 'admin', 'catalog', 'orders', 'viewer', 'sales_rep'],
} as const satisfies Record<string, readonly AppRole[]>

export type AiFeature = keyof typeof AI_FEATURE_ROLES

export const AI_FEATURE_IDS = Object.keys(AI_FEATURE_ROLES) as AiFeature[]

/**
 * Qué se puede enseñar para una funcionalidad.
 *
 * `loading` mientras no se sabe. Un saldo ilegible ya llega como `disabled`
 * (`fetchAiEntitlement`): equivocarse hacia lo permisivo cuesta dinero.
 */
export type AiFeatureAvailability =
  | 'loading'
  | 'available'
  | 'not_entitled'
  | 'quota_exhausted'
  | 'forbidden'

export function aiFeatureAvailability(
  entitlement: AiEntitlement | undefined,
  feature: AiFeature,
  role: AppRole | null | undefined,
): AiFeatureAvailability {
  if (!entitlement) return 'loading'
  if (!role || !(AI_FEATURE_ROLES[feature] as readonly string[]).includes(role)) return 'forbidden'
  // `features` ausente = respuesta anterior a la fase 01: no se asume abierta.
  if (!entitlement.enabled || entitlement.features?.[feature] !== true) return 'not_entitled'
  if (agotado(entitlement)) return 'quota_exhausted'
  return 'available'
}
