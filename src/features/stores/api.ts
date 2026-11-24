import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLONE_STORE_RPC,
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

/** Secciones que se pueden copiar de una tienda a otra (`ebim.clone_store_sections`). */
export const CLONE_SECTIONS = [
  'design',
  'categories',
  'catalog',
  'payments_delivery',
  'supply',
  'content',
  'emails',
  'synonyms',
] as const
export type CloneSection = (typeof CLONE_SECTIONS)[number]

/**
 * Crea una tienda a partir de otra de la misma sociedad (2026-11-24). Copia la
 * configuración de las secciones elegidas; la moneda es la de origen y la nueva
 * nace en borrador. Los secretos de pago no viajan.
 */
export async function cloneStore(input: {
  sourceStoreId: string
  name: string
  slug: string
  sections: readonly CloneSection[]
}): Promise<{ store: ManagedStore; counts: Record<string, number> }> {
  const { data, error } = await client().rpc(CLONE_STORE_RPC, {
    p_source_store_id: input.sourceStoreId,
    p_slug: input.slug,
    p_name: input.name,
    p_sections: [...input.sections],
  })
  if (error) throw storeErrorFromDb(error)
  const counts = (data as { counts?: unknown } | null)?.counts
  return {
    store: managedStoreSchema.parse(data),
    counts: counts && typeof counts === 'object' ? (counts as Record<string, number>) : {},
  }
}

export async function setStoreStatus(input: { storeId: string; status: StoreStatus }): Promise<ManagedStore> {
  const { data, error } = await client().rpc(SET_STORE_STATUS_RPC, {
    p_store_id: input.storeId,
    p_status: input.status,
  })
  if (error) throw storeErrorFromDb(error)
  return managedStoreSchema.parse(data)
}
