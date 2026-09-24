import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWithProviders } from '@/test/render'
import { ExploreMore } from './ExploreMore'

/**
 * La salida de un catálogo con pocos resultados, y la regla que la gobierna.
 *
 * ## Lo que NO puede pasar
 *
 * Que un producto recomendado acabe dentro de la rejilla de resultados. El
 * contador de arriba dice «2 resultados»; si debajo hubiera nueve tarjetas, ese
 * contador pasaría a mentir y el filtro dejaría de significar nada.
 *
 * Por eso aquí no hay ni un producto: solo categorías y marcas, que son
 * navegación. Nadie confunde una puerta a «Abrigos» con un resultado de su
 * búsqueda.
 */

const FAMILIAS = [
  { code: 'abrigos', name: 'Abrigos' },
  { code: 'camisas', name: 'Camisas' },
]
const MARCAS = [
  { code: 'aurora', name: 'Aurora' },
  { code: 'sur', name: 'Marca Sur' },
]

function pintar(props: Partial<Parameters<typeof ExploreMore>[0]> = {}) {
  return renderWithProviders(
    <ExploreMore
      storeSlug="tienda"
      categories={FAMILIAS}
      brands={MARCAS}
      selectedCategory={null}
      selectedBrand={null}
      {...props}
    />,
    { route: '/s/tienda' },
  )
}

const seccion = () => screen.getByRole('region', { name: 'También puedes explorar' })

describe('la sección de exploración', () => {
  it('va aparte, con su propio título', () => {
    pintar()
    expect(seccion()).toHaveAttribute('data-explore-more', 'true')
    expect(within(seccion()).getByText('Otras familias y marcas de esta tienda.')).toBeInTheDocument()
  })

  it('ofrece familias y marcas como ENLACES al catálogo filtrado', () => {
    pintar()

    expect(within(seccion()).getByRole('link', { name: /Abrigos/ })).toHaveAttribute(
      'href',
      '/s/tienda?c=abrigos',
    )
    expect(within(seccion()).getByRole('link', { name: 'Aurora' })).toHaveAttribute(
      'href',
      '/s/tienda?b=aurora',
    )
  })

  it('no ofrece la familia ni la marca en las que YA se está', () => {
    // Ofrecer como salida el sitio donde uno está no es una salida.
    pintar({ selectedCategory: 'abrigos', selectedBrand: 'aurora' })

    expect(within(seccion()).queryByRole('link', { name: /Abrigos/ })).not.toBeInTheDocument()
    expect(within(seccion()).queryByRole('link', { name: 'Aurora' })).not.toBeInTheDocument()
    expect(within(seccion()).getByRole('link', { name: /Camisas/ })).toBeInTheDocument()
  })

  it('sin nada que ofrecer no se pinta', () => {
    pintar({ categories: [], brands: [] })
    expect(screen.queryByRole('region', { name: 'También puedes explorar' })).not.toBeInTheDocument()
  })

  it('con todo filtrado tampoco: no queda salida que dar', () => {
    pintar({
      categories: [{ code: 'abrigos', name: 'Abrigos' }],
      brands: [{ code: 'aurora', name: 'Aurora' }],
      selectedCategory: 'abrigos',
      selectedBrand: 'aurora',
    })
    expect(screen.queryByRole('region', { name: 'También puedes explorar' })).not.toBeInTheDocument()
  })

  it('no contiene ni un producto', () => {
    // La regla que da sentido a la sección: aquí no hay resultados que puedan
    // confundirse con los del filtro.
    pintar()
    expect(within(seccion()).queryByRole('button', { name: 'Agregar al carrito' })).not.toBeInTheDocument()
    expect(seccion().querySelector('a[href*="/product/"]')).toBeNull()
  })

  it('corta en seis: la salida no puede convertirse en otro catálogo', () => {
    const muchas = Array.from({ length: 12 }, (_, i) => ({
      code: `f-${i}`,
      name: `Familia ${i}`,
    }))
    pintar({ categories: muchas, brands: [] })

    expect(within(seccion()).getAllByRole('link')).toHaveLength(6)
  })
})

/**
 * Las tres presentaciones de la tarjeta, comprobadas sobre la HOJA DE ESTILOS.
 *
 * Las diferencias viajan en CSS colgado de la frontera —`data-store-theme` y
 * `data-store-cards`— y no en ramas dentro del componente, que es lo que impide
 * que cuatro temas se conviertan en cuatro tarjetas. Como el entorno de pruebas
 * no aplica hojas de estilo (`css: false`), se comprueba el texto de la hoja,
 * que es la misma técnica que ya usa `presets-behaviour.test.ts`.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront.css'),
  'utf8',
)

describe('las presentaciones de la tarjeta se declaran en la hoja', () => {
  it('la densa esconde la categoría, que es la línea que roba al nombre', () => {
    expect(CSS).toMatch(
      /\.sf-scope\[data-store-cards='compact'\]\s+\.eb-card-eyebrow\s*\{[^}]*display:\s*none/,
    )
  })

  it('la editorial quita canto y sombra en reposo, y los devuelve al apuntar', () => {
    expect(CSS).toMatch(
      /\.sf-scope\[data-store-theme='premium'\]\s+\.eb-card\s*\{[^}]*border-color:\s*transparent/,
    )
    expect(CSS).toMatch(
      /\.sf-scope\[data-store-theme='premium'\]\s+\.eb-card:hover\s*\{[^}]*box-shadow/,
    )
  })

  it('la editorial no pinta «disponible», pero SÍ «agotado»', () => {
    // El selector nombra el estado y no la pastilla: `out` es información —es la
    // que decide si el botón sirve— y `in` es el estado esperado de cualquier
    // producto publicado.
    expect(CSS).toContain(".eb-card-state[data-stock='in']")
    expect(CSS).not.toContain(".eb-card-state[data-stock='out']")
  })
})
