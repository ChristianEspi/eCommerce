import { z } from 'zod'
import { moneyText } from '@/shared/lib/money'

/**
 * Vocabulario del dominio de clientes en el cliente (P05-SaaS).
 *
 * Dos reglas que gobiernan este archivo:
 *
 *  1. **Usuario ≠ cliente.** Aquí no hay ni una función que convierta una
 *     sesión en un cliente. El vínculo entre una persona y una cuenta lo
 *     resuelve el servidor (`my_business_accounts`), y por eso esa llamada no
 *     lleva parámetros: no existe un id de cuenta que el navegador pueda
 *     mandar.
 *  2. **Nada de autorización se decide aquí.** Si un importe necesita
 *     aprobación lo dice `purchase_approval` en la base, con las mismas reglas
 *     que van a aplicarse de verdad. Una segunda evaluación en JavaScript sería
 *     la tercera copia de la misma regla, que es exactamente lo que P04
 *     desmontó con el precio.
 */

export {
  CUSTOMERS_TABLE,
  CUSTOMER_ADDRESSES_TABLE,
  CUSTOMER_CONTACTS_TABLE,
  CUSTOMER_EXTERNAL_IDS_TABLE,
  BUSINESS_ACCOUNTS_TABLE,
  BUSINESS_LOCATIONS_TABLE,
  BUSINESS_ACCOUNT_USERS_TABLE,
  APPROVAL_RULES_TABLE,
  CUSTOMER_SEGMENTS_TABLE,
  MY_BUSINESS_ACCOUNTS_RPC,
  PURCHASE_APPROVAL_RPC,
  CUSTOMER_ORDERS_RPC,
  CUSTOMER_USAGE_RPC,
} from '@/shared/lib/db-schema'

// ---------------------------------------------------------------------------
// Enumeraciones — copias del enum de Postgres, comparadas por un test
// ---------------------------------------------------------------------------

/**
 * Persona o empresa, y no un tercer valor para «perfil privado»: un perfil
 * privado es una persona sin cuenta B2B. Un tercer valor obligaría a decidir
 * qué pasa cuando una persona contrata el portal, y la respuesta correcta
 * —nada, sigue siendo una persona— ya la da el enum de dos.
 */
export const CUSTOMER_KINDS = ['person', 'company'] as const
export type CustomerKind = (typeof CUSTOMER_KINDS)[number]

export const ADDRESS_VERIFICATIONS = ['unverified', 'pending', 'verified', 'rejected'] as const
export type AddressVerification = (typeof ADDRESS_VERIFICATIONS)[number]

/**
 * Los cuatro roles de una cuenta B2B, del más capaz al que solo mira. El ORDEN
 * de esta constante es la jerarquía de capacidad y está escrito igual en el
 * enum `public.business_role`; un test compara las dos copias.
 */
export const BUSINESS_ROLES = ['admin', 'approver', 'buyer', 'viewer'] as const
export type BusinessRole = (typeof BUSINESS_ROLES)[number]

/** Qué puede hacer cada rol dentro de SU cuenta. No es la RLS: es la pantalla. */
export type BusinessPermission = 'account.manage' | 'purchase' | 'approve' | 'read'

export const BUSINESS_ROLE_PERMISSIONS: Record<BusinessPermission, readonly BusinessRole[]> = {
  // Gestionar la cuenta: invitar gente, tocar sucursales y reglas.
  'account.manage': ['admin'],
  // Comprar. El aprobador NO compra: si comprara y aprobara lo suyo, la
  // separación de funciones para la que existen las reglas sería decorativa.
  purchase: ['admin', 'buyer'],
  approve: ['admin', 'approver'],
  read: ['admin', 'approver', 'buyer', 'viewer'],
}

export function businessCan(
  role: BusinessRole | null | undefined,
  permission: BusinessPermission,
): boolean {
  if (!role) return false
  return BUSINESS_ROLE_PERMISSIONS[permission].includes(role)
}

export const MEMBER_STATUSES = ['active', 'invited', 'revoked'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export const customerSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(CUSTOMER_KINDS),
  code: z.string().min(1),
  name: z.string().min(1),
  legal_name: z.string().nullable().default(null),
  tax_id: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  segment_id: z.string().uuid().nullable().default(null),
  is_active: z.boolean(),
  notes: z.string().nullable().default(null),
})
export type Customer = z.infer<typeof customerSchema>

export const customerAddressSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  label: z.string().min(1),
  recipient: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  line1: z.string().min(1),
  line2: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  region: z.string().nullable().default(null),
  postal_code: z.string().nullable().default(null),
  country: z.string().length(2),
  is_shipping: z.boolean(),
  is_billing: z.boolean(),
  is_default_shipping: z.boolean(),
  is_default_billing: z.boolean(),
  verification: z.enum(ADDRESS_VERIFICATIONS),
  verified_at: z.string().nullable().default(null),
  verification_source: z.string().nullable().default(null),
  external_ref: z.string().nullable().default(null),
  is_active: z.boolean(),
})
export type CustomerAddress = z.infer<typeof customerAddressSchema>

export const customerContactSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  role_title: z.string().nullable().default(null),
  is_primary: z.boolean(),
  is_active: z.boolean(),
})
export type CustomerContact = z.infer<typeof customerContactSchema>

export const customerExternalIdSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  system_code: z.string().min(1),
  external_id: z.string().min(1),
  notes: z.string().nullable().default(null),
})
export type CustomerExternalId = z.infer<typeof customerExternalIdSchema>

export const businessAccountSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  is_active: z.boolean(),
  requires_approval: z.boolean(),
  approval_threshold: moneyText.nullable().default(null),
  purchase_order_required: z.boolean(),
  notes: z.string().nullable().default(null),
})
export type BusinessAccount = z.infer<typeof businessAccountSchema>

export const businessLocationSchema = z.object({
  id: z.string().uuid(),
  business_account_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  address_id: z.string().uuid().nullable().default(null),
  is_default: z.boolean(),
  is_active: z.boolean(),
})
export type BusinessLocation = z.infer<typeof businessLocationSchema>

export const businessAccountUserSchema = z.object({
  id: z.string().uuid(),
  business_account_id: z.string().uuid(),
  user_id: z.string().uuid(),
  email: z.string().min(1),
  role: z.enum(BUSINESS_ROLES),
  spending_limit: moneyText.nullable().default(null),
  status: z.enum(MEMBER_STATUSES),
  default_location_id: z.string().uuid().nullable().default(null),
})
export type BusinessAccountUser = z.infer<typeof businessAccountUserSchema>

export const approvalRuleSchema = z.object({
  id: z.string().uuid(),
  business_account_id: z.string().uuid(),
  name: z.string().min(1),
  min_amount: moneyText,
  approver_role: z.enum(BUSINESS_ROLES),
  is_active: z.boolean(),
})
export type ApprovalRule = z.infer<typeof approvalRuleSchema>

/** Los mismos estados del enum `public.order_status`, para poder traducirlos. */
export const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const

export const customerOrderSchema = z.object({
  order_id: z.string().uuid(),
  store_id: z.string().uuid(),
  order_number: z.string().min(1),
  status: z.enum(ORDER_STATUSES),
  currency: z.string().length(3),
  grand_total: moneyText,
  placed_at: z.string(),
})
export type CustomerOrder = z.infer<typeof customerOrderSchema>

/**
 * Lo que arrastra borrar un cliente. Se compara el objeto ENTERO contra el de
 * la base en un test: una clave nueva que nadie mire sería un borrado en
 * cascada que la pantalla no cuenta.
 */
export const customerUsageSchema = z.object({
  addresses: z.number().int(),
  contacts: z.number().int(),
  external_ids: z.number().int(),
  accounts: z.number().int(),
  account_users: z.number().int(),
  price_assignments: z.number().int(),
  orders: z.number().int(),
})
export type CustomerUsage = z.infer<typeof customerUsageSchema>

// ---------------------------------------------------------------------------
// Contexto de cuenta del usuario (lo que devuelve `my_business_accounts`)
// ---------------------------------------------------------------------------

export const accountContextAddressSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  recipient: z.string().nullable().default(null),
  line1: z.string().min(1),
  line2: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  region: z.string().nullable().default(null),
  postal_code: z.string().nullable().default(null),
  country: z.string().length(2),
  is_shipping: z.boolean(),
  is_billing: z.boolean(),
  is_default_shipping: z.boolean(),
  is_default_billing: z.boolean(),
  verification: z.enum(ADDRESS_VERIFICATIONS),
})
export type AccountContextAddress = z.infer<typeof accountContextAddressSchema>

export const accountContextSchema = z.object({
  account_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  customer_name: z.string().min(1),
  customer_kind: z.enum(CUSTOMER_KINDS),
  role: z.enum(BUSINESS_ROLES),
  status: z.enum(MEMBER_STATUSES),
  spending_limit: moneyText.nullable().default(null),
  requires_approval: z.boolean(),
  approval_threshold: moneyText.nullable().default(null),
  purchase_order_required: z.boolean(),
  default_location_id: z.string().uuid().nullable().default(null),
  locations: z
    .array(
      z.object({
        id: z.string().uuid(),
        code: z.string().min(1),
        name: z.string().min(1),
        is_default: z.boolean(),
        address_id: z.string().uuid().nullable().default(null),
      }),
    )
    .default([]),
  addresses: z.array(accountContextAddressSchema).default([]),
})
export type AccountContext = z.infer<typeof accountContextSchema>

export const approvalDecisionSchema = z.object({
  business_account_id: z.string().uuid(),
  amount: moneyText,
  required: z.boolean(),
  reason: z.enum(['user_limit', 'rule', 'account_threshold']).nullable().default(null),
  rule_id: z.string().uuid().nullable().default(null),
  rule_name: z.string().nullable().default(null),
  rule_min_amount: moneyText.nullable().default(null),
  approver_role: z.enum(BUSINESS_ROLES).nullable().default(null),
  user_limit: moneyText.nullable().default(null),
  purchase_order_required: z.boolean().default(false),
})
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>

// ---------------------------------------------------------------------------
// Reglas de PRESENTACIÓN. Ninguna decide nada que mueva dinero o permisos.
// ---------------------------------------------------------------------------

/**
 * Código sugerido a partir del nombre. Solo es una sugerencia: el campo es
 * editable, porque el código con el que un cliente existe en el ERP no se
 * deduce de cómo se llama.
 */
export function toCustomerCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41)
}

/** Para qué sirve una dirección, en claves de i18n y en orden estable. */
export function addressUses(address: Pick<CustomerAddress, 'is_shipping' | 'is_billing'>): string[] {
  const uses: string[] = []
  if (address.is_shipping) uses.push('customers.address.shipping')
  if (address.is_billing) uses.push('customers.address.billing')
  return uses
}

/**
 * La dirección que un formulario debería preseleccionar: la marcada por
 * defecto para ese uso, y si no hay ninguna, la primera activa que sirva.
 * Devuelve `null` en vez de «la primera que haya»: elegir una dirección de
 * facturación entre las que solo son de envío es cómo se factura a un almacén.
 */
export function preferredAddress(
  addresses: readonly CustomerAddress[],
  use: 'shipping' | 'billing',
): CustomerAddress | null {
  const usable = addresses.filter(
    (address) => address.is_active && (use === 'shipping' ? address.is_shipping : address.is_billing),
  )
  const flagged = usable.find((address) =>
    use === 'shipping' ? address.is_default_shipping : address.is_default_billing,
  )
  return flagged ?? usable[0] ?? null
}

/** Una línea legible con lo que hay: nunca «, , » por los campos vacíos. */
export function formatAddress(
  address: Pick<CustomerAddress, 'line1' | 'line2' | 'city' | 'region' | 'postal_code' | 'country'>,
): string {
  return [address.line1, address.line2, address.city, address.region, address.postal_code, address.country]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

const codeField = z
  .string()
  .trim()
  .min(1, 'customers.error.code')
  .max(41, 'customers.error.code')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'customers.error.code')

const optionalEmail = z
  .string()
  .trim()
  .max(160, 'customers.error.email')
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'customers.error.email')

const amountField = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{1,12}(\.\d{1,2})?$/.test(value), 'customers.error.amount')

export const customerFormSchema = z.object({
  kind: z.enum(CUSTOMER_KINDS),
  code: codeField,
  name: z.string().trim().min(1, 'customers.error.name').max(200, 'customers.error.name'),
  legal_name: z.string().trim().max(200, 'customers.error.name'),
  tax_id: z.string().trim().max(40, 'customers.error.taxId'),
  email: optionalEmail,
  phone: z.string().trim().max(40, 'customers.error.phone'),
  segment_id: z.string().trim(),
  is_active: z.boolean(),
  notes: z.string().trim().max(2000, 'customers.error.notes'),
})
export type CustomerFormValues = z.infer<typeof customerFormSchema>

export function customerToForm(customer: Customer | null): CustomerFormValues {
  return {
    kind: customer?.kind ?? 'company',
    code: customer?.code ?? '',
    name: customer?.name ?? '',
    legal_name: customer?.legal_name ?? '',
    tax_id: customer?.tax_id ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    segment_id: customer?.segment_id ?? '',
    is_active: customer?.is_active ?? true,
    notes: customer?.notes ?? '',
  }
}

export const addressFormSchema = z
  .object({
    label: z.string().trim().min(1, 'customers.error.label').max(120, 'customers.error.label'),
    recipient: z.string().trim().max(120, 'customers.error.name'),
    phone: z.string().trim().max(40, 'customers.error.phone'),
    line1: z.string().trim().min(3, 'customers.error.line1').max(240, 'customers.error.line1'),
    line2: z.string().trim().max(240, 'customers.error.line1'),
    city: z.string().trim().max(120, 'customers.error.name'),
    region: z.string().trim().max(120, 'customers.error.name'),
    postal_code: z.string().trim().max(20, 'customers.error.postalCode'),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'customers.error.country'),
    is_shipping: z.boolean(),
    is_billing: z.boolean(),
    is_default_shipping: z.boolean(),
    is_default_billing: z.boolean(),
    verification: z.enum(ADDRESS_VERIFICATIONS),
    verification_source: z.string().trim().max(60, 'customers.error.name'),
    external_ref: z.string().trim().max(120, 'customers.error.name'),
    is_active: z.boolean(),
  })
  // Las tres reglas que la base también impone. Comprobarlas aquí evita que el
  // usuario descubra por un error de Postgres que marcó «por defecto» sobre un
  // uso que la dirección no tiene.
  .refine((values) => values.is_shipping || values.is_billing, {
    path: ['is_shipping'],
    message: 'customers.error.addressUse',
  })
  .refine((values) => !values.is_default_shipping || values.is_shipping, {
    path: ['is_default_shipping'],
    message: 'customers.error.defaultUse',
  })
  .refine((values) => !values.is_default_billing || values.is_billing, {
    path: ['is_default_billing'],
    message: 'customers.error.defaultUse',
  })
export type AddressFormValues = z.infer<typeof addressFormSchema>

export function addressToForm(address: CustomerAddress | null, fallbackCountry = 'PE'): AddressFormValues {
  return {
    label: address?.label ?? '',
    recipient: address?.recipient ?? '',
    phone: address?.phone ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    region: address?.region ?? '',
    postal_code: address?.postal_code ?? '',
    country: address?.country ?? fallbackCountry,
    is_shipping: address?.is_shipping ?? true,
    is_billing: address?.is_billing ?? false,
    is_default_shipping: address?.is_default_shipping ?? false,
    is_default_billing: address?.is_default_billing ?? false,
    verification: address?.verification ?? 'unverified',
    verification_source: address?.verification_source ?? '',
    external_ref: address?.external_ref ?? '',
    is_active: address?.is_active ?? true,
  }
}

export const contactFormSchema = z
  .object({
    name: z.string().trim().min(1, 'customers.error.name').max(120, 'customers.error.name'),
    email: optionalEmail,
    phone: z.string().trim().max(40, 'customers.error.phone'),
    role_title: z.string().trim().max(80, 'customers.error.name'),
    is_primary: z.boolean(),
    is_active: z.boolean(),
  })
  .refine((values) => values.email !== '' || values.phone !== '', {
    path: ['email'],
    message: 'customers.error.reachable',
  })
export type ContactFormValues = z.infer<typeof contactFormSchema>

export const externalIdFormSchema = z.object({
  system_code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,40}$/, 'customers.error.systemCode'),
  external_id: z
    .string()
    .trim()
    .min(1, 'customers.error.externalId')
    .max(120, 'customers.error.externalId'),
  notes: z.string().trim().max(240, 'customers.error.notes'),
})
export type ExternalIdFormValues = z.infer<typeof externalIdFormSchema>

export const accountFormSchema = z
  .object({
    code: codeField,
    name: z.string().trim().min(1, 'customers.error.name').max(200, 'customers.error.name'),
    is_active: z.boolean(),
    requires_approval: z.boolean(),
    approval_threshold: amountField,
    purchase_order_required: z.boolean(),
    notes: z.string().trim().max(2000, 'customers.error.notes'),
  })
  // La base lo rechaza igual: un umbral sin control encendido es un número que
  // no decide nada y que alguien leerá como si decidiera.
  .refine((values) => values.requires_approval || values.approval_threshold === '', {
    path: ['approval_threshold'],
    message: 'customers.error.thresholdNeedsControl',
  })
export type AccountFormValues = z.infer<typeof accountFormSchema>

export function accountToForm(account: BusinessAccount | null, customerName = ''): AccountFormValues {
  return {
    code: account?.code ?? '',
    name: account?.name ?? customerName,
    is_active: account?.is_active ?? true,
    requires_approval: account?.requires_approval ?? false,
    approval_threshold: account?.approval_threshold ?? '',
    purchase_order_required: account?.purchase_order_required ?? false,
    notes: account?.notes ?? '',
  }
}

export const locationFormSchema = z.object({
  code: codeField,
  name: z.string().trim().min(1, 'customers.error.name').max(160, 'customers.error.name'),
  address_id: z.string().trim(),
  is_default: z.boolean(),
  is_active: z.boolean(),
})
export type LocationFormValues = z.infer<typeof locationFormSchema>

export const accountUserFormSchema = z.object({
  /**
   * Se conserva por las filas YA vinculadas —editarlas no reabre el vínculo—
   * pero el alta ya no lo pide: se dejó de teclear.
   *
   * Era el `sub` del hub, y el hub no está conectado. La ayuda decía «pega el
   * identificador que emite el hub» y no había de dónde sacarlo, así que la
   * pantalla se abría y no se podía usar. Ahora se vincula por CORREO y lo
   * resuelve el servidor en `add_business_account_user`, que es lo que la
   * propia pantalla ya prometía: «el vínculo lo decide el servidor».
   */
  user_id: z.string().trim(),
  email: z
    .string()
    .trim()
    .min(1, 'customers.error.email')
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'customers.error.email')
    // Contrato §13: `@ebim.pe` nunca es actor de negocio de un tenant. La base
    // lo rechaza con un CHECK; decirlo aquí evita un error críptico.
    .refine((value) => !value.toLowerCase().includes('@ebim.pe'), 'customers.error.suiteEmail'),
  role: z.enum(BUSINESS_ROLES),
  spending_limit: amountField,
  status: z.enum(MEMBER_STATUSES),
  default_location_id: z.string().trim(),
})
export type AccountUserFormValues = z.infer<typeof accountUserFormSchema>

export const approvalRuleFormSchema = z.object({
  name: z.string().trim().min(1, 'customers.error.name').max(120, 'customers.error.name'),
  min_amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'customers.error.amount'),
  // El `: boolean` no es decorativo: sin él TypeScript infiere un predicado de
  // tipo y el valor del formulario deja de admitir el rol que trae una fila ya
  // guardada. La regla la impone además un CHECK en la base.
  approver_role: z
    .enum(BUSINESS_ROLES)
    .refine((role): boolean => role !== 'viewer', 'customers.error.approver'),
  is_active: z.boolean(),
})
export type ApprovalRuleFormValues = z.infer<typeof approvalRuleFormSchema>
