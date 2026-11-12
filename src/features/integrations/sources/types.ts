import { z } from 'zod'

/**
 * Fuentes de lectura: eCommerce consulta la API del ERP (2026-11-12).
 *
 * Copias de los CHECK de `connector_sources`/`connector_feeds`: la base es la
 * autoridad y estas listas solo pintan el formulario. Un test las compara.
 */
export {
  CONNECTOR_FEEDS_TABLE,
  CONNECTOR_REJECTS_TABLE,
  CONNECTOR_RUNS_TABLE,
  CONNECTOR_RUN_NOW_RPC,
  CONNECTOR_SET_SECRET_RPC,
  CONNECTOR_SOURCES_TABLE,
} from '@/shared/lib/db-schema'

export const AUTH_TYPES = ['none', 'api_key', 'bearer', 'basic', 'oauth2'] as const
export type AuthType = (typeof AUTH_TYPES)[number]

export const FEED_RESOURCES = ['stock', 'prices'] as const
export type FeedResource = (typeof FEED_RESOURCES)[number]

/** Intervalos que ofrece la pantalla (la base admite 5..1440). */
export const FEED_INTERVALS = [15, 30, 60, 180, 360, 720, 1440] as const

export const RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const sourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().default(null),
  base_url: z.string(),
  auth_type: z.enum(AUTH_TYPES),
  auth_header: z.string().nullable().default(null),
  auth_username: z.string().nullable().default(null),
  oauth_token_url: z.string().nullable().default(null),
  oauth_scope: z.string().nullable().default(null),
  timeout_seconds: z.number(),
  is_active: z.boolean(),
  has_secret: z.boolean(),
  secret_set_at: z.string().nullable().default(null),
  created_at: z.string(),
})
export type ConnectorSource = z.infer<typeof sourceSchema>

export const feedSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  resource: z.enum(FEED_RESOURCES),
  path: z.string(),
  interval_minutes: z.number(),
  page_size: z.number(),
  price_list_id: z.string().uuid().nullable().default(null),
  default_warehouse_id: z.string().uuid().nullable().default(null),
  is_active: z.boolean(),
  watermark: z.string().nullable().default(null),
  next_run_at: z.string(),
  run_requested: z.boolean(),
  lease_until: z.string().nullable().default(null),
  consecutive_failures: z.number(),
  last_run_at: z.string().nullable().default(null),
  last_status: z.enum(['succeeded', 'partial', 'failed']).nullable().default(null),
  last_error_code: z.string().nullable().default(null),
})
export type ConnectorFeed = z.infer<typeof feedSchema>

export const runSchema = z.object({
  id: z.string().uuid(),
  feed_id: z.string().uuid(),
  trigger: z.enum(['schedule', 'manual']),
  status: z.enum(RUN_STATUSES),
  started_at: z.string(),
  finished_at: z.string().nullable().default(null),
  pages: z.number(),
  received: z.number(),
  applied: z.number(),
  unchanged: z.number(),
  rejected: z.number(),
  error_code: z.string().nullable().default(null),
  error_message: z.string().nullable().default(null),
})
export type ConnectorRun = z.infer<typeof runSchema>

export const rejectSchema = z.object({
  id: z.string().uuid(),
  row_index: z.number(),
  sku: z.string().nullable().default(null),
  reason: z.string(),
  detail: z.string().nullable().default(null),
})
export type ConnectorReject = z.infer<typeof rejectSchema>

export interface SourceDraft {
  name: string
  description: string
  baseUrl: string
  authType: AuthType
  authHeader: string
  authUsername: string
  oauthTokenUrl: string
  oauthScope: string
  timeoutSeconds: number
  isActive: boolean
  /** Vacío = no se toca la credencial guardada. */
  secret: string
}

export interface FeedDraft {
  sourceId: string
  resource: FeedResource
  path: string
  intervalMinutes: number
  pageSize: number
  priceListId: string | null
  defaultWarehouseId: string | null
  isActive: boolean
}

/** Misma regla que el CHECK de la base, para avisar antes de guardar. */
export function isPublicHttpsUrl(value: string): boolean {
  const url = value.trim()
  return (
    /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(\/[^\s?#]*)?$/.test(url) &&
    !/^https:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)/i.test(url) &&
    !/^https:\/\/[A-Za-z0-9.-]*\.(local|internal|localdomain)([:/]|$)/i.test(url)
  )
}
