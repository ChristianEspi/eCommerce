import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

/**
 * El carrito le pregunta el total al SERVIDOR (P04-SaaS).
 *
 * Antes de esta fase el resumen sumaba los precios guardados en `localStorage`,
 * que son de escaparate. Con listas por canal y escalas por cantidad ese número
 * puede no ser el que se cobra, y un carrito que dice 200 y cobra 184 es tan
 * malo como el que dice 184 y cobra 200: los dos rompen la confianza en el
 * momento exacto en que el comprador está decidiendo.
 *
 * Tres propiedades se defienden aquí:
 *
 *  1. cuando la cotización llega, manda ELLA;
 *  2. lo que viaja en la petición es el slug y qué se compra — ni un precio;
 *  3. cuando NO llega, el carrito sigue funcionando con el subtotal local y lo
 *     dice. No poder adelantar un total no es motivo para impedir la compra.
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
const { StoreCartPage } = await import('./StoreCartPage')
const { PRICE_QUOTE_PUBLIC_RPC } = await import('@/shared/lib/db-schema')

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
    slug: 'la-tienda',
    name: 'La Tienda',
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

/** Cotización del servidor: precio de lista, con impuesto ya calculado. */
function cotizacion(source: 'catalog' | 'price_list' = 'price_list') {
  return {
    currency: 'PEN',
    channel: 'b2c',
    tax_inclusive: false,
    quoted_at: '2026-08-27T00:00:00.000Z',
    subtotal: '184.00',
    tax_total: '33.12',
    grand_total: '217.12',
    lines: [
      {
        product_id: P_SILLA,
        variant_id: null,
        name: 'Silla de roble',
        uom_code: null,
        quantity: 2,
        unit_price: '92.00',
        compare_at_price: '100.00',
        net_amount: '184.00',
        tax_rate: '0.1800',
        source,
        price_list_id: source === 'price_list' ? 'dddd1111-1111-4111-8111-111111111111' : null,
        price_list_code: source === 'price_list' ? 'mayorista' : null,
        scope: source === 'price_list' ? 'store' : null,
        min_quantity: source === 'price_list' ? '1.000000' : null,
      },
    ],
  }
}

function backend(options: { quote?: (args: Record<string, unknown>) => unknown } = {}): FakeSupabase {
  return createFakeSupabase({
    tables: {
      public_stores: [store()],
      public_categories: [],
      public_products: [],
      public_product_images: [],
    },
    ...(options.quote ? { rpc: { [PRICE_QUOTE_PUBLIC_RPC]: options.quote } } : {}),
  })
}

function renderCart(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route path="cart" element={<StoreCartPage />} />
      </Route>
    </Routes>,
    { route: '/s/la-tienda/cart' },
  )
}

/**
 * El resumen, acotado.
 *
 * Los importes de las LINEAS tambien aparecen en la pagina, asi que afirmar
 * sobre `screen` entero confundiria «el carrito sigue diciendo 200» con «la
 * linea vale 200», que es justo la distincion que estos tests defienden.
 */
function resumen(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Resumen' })
  return heading.parentElement as HTMLElement
}

beforeEach(() => {
  holder.client = null
  localStorage.clear()
  localStorage.setItem(
    `ebim.ecommerce.cart.v1:${STORE}`,
    JSON.stringify({ store_id: STORE, lines: [LINEA_SILLA] }),
  )
})

describe('el resumen del carrito lo decide el servidor', () => {
  it('cuando la cotización llega, manda ella y no el subtotal guardado', async () => {
    renderCart(backend({ quote: () => cotizacion() }))

    // El carrito guardaba 2 × 100.00 = 200.00; el servidor dice 184.00.
    //
    // Desde P19 ese importe sale DOS veces —en la linea y en el resumen— porque
    // la linea tambien pinta lo cotizado. No es ruido: con un acuerdo B2B el
    // resumen bajaba y la linea se quedaba en el precio de catalogo, y dos
    // numeros distintos para lo mismo en la misma pantalla es como se pierde la
    // confianza en el total. Por eso se afirma sobre el resumen y no sobre la
    // pantalla entera.
    await screen.findAllByText('S/ 184.00')
    const card = resumen()
    expect(within(card).getByText('S/ 184.00')).toBeInTheDocument()
    expect(within(card).queryByText('S/ 200.00')).not.toBeInTheDocument()
    expect(within(card).getByText('S/ 33.12')).toBeInTheDocument()
    expect(within(card).getByText('S/ 217.12')).toBeInTheDocument()
    expect(within(card).getByText('Precio confirmado por la tienda')).toBeInTheDocument()
  })

  it('avisa de que el precio salió de un acuerdo y no del catálogo', async () => {
    renderCart(backend({ quote: () => cotizacion('price_list') }))
    expect(await screen.findByText('Precio especial')).toBeInTheDocument()
  })

  it('sin acuerdo aplicado no promete un precio especial', async () => {
    renderCart(backend({ quote: () => cotizacion('catalog') }))
    await screen.findAllByText('S/ 184.00')
    expect(within(resumen()).queryByText('Precio especial')).not.toBeInTheDocument()
  })

  it('en la petición viajan el slug y qué se compra: ni un precio', async () => {
    const calls: Array<Record<string, unknown>> = []
    renderCart(
      backend({
        quote: (args) => {
          calls.push(args)
          return cotizacion()
        },
      }),
    )

    await screen.findAllByText('S/ 184.00')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      p_store_slug: 'la-tienda',
      p_items: [{ product_id: P_SILLA, quantity: 2 }],
    })

    const enviado = JSON.stringify(calls[0])
    for (const prohibido of ['unit_price', 'price', 'currency', 'store_id', 'channel']) {
      expect(`${prohibido}: ${enviado.includes(prohibido)}`).toBe(`${prohibido}: false`)
    }
  })

  it('si la cotización falla, el carrito sigue vivo con su subtotal y lo advierte', async () => {
    // Sin handler de la función: el doble responde «rpc no simulada», que es la
    // forma más parecida a una tienda con la red caída.
    renderCart(backend())

    expect(
      await screen.findByText('No pudimos confirmar los precios. Se muestran los del catálogo.'),
    ).toBeInTheDocument()
    expect(within(resumen()).getByText('S/ 200.00')).toBeInTheDocument()
    // Y el botón de pagar sigue ahí: no poder adelantar el total no bloquea la
    // compra, porque quien la valora de verdad es `create_order`.
    expect(screen.getByRole('link', { name: 'Finalizar compra' })).toBeInTheDocument()
  })
})
