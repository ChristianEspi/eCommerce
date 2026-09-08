import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { DELIVERY_OPTIONS_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { moneyText } from '@/shared/lib/money'
import { tryGetStorefrontRpcClient } from '@/shared/lib/supabase'
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
    enabled: input.enabled && input.address.address.trim().length >= 3 && fingerprint !== '',
    retry: false,
  })
}
