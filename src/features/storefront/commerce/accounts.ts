import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { MY_STORE_BUSINESS_ACCOUNTS_RPC, SELECT_STORE_BUSINESS_ACCOUNT_RPC } from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'
import type { PriceQuote } from '@/domain'
import { commerceContextKey } from './context'

/**
 * «Comprando para» cuando la persona tiene VARIAS cuentas en esta tienda (N01).
 *
 * El navegador no decide la cuenta: la PIDE. `select_store_business_account`
 * comprueba en el servidor que la cuenta es suya, está activa y es de la
 * sociedad de esta tienda, y guarda la elección; a partir de ahí el precio, la
 * barra, el checkout y el pedido salen de `ebim.effective_business_account`.
 * Aquí no se guarda nada en `localStorage` ni se manda la cuenta a ningún otro
 * sitio: tras elegir, se vuelve a preguntar todo al servidor.
 */

const accountSchema = z.object({
  account_id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  customer_name: z.string().nullable(),
  is_effective: z.boolean(),
})

export type StoreBusinessAccount = z.infer<typeof accountSchema>

export const storeAccountsKey = (storeSlug: string) => ['storefront', 'store-accounts', storeSlug] as const

export async function fetchStoreAccounts(storeSlug: string): Promise<StoreBusinessAccount[]> {
  const { data, error } = await getSupabaseClient().rpc(MY_STORE_BUSINESS_ACCOUNTS_RPC, { p_store_slug: storeSlug })
  if (error) throw error
  return z.array(accountSchema).parse(data ?? [])
}

export async function selectStoreAccount(storeSlug: string, accountId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc(SELECT_STORE_BUSINESS_ACCOUNT_RPC, {
    p_store_slug: storeSlug,
    p_account_id: accountId,
  })
  if (error) throw error
}

/** Solo se pregunta si el contexto ya dijo que hay más de una: con una, no hay nada que elegir. */
export function useStoreAccounts(storeSlug: string, enabled: boolean) {
  return useQuery({
    queryKey: storeAccountsKey(storeSlug),
    queryFn: () => fetchStoreAccounts(storeSlug),
    enabled: enabled && storeSlug !== '',
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

/** Total de cada cotización ACTIVA, por su clave. Para decir si el cambio movió precios. */
function quotedTotals(queryClient: QueryClient): Map<string, string> {
  const totals = new Map<string, string>()
  for (const [key, data] of queryClient.getQueriesData<PriceQuote>({ queryKey: ['pricing', 'cart-quote'] })) {
    if (data?.grossTotal !== undefined) totals.set(JSON.stringify(key), data.grossTotal)
  }
  return totals
}

export interface AccountSwitchResult {
  /** `true` si alguna cotización a la vista cambió de total con la cuenta nueva. */
  readonly pricesChanged: boolean
}

/**
 * Cambiar de cuenta y volver a preguntarlo TODO.
 *
 * El carrito no se toca: sus líneas son las mismas; lo que cambia es con qué
 * condiciones se cotizan, y eso lo vuelve a decir el servidor. Se invalidan el
 * contexto, la lista de cuentas, TODAS las cotizaciones (`['pricing']`: ficha,
 * carrito, checkout y precio de catálogo) y las opciones de entrega (su umbral
 * de envío gratis depende del precio), y se esperan las que están a la vista
 * para poder decir si el precio cambió.
 */
export function useSwitchStoreAccount(storeSlug: string) {
  const queryClient = useQueryClient()
  return useMutation<AccountSwitchResult, Error, string>({
    mutationFn: async (accountId) => {
      const before = quotedTotals(queryClient)
      await selectStoreAccount(storeSlug, accountId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: commerceContextKey(storeSlug) }),
        queryClient.invalidateQueries({ queryKey: storeAccountsKey(storeSlug) }),
        queryClient.invalidateQueries({ queryKey: ['pricing'] }),
        // R01 · Las opciones de entrega recalculan el subtotal con el precio de
        // la cuenta: el umbral de envío gratis puede cambiar con ella.
        queryClient.invalidateQueries({ queryKey: ['storefront', 'delivery'] }),
      ])
      const after = quotedTotals(queryClient)
      let pricesChanged = false
      for (const [key, total] of after) {
        const previous = before.get(key)
        if (previous !== undefined && previous !== total) pricesChanged = true
      }
      return { pricesChanged }
    },
  })
}
