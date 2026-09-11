import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { CustomersError, customersErrorFromDb } from './errors'
import {
  APPROVAL_RULES_TABLE,
  BUSINESS_ACCOUNTS_TABLE,
  BUSINESS_ACCOUNT_USERS_TABLE,
  BUSINESS_LOCATIONS_TABLE,
  CUSTOMERS_TABLE,
  CUSTOMER_ADDRESSES_TABLE,
  CUSTOMER_CONTACTS_TABLE,
  CUSTOMER_EXTERNAL_IDS_TABLE,
  CUSTOMER_ORDERS_RPC,
  CUSTOMER_USAGE_RPC,
  MY_BUSINESS_ACCOUNTS_RPC,
  PURCHASE_APPROVAL_RPC,
  accountContextSchema,
  approvalDecisionSchema,
  approvalRuleSchema,
  businessAccountSchema,
  businessAccountUserSchema,
  businessLocationSchema,
  customerAddressSchema,
  customerContactSchema,
  customerExternalIdSchema,
  customerOrderSchema,
  customerSchema,
  customerUsageSchema,
  type AccountContext,
  type AccountFormValues,
  type AccountUserFormValues,
  type AddressFormValues,
  type ApprovalDecision,
  type ApprovalRule,
  type ApprovalRuleFormValues,
  type BusinessAccount,
  type BusinessAccountUser,
  type BusinessLocation,
  type ContactFormValues,
  type Customer,
  type CustomerAddress,
  type CustomerContact,
  type CustomerExternalId,
  type CustomerFormValues,
  type CustomerOrder,
  type CustomerUsage,
  type ExternalIdFormValues,
  type LocationFormValues,
} from './types'

/**
 * Acceso a datos del dominio de clientes.
 *
 * Las tres reglas del resto del backoffice, más una propia:
 *
 *  1. **Ninguna consulta declara el tenant.** `organization_id`/`company_id` se
 *     escriben en los `insert` porque las columnas son NOT NULL, pero salen del
 *     contexto derivado del JWT; quien decide si esa escritura vale es la RLS.
 *  2. **Ningún `select` filtra por tenant**: un filtro olvidado parecería
 *     seguridad y no lo sería.
 *  3. **El error de Postgres no sale de aquí**: se traduce a código.
 *  4. **El contexto de cuenta NO se pide por id.** `my_business_accounts` no
 *     acepta argumentos: si aceptara uno, existiría la posibilidad de mandarlo
 *     desde el navegador, y con ella la clase entera de error que la regla 8 de
 *     la fase prohíbe.
 */

export interface TenantScope {
  organizationId: string
  companyId: string
}

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new CustomersError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const CUSTOMER_SELECT =
  'id, kind, code, name, legal_name, tax_id, email, phone, segment_id, is_active, notes'

export interface CustomerPage {
  rows: Customer[]
  total: number
}

/**
 * Listado paginado EN EL SERVIDOR. Igual que el PIM: traerse la tabla entera es
 * correcto con cincuenta clientes e insostenible con los miles que tiene
 * cualquier tienda que lleve un año abierta, y rompe justo en el cliente que
 * más lo necesita.
 */
export async function fetchCustomers(input: {
  term: string
  page: number
  pageSize: number
  activeOnly: boolean
}): Promise<CustomerPage> {
  const from = input.page * input.pageSize
  let query = client()
    .from(CUSTOMERS_TABLE)
    .select(CUSTOMER_SELECT, { count: 'exact' })
    .order('name')
    .range(from, from + input.pageSize - 1)

  if (input.activeOnly) query = query.eq('is_active', true)

  const filter = buildTextSearchFilter(input.term, ['name', 'code', 'email', 'tax_id'])
  if (filter) query = query.or(filter)

  const { data, error, count } = await query
  if (error) throw customersErrorFromDb(error)
  return { rows: customerSchema.array().parse(data ?? []), total: count ?? 0 }
}

/**
 * Selector de cliente: búsqueda EN EL SERVIDOR con límite 20.
 *
 * La usan el alta de una cuenta B2B (que solo puede colgar de una empresa) y la
 * asignación de una lista de precio a un cliente concreto. Con límite por la
 * misma razón que el selector de producto del PIM: uno que se trae la cartera
 * entera para filtrarla en memoria deja de abrir en el cliente que más clientes
 * tiene.
 */
export async function fetchCustomerOptions(input: {
  term: string
  kind?: 'person' | 'company'
}): Promise<Customer[]> {
  let query = client()
    .from(CUSTOMERS_TABLE)
    .select(CUSTOMER_SELECT)
    .eq('is_active', true)
    .order('name')
    .limit(20)

  if (input.kind) query = query.eq('kind', input.kind)

  const filter = buildTextSearchFilter(input.term, ['name', 'code', 'tax_id'])
  if (filter) query = query.or(filter)

  const { data, error } = await query
  if (error) throw customersErrorFromDb(error)
  return customerSchema.array().parse(data ?? [])
}

export async function saveCustomer(input: {
  id?: string | null
  scope: TenantScope
  values: CustomerFormValues
}): Promise<string> {
  const supabase = client()
  const fields = {
    kind: input.values.kind,
    code: input.values.code,
    name: input.values.name,
    legal_name: nullable(input.values.legal_name),
    tax_id: nullable(input.values.tax_id),
    email: nullable(input.values.email.toLowerCase()),
    phone: nullable(input.values.phone),
    segment_id: nullable(input.values.segment_id),
    is_active: input.values.is_active,
    notes: nullable(input.values.notes),
  }

  const { data, error } = input.id
    ? await supabase.from(CUSTOMERS_TABLE).update(fields).eq('id', input.id).select('id').single()
    : await supabase
        .from(CUSTOMERS_TABLE)
        .insert({
          organization_id: input.scope.organizationId,
          company_id: input.scope.companyId,
          ...fields,
        })
        .select('id')
        .single()

  if (error) throw customersErrorFromDb(error)
  return String((data as { id: string } | null)?.id ?? input.id)
}

export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await client().from(CUSTOMERS_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Direcciones
// ---------------------------------------------------------------------------

const ADDRESS_SELECT =
  'id, customer_id, label, recipient, phone, line1, line2, city, region, postal_code, country, ' +
  'is_shipping, is_billing, is_default_shipping, is_default_billing, verification, verified_at, ' +
  'verification_source, external_ref, is_active'

export async function fetchAddresses(customerId: string | null): Promise<CustomerAddress[]> {
  if (!customerId) return []
  const { data, error } = await client()
    .from(CUSTOMER_ADDRESSES_TABLE)
    .select(ADDRESS_SELECT)
    .eq('customer_id', customerId)
    .order('label')
  if (error) throw customersErrorFromDb(error)
  return customerAddressSchema.array().parse(data ?? [])
}

export async function saveAddress(input: {
  id?: string | null
  scope: TenantScope
  customerId: string
  values: AddressFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    label: input.values.label,
    recipient: nullable(input.values.recipient),
    phone: nullable(input.values.phone),
    line1: input.values.line1,
    line2: nullable(input.values.line2),
    city: nullable(input.values.city),
    region: nullable(input.values.region),
    postal_code: nullable(input.values.postal_code),
    country: input.values.country.toUpperCase(),
    is_shipping: input.values.is_shipping,
    is_billing: input.values.is_billing,
    is_default_shipping: input.values.is_default_shipping,
    is_default_billing: input.values.is_default_billing,
    verification: input.values.verification,
    verification_source: nullable(input.values.verification_source),
    external_ref: nullable(input.values.external_ref),
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(CUSTOMER_ADDRESSES_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(CUSTOMER_ADDRESSES_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        customer_id: input.customerId,
        ...fields,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteAddress(id: string): Promise<void> {
  const { error } = await client().from(CUSTOMER_ADDRESSES_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

const CONTACT_SELECT = 'id, customer_id, name, email, phone, role_title, is_primary, is_active'

export async function fetchContacts(customerId: string | null): Promise<CustomerContact[]> {
  if (!customerId) return []
  const { data, error } = await client()
    .from(CUSTOMER_CONTACTS_TABLE)
    .select(CONTACT_SELECT)
    .eq('customer_id', customerId)
    .order('name')
  if (error) throw customersErrorFromDb(error)
  return customerContactSchema.array().parse(data ?? [])
}

export async function saveContact(input: {
  id?: string | null
  scope: TenantScope
  customerId: string
  values: ContactFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    name: input.values.name,
    email: nullable(input.values.email.toLowerCase()),
    phone: nullable(input.values.phone),
    role_title: nullable(input.values.role_title),
    is_primary: input.values.is_primary,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(CUSTOMER_CONTACTS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(CUSTOMER_CONTACTS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        customer_id: input.customerId,
        ...fields,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await client().from(CUSTOMER_CONTACTS_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Identificadores externos
// ---------------------------------------------------------------------------

const EXTERNAL_SELECT = 'id, customer_id, system_code, external_id, notes'

export async function fetchExternalIds(customerId: string | null): Promise<CustomerExternalId[]> {
  if (!customerId) return []
  const { data, error } = await client()
    .from(CUSTOMER_EXTERNAL_IDS_TABLE)
    .select(EXTERNAL_SELECT)
    .eq('customer_id', customerId)
    .order('system_code')
  if (error) throw customersErrorFromDb(error)
  return customerExternalIdSchema.array().parse(data ?? [])
}

export async function saveExternalId(input: {
  id?: string | null
  scope: TenantScope
  customerId: string
  values: ExternalIdFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    system_code: input.values.system_code,
    external_id: input.values.external_id,
    notes: nullable(input.values.notes),
  }

  const { error } = input.id
    ? await supabase.from(CUSTOMER_EXTERNAL_IDS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(CUSTOMER_EXTERNAL_IDS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        customer_id: input.customerId,
        ...fields,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteExternalId(id: string): Promise<void> {
  const { error } = await client().from(CUSTOMER_EXTERNAL_IDS_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Cuentas B2B
// ---------------------------------------------------------------------------

const ACCOUNT_SELECT =
  'id, customer_id, code, name, is_active, requires_approval, approval_threshold::text, ' +
  'purchase_order_required, notes'

export async function fetchBusinessAccounts(): Promise<BusinessAccount[]> {
  const { data, error } = await client().from(BUSINESS_ACCOUNTS_TABLE).select(ACCOUNT_SELECT).order('name')
  if (error) throw customersErrorFromDb(error)
  return businessAccountSchema.array().parse(data ?? [])
}

export async function fetchAccountForCustomer(
  customerId: string | null,
): Promise<BusinessAccount | null> {
  if (!customerId) return null
  const { data, error } = await client()
    .from(BUSINESS_ACCOUNTS_TABLE)
    .select(ACCOUNT_SELECT)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (error) throw customersErrorFromDb(error)
  return data ? businessAccountSchema.parse(data) : null
}

export async function saveBusinessAccount(input: {
  id?: string | null
  scope: TenantScope
  customerId: string
  values: AccountFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    is_active: input.values.is_active,
    requires_approval: input.values.requires_approval,
    approval_threshold: nullable(input.values.approval_threshold),
    purchase_order_required: input.values.purchase_order_required,
    notes: nullable(input.values.notes),
  }

  const { error } = input.id
    ? await supabase.from(BUSINESS_ACCOUNTS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(BUSINESS_ACCOUNTS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        customer_id: input.customerId,
        ...fields,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteBusinessAccount(id: string): Promise<void> {
  const { error } = await client().from(BUSINESS_ACCOUNTS_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Sucursales, usuarios y reglas
// ---------------------------------------------------------------------------

const LOCATION_SELECT =
  'id, business_account_id, customer_id, code, name, address_id, is_default, is_active'

export async function fetchLocations(accountId: string | null): Promise<BusinessLocation[]> {
  if (!accountId) return []
  const { data, error } = await client()
    .from(BUSINESS_LOCATIONS_TABLE)
    .select(LOCATION_SELECT)
    .eq('business_account_id', accountId)
    .order('name')
  if (error) throw customersErrorFromDb(error)
  return businessLocationSchema.array().parse(data ?? [])
}

export async function saveLocation(input: {
  id?: string | null
  scope: TenantScope
  accountId: string
  customerId: string
  values: LocationFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    address_id: nullable(input.values.address_id),
    is_default: input.values.is_default,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(BUSINESS_LOCATIONS_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(BUSINESS_LOCATIONS_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        business_account_id: input.accountId,
        customer_id: input.customerId,
        ...fields,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteLocation(id: string): Promise<void> {
  const { error } = await client().from(BUSINESS_LOCATIONS_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

const ACCOUNT_USER_SELECT =
  'id, business_account_id, user_id, email, role, spending_limit::text, status, default_location_id'

export async function fetchAccountUsers(accountId: string | null): Promise<BusinessAccountUser[]> {
  if (!accountId) return []
  const { data, error } = await client()
    .from(BUSINESS_ACCOUNT_USERS_TABLE)
    .select(ACCOUNT_USER_SELECT)
    .eq('business_account_id', accountId)
    .order('email')
  if (error) throw customersErrorFromDb(error)
  return businessAccountUserSchema.array().parse(data ?? [])
}

export async function saveAccountUser(input: {
  id?: string | null
  scope: TenantScope
  accountId: string
  values: AccountUserFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    email: input.values.email.toLowerCase(),
    role: input.values.role,
    spending_limit: nullable(input.values.spending_limit),
    status: input.values.status,
    default_location_id: nullable(input.values.default_location_id),
  }

  // Editar una fila ya vinculada se queda como estaba: la identidad no cambia,
  // solo el rol, el límite o la sucursal.
  //
  // El ALTA, en cambio, ya no inserta desde aquí. Necesitaba el `user_id` —el
  // uuid del usuario— y ese dato no se enseña en ninguna pantalla, así que el
  // formulario pedía pegarlo y nadie tenía de dónde. Ahora lo resuelve el
  // servidor a partir del correo, que además es quien comprueba que quien
  // pregunta administra esa sociedad.
  const { error } = input.id
    ? await supabase.from(BUSINESS_ACCOUNT_USERS_TABLE).update(fields).eq('id', input.id)
    : await supabase.rpc('add_business_account_user', {
        p_account_id: input.accountId,
        p_email: fields.email,
        p_role: input.values.role,
        p_spending_limit: fields.spending_limit,
        p_location_id: fields.default_location_id,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteAccountUser(id: string): Promise<void> {
  const { error } = await client().from(BUSINESS_ACCOUNT_USERS_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

const RULE_SELECT = 'id, business_account_id, name, min_amount::text, approver_role, is_active'

export async function fetchApprovalRules(accountId: string | null): Promise<ApprovalRule[]> {
  if (!accountId) return []
  const { data, error } = await client()
    .from(APPROVAL_RULES_TABLE)
    .select(RULE_SELECT)
    .eq('business_account_id', accountId)
    .order('min_amount')
  if (error) throw customersErrorFromDb(error)
  return approvalRuleSchema.array().parse(data ?? [])
}

export async function saveApprovalRule(input: {
  id?: string | null
  scope: TenantScope
  accountId: string
  values: ApprovalRuleFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    name: input.values.name,
    min_amount: input.values.min_amount,
    approver_role: input.values.approver_role,
    is_active: input.values.is_active,
  }

  const { error } = input.id
    ? await supabase.from(APPROVAL_RULES_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(APPROVAL_RULES_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        business_account_id: input.accountId,
        ...fields,
      })

  if (error) throw customersErrorFromDb(error)
}

export async function deleteApprovalRule(id: string): Promise<void> {
  const { error } = await client().from(APPROVAL_RULES_TABLE).delete().eq('id', id)
  if (error) throw customersErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Servidor: contexto de cuenta, autorización y pedidos del cliente
// ---------------------------------------------------------------------------

/**
 * El contexto de cuenta del usuario que tiene la sesión abierta.
 *
 * **Sin argumentos.** Es la regla 8 de la fase escrita en la firma de la
 * llamada: no hay un id de cuenta que mandar, así que no existe la clase de
 * error que consiste en creerse el que manda el navegador.
 */
export async function fetchMyAccounts(): Promise<AccountContext[]> {
  const { data, error } = await client().rpc(MY_BUSINESS_ACCOUNTS_RPC, {})
  if (error) throw customersErrorFromDb(error)
  return accountContextSchema.array().parse(data ?? [])
}

/**
 * Si un importe necesita aprobación. Lo decide la MISMA función que va a
 * decidirlo cuando exista el flujo: preguntarlo en JavaScript daría una segunda
 * respuesta, y la segunda respuesta a una pregunta de autorización siempre
 * acaba siendo la que alguien usa por error.
 */
export async function checkApproval(input: {
  accountId: string
  amount: string
}): Promise<ApprovalDecision> {
  const { data, error } = await client().rpc(PURCHASE_APPROVAL_RPC, {
    p_business_account_id: input.accountId,
    p_amount: input.amount,
  })
  if (error) throw customersErrorFromDb(error)
  return approvalDecisionSchema.parse(data)
}

/** Pedidos del cliente, enlazados POR CORREO. La heurística está declarada. */
export async function fetchCustomerOrders(customerId: string | null): Promise<CustomerOrder[]> {
  if (!customerId) return []
  const { data, error } = await client().rpc(CUSTOMER_ORDERS_RPC, { p_customer_id: customerId })
  if (error) throw customersErrorFromDb(error)
  return customerOrderSchema.array().parse(data ?? [])
}

/** Conteo REAL de lo que arrastra borrar un cliente (contrato §4.2). */
export async function fetchCustomerUsage(customerId: string | null): Promise<CustomerUsage | null> {
  if (!customerId) return null
  const { data, error } = await client().rpc(CUSTOMER_USAGE_RPC, { p_customer_id: customerId })
  if (error) throw customersErrorFromDb(error)
  return customerUsageSchema.parse(data)
}
