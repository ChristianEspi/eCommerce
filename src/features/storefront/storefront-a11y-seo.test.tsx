/**
 * P15-SaaS · lo que solo se ve montando el árbol de la vitrina: los landmarks,
 * el salto al contenido y el `<head>` que sale de verdad.
 *
 * `seo.test.ts` comprueba QUÉ se decide; esto comprueba que lo decidido LLEGA
 * al documento y que llega con la identidad del tenant. Son dos archivos porque
 * son dos fallos distintos: uno es una regla mal escrita y el otro es una regla
 * bien escrita que nadie cableó.
 *
 * Los dos casos que más caro salen si se rompen:
 *
 *  1. Un slug de tienda que no resuelve responde 200 como todo en una SPA. Sin
 *     `noindex`, el «no encontramos esa tienda» de un cliente acaba en el índice
 *     de un buscador.
 *  2. El salto al contenido tiene que MOVER EL FOCO, no solo el scroll. Un
 *     enlace que desplaza la página y deja el foco en la cabecera es peor que
 *     no tenerlo: quien navega con teclado cree que ha saltado y no ha saltado.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorefrontLayout } = await import('./StorefrontLayout')
const { StoreHomePage } = await import('./StoreHomePage')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

const EMPTY_SEARCH = {
  items: [],
  total: 0,
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
    availability: { in_stock: 0, total: 0 },
  },
}

function store() {
  return {
    store_id: STORE,
    slug: 'casa-verde',
    name: 'Casa Verde',
    currency: 'PEN',
    accent_color: '#056769',
    logo_url: 'https://cdn.example.com/logo.png',
    white_label: false,
    default_locale: 'es',
    support_email: 'hola@casaverde.pe',
    banner_url: null,
    hero_title: 'Muebles de roble',
    hero_subtitle: 'Hechos a mano en Lima',
    contact_phone: null,
    contact_address: null,
    favicon_url: null,
    font_family: null,
    ui_radius: null,
    ui_density: null,
    business_display_name: null,
  }
}

function backend(stores: ReturnType<typeof store>[] = [store()]): FakeSupabase {
  return createFakeSupabase({
    tables: {
      public_stores: stores,
      public_categories: [],
      public_products: [],
      public_product_images: [],
    },
    rpc: {
      catalog_search_for_slug: () => EMPTY_SEARCH,
      catalog_suggest_for_slug: () => [],
      store_navigation_for_slug: () => [],
      store_page_for_slug: () => ({
        cms: false,
        store_id: STORE,
        page: null,
        blocks: [],
        resolved_at: '2026-08-30T00:00:00.000Z',
      }),
    },
  })
}

function renderStorefront(fake: FakeSupabase, route = '/s/casa-verde') {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
      </Route>
    </Routes>,
    { route },
  )
}

const head = () => document.head
const content = (selector: string) => head().querySelector(selector)?.getAttribute('content')

// ---------------------------------------------------------------------------

describe('landmarks y navegación por teclado', () => {
  it('el salto al contenido es el PRIMER enfocable y mueve el foco al `<main>`', async () => {
    const user = userEvent.setup()
    renderStorefront(backend())
    await screen.findByRole('main')

    await user.tab()
    const skip = screen.getByRole('link', { name: 'Ir al contenido' })
    expect(skip).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('el `<main>` es enfocable por programa pero NO entra en el orden de tabulación', async () => {
    renderStorefront(backend())
    // `-1`: se puede enfocar desde el salto, no tabulando hasta él.
    expect(await screen.findByRole('main')).toHaveAttribute('tabindex', '-1')
  })

  it('el buscador es un landmark propio, no una caja perdida en la portada', async () => {
    renderStorefront(backend())
    expect(await screen.findByRole('search')).toBeInTheDocument()
  })

  it('la portada tiene exactamente un `<h1>`', async () => {
    renderStorefront(backend())
    await screen.findByRole('main')
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1))
  })
})

describe('el `<head>` que sale de verdad', () => {
  it('la portada se indexa, con canonical de la tienda y la identidad del TENANT', async () => {
    renderStorefront(backend())
    await screen.findByRole('main')

    await waitFor(() => expect(content('meta[name="robots"]')).toBe('index, follow'))
    expect(document.title).toBe('Muebles de roble · Casa Verde')
    expect(head().querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/s/casa-verde`,
    )
    expect(content('meta[property="og:site_name"]')).toBe('Casa Verde')

    const jsonLd = JSON.parse(
      head().querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    )
    expect(jsonLd['@type']).toBe('Organization')
    // La identidad es la de la tienda, no la del proveedor del software.
    expect(jsonLd.name).toBe('Casa Verde')
    expect(jsonLd.name).not.toContain('EBIM')
  })

  it('un slug que no resuelve NO se indexa: si no, es un «soft 404» en el índice', async () => {
    renderStorefront(backend([]), '/s/no-existe')

    await waitFor(() => expect(content('meta[name="robots"]')).toBe('noindex, nofollow'))
    expect(head().querySelector('script[type="application/ld+json"]')).toBeNull()
  })
})
