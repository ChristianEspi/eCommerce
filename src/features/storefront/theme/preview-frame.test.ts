import { describe, expect, it } from 'vitest'
import {
  PREVIEW_VIEWPORTS,
  frameBreakpoint,
  frameCssVars,
  previewWidth,
} from './preview-frame'

/**
 * El contrato de anchos de la vista previa (Storefront V2 · P11).
 *
 * ## Qué se protege aquí
 *
 * Que la vista previa resuelva **por el ancho del marco** lo que la tienda
 * resuelve por el ancho de la ventana. Una media query mide la ventana, así que
 * un marco de 390 px dentro de una pantalla de escritorio seguía eligiendo los
 * valores de escritorio: el «móvil» era una tienda de escritorio estrujada.
 *
 * Estas pruebas fijan los escalones. Si un día la rejilla del catálogo mueve su
 * punto de corte, lo que tiene que pasar es que esto se ponga rojo — no que la
 * vista previa empiece a mentir en silencio.
 */

describe('en qué escalón cae cada ancho', () => {
  it('los tres dispositivos de referencia caen donde deben', () => {
    expect(frameBreakpoint(previewWidth('desktop'))).toBe('lg')
    expect(frameBreakpoint(previewWidth('tablet'))).toBe('sm')
    expect(frameBreakpoint(previewWidth('mobile'))).toBe('xs')
  })

  it('los bordes son los de la vitrina, no unos aproximados', () => {
    // 600 reparte columnas, 900 es el `md` de todo el patrón `{ xs, md }` de la
    // tienda y 1200 es el tercer escalón de la rejilla.
    expect(frameBreakpoint(599)).toBe('xs')
    expect(frameBreakpoint(600)).toBe('sm')
    expect(frameBreakpoint(899)).toBe('sm')
    expect(frameBreakpoint(900)).toBe('md')
    expect(frameBreakpoint(1199)).toBe('md')
    expect(frameBreakpoint(1200)).toBe('lg')
  })

  it('un ancho desconocido no revienta: se pide el de escritorio', () => {
    expect(previewWidth('desktop')).toBe(1280)
    expect(PREVIEW_VIEWPORTS.map((v) => v.id)).toEqual(['desktop', 'tablet', 'mobile'])
  })
})

describe('las variables que resuelve cada marco', () => {
  const vars = (ancho: number) => frameCssVars(ancho) as unknown as Record<string, string>

  it('por debajo de 900 se quedan en el valor base, que es el del teléfono', () => {
    const movil = vars(390)

    expect(movil['--sfp-hero-title']).toBe('var(--sf-hero-title)')
    expect(movil['--sfp-main-pad']).toBe('var(--sf-main-pad)')
    expect(movil['--sfp-header-h']).toBe('var(--sf-header-h)')
    expect(movil['--sfp-card-pad']).toBe('var(--sf-card-pad)')
  })

  it('a partir de 900 pasan a la variante ancha', () => {
    const escritorio = vars(1280)

    expect(escritorio['--sfp-hero-title']).toBe('var(--sf-hero-title-md)')
    expect(escritorio['--sfp-main-pad']).toBe('var(--sf-main-pad-md)')
    expect(escritorio['--sfp-header-h']).toBe('var(--sf-header-h-md)')
    expect(escritorio['--sfp-card-pad']).toBe('var(--sf-card-pad-md)')
  })

  it('la tableta se queda en los valores estrechos: 768 no llega a 900', () => {
    // Es el caso que más se equivoca a ojo. La tableta reparte columnas como
    // pantalla mediana pero mantiene el aire y los cuerpos del teléfono, porque
    // es lo que hace la tienda real a ese ancho.
    const tableta = vars(768)

    expect(tableta['--sfp-hero-pad']).toBe('var(--sf-hero-pad)')
    expect(tableta['--sfp-section-gap']).toBe('var(--sf-section-gap)')
    expect(tableta['--sfp-grid-cols']).toBe('var(--sf-grid-sm, 3)')
  })

  it('las columnas salen del TEMA, no de un número escrito aquí', () => {
    // Apuntan a la variable del preset. Escribir «4» aquí sería tener dos sitios
    // donde dice cuántas columnas tiene `retail`, y uno se quedaría atrás.
    expect(vars(390)['--sfp-grid-cols']).toBe('var(--sf-grid-xs, 2)')
    expect(vars(768)['--sfp-grid-cols']).toBe('var(--sf-grid-sm, 3)')
    expect(vars(1280)['--sfp-grid-cols']).toBe('var(--sf-grid-lg, 4)')
  })

  it('ninguna variable se inventa un valor: todas apuntan a una del tema', () => {
    for (const ancho of [390, 768, 1280]) {
      for (const [clave, valor] of Object.entries(vars(ancho))) {
        expect(clave.startsWith('--sfp-')).toBe(true)
        expect(valor).toMatch(/^var\(--sf-[a-z-]+(, \d+)?\)$/)
      }
    }
  })
})
