import { cleanup, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import type { PublicStore } from '../types'
import { StoreHero } from './StoreHero'

/**
 * La portada editorial V3: respaldos reales y ni una palabra inventada
 * (Storefront V3 · P04).
 *
 * ## Los dos problemas que cierra
 *
 * **Caía al degradado demasiado pronto.** Sin `banner_url` la portada era un
 * rectángulo de color, y eso se lee como una tienda a medio montar aunque tenga
 * quinientas fotos dentro. Ahora hay cuatro escalones y tres de ellos son fotos
 * que el comercio subió.
 *
 * **Se repetía y se inventaba.** El antetítulo pintaba siempre el nombre de la
 * tienda y el titular caía al nombre: toda tienda sin lema propio abría con su
 * nombre dos veces, uno encima del otro. Y la bajada, cuando no había, la
 * escribía la plataforma — copy comercial en la tienda de alguien que no lo
 * había pedido.
 */

const TIENDA = {
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  slug: 'tienda',
  name: 'Atelier Norte',
  currency: 'PEN',
  accent_color: '#056769',
  logo_url: null,
  white_label: false,
  default_locale: 'es',
  support_email: null,
  banner_url: null,
  hero_title: null,
  hero_subtitle: null,
  hero_kicker: null,
  store_description: null,
  brand_lockup: 'logo_name',
  show_theme_toggle: false,
  contact_phone: null,
  contact_address: null,
} as unknown as PublicStore

function pintar(
  store: Partial<PublicStore> = {},
  props: { media?: string[]; categoryImage?: string | null; hasOffers?: boolean } = {},
) {
  renderWithProviders(
    <StoreHero
      store={{ ...TIENDA, ...store } as PublicStore}
      storeSlug="tienda"
      hasOffers={props.hasOffers ?? false}
      media={props.media ?? []}
      categoryImage={props.categoryImage ?? null}
    />,
    { route: '/s/tienda' },
  )
  // Por su atributo y no por su nombre accesible: el nombre ES el titular, y el
  // titular es justo lo que cambia en cada caso de esta suite.
  return document.querySelector('[data-hero-variant="statement"]') as HTMLElement
}

describe('la cadena de respaldos visuales', () => {
  it('1 · el banner del comercio manda sobre todo', () => {
    const portada = pintar(
      { banner_url: 'https://cdn.test/banner.jpg' },
      { media: ['https://cdn.test/p1.jpg'], categoryImage: 'https://cdn.test/cat.jpg' },
    )

    expect(portada).toHaveAttribute('data-hero-media', 'banner')
    expect(within(portada).getByAltText('')).toHaveAttribute(
      'src',
      'https://cdn.test/banner.jpg',
    )
  })

  it('2 · sin banner, un collage de fotos REALES del catálogo', () => {
    // El escalón que faltaba: una tienda con catálogo y sin banner —la mayoría
    // el primer día— abría con un rectángulo de color.
    const portada = pintar({}, { media: ['https://cdn.test/p1.jpg', 'https://cdn.test/p2.jpg'] })

    expect(portada).toHaveAttribute('data-hero-media', 'collage')
    expect(portada.querySelector('[data-hero-collage]')).toHaveAttribute('data-hero-collage', '2')
  })

  it('3 · sin fotos de producto, la foto de una familia', () => {
    const portada = pintar({}, { categoryImage: 'https://cdn.test/cat.jpg' })

    expect(portada).toHaveAttribute('data-hero-media', 'category')
    expect(within(portada).getByAltText('')).toHaveAttribute('src', 'https://cdn.test/cat.jpg')
  })

  it('4 · sin ninguna foto, el degradado del acento del tenant', () => {
    // El último recurso es COLOR, no una imagen de archivo: la plataforma no
    // pone una foto que no es del comercio en su portada.
    const portada = pintar()

    expect(portada).toHaveAttribute('data-hero-media', 'gradient')
    expect(portada.querySelector('img')).toBeNull()
  })

  it('el collage cambia de forma con el número de fotos', () => {
    // Una foto estirada al ancho de dos no es una composición, es una foto mal
    // encajada.
    for (const n of [1, 2, 3]) {
      cleanup()
      const urls = Array.from({ length: n }, (_, i) => `https://cdn.test/p${i}.jpg`)
      const portada = pintar({}, { media: urls })
      expect(portada.querySelector('[data-hero-collage]')).toHaveAttribute(
        'data-hero-collage',
        String(n),
      )
    }
  })

  it('el collage corta en tres, aunque lleguen más', () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://cdn.test/p${i}.jpg`)
    const portada = pintar({}, { media: urls })

    expect(portada.querySelector('[data-hero-collage]')).toHaveAttribute('data-hero-collage', '3')
    expect(portada.querySelectorAll('img')).toHaveLength(3)
  })

  it('las fotos del collage son decorativas, no una lista que haya que oír', () => {
    // Anunciarlas obligaría a escuchar tres nombres de producto antes de llegar
    // al botón «Ver catálogo», que es lo que la portada quiere que se pulse.
    const portada = pintar({}, { media: ['https://cdn.test/p1.jpg'] })
    const collage = portada.querySelector('[data-hero-collage]') as HTMLElement

    expect(collage).toHaveAttribute('aria-hidden', 'true')
    expect(within(collage).getAllByAltText('').length).toBeGreaterThan(0)
  })

  it('una URL vacía no cuenta como foto', () => {
    // Si contara, el hero se quedaría con un hueco en vez de caer al respaldo.
    const portada = pintar({}, { media: ['', '   '] })
    expect(portada).toHaveAttribute('data-hero-media', 'gradient')
  })
})

describe('la portada no se repite ni se inventa nada', () => {
  it('sin titular propio, el nombre se escribe UNA vez', () => {
    // El defecto: el antetítulo pintaba el nombre y el titular caía al nombre.
    const portada = pintar()

    expect(within(portada).getByRole('heading', { level: 1 })).toHaveTextContent('Atelier Norte')
    expect(within(portada).getAllByText('Atelier Norte')).toHaveLength(1)
    expect(portada.querySelector('[data-hero-kicker]')).toBeNull()
  })

  it('con titular propio, el nombre sirve de contexto encima', () => {
    const portada = pintar({ hero_title: 'Prendas hechas para durar' })

    expect(within(portada).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Prendas hechas para durar',
    )
    expect(portada.querySelector('[data-hero-kicker]')).toHaveAttribute(
      'data-hero-kicker',
      'store-name',
    )
    expect(within(portada).getByText('Atelier Norte')).toBeInTheDocument()
  })

  it('con kicker del comercio, manda el kicker', () => {
    const portada = pintar({ hero_kicker: 'Nueva temporada', hero_title: 'Lino y algodón' })

    expect(portada.querySelector('[data-hero-kicker]')).toHaveAttribute(
      'data-hero-kicker',
      'merchant',
    )
    expect(within(portada).getByText('Nueva temporada')).toBeInTheDocument()
    // Y el nombre no se cuela de más: el comercio ya dijo qué quiere arriba.
    expect(within(portada).queryByText('Atelier Norte')).not.toBeInTheDocument()
  })

  it('el kicker aparece incluso cuando el titular ES el nombre', () => {
    // Es el caso que hace útil el campo: sin kicker no había forma de poner una
    // línea encima sin repetir el nombre.
    const portada = pintar({ hero_kicker: 'Desde 1998' })

    expect(within(portada).getByText('Desde 1998')).toBeInTheDocument()
    expect(within(portada).getAllByText('Atelier Norte')).toHaveLength(1)
  })

  it('sin bajada configurada, la plataforma NO escribe una', () => {
    // Hasta V3 rellenaba con «Explora el catálogo, revisa precios y
    // disponibilidad al día»: copy comercial en la tienda de alguien que no lo
    // había escrito.
    const portada = pintar()
    const texto = portada.textContent ?? ''

    expect(texto).not.toContain('Explora el catálogo')
    expect(texto).not.toContain('disponibilidad')
  })

  it('con bajada configurada, se pinta la suya', () => {
    const portada = pintar({ hero_subtitle: 'Fabricación propia en Lima' })
    expect(within(portada).getByText('Fabricación propia en Lima')).toBeInTheDocument()
  })
})

describe('las puertas del hero', () => {
  it('siempre lleva al catálogo', () => {
    const portada = pintar()
    expect(within(portada).getByRole('link', { name: /catálogo/i })).toHaveAttribute(
      'href',
      '/s/tienda?ver=todo',
    )
  })

  it('la puerta a lo rebajado SOLO existe si hay algo rebajado', () => {
    const sinOfertas = pintar()
    expect(within(sinOfertas).queryByRole('link', { name: /rebajado/i })).not.toBeInTheDocument()

    cleanup()
    const conOfertas = pintar({}, { hasOffers: true })
    expect(within(conOfertas).getByRole('link', { name: /rebajado/i })).toHaveAttribute(
      'href',
      '/s/tienda?oferta=1',
    )
  })

  it('no hay ni un precio en la portada editorial', () => {
    // El precio se resuelve con lista, canal, promociones y condiciones de la
    // sesión. Calcularlo aquí sería cómo se llega a una portada que anuncia un
    // precio que el carrito no respeta.
    const portada = pintar({ hero_subtitle: 'Fabricación propia' }, { hasOffers: true })
    expect(portada.textContent ?? '').not.toMatch(/S\/|\d+[.,]\d{2}/)
  })

  it('sin slug no hay puertas, y la portada sigue pintándose', () => {
    renderWithProviders(<StoreHero store={TIENDA} />, { route: '/s/tienda' })
    const portada = screen.getByRole('region', { name: 'Atelier Norte' })

    expect(within(portada).getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(within(portada).queryAllByRole('link')).toHaveLength(0)
  })
})
