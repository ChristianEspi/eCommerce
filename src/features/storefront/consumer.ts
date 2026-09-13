import type { Session } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  DELETE_MY_CONSUMER_ADDRESS_RPC,
  MY_CHECKOUT_PROFILE_RPC,
  MY_CONSUMER_ADDRESSES_RPC,
  MY_CONSUMER_ORDERS_RPC,
  MY_CONSUMER_ORDER_DETAIL_RPC,
  SAVE_MY_CONSUMER_ADDRESS_RPC,
  SET_DEFAULT_MY_CONSUMER_ADDRESS_RPC,
} from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'
import type { MyOrder, MyOrderDetail } from './portal'

/**
 * La cuenta del consumidor registrado: lo que es SUYO en esta tienda.
 *
 * ## De dónde sale cada cosa
 *
 *  · Pedidos y direcciones: tres funciones que reciben el slug público de la
 *    tienda y nada más. El usuario sale del JWT; los pedidos, del vínculo que
 *    escribe el checkout cuando se compra con sesión (`order_buyers`). Un
 *    pedido de invitado con el mismo correo NO aparece: un correo no prueba
 *    quién compró.
 *  · Nombre y teléfono: los metadatos de la cuenta de Auth, que edita la propia
 *    persona. Nada del sistema los usa para autorizar —la autorización sale de
 *    `app_metadata`, que solo escribe el servidor— y por eso son los dos únicos
 *    campos que esta pantalla deja cambiar. El correo no se toca aquí.
 *
 * ## Los importes, como texto
 *
 * Igual que en el portal B2B: se formatean para pintar y no se operan.
 */

async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc(name, params)
  if (error) throw error
  return data
}

/**
 * ¿La base todavía no tiene esta función?
 *
 * Pasa en un proyecto donde el front ya está desplegado y la migración todavía
 * no. No es un fallo del comprador y reintentar no lo arregla, así que la
 * pantalla lo dice como «no está disponible» en vez de «algo salió mal».
 */
export function isMissingFunction(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return code === 'PGRST202' || (typeof message === 'string' && /could not find the function/i.test(message))
}

const orderSchema = z.object({
  order_id: z.string(),
  order_number: z.string(),
  placed_at: z.string(),
  status: z.string(),
  payment_status: z.string(),
  fulfillment_status: z.string().nullable(),
  approval_status: z.string().nullable(),
  currency: z.string(),
  grand_total: z.string(),
  item_count: z.number(),
})
export type ConsumerOrder = z.infer<typeof orderSchema>

const addressSchema = z.object({
  address: z.string(),
  reference: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
})

/**
 * Una dirección de la LIBRETA (N06): la misma forma más su nombre, quién la
 * recibe, su teléfono y si es la predeterminada. `id` es de la propia persona.
 */
const bookAddressSchema = addressSchema.extend({
  id: z.string(),
  label: z.string(),
  recipient: z.string().optional(),
  phone: z.string().optional(),
  is_default: z.boolean(),
})
export type BookAddress = z.infer<typeof bookAddressSchema>

/** Lo que se propone al comprar: de la libreta (con nombre) o de un pedido anterior. */
export type SavedAddress = z.infer<typeof addressSchema> & {
  readonly id?: string
  readonly label?: string
  readonly is_default?: boolean
}

const detailSchema = z.object({
  order_id: z.string(),
  order_number: z.string(),
  status: z.string(),
  payment_status: z.string(),
  fulfillment_status: z.string().nullable(),
  placed_at: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  discount_total: z.string(),
  tax_total: z.string(),
  shipping_total: z.string(),
  grand_total: z.string(),
  shipping_address: z.record(z.unknown()).nullable().optional(),
  items: z.array(
    z.object({
      product_id: z.string().nullable(),
      variant_id: z.string().nullable(),
      name: z.string(),
      sku: z.string().nullable(),
      variant_label: z.string().nullable(),
      quantity: z.number(),
      unit_price: z.string(),
      total: z.string(),
    }),
  ),
  deliveries: z
    .array(z.object({ method_name: z.string().nullable(), state: z.string().nullable() }).passthrough())
    .optional(),
})

const profileSchema = z.object({
  contact: z.object({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  addresses: z.array(addressSchema),
})
export type CheckoutProfile = z.infer<typeof profileSchema>

/** Mis pedidos, con la forma que ya pinta la lista del portal. */
export async function fetchConsumerOrders(storeSlug: string): Promise<MyOrder[]> {
  const rows = orderSchema.array().parse(await rpc(MY_CONSUMER_ORDERS_RPC, { p_store_slug: storeSlug, p_limit: 50 }))
  return rows.map((row) => ({
    order_id: row.order_id,
    order_number: row.order_number,
    status: row.status,
    payment_status: row.payment_status,
    fulfillment_status: row.fulfillment_status,
    approval_status: row.approval_status,
    currency: row.currency,
    grand_total: row.grand_total,
    placed_at: row.placed_at,
    // Un consumidor compra para sí: no hay empresa que nombrar en la fila.
    account_name: '',
    my_role: 'buyer',
    can_decide: false,
  }))
}

export async function fetchConsumerOrderDetail(storeSlug: string, orderId: string): Promise<MyOrderDetail> {
  const detail = detailSchema.parse(
    await rpc(MY_CONSUMER_ORDER_DETAIL_RPC, { p_store_slug: storeSlug, p_order_id: orderId }),
  )
  return {
    ...detail,
    shipping_address: detail.shipping_address ?? null,
    deliveries: detail.deliveries ?? [],
  }
}

export async function fetchCheckoutProfile(storeSlug: string): Promise<CheckoutProfile> {
  return profileSchema.parse(await rpc(MY_CHECKOUT_PROFILE_RPC, { p_store_slug: storeSlug }))
}

export const consumerOrdersKey = (storeSlug: string) => ['storefront', 'consumer-orders', storeSlug] as const
export const consumerOrderDetailKey = (storeSlug: string, orderId: string) =>
  ['storefront', 'consumer-order', storeSlug, orderId] as const
export const checkoutProfileKey = (storeSlug: string) => ['storefront', 'checkout-profile', storeSlug] as const
export const addressBookKey = (storeSlug: string) => ['storefront', 'address-book', storeSlug] as const

// ---------------------------------------------------------------------------
// N06 · La libreta de direcciones del consumidor.
//
// Cuatro funciones de la base; ninguna recibe un usuario (sale del JWT) y la
// tienda va por su slug público. Lo que se manda es SOLO la dirección.
// ---------------------------------------------------------------------------

export interface AddressInput {
  readonly label: string
  readonly recipient?: string
  readonly phone?: string
  readonly address: string
  readonly reference?: string
  readonly city?: string
  readonly region?: string
  readonly postal_code?: string
  readonly country?: string
  readonly is_default?: boolean
}

export async function fetchAddressBook(storeSlug: string): Promise<BookAddress[]> {
  return bookAddressSchema.array().parse(await rpc(MY_CONSUMER_ADDRESSES_RPC, { p_store_slug: storeSlug }))
}

export async function saveAddress(storeSlug: string, input: AddressInput, addressId: string | null): Promise<BookAddress> {
  return bookAddressSchema.parse(
    await rpc(SAVE_MY_CONSUMER_ADDRESS_RPC, { p_store_slug: storeSlug, p_address: input, p_address_id: addressId }),
  )
}

export async function deleteAddress(storeSlug: string, addressId: string): Promise<void> {
  await rpc(DELETE_MY_CONSUMER_ADDRESS_RPC, { p_store_slug: storeSlug, p_address_id: addressId })
}

export async function setDefaultAddress(storeSlug: string, addressId: string): Promise<void> {
  await rpc(SET_DEFAULT_MY_CONSUMER_ADDRESS_RPC, { p_store_slug: storeSlug, p_address_id: addressId })
}

/** Misma dirección y ciudad, sin mayúsculas ni espacios de más: la regla con la que la base deduplica. */
export function sameAddress(a: SavedAddress, b: SavedAddress): boolean {
  const norm = (value: string | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return norm(a.address) === norm(b.address) && norm(a.city) === norm(b.city)
}

/** La libreta primero (predeterminada delante) y luego lo usado en pedidos que no esté ya guardado. */
export function mergeAddresses(book: readonly BookAddress[], history: readonly SavedAddress[]): SavedAddress[] {
  return [...book, ...history.filter((old) => !book.some((saved) => sameAddress(saved, old)))]
}

/** Los datos de la persona que la pantalla puede enseñar y editar. */
export interface ConsumerProfile {
  readonly email: string
  readonly fullName: string
  readonly phone: string
}

function metadataText(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function profileFromSession(session: Session | null): ConsumerProfile {
  const user = session?.user
  const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>
  return {
    email: user?.email ?? '',
    fullName: metadataText(metadata, 'full_name'),
    phone: metadataText(metadata, 'phone'),
  }
}

/** Cómo saludar: el nombre de pila si lo hay; si no, nada inventado. */
export function greetingName(profile: ConsumerProfile): string | null {
  const first = profile.fullName.split(/\s+/)[0]
  return first ? first : null
}

export function formatSavedAddress(address: SavedAddress): string {
  return [address.address, address.reference, address.city, address.region, address.postal_code, address.country]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')
}
