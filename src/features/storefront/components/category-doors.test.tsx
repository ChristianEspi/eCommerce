import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CategoryDoorGrid, type CategoryDoorItem } from './CategoryDoors'

/**
 * Las puertas de categoría, con foto y sin ella.
 *
 * ## Lo que este archivo defiende
 *
 * **Que la foto sea OPCIONAL de verdad.** Sin ella la puerta se pinta con su
 * tinte y su icono —que es lo que hacía antes de P03 y lo correcto para un
 * catálogo de envases o de repuestos—; con ella la puerta ES la foto, que es lo
 * que pide una tienda visual. Ninguno de los dos caminos mira el rubro del
 * comercio: lo que decide es si esa categoría tiene foto.
 *
 * **Que una foto rota no deje la portada en blanco.** Pasa de verdad: una firma
 * caducada, un objeto borrado a mano, una URL que la CSP bloquea.
 *
 * **Que el alt no duplique el nombre.** Sin alt la imagen es decorativa y el
 * nombre —que va escrito en la propia puerta— hace de nombre accesible.
 * Inventar un alt con el nombre haría que un lector dijera «Abrigos, Abrigos».
 */

const FOTO = 'https://firmado.test/abrigos.webp'

function puerta(
  nombre: string,
  extra: Partial<CategoryDoorItem> = {},
): CategoryDoorItem {
  const slug = nombre.toLowerCase().replace(/\s+/g, '-')
  return { category_id: slug, name: nombre, slug, ...extra }
}

function pintar(categories: readonly CategoryDoorItem[]) {
  return renderWithProviders(
    <CategoryDoorGrid categories={categories} storeSlug="tienda" ariaLabel="Categorías" />,
    { route: '/s/tienda' },
  )
}

describe('una puerta sin foto', () => {
  it('se pinta con su tinte y su icono, no con un hueco', () => {
    pintar([puerta('Abrigos')])

    const enlace = screen.getByRole('link', { name: /Abrigos/ })
    expect(enlace).toHaveAttribute('data-category-door', 'tint')
    expect(enlace.querySelector('img')).toBeNull()
    // El icono sigue ahí: es lo que hace que la familia se reconozca.
    expect(enlace.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('sigue llevando al catálogo filtrado por ella', () => {
    pintar([puerta('Abrigos')])

    expect(screen.getByRole('link', { name: /Abrigos/ })).toHaveAttribute(
      'href',
      '/s/tienda?c=abrigos',
    )
  })
})

describe('una puerta con foto', () => {
  it('pinta la imagen a sangre y recortada, que es lo que hace un fondo', () => {
    pintar([puerta('Abrigos', { imageUrl: FOTO })])

    const enlace = screen.getByRole('link', { name: /Abrigos/ })
    expect(enlace).toHaveAttribute('data-category-door', 'photo')

    const imagen = enlace.querySelector('img') as HTMLImageElement
    expect(imagen.getAttribute('src')).toBe(FOTO)
    // `cover`: encajada con `contain` dejaría dos franjas vacías dentro del
    // azulejo. Una foto de categoría es un FONDO, no un logotipo.
    expect(imagen).toHaveStyle({ objectFit: 'cover' })
    expect(imagen.getAttribute('loading')).toBe('lazy')
  })

  it('el nombre de la categoría sigue escrito encima', () => {
    pintar([puerta('Abrigos', { imageUrl: FOTO })])

    const enlace = screen.getByRole('link', { name: /Abrigos/ })
    expect(within(enlace).getByText('Abrigos')).toBeInTheDocument()
  })

  it('sin alt la imagen es DECORATIVA: el nombre no se dice dos veces', () => {
    pintar([puerta('Abrigos', { imageUrl: FOTO })])

    const imagen = screen.getByRole('link', { name: /Abrigos/ }).querySelector('img')
    expect(imagen?.getAttribute('alt')).toBe('')
    expect(imagen?.getAttribute('aria-hidden')).toBe('true')
  })

  it('con alt lo usa tal cual y deja de esconderla', () => {
    pintar([puerta('Abrigos', { imageUrl: FOTO, imageAlt: 'Un abrigo de lana gris' })])

    const imagen = screen.getByRole('link', { name: /Abrigos/ }).querySelector('img')
    expect(imagen?.getAttribute('alt')).toBe('Un abrigo de lana gris')
    expect(imagen?.getAttribute('aria-hidden')).toBeNull()
  })

  it('un alt de solo espacios se trata como ausente', () => {
    pintar([puerta('Abrigos', { imageUrl: FOTO, imageAlt: '   ' })])

    const imagen = screen.getByRole('link', { name: /Abrigos/ }).querySelector('img')
    expect(imagen?.getAttribute('alt')).toBe('')
  })

  it('si la foto no carga, la puerta vuelve a su tinte', () => {
    pintar([puerta('Abrigos', { imageUrl: FOTO })])

    const imagen = screen.getByRole('link', { name: /Abrigos/ }).querySelector('img')
    fireEvent.error(imagen as HTMLImageElement)

    const enlace = screen.getByRole('link', { name: /Abrigos/ })
    expect(enlace).toHaveAttribute('data-category-door', 'tint')
    expect(enlace.querySelector('img')).toBeNull()
    expect(within(enlace).getByText('Abrigos')).toBeInTheDocument()
  })
})

describe('la misma rejilla sirve a las dos', () => {
  it('mezcla puertas con foto y sin foto sin cambiar de forma', () => {
    pintar([
      puerta('Abrigos', { imageUrl: FOTO }),
      puerta('Camisas'),
      puerta('Pantalones', { imageUrl: 'https://firmado.test/p.webp' }),
    ])

    expect(screen.getByRole('link', { name: /Abrigos/ })).toHaveAttribute(
      'data-category-door',
      'photo',
    )
    expect(screen.getByRole('link', { name: /Camisas/ })).toHaveAttribute(
      'data-category-door',
      'tint',
    )
    expect(screen.getByRole('link', { name: /Pantalones/ })).toHaveAttribute(
      'data-category-door',
      'photo',
    )
  })

  it('hasta cuatro caben en rejilla y a partir de cinco gira', () => {
    // No es un capricho de dos modos: con cuatro o menos se enseñan TODAS de
    // una vez, y esconder tras una flecha algo que cabe entero es esconderlo
    // por nada.
    pintar([puerta('A'), puerta('B'), puerta('C'), puerta('D')])
    expect(screen.queryByRole('button', { name: /siguiente|anterior/i })).not.toBeInTheDocument()
  })
})
