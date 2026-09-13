import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { MY_COMMERCE_CONTEXT_RPC } from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'
import { deriveCommerceAudience, type CommerceAudience } from './audience'

/**
 * El contexto comercial de la sesión en ESTA tienda, para pintarlo (H05-H06).
 *
 * Sale de `my_commerce_context(slug)`, que nombra la misma cuenta que usa el
 * motor de precios. Aquí no se decide nada: se traduce la respuesta a una
 * etiqueta de audiencia y a los textos que la vitrina enseña. Un fallo —sin
 * función desplegada, red, lo que sea— no rompe la tienda: simplemente no se
 * pinta la barra, y el precio sigue siendo el que diga el servidor.
 */

const contextSchema = z.object({
  account_name: z.string(),
  account_code: z.string().nullable(),
  customer_name: z.string().nullable(),
  requires_approval: z.boolean(),
  purchase_order_required: z.boolean(),
  has_spending_limit: z.boolean(),
  has_credit_terms: z.boolean(),
  locations_count: z.number(),
  has_commercial_pricing: z.boolean(),
  accounts_in_store: z.number(),
})

export type CommerceContext = z.infer<typeof contextSchema>

export async function fetchCommerceContext(storeSlug: string): Promise<CommerceContext | null> {
  const { data, error } = await getSupabaseClient().rpc(MY_COMMERCE_CONTEXT_RPC, { p_store_slug: storeSlug })
  if (error) throw error
  return data === null || data === undefined ? null : contextSchema.parse(data)
}

export const commerceContextKey = (storeSlug: string) => ['storefront', 'commerce-context', storeSlug] as const

export interface ResolvedCommerceContext {
  readonly audience: CommerceAudience
  readonly context: CommerceContext | null
}

export function resolveCommerceContext(context: CommerceContext | null): ResolvedCommerceContext {
  return {
    context,
    audience: deriveCommerceAudience(
      context === null
        ? null
        : {
            requiresApproval: context.requires_approval,
            purchaseOrderRequired: context.purchase_order_required,
            hasSpendingLimit: context.has_spending_limit,
            hasCreditTerms: context.has_credit_terms,
            locationsCount: context.locations_count,
          },
    ),
  }
}

/** Sin sesión no se pregunta: el visitante anónimo es consumidor por definición. */
export function useCommerceContext(storeSlug: string, authenticated: boolean): ResolvedCommerceContext {
  const query = useQuery({
    queryKey: commerceContextKey(storeSlug),
    queryFn: () => fetchCommerceContext(storeSlug),
    enabled: authenticated && storeSlug !== '',
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  return resolveCommerceContext(authenticated && query.isSuccess ? query.data : null)
}
