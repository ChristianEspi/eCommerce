import { cleanup, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CartProvider } from '../cart/CartProvider'
import { DEFAULT_STORE_THEME } from '../theme/resolve'
import { DEFAULT_HOME_LAYOUT } from '../theme/presets'
import type { HomeLayout } from '../theme/types'
import type { PublicProduct, PublicStore } from '../types'
import { HomeComposer } from './HomeComposer'
import type { HomeSectionData } from './types'

/**
 * El compositor de la portada.
 *
 * ## Qué se prueba aquí
 *
 * Que el ORDEN manda y que nada más manda. El compositor no sabe qué es una
 * oferta ni de dónde salen los productos: recibe datos ya resueltos y los pinta
 * en el orden configurado. Si alguna vez empezara a decidir contenido, estas
 * pruebas dejarían de tener sentido — y eso sería la señal.
 *
 * ## La prueba que más vale de todas
 *
 * La del orden heredado. Es la que dice que una tienda que nunca configuró nada
 * ve exactamente lo que veía antes de que existiera el Theme Engine, y es la
 * que se rompe el día que alguien reordene el registro «para que quede mejor».
 */

const STORE = {
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  slug: 'botica',
  name: 'Botica del Centro',
  currency: 'PEN',
  hero_title: 'Salud cerca de casa',
  hero_subtitle: 'Desde 1998',
} as unknown as PublicStore

function producto(nombre: string, id: string): PublicProduct {
  return {
    product_id: id,
    store_id: STORE.store_id,
    category_id: null,
    slug: nombre.toLowerCase().replace(/\s+/g, '-'),
    name: nombre,
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
  } as unknown as PublicProduct
}

/**
 * `t` de identidad: devuelve la clave.
 *
 * Así una aserción dice «aquí va la fila de novedades» en vez de depender de
 * cómo esté redactado hoy ese título en español.
 */
function datos(overrides: Partial<HomeSectionData> = {}): HomeSectionData {
  return {
    store: STORE,
    storeSlug: 'botica',
    /**
     * El tema por defecto (`universal`), que es el que ve una tienda que nunca
     * eligió nada. Desde P04 el registro lo necesita: `heroVariant` y
     * `categoryVariant` eligen entre composiciones distintas, y sin tema no hay
     * de dónde leerlas. Cada prueba que quiera otra composición lo pisa.
     */
    theme: DEFAULT_STORE_THEME,
    t: ((key: string) => key) as HomeSectionData['t'],
    hero: [producto('Jarabe Hero', 'p-hero')],
    ofertas: [producto('Crema Oferta', 'p-oferta')],
    destacados: [producto('Vitamina Destacada', 'p-destacada')],
    novedades: [producto('Gel Nuevo', 'p-nuevo')],
    masVendido: [producto('Alcohol Vendido', 'p-vendido')],
    // P08 · Por defecto NO hay ranking de ventas: es el estado de una tienda
    // que todavía no ha vendido, y el que hacía que la portada mintiera.
    masVendidoEsReal: false,
    thumbsMasVendido: {},
    thumbsOfertas: {},
    thumbsCatalogo: {},
    thumbsNovedades: {},
    blocks: [],
    assets: {},
    images: {},
    hasCmsHero: false,
    cmsTraePortada: false,
    cmsTraeProductos: false,
    promociones: [],
    promoAssets: {},
    categorias: [],
    // P09 · Las páginas publicadas, que pinta `business-info`.
    paginas: [],
    brands: [{ code: 'genfar', name: 'Genfar', count: 4 }],
    brandSelected: null,
    hayOfertas: true,
    favorites: new Set<string>(),
    cargandoNovedades: false,
    cargandoCatalogo: false,
    onToggleFavorite: vi.fn(),
    onQuickView: vi.fn(),
    onPrefetch: vi.fn(),
    onSelectBrand: vi.fn(),
    destacadosAparte: false,
    ...overrides,
  } as HomeSectionData
}

function layout(sections: HomeLayout['sections']): HomeLayout {
  return { version: 1, sections }
}

/**
 * El carrito envuelve la portada en la vitrina real, y las tarjetas lo usan
 * para su botón de añadir. Se monta aquí por lo mismo: sin él, probar el orden
 * de las secciones sería probar un árbol que no existe en producción.
 */
function pintar(l: HomeLayout, d: HomeSectionData = datos()) {
  return renderWithProviders(
    <CartProvider storeId={STORE.store_id} storeSlug="botica" currency="PEN">
      <HomeComposer layout={l} data={d} />
    </CartProvider>,
    { route: '/s/botica' },
  )
}

/** Dónde aparece cada texto en el documento. -1 si no está. */
function posicion(texto: string): number {
  return document.body.textContent?.indexOf(texto) ?? -1
}

// ---------------------------------------------------------------------------

describe('el orden lo pone la configuración', () => {
  it('pinta las secciones en el orden guardado', () => {
    pintar(
      layout([
        { id: 'new-arrivals', enabled: true },
        { id: 'services', enabled: true },
        { id: 'brands', enabled: true },
      ]),
    )

    expect(posicion('store.row.new')).toBeGreaterThan(-1)
    expect(posicion('Genfar')).toBeGreaterThan(posicion('store.row.new'))
  })

  it('invertir el orden invierte la portada', () => {
    pintar(
      layout([
        { id: 'brands', enabled: true },
        { id: 'new-arrivals', enabled: true },
      ]),
    )

    expect(posicion('Genfar')).toBeLessThan(posicion('store.row.new'))
  })
})

describe('lo apagado no se pinta', () => {
  it('una sección deshabilitada desaparece', () => {
    pintar(
      layout([
        { id: 'new-arrivals', enabled: false },
        { id: 'brands', enabled: true },
      ]),
    )

    expect(screen.queryByText('store.row.new')).not.toBeInTheDocument()
    expect(screen.getAllByText('Genfar').length).toBeGreaterThan(0)
  })

  it('una lista vacía no pinta nada y no rompe', () => {
    const { container } = pintar(layout([]))

    expect(container.textContent).toBe('')
  })
})

describe('lo que no se reconoce se ignora', () => {
  it('un identificador desconocido no tumba la portada', () => {
    // No puede llegar por la puerta normal —el orden viene normalizado— pero
    // sí escrito a mano con el cliente de servicio. La portada tiene que
    // sobrevivirlo: media pantalla es mejor que ninguna.
    const sucio = {
      version: 1,
      sections: [
        { id: 'banner-de-terceros', enabled: true },
        { id: 'brands', enabled: true },
      ],
    } as unknown as HomeLayout

    pintar(sucio)

    expect(screen.getAllByText('Genfar').length).toBeGreaterThan(0)
  })
})

describe('una sección sin datos se omite sola', () => {
  it('sin promociones vigentes no queda un hueco', () => {
    const { container } = pintar(layout([{ id: 'promotions', enabled: true }]))

    expect(container.textContent).toBe('')
  })

  it('sin nada rebajado ni destacado, la banda de ofertas no aparece', () => {
    const { container } = pintar(
      layout([{ id: 'offers', enabled: true }]),
      datos({ ofertas: [], destacados: [] }),
    )

    expect(container.textContent).toBe('')
  })

  it('newsletter sigue declarada sin componente y no rompe la portada', () => {
    // Y seguirá así mientras no exista dónde guardar la suscripción y el
    // consentimiento: un formulario que pide un correo y lo tira es peor que
    // no ofrecerlo.
    const { container } = pintar(layout([{ id: 'newsletter', enabled: true }]))

    expect(container.textContent).toBe('')
  })

  /**
   * `business-info` — la sección que se calla (Storefront V2 · P09).
   *
   * Hasta P09 devolvía `null` SIEMPRE: estaba en el contrato, salía en el
   * editor del backoffice y un comercio podía encenderla y arrastrarla de
   * sitio sin que pasara nada. Ahora pinta, pero solo cuando hay algo cierto
   * que decir — y eso, desde fuera, se ve igual que no estar implementada.
   * Estas dos pruebas son las que distinguen una cosa de la otra.
   */
  it('business-info encendida sin contacto sigue sin pintar: sería la cabecera repetida', () => {
    const { container } = pintar(layout([{ id: 'business-info', enabled: true }]))

    expect(container.textContent).toBe('')
  })

  it('business-info con contacto pinta la sección y sus páginas publicadas', () => {
    pintar(
      layout([{ id: 'business-info', enabled: true }]),
      datos({
        store: { ...STORE, support_email: 'hola@botica.pe' } as typeof STORE,
        paginas: [{ slug: 'terminos', title: 'Términos' }],
      }),
    )

    expect(screen.getByRole('region', { name: 'Sobre la tienda' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'hola@botica.pe' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Términos/ })).toHaveAttribute(
      'href',
      '/s/botica/p/terminos',
    )
  })

  it('categories sin familias no pinta nada: no inventa categorías', () => {
    const { container } = pintar(layout([{ id: 'categories', enabled: true }]), datos({ categorias: [] }))

    expect(container.textContent).toBe('')
  })

  it('categories pinta las familias del catálogo como puertas, en su orden y con su tope', () => {
    const familias = [
      { category_id: 'c1', name: 'Zapatillas', slug: 'zapatillas' },
      { category_id: 'c2', name: 'Botas', slug: 'botas' },
      { category_id: 'c3', name: 'Sandalias', slug: 'sandalias' },
    ]
    pintar(layout([{ id: 'categories', enabled: true, maxItems: 2 }]), datos({ categorias: familias }))

    const seccion = screen.getByRole('region', { name: 'store.categories.shopBy' })
    const puertas = seccion.querySelectorAll('a')
    expect([...puertas].map((a) => a.getAttribute('href'))).toEqual([
      '/s/botica?c=zapatillas',
      '/s/botica?c=botas',
    ])
    expect(screen.queryByText('Sandalias')).not.toBeInTheDocument()
  })
})

describe('el tope de la tienda recorta, no consulta', () => {
  it('maxItems limita lo que se pinta', () => {
    const muchos = Array.from({ length: 6 }, (_, i) => producto(`Novedad ${i}`, `p-n${i}`))

    pintar(
      layout([{ id: 'new-arrivals', enabled: true, maxItems: 2 }]),
      datos({ novedades: muchos }),
    )

    expect(screen.getAllByText('Novedad 0').length).toBeGreaterThan(0)
    expect(screen.queryByText('Novedad 3')).not.toBeInTheDocument()
  })
})

describe('el orden heredado es el de siempre', () => {
  it('reproduce la portada anterior al Theme Engine', () => {
    pintar(DEFAULT_HOME_LAYOUT)

    // Se mira el PRODUCTO de cada sección y no su título: los títulos de la
    // banda de ofertas los traduce el propio componente, y una prueba de orden
    // no debería romperse porque alguien reescriba una frase.
    const hero = posicion('Jarabe Hero')
    const ofertas = posicion('Crema Oferta')
    const novedades = posicion('Gel Nuevo')
    const vendido = posicion('Alcohol Vendido')

    expect(hero).toBeGreaterThan(-1)
    expect(ofertas).toBeGreaterThan(hero)
    expect(novedades).toBeGreaterThan(ofertas)
    expect(vendido).toBeGreaterThan(novedades)
  })

  it('lo destacado va DENTRO de la banda de ofertas, como hasta ahora', () => {
    pintar(layout([{ id: 'offers', enabled: true }]))

    expect(screen.getAllByText('Vitamina Destacada').length).toBeGreaterThan(0)
  })

  it('sacar lo destacado a su fila lo quita de la banda', () => {
    // La banda sola, con la separación pedida: no puede quedarse con lo
    // destacado, porque la fila propia lo va a pintar justo debajo.
    pintar(layout([{ id: 'offers', enabled: true }]), datos({ destacadosAparte: true }))

    expect(screen.queryByText('Vitamina Destacada')).not.toBeInTheDocument()
    expect(screen.getAllByText('Crema Oferta').length).toBeGreaterThan(0)
  })

  it('y la fila propia sí lo pinta', () => {
    pintar(layout([{ id: 'featured', enabled: true }]), datos({ destacadosAparte: true }))

    expect(screen.getAllByText('Vitamina Destacada').length).toBeGreaterThan(0)
  })
})

describe('la cubierta del comercio manda sobre la de reserva', () => {
  it('sin productos rebajados se pinta el lema de la tienda', () => {
    pintar(layout([{ id: 'hero', enabled: true }]), datos({ hero: [] }))

    expect(screen.getByText('Salud cerca de casa')).toBeInTheDocument()
  })

  it('si el CMS trae portada, la de reserva NO se pinta', () => {
    // Dos portadas apiladas no son una portada más completa.
    const { container } = pintar(
      layout([{ id: 'hero', enabled: true }]),
      datos({ hero: [], cmsTraePortada: true }),
    )

    expect(container.textContent).toBe('')
    expect(screen.queryByText('Salud cerca de casa')).not.toBeInTheDocument()
  })

  it('con productos rebajados manda la oferta concreta', () => {
    pintar(layout([{ id: 'hero', enabled: true }]))

    expect(screen.getByText('Jarabe Hero')).toBeInTheDocument()
    expect(screen.queryByText('Salud cerca de casa')).not.toBeInTheDocument()
  })
})

/**
 * Storefront V2 · P08 · El título de la fila lo decide el DATO.
 *
 * La sección se llamaba «Lo más vendido» con el antetítulo «Lo que más sale» y
 * la bajada «Los productos que más repiten nuestros clientes», sobre una lista
 * que salía del orden por RELEVANCIA del buscador. Tres afirmaciones sobre el
 * comportamiento de los compradores sostenidas por un índice de texto.
 *
 * Lo que se fija aquí es la regla: **no se cambia la lista para salvar el
 * título; se cambia el título para que diga la verdad sobre la lista.**
 */
describe('la fila de más vendidos dice lo que los datos sostienen', () => {
  const SOLO_VENDIDOS = layout([{ id: 'best-sellers', enabled: true }])

  it('sin ventas se llama «Recomendados» y no afirma nada', () => {
    pintar(SOLO_VENDIDOS, datos({ masVendidoEsReal: false }))

    expect(screen.getByText('store.row.recommended')).toBeInTheDocument()
    expect(screen.queryByText('store.row.bestSellers')).not.toBeInTheDocument()
  })

  it('con ventas se llama «Lo más vendido» y explica de dónde sale', () => {
    pintar(SOLO_VENDIDOS, datos({ masVendidoEsReal: true }))

    expect(screen.getByText('store.row.bestSellers')).toBeInTheDocument()
    expect(screen.getByText('store.row.bestSellersSubtitle')).toBeInTheDocument()
    expect(screen.queryByText('store.row.recommended')).not.toBeInTheDocument()
  })

  it('la lista es la MISMA: lo que cambia es lo que se afirma sobre ella', () => {
    // Si al no haber ventas se vaciara la fila, la portada perdería una sección
    // por decir la verdad. Lo que se corrige es la afirmación, no el contenido.
    pintar(SOLO_VENDIDOS, datos({ masVendidoEsReal: false }))
    expect(screen.getByText('Alcohol Vendido')).toBeInTheDocument()

    cleanup()
    pintar(SOLO_VENDIDOS, datos({ masVendidoEsReal: true }))
    expect(screen.getByText('Alcohol Vendido')).toBeInTheDocument()
  })

  it('«Destacados» ya no comparte título con «Lo más vendido»', () => {
    // Compartían las tres claves, así que una tienda que encendiera las dos
    // secciones veía dos veces el mismo título sobre dos listas distintas.
    pintar(layout([
      { id: 'best-sellers', enabled: true },
      { id: 'featured', enabled: true },
    ]), datos({ masVendidoEsReal: true }))

    expect(screen.getByText('store.row.bestSellers')).toBeInTheDocument()
    expect(screen.getByText('store.row.highlighted')).toBeInTheDocument()
  })
})

describe('el copy de las demás filas dice lo que el dato sabe', () => {
  it('novedades habla de PUBLICACIÓN, no de entrada al almacén', () => {
    // La fuente es `published_at` del catálogo publicado: la tienda no sabe
    // cuándo entró algo a un almacén, y desde luego no sabe si fue esta semana.
    pintar(layout([{ id: 'new-arrivals', enabled: true }]))

    expect(screen.getByText('store.row.newSubtitle')).toBeInTheDocument()
    expect(screen.getByText('store.row.newEyebrow')).toBeInTheDocument()
  })
})
