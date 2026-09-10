import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { StorefrontThemeProvider } from '../theme/StorefrontThemeProvider'
import { THEME_PRESET_IDS } from '../theme/types'
import type { PublicCategory, PublicProduct, PublicStore } from '../types'
import { CategoryBar } from './CategoryBar'
import { SectionHeading } from './SectionHeading'
import { StoreFeaturedHero } from './StoreFeaturedHero'
import { StoreHero } from './StoreHero'

/**
 * Portada, categorías y encabezados con los cuatro temas puestos.
 *
 * ## La línea que no se cruza
 *
 * Un tema cambia cuánto PESA la portada, nunca lo que dice ni cómo se navega.
 * En concreto, tres cosas que un rediseño se lleva por delante con facilidad y
 * que aquí quedan fijadas para los cuatro:
 *
 *  · **el nivel del encabezado.** `h1` es la referencia de dónde empieza el
 *    documento para quien navega por encabezados. Bajarlo a `h2` porque «se ve
 *    mejor pequeño» no es un cambio de estilo, es quitarle el mapa a alguien;
 *  · **la portada sin foto.** La mayoría de las tiendas nuevas no tienen banner.
 *    Si el tema solo se ve bien con imagen, el tema no sirve;
 *  · **la llamada a la acción.** Lleva a una ruta real del producto, no a un
 *    `onClick` que se pierde al abrir en otra pestaña.
 */

const STORE = {
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  slug: 'botica',
  name: 'Botica del Centro',
  currency: 'PEN',
  hero_title: 'Salud cerca de casa',
  hero_subtitle: 'Desde 1998',
  banner_url: null,
} as unknown as PublicStore

const PRODUCTO = {
  product_id: 'cccc1111-1111-4111-8111-111111111111',
  store_id: STORE.store_id,
  slug: 'jarabe-natural',
  name: 'Jarabe natural',
  description: 'Para la tos seca',
  price: '19.90',
  compare_at_price: '29.90',
  currency: 'PEN',
  in_stock: true,
  category_name: 'Respiratorio',
  primary_image_path: null,
  primary_image_alt: null,
  kind: 'simple',
} as unknown as PublicProduct

function categoria(slug: string, name: string): PublicCategory {
  return {
    category_id: `id-${slug}`,
    store_id: STORE.store_id,
    parent_id: null,
    position: 0,
    slug,
    name,
  } as PublicCategory
}

function conTema(preset: string, children: React.ReactNode) {
  return renderWithProviders(
    <StorefrontThemeProvider store={{ theme_preset: preset }}>{children}</StorefrontThemeProvider>,
    { route: '/s/botica' },
  )
}

describe.each(THEME_PRESET_IDS)('la portada con el tema %s', (preset) => {
  it('el lema del comercio es el encabezado de primer nivel', () => {
    conTema(preset, <StoreHero store={STORE} />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Salud cerca de casa' }),
    ).toBeInTheDocument()
  })

  it('sin foto sigue teniendo cubierta, no un hueco', () => {
    // Una tienda recién creada no tiene banner. Si el tema solo se viera bien
    // con imagen, el tema no serviría para quien acaba de entrar a la suite.
    const { container } = conTema(preset, <StoreHero store={STORE} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Desde 1998')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('sin título propio cae al nombre de la tienda', () => {
    conTema(preset, <StoreHero store={{ ...STORE, hero_title: null } as PublicStore} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Botica del Centro' })).toBeInTheDocument()
  })

  it('la cubierta de producto lleva su nombre como h1', () => {
    conTema(
      preset,
      <StoreFeaturedHero products={[PRODUCTO]} storeSlug="botica" thumbnails={{}} />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Jarabe natural' })).toBeInTheDocument()
  })

  it('y su llamada a la acción va a la ficha real del producto', () => {
    conTema(
      preset,
      <StoreFeaturedHero products={[PRODUCTO]} storeSlug="botica" thumbnails={{}} />,
    )

    const enlaces = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/s/botica/product/jarabe-natural')
    expect(enlaces.length).toBeGreaterThan(0)
  })
})

describe.each(THEME_PRESET_IDS)('las categorías con el tema %s', (preset) => {
  it('se pueden recorrer y elegir con el teclado', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    conTema(
      preset,
      <CategoryBar
        categories={[categoria('medicamentos', 'Medicamentos')]}
        selected={null}
        onSelect={onSelect}
      />,
    )

    const nav = screen.getByRole('navigation')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    expect(within(nav).getByText('Medicamentos')).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalled()
  })

  it('la elegida se anuncia como tal, no solo con color', () => {
    conTema(
      preset,
      <CategoryBar
        categories={[categoria('medicamentos', 'Medicamentos')]}
        selected="medicamentos"
        onSelect={vi.fn()}
      />,
    )

    const elegida = screen.getByText('Medicamentos').closest('[aria-pressed]')
    expect(elegida).toHaveAttribute('aria-pressed', 'true')
  })
})

describe.each(THEME_PRESET_IDS)('los encabezados de sección con el tema %s', (preset) => {
  it('mantienen el nivel que se les pide', () => {
    conTema(preset, <SectionHeading title="Ofertas de la semana" component="h2" />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Ofertas de la semana' }),
    ).toBeInTheDocument()
  })

  it('el nivel no lo decide el tema', () => {
    conTema(preset, <SectionHeading title="Novedades" component="h3" />)

    expect(screen.getByRole('heading', { level: 3, name: 'Novedades' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })
})
