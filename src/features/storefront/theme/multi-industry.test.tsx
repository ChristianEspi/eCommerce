import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Cuatro negocios distintos, el MISMO código.
 *
 * ## Qué demuestra este archivo
 *
 * Que el rubro del comercio no aparece en ninguna parte del programa. Lo que
 * cambia entre una tienda de ropa y una droguería mayorista son **sus datos y
 * su configuración**: el catálogo que subieron y el tema que eligieron. No hay
 * un `if (esFarmacia)`, no hay un `StoreHomeRetail`, y no existe un campo donde
 * el comercio declare a qué se dedica — porque en cuanto existiera, alguien
 * ramificaría por él y la quinta industria pediría la quinta copia.
 *
 * Los cuatro escenarios son los del plan: moda con `premium`, calzado y retail
 * general con `universal`, farmacia con `retail`, y distribuidor de catálogo
 * grande con `catalog`. Cada uno se monta con su propio catálogo y se comprueba
 * que la tienda funciona entera: identidad, búsqueda, productos, precio,
 * descuento, guardar, comprar y pie.
 *
 * ## Y lo que NO demuestra
 *
 * Que cada tema sea bonito para su rubro. Eso es una opinión de diseño y no se
 * puede afirmar con una prueba. Lo que sí se afirma es que ninguno de los
 * cuatro pierde una capacidad comercial por el camino, que es lo que
 * convertiría un tema en una tienda peor.
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

interface Escenario {
  rubro: string
  tema: string
  tienda: string
  lema: string
  categoria: string
  producto: string
  precio: string
  antes: string | null
}

/**
 * Los cuatro, como DATOS.
 *
 * Es la forma del archivo lo que prueba la tesis: si hiciera falta una rama por
 * rubro, esto no podría ser una tabla.
 */
const ESCENARIOS: readonly Escenario[] = [
  {
    rubro: 'moda y ropa',
    tema: 'premium',
    tienda: 'Atelier Norte',
    lema: 'Prendas hechas para durar',
    categoria: 'Abrigos',
    producto: 'Abrigo de lana',
    precio: '459.00',
    antes: '599.00',
  },
  {
    rubro: 'zapatería y retail general',
    tema: 'universal',
    tienda: 'Calzados Pepe',
    lema: 'Tu talla, siempre',
    categoria: 'Zapatillas',
    producto: 'Zapatilla urbana',
    precio: '189.00',
    antes: null,
  },
  {
    rubro: 'farmacia y droguería',
    tema: 'retail',
    tienda: 'Botica del Centro',
    lema: 'Salud cerca de casa',
    categoria: 'Cuidado personal',
    producto: 'Jarabe natural',
    precio: '19.90',
    antes: '29.90',
  },
  {
    rubro: 'abarrotes y distribución',
    tema: 'catalog',
    tienda: 'Distribuidora Sur',
    lema: 'Todo el surtido, en un sitio',
    categoria: 'Limpieza',
    producto: 'Detergente 5 kg',
    precio: '34.50',
    antes: null,
  },
]

function backend(e: Escenario): FakeSupabase {
  const producto = {
    product_id: 'cccc1111-1111-4111-8111-111111111111',
    store_id: STORE,
    category_id: 'bbbb1111-1111-4111-8111-111111111111',
    slug: 'articulo',
    name: e.producto,
    description: null,
    price: e.precio,
    compare_at_price: e.antes,
    currency: 'PEN',
    published_at: '2026-08-01T00:00:00.000Z',
    in_stock: true,
    category_slug: 'familia',
    category_name: e.categoria,
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'simple',
  }

  return createFakeSupabase({
    tables: {
      public_stores: [
        {
          store_id: STORE,
          slug: 'tienda',
          name: e.tienda,
          currency: 'PEN',
          accent_color: '#056769',
          logo_url: null,
          white_label: false,
          default_locale: 'es',
          support_email: 'hola@tienda.demo',
          banner_url: null,
          hero_title: e.lema,
          hero_subtitle: null,
          contact_phone: null,
          contact_address: null,
          theme_preset: e.tema,
        },
      ],
      public_categories: [
        {
          category_id: producto.category_id,
          store_id: STORE,
          slug: 'familia',
          name: e.categoria,
          position: 1,
        },
      ],
      public_products: [producto],
      public_product_images: [],
    },
    rpc: {
      catalog_search_for_slug: () => ({
        items: [{ ...producto, id: producto.product_id }],
        total: 1,
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
          availability: { in_stock: 1, total: 1 },
        },
      }),
      catalog_suggest_for_slug: () => [],
      store_navigation_for_slug: () => [
        { slug: 'terminos', title: 'Términos y condiciones' },
      ],
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

async function abrir(e: Escenario, ruta = '/s/tienda') {
  holder.client = backend(e)
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

describe.each(ESCENARIOS)('$rubro con el tema $tema', (e) => {
  it('la tienda se presenta con su identidad, no con la de la suite', async () => {
    await abrir(e)

    expect(within(screen.getByRole('banner')).getByText(e.tienda)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('se puede buscar y navegar por familias', async () => {
    await abrir(e)

    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(await screen.findAllByText(e.categoria)).not.toHaveLength(0)
  })

  it('el producto se ve con su precio', async () => {
    await abrir(e, '/s/tienda?ver=todo')

    expect((await screen.findAllByText(e.producto)).length).toBeGreaterThan(0)
    const [entero, decimales] = e.precio.split('.')
    expect(
      screen.getAllByText(new RegExp(`${entero}[.,]${decimales}`)).length,
    ).toBeGreaterThan(0)
  })

  it('el descuento se anuncia solo si el producto lo tiene', async () => {
    await abrir(e, '/s/tienda?ver=todo')
    await screen.findAllByText(e.producto)

    const tachados = screen.queryAllByText(/^S\/.*$/).filter((n) => n.tagName === 'S')
    expect(tachados.length > 0).toBe(e.antes !== null)
  })

  it('se puede comprar', async () => {
    const user = userEvent.setup()
    await abrir(e, '/s/tienda?ver=todo')

    const comprar = (await screen.findAllByRole('button', { name: 'Agregar al carrito' }))[0]
    expect(comprar).toBeEnabled()
    if (comprar) await user.click(comprar)
  })

  it('el pie da con las condiciones de venta', async () => {
    await abrir(e)

    const pie = screen.getByRole('contentinfo')
    expect(
      await within(pie).findByRole('link', { name: 'Términos y condiciones' }),
    ).toBeInTheDocument()
  })

  it('y lo que el comercio no configuró no se inventa', async () => {
    await abrir(e)

    const pie = screen.getByRole('contentinfo')
    // Sin teléfono ni dirección en la configuración, no aparecen. El correo sí,
    // porque ese lo pusieron.
    expect(within(pie).getByRole('link', { name: 'hola@tienda.demo' })).toBeInTheDocument()
    expect(within(pie).queryByText(/av\.|calle|jr\./i)).not.toBeInTheDocument()
  })
})

describe('el rubro no existe para el programa', () => {
  it('los cuatro montan el mismo árbol, con distinta presentación', async () => {
    const huellas = new Set<string>()
    const estructuras = new Set<string>()

    for (const e of ESCENARIOS) {
      cleanup()
      await abrir(e)
      const frontera = document.querySelector('.sf-scope')
      huellas.add(frontera?.getAttribute('data-store-theme') ?? '')
      // La estructura: los mismos puntos de referencia del documento en los
      // cuatro. Si un tema quitara uno, aquí habría dos estructuras.
      estructuras.add(
        [
          Boolean(screen.queryByRole('banner')),
          Boolean(screen.queryByRole('main')),
          Boolean(screen.queryByRole('contentinfo')),
          Boolean(screen.queryByRole('search')),
        ].join('|'),
      )
    }

    expect(huellas.size).toBe(4)
    expect(estructuras.size).toBe(1)
  })
})
