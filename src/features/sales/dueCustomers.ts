import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useTenant } from '@/features/tenant/tenant-context'
import { codeFromDbError } from '@/shared/lib/appError'
import { SALES_DUE_CUSTOMERS_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Agenda del vendedor (2026-11-19): los clientes que, por SU ritmo de compra,
 * ya deberían haber pedido. Lo calcula la base (`sales_due_customers`) con la
 * mediana de los intervalos entre pedidos; un vendedor solo ve su cartera.
 */
export const dueCustomerSchema = z.object({
  customer_id: z.string().uuid(),
  customer_name: z.string(),
  last_order_at: z.string(),
  orders_count: z.number().int(),
  typical_days: z.coerce.number(),
  days_since: z.coerce.number(),
  overdue_days: z.coerce.number(),
})
export type DueCustomer = z.infer<typeof dueCustomerSchema>

export class DueCustomersError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'DueCustomersError'
  }
}

export async function fetchDueCustomers(): Promise<DueCustomer[]> {
  const client = tryGetSupabaseClient()
  if (!client) throw new DueCustomersError('CONFIG_INCOMPLETA')
  const { data, error } = await client.rpc(SALES_DUE_CUSTOMERS_RPC)
  if (error) throw new DueCustomersError(codeFromDbError(error))
  return z.array(dueCustomerSchema).parse(data ?? [])
}

export function useDueCustomers() {
  const { activeCompanyId } = useTenant()
  return useQuery({
    queryKey: ['sales', 'due-customers', activeCompanyId ?? null],
    queryFn: fetchDueCustomers,
    enabled: Boolean(activeCompanyId),
    staleTime: 5 * 60_000,
  })
}
