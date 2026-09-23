import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { BrandLogo } from './BrandLogo'
import { BrandRow } from './BrandRow'
import { BrandTrustStrip } from './BrandTrustStrip'

/**
 * El logo de una marca en la vitrina.
 *
 * ## Las tres reglas que se fijan aquí
 *
 * **El logo real gana, el monograma respalda.** Con logo se pinta la imagen;
 * sin logo, dos letras sobre el tinte de la marca. No hay tercer estado: ni un
 * hueco gris ni un icono genérico repetido doce veces, que es lo que hacía que
 * una fila de marcas no se pudiera recorrer con el rabillo del ojo.
 *
 * **Nunca se recorta.** `contain` y no `cover`: un logotipo apaisado recortado
 * a cuadrado es un trozo de letra, peor que no enseñarlo.
 *
 * **Un logo roto no rompe la fila.** Una firma caducada, un objeto borrado a
 * mano o una URL que el CSP bloquea dejarían el icono roto del navegador en
 * medio de la portada. El `onError` cae al monograma.
 */

const MARCAS = [
  { code: 'aurora', name: 'Aurora Boreal', count: 12, logoUrl: 'https://firmado.test/aurora.webp' },
  { code: 'sur', name: 'Marca Sur', count: 3, logoUrl: null },
]

describe('BrandLogo', () => {
  it('pinta la imagen cuando hay URL, sin recortarla y con tamaño fijo', () => {
    renderWithProviders(<BrandLogo name="Aurora Boreal" url="https://firmado.test/a.webp" size={40} />)

    const imagen = document.querySelector('img') as HTMLImageElement
    expect(imagen.getAttribute('src')).toBe('https://firmado.test/a.webp')
    expect(imagen).toHaveStyle({ objectFit: 'contain' })
    // Dimensiones declaradas: sin ellas, la fila cambia de alto al cargar y eso
    // es desplazamiento de contenido en la primera pantalla de la tienda.
    expect(imagen.getAttribute('width')).toBe('40')
    expect(imagen.getAttribute('height')).toBe('40')
    expect(imagen.getAttribute('loading')).toBe('lazy')
  })

  it('cae al monograma cuando no hay logo', () => {
    renderWithProviders(<BrandLogo name="Aurora Boreal" url={null} size={40} />)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('cae al monograma cuando la imagen falla', () => {
    renderWithProviders(<BrandLogo name="Marca Sur" url="https://roto.test/x.webp" size={40} />)

    const imagen = document.querySelector('img') as HTMLImageElement
    fireEvent.error(imagen)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('MS')).toBeInTheDocument()
  })

  it('el logo es decorativo: el nombre accesible lo lleva el enlace, no la imagen', () => {
    // Un `alt` con el nombre de la marca dentro de un botón que ya dice
    // «Aurora Boreal» hace que el lector de pantalla lo diga dos veces.
    renderWithProviders(<BrandLogo name="Aurora Boreal" url="https://firmado.test/a.webp" size={40} />)

    expect((document.querySelector('img') as HTMLImageElement).getAttribute('alt')).toBe('')
  })
})

describe('la fila «Compra por marca»', () => {
  function pintar() {
    return renderWithProviders(
      <BrandRow brands={MARCAS} selected={null} onSelect={vi.fn()} seeAllHref="/s/tienda?ver=todo" />,
      { route: '/s/tienda' },
    )
  }

  it('enseña el logo de la marca que lo tiene y el monograma de la que no', () => {
    pintar()

    const seccion = screen.getByRole('region', { name: 'Compra por marca' })
    // `LoopingRow` duplica las tarjetas para el bucle, así que hay más de una
    // imagen por marca: lo que se comprueba es que la de logo tiene imagen y la
    // otra tiene letras.
    expect(within(seccion).getAllByRole('button', { name: /Aurora Boreal/ }).length).toBeGreaterThan(0)
    expect(
      [...seccion.querySelectorAll('img')].some(
        (img) => img.getAttribute('src') === 'https://firmado.test/aurora.webp',
      ),
    ).toBe(true)
    expect(within(seccion).getAllByText('MS').length).toBeGreaterThan(0)
  })

  it('el eyebrow de la sección no nombra ningún rubro', () => {
    pintar()

    const seccion = screen.getByRole('region', { name: 'Compra por marca' })
    expect(within(seccion).getByText('Marcas del catálogo')).toBeInTheDocument()
    expect(seccion.textContent).not.toMatch(/laboratorio/i)
  })
})

describe('el cierre de la portada', () => {
  it('enseña logos reales y respalda con iniciales', () => {
    renderWithProviders(<BrandTrustStrip brands={MARCAS} storeSlug="tienda" />, {
      route: '/s/tienda',
    })

    const seccion = screen.getByRole('region', { name: 'Marcas de esta tienda' })
    expect(
      [...seccion.querySelectorAll('img')].map((img) => img.getAttribute('src')),
    ).toEqual(['https://firmado.test/aurora.webp'])
    expect(within(seccion).getByText('MS')).toBeInTheDocument()
  })

  it('cada marca sigue llevando al catálogo filtrado por ella', () => {
    renderWithProviders(<BrandTrustStrip brands={MARCAS} storeSlug="tienda" />, {
      route: '/s/tienda',
    })

    const seccion = screen.getByRole('region', { name: 'Marcas de esta tienda' })
    expect(within(seccion).getByRole('link', { name: /Aurora Boreal/ })).toHaveAttribute(
      'href',
      '/s/tienda?b=aurora',
    )
  })

  it('no afirma nada que la plataforma no sepa', () => {
    renderWithProviders(<BrandTrustStrip brands={MARCAS} storeSlug="tienda" />, {
      route: '/s/tienda',
    })

    const seccion = screen.getByRole('region', { name: 'Marcas de esta tienda' })
    expect(seccion.textContent).not.toMatch(/Productos originales/i)
    expect(seccion.textContent).not.toMatch(/registro sanitario|Distribuidor autorizado/i)
  })
})
