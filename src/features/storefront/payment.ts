import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { PUBLIC_PAYMENT_METHODS_VIEW } from '@/shared/lib/db-schema'
import { storefrontClient } from './api'

/**
 * Los medios de pago de la vitrina (P09-SaaS).
 *
 * ## Qué se lee, y por qué esa vista y no la tabla
 *
 * `public_payment_methods` es una vista `security_invoker` sobre
 * `payment_methods` que expone SIETE columnas y ni una más: id, tienda, código,
 * familia, nombre, orden e instrucciones. Lo que deliberadamente NO sale de ahí
 * es el proveedor, su configuración y el modo de captura — es decir, todo lo que
 * convierte un medio de pago en una credencial. La tabla existe, pero leerla
 * desde el navegador sería pedirle al comprador que tenga delante la pasarela.
 *
 * ## Con qué cliente se pregunta, y por qué NO con la sesión
 *
 * Con el cliente ANÓNIMO de la vitrina, siempre, aunque el comprador tenga
 * sesión abierta. La policy de `anon` sobre `payment_methods` es
 * `is_active AND tienda activa`; la de `authenticated` es `ebim.can_access(...)`,
 * que es pertenencia al BACKOFFICE del tenant. Un comprador B2B con sesión no es
 * miembro del backoffice de la droguería que le vende, así que preguntar con su
 * sesión devolvería **cero medios justo después de iniciar sesión** — el checkout
 * se quedaría sin formas de pago exactamente para el cliente que más paga.
 *
 * Es la misma elección que ya hace `delivery.ts`, y por la misma razón.
 *
 * ## Lo que este archivo no hace
 *
 * No decide si un medio es aplicable a este carrito, no calcula recargos y no
 * valida nada. Que el código elegido corresponda a un medio vivo de esa tienda
 * lo decide `payment_intent_open` en el servidor, que es quien tiene la fila y
 * el tenant delante. Comprobarlo aquí sería una segunda autoridad sobre el mismo
 * dato, y la del navegador siempre acaba desactualizada.
 */

export const paymentMethodSchema = z.object({
  payment_method_id: z.string().uuid(),
  code: z.string().min(1),
  /** Familia del medio. Decide el icono y el texto de ayuda, nunca el precio. */
  kind: z.string().min(1),
  display_name: z.string().min(1),
  position: z.number().int().default(0),
  /** Qué hacer después de pedir: número de Yape, cuenta bancaria, etc. */
  instructions: z.string().nullable().default(null),
})
export type StorePaymentMethod = z.infer<typeof paymentMethodSchema>

export const paymentMethodsKey = (storeId: string) =>
  ['storefront', 'payment-methods', storeId] as const

export async function fetchPaymentMethods(storeId: string): Promise<StorePaymentMethod[]> {
  const { data, error } = await storefrontClient()
    .from(PUBLIC_PAYMENT_METHODS_VIEW)
    .select('payment_method_id, code, kind, display_name, position, instructions')
    .eq('store_id', storeId)
    .order('position', { ascending: true })

  // El texto del servidor no llega a la pantalla: aquí solo se corta la cadena y
  // el estado de la consulta decide qué se pinta.
  if (error) throw new Error('PAYMENT_METHODS_FAILED')
  return z.array(paymentMethodSchema).parse(data ?? [])
}

/**
 * Los medios de pago de una tienda.
 *
 * `staleTime` largo a propósito: un comercio no cambia sus formas de cobro entre
 * dos pasos del checkout, y refrescarlo mientras alguien rellena el formulario
 * solo abre la puerta a que la opción elegida desaparezca bajo el cursor.
 *
 * `retry: false` como el resto de la vitrina: si la tienda no tiene medios
 * configurados, insistir cuatro veces solo retrasa el mensaje de que no los hay.
 */
export function usePaymentMethods(storeId: string | null | undefined) {
  return useQuery({
    queryKey: paymentMethodsKey(storeId ?? ''),
    queryFn: () => fetchPaymentMethods(storeId as string),
    enabled: Boolean(storeId),
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}

/**
 * El medio preseleccionado, o ninguno.
 *
 * **Solo se preselecciona cuando la elección es inequívoca**, es decir, cuando
 * hay exactamente uno. Con dos o más, dejar uno marcado hace que el comprador
 * pague con el primero de la lista sin haberlo elegido —y en la práctica,
 * «pagar con lo que salía puesto» es una reclamación, no una venta—.
 */
export function defaultPaymentCode(methods: readonly StorePaymentMethod[]): string {
  return methods.length === 1 ? (methods[0]?.code ?? '') : ''
}
