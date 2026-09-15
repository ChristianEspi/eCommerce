import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * El precio acordado se ve DONDE se decide la compra.
 *
 * La rejilla y la ficha leen `public_products`, que es una vista y no recibe
 * parametros: por eso enseñaban el precio de catalogo a todo el mundo y el del
 * acuerdo no aparecia hasta el carrito. Un comprador B2B entraba con su usuario,
 * veia el mismo numero que sin entrar, y solo al final descubria que le cobraban
 * menos — que suena bien y no lo es: hasta ese momento estuvo decidiendo con el
 * precio equivocado.
 *
 * Y el panel lateral iba por su cuenta: sumaba los precios de escaparate
 * mientras la pagina del carrito preguntaba al servidor, asi que el MISMO
 * carrito valia S/ 200.00 en el panel y S/ 184.00 un clic despues.
 *
 * Lo que se defiende aqui:
 *
 *  1. con sesion y acuerdo, la ficha enseña el precio del acuerdo y tacha el
 *     publico, diciendo de donde sale;
 *  2. sin sesion no se pregunta siquiera — no hay acuerdo que resolver y la
 *     ficha publica es la consulta mas visitada de la tienda;
 *  3. sin acuerdo aplicado no se promete ninguno;
 *  4. el panel y la pagina del carrito dicen el mismo numero.
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
const { StoreHomePage } = await import('./StoreHomePage')
const { StoreProductPage } = await import('./StoreProductPage')
const { StoreCartPage } = await import('./StoreCartPage')
const { PROMOTION_QUOTE_PUBLIC_RPC } = await import('@/shared/lib/db-schema')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const P_SILLA = 'cccc1111-1111-4111-8111-111111111111'

const LINEA_SILLA = {
  product_id: P_SILLA,
  variant_id: null,
  variant_name: null,
  slug: 'silla-roble',
  name: 'Silla de roble',
  unit_price: '100.00',
  currency: 'PEN',
  image_path: null,
  quantity: 2,
}

function store() {
  return {
    store_id: STORE,
    slug: 'casa-nordica',
    name: 'Casa Nórdica',
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
  }
}

function producto() {
  return {
    product_id: P_SILLA,
    store_id: STORE,
    category_id: null,
    slug: 'silla-roble',
    name: 'Silla de roble',
    description: 'Roble macizo.',
    price: '100.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-20T00:00:00.000Z',
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
  }
}

/** Lo que devuelve el servidor por UNA linea, a 92 en vez de 100. */
function cotizacion(cantidad: number, source: 'catalog' | 'price_list' = 'price_list') {
  const neto = (92 * cantidad).toFixed(2)
  return {
    currency: 'PEN',
    channel: 'b2c',
    tax_inclusive: false,
    quoted_at: '2026-09-08T00:00:00.000Z',
    subtotal: neto,
    discount_total: '0.00',
    promotions: { applied: [] },
    tax_total: '0.00',
    grand_total: neto,
    lines: [
      {
        product_id: P_SILLA,
        variant_id: null,
        name: 'Silla de roble',
        uom_code: null,
        quantity: cantidad,
        unit_price: source === 'price_list' ? '92.00' : '100.00',
        compare_at_price: null,
        net_amount: neto,
        tax_rate: '0.0000',
        source,
        price_list_id: source === 'price_list' ? 'dddd1111-1111-4111-8111-111111111111' : null,
        price_list_code: source === 'price_list' ? 'convenio' : null,
        scope: source === 'price_list' ? 'segment' : null,
        min_quantity: source === 'price_list' ? '1.000000' : null,
      },
    ],
  }
}

function backend(
  options: {
    session?: ReturnType<typeof makeSession> | null
    quote?: (args: Record<string, unknown>) => unknown
  } = {},
): FakeSupabase {
  return createFakeSupabase({
    session: options.session ?? null,
    tables: {
      public_stores: [store()],
      public_categories: [],
      public_products: [producto()],
      public_product_images: [],
    },
    ...(options.quote ? { rpc: { [PROMOTION_QUOTE_PUBLIC_RPC]: options.quote } } : {}),
  })
}

function render(
  fake: FakeSupabase,
  route: string,
  session: ReturnType<typeof makeSession> | null = null,
) {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
        <Route path="product/:productSlug" element={<StoreProductPage />} />
        <Route path="cart" element={<StoreCartPage />} />
      </Route>
    </Routes>,
    { route, session },
  )
}

beforeEach(() => {
  holder.client = null
  localStorage.clear()
})

describe('el precio del acuerdo en la ficha', () => {
  it('con sesion, enseña el precio acordado y tacha el publico', async () => {
    const sesion = makeSession()
    render(
      backend({ session: sesion, quote: () => cotizacion(1) }),
      '/s/casa-nordica/product/silla-roble',
      sesion,
    )

    expect(await screen.findByText('S/ 92.00')).toBeInTheDocument()
    // El 100.00 sigue ahi, pero TACHADO: de eso se ahorra.
    const publico = screen.getByText('S/ 100.00')
    expect(publico.tagName).toBe('S')
    expect(screen.getByText('Precio acordado con tu empresa')).toBeInTheDocument()
  })

  /**
   * Visto en DEV: la tarjeta decía «S/ 55.28 · Precio convenio» y la vista
   * rápida del mismo producto, S/ 61.42. La vista rápida ahora pregunta lo mismo
   * que la ficha.
   */
  it('la VISTA RAPIDA enseña el mismo precio acordado que la tarjeta y la ficha', async () => {
    const sesion = makeSession()
    render(
      backend({ session: sesion, quote: () => cotizacion(1) }),
      '/s/casa-nordica?ver=todo&p=silla-roble',
      sesion,
    )

    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText('S/ 92.00')).toBeInTheDocument()
    expect(within(dialogo).getByText('S/ 100.00').tagName).toBe('S')
    expect(within(dialogo).getByText('Precio acordado con tu empresa')).toBeInTheDocument()
  })

  it('en la vista rapida, sin acuerdo aplicado se ve el precio publico sin prometer nada', async () => {
    const sesion = makeSession()
    render(
      backend({ session: sesion, quote: () => cotizacion(1, 'catalog') }),
      '/s/casa-nordica?ver=todo&p=silla-roble',
      sesion,
    )

    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText('S/ 100.00')).toBeInTheDocument()
    expect(within(dialogo).queryByText('Precio acordado con tu empresa')).not.toBeInTheDocument()
  })

  /**
   * La ficha publica es la consulta mas visitada de la tienda y la inmensa
   * mayoria de sus visitas son anonimas. Un visitante sin sesion no tiene
   * acuerdo que resolver, asi que preguntarlo seria pagar una llamada por cada
   * visita para recibir siempre la misma respuesta.
   */
  it('sin sesion no llega a preguntar, y enseña el precio publico', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    render(
      backend({
        quote: (args) => {
          llamadas.push(args)
          return cotizacion(1)
        },
      }),
      '/s/casa-nordica/product/silla-roble',
    )

    expect(await screen.findByText('S/ 100.00')).toBeInTheDocument()
    expect(llamadas).toHaveLength(0)
    expect(screen.queryByText('Precio acordado con tu empresa')).not.toBeInTheDocument()
  })

  it('con sesion pero sin acuerdo, no promete ninguno', async () => {
    const sesion = makeSession()
    render(
      backend({ session: sesion, quote: () => cotizacion(1, 'catalog') }),
      '/s/casa-nordica/product/silla-roble',
      sesion,
    )

    expect(await screen.findByText('S/ 100.00')).toBeInTheDocument()
    expect(screen.queryByText('Precio acordado con tu empresa')).not.toBeInTheDocument()
    expect(screen.queryByText('S/ 92.00')).not.toBeInTheDocument()
  })
})

/**
 * Sin sesion no habia por donde entrar.
 *
 * El comprador de empresa abria la tienda, veia el precio de catalogo y no tenia
 * ningun sitio donde identificarse: el unico `/login` vivia en la portada de la
 * plataforma, fuera de la vitrina. Su precio de convenio, su cuenta y sus
 * pedidos existian y eran inalcanzables desde la unica pantalla donde importan.
 */
describe('la vitrina deja entrar', () => {
  it('sin sesion, la cabecera ofrece «Entrar» y vuelve a donde estabas', async () => {
    render(backend(), '/s/casa-nordica/product/silla-roble')

    const entrar = await screen.findByRole('link', { name: 'Entrar' })
    expect(entrar).toHaveAttribute('href', '/login')
    // Y no la puerta del backoffice: quien entra desde una ficha quiere ESA
    // ficha con su precio.
    expect(screen.queryByRole('button', { name: 'Tu cuenta' })).not.toBeInTheDocument()
  })

  it('con sesion, la misma casilla es «Tu cuenta» (un menu) y no ofrece entrar', async () => {
    const sesion = makeSession()
    render(backend({ session: sesion }), '/s/casa-nordica/product/silla-roble', sesion)

    const cuenta = await screen.findByRole('button', { name: 'Tu cuenta' })
    expect(cuenta).toHaveAttribute('aria-haspopup', 'menu')
    expect(cuenta).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Entrar' })).not.toBeInTheDocument()
    // La barra ya no lleva «Salir» suelto: vive dentro del menu.
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument()
  })

  it('el menu dice con quien entraste y lleva a tu cuenta y a tus pedidos', async () => {
    const user = userEvent.setup()
    const sesion = makeSession()
    render(backend({ session: sesion }), '/s/casa-nordica/product/silla-roble', sesion)

    await user.click(await screen.findByRole('button', { name: 'Tu cuenta' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText(String(sesion.user.email))).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Mi cuenta' })).toHaveAttribute('href', '/s/casa-nordica/account')
    expect(within(menu).getByRole('menuitem', { name: 'Mis pedidos' })).toHaveAttribute(
      'href',
      '/s/casa-nordica/account#pedidos',
    )
    // Con el menu abierto MUI deja el resto de la pagina `aria-hidden` (es modal):
    // el disparador se busca incluyendo lo oculto.
    expect(screen.getByRole('button', { name: 'Tu cuenta', hidden: true })).toHaveAttribute('aria-expanded', 'true')
  })

  it('«Salir» del menu cierra la sesion y deja al comprador en la tienda', async () => {
    const user = userEvent.setup()
    const sesion = makeSession()
    const fake = backend({ session: sesion })
    render(fake, '/s/casa-nordica/product/silla-roble', sesion)

    await user.click(await screen.findByRole('button', { name: 'Tu cuenta' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Salir' }))

    // Vuelve a ofrecer «Entrar»: la sesión se cerró de verdad.
    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tu cuenta' })).not.toBeInTheDocument()
    expect(fake.state.session).toBeNull()
  })
})

describe('el panel del carrito dice lo mismo que la pagina', () => {
  it('cotiza en vez de sumar los precios de escaparate', async () => {
    const user = userEvent.setup()
    const sesion = makeSession()
    localStorage.setItem(
      `ebim.ecommerce.cart.v1:${STORE}`,
      JSON.stringify({ store_id: STORE, lines: [LINEA_SILLA] }),
    )
    render(backend({ session: sesion, quote: () => cotizacion(2) }), '/s/casa-nordica', sesion)

    await user.click(await screen.findByRole('button', { name: /Carrito \(2\)/ }))

    const panel = await screen.findByRole('presentation')
    expect(await within(panel).findByText('Precio especial')).toBeInTheDocument()

    // El carrito guardaba 2 × 100.00 = 200.00; el servidor dice 184.00. Sale
    // dos veces —el total de la linea y el subtotal del pie— y las dos tienen
    // que ser la cotizada: que el pie baje y la linea siga en el catalogo es
    // exactamente el problema que esto arregla.
    expect(within(panel).getAllByText('S/ 184.00')).toHaveLength(2)
    expect(within(panel).getByText('S/ 92.00 · c/u')).toBeInTheDocument()
    expect(within(panel).queryByText('S/ 200.00')).not.toBeInTheDocument()
  })
})
