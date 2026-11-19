/**
 * Las herramientas del núcleo conversacional, conectadas a la base (2026-11-19).
 *
 * Solo RPC PÚBLICAS de la vitrina y con el cliente ANÓNIMO: un canal
 * conversacional ve exactamente lo que ve cualquier visitante de la tienda,
 * nada más. El pedido exige su número y su token, como el enlace de
 * seguimiento. Ningún canal lo usa todavía: ver `_shared/commerceAgent.ts`.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.48.0'
import type { PuertosComercio } from '../_shared/commerceAgent.ts'

export function puertosComercio(anon: SupabaseClient, storeSlug: string): PuertosComercio {
  return {
    async buscar(consulta, soloConStock) {
      const { data, error } = await anon.rpc('catalog_search_for_slug', {
        p_store_slug: storeSlug,
        p_query: consulta,
        p_filters: soloConStock ? { availability: 'in_stock' } : {},
        p_sort: 'relevance',
        p_limit: 6,
        p_offset: 0,
      })
      if (error) return []
      return Array.isArray(data?.items) ? (data.items as Array<Record<string, unknown>>) : []
    },
    async producto(productId) {
      const { data, error } = await anon.rpc('product_detail_for_slug', {
        p_store_slug: storeSlug,
        p_product_id: productId,
        p_variant_id: null,
      })
      if (error || !data || typeof data !== 'object') return null
      return data as Record<string, unknown>
    },
    async pedido(numero, token) {
      const { data, error } = await anon.rpc('order_by_token', {
        p_store_slug: storeSlug,
        p_order_number: numero,
        p_token: token,
      })
      if (error || !data || typeof data !== 'object') return null
      return data as Record<string, unknown>
    },
  }
}
