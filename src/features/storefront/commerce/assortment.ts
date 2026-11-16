import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useSessionContext } from '@/features/auth/session-context'
import { MY_ASSORTMENT_BLOCKED_RPC } from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * El surtido de la empresa, en la tienda (2026-11-16).
 *
 * Qué productos de una lista NO puede comprar quien navega, según el surtido
 * de su cuenta B2B efectiva («Comprando para»). La cuenta la resuelve la base
 * desde la SESIÓN (`my_assortment_blocked`); el navegador solo manda productos.
 *
 * Es AVISO: marca y no deja añadir. Quien decide es la base al crear el pedido
 * (`order_items_assortment_guard` → `PRODUCTO_FUERA_DE_SURTIDO`), así que un
 * fallo de esta consulta no bloquea nada —se compra y el servidor responde—.
 *
 * Sin sesión, consumidor o sociedad sin el módulo: lista vacía, sin llamada.
 */
const SIN_BLOQUEOS: ReadonlySet<string> = new Set()

export async function fetchAssortmentBlocked(storeSlug: string, productIds: readonly string[]): Promise<string[]> {
  if (productIds.length === 0) return []
  const { data, error } = await getSupabaseClient().rpc(MY_ASSORTMENT_BLOCKED_RPC, {
    p_store_slug: storeSlug,
    p_product_ids: productIds,
  })
  if (error) throw new Error('ASSORTMENT_BLOCKED_FAILED')
  return z.array(z.string()).parse(data ?? [])
}

/** Los bloqueados de una lista (ficha, carrito). Sin sesión, ninguno. */
export function useAssortmentBlocked(storeSlug: string, productIds: readonly string[]): ReadonlySet<string> {
  const { status } = useSessionContext()
  const ids = [...new Set(productIds)].sort()
  const query = useQuery({
    queryKey: ['storefront', 'assortment-blocked', storeSlug, ids] as const,
    queryFn: () => fetchAssortmentBlocked(storeSlug, ids),
    enabled: status === 'authenticated' && storeSlug !== '' && ids.length > 0,
    staleTime: 60_000,
    retry: false,
  })
  return query.data ? new Set(query.data) : SIN_BLOQUEOS
}
