import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { WORKSPACE_KEY_ROOT } from '@/features/tenant/workspace'
import { createStore, fetchCompanyStores, setStoreStatus, updateStore } from './api'
import type { ManagedStore } from './types'

/**
 * Estado de la administración de tiendas.
 *
 * Toda escritura invalida TAMBIÉN el espacio de trabajo: el selector de tienda
 * de la cabecera lee de ahí, y una tienda recién creada tiene que aparecer en él
 * sin recargar la página. La vitrina se invalida porque el estado y el slug
 * deciden qué tienda pública existe.
 */
export const STORES_ADMIN_KEY = ['stores-admin'] as const
export const companyStoresKey = (companyId: string | null) => [...STORES_ADMIN_KEY, companyId ?? 'none'] as const

function useInvalidateStores() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: STORES_ADMIN_KEY })
    void queryClient.invalidateQueries({ queryKey: WORKSPACE_KEY_ROOT })
    void queryClient.invalidateQueries({ queryKey: ['storefront'] })
  }
}

export function useCompanyStores(companyId: string | null): UseQueryResult<ManagedStore[]> {
  return useQuery({
    queryKey: companyStoresKey(companyId),
    queryFn: () => fetchCompanyStores(companyId),
    enabled: Boolean(companyId),
  })
}

export function useCreateStore() {
  const invalidate = useInvalidateStores()
  return useMutation({ mutationFn: createStore, onSuccess: invalidate })
}

export function useUpdateStore() {
  const invalidate = useInvalidateStores()
  return useMutation({ mutationFn: updateStore, onSuccess: invalidate })
}

export function useSetStoreStatus() {
  const invalidate = useInvalidateStores()
  return useMutation({ mutationFn: setStoreStatus, onSuccess: invalidate })
}
