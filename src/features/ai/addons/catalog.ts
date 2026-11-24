import type { AiFeature } from '../features'

/**
 * Cómo se agrupan las IA en «Complementos IA» (2026-11-23).
 *
 * Solo presentación: qué IA existe, quién la usa y si está encendida lo dicen
 * `AI_FEATURE_ROLES` y el saldo del servidor (`states`). El test comprueba que
 * no falta ni sobra ninguna IA respecto de `AI_FEATURE_IDS`.
 */
export const AI_ADDON_GROUPS = [
  { id: 'store', features: ['assistant', 'intake'] },
  { id: 'catalog', features: ['catalog.copy', 'content', 'promotions', 'reviews'] },
  { id: 'operations', features: ['orders', 'inventory', 'planning', 'fulfillment', 'payments'] },
  { id: 'customers', features: ['customers', 'sales', 'quotes', 'credit'] },
  { id: 'analysis', features: ['insights', 'copilot', 'operations', 'integrations'] },
] as const satisfies ReadonlyArray<{ id: string; features: readonly AiFeature[] }>

export type AiAddonGroup = (typeof AI_ADDON_GROUPS)[number]['id']

export type AiAddonState = 'on' | 'off' | 'no_ai' | 'no_module'
