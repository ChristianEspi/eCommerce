import { z } from 'zod'
import { AppError } from '@/domain/errors'
import type { CapabilityId } from '@/domain'
import { metricSchema, type MarkerContext } from '@/features/admin/dashboard/aiAnalyst'
import { AI_FEATURE_ROLES, type AiFeature } from '@/features/ai/features'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import { COPILOT_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import type { AppRole } from '@/shared/lib/roles'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

export { COPILOT_FUNCTION }

/**
 * EBIM Copilot en el CLIENTE (fase 11).
 *
 * El navegador no llama a ningún proveedor ni ejecuta ninguna herramienta:
 * manda la pregunta, la pantalla actual, la entidad abierta (tipo + id) y un
 * historial corto a la Edge Function `copilot`, que decide con el JWT qué
 * herramientas de solo lectura existen para esta persona. Aquí se valida OTRA
 * VEZ la respuesta con zod antes de pintarla, y las cifras salen de `metrics`
 * (valor de la base), nunca del texto del modelo.
 *
 * Las listas son espejo de `supabase/functions/_shared/aiCopilot.ts`
 * (`copilot-front.test.tsx` compara las copias).
 */

export const COPILOT_SCREENS = [
  'dashboard',
  'analytics',
  'products',
  'orders',
  'inventory',
  'planning',
  'customers',
  'sales',
  'quotes',
  'credit',
  'payments',
  'fulfillment',
  'promotions',
  'content',
  'reviews',
  'operations',
  'integrations',
  'settings',
  'other',
] as const
export type CopilotScreen = (typeof COPILOT_SCREENS)[number]

export const COPILOT_ENTITY_TYPES = ['order', 'product', 'customer'] as const
export type CopilotEntityType = (typeof COPILOT_ENTITY_TYPES)[number]

export const COPILOT_TOOL_IDS = [
  'dashboard_summary',
  'sales_summary',
  'search_orders',
  'order_detail',
  'orders_attention',
  'search_products',
  'product_detail',
  'inventory_summary',
  'customer_summary',
] as const
export type CopilotTool = (typeof COPILOT_TOOL_IDS)[number]

/** Funcionalidad de la que hereda roles cada herramienta (espejo del servidor). */
export const COPILOT_TOOL_FEATURE: Readonly<Record<CopilotTool, AiFeature>> = {
  dashboard_summary: 'insights',
  sales_summary: 'insights',
  search_orders: 'orders',
  order_detail: 'orders',
  orders_attention: 'orders',
  search_products: 'catalog.copy',
  product_detail: 'catalog.copy',
  inventory_summary: 'inventory',
  customer_summary: 'customers',
}

/** Módulo que la herramienta exige contratado (espejo de `AI_FEATURES.module`). */
export const COPILOT_TOOL_CAPABILITY: Readonly<Record<CopilotTool, CapabilityId>> = {
  dashboard_summary: 'analytics.basic',
  sales_summary: 'analytics.basic',
  search_orders: 'orders',
  order_detail: 'orders',
  orders_attention: 'orders',
  search_products: 'catalog',
  product_detail: 'catalog',
  inventory_summary: 'inventory.multiwarehouse',
  customer_summary: 'customers',
}

export const COPILOT_TOOL_STATUSES = [
  'ok',
  'empty',
  'denied',
  'not_entitled',
  'not_found',
  'invalid',
  'error',
] as const
export type CopilotToolStatus = (typeof COPILOT_TOOL_STATUSES)[number]

export const COPILOT_LINK_MODULES = [
  'dashboard',
  'analytics',
  'orders',
  'products',
  'inventory',
  'customers',
  'fulfillment',
  'credit',
] as const
export type CopilotLinkModule = (typeof COPILOT_LINK_MODULES)[number]

/** Rutas destino: la única lista de pantallas a las que el Copilot manda. */
export const COPILOT_LINK_ROUTES: Readonly<Record<CopilotLinkModule, string>> = {
  dashboard: '/app',
  analytics: '/app/analytics',
  orders: '/app/orders',
  products: '/app/products',
  inventory: '/app/inventory',
  customers: '/app/customers',
  fulfillment: '/app/fulfillment',
  credit: '/app/credit',
}

/** Capacidad que abre cada destino: sin ella no se ofrece el enlace. */
export const COPILOT_LINK_CAPABILITY: Readonly<Record<CopilotLinkModule, CapabilityId | null>> = {
  dashboard: null,
  analytics: 'analytics.basic',
  orders: 'orders',
  products: 'catalog',
  inventory: 'inventory.multiwarehouse',
  customers: 'customers',
  fulfillment: 'fulfillment',
  credit: 'credit.management',
}

export const COPILOT_ENTITY_KINDS = [
  'order',
  'customer',
  'product',
  'stock',
  'delivery',
  'movement',
  'line',
  'promotion',
  'task',
] as const

export const COPILOT_MAX_QUESTION = 300
/** Turnos que se conservan y se mandan como contexto (el servidor recorta igual). */
export const COPILOT_MAX_HISTORY = 6
export const COPILOT_MAX_TURN = 400

// ---------------------------------------------------------------------------
// Contexto de pantalla
// ---------------------------------------------------------------------------

const SCREEN_OF_SEGMENT: Readonly<Record<string, CopilotScreen>> = {
  analytics: 'analytics',
  products: 'products',
  categories: 'products',
  pim: 'products',
  pricing: 'products',
  channels: 'products',
  reviews: 'reviews',
  orders: 'orders',
  inventory: 'inventory',
  planning: 'planning',
  customers: 'customers',
  sales: 'sales',
  quotes: 'quotes',
  assortments: 'quotes',
  credit: 'credit',
  payments: 'payments',
  fulfillment: 'fulfillment',
  promotions: 'promotions',
  content: 'content',
  operations: 'operations',
  integrations: 'integrations',
  settings: 'settings',
  diagnostics: 'settings',
  stores: 'settings',
}

/** `/app/orders?x` → `orders`. Lo desconocido es `other` (solo orienta). */
export function screenFromPath(pathname: string): CopilotScreen {
  const partes = pathname.split(/[?#]/)[0]!.split('/').filter(Boolean)
  if (partes[0] !== 'app') return 'other'
  if (partes.length === 1) return 'dashboard'
  return SCREEN_OF_SEGMENT[partes[1] ?? ''] ?? 'other'
}

export interface CopilotEntity {
  readonly type: CopilotEntityType
  readonly id: string
}

// ---------------------------------------------------------------------------
// Sugerencias por pantalla (solo las que la persona puede usar)
// ---------------------------------------------------------------------------

export interface CopilotSuggestion {
  readonly id: string
  /** Basta con una de estas herramientas disponible. */
  readonly tools: readonly CopilotTool[]
  /** Solo con esta entidad abierta. */
  readonly entity?: CopilotEntityType
}

const S = {
  today: { id: 'today', tools: ['dashboard_summary'] },
  salesWeek: { id: 'sales_week', tools: ['sales_summary'] },
  salesMonth: { id: 'sales_month', tools: ['sales_summary'] },
  topProducts: { id: 'top_products', tools: ['sales_summary'] },
  attention: { id: 'orders_attention', tools: ['orders_attention'] },
  unpaid: { id: 'orders_unpaid', tools: ['search_orders'] },
  order: { id: 'order_summary', tools: ['order_detail'], entity: 'order' },
  draft: { id: 'products_draft', tools: ['search_products'] },
  product: { id: 'product_summary', tools: ['product_detail'], entity: 'product' },
  stock: { id: 'inventory_risk', tools: ['inventory_summary'] },
  customer: { id: 'customer_summary', tools: ['customer_summary'], entity: 'customer' },
  help: { id: 'help', tools: [] },
} as const satisfies Record<string, CopilotSuggestion>

const SUGGESTIONS_BY_SCREEN: Partial<Record<CopilotScreen, readonly CopilotSuggestion[]>> = {
  dashboard: [S.today, S.salesWeek, S.attention, S.stock],
  analytics: [S.salesMonth, S.salesWeek, S.topProducts],
  orders: [S.order, S.attention, S.unpaid],
  products: [S.product, S.draft, S.topProducts],
  reviews: [S.product, S.draft],
  inventory: [S.stock, S.topProducts],
  planning: [S.stock, S.salesMonth],
  customers: [S.customer, S.attention],
  sales: [S.customer, S.salesMonth],
  quotes: [S.customer, S.attention],
  credit: [S.customer, S.today],
  fulfillment: [S.attention, S.unpaid],
  payments: [S.unpaid, S.attention],
}

const DEFAULT_SUGGESTIONS: readonly CopilotSuggestion[] = [S.today, S.attention, S.salesWeek]

export interface ToolAccess {
  readonly role: AppRole | null | undefined
  readonly has: (capability: CapabilityId) => boolean
}

/**
 * ¿Puede ESTA persona usar la herramienta? Solo UX (qué sugerir): la
 * autoridad es `ai_copilot_tools()` + el guard SQL de cada herramienta.
 */
export function toolAvailable(tool: CopilotTool, access: ToolAccess): boolean {
  const role = access.role
  if (!role) return false
  const roles = AI_FEATURE_ROLES[COPILOT_TOOL_FEATURE[tool]] as readonly string[]
  return roles.includes(role) && access.has(COPILOT_TOOL_CAPABILITY[tool])
}

export function suggestionsFor(
  screen: CopilotScreen,
  entity: CopilotEntity | null,
  access: ToolAccess,
): CopilotSuggestion[] {
  const base = SUGGESTIONS_BY_SCREEN[screen] ?? DEFAULT_SUGGESTIONS
  const candidatas: readonly CopilotSuggestion[] = [...base, ...DEFAULT_SUGGESTIONS, S.help]
  const vistas = new Set<string>()
  const salida: CopilotSuggestion[] = []
  for (const s of candidatas) {
    if (vistas.has(s.id)) continue
    if (s.entity && entity?.type !== s.entity) continue
    if (s.tools.length > 0 && !s.tools.some((t) => toolAvailable(t, access))) continue
    vistas.add(s.id)
    salida.push(s)
    if (salida.length >= 4) break
  }
  return salida
}

// ---------------------------------------------------------------------------
// Respuesta
// ---------------------------------------------------------------------------

const entitySchema = z.object({
  kind: z.enum(COPILOT_ENTITY_KINDS),
  label: z.string().min(1).max(200),
  module: z.enum(COPILOT_LINK_MODULES).nullable(),
  order_id: z.string().uuid().nullable(),
})
export type CopilotEntityFact = z.infer<typeof entitySchema>

const linkSchema = z.object({
  ref: z.string().max(60),
  kind: z.enum(COPILOT_ENTITY_KINDS),
  label: z.string().min(1).max(200),
  module: z.enum(COPILOT_LINK_MODULES),
  order_id: z.string().uuid().nullable(),
})
export type CopilotLink = z.infer<typeof linkSchema>

export const copilotAnswerSchema = z.object({
  kind: z.enum(['answer', 'direct', 'no_data']),
  answerable: z.boolean(),
  answer: z.string().max(1200),
  highlights: z.array(z.string().max(300)).max(4),
  links: z.array(linkSchema).max(4),
  follow_ups: z.array(z.string().max(160)).max(3),
  tools: z
    .array(z.object({ tool: z.enum(COPILOT_TOOL_IDS), status: z.enum(COPILOT_TOOL_STATUSES) }))
    .max(3),
  discarded: z.number().int().min(0),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(60), entitySchema),
})
export type CopilotAnswer = z.infer<typeof copilotAnswerSchema>

/** Lo que el pintor de marcadores necesita (mismo que el analista y pedidos). */
export function markerContextOf(answer: CopilotAnswer): MarkerContext {
  return { metrics: answer.metrics, entities: answer.entities }
}

/** Destino de un enlace. Un pedido se abre por id (la RLS decide si se ve). */
export function linkTarget(link: CopilotLink): string {
  const base = COPILOT_LINK_ROUTES[link.module]
  if (link.module === 'orders' && link.order_id) return `${base}?order=${encodeURIComponent(link.order_id)}`
  return base
}

export interface CopilotTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** El historial que viaja: los últimos turnos, recortados. */
export function historyForRequest(turns: readonly CopilotTurn[]): CopilotTurn[] {
  return turns
    .filter((t) => t.text.trim().length > 0)
    .slice(-COPILOT_MAX_HISTORY)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, COPILOT_MAX_TURN) }))
}

export interface CopilotRequest {
  readonly question: string
  readonly locale: Locale
  readonly storeId: string | null
  readonly screen: CopilotScreen
  readonly entity: CopilotEntity | null
  readonly history: readonly CopilotTurn[]
}

export async function askCopilot(input: CopilotRequest): Promise<AiResult<CopilotAnswer>> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AppError({ boundary: 'ai', code: 'CONFIG_INCOMPLETA' })
  const body = {
    question: input.question.trim().slice(0, COPILOT_MAX_QUESTION),
    locale: input.locale,
    store_id: input.storeId,
    context: { screen: input.screen, ...(input.entity ? { entity: { type: input.entity.type, id: input.entity.id } } : {}) },
    history: historyForRequest(input.history),
  }
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(COPILOT_FUNCTION, { body })
  if (error) throw new AppError({ boundary: 'ai', code: await codeFromInvokeError(error) })
  return parseAiResult(copilotAnswerSchema, data?.data)
}
