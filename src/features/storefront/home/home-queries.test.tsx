import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import { HOME_SECTION_IDS } from '../theme/types'

/**
 * Encender secciones no puede costar consultas.
 *
 * Es EL riesgo de haber partido la portada en trece piezas. La forma cómoda de
 * escribir un registro de secciones es que cada una pida lo suyo, y el día que
 * alguien lo haga, una portada con todo encendido pasará de tres consultas a
 * trece — con las mismas tres repetidas bajo claves distintas, y sin que nada
 * se vea roto. Se notaría en la factura, no en la pantalla.
 *
 * Por eso la prueba no mira el JSX: cuenta LLAMADAS. Con el orden por defecto y
 * con todas las secciones encendidas tienen que ser las mismas.
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

const BUSQUEDA_VACIA = {
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

function backend(home_layout: unknown): FakeSupabase {
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
          home_layout,
        },
      ],
      public_categories: [],
      public_products: [],
      public_product_images: [],
    },
    rpc: {
      catalog_search_for_slug: () => BUSQUEDA_VACIA,
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

/** Monta la portada entera y devuelve cuántas llamadas hizo. */
async function llamadasCon(home_layout: unknown): Promise<number> {
  const fake = backend(home_layout)
  holder.client = fake

  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
      </Route>
    </Routes>,
    { route: '/s/botica' },
  )

  await screen.findByRole('banner')
  await waitFor(() => expect(screen.getByText('Salud cerca de casa')).toBeInTheDocument())

  return fake.state.rpcCalls.length
}

const TODO_ENCENDIDO = {
  version: 1,
  sections: HOME_SECTION_IDS.map((id) => ({ id, enabled: true })),
}

beforeEach(() => {
  holder.client = null
})

describe('el número de consultas no depende del orden', () => {
  it('con todo encendido se consulta lo mismo que por defecto', async () => {
    const porDefecto = await llamadasCon(null)
    const conTodo = await llamadasCon(TODO_ENCENDIDO)

    expect(conTodo).toBe(porDefecto)
  })

  it('y apagarlo todo tampoco ahorra consultas: los datos son de la página', async () => {
    // La otra cara de lo mismo, y es deliberada. Las consultas se lanzan una
    // vez para toda la portada; qué secciones se pinten con ese resultado es
    // una decisión posterior. Si apagar una sección quitara una llamada,
    // sería porque esa sección la estaba lanzando por su cuenta.
    const porDefecto = await llamadasCon(null)
    const sinNada = await llamadasCon({ version: 1, sections: [] })

    expect(sinNada).toBe(porDefecto)
  })
})
