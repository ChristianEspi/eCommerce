import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { readInstallments, type StoreInstallments } from '@/features/storefront/productDetail'
import { STORE_SETTINGS_TABLE } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Datos de las cuotas sin intereses (`store_settings.installments`).
 *
 * Vive aparte del componente por la regla de arquitectura: ninguna pantalla
 * consulta la base ni crea un cliente de Supabase; los módulos de datos sí.
 * El tenant lo pone RLS sobre `store_settings`, nunca el navegador.
 */
const key = (storeId: string | null) => ['admin', 'store-installments', storeId] as const

export function useStoreInstallments(storeId: string | null) {
  return useQuery({
    queryKey: key(storeId),
    enabled: Boolean(storeId),
    queryFn: async (): Promise<StoreInstallments | null> => {
      const client = tryGetSupabaseClient()
      if (!client || !storeId) throw new Error('SIN_BACKEND')
      const { data, error } = await client
        .from(STORE_SETTINGS_TABLE)
        .select('installments')
        .eq('store_id', storeId)
        .maybeSingle()
      if (error) throw error
      return readInstallments(data?.installments ?? null)
    },
  })
}

export function useSaveStoreInstallments(storeId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (valor: StoreInstallments | null) => {
      const client = tryGetSupabaseClient()
      if (!client || !storeId) throw new Error('SIN_BACKEND')
      const { error } = await client.from(STORE_SETTINGS_TABLE).update({ installments: valor }).eq('store_id', storeId)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(storeId) }),
  })
}
