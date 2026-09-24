import type { MessageKey } from '@/shared/i18n/messages'

/**
 * El vocabulario del contrato de tema, dicho en palabras (V3 · P12).
 *
 * Vive aparte porque lo usan DOS pantallas —los ajustes avanzados y el panel de
 * presentación por sección— y porque un archivo que exporta componentes y
 * constantes rompe la recarga rápida en desarrollo. Dos mapas para el mismo
 * vocabulario acabarían diciendo «Mosaico» en una pantalla y «mosaic» en la
 * otra.
 */
/** Valor del desplegable que significa «lo que diga el tema». */
export const HEREDAR = ''

/** Cada valor de cada lista tiene su texto. Se nombran todos, sin plantillas. */
export const ETIQUETA_VALOR: Record<string, MessageKey> = {
  standard: 'settings.design.value.standard',
  compact: 'settings.design.value.compact',
  product: 'settings.design.value.product',
  statement: 'settings.design.value.statement',
  comfortable: 'settings.design.value.comfortable',
  tiles: 'settings.design.value.tiles',
  pills: 'settings.design.value.pills',
  lg: 'settings.design.value.lg',
  xl: 'settings.design.value.xl',
  square: 'settings.design.value.square',
  portrait: 'settings.design.value.portrait',
  landscape: 'settings.design.value.landscape',
  spacious: 'settings.design.value.spacious',
  // Storefront V3 · P02
  brand: 'settings.design.value.brand',
  editorial: 'settings.design.value.editorial',
  mosaic: 'settings.design.value.mosaic',
  cover: 'settings.design.value.cover',
  contain: 'settings.design.value.contain',
  // Storefront V3 · P12 · Los valores de la presentación por sección.
  rail: 'settings.design.value.rail',
  grid: 'settings.design.value.grid',
  spotlight: 'settings.design.value.spotlight',
  cards: 'settings.design.value.cards',
  logos: 'settings.design.value.logos',
  band: 'settings.design.value.band',
  split: 'settings.design.value.split',
  plain: 'settings.design.value.plain',
  soft: 'settings.design.value.soft',
  contrast: 'settings.design.value.contrast',
  contained: 'settings.design.value.contained',
  bleed: 'settings.design.value.bleed',
  fixed: 'settings.design.value.fixed',
}
