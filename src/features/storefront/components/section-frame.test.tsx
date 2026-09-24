import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { StoreSectionFrame } from './StoreSectionFrame'

/**
 * El marco de una sección: superficie y ancho (Storefront V3 · P06).
 *
 * ## Por qué esto es una pieza y merece su propia prueba
 *
 * Sacar una sección a sangre dentro de un contenedor centrado se hace con un
 * truco —`margin-inline: calc(50% - 50vw)`— que es fácil de escribir y fácil de
 * escribir mal. Con `100vw` en vez de `50vw` aparece una barra de desplazamiento
 * horizontal en cuanto hay barra vertical, porque `vw` incluye su ancho.
 *
 * Repetido en seis secciones, es cuestión de tiempo que una lo tenga mal, y la
 * tienda entera se arrastra de lado por una de ellas. Aquí está escrito una vez
 * y probado una vez.
 */

function pintar(
  presentation: { variant: string; surface: 'plain' | 'soft' | 'contrast'; width: 'contained' | 'bleed' },
) {
  renderWithProviders(
    <StoreSectionFrame presentation={presentation} sectionId="offers">
      <div data-testid="contenido">banda</div>
    </StoreSectionFrame>,
    { route: '/s/tienda' },
  )
  return document.querySelector('[data-section-frame]') as HTMLElement | null
}

describe('el marco solo existe cuando hace falta', () => {
  it('con superficie plana y ancho contenido NO envuelve nada', () => {
    // Son los defectos de casi todas las secciones de casi todas las tiendas.
    // Trece envoltorios que no hacen nada son trece nodos de más en la portada.
    expect(pintar({ variant: 'band', surface: 'plain', width: 'contained' })).toBeNull()
    expect(screen.getByTestId('contenido')).toBeInTheDocument()
  })

  it('con superficie aparece, y declara cuál', () => {
    const marco = pintar({ variant: 'band', surface: 'soft', width: 'contained' })

    expect(marco).toHaveAttribute('data-section-surface', 'soft')
    expect(marco).toHaveAttribute('data-section-width', 'contained')
    expect(marco).toHaveAttribute('data-section-frame', 'offers')
  })

  it('a sangre aparece aunque la superficie sea plana', () => {
    const marco = pintar({ variant: 'band', surface: 'plain', width: 'bleed' })
    expect(marco).toHaveAttribute('data-section-width', 'bleed')
  })
})

describe('el full bleed no puede arrastrar la página', () => {
  it('usa 50vw y no 100vw, que es lo que evita la barra horizontal', () => {
    // `vw` incluye el ancho de la barra vertical. Con `100vw` la sección mide
    // más que el hueco disponible y aparece una barra horizontal en toda la
    // tienda — el fallo clásico de este truco.
    const marco = pintar({ variant: 'band', surface: 'plain', width: 'bleed' }) as HTMLElement
    const estilo = getComputedStyle(marco)

    expect(estilo.marginInline || estilo.marginLeft).toContain('50vw')
    expect(estilo.marginInline || estilo.marginLeft).not.toContain('100vw')
  })

  it('devuelve el contenido a su ancho con el relleno inverso', () => {
    // Sin esto, el fondo llegaría a los bordes y el CONTENIDO también: un
    // título pegado al canto de la pantalla.
    const marco = pintar({ variant: 'band', surface: 'soft', width: 'bleed' }) as HTMLElement
    const estilo = getComputedStyle(marco)

    expect(estilo.paddingInline || estilo.paddingLeft).toContain('50vw')
  })

  it('recorta lo que se le salga, y con `clip` para no romper la cabecera', () => {
    // `hidden` convertiría la caja en contenedor de desplazamiento, y eso rompe
    // la cabecera pegajosa y los anclas de navegación de la tienda.
    const marco = pintar({ variant: 'band', surface: 'plain', width: 'bleed' }) as HTMLElement
    const estilo = getComputedStyle(marco)

    expect(estilo.overflowX).toBe('clip')
    expect(estilo.overflowX).not.toBe('hidden')
  })
})

describe('la superficie no es un color del tenant', () => {
  it('las dos son mezclas con SU acento, no colores nuevos', () => {
    // El color sigue siendo 100 % del comercio (contrato §4.4): un valor suelto
    // aquí sería la plataforma eligiendo un color en la tienda de otro.
    for (const surface of ['soft', 'contrast'] as const) {
      const marco = pintar({ variant: 'band', surface, width: 'contained' }) as HTMLElement
      const fondo = getComputedStyle(marco).backgroundColor

      expect(fondo).toContain('var(--accent)')
      expect(fondo).toContain('color-mix')
    }
  })

  it('el contraste pesa MÁS que el tinte suave', () => {
    // Si pesaran lo mismo, tener dos nombres sería mentir.
    const suave = pintar({ variant: 'band', surface: 'soft', width: 'contained' }) as HTMLElement
    const suaveFondo = getComputedStyle(suave).backgroundColor

    document.body.innerHTML = ''
    const fuerte = pintar({
      variant: 'band',
      surface: 'contrast',
      width: 'contained',
    }) as HTMLElement
    const fuerteFondo = getComputedStyle(fuerte).backgroundColor

    const porcentaje = (valor: string) => Number(valor.match(/(\d+)%/)?.[1] ?? 0)
    expect(porcentaje(fuerteFondo)).toBeGreaterThan(porcentaje(suaveFondo))
  })
})
