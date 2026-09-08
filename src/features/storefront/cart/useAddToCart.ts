import { useCallback, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { PublicProduct, PublicVariant } from '../types'
import { useCart } from './cart-context'

/**
 * Añadir al carrito, con lo que hace falta alrededor: espera y aviso.
 *
 * ## Por qué hay un hook y no cuatro `onClick`
 *
 * Los cuatro sitios desde los que se añade —la tarjeta de la rejilla, la banda
 * de ofertas, la vista rápida y la ficha— necesitan exactamente lo mismo desde
 * que añadir pregunta al servidor: bloquear el botón mientras se pregunta y
 * decir qué pasó. Cuatro copias de eso son cuatro sitios donde el mensaje puede
 * acabar siendo distinto.
 *
 * ## El panel ya no se abre
 *
 * Antes, añadir abría el cajón del carrito. Era la única confirmación que había,
 * y costaba cara: interrumpe justo a quien está comprando varias cosas, que es
 * el que más vale, y le obliga a cerrarlo para seguir. Ahora la confirmación es
 * un aviso efímero y el contador de la cabecera, que ya sube solo. Quien quiera
 * ver el carrito lo abre; quien esté llenándolo, sigue.
 */
export function useAddToCart() {
  const { t } = useI18n()
  const { add } = useCart()
  const { notify } = useFeedback()
  const [pending, setPending] = useState(false)

  const agregar = useCallback(
    async (product: PublicProduct, quantity = 1, variant: PublicVariant | null = null) => {
      setPending(true)
      try {
        const ok = await add(product, quantity, variant)
        // El «no» del servidor no es un error: es una respuesta. Va en tono de
        // aviso y dice qué hacer, no qué pasó.
        notify(t(ok ? 'store.cart.added' : 'store.cart.notEnough'), ok ? 'success' : 'warning')
        return ok
      } finally {
        setPending(false)
      }
    },
    [add, notify, t],
  )

  return { agregar, pending }
}
