import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import { THEME_PRESETS } from './presets'
import {
  CATEGORY_VARIANTS,
  CONTENT_WIDTHS,
  HEADER_VARIANTS,
  HERO_VARIANTS,
  IMAGE_RATIOS,
  PRODUCT_CARD_VARIANTS,
  SECTION_SPACINGS,
  type StorefrontStyle,
} from './types'

/**
 * Cada control del contrato tiene EFECTO, y se demuestra uno por uno.
 *
 * ## El fallo que este archivo cierra
 *
 * `heroVariant` y `categoryVariant` estaban en los presets, en el CHECK de la
 * base, en el esquema del formulario y en el selector de «Diseño de tienda» —y
 * no tenían ni un consumidor en la vitrina—. Se podía elegir `statement` y la
 * portada seguía pintando la de producto; se podía elegir `pills` y las
 * familias seguían saliendo como azulejos. Dos casillas que no cambiaban nada.
 *
 * ## Cómo se prueba que un control «tiene efecto»
 *
 * Cambiando SOLO ese valor y comprobando que cambia algo verificable del DOM:
 * un atributo, una variable de CSS, un componente distinto. No se miran
 * píxeles —una prueba de píxeles se rompe con cualquier ajuste de diseño y no
 * dice nada— sino la decisión: qué se pintó y con qué medidas.
 *
 * ## Y qué NO se prueba aquí
 *
 * Que cada tema sea bonito para su rubro. Eso es una opinión de diseño y no se
 * afirma con una prueba. Lo que se afirma es que las siete opciones del contrato
 * llegan a la pantalla.
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

/** Un producto REBAJADO: sin él no hay portada de producto que elegir. */
const REBAJADO: Record<string, unknown> = {
  product_id: 'cccc1111-1111-4111-8111-111111111111',
  store_id: STORE,
  category_id: null,
  slug: 'abrigo-lana',
  name: 'Abrigo de lana',
  description: null,
  price: '459.00',
  compare_at_price: '599.00',
  currency: 'PEN',
  published_at: '2026-08-01T00:00:00.000Z',
  in_stock: true,
  category_slug: null,
  category_name: null,
  primary_image_path: null,
  primary_image_alt: null,
  kind: 'simple',
}

const FAMILIAS = [
  { slug: 'abrigos', name: 'Abrigos' },
  { slug: 'camisas', name: 'Camisas' },
]

function backend(store: Record<string, unknown>): FakeSupabase {
  return createFakeSupabase({
    tables: {
      public_stores: [
        {
          store_id: STORE,
          slug: 'tienda',
          name: 'Atelier Norte',
          currency: 'PEN',
          accent_color: '#056769',
          logo_url: null,
          white_label: false,
          default_locale: 'es',
          support_email: 'hola@tienda.demo',
          banner_url: null,
          hero_title: 'Prendas hechas para durar',
          hero_subtitle: 'Desde 1998',
          contact_phone: null,
          contact_address: null,
          ...store,
        },
      ],
      public_categories: FAMILIAS.map((f, i) => ({
        category_id: `bbbb${String(i + 1).padStart(4, '0')}-1111-4111-8111-111111111111`,
        store_id: STORE,
        parent_id: null,
        slug: f.slug,
        name: f.name,
        position: i + 1,
        image_url: null,
        image_alt: null,
      })),
      public_products: [REBAJADO],
      public_product_images: [],
    },
    rpc: {
      catalog_search_for_slug: () => ({
        items: [{ ...REBAJADO, id: REBAJADO.product_id }],
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

/**
 * Monta la portada con `universal` y SOLO el valor que se está probando pisado.
 *
 * Es lo que hace que la prueba sea de ese control y no del tema entero: si se
 * cambiara el preset, cualquiera de las siete claves podría ser la responsable
 * del cambio observado.
 */
async function pintar(estilo: Partial<StorefrontStyle>, extra: Record<string, unknown> = {}) {
  holder.client = backend({
    theme_preset: 'universal',
    storefront_style: estilo,
    home_layout: {
      version: 1,
      sections: [
        { id: 'hero', enabled: true },
        { id: 'categories', enabled: true },
        { id: 'offers', enabled: true },
      ],
    },
    ...extra,
  })
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
      </Route>
    </Routes>,
    { route: '/s/tienda' },
  )
  await screen.findByRole('banner')
  return document.querySelector('.sf-scope') as HTMLElement
}

const variableDe = (frontera: HTMLElement, nombre: string) =>
  frontera.style.getPropertyValue(nombre)

/**
 * Espera a que la portada TERMINE de cargar y devuelve su cubierta.
 *
 * Hace falta porque la portada no se pinta a medias: mientras llegan las tres
 * consultas se ve un esqueleto, y sin esperar aquí la aserción miraría el DOM
 * del esqueleto y no encontraría ninguna cubierta.
 */
async function heroPintado(): Promise<HTMLElement> {
  return waitFor(() => {
    const hero = document.querySelector('[data-hero-variant]')
    expect(hero).not.toBeNull()
    return hero as HTMLElement
  })
}

beforeEach(() => {
  holder.client = null
})

// ---------------------------------------------------------------------------
// Los dos que estaban huérfanos
// ---------------------------------------------------------------------------

describe('heroVariant elige entre DOS portadas, no entre dos rellenos', () => {
  it('`product` abre con la oferta concreta: foto, precio y descuento', async () => {
    await pintar({ heroVariant: 'product' })

    const hero = await heroPintado()
    expect(hero.getAttribute('data-hero-variant')).toBe('product')
    expect(within(hero).getByText('Abrigo de lana')).toBeInTheDocument()
    expect(within(hero).getAllByText(/459/).length).toBeGreaterThan(0)
  })

  it('`statement` abre con la marca: lema grande y puertas, sin precios', async () => {
    await pintar({ heroVariant: 'statement' })

    const hero = await heroPintado()
    expect(hero.getAttribute('data-hero-variant')).toBe('statement')
    expect(within(hero).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Prendas hechas para durar',
    )
    // Ni un precio en la portada editorial: el precio se resuelve con lista,
    // canal y promociones, y hacerlo dos veces es cómo se anuncia un importe
    // que el carrito no respeta.
    expect(hero.textContent).not.toMatch(/459|599/)
  })

  it('`statement` enseña la puerta al catálogo y, si hay rebajas, la de ofertas', async () => {
    await pintar({ heroVariant: 'statement' })

    const hero = await heroPintado()
    expect(within(hero).getByRole('link', { name: 'Ver el catálogo' })).toHaveAttribute(
      'href',
      '/s/tienda?ver=todo',
    )
    expect(within(hero).getByRole('link', { name: 'Ver lo rebajado' })).toHaveAttribute(
      'href',
      '/s/tienda?oferta=1',
    )
  })

  /**
   * El fallo que la prueba de paridad de temas cazó al conectar el contrato.
   *
   * El reparto de productos da por usado lo que el hero coge, para que el mismo
   * producto no salga en cuatro sitios. Con la portada editorial —que no pinta
   * producto— esa reserva apartaba el rebajado sin enseñarlo en ninguna parte:
   * el único producto con descuento desaparecía de la portada entera.
   */
  it('con `statement` el producto rebajado NO desaparece: baja a la banda de ofertas', async () => {
    await pintar({ heroVariant: 'statement' })

    const principal = await screen.findByRole('main')
    expect(within(principal).getAllByText('Abrigo de lana').length).toBeGreaterThan(0)
    expect(within(principal).getAllByText(/459/).length).toBeGreaterThan(0)
  })

  it('`product` sin nada rebajado cae a la editorial en vez de dejar un hueco', async () => {
    // Es una PREFERENCIA, no una orden: sin oferta no hay portada de producto
    // que pintar. La regla al revés no hace falta — el lema existe desde que
    // existe la tienda.
    holder.client = backend({
      theme_preset: 'universal',
      storefront_style: { heroVariant: 'product' },
      home_layout: { version: 1, sections: [{ id: 'hero', enabled: true }] },
    })
    const fake = holder.client as FakeSupabase
    fake.state.rpc.catalog_search_for_slug = () => ({
      items: [],
      total: 0,
      limit: 24,
      offset: 0,
      sort: 'relevance',
      mode: 'empty',
      query: null,
      facets: {
        categories: [],
        brands: [],
        attributes: [],
        price: { min: null, max: null },
        availability: { in_stock: 0, total: 0 },
      },
    })

    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
          <Route index element={<StoreHomePage />} />
        </Route>
      </Routes>,
      { route: '/s/tienda' },
    )
    await screen.findByRole('banner')

    const hero = await screen.findByRole('heading', { level: 1 })
    expect(hero).toHaveTextContent('Prendas hechas para durar')
  })
})

describe('categoryVariant elige entre puertas y navegación densa', () => {
  it('`tiles` pinta azulejos con icono y flecha', async () => {
    await pintar({ categoryVariant: 'tiles' })

    const seccion = await screen.findByRole('region', { name: 'Compra por categoría' })
    expect(seccion.querySelectorAll('[data-category-door]').length).toBe(2)
    expect(seccion.querySelector('[data-category-pill]')).toBeNull()
  })

  it('`pills` pinta una línea de píldoras y ningún azulejo', async () => {
    await pintar({ categoryVariant: 'pills' })

    const seccion = await screen.findByRole('region', { name: 'Compra por categoría' })
    expect(seccion.querySelectorAll('[data-category-pill]').length).toBe(2)
    expect(seccion.querySelector('[data-category-door]')).toBeNull()
  })

  it('las dos formas siguen siendo ENLACES al catálogo filtrado', async () => {
    // Y no filtros: un `<a>` se abre en otra pestaña y se vuelve con el botón
    // de atrás. La barra del catálogo sí son botones con `aria-pressed`, que es
    // otra promesa.
    for (const variante of CATEGORY_VARIANTS) {
      cleanup()
      await pintar({ categoryVariant: variante })
      const seccion = await screen.findByRole('region', { name: 'Compra por categoría' })
      const enlace = within(seccion).getAllByRole('link', { name: /Abrigos/ })[0]
      expect(enlace, variante).toHaveAttribute('href', '/s/tienda?c=abrigos')
    }
  })
})

// ---------------------------------------------------------------------------
// Los cinco que ya tenían consumidor: que lo sigan teniendo
// ---------------------------------------------------------------------------

describe('headerVariant cambia la barra', () => {
  it.each(HEADER_VARIANTS)('%s deja su huella y su altura', async (variante) => {
    cleanup()
    const frontera = await pintar({ headerVariant: variante })

    expect(frontera.getAttribute('data-store-header')).toBe(variante)
    // La altura de la barra sale del tema, no de un número en el componente.
    expect(variableDe(frontera, '--sf-header-h-md')).toBe(
      variante === 'compact' ? '56px' : '68px',
    )
  })
})

describe('productCardVariant cambia las medidas de la tarjeta', () => {
  it.each(PRODUCT_CARD_VARIANTS)('%s deja su huella en la frontera', async (variante) => {
    cleanup()
    const frontera = await pintar({ productCardVariant: variante })
    expect(frontera.getAttribute('data-store-cards')).toBe(variante)
  })
})

describe('contentWidth cambia el ancho del contenedor', () => {
  it.each(CONTENT_WIDTHS)('%s llega al contenedor principal', async (ancho) => {
    cleanup()
    await pintar({ contentWidth: ancho })

    const principal = await screen.findByRole('main')
    // MUI traduce `maxWidth` a su clase de contenedor: es la forma de ver que
    // el valor llegó sin medir píxeles en jsdom, que no calcula anchos.
    expect(principal.className).toContain(
      ancho === 'xl' ? 'MuiContainer-maxWidthXl' : 'MuiContainer-maxWidthLg',
    )
  })
})

describe('imageRatio cambia la proporción de la foto', () => {
  it.each(IMAGE_RATIOS)('%s llega como variable de CSS', async (ratio) => {
    cleanup()
    const frontera = await pintar({ imageRatio: ratio })

    const esperado = { square: '1 / 1', portrait: '3 / 4', landscape: '4 / 3' }[ratio]
    expect(variableDe(frontera, '--sf-image-ratio')).toBe(esperado)
  })
})

describe('sectionSpacing cambia el aire', () => {
  it.each(SECTION_SPACINGS)('%s deja su huella y su medida', async (aire) => {
    cleanup()
    const frontera = await pintar({ sectionSpacing: aire })

    expect(frontera.getAttribute('data-store-spacing')).toBe(aire)
    const esperado = { compact: '16px', comfortable: '24px', spacious: '40px' }[aire]
    expect(variableDe(frontera, '--sf-section-gap-md')).toBe(esperado)
  })

  it('los tres valores dan tres medidas DISTINTAS', async () => {
    // Si dos coincidieran, una de las opciones del formulario no cambiaría la
    // tienda: una casilla que no hace nada.
    const medidas = new Set<string>()
    for (const aire of SECTION_SPACINGS) {
      cleanup()
      const frontera = await pintar({ sectionSpacing: aire })
      medidas.add(variableDe(frontera, '--sf-section-gap-md'))
    }
    expect(medidas.size).toBe(SECTION_SPACINGS.length)
  })
})

// ---------------------------------------------------------------------------
// Y los presets usan de verdad lo que declaran
// ---------------------------------------------------------------------------

describe('los presets usan lo que declaran', () => {
  it('premium declara `statement` y la portada lo obedece', async () => {
    // Era el caso que daba nombre al problema: `premium` declaraba la portada
    // editorial desde P01 y nunca se pintaba.
    expect(THEME_PRESETS.premium.heroVariant).toBe('statement')

    holder.client = backend({
      theme_preset: 'premium',
      home_layout: { version: 1, sections: [{ id: 'hero', enabled: true }] },
    })
    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
          <Route index element={<StoreHomePage />} />
        </Route>
      </Routes>,
      { route: '/s/tienda' },
    )
    await screen.findByRole('banner')

    expect((await heroPintado()).getAttribute('data-hero-variant')).toBe('statement')
  })

  it('catalog declara `pills` y las familias lo obedecen', async () => {
    expect(THEME_PRESETS.catalog.categoryVariant).toBe('pills')

    holder.client = backend({
      theme_preset: 'catalog',
      home_layout: { version: 1, sections: [{ id: 'categories', enabled: true }] },
    })
    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
          <Route index element={<StoreHomePage />} />
        </Route>
      </Routes>,
      { route: '/s/tienda' },
    )
    await screen.findByRole('banner')

    const seccion = await screen.findByRole('region', { name: 'Compra por categoría' })
    expect(seccion.querySelectorAll('[data-category-pill]').length).toBe(2)
  })

  it('ningún valor del contrato se queda sin probar en este archivo', () => {
    // La guarda del guarda: si mañana el contrato gana una opción y nadie añade
    // su caso, esto lo dice en vez de quedarse verde sin mirar.
    const probados = {
      headerVariant: HEADER_VARIANTS.length,
      heroVariant: HERO_VARIANTS.length,
      productCardVariant: PRODUCT_CARD_VARIANTS.length,
      categoryVariant: CATEGORY_VARIANTS.length,
      contentWidth: CONTENT_WIDTHS.length,
      imageRatio: IMAGE_RATIOS.length,
      sectionSpacing: SECTION_SPACINGS.length,
    }
    expect(probados).toEqual({
      headerVariant: 2,
      heroVariant: 2,
      productCardVariant: 2,
      categoryVariant: 2,
      contentWidth: 2,
      imageRatio: 3,
      sectionSpacing: 3,
    })
  })
})
