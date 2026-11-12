import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { IntegrationsError, integrationsErrorFromDb } from '../errors'
import {
  CONNECTOR_FEEDS_TABLE,
  CONNECTOR_REJECTS_TABLE,
  CONNECTOR_RUNS_TABLE,
  CONNECTOR_RUN_NOW_RPC,
  CONNECTOR_SET_SECRET_RPC,
  CONNECTOR_SOURCES_TABLE,
  feedSchema,
  rejectSchema,
  runSchema,
  sourceSchema,
  type ConnectorFeed,
  type ConnectorReject,
  type ConnectorRun,
  type ConnectorSource,
  type FeedDraft,
  type SourceDraft,
} from './types'

/**
 * Acceso a datos de las fuentes de lectura.
 *
 *  · Ningún identificador de tenant viaja: la base lo toma del JWT
 *    (`ebim.fill_tenant_from_jwt`) y la RLS lo comprueba.
 *  · La credencial se manda UNA vez por `connector_source_set_secret` y no se
 *    vuelve a leer: la tabla solo dice si hay una (`has_secret`).
 *  · El estado del trabajador (marca de agua, concesión, fallos) es de solo
 *    lectura aquí; la base ni siquiera da GRANT para escribirlo.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new IntegrationsError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

const SOURCE_SELECT =
  'id, name, description, base_url, auth_type, auth_header, auth_username, oauth_token_url, ' +
  'oauth_scope, timeout_seconds, is_active, has_secret, secret_set_at, created_at'

const FEED_SELECT =
  'id, source_id, resource, path, interval_minutes, page_size, price_list_id, ' +
  'default_warehouse_id, is_active, watermark, next_run_at, run_requested, lease_until, ' +
  'consecutive_failures, last_run_at, last_status, last_error_code'

const RUN_SELECT =
  'id, feed_id, trigger, status, started_at, finished_at, pages, received, applied, ' +
  'unchanged, rejected, error_code, error_message'

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

export async function fetchSources(): Promise<ConnectorSource[]> {
  const { data, error } = await client().from(CONNECTOR_SOURCES_TABLE).select(SOURCE_SELECT).order('name')
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => sourceSchema.parse(row))
}

export async function fetchFeeds(): Promise<ConnectorFeed[]> {
  const { data, error } = await client().from(CONNECTOR_FEEDS_TABLE).select(FEED_SELECT).order('resource')
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => feedSchema.parse(row))
}

export async function fetchRuns(feedId: string): Promise<ConnectorRun[]> {
  const { data, error } = await client()
    .from(CONNECTOR_RUNS_TABLE)
    .select(RUN_SELECT)
    .eq('feed_id', feedId)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => runSchema.parse(row))
}

export async function fetchRejects(runId: string): Promise<ConnectorReject[]> {
  const { data, error } = await client()
    .from(CONNECTOR_REJECTS_TABLE)
    .select('id, row_index, sku, reason, detail')
    .eq('run_id', runId)
    .order('row_index')
    .limit(200)
  if (error) throw integrationsErrorFromDb(error)
  return (data ?? []).map((row) => rejectSchema.parse(row))
}

/** Alta o edición de la fuente y, si se escribió una, su credencial. */
export async function saveSource(id: string | null, draft: SourceDraft): Promise<string> {
  const auth = draft.authType
  const fields = {
    name: draft.name.trim(),
    description: blankToNull(draft.description),
    base_url: draft.baseUrl.trim().replace(/\/+$/, ''),
    auth_type: auth,
    auth_header: auth === 'api_key' ? blankToNull(draft.authHeader) : null,
    auth_username: auth === 'basic' || auth === 'oauth2' ? blankToNull(draft.authUsername) : null,
    oauth_token_url: auth === 'oauth2' ? blankToNull(draft.oauthTokenUrl) : null,
    oauth_scope: auth === 'oauth2' ? blankToNull(draft.oauthScope) : null,
    timeout_seconds: draft.timeoutSeconds,
    is_active: draft.isActive,
  }

  const supabase = client()
  const { data, error } = id
    ? await supabase.from(CONNECTOR_SOURCES_TABLE).update(fields).eq('id', id).select('id').single()
    : await supabase.from(CONNECTOR_SOURCES_TABLE).insert(fields).select('id').single()
  if (error) throw integrationsErrorFromDb(error)
  const sourceId = String((data as { id: string }).id)

  // Sin autenticación no hay credencial que guardar; con una nueva, se cambia.
  if (auth === 'none') {
    const { error: clearError } = await supabase.rpc(CONNECTOR_SET_SECRET_RPC, {
      p_source_id: sourceId,
      p_secret: '',
    })
    if (clearError) throw integrationsErrorFromDb(clearError)
  } else if (draft.secret.trim() !== '') {
    const { error: secretError } = await supabase.rpc(CONNECTOR_SET_SECRET_RPC, {
      p_source_id: sourceId,
      p_secret: draft.secret,
    })
    if (secretError) throw integrationsErrorFromDb(secretError)
  }
  return sourceId
}

export async function deleteSource(id: string): Promise<void> {
  const { error } = await client().from(CONNECTOR_SOURCES_TABLE).delete().eq('id', id)
  if (error) throw integrationsErrorFromDb(error)
}

export async function saveFeed(id: string | null, draft: FeedDraft): Promise<void> {
  const fields = {
    path: `/${draft.path.trim().replace(/^\/+/, '')}`,
    interval_minutes: draft.intervalMinutes,
    page_size: draft.pageSize,
    price_list_id: draft.resource === 'prices' ? draft.priceListId : null,
    default_warehouse_id: draft.resource === 'stock' ? draft.defaultWarehouseId : null,
    is_active: draft.isActive,
  }
  const supabase = client()
  const { error } = id
    ? await supabase.from(CONNECTOR_FEEDS_TABLE).update(fields).eq('id', id)
    : await supabase
        .from(CONNECTOR_FEEDS_TABLE)
        .insert({ ...fields, source_id: draft.sourceId, resource: draft.resource })
  if (error) throw integrationsErrorFromDb(error)
}

export async function deleteFeed(id: string): Promise<void> {
  const { error } = await client().from(CONNECTOR_FEEDS_TABLE).delete().eq('id', id)
  if (error) throw integrationsErrorFromDb(error)
}

export async function runFeedNow(id: string, full: boolean): Promise<void> {
  const { error } = await client().rpc(CONNECTOR_RUN_NOW_RPC, { p_feed_id: id, p_full: full })
  if (error) throw integrationsErrorFromDb(error)
}
