import type { QueryClient } from '@tanstack/react-query'
import { PRICE_QUOTE_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { tryGetStorefrontRpcClient } from '@/shared/lib/supabase'
import { COMMERCE_CONTEXT_STALE_MS, fetchCommerceContext, resolveCommerceContext } from './context'
import { commerceContextKey } from './keys'

/**
 * La parte que PESA del precio comercial de la rejilla (N03), cargada solo
 * cuando hay sesión: contexto comercial, audiencia y la cotización en lote.
 * Ver `catalogPrices.ts`, que es lo único que viaja con la portada.
 */

export type CommercialPriceLabel = 'trade' | 'enterprise'

export interface CatalogQuote {
  /** `null` = esta sesión no tiene condiciones comerciales: no se cotizó nada. */
  readonly label: CommercialPriceLabel | null
  readonly lines: ReadonlyArray<{ readonly productId: string; readonly amount: number }>
}

const NOTHING: CatalogQuote = { label: null, lines: [] }

export async function quoteCatalog(
  queryClient: QueryClient,
  storeSlug: string,
  productIds: readonly string[],
): Promise<CatalogQuote> {
  // El MISMO contexto (clave y caducidad) que la barra: si ya está, no se pide.
  const context = await queryClient.fetchQuery({
    queryKey: commerceContextKey(storeSlug),
    queryFn: () => fetchCommerceContext(storeSlug),
    staleTime: COMMERCE_CONTEXT_STALE_MS,
  })
  const { audience } = resolveCommerceContext(context)
  if (context?.has_commercial_pricing !== true || audience === 'consumer') return NOTHING

  const client = tryGetStorefrontRpcClient()
  if (!client || productIds.length === 0) return NOTHING
  // Slug, producto y cantidad. Ni precio, ni cliente, ni segmento, ni lista.
  const { data, error } = await client.rpc(PRICE_QUOTE_PUBLIC_RPC, {
    p_store_slug: storeSlug,
    p_items: productIds.map((productId) => ({ product_id: productId, quantity: 1 })),
  })
  if (error) throw error

  const raw = (data as { lines?: unknown } | null)?.lines
  const lines: Array<{ productId: string; amount: number }> = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    const line = entry as { product_id?: unknown; unit_price?: unknown; source?: unknown }
    // Solo lo que sale de una LISTA: el precio de catálogo ya lo pinta la tarjeta.
    if (line.source !== 'price_list' || typeof line.product_id !== 'string') continue
    const amount = Number(line.unit_price)
    if (Number.isFinite(amount)) lines.push({ productId: line.product_id, amount })
  }
  return { label: audience === 'enterprise' ? 'enterprise' : 'trade', lines }
}
