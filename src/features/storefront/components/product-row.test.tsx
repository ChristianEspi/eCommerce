import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CartProvider } from '../cart/CartProvider'
import type { PublicProduct } from '../types'
import { ProductRow } from './ProductRow'

/**
 * Una fila de productos con UNO, con TRES y con VEINTE.
 *
 * ## Lo que este archivo defiende
 *
 * Que la fila **ocupa su ancho con lo que de verdad tiene**. Antes pintaba
 * siempre un carrusel de tarjetas de 168 px: con un producto, la portada
 * enseñaba una tarjeta pequeña pegada al margen y mil doscientos píxeles de
 * blanco debajo de un título que prometía una sección. Eso no se lee como «esta
 * tienda tiene una oferta», se lee como una tienda rota — y le pasa a toda
 * tienda que empieza.
 *
 * Y lo que NO puede hacer para evitarlo: rellenar con productos repetidos,
 * inventados o traídos de otra sección. La fila crece con lo suyo o se queda
 * corta con honestidad.
 */

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

function producto(n: number): PublicProduct {
  return {
    product_id: `p-${n}`,
    store_id: STORE,
    category_id: null,
    slug: `producto-${n}`,
    name: `Producto ${n}`,
    description: null,
    price: '19.90',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-01T00:00:00.000Z',
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
  } as unknown as PublicProduct
}

function pintar(cuantos: number, extra: { loading?: boolean; tone?: 'plain' | 'tinted' } = {}) {
  const productos = Array.from({ length: cuantos }, (_, i) => producto(i + 1))
  return renderWithProviders(
    <CartProvider storeId={STORE} storeSlug="tienda" currency="PEN">
      <ProductRow
        title="Novedades"
        products={productos}
        storeSlug="tienda"
        thumbnails={{}}
        seeAllHref="/s/tienda?ver=todo"
        loading={extra.loading ?? false}
        {...(extra.tone ? { tone: extra.tone } : {})}
      />
    </CartProvider>,
    { route: '/s/tienda' },
  )
}

const fila = () => screen.getByRole('region', { name: 'Novedades' })

describe('la fila se adapta a cuántos productos hay', () => {
  it('sin productos no se pinta: una sección vacía es peor que una sección menos', () => {
    pintar(0)
    expect(screen.queryByRole('region', { name: 'Novedades' })).not.toBeInTheDocument()
  })

  it.each([1, 2, 3])('con %i productos crece la rejilla y entra la puerta al catálogo', (n) => {
    pintar(n)

    const seccion = fila()
    expect(seccion).toHaveAttribute('data-row-layout', 'spotlight')
    expect(seccion).toHaveAttribute('data-row-count', String(n))
    // Las tarjetas son las COMPLETAS —con estado y botón— porque hay sitio: con
    // tres en fila no se está ojeando un escaparate, se está mirando lo que hay.
    expect(within(seccion).getAllByRole('button', { name: 'Agregar al carrito' })).toHaveLength(n)
    // Y la celda que cierra la fila, para que no quede medio ancho en blanco.
    expect(within(seccion).getByText('Recorre el catálogo')).toBeInTheDocument()
  })

  it.each([4, 5, 6])('con %i productos es rejilla y ya NO hace falta la puerta', (n) => {
    pintar(n)

    const seccion = fila()
    expect(seccion).toHaveAttribute('data-row-layout', 'grid')
    expect(within(seccion).queryByText('Recorre el catálogo')).not.toBeInTheDocument()
  })

  it('con siete o más gira, porque una rejilla se partiría en filas desiguales', () => {
    pintar(9)

    const seccion = fila()
    expect(seccion).toHaveAttribute('data-row-layout', 'carousel')
    expect(seccion).toHaveAttribute('data-row-count', '9')
  })

  it('cargando no gira ni finge una rejilla', () => {
    pintar(0, { loading: true })
    expect(fila()).toHaveAttribute('data-row-layout', 'loading')
  })
})

describe('la celda que cierra la fila corta', () => {
  it('lleva al catálogo y no afirma cuántos productos hay', () => {
    // En una tienda con dos productos, «hay más» sería mentira. Lo único que
    // promete es lo que hace.
    pintar(2)

    const puerta = within(fila()).getByRole('link', { name: /Recorre el catálogo/ })
    expect(puerta).toHaveAttribute('href', '/s/tienda?ver=todo')
    expect(fila().textContent).not.toMatch(/más productos|hay más|otros \d+/i)
  })

  it('no aparece cuando la fila ya está llena', () => {
    pintar(6)
    expect(within(fila()).queryByRole('link', { name: /Recorre el catálogo/ })).not.toBeInTheDocument()
  })
})

describe('el fondo de la fila', () => {
  it('sin tono es transparente: el de siempre', () => {
    pintar(5)
    expect(fila()).not.toHaveStyle({ borderRadius: 'var(--sf-radius)' })
  })

  it('con tono se apoya en un tinte, para que dos filas seguidas se distingan', () => {
    pintar(5, { tone: 'tinted' })
    expect(fila()).toHaveStyle({ borderRadius: 'var(--sf-radius)' })
  })
})

describe('lo que la fila NO hace para llenarse', () => {
  it('con un producto pinta UN producto, no tres copias', () => {
    pintar(1)

    const seccion = fila()
    expect(within(seccion).getAllByText(/^Producto \d+$/)).toHaveLength(1)
    expect(within(seccion).getByText('Producto 1')).toBeInTheDocument()
  })

  it('con dos pinta dos, cada uno una vez', () => {
    pintar(2)

    const nombres = within(fila())
      .getAllByText(/^Producto \d+$/)
      .map((n) => n.textContent)
    expect(nombres).toEqual(['Producto 1', 'Producto 2'])
  })
})
