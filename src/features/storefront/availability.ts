import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { STORE_OPERATIONAL_RPC } from '@/shared/lib/db-schema'
import { tryGetStorefrontClient } from '@/shared/lib/supabase'

/**
 * ¿La tienda puede vender ahora? (lifecycle.v1)
 *
 * Cuando EBIM MasterAdmin suspende la cuenta del comercio, el catálogo sigue
 * visible (solo lectura) y la vitrina muestra «Tienda no disponible
 * temporalmente». Carrito, checkout y pedido los bloquea el SERVIDOR: el
 * guardián de la base rechaza cualquier escritura del tenant con
 * `TENANT_SUSPENDED`. Esto es solo el aviso; no dice la causa (no es asunto
 * del comprador) y, ante cualquier duda (sin cliente, error de red), se calla:
 * un aviso falso de tienda cerrada cuesta ventas.
 */
const availabilitySchema = z.object({ operational: z.boolean() })

export async function fetchStoreOperational(storeSlug: string): Promise<boolean> {
  const supabase = tryGetStorefrontClient()
  if (!supabase) return true
  const { data, error } = await supabase.rpc(STORE_OPERATIONAL_RPC, { p_store_slug: storeSlug })
  if (error || data === null || data === undefined) return true
  const parsed = availabilitySchema.safeParse(data)
  return parsed.success ? parsed.data.operational : true
}

export const storeOperationalKey = (slug: string) => ['storefront', 'operational', slug] as const

export function useStoreOperational(storeSlug: string | undefined) {
  return useQuery({
    queryKey: storeOperationalKey(storeSlug ?? ''),
    queryFn: () => fetchStoreOperational(storeSlug as string),
    enabled: Boolean(storeSlug),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  })
}
