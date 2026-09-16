import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CREATE_STORE_RPC,
  SET_STORE_STATUS_RPC,
  STORES_TABLE,
  UPDATE_STORE_RPC,
} from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { StoreAdminError, storeErrorFromDb } from './errors'
import { managedStoreSchema, type ManagedStore, type StoreFormValues, type StoreStatus } from './types'

/**
 * Tiendas de la sociedad activa.
 *
 * Ninguna escritura manda organización ni sociedad: `create_store` las toma del
 * JWT y los otros dos comandos de la fila de la tienda. La lectura filtra por
 * la sociedad activa solo para ORDENAR la pantalla; qué filas existen para quien
 * pregunta lo decide la RLS.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new StoreAdminError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

const STORE_SELECT = 'id, organization_id, company_id, slug, name, status, currency, domain, created_at, updated_at'

export async function fetchCompanyStores(companyId: string | null): Promise<ManagedStore[]> {
  if (!companyId) return []
  const { data, error } = await client()
    .from(STORES_TABLE)
    .select(STORE_SELECT)
    .eq('company_id', companyId)
    .order('name')
  if (error) throw storeErrorFromDb(error)
  return managedStoreSchema.array().parse(data ?? [])
}

export async function createStore(values: StoreFormValues): Promise<ManagedStore> {
  const { data, error } = await client().rpc(CREATE_STORE_RPC, {
    p_slug: values.slug,
    p_name: values.name,
    p_currency: values.currency,
    p_domain: values.domain === '' ? null : values.domain,
  })
  if (error) throw storeErrorFromDb(error)
  return managedStoreSchema.parse(data)
}

/**
 * Solo viaja lo que cambió: NULL significa «no tocar» en `update_store`, y
 * mandar la moneda sin cambiarla obligaría a la base a comprobar si está en uso.
 */
export async function updateStore(input: { store: ManagedStore; values: StoreFormValues }): Promise<ManagedStore> {
  const { store, values } = input
  const domain = values.domain === '' ? null : values.domain
  const { data, error } = await client().rpc(UPDATE_STORE_RPC, {
    p_store_id: store.id,
    p_name: values.name !== store.name ? values.name : null,
    p_slug: values.slug !== store.slug ? values.slug : null,
    p_domain: domain !== null && domain !== store.domain ? domain : null,
    p_clear_domain: domain === null && store.domain !== null,
    p_currency: values.currency !== store.currency ? values.currency : null,
  })
  if (error) throw storeErrorFromDb(error)
  return managedStoreSchema.parse(data)
}

export async function setStoreStatus(input: { storeId: string; status: StoreStatus }): Promise<ManagedStore> {
  const { data, error } = await client().rpc(SET_STORE_STATUS_RPC, {
    p_store_id: input.storeId,
    p_status: input.status,
  })
  if (error) throw storeErrorFromDb(error)
  return managedStoreSchema.parse(data)
}
