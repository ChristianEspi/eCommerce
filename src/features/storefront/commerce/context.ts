import { useQuery } from '@tanstack/react-query'
import { MY_COMMERCE_CONTEXT_RPC } from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'
import { deriveCommerceAudience, type CommerceAudience } from './audience'
import { commerceContextKey } from './keys'

/**
 * El contexto comercial de la sesión en ESTA tienda, para pintarlo (H05-H06).
 *
 * Sale de `my_commerce_context(slug)`, que nombra la misma cuenta que usa el
 * motor de precios. Aquí no se decide nada: se traduce la respuesta a una
 * etiqueta de audiencia y a los textos que la vitrina enseña. Un fallo —sin
 * función desplegada, red, lo que sea— no rompe la tienda: simplemente no se
 * pinta la barra, y el precio sigue siendo el que diga el servidor.
 *
 * **Sin zod, a propósito (N03).** La portada también pregunta este contexto
 * —para saber si merece la pena pedir el precio comercial de la rejilla— y la
 * portada no carga zod. La validación es la misma, escrita a mano: una
 * respuesta con otra forma se trata como un fallo y no se pinta nada.
 */

export interface CommerceContext {
  readonly account_name: string
  readonly account_code: string | null
  readonly customer_name: string | null
  readonly requires_approval: boolean
  readonly purchase_order_required: boolean
  readonly has_spending_limit: boolean
  readonly has_credit_terms: boolean
  readonly locations_count: number
  readonly has_commercial_pricing: boolean
  readonly accounts_in_store: number
}

const BOOLEANS = [
  'requires_approval',
  'purchase_order_required',
  'has_spending_limit',
  'has_credit_terms',
  'has_commercial_pricing',
] as const

function parseCommerceContext(raw: unknown): CommerceContext {
  const value = raw as Record<string, unknown>
  const nullableText = (key: string) => value[key] === null || typeof value[key] === 'string'
  const ok =
    typeof raw === 'object' &&
    raw !== null &&
    typeof value.account_name === 'string' &&
    nullableText('account_code') &&
    nullableText('customer_name') &&
    BOOLEANS.every((key) => typeof value[key] === 'boolean') &&
    typeof value.locations_count === 'number' &&
    typeof value.accounts_in_store === 'number'
  if (!ok) throw new Error('CONTEXTO_INVALIDO: la respuesta de my_commerce_context no tiene la forma esperada')
  return {
    account_name: value.account_name as string,
    account_code: (value.account_code as string | null) ?? null,
    customer_name: (value.customer_name as string | null) ?? null,
    requires_approval: value.requires_approval as boolean,
    purchase_order_required: value.purchase_order_required as boolean,
    has_spending_limit: value.has_spending_limit as boolean,
    has_credit_terms: value.has_credit_terms as boolean,
    locations_count: value.locations_count as number,
    has_commercial_pricing: value.has_commercial_pricing as boolean,
    accounts_in_store: value.accounts_in_store as number,
  }
}

export async function fetchCommerceContext(storeSlug: string): Promise<CommerceContext | null> {
  const { data, error } = await getSupabaseClient().rpc(MY_COMMERCE_CONTEXT_RPC, { p_store_slug: storeSlug })
  if (error) throw error
  return data === null || data === undefined ? null : parseCommerceContext(data)
}

export { commerceContextKey } from './keys'

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

/** Lo que tarda en caducar el contexto: el mismo para la barra y para la rejilla. */
export const COMMERCE_CONTEXT_STALE_MS = 5 * 60 * 1000

/** Sin sesión no se pregunta: el visitante anónimo es consumidor por definición. */
export function useCommerceContext(storeSlug: string, authenticated: boolean): ResolvedCommerceContext {
  const query = useQuery({
    queryKey: commerceContextKey(storeSlug),
    queryFn: () => fetchCommerceContext(storeSlug),
    enabled: authenticated && storeSlug !== '',
    retry: false,
    staleTime: COMMERCE_CONTEXT_STALE_MS,
  })
  return resolveCommerceContext(authenticated && query.isSuccess ? query.data : null)
}
