import type { CSSProperties } from 'react'

/**
 * El contrato de anchos de la vista previa (Storefront V2 · P11).
 *
 * ## Por qué esto vive aquí y no en el backoffice
 *
 * Porque lo que declara es el **comportamiento responsive de la vitrina**, y
 * tiene que cambiar el día que cambie el de los componentes. Si estas reglas
 * vivieran en la pantalla de configuración, el día que la rejilla del catálogo
 * mueva su punto de corte de 1200 a 1100 la vista previa seguiría enseñando
 * cuatro columnas donde la tienda enseña cinco, y nadie se enteraría: la vista
 * previa no falla, miente.
 *
 * ## El problema que resuelve
 *
 * Cambiar el ancho de una caja a 390 px **no hace que las media queries
 * reaccionen**. Una media query mide la VENTANA, no la caja. Así que la vista
 * previa «móvil» se pintaba dentro de una ventana de escritorio y todos los
 * componentes elegían sus valores de escritorio: el resultado era una tienda de
 * escritorio estrujada en 390 px, que es exactamente lo que no se quería ver.
 *
 * Y la vista previa lo empeoraba a mano: usaba `--sf-main-pad-md`,
 * `--sf-hero-title-md` y `--sf-grid-lg` **fijos**, así que ni siquiera al
 * estrujarse cambiaba de valores. El móvil enseñaba la portada de 52 px de
 * titular y las cuatro columnas del escritorio.
 *
 * ## La solución: el marco resuelve sus propios puntos de corte
 *
 * Cada marco declara un juego de variables `--sfp-*` («p» de *preview*) que
 * apuntan a la variante que le tocaría **por su ancho lógico**, no por el de la
 * ventana. Las piezas de la vista previa leen `--sfp-*` y no `--sf-*-md`, así
 * que tres marcos distintos en la misma pantalla resuelven tres juegos
 * distintos a la vez.
 *
 * No se duplica ni una medida: los `--sfp-*` **apuntan** a los `--sf-*` que ya
 * pone `themeCssVars` y `storefront.css`. Lo que aporta este módulo es la
 * ELECCIÓN, que es justo lo que la media query hacía y aquí no puede hacer.
 */

/** Los tres anchos de referencia, en píxeles lógicos. */
export const PREVIEW_VIEWPORTS = [
  { id: 'desktop', width: 1280 },
  { id: 'tablet', width: 768 },
  { id: 'mobile', width: 390 },
] as const satisfies ReadonlyArray<{ id: string; width: number }>

export type PreviewViewportId = (typeof PREVIEW_VIEWPORTS)[number]['id']

export function previewWidth(id: PreviewViewportId): number {
  return PREVIEW_VIEWPORTS.find((v) => v.id === id)?.width ?? 1280
}

/**
 * Los puntos de corte de MUI que la vitrina usa de verdad.
 *
 * `md` (900) es el que separa `{ xs: 'var(--sf-x)', md: 'var(--sf-x-md)' }`, que
 * es el patrón de toda la tienda. `sm` (600) y `lg` (1200) son los que reparten
 * las columnas de la rejilla del catálogo, que es el único sitio donde hay tres
 * escalones en vez de dos.
 *
 * Están escritos aquí y no importados de MUI a propósito: lo que importa no es
 * cuánto valen los puntos de corte del framework, sino cuáles USA la vitrina.
 */
const MD = 900
const SM = 600
const LG = 1200

/** En qué escalón cae un ancho. Lo que se ve en `data-preview-bp`. */
export type FrameBreakpoint = 'xs' | 'sm' | 'md' | 'lg'

export function frameBreakpoint(width: number): FrameBreakpoint {
  if (width >= LG) return 'lg'
  if (width >= MD) return 'md'
  if (width >= SM) return 'sm'
  return 'xs'
}

/**
 * Las columnas de la rejilla que le tocan a un ancho.
 *
 * El mismo reparto que `ProductGrid`: `xs` hasta 600, `sm` hasta 1200 y `lg` de
 * ahí en adelante. Devuelve el NOMBRE de la variable del tema, no un número: el
 * cuánto lo sigue poniendo el preset, y duplicarlo aquí sería tener dos sitios
 * donde dice cuántas columnas tiene `retail`.
 */
function columnasDe(width: number): string {
  if (width >= LG) return 'var(--sf-grid-lg, 4)'
  if (width >= SM) return 'var(--sf-grid-sm, 3)'
  return 'var(--sf-grid-xs, 2)'
}

/**
 * Las variables que resuelven el responsive DENTRO del marco.
 *
 * Cada una apunta a la variante que la tienda usaría a ese ancho. Se cuelgan del
 * propio marco, así que dos marcos hermanos no se pisan: el móvil resuelve sus
 * valores de móvil mientras el de al lado resuelve los de escritorio, en la
 * misma pantalla y sin un solo `@media`.
 */
export function frameCssVars(width: number): CSSProperties {
  const grande = width >= MD

  /** `-md` cuando el marco llega al punto de corte; el base cuando no. */
  const md = (nombre: string) => `var(--sf-${nombre}${grande ? '-md' : ''})`

  return {
    '--sfp-section-gap': md('section-gap'),
    '--sfp-main-pad': md('main-pad'),
    '--sfp-header-h': md('header-h'),
    '--sfp-card-pad': md('card-pad'),
    '--sfp-grid-gap': md('grid-gap'),
    '--sfp-hero-min': md('hero-min'),
    '--sfp-hero-pad': md('hero-pad'),
    '--sfp-hero-title': md('hero-title'),
    '--sfp-heading': md('heading'),
    '--sfp-grid-cols': columnasDe(width),
  } as CSSProperties
}
