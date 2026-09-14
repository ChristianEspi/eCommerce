import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isMissingFunction } from '../consumer'
import {
  decideMyOrderApproval,
  fetchMyPendingApprovals,
  myApprovalsKey,
  myOrderDetailKey,
  myOrdersKey,
  type ApprovalDecision,
} from '../portal'

/**
 * Hooks de la bandeja de aprobaciones del comprador B2B (cierre, item 2).
 *
 * Los componentes no tocan Supabase (lo vigila `architecture.test.ts`): leen y
 * deciden por aquí, y aquí se decide qué se refresca después.
 */

/** Pedidos de sus cuentas que esperan firma. `can_decide` viene por fila, del servidor. */
export function useMyPendingApprovals(enabled: boolean) {
  return useQuery({
    queryKey: myApprovalsKey(),
    queryFn: () => fetchMyPendingApprovals(),
    enabled,
    retry: (count, error) => !isMissingFunction(error) && count < 2,
  })
}

/**
 * Aprobar o rechazar.
 *
 * Tras decidir —y también tras FALLAR— se invalidan la bandeja, «Mis pedidos»
 * y el detalle de ese pedido: un `APROBACION_NO_APLICA` significa que otra
 * persona ya decidió, y lo útil es que la fila desaparezca en vez de seguir
 * ofreciendo un botón que va a volver a fallar.
 */
export function useDecideMyApproval() {
  const queryClient = useQueryClient()
  return useMutation<ApprovalDecision, Error, { orderId: string; approve: boolean; reason?: string | null }>({
    mutationFn: decideMyOrderApproval,
    onSettled: (_data, _error, input) => {
      // `myOrdersKey` es prefijo de `myApprovalsKey`: una invalidación cubre las dos.
      void queryClient.invalidateQueries({ queryKey: myOrdersKey() })
      void queryClient.invalidateQueries({ queryKey: myOrderDetailKey(input.orderId) })
    },
  })
}
