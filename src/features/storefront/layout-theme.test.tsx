import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import { THEME_PRESET_IDS } from './theme/types'

/**
 * El armazón de la vitrina, con los cuatro temas puestos.
 *
 * Lo que se defiende aquí es una sola frase: **un tema cambia cómo se ve la
 * tienda, nunca lo que se puede hacer en ella.** Buscar, entrar a lo tuyo, ver
 * el carrito, cambiar de familia y llegar a las condiciones de venta tienen que
 * seguir estando en los cuatro, y el salto al contenido también — que es lo
 * primero que se pierde cuando alguien «simplifica» una cabecera.
 *
 * Por eso las pruebas están parametrizadas por preset en vez de escritas una
 * vez con el tema por defecto: un tema que rompa la cabecera solo en `catalog`
 * es exactamente el fallo que una prueba con `universal` no ve.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorefrontLayout } = await import('./StorefrontLayout')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const CAT = 'bbbb1111-1111-4111-8111-111111111111'

function backend(theme_preset: string): FakeSupabase {
  return createFakeSupabase({
    tables: {
      public_stores: [
        {
          store_id: STORE,
          slug: 'casa-verde',
          name: 'Casa Verde',
          currency: 'PEN',
          accent_color: '#056769',
          logo_url: null,
          white_label: false,
          default_locale: 'es',
          support_email: null,
          banner_url: null,
          hero_title: null,
          hero_subtitle: null,
          contact_phone: null,
          contact_address: null,
          theme_preset,
        },
      ],
      public_categories: [
        { category_id: CAT, store_id: STORE, slug: 'muebles', name: 'Muebles', position: 1 },
      ],
      public_products: [],
      public_product_images: [],
    },
    rpc: {
      store_navigation_for_slug: () => [
        { slug: 'terminos', title: 'Términos y condiciones', position: 1 },
      ],
    },
  })
}

async function pintar(preset: string) {
  holder.client = backend(preset)
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<div>catálogo</div>} />
      </Route>
    </Routes>,
    { route: '/s/casa-verde' },
  )
  return screen.findByRole('banner')
}

beforeEach(() => {
  holder.client = null
})

describe.each(THEME_PRESET_IDS)('con el tema %s', (preset) => {
  it('la tienda sigue diciendo quién es', async () => {
    const cabecera = await pintar(preset)

    expect(within(cabecera).getByText('Casa Verde')).toBeInTheDocument()
  })

  it('se puede buscar', async () => {
    await pintar(preset)

    expect(await screen.findByRole('search')).toBeInTheDocument()
    // UNO, no dos: duplicar el buscador y esconder uno con CSS deja dos
    // landmarks de búsqueda en el árbol de accesibilidad.
    expect(screen.getAllByRole('search')).toHaveLength(1)
  })

  it('se llega a la cuenta y al carrito', async () => {
    const cabecera = await pintar(preset)

    // Sin sesión, la puerta de «lo tuyo» es entrar. Con sesión es la cuenta;
    // lo que ningún tema puede hacer es quitar una de las dos.
    expect(
      within(cabecera).getByRole('link', { name: /entrar|cuenta|sign in|account/i }),
    ).toBeInTheDocument()
    expect(within(cabecera).getByRole('button', { name: /carrito|cart/i })).toBeInTheDocument()
  })

  it('se cambia de familia desde cualquier pantalla', async () => {
    const cabecera = await pintar(preset)

    expect(await within(cabecera).findByText('Muebles')).toBeInTheDocument()
  })

  it('el salto al contenido está y apunta a algo', async () => {
    await pintar(preset)

    const salto = screen.getByRole('link', { name: /contenido|content/i })
    expect(salto).toHaveAttribute('href', expect.stringContaining('#'))
    expect(document.getElementById('contenido')).toBeInTheDocument()
  })

  it('las páginas del comercio siguen alcanzables', async () => {
    await pintar(preset)

    expect(await screen.findByRole('link', { name: 'Términos y condiciones' })).toBeInTheDocument()
  })

  it('el contenido es el landmark principal y recibe el foco', async () => {
    await pintar(preset)

    const principal = screen.getByRole('main')
    expect(principal).toHaveAttribute('id', 'contenido')
    expect(principal).toHaveAttribute('tabindex', '-1')
  })
})

describe('lo que cada tema sí cambia', () => {
  it('el catálogo denso usa el ancho extra y la barra reducida', async () => {
    await pintar('catalog')

    const frontera = document.querySelector('.sf-scope')
    expect(frontera).toHaveAttribute('data-store-header', 'compact')
    expect(frontera?.getAttribute('style')).toContain('--sf-header-h')
  })

  it('la tienda que no eligió tema conserva el aire de siempre', async () => {
    await pintar('universal')

    // Los dos números de la vitrina anterior al Theme Engine, al píxel: 20/32
    // de margen del contenedor y 60/68 de barra. Si esto cambia, cambia la
    // tienda de quien nunca configuró nada.
    const estilo = document.querySelector('.sf-scope')?.getAttribute('style') ?? ''
    expect(estilo).toContain('--sf-main-pad: 20px')
    expect(estilo).toContain('--sf-main-pad-md: 32px')
    expect(estilo).toContain('--sf-header-h: 60px')
    expect(estilo).toContain('--sf-header-h-md: 68px')
  })
})
