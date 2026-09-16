import { useEffect, useState } from 'react'
import { defaultVariant, type PublicVariant } from './types'

/**
 * La variante elegida, compartida por la ficha y la vista rápida.
 *
 * Llega PRESELECCIONADA: la marcada por defecto o, si esa no tiene stock, la
 * primera que sí. Con botones a la vista la elección está delante del botón de
 * compra, marcada y con su precio al lado, que es lo que un desplegable cerrado
 * no enseñaba. Si cambian las variantes (otro producto en la vista rápida), la
 * elección anterior se descarta en vez de quedarse apuntando a nada.
 */
export function useVariantChoice(variants: readonly PublicVariant[], enabled: boolean) {
  const [variantId, setVariantId] = useState('')

  useEffect(() => {
    if (!enabled || variants.length === 0) return
    setVariantId((current) =>
      current && variants.some((variant) => variant.variant_id === current)
        ? current
        : (defaultVariant(variants)?.variant_id ?? ''),
    )
  }, [enabled, variants])

  const selected = variants.find((variant) => variant.variant_id === variantId) ?? null
  return { selected, select: setVariantId }
}
