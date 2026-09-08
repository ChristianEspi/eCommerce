import { createContext, useContext } from 'react'
import type { PublicProduct, PublicVariant } from '../types'
import type { Cart } from './cart'

/**
 * Contexto del carrito, separado del provider a propósito: un archivo que
 * exporta a la vez un componente y un valor rompe el Fast Refresh de Vite
 * (misma razón que en `feedback-context.ts`).
 */
export interface CartApi {
  cart: Cart
  /** Unidades totales, para el contador de la cabecera. */
  count: number
  /** Subtotal informativo como texto decimal. El de cobro lo calcula la base. */
  subtotal: string
  currency: string
  isOpen: boolean
  /**
   * Secreto del carrito de SERVIDOR, cuando existe (P07-SaaS). Es lo que ata la
   * compra a un carrito concreto: sin él el checkout funciona igual, pero el
   * carrito no se marca como convertido y no hay snapshot con el que detectar
   * un cambio de precio.
   *
   * `null` mientras no se haya podido sincronizar. La vitrina NO se bloquea por
   * eso: un comprador con el almacenamiento lleno o una red que falló sigue
   * comprando desde `localStorage`.
   */
  cartToken: string | null
  /**
   * `true` cuando ya se intentó reconciliar con el servidor —con éxito o sin
   * él—. Lo usa el checkout para no salir corriendo con un carrito que todavía
   * puede cambiar por una fusión.
   */
  synced: boolean
  /**
   * `variant` es opcional y `null` para el producto simple. La identidad de una
   * línea es producto MÁS variante desde P03: sin ella, la talla M y la L
   * acabarían en la misma línea.
   *
   * Devuelve una promesa porque desde P19 PREGUNTA antes de añadir: la vitrina
   * solo sabe «hay» o «no hay», nunca cuántos, así que sin preguntar se podían
   * meter diez unidades de algo que tenía tres y no enterarse hasta el último
   * paso del checkout. Resuelve a `false` cuando el servidor dice que no.
   */
  add: (
    product: PublicProduct,
    quantity?: number,
    variant?: PublicVariant | null,
  ) => Promise<boolean>
  setQuantity: (productId: string, quantity: number, variantId?: string | null) => void
  remove: (productId: string, variantId?: string | null) => void
  clear: () => void
  /**
   * Suelta el carrito de SERVIDOR sin tocar las lineas de pantalla.
   *
   * Lo llama el checkout cuando el servidor dice que ese carrito ya no existe:
   * el token esta en `localStorage` y solo quien lo guarda puede tirarlo. Las
   * lineas se quedan — son la compra, y el token solo era el ancla.
   */
  forgetServerCart: () => void
  openCart: () => void
  closeCart: () => void
}

export const CartContext = createContext<CartApi | null>(null)

export function useCart(): CartApi {
  const value = useContext(CartContext)
  if (!value) throw new Error('useCart requiere <CartProvider> (vive en el layout de la vitrina)')
  return value
}
