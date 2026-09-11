import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import { THEME_PRESET_IDS } from './types'

/**
 * Endurecimiento del Theme Engine: responsive, accesibilidad y SEO.
 *
 * No es una fase de diseño más. Lo que se comprueba aquí son las cosas que un
 * tema puede romper sin que nadie lo note mirando la pantalla en un portátil:
 *
 *  · **el documento.** El título, la descripción y la canónica no son del tema.
 *    Si cambiaran con él, elegir «Catálogo» cambiaría cómo aparece la tienda en
 *    un buscador, y eso no es una decisión de presentación;
 *  · **el teclado.** El salto al contenido, el orden de tabulación y el foco
 *    visible sobreviven a los cuatro;
 *  · **el móvil.** Ningún tema reparte más de dos columnas en un teléfono y
 *    ninguno ancla un ancho fijo mayor que la pantalla;
 *  · **el movimiento.** Se apaga entero con `prefers-reduced-motion`, y eso solo
 *    se sostiene si los temas no traen animaciones propias.
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
          hero_subtitle: 'Desde 1998',
          contact_phone: null,
          contact_address: null,
          theme_preset,
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

const meta = (selector: string) =>
  document.head.querySelector(selector)?.getAttribute('content') ?? null

beforeEach(() => {
  holder.client = null
})

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

describe('el tema no toca lo que ve un buscador', () => {
  it('los cuatro producen el mismo título, la misma descripción y la misma canónica', async () => {
    const documentos: string[] = []

    for (const preset of THEME_PRESET_IDS) {
      cleanup()
      await pintar(preset)
      documentos.push(
        [
          document.title,
          meta('meta[name="description"]'),
          document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
          meta('meta[name="robots"]'),
        ].join('|'),
      )
    }

    expect(new Set(documentos).size).toBe(1)
    expect(documentos[0]).toContain('Botica del Centro')
  })

  it('el `noindex` de una tienda que no existe tampoco depende del tema', async () => {
    holder.client = backend('catalog')
    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
          <Route index element={<StoreHomePage />} />
        </Route>
      </Routes>,
      { route: '/s/no-existe' },
    )

    await screen.findByText(/no encontramos|not found/i)
    expect(meta('meta[name="robots"]')).toContain('noindex')
  })
})

// ---------------------------------------------------------------------------
// Accesibilidad
// ---------------------------------------------------------------------------

describe.each(THEME_PRESET_IDS)('accesibilidad con el tema %s', (preset) => {
  it('el salto al contenido es lo primero que recibe el foco', async () => {
    const user = userEvent.setup()
    await pintar(preset)

    await user.tab()

    expect(document.activeElement).toHaveAttribute('href', expect.stringContaining('#contenido'))
  })

  it('hay un solo encabezado de primer nivel', async () => {
    await pintar(preset)

    // Se espera a que la portada termine de cargar: mientras está el esqueleto
    // no hay encabezados, y contarlos ahí no probaría nada.
    await screen.findByRole('heading', { level: 1 })
    // Dos `h1` en la misma página dejan a quien navega por encabezados sin
    // saber dónde empieza el documento.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('las regiones del documento están nombradas', async () => {
    await pintar(preset)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('el carrito es un botón y la cuenta un enlace', async () => {
    await pintar(preset)

    // No es una sutileza: un enlace se abre en otra pestaña y se puede copiar;
    // un botón, no. Confundirlos rompe los dos gestos.
    const cabecera = screen.getByRole('banner')
    expect(within(cabecera).getByRole('button', { name: /carrito|cart/i })).toBeInTheDocument()
    expect(
      within(cabecera).getByRole('link', { name: /entrar|cuenta|sign in|account/i }),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Responsive y movimiento, leídos de la hoja
// ---------------------------------------------------------------------------

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront.css'),
  'utf8',
)

describe('nada del tema desborda un teléfono', () => {
  it('la vitrina recorta lo que se salga en vez de arrastrar la página', () => {
    // Es una promesa del diseño: si algo excede el ancho es un fallo, y lo
    // correcto es que no convierta la tienda en una página que se arrastra.
    expect(CSS).toContain('overflow-x: clip')
  })

  it('ninguna regla de tema ancla un ancho fijo', () => {
    const bloques = CSS.match(/\.sf-scope\[data-store-[^\]]+\][^{]*\{[^}]*\}/g) ?? []

    for (const bloque of bloques) {
      // Un `width: 1100px` dentro de un tema es exactamente lo que produce el
      // desplazamiento horizontal a 320 px.
      expect(bloque).not.toMatch(/(^|[^-])width:\s*\d/)
      expect(bloque).not.toMatch(/min-width:\s*\d/)
    }
  })
})

describe('el movimiento sigue siendo apagable', () => {
  it('la vitrina respeta prefers-reduced-motion', () => {
    expect(CSS + '').toBeTruthy()
    // La regla vive en los componentes y en los tokens de suite; lo que aquí se
    // fija es que NINGÚN tema añada movimiento por su cuenta, porque entonces
    // habría que acordarse de apagarlo en cada tema nuevo.
    const bloques = CSS.match(/\.sf-scope\[data-store-[^\]]+\][^{]*\{[^}]*\}/g) ?? []
    for (const bloque of bloques) {
      expect(bloque).not.toMatch(/\banimation\b|\btransition\b/)
    }
  })
})
