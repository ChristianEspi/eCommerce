import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchPublicAvailability } from '@/features/inventory/api'
import type { PublicProduct, PublicVariant } from '../types'
import {
  addToCart,
  applyServerLines,
  cartCount,
  cartCurrency,
  cartSubtotal,
  clearStoredCart,
  emptyCart,
  readCart,
  removeFromCart,
  setLineQuantity,
  writeCart,
  CartStoreMismatchError,
  CartVariantMismatchError,
} from './cart'
import { CartContext, type CartApi } from './cart-context'
import {
  ServerCartError,
  clearCartToken,
  openServerCart,
  readCartToken,
  replaceServerCartLines,
  writeCartToken,
} from './serverCart'
import { CART_GONE_CODE } from '../checkout'

/**
 * Estado del carrito de UNA tienda.
 *
 * El `storeId` no lo elige el carrito: viene del layout, que lo obtuvo de
 * `public_stores` resolviendo el slug de la URL. Si el comprador salta a otra
 * tienda, el provider se remonta con otro `storeId` y carga el carrito de ESA
 * tienda: los dos carritos coexisten en `localStorage` sin mezclarse nunca.
 *
 * ## La sincronización con el servidor (P07-SaaS)
 *
 * Dos efectos, y el orden entre ellos es la decisión:
 *
 *  1. **Reconciliar UNA vez** por tienda y por estado de sesión, y solo cuando
 *     hay algo que reconciliar —sesión, token o líneas locales—: `cart_open`
 *     CREA la fila del invitado que llega sin token, así que llamarla en cada
 *     visita anónima era una fila por visita (P16-SaaS). Al abrir, se
 *     presenta el token del invitado; si hay sesión, el servidor FUSIONA ese
 *     carrito en el del usuario y devuelve el resultado, que es lo que pasa a
 *     verse. Iniciar sesión con dos dispositivos abiertos deja de perder el
 *     carrito de uno de los dos.
 *  2. **Empujar** lo local al servidor cuando cambia, con un retardo. No al
 *     revés: mientras el comprador está tocando el carrito, la verdad es lo que
 *     tiene delante, y una respuesta del servidor que llegara tarde le movería
 *     las cantidades bajo el dedo.
 *
 * **Todo esto es de mejor esfuerzo.** Ni una sola de estas llamadas puede
 * impedir comprar: si fallan, el comprador sigue con su `localStorage` y el
 * checkout sigue funcionando sin `cart_token` —lo único que se pierde es el
 * aviso de cambio de precio y la marca de carrito convertido—. Un carrito que
 * deja de funcionar porque una red falló es peor que un carrito sin servidor.
 *
 * ## Quién gana al reconciliar
 *
 * Sin sesión, **lo local**: es donde el invitado ha estado comprando ahora
 * mismo, y pisarlo con lo que el servidor recordaba de ayer sería quitarle de
 * la vista lo que acaba de añadir. Con sesión, **lo del servidor**, porque ya
 * incluye lo local (se acaba de fusionar) más lo del otro dispositivo.
 */
export function CartProvider({
  storeId,
  storeSlug,
  currency,
  authenticated = false,
  children,
}: {
  storeId: string
  /** Slug público de la URL. Es como el servidor resuelve la tienda. */
  storeSlug: string
  /** Moneda de la tienda: la usa el carrito vacío, que aún no tiene líneas. */
  currency: string
  /** Hay sesión de comprador. Decide qué cliente habla con la base y quién gana. */
  authenticated?: boolean
  children: ReactNode
}) {
  const [cart, setCart] = useState(() => readCart(storeId))
  const [isOpen, setOpen] = useState(false)
  const [cartToken, setCartToken] = useState<string | null>(() => readCartToken(storeId))
  const [synced, setSynced] = useState(false)

  // Cambió la tienda: se recarga su carrito. Sin esto, el carrito de la tienda
  // anterior seguiría en pantalla y sería justo la mezcla que hay que evitar.
  useEffect(() => {
    setCart(readCart(storeId))
    setCartToken(readCartToken(storeId))
    setSynced(false)
    setOpen(false)
  }, [storeId])

  useEffect(() => {
    if (cart.store_id === storeId) writeCart(cart)
  }, [cart, storeId])

  // --- 1 · Reconciliar (y fusionar, si se acaba de iniciar sesión) ----------
  /**
   * Cuándo hay algo que reconciliar (P16-SaaS).
   *
   * `cart_open` no solo lee: cuando el invitado llega sin token, CREA la fila.
   * Llamarla al montar el provider —que envuelve el layout entero, o sea todas
   * las páginas de la vitrina— era una fila de `carts` por VISITA anónima, y
   * las filas no se recogen solas. Eso contradice de frente lo que este archivo
   * y la migración de P07 dicen que hacen: «nadie crea una fila por visita; la
   * fila nace al iniciar sesión o al empezar a comprar».
   *
   * Las tres condiciones son exactamente los casos en los que el servidor tiene
   * algo que aportar:
   *
   *  · con sesión — hay que fusionar y traer lo del otro dispositivo;
   *  · con token — ya existe una fila suya que reconciliar;
   *  · con líneas locales — hay algo que guardar, así que ya hace falta el ancla.
   *
   * Sin ninguna de las tres, la llamada devolvía un carrito vacío que el propio
   * `setCart` de abajo descartaba (`server.lines.length === 0`): se pagaba una
   * fila permanente por una respuesta que no se usaba. Quien añade su primera
   * línea entra en el tercer caso, el efecto se vuelve a evaluar y la fila nace
   * entonces — que es el momento que el diseño siempre dijo.
   */
  const hasLocalLines = cart.store_id === storeId && cart.lines.length > 0
  const needsServerCart = authenticated || cartToken !== null || hasLocalLines

  const reconciled = useRef<string | null>(null)
  useEffect(() => {
    if (!needsServerCart) return
    const scope = `${storeId}|${authenticated}`
    if (reconciled.current === scope) return
    reconciled.current = scope

    let cancelled = false
    /**
     * Un token que ya no nombra ningun carrito se TIRA y se vuelve a abrir.
     *
     * El token vive en `localStorage` y sobrevive a la fila que nombraba: el
     * carrito de invitado caduca por retencion, y un entorno de demostracion se
     * puede vaciar entero. Sin esto, el token muerto se queda para siempre y el
     * checkout falla con `CARRITO_NO_ENCONTRADO` en cada intento — la persona
     * no puede comprar hasta que alguien le dice que borre datos del sitio.
     */
    const openOrReopen = async () => {
      try {
        return await openServerCart({ storeSlug, token: readCartToken(storeId), authenticated })
      } catch (error) {
        if (!(error instanceof ServerCartError) || error.code !== CART_GONE_CODE) throw error
        clearCartToken(storeId)
        setCartToken(null)
        return openServerCart({ storeSlug, token: null, authenticated })
      }
    }

    openOrReopen()
      .then((server) => {
        if (cancelled) return
        if (server.token) {
          writeCartToken(storeId, server.token)
          setCartToken(server.token)
        }
        setCart((current) => {
          if (current.store_id !== storeId) return current
          // Invitado con carrito en la mano: manda lo suyo.
          if (!authenticated && current.lines.length > 0) return current
          if (server.lines.length === 0) return current
          return applyServerLines(current, server.lines, currency)
        })
        setSynced(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Queda dicho en consola y se sigue: el carrito local basta para comprar.
        console.error('[carrito] no se pudo sincronizar con el servidor', error)
        setSynced(true)
      })

    return () => {
      cancelled = true
    }
  }, [storeId, storeSlug, authenticated, currency, needsServerCart])

  // --- 2 · Empujar lo local, con retardo ------------------------------------
  useEffect(() => {
    if (!synced || !cartToken) return
    if (cart.store_id !== storeId) return

    // El retardo evita una llamada por pulsación en el selector de cantidad.
    const handle = setTimeout(() => {
      replaceServerCartLines({ storeSlug, token: cartToken, cart, authenticated }).catch(
        (error: unknown) => {
          console.error('[carrito] no se pudo guardar en el servidor', error)
        },
      )
    }, 600)

    return () => clearTimeout(handle)
  }, [cart, cartToken, synced, storeSlug, storeId, authenticated])

  /**
   * Añadir al carrito, PREGUNTANDO antes.
   *
   * ## Por qué hay que preguntar
   *
   * La vitrina sabe «hay» o «no hay» —`public_products.in_stock`— y nunca
   * cuántos, que es deliberado: publicar la existencia exacta se la regala a
   * cualquiera que mire la tienda. El precio de esa decisión era que se podían
   * meter diez unidades de algo que tenía tres y descubrirlo en el ÚLTIMO paso
   * del checkout, al apartar el stock, con los datos ya escritos.
   *
   * `availability_for_slug` resuelve las dos cosas a la vez: responde a la
   * pregunta que se le hace —«¿puedo llevar diez?»— sin decir cuántos quedan.
   *
   * ## Se pregunta por el TOTAL de la línea
   *
   * Tres en el carrito más una nueva son cuatro, y es el cuatro lo que hay que
   * validar. Preguntar solo por lo que se añade dejaría pasar exactamente el
   * caso que esto viene a impedir.
   *
   * ## Y si la pregunta falla, se añade igual
   *
   * Es una comprobación de cortesía, no la autoridad: quien decide es la reserva
   * de stock del checkout, con la fila bloqueada. Bloquear una venta porque una
   * consulta consultiva no contestó sería cambiar un mal final por uno peor.
   */
  const add = useCallback(
    async (
      product: PublicProduct,
      quantity = 1,
      variant: PublicVariant | null = null,
    ): Promise<boolean> => {
      const enCarrito =
        cart.lines.find(
          (line) =>
            line.product_id === product.product_id &&
            (line.variant_id ?? null) === (variant?.variant_id ?? null),
        )?.quantity ?? 0

      try {
        const [fila] = await fetchPublicAvailability({
          storeSlug,
          items: [
            {
              product_id: product.product_id,
              variant_id: variant?.variant_id ?? null,
              quantity: enCarrito + quantity,
            },
          ],
        })
        // `unknown` es «no lo sé» —un ERP que no contestó— y no «no hay».
        if (fila && !fila.unknown && !fila.in_stock) return false
      } catch (error) {
        console.error('[carrito] no se pudo comprobar la existencia', error)
      }

      setCart((current) => {
        try {
          return addToCart(current, product, quantity, variant)
        } catch (error) {
          // Producto de otra tienda o variante que no es de ese producto: se
          // ignora en vez de tumbar la vitrina, pero queda dicho en consola
          // porque significa que algo está mal arriba.
          if (error instanceof CartStoreMismatchError || error instanceof CartVariantMismatchError) {
            console.error('[carrito] línea descartada', error)
            return current
          }
          throw error
        }
      })
      return true
    },
    [cart.lines, storeSlug],
  )

  const setQuantity = useCallback(
    (productId: string, quantity: number, variantId: string | null = null) => {
      setCart((current) => setLineQuantity(current, productId, quantity, variantId))
    },
    [],
  )

  const remove = useCallback((productId: string, variantId: string | null = null) => {
    setCart((current) => removeFromCart(current, productId, variantId))
  }, [])

  const clear = useCallback(() => {
    clearStoredCart(storeId)
    // El token también se retira: el carrito que ese secreto abría ya se
    // convirtió en pedido o se vació, y guardarlo solo serviría para reabrir
    // uno cerrado.
    clearCartToken(storeId)
    setCartToken(null)
    setCart(emptyCart(storeId))
    setOpen(false)
  }, [storeId])

  const forgetServerCart = useCallback(() => {
    clearCartToken(storeId)
    setCartToken(null)
  }, [storeId])

  const value = useMemo<CartApi>(
    () => ({
      cart,
      count: cartCount(cart),
      subtotal: cartSubtotal(cart),
      currency: cartCurrency(cart, currency),
      isOpen,
      cartToken,
      forgetServerCart,
      synced,
      add,
      setQuantity,
      remove,
      clear,
      openCart: () => setOpen(true),
      closeCart: () => setOpen(false),
    }),
    [cart, currency, isOpen, cartToken, synced, add, setQuantity, remove, clear, forgetServerCart],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
