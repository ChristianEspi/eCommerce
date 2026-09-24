import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import { HEADER_VARIANTS } from './theme/types'

/**
 * La cabecera V3: tres composiciones, un lockup y una barra de avisos
 * (Storefront V3 · P03).
 *
 * ## Qué protege este archivo
 *
 * **Que las tres variantes sean composiciones y no medidas.** Hasta V3
 * `headerVariant` solo cambiaba la altura de la barra: la primera pantalla de
 * una tienda premium se veía igual que la de un catálogo de ferretería. Aquí se
 * comprueba que cada una reparte las piezas de otra forma y que **ninguna quita
 * ninguna** — un tema que dejara la tienda sin carrito dejaría de ser un tema.
 *
 * **Que la marca no se duplique.** La mayoría de los logotipos comerciales ya
 * llevan el nombre dentro, y la cabecera lo pintaba otra vez al lado.
 *
 * **Que la plataforma no hable por el comercio.** La barra de avisos no existe
 * si el comercio no escribió nada, y no hay ni un mensaje por defecto.
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

function backend(store: Record<string, unknown> = {}): FakeSupabase {
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
          hero_title: null,
          hero_subtitle: null,
          contact_phone: null,
          contact_address: null,
          ...store,
        },
      ],
      public_categories: [
        {
          category_id: 'bbbb1111-1111-4111-8111-111111111111',
          store_id: STORE,
          parent_id: null,
          slug: 'abrigos',
          name: 'Abrigos',
          position: 1,
          image_url: null,
          image_alt: null,
        },
      ],
      public_products: [],
      public_product_images: [],
    },
  })
}

async function pintar(store: Record<string, unknown> = {}) {
  holder.client = backend(store)
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<div>catálogo</div>} />
      </Route>
    </Routes>,
    { route: '/s/tienda' },
  )
  return screen.findByRole('banner')
}

/** Un estilo que pisa SOLO la variante de cabecera. */
const conVariante = (variante: string) => ({ storefront_style: { headerVariant: variante } })

beforeEach(() => {
  holder.client = null
})

describe('las tres composiciones de cabecera', () => {
  it.each(HEADER_VARIANTS)('%s se declara en el DOM y no quita ninguna pieza', async (variante) => {
    cleanup()
    const cabecera = await pintar(conVariante(variante))

    expect(cabecera).toHaveAttribute('data-header-variant', variante)

    // Las tres conservan los tres trabajos de una cabecera de tienda: buscar,
    // entrar a lo tuyo y ver el carrito. Ninguna variante puede quitarlos.
    //
    // El carrito es un BOTÓN —abre el cajón, no navega— y la cuenta un enlace
    // a la entrada mientras no hay sesión.
    expect(within(cabecera).getByRole('search')).toBeInTheDocument()
    expect(within(cabecera).getByRole('button', { name: /carrito/i })).toBeInTheDocument()
    expect(within(cabecera).getByRole('link', { name: /entrar|cuenta/i })).toBeInTheDocument()
    // Y la marca, que es lo que dice en qué tienda está.
    expect(within(cabecera).getByRole('link', { name: /Atelier Norte/ })).toBeInTheDocument()
  })

  it('las tres dejan llegar a las familias', async () => {
    for (const variante of HEADER_VARIANTS) {
      cleanup()
      const cabecera = await pintar(conVariante(variante))
      // Dentro de la CABECERA: el pie tiene su propia navegación de familias, y
      // buscar en todo el documento encontraría las dos.
      // Las familias llegan por consulta, así que se espera a que aparezcan.
      expect(
        await within(cabecera).findByRole('navigation', { name: /categor/i }),
      ).toBeInTheDocument()
    }
  })

  it('la de marca reparte en DOS filas, no es la estándar más alta', async () => {
    // La diferencia comprobable: en la de marca el buscador NO está dentro de
    // la barra de herramientas, está debajo. Es lo que la hace brand-first.
    cleanup()
    const marca = await pintar(conVariante('brand'))
    const barraDeMarca = marca.querySelector('.MuiToolbar-root')
    expect(barraDeMarca).toBeNull()

    cleanup()
    const estandar = await pintar(conVariante('standard'))
    expect(estandar.querySelector('.MuiToolbar-root')).not.toBeNull()
  })

  it('cada variante trae la altura que declara su tema', async () => {
    // La altura sigue saliendo del tema —no de un número en el componente— y la
    // de marca es la única MÁS alta: reparte su contenido en dos filas.
    const alturas: Record<string, string> = {
      standard: '68px',
      compact: '56px',
      brand: '76px',
    }
    for (const variante of HEADER_VARIANTS) {
      cleanup()
      await pintar(conVariante(variante))
      const frontera = document.querySelector('.sf-scope') as HTMLElement
      expect(frontera.style.getPropertyValue('--sf-header-h-md')).toBe(alturas[variante])
    }
  })
})

describe('la marca no se duplica', () => {
  it('por defecto pinta logotipo y nombre, y el logotipo va decorativo', async () => {
    const cabecera = await pintar({ logo_url: 'https://cdn.test/logo.png' })
    const lockup = cabecera.querySelector('[data-brand-lockup]')

    expect(lockup).toHaveAttribute('data-brand-lockup', 'logo_name')
    // El nombre lo pone el texto; el logotipo no lo repite.
    expect(within(cabecera).getByAltText('')).toHaveAttribute('src', 'https://cdn.test/logo.png')
    expect(within(cabecera).getByText('Atelier Norte')).toBeInTheDocument()
  })

  it('«solo logotipo» no escribe el nombre al lado', async () => {
    // El caso que motivó el campo: la mayoría de los logotipos comerciales ya
    // llevan el nombre dentro, y la cabecera lo ponía otra vez.
    const cabecera = await pintar({
      logo_url: 'https://cdn.test/logo.png',
      brand_lockup: 'logo',
    })

    expect(cabecera.querySelector('[data-brand-lockup]')).toHaveAttribute(
      'data-brand-lockup',
      'logo',
    )
    expect(within(cabecera).queryByText('Atelier Norte')).not.toBeInTheDocument()
    // Y entonces el logotipo SÍ se anuncia: es lo único que identifica la tienda.
    expect(within(cabecera).getByRole('img', { name: 'Atelier Norte' })).toBeInTheDocument()
  })

  it('«solo nombre» con logotipo se respeta: es una decisión, no un descuido', async () => {
    const cabecera = await pintar({
      logo_url: 'https://cdn.test/logo.png',
      brand_lockup: 'name',
    })

    expect(within(cabecera).getByText('Atelier Norte')).toBeInTheDocument()
    expect(within(cabecera).queryByAltText('')).not.toBeInTheDocument()
  })

  it('«solo logotipo» SIN logotipo cae al nombre, no deja un hueco', async () => {
    const cabecera = await pintar({ logo_url: null, brand_lockup: 'logo' })

    expect(cabecera.querySelector('[data-brand-lockup]')).toHaveAttribute(
      'data-brand-lockup',
      'name',
    )
    expect(within(cabecera).getByText('Atelier Norte')).toBeInTheDocument()
  })
})

describe('la barra de avisos', () => {
  it('sin avisos configurados, NO existe', async () => {
    // El estado por defecto de toda tienda. Una barra vacía también miente:
    // dice «aquí hay algo que no se ha rellenado».
    const cabecera = await pintar()
    expect(cabecera.querySelector('[data-announcement-bar]')).toBeNull()
  })

  it('con una lista vacía tampoco', async () => {
    const cabecera = await pintar({ announcement_messages: [] })
    expect(cabecera.querySelector('[data-announcement-bar]')).toBeNull()
  })

  it('pinta lo que el comercio escribió, y nada más', async () => {
    const cabecera = await pintar({
      announcement_messages: [{ text: 'Reparto propio en Lima' }, { text: 'Recogida en tienda' }],
    })

    const barra = cabecera.querySelector('[data-announcement-bar]')
    expect(barra).toHaveAttribute('data-announcement-bar', '2')
    expect(within(cabecera).getAllByText('Reparto propio en Lima').length).toBeGreaterThan(0)
    expect(within(cabecera).getAllByText('Recogida en tienda').length).toBeGreaterThan(0)
  })

  it('va ENCIMA de la barra de la tienda', async () => {
    const cabecera = await pintar({ announcement_messages: [{ text: 'Reparto propio' }] })

    const barra = cabecera.querySelector('[data-announcement-bar]') as HTMLElement
    const lockup = cabecera.querySelector('[data-brand-lockup]') as HTMLElement
    expect(barra.compareDocumentPosition(lockup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('descarta un aviso corrupto y conserva el bueno', async () => {
    const cabecera = await pintar({
      announcement_messages: [{ text: '' }, { text: 'Atención por WhatsApp' }],
    })

    expect(cabecera.querySelector('[data-announcement-bar]')).toHaveAttribute(
      'data-announcement-bar',
      '1',
    )
  })

  it('un aviso con marcado se pinta como TEXTO', async () => {
    // No se limpia el HTML: se conserva la cadena y React la escapa. Lo que se
    // comprueba es que no hay un elemento `<b>` en el documento.
    const cabecera = await pintar({ announcement_messages: [{ text: '<b>Oferta</b> 2x1' }] })
    const barra = cabecera.querySelector('[data-announcement-bar]') as HTMLElement

    expect(barra.textContent).toContain('<b>Oferta</b> 2x1')
    expect(barra.querySelector('b')).toBeNull()
  })

  it('se anuncia como estado, no como alerta', async () => {
    // Es información de servicio: con `assertive` interrumpiría a media frase a
    // quien esté escuchando la página.
    const cabecera = await pintar({ announcement_messages: [{ text: 'Reparto propio' }] })
    expect(within(cabecera).getAllByRole('status').length).toBeGreaterThan(0)
  })
})

describe('el selector de tema es del comercio', () => {
  it('viene apagado en las tres composiciones', async () => {
    for (const variante of HEADER_VARIANTS) {
      cleanup()
      const cabecera = await pintar(conVariante(variante))
      expect(
        within(cabecera).queryByRole('button', { name: /tema (oscuro|claro)/i }),
      ).not.toBeInTheDocument()
    }
  })

  it('encendido, aparece y funciona con el teclado', async () => {
    const user = userEvent.setup()
    const cabecera = await pintar({ show_theme_toggle: true })

    const boton = within(cabecera).getByRole('button', { name: 'Tema oscuro' })
    boton.focus()
    await user.keyboard('{Enter}')

    expect(
      await within(cabecera).findByRole('button', { name: 'Tema claro' }),
    ).toBeInTheDocument()
  })
})

describe('la cabecera no habla de ningún rubro', () => {
  it('ni con avisos configurados', async () => {
    const cabecera = await pintar({
      announcement_messages: [{ text: 'Reparto propio en Lima' }],
      logo_url: 'https://cdn.test/logo.png',
    })

    const texto = (cabecera.textContent ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')

    for (const rubro of ['farmac', 'botica', 'calzado', 'zapat', 'ferreter']) {
      expect(texto).not.toMatch(new RegExp(`\\b${rubro}`))
    }
  })
})
