import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { codeFromDbError } from '@/shared/lib/appError'
import { ADMIN_PRODUCT_MASTERS_VIEW, ORDERS_TABLE } from '@/shared/lib/db-schema'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/** Cuántos resultados por tipo. Un paleta que scrollea deja de ser un atajo. */
export const HITS_PER_GROUP = 5

export interface SearchHit {
  id: string
  kind: 'order' | 'product'
  title: string
  subtitle: string
  to: string
}

const orderRow = z.object({
  id: z.string().uuid(),
  order_number: z.string(),
  customer_name: z.string().nullable(),
  customer_email: z.string(),
})

const productRow = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
})

/**
 * Busca en los datos del tenant activo.
 *
 * Sin filtro de tenant en la consulta: lo pone la RLS con los claims del JWT,
 * igual que en el resto de la app. Lo único que se acota aquí es la TIENDA, que
 * es alcance de pantalla y no de seguridad.
 *
 * Se consultan las dos tablas en paralelo y cada una acotada a cinco filas: un
 * buscador que tarda deja de usarse, y el sitio para ver cincuenta pedidos es la
 * pantalla de pedidos.
 */
export async function searchEverything(
  storeId: string | null,
  term: string,
): Promise<SearchHit[]> {
  const supabase = tryGetSupabaseClient()
  if (!supabase || !storeId) return []

  const orderFilter = buildTextSearchFilter(term, [
    'order_number',
    'customer_name',
    'customer_email',
  ])
  // ADR 018: el atajo lleva a `/app/products`, que lista los MAESTROS de la
  // sociedad activa; se busca ahí, por lo que se ve en esa pantalla.
  const productFilter = buildTextSearchFilter(term, ['name', 'sku'])
  if (!orderFilter && !productFilter) return []

  const [orders, products] = await Promise.all([
    orderFilter
      ? supabase
          .from(ORDERS_TABLE)
          .select('id, order_number, customer_name, customer_email')
          .eq('store_id', storeId)
          .or(orderFilter)
          .order('placed_at', { ascending: false })
          .limit(HITS_PER_GROUP)
      : Promise.resolve({ data: [], error: null }),
    productFilter
      ? supabase
          .from(ADMIN_PRODUCT_MASTERS_VIEW)
          .select('id, sku, name')
          .or(productFilter)
          .order('name')
          .limit(HITS_PER_GROUP)
      : Promise.resolve({ data: [], error: null }),
  ])

  const failure = orders.error ?? products.error
  // El código, nunca el `message`: un error de PostgREST lleva dentro nombres de
  // tabla y de policy, y esto se dispara con cada tecla.
  if (failure) throw new AppError({ boundary: 'tenancy', code: codeFromDbError(failure) })

  return [
    ...orderRow.array().parse(orders.data ?? []).map(
      (row): SearchHit => ({
        id: row.id,
        kind: 'order',
        title: row.order_number,
        subtitle: row.customer_name ?? row.customer_email,
        to: '/app/orders',
      }),
    ),
    ...productRow.array().parse(products.data ?? []).map(
      (row): SearchHit => ({
        id: row.id,
        kind: 'product',
        title: row.name,
        subtitle: row.sku,
        to: '/app/products',
      }),
    ),
  ]
}

export const globalSearchKey = (storeId: string | null, term: string) =>
  ['global-search', storeId, term] as const

export function useGlobalSearch(storeId: string | null, term: string, enabled: boolean) {
  return useQuery<SearchHit[]>({
    queryKey: globalSearchKey(storeId, term),
    queryFn: () => searchEverything(storeId, term),
    // Dos caracteres no acotan nada: la consulta devolveria medio catalogo y
    // costaria lo mismo que traerlo entero.
    enabled: enabled && term.trim().length >= 2,
    retry: false,
    staleTime: 15_000,
  })
}
