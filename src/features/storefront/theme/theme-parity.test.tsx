import { cleanup, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import { THEME_PRESET_IDS } from './types'

/**
 * La tienda entera, con los cuatro temas, contra el mismo catálogo.
 *
 * ## Qué se defiende
 *
 * **El tema no toca el negocio.** El mismo producto tiene que dar el mismo
 * precio, el mismo tachado, el mismo descuento y la misma acción en los cuatro.
 * Si un tema cambiara alguna de esas cuatro cosas dejaría de ser un tema: sería
 * una tienda distinta con los mismos datos, y el comercio no podría cambiar de
 * tema sin cambiar lo que cobra.
 *
 * **Y la tienda se sigue pudiendo usar.** Buscar, filtrar y llegar al catálogo
 * funcionan igual con el tema más denso que con el más editorial.
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
const { StoreHomePage } = await import('../StoreHomePage')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

const JARABE: Record<string, unknown> = {
  product_id: 'cccc1111-1111-4111-8111-111111111111',
  store_id: STORE,
  category_id: null,
  slug: 'jarabe-natural',
  name: 'Jarabe natural',
  description: null,
  price: '19.90',
  compare_at_price: '29.90',
  currency: 'PEN',
  published_at: '2026-08-01T00:00:00.000Z',
  in_stock: true,
  category_slug: null,
  category_name: null,
  primary_image_path: null,
  primary_image_alt: null,
  kind: 'simple',
}

/** El otro producto existe para que filtrar signifique algo. */
const ALCOHOL = { ...JARABE, product_id: 'cccc2222-1111-4111-8111-111111111111', slug: 'alcohol-70', name: 'Alcohol 70', compare_at_price: null }

function hit(producto: Record<string, unknown>) {
  return { ...producto, id: producto.product_id }
}

function busqueda(items: unknown[]) {
  return {
    items,
    total: items.length,
    limit: 24,
    offset: 0,
    sort: 'relevance',
    mode: 'browse',
    query: null,
    facets: {
      categories: [],
      brands: [],
      attributes: [],
      price: { min: null, max: null },
      availability: { in_stock: items.length, total: items.length },
    },
  }
}

function backend(theme_preset: string): FakeSupabase {
  return createFakeSupabase({
    tables: {
      public_stores: [
        {
          store_id: STORE,
          slug: 'botica',
          name: 'Botica del Centro',
          currency: 'PEN',
          accent_color: '#056769',
          logo_url: null,
          white_label: false,
          default_locale: 'es',
          support_email: null,
          banner_url: null,
          hero_title: 'Salud cerca de casa',
          hero_subtitle: null,
          contact_phone: null,
          contact_address: null,
          theme_preset,
        },
      ],
      public_categories: [],
      public_products: [JARABE, ALCOHOL],
      public_product_images: [],
    },
    rpc: {
      catalog_search_for_slug: (args: Record<string, unknown>) => {
        // `p_query` es el TÉRMINO, no un objeto: ver `search.ts`.
        const termino = String(args.p_query ?? '').toLowerCase()
        const items = [JARABE, ALCOHOL]
          .filter((p) => !termino || String(p.name).toLowerCase().includes(termino))
          .map(hit)
        return busqueda(items)
      },
      catalog_suggest_for_slug: () => [],
      store_navigation_for_slug: () => [],
      store_page_for_slug: () => ({
        cms: false,
        store_id: STORE,
        page: null,
        blocks: [],
        resolved_at: '2026-09-10T00:00:00.000Z',
      }),
    },
  })
}

async function pintar(preset: string, ruta = '/s/botica') {
  holder.client = backend(preset)
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
      </Route>
    </Routes>,
    { route: ruta },
  )
  await screen.findByRole('banner')
}

beforeEach(() => {
  holder.client = null
})

describe.each(THEME_PRESET_IDS)('con el tema %s', (preset) => {
  it('el precio y el tachado del producto son los mismos', async () => {
    await pintar(preset)

    expect((await screen.findAllByText(/19[.,]90/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/29[.,]90/).length).toBeGreaterThan(0)
  })

  it('el descuento es el mismo: lo calcula el producto, no el tema', async () => {
    await pintar(preset)

    // 19,90 sobre 29,90 son 33 % en los cuatro. Un tema que lo cambiara estaría
    // anunciando una rebaja que el comercio no hizo.
    expect((await screen.findAllByText(/33\s*%/)).length).toBeGreaterThan(0)
  })

  it('se llega al catálogo completo', async () => {
    await pintar(preset, '/s/botica?ver=todo')

    expect(await screen.findByRole('main')).toBeInTheDocument()
    expect(screen.getAllByText('Jarabe natural').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Alcohol 70').length).toBeGreaterThan(0)
  })

  it('buscar sigue filtrando', async () => {
    await pintar(preset, '/s/botica?q=alcohol')

    const principal = await screen.findByRole('main')
    expect(within(principal).getAllByText('Alcohol 70').length).toBeGreaterThan(0)
    expect(within(principal).queryByText('Jarabe natural')).not.toBeInTheDocument()
  })
})

describe('los temas se distinguen en la pantalla', () => {
  it('cada uno deja su huella en la frontera', async () => {
    const huellas: string[] = []

    for (const preset of THEME_PRESET_IDS) {
      cleanup()
      await pintar(preset)
      const frontera = document.querySelector('.sf-scope')
      huellas.push(
        [
          frontera?.getAttribute('data-store-theme'),
          frontera?.getAttribute('data-store-cards'),
          frontera?.getAttribute('data-store-header'),
          frontera?.getAttribute('data-store-spacing'),
        ].join('|'),
      )
    }

    // Cuatro temas, cuatro combinaciones distintas. Si dos coincidieran, uno de
    // los dos no estaría aportando nada y sería una casilla en el formulario
    // que no cambia la tienda.
    expect(new Set(huellas).size).toBe(THEME_PRESET_IDS.length)
  })
})
