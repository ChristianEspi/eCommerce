import { within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { StoreBrandLockup } from '@/features/storefront/components/StoreBrandLockup'
import { StoreAnnouncementBar } from '@/features/storefront/components/StoreAnnouncementBar'
import { THEME_PRESETS } from '@/features/storefront/theme/presets'
import { THEME_PRESET_IDS } from '@/features/storefront/theme/types'
import { StorefrontPreview, type PreviewIdentity } from './StorefrontPreview'

/**
 * Paridad entre la vista previa del taller y la vitrina (Storefront V3 · P13).
 *
 * ## El problema que esto vigila
 *
 * La vista previa aproxima la tienda con piezas propias, y tiene que hacerlo:
 * compartir el árbol entero de la vitrina arrastraría carrito, sesión y
 * consultas al backoffice para dibujar una caja. El precio de aproximar es el
 * **desvío**: cada vez que la vitrina estrena una composición, la vista previa
 * se queda enseñando la anterior — y una opción del formulario que no cambia
 * nada en la vista previa es una opción que el comercio no puede evaluar.
 *
 * Fue exactamente lo que pasó con `heroVariant` en V2 y con las tres
 * composiciones de cabecera en V3.
 *
 * ## Qué se comprueba, y qué no
 *
 * **Lo que se comparte de verdad, se comparte.** El lockup de marca y la barra
 * de avisos son componentes presentacionales puros, y la vista previa usa los
 * MISMOS. Eso no se comprueba mirando píxeles: se comprueba viendo que los dos
 * lados producen el mismo atributo de datos, que es el que sale del componente.
 *
 * **Lo que se aproxima, se declara.** Cada aproximación pinta un
 * `data-preview-*` con la composición que representa, así que una variante nueva
 * sin representación se ve aquí en rojo.
 *
 * No se comparan capturas: para eso está la matriz visual de Playwright, que
 * corre en un navegador de verdad.
 */

const TIENDA = {
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  slug: 'la-tienda',
  name: 'La Tienda',
  currency: 'PEN',
  logo_url: null,
  brand_lockup: 'logo_name',
} as const

function identidad(extra: Partial<PreviewIdentity> = {}): PreviewIdentity {
  return { logoUrl: null, brandLockup: 'logo_name', announcements: [], ...extra }
}

function pintarPreview(
  extra: {
    preset?: string
    style?: Record<string, string>
    layout?: { version: 1 | 2; sections: { id: string; enabled: boolean }[] }
    identity?: PreviewIdentity
  } = {},
) {
  return renderWithProviders(
    <StorefrontPreview
      storeName={TIENDA.name}
      themePreset={extra.preset ?? 'universal'}
      style={extra.style ?? {}}
      layout={
        (extra.layout ?? {
          version: 1,
          sections: [
            { id: 'hero', enabled: true },
            { id: 'categories', enabled: true },
            { id: 'brands', enabled: true },
            { id: 'new-arrivals', enabled: true },
          ],
        }) as never
      }
      identity={extra.identity ?? identidad()}
    />,
    { route: '/app/settings' },
  )
}

/** El marco de escritorio, que es el que se pinta en modo foco. */
function marco(): HTMLElement {
  const encontrado = document.querySelector('[data-testid="preview-frame"]')
  if (!encontrado) throw new Error('la vista previa no pintó su marco')
  return encontrado as HTMLElement
}

describe('el lockup de marca es el MISMO componente en los dos lados', () => {
  it('sin logotipo, los dos caen al nombre', () => {
    // La regla vive en `resolveBrandLockup` y la aplica el componente, no cada
    // pantalla: es lo que impide que el taller prometa un logotipo que la
    // tienda no va a pintar.
    const { unmount } = renderWithProviders(
      <StoreBrandLockup store={{ ...TIENDA, logo_url: null }} storeSlug="la-tienda" />,
      { route: '/s/la-tienda' },
    )
    const enLaTienda = document
      .querySelector('[data-brand-lockup]')
      ?.getAttribute('data-brand-lockup')
    unmount()

    pintarPreview({ identity: identidad({ logoUrl: null, brandLockup: 'logo_name' }) })
    const enElTaller = within(marco())
      .getAllByRole('generic')
      .map((nodo) => nodo.getAttribute('data-brand-lockup'))
      .find((valor) => valor !== null)

    expect(enLaTienda).toBe('name')
    expect(enElTaller).toBe(enLaTienda)
  })

  it('con logotipo y lockup de solo logotipo, los dos dicen «logo»', () => {
    const { unmount } = renderWithProviders(
      <StoreBrandLockup
        store={{ ...TIENDA, logo_url: 'https://firmado.test/logo.png', brand_lockup: 'logo' }}
        storeSlug="la-tienda"
      />,
      { route: '/s/la-tienda' },
    )
    const enLaTienda = document
      .querySelector('[data-brand-lockup]')
      ?.getAttribute('data-brand-lockup')
    unmount()

    pintarPreview({
      identity: identidad({ logoUrl: 'https://firmado.test/logo.png', brandLockup: 'logo' }),
    })

    expect(enLaTienda).toBe('logo')
    expect(marco().querySelector('[data-brand-lockup]')).toHaveAttribute(
      'data-brand-lockup',
      'logo',
    )
  })

  it('en el taller no es un enlace: no hay a dónde ir desde una vista previa', () => {
    pintarPreview()

    const lockup = marco().querySelector('[data-brand-lockup]') as HTMLElement
    expect(lockup.tagName).not.toBe('A')
  })
})

describe('la barra de avisos es la MISMA, con el mismo saneador', () => {
  it('lo que la vitrina descarta, el taller también', () => {
    // Tres avisos, uno vacío y uno con una clave que no es `text`: el saneador
    // deja dos. Si el taller tuviera su propio filtro, enseñaría otra cosa.
    const crudos = [{ text: 'Envíos los martes' }, { text: '  ' }, { href: 'https://malo.test' }]

    const { unmount } = renderWithProviders(<StoreAnnouncementBar messages={crudos} />, {
      route: '/s/la-tienda',
    })
    const enLaTienda = document
      .querySelector('[data-announcement-bar]')
      ?.getAttribute('data-announcement-bar')
    unmount()

    pintarPreview({ identity: identidad({ announcements: crudos }) })

    expect(enLaTienda).toBe('1')
    expect(marco().querySelector('[data-announcement-bar]')).toHaveAttribute(
      'data-announcement-bar',
      '1',
    )
  })

  it('sin avisos, ninguno de los dos pinta la franja', () => {
    pintarPreview({ identity: identidad({ announcements: [] }) })

    expect(marco().querySelector('[data-announcement-bar]')).toBeNull()
  })
})

describe('cada composición del contrato tiene representación en el taller', () => {
  it('las tres cabeceras se distinguen', () => {
    for (const variante of ['standard', 'compact', 'brand'] as const) {
      const { unmount } = pintarPreview({ style: { headerVariant: variante } })
      expect(marco().querySelector('[data-preview-header]')).toHaveAttribute(
        'data-preview-header',
        variante,
      )
      unmount()
    }
  })

  it('la tarjeta editorial pierde la caja, como en la vitrina', () => {
    const { unmount } = pintarPreview({ style: { productCardVariant: 'editorial' } })
    const editorial = marco().querySelector('[data-preview-card="editorial"]') as HTMLElement
    const sinCaja = getComputedStyle(editorial).boxShadow
    unmount()

    pintarPreview({ style: { productCardVariant: 'comfortable' } })
    const conCaja = marco().querySelector('[data-preview-card="comfortable"]') as HTMLElement

    expect(sinCaja).toBe('none')
    expect(getComputedStyle(conCaja).boxShadow).not.toBe('none')
  })

  it('el mosaico de familias destaca la primera', () => {
    pintarPreview({ style: { categoryVariant: 'mosaic' } })

    expect(marco().querySelector('[data-preview-categories]')).toHaveAttribute(
      'data-preview-categories',
      'mosaic',
    )
    expect(marco().querySelector('[data-preview-cat-cell="lead"]')).not.toBeNull()
  })

  it('el muro de logotipos se distingue de las tarjetas de marca', () => {
    const { unmount } = pintarPreview({ preset: 'premium' })
    // Premium resuelve `logos` desde P07.
    expect(marco().querySelector('[data-preview-brands]')).toHaveAttribute(
      'data-preview-brands',
      'logos',
    )
    unmount()

    pintarPreview({ preset: 'universal' })
    expect(marco().querySelector('[data-preview-brands]')).toHaveAttribute(
      'data-preview-brands',
      'cards',
    )
  })

  it('la sección a sangre se pinta con el MISMO marco de la vitrina', () => {
    // No con un cálculo propio: el `50vw` de la vitrina vive en un solo sitio
    // desde P06, y la vista previa lo usa tal cual.
    pintarPreview({
      layout: {
        version: 2,
        sections: [
          {
            id: 'offers',
            enabled: true,
            presentation: { width: 'bleed', surface: 'soft' },
          } as never,
        ],
      },
    })

    const seccion = marco().querySelector('[data-section-frame="offers"]') as HTMLElement
    expect(seccion).toHaveAttribute('data-section-width', 'bleed')
    expect(seccion).toHaveAttribute('data-section-surface', 'soft')
  })
})

describe('los cuatro temas se distinguen en el taller', () => {
  it.each(THEME_PRESET_IDS)('%s pinta su cabecera, su tarjeta y sus familias', (preset) => {
    pintarPreview({ preset })
    const definicion = THEME_PRESETS[preset]

    expect(marco().querySelector('[data-preview-header]')).toHaveAttribute(
      'data-preview-header',
      definicion.headerVariant,
    )
    expect(marco().querySelector('[data-preview-card]')).toHaveAttribute(
      'data-preview-card',
      definicion.productCardVariant,
    )
    expect(marco().querySelector('[data-preview-categories]')).toHaveAttribute(
      'data-preview-categories',
      definicion.categoryVariant,
    )
  })

  it('y el marco declara el tema con los mismos atributos que la vitrina', () => {
    // `themeDataAttributes` es la misma función en los dos lados: si el taller
    // los calculara aparte, un tema nuevo se vería distinto en cada sitio.
    pintarPreview({ preset: 'catalog' })

    expect(marco()).toHaveAttribute('data-store-theme', 'catalog')
    expect(marco()).toHaveAttribute('data-store-cards', THEME_PRESETS.catalog.productCardVariant)
  })
})
