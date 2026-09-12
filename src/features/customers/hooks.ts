import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkApproval,
  deleteAccountUser,
  deleteAddress,
  deleteApprovalRule,
  deleteBusinessAccount,
  deleteContact,
  deleteCustomer,
  deleteExternalId,
  deleteLocation,
  fetchAccountForCustomer,
  fetchAccountUsers,
  fetchAddresses,
  fetchApprovalRules,
  fetchBusinessAccounts,
  fetchContacts,
  fetchCustomerOptions,
  fetchCustomerOrders,
  fetchCustomerUsage,
  fetchCustomers,
  fetchExternalIds,
  fetchLocations,
  fetchMyAccounts,
  fetchMyPendingAccounts,
  saveAccountUser,
  saveAddress,
  saveApprovalRule,
  saveBusinessAccount,
  saveContact,
  saveCustomer,
  saveExternalId,
  saveLocation,
  type CustomerPage,
} from './api'
import type {
  AccountContext,
  ApprovalRule,
  BusinessAccount,
  BusinessAccountUser,
  BusinessLocation,
  Customer,
  CustomerAddress,
  CustomerContact,
  CustomerExternalId,
  CustomerOrder,
  CustomerUsage,
} from './types'

/**
 * Estado del dominio de clientes en el cliente.
 *
 * Todas las claves cuelgan de `CUSTOMERS_KEY` y una escritura invalida además
 * las de precios: el segmento de un cliente decide qué acuerdo se le aplica, y
 * un simulador que siga contestando con el segmento anterior parece un fallo
 * del motor cuando es una pantalla sin refrescar.
 */
export const CUSTOMERS_KEY = ['customers'] as const

export const customersKey = (term: string, page: number, activeOnly: boolean) =>
  [...CUSTOMERS_KEY, 'list', term, page, activeOnly] as const
export const customerOptionsKey = (term: string, kind: string | null) =>
  [...CUSTOMERS_KEY, 'options', term, kind] as const
export const addressesKey = (customerId: string | null) =>
  [...CUSTOMERS_KEY, 'addresses', customerId] as const
export const contactsKey = (customerId: string | null) =>
  [...CUSTOMERS_KEY, 'contacts', customerId] as const
export const externalIdsKey = (customerId: string | null) =>
  [...CUSTOMERS_KEY, 'external-ids', customerId] as const
export const accountsKey = () => [...CUSTOMERS_KEY, 'accounts'] as const
export const accountForCustomerKey = (customerId: string | null) =>
  [...CUSTOMERS_KEY, 'account-of', customerId] as const
export const locationsKey = (accountId: string | null) =>
  [...CUSTOMERS_KEY, 'locations', accountId] as const
export const accountUsersKey = (accountId: string | null) =>
  [...CUSTOMERS_KEY, 'account-users', accountId] as const
export const approvalRulesKey = (accountId: string | null) =>
  [...CUSTOMERS_KEY, 'approval-rules', accountId] as const
export const customerOrdersKey = (customerId: string | null) =>
  [...CUSTOMERS_KEY, 'orders', customerId] as const
export const customerUsageKey = (customerId: string | null) =>
  [...CUSTOMERS_KEY, 'usage', customerId] as const
export const myAccountsKey = () => [...CUSTOMERS_KEY, 'my-accounts'] as const

function useInvalidateCustomers() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['pricing'] })
  }
}

export function useCustomers(input: { term: string; page: number; pageSize: number; activeOnly: boolean }) {
  return useQuery<CustomerPage>({
    queryKey: customersKey(input.term, input.page, input.activeOnly),
    queryFn: () => fetchCustomers(input),
  })
}

/** Selector de cliente. Busca en el servidor, con límite. */
export function useCustomerOptions(
  input: { term: string; kind?: 'person' | 'company'; enabled?: boolean } = { term: '' },
) {
  return useQuery<Customer[]>({
    queryKey: customerOptionsKey(input.term, input.kind ?? null),
    queryFn: () => fetchCustomerOptions({ term: input.term, ...(input.kind ? { kind: input.kind } : {}) }),
    enabled: input.enabled ?? true,
  })
}

export function useAddresses(customerId: string | null) {
  return useQuery<CustomerAddress[]>({
    queryKey: addressesKey(customerId),
    queryFn: () => fetchAddresses(customerId),
    enabled: Boolean(customerId),
  })
}

export function useContacts(customerId: string | null) {
  return useQuery<CustomerContact[]>({
    queryKey: contactsKey(customerId),
    queryFn: () => fetchContacts(customerId),
    enabled: Boolean(customerId),
  })
}

export function useExternalIds(customerId: string | null) {
  return useQuery<CustomerExternalId[]>({
    queryKey: externalIdsKey(customerId),
    queryFn: () => fetchExternalIds(customerId),
    enabled: Boolean(customerId),
  })
}

export function useBusinessAccounts(enabled = true) {
  return useQuery<BusinessAccount[]>({
    queryKey: accountsKey(),
    queryFn: fetchBusinessAccounts,
    enabled,
  })
}

export function useAccountForCustomer(customerId: string | null, enabled = true) {
  return useQuery<BusinessAccount | null>({
    queryKey: accountForCustomerKey(customerId),
    queryFn: () => fetchAccountForCustomer(customerId),
    enabled: Boolean(customerId) && enabled,
  })
}

export function useLocations(accountId: string | null) {
  return useQuery<BusinessLocation[]>({
    queryKey: locationsKey(accountId),
    queryFn: () => fetchLocations(accountId),
    enabled: Boolean(accountId),
  })
}

export function useAccountUsers(accountId: string | null) {
  return useQuery<BusinessAccountUser[]>({
    queryKey: accountUsersKey(accountId),
    queryFn: () => fetchAccountUsers(accountId),
    enabled: Boolean(accountId),
  })
}

export function useApprovalRules(accountId: string | null) {
  return useQuery<ApprovalRule[]>({
    queryKey: approvalRulesKey(accountId),
    queryFn: () => fetchApprovalRules(accountId),
    enabled: Boolean(accountId),
  })
}

export function useCustomerOrders(customerId: string | null, enabled = true) {
  return useQuery<CustomerOrder[]>({
    queryKey: customerOrdersKey(customerId),
    queryFn: () => fetchCustomerOrders(customerId),
    enabled: Boolean(customerId) && enabled,
  })
}

/** Solo se pide cuando hay un borrado en curso: es un conteo, no un listado. */
export function useCustomerUsage(customerId: string | null) {
  return useQuery<CustomerUsage | null>({
    queryKey: customerUsageKey(customerId),
    queryFn: () => fetchCustomerUsage(customerId),
    enabled: Boolean(customerId),
  })
}

/** El contexto de cuenta del usuario con sesión. Sin argumentos, a propósito. */
export function useMyAccounts(enabled = true) {
  return useQuery<AccountContext[]>({
    queryKey: myAccountsKey(),
    queryFn: fetchMyAccounts,
    enabled,
  })
}

/**
 * Vínculos pendientes de activación. Solo se pide cuando no hay ninguno activo,
 * que es el único momento en que cambia lo que se le dice al comprador.
 */
export function useMyPendingAccounts(enabled = true) {
  return useQuery({
    queryKey: [...myAccountsKey(), 'pending'] as const,
    queryFn: fetchMyPendingAccounts,
    enabled,
  })
}

/**
 * Comprueba si un importe necesita aprobación. Es una MUTACIÓN de react-query
 * por comodidad —se dispara a mano—, no porque cambie nada: la función del
 * servidor es de solo lectura y no crea ninguna solicitud.
 */
export function useCheckApproval() {
  return useMutation({ mutationFn: checkApproval })
}

export function useSaveCustomer() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveCustomer, onSuccess: invalidate })
}

export function useDeleteCustomer() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteCustomer, onSuccess: invalidate })
}

export function useSaveAddress() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveAddress, onSuccess: invalidate })
}

export function useDeleteAddress() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteAddress, onSuccess: invalidate })
}

export function useSaveContact() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveContact, onSuccess: invalidate })
}

export function useDeleteContact() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteContact, onSuccess: invalidate })
}

export function useSaveExternalId() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveExternalId, onSuccess: invalidate })
}

export function useDeleteExternalId() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteExternalId, onSuccess: invalidate })
}

export function useSaveBusinessAccount() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveBusinessAccount, onSuccess: invalidate })
}

export function useDeleteBusinessAccount() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteBusinessAccount, onSuccess: invalidate })
}

export function useSaveLocation() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveLocation, onSuccess: invalidate })
}

export function useDeleteLocation() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteLocation, onSuccess: invalidate })
}

export function useSaveAccountUser() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveAccountUser, onSuccess: invalidate })
}

export function useDeleteAccountUser() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteAccountUser, onSuccess: invalidate })
}

export function useSaveApprovalRule() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: saveApprovalRule, onSuccess: invalidate })
}

export function useDeleteApprovalRule() {
  const invalidate = useInvalidateCustomers()
  return useMutation({ mutationFn: deleteApprovalRule, onSuccess: invalidate })
}
