import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  confirmOfflinePayment,
  deletePaymentMethod,
  fetchPaymentAttempts,
  fetchPaymentEvents,
  fetchPaymentIntents,
  fetchPaymentMethods,
  fetchPaymentProviders,
  fetchPaymentsOf,
  fetchReconciliation,
  fetchRefundsOf,
  importReconciliation,
  matchReconciliation,
  requestRefund,
  savePaymentMethod,
  type ConfirmOfflineInput,
  type IntentFilter,
  type MethodScope,
  type RefundRequestInput,
  type StatementRow,
} from './api'
import type { PaymentMethodFormValues } from './types'

/**
 * Estado de pagos en el cliente.
 *
 * Toda escritura invalida el árbol entero de `payments` y además `storefront`:
 * activar o desactivar un medio de pago cambia lo que el comprador ve en el
 * checkout, y una vitrina que siga ofreciendo un medio retirado es peor que
 * una que tarde un segundo más en refrescar.
 *
 * Ninguna mutación toca el árbol de `orders` directamente aunque un cobro mueva
 * el eje de pago del pedido: quien lo movió fue la base, y refrescar el pedido
 * desde aquí sería adivinar cuándo. Los pedidos se releen al entrar.
 */
export const PAYMENTS_KEY = ['payments'] as const

export const paymentMethodsKey = (storeId: string | null) =>
  [...PAYMENTS_KEY, 'methods', storeId] as const
export const paymentProvidersKey = () => [...PAYMENTS_KEY, 'providers'] as const
export const paymentIntentsKey = (filter: IntentFilter) =>
  [...PAYMENTS_KEY, 'intents', filter.storeId, filter.status, filter.term] as const
export const paymentAttemptsKey = (intentId: string | null) =>
  [...PAYMENTS_KEY, 'attempts', intentId] as const
export const paymentEventsKey = (intentId: string | null) =>
  [...PAYMENTS_KEY, 'events', intentId] as const
export const paymentsOfKey = (intentId: string | null) =>
  [...PAYMENTS_KEY, 'payments', intentId] as const
export const refundsKey = (paymentIds: readonly string[]) =>
  [...PAYMENTS_KEY, 'refunds', [...paymentIds].sort().join(',')] as const
export const reconciliationKey = (status: string) =>
  [...PAYMENTS_KEY, 'reconciliation', status] as const

function useInvalidatePayments() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: PAYMENTS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['storefront'] })
  }
}

export function usePaymentMethods(storeId: string | null) {
  return useQuery({
    queryKey: paymentMethodsKey(storeId),
    queryFn: () => fetchPaymentMethods(storeId),
    enabled: storeId !== null,
  })
}

export function usePaymentProviders() {
  return useQuery({ queryKey: paymentProvidersKey(), queryFn: fetchPaymentProviders })
}

export function useSavePaymentMethod(scope: MethodScope | null) {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (values: PaymentMethodFormValues) => {
      if (!scope) throw new Error('SIN_TIENDA')
      return savePaymentMethod(scope, values)
    },
    onSuccess: invalidate,
  })
}

export function useDeletePaymentMethod() {
  const invalidate = useInvalidatePayments()
  return useMutation({ mutationFn: deletePaymentMethod, onSuccess: invalidate })
}

export function usePaymentIntents(filter: IntentFilter) {
  return useQuery({
    queryKey: paymentIntentsKey(filter),
    queryFn: () => fetchPaymentIntents(filter),
    enabled: filter.storeId !== null,
  })
}

export function usePaymentAttempts(intentId: string | null) {
  return useQuery({
    queryKey: paymentAttemptsKey(intentId),
    queryFn: () => fetchPaymentAttempts(intentId),
    enabled: intentId !== null,
  })
}

export function usePaymentEvents(intentId: string | null) {
  return useQuery({
    queryKey: paymentEventsKey(intentId),
    queryFn: () => fetchPaymentEvents(intentId),
    enabled: intentId !== null,
  })
}

export function usePaymentsOf(intentId: string | null) {
  return useQuery({
    queryKey: paymentsOfKey(intentId),
    queryFn: () => fetchPaymentsOf(intentId),
    enabled: intentId !== null,
  })
}

export function useRefundsOf(paymentIds: readonly string[]) {
  return useQuery({
    queryKey: refundsKey(paymentIds),
    queryFn: () => fetchRefundsOf(paymentIds),
    enabled: paymentIds.length > 0,
  })
}

export function useRequestRefund() {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (input: RefundRequestInput) => requestRefund(input),
    onSuccess: invalidate,
  })
}

export function useConfirmOfflinePayment() {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (input: ConfirmOfflineInput) => confirmOfflinePayment(input),
    onSuccess: invalidate,
  })
}

export function useReconciliation(status: string) {
  return useQuery({
    queryKey: reconciliationKey(status),
    queryFn: () => fetchReconciliation(status),
  })
}

export function useImportReconciliation() {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (input: { providerCode: string; rows: readonly StatementRow[] }) =>
      importReconciliation(input.providerCode, input.rows),
    onSuccess: invalidate,
  })
}

export function useMatchReconciliation() {
  const invalidate = useInvalidatePayments()
  return useMutation({
    mutationFn: (input: { recordId: string; paymentId: string }) =>
      matchReconciliation(input.recordId, input.paymentId),
    onSuccess: invalidate,
  })
}
