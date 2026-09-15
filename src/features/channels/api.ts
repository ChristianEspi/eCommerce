import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { ChannelError, channelErrorFromDb } from './errors'
import {
  CHANNELS_TABLE,
  CHANNEL_CATALOG_SUMMARY_RPC,
  CHANNEL_SET_DEFAULT_RPC,
  channelCatalogCountSchema,
  channelSchema,
  requiresAuthFor,
  type Channel,
  type ChannelCatalogCount,
  type ChannelFormValues,
} from './types'

/**
 * Acceso a canales de venta.
 *
 * Ninguna lectura filtra por tenant: lo hace la RLS desde el JWT. Las altas
 * llevan `organization_id`/`company_id` de la sociedad ACTIVA de la sesion y la
 * policy `channels_insert_admin` los vuelve a comprobar contra el token: un
 * valor que no fuera suyo no pasaria.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new ChannelError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

export interface ChannelScope {
  organizationId: string
  companyId: string
  storeId: string
}

const CHANNEL_SELECT = 'id, store_id, code, name, kind, is_default, requires_auth, is_active'

export async function fetchChannels(storeId: string | null): Promise<Channel[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(CHANNELS_TABLE)
    .select(CHANNEL_SELECT)
    .eq('store_id', storeId)
    .order('code')
  if (error) throw channelErrorFromDb(error)
  return channelSchema.array().parse(data ?? [])
}

/**
 * Cuantos productos tiene declarados cada canal. Cero NO es «vacio»: es «todo el
 * catalogo», la regla de `create_order`. Se cuenta en la base para no traerse
 * una fila por producto y canal solo para sumarlas.
 */
export async function fetchChannelCatalogSummary(
  storeId: string | null,
): Promise<ChannelCatalogCount[]> {
  if (!storeId) return []
  const { data, error } = await client().rpc(CHANNEL_CATALOG_SUMMARY_RPC, { p_store: storeId })
  if (error) throw channelErrorFromDb(error)
  return channelCatalogCountSchema.array().parse(data ?? [])
}

/**
 * Alta o edicion. `requires_auth` NO sale del formulario: lo decide el tipo,
 * igual que el CHECK de la base. `is_default` tampoco: la marca solo se mueve
 * con `setDefaultChannel`.
 */
export async function saveChannel(input: {
  scope: ChannelScope
  id: string | null
  values: ChannelFormValues
}): Promise<void> {
  const fila = {
    code: input.values.code.trim(),
    name: input.values.name.trim(),
    kind: input.values.kind,
    requires_auth: requiresAuthFor(input.values.kind),
    is_active: input.values.is_active,
  }

  const supabase = client()
  const { error } = input.id
    ? await supabase.from(CHANNELS_TABLE).update(fila).eq('id', input.id)
    : await supabase.from(CHANNELS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        store_id: input.scope.storeId,
        ...fila,
      })

  if (error) throw channelErrorFromDb(error)
}

export async function setChannelActive(input: { id: string; active: boolean }): Promise<void> {
  const { error } = await client()
    .from(CHANNELS_TABLE)
    .update({ is_active: input.active })
    .eq('id', input.id)
  if (error) throw channelErrorFromDb(error)
}

/**
 * Cambia el canal por defecto. Solo viaja el id: quien puede y sobre que
 * tienda lo decide `channel_set_default` a partir del JWT, y el cambio es una
 * sola transaccion (quita la marca al anterior y se la pone al nuevo).
 */
export async function setDefaultChannel(channelId: string): Promise<{ changed: boolean }> {
  const { data, error } = await client().rpc(CHANNEL_SET_DEFAULT_RPC, { p_channel_id: channelId })
  if (error) throw channelErrorFromDb(error)
  const changed = (data as { changed?: unknown } | null)?.changed
  return { changed: changed !== false }
}