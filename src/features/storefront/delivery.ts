import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { DELIVERY_OPTIONS_PUBLIC_RPC, PUBLIC_DELIVERY_METHODS_VIEW } from '@/shared/lib/db-schema'
import { moneyText } from '@/shared/lib/money'
import { tryGetStorefrontRpcClient } from '@/shared/lib/supabase'
import { storefrontClient } from './api'
import type { Cart } from './cart/cart'
import { toOrderItems } from './cart/cart'

/**
 * Las opciones de entrega de la vitrina (P12-SaaS).
 *
 * Lo importante de este archivo es lo que NO hace: no calcula un precio de
 * envío, no conoce ninguna tarifa y no sabe qué zonas hay. Manda la dirección y
 * lo que hay en el carrito, y recibe una lista con el importe ya resuelto.
 *
 * No es una elección de estilo: `delivery_rates` no tiene GRANT de SELECT para
 * `anon`, así que el navegador **no puede** leer la tarifa aunque quiera, y el
 * subtotal con el que se evalúa el umbral de envío gratis lo recalcula la misma
 * función del servidor. Si el subtotal viajara en la petición, el envío gratis
 * lo decidiría el comprador.
 *
 * Que una opción venga como `available: false` con su motivo —y no filtrada— es
 * deliberado: «a tu distrito no llegamos con express, pero sí con estándar» es
 * la mitad de la información útil, y esconderla deja al comprador sin saber por
 * qué su opción preferida no aparece.
 */

export const pickupPointSchema = z.object({
  pickup_point_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.record(z.unknown()).default({}),
  contact_phone: z.string().nullable().optional(),
  /** Distrito de la tienda (2026-11-15), para decir «en tu distrito». */
  district: z.string().nullable().optional(),
  /** Cercanía al comprador según lo que escribió. Ordena la lista el servidor. */
  proximity: z.enum(['district', 'city', 'region', 'other']).optional(),
  /**
   * Si ESTA tienda tiene el carrito: `unknown` = sin almacén propio. Elegir una
   * `unavailable` lo rechaza el servidor (`PUNTO_SIN_STOCK`).
   */
  stock: z
    .object({
      state: z.enum(['available', 'unavailable', 'unknown']),
      missing: z.array(z.string()).default([]),
    })
    .optional(),
})
export type StorePickupPoint = z.infer<typeof pickupPointSchema>

export const deliveryOptionSchema = z.object({
  delivery_method_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  strategy: z.enum(['ship', 'pickup', 'local_delivery', 'digital']),
  available: z.boolean(),
  /** Código de dominio, no texto del servidor: la pantalla lo traduce. */
  reason: z.string().nullable(),
  currency: z.string().length(3),
  /** `null` cuando la opción no está disponible: no hay importe que enseñar. */
  amount: moneyText.nullable(),
  free: z.boolean().default(false),
  promised_from: z.string().nullable(),
  promised_to: z.string().nullable(),
  requires_window: z.boolean().default(false),
  pickup_points: z.array(pickupPointSchema).default([]),
})
export type DeliveryOption = z.infer<typeof deliveryOptionSchema>

export const deliveryQuoteSchema = z.object({
  currency: z.string().length(3),
  zone: z.object({ code: z.string(), name: z.string() }).nullable(),
  options: z.array(deliveryOptionSchema).default([]),
})
export type DeliveryQuote = z.infer<typeof deliveryQuoteSchema>

export interface DeliveryAddress {
  address: string
  /** Solo para ordenar las tiendas de recojo por cercanía. */
  district?: string
  city?: string
  region?: string
  postal_code?: string
  country?: string
}

/**
 * Con el cliente que lleva la SESIÓN, como la cotización del carrito (P19).
 *
 * Esta función también cotiza por dentro —el umbral de envío gratis se decide
 * sobre el subtotal—, así que pedirla anónima daría un umbral calculado con un
 * subtotal que el comprador B2B no va a pagar: envío gratis que no llega, o al
 * revés. Las dos cotizaciones tienen que mirar al mismo comprador.
 */
export async function fetchDeliveryOptions(input: {
  storeSlug: string
  address: DeliveryAddress
  cart: Cart
}): Promise<DeliveryQuote> {
  const supabase = tryGetStorefrontRpcClient()
  if (!supabase) throw new Error('DELIVERY_QUOTE_FAILED')

  const { data, error } = await supabase.rpc(DELIVERY_OPTIONS_PUBLIC_RPC, {
    p_store_slug: input.storeSlug,
    p_address: input.address,
    p_items: toOrderItems(input.cart),
  })
  // El texto del servidor no llega a la pantalla: el estado de la consulta es
  // lo que decide qué se pinta, y aquí solo se corta la cadena.
  if (error) throw new Error('DELIVERY_QUOTE_FAILED')
  return deliveryQuoteSchema.parse(data ?? {})
}

export const deliveryOptionsKey = (
  storeSlug: string,
  address: DeliveryAddress,
  fingerprint: string,
) => ['storefront', 'delivery', storeSlug, address, fingerprint] as const

/**
 * Cotiza la entrega cuando ya hay algo que cotizar.
 *
 * Se pide solo con dirección escrita: preguntar con el campo vacío devolvería
 * «fuera de cobertura» para todo y el comprador leería que no le llega nada
 * antes de haber escrito su calle.
 */
export function useDeliveryOptions(input: {
  storeSlug: string
  address: DeliveryAddress
  cart: Cart
  enabled: boolean
  /**
   * Recojo en tienda: se cotiza SIN calle (la dirección que importa es la de
   * la tienda); el distrito, si lo hay, solo ordena la lista.
   */
  withoutAddress?: boolean
}) {
  const fingerprint = input.cart.lines
    .map((line) => `${line.product_id}:${line.variant_id ?? ''}:${line.quantity}`)
    .sort()
    .join('|')

  return useQuery({
    queryKey: deliveryOptionsKey(input.storeSlug, input.address, fingerprint),
    queryFn: () =>
      fetchDeliveryOptions({
        storeSlug: input.storeSlug,
        address: input.address,
        cart: input.cart,
      }),
    enabled:
      input.enabled &&
      (input.withoutAddress === true || input.address.address.trim().length >= 3) &&
      fingerprint !== '',
    retry: false,
  })
}

// ---------------------------------------------------------------------------
// Los métodos de entrega de la tienda, sin cotizar (sin dirección ni carrito).
// Para saber de entrada si la tienda ofrece recojo y pintar «Envío a domicilio
// | Recojo en tienda» antes de que el comprador escriba nada.
// ---------------------------------------------------------------------------
export const storeDeliveryMethodSchema = z.object({
  delivery_method_id: z.string().uuid(),
  display_name: z.string().min(1),
  description: z.string().nullable().default(null),
  strategy: z.string(),
  lead_time_min_days: z.number().int().nullable().default(null),
  lead_time_max_days: z.number().int().nullable().default(null),
})
export type StoreDeliveryMethod = z.infer<typeof storeDeliveryMethodSchema>

export function useStoreDeliveryMethods(storeId: string) {
  return useQuery({
    queryKey: ['storefront', 'delivery-methods', storeId] as const,
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: storeId !== '',
    queryFn: async (): Promise<StoreDeliveryMethod[]> => {
      const { data, error } = await storefrontClient()
        .from(PUBLIC_DELIVERY_METHODS_VIEW)
        .select('delivery_method_id, display_name, description, strategy, lead_time_min_days, lead_time_max_days')
        .eq('store_id', storeId)
        .order('position', { ascending: true })
      if (error) throw new Error('DELIVERY_METHODS_FAILED')
      return z.array(storeDeliveryMethodSchema).parse(data ?? [])
    },
  })
}
