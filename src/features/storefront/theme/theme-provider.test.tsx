import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase } from '@/test/supabaseMock'
import { THEME_PRESETS } from './presets'

/**
 * El tema montado de verdad, sobre la vitrina.
 *
 * `theme.test.ts` fija el CONTRATO —qué valores existen y a qué caen los que
 * no—. Esto fija dónde vive: que la frontera de la vitrina lo expone al DOM,
 * que el backoffice no lo recibe, y que una tienda anterior a esta fase sigue
 * montando la tienda en vez de quedarse en blanco.
 *
 * Va en su propio archivo y no dentro de `theme.test.ts` a propósito: aquél no
 * monta React ni necesita un DOM, y mezclarlos convertiría una prueba de
 * contrato de milisegundos en una que arranca un navegador falso.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorefrontLayout } = await import('../StorefrontLayout')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

/** Fila de `public_stores` mínima: lo que existía antes del Theme Engine. */
function tienda(overrides: Record<string, unknown> = {}) {
  return {
    store_id: STORE,
    slug: 'casa-nordica',
    name: 'Casa Nórdica',
    currency: 'PEN',
    accent_color: '#056769',
    logo_url: null,
    white_label: false,
    default_locale: 'es',
    support_email: null,
    banner_url: null,
    hero_title: 'Muebles que duran',
    hero_subtitle: null,
    contact_phone: null,
    contact_address: null,
    ...overrides,
  }
}

async function pintar(overrides: Record<string, unknown> = {}) {
  holder.client = createFakeSupabase({
    rpc: { store_navigation_for_slug: () => [] },
    tables: {
      public_stores: [tienda(overrides)],
      public_categories: [],
      public_products: [],
      public_product_images: [],
    },
  })

  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<div>contenido</div>} />
      </Route>
    </Routes>,
    { route: '/s/casa-nordica' },
  )

  await screen.findByRole('banner')
  const frontera = document.querySelector('.sf-scope')
  if (!frontera) throw new Error('La vitrina se montó sin su frontera visual')
  return frontera
}

beforeEach(() => {
  holder.client = null
})

describe('la frontera de la vitrina declara su tema', () => {
  it('una tienda sin tema declarado es universal', async () => {
    const frontera = await pintar()

    expect(frontera).toHaveAttribute('data-store-theme', 'universal')
  })

  it.each(['retail', 'premium', 'catalog'] as const)('%s llega al DOM', async (preset) => {
    const frontera = await pintar({ theme_preset: preset })

    expect(frontera).toHaveAttribute('data-store-theme', preset)
    expect(frontera).toHaveAttribute('data-store-cards', THEME_PRESETS[preset].productCardVariant)
  })

  it('lo que la tienda pisa manda sobre su preset', async () => {
    const frontera = await pintar({
      theme_preset: 'retail',
      storefront_style: { productCardVariant: 'comfortable', sectionSpacing: 'spacious' },
    })

    expect(frontera).toHaveAttribute('data-store-theme', 'retail')
    expect(frontera).toHaveAttribute('data-store-cards', 'comfortable')
    expect(frontera).toHaveAttribute('data-store-spacing', 'spacious')
  })

  it('lo que pisa mal no pisa nada', async () => {
    const frontera = await pintar({
      theme_preset: 'premium',
      storefront_style: { productCardVariant: 'gigante', css: '.sf-scope{display:none}' },
    })

    expect(frontera).toHaveAttribute('data-store-cards', THEME_PRESETS.premium.productCardVariant)
    // Y lo que no está en la lista no llega al DOM de ninguna forma: los
    // atributos salen de valores que este repositorio escribe, no de la fila.
    expect(frontera.getAttribute('data-store-css')).toBeNull()
    expect(frontera.outerHTML).not.toContain('display:none')
  })

  it('publica las variables del tema, no el JSON', async () => {
    const frontera = await pintar({ theme_preset: 'catalog' })

    const estilo = frontera.getAttribute('style') ?? ''
    expect(estilo).toContain('--sf-section-gap')
    expect(estilo).toContain('--sf-image-ratio')
    expect(estilo).not.toContain('theme_preset')
  })
})

describe('lo que el tema NO cambia', () => {
  it('el acento sigue siendo el del tenant, que es de AppearanceProvider', async () => {
    await pintar({ theme_preset: 'catalog', accent_color: '#7B3FA0' })

    // El tema no toca el color: si lo tocara, habría dos dueños del mismo píxel.
    const raiz = document.documentElement.getAttribute('style') ?? ''
    expect(raiz.toLowerCase()).toContain('7b3fa0')
  })

  it('una tienda anterior al Theme Engine sigue montando la vitrina', async () => {
    // El caso del despliegue a medias: la fila no trae las tres columnas.
    const frontera = await pintar()

    expect(screen.getAllByText('Casa Nórdica').length).toBeGreaterThan(0)
    expect(screen.getByText('contenido')).toBeInTheDocument()
    expect(frontera).toHaveAttribute('data-store-theme', 'universal')
  })
})

describe('el backoffice no tiene tema de tienda', () => {
  it('nada fuera de la vitrina lleva data-store-theme', () => {
    renderWithProviders(<div>panel</div>, { route: '/app' })

    expect(document.querySelector('[data-store-theme]')).toBeNull()
    expect(document.querySelector('.sf-scope')).toBeNull()
  })
})
