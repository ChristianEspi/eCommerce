import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * El surtido de la empresa se respeta en la tienda (2026-11-16).
 *
 * Un comprador B2B con lista blanca podía buscar cualquier producto, añadirlo y
 * pagarlo por el checkout normal. Ahora:
 *
 *  1. en la ficha, lo que está fuera de su surtido se ve pero no se compra;
 *  2. en el carrito, la línea se marca y no se pasa a pagar hasta quitarla;
 *  3. sin sesión no se pregunta (no hay cuenta ni surtido que resolver).
 *
 * La autoridad es la base (trigger en `order_items`); esto es el aviso.
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
const { StoreProductPage } = await import('./StoreProductPage')
const { StoreCartPage } = await import('./StoreCartPage')
const { MY_ASSORTMENT_BLOCKED_RPC } = await import('@/shared/lib/db-schema')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const P_SILLA = 'cccc1111-1111-4111-8111-111111111111'

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

function backend(session: ReturnType<typeof makeSession> | null, bloqueados: string[]): FakeSupabase {
  return createFakeSupabase({
    session,
    tables: {
      public_stores: [store()],
      public_categories: [],
      public_products: [producto()],
      public_product_images: [],
    },
    rpc: { [MY_ASSORTMENT_BLOCKED_RPC]: () => bloqueados },
  })
}

function render(fake: FakeSupabase, route: string, session: ReturnType<typeof makeSession> | null) {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
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

describe('la ficha respeta el surtido de la empresa', () => {
  it('fuera de surtido: aviso y sin botón de compra activo', async () => {
    const sesion = makeSession()
    render(backend(sesion, [P_SILLA]), '/s/casa-nordica/product/silla-roble', sesion)

    expect(await screen.findByText(/no está en el surtido de tu empresa/)).toBeInTheDocument()
    for (const boton of screen.getAllByRole('button', { name: 'Agregar al carrito' })) {
      expect(boton).toBeDisabled()
    }
  })

  it('dentro de surtido: se compra como siempre', async () => {
    const sesion = makeSession()
    const fake = backend(sesion, [])
    render(fake, '/s/casa-nordica/product/silla-roble', sesion)

    const [boton] = await screen.findAllByRole('button', { name: 'Agregar al carrito' })
    await vi.waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === MY_ASSORTMENT_BLOCKED_RPC)).toBe(true))
    expect(boton).toBeEnabled()
    expect(screen.queryByText(/no está en el surtido de tu empresa/)).not.toBeInTheDocument()
  })

  it('sin sesión ni siquiera se pregunta', async () => {
    const fake = backend(null, [P_SILLA])
    render(fake, '/s/casa-nordica/product/silla-roble', null)

    const [boton] = await screen.findAllByRole('button', { name: 'Agregar al carrito' })
    expect(boton).toBeEnabled()
    expect(fake.state.rpcCalls.some((c) => c.name === MY_ASSORTMENT_BLOCKED_RPC)).toBe(false)
  })
})

describe('el carrito no deja pagar lo que está fuera de surtido', () => {
  beforeEach(() => {
    localStorage.setItem(
      `ebim.ecommerce.cart.v1:${STORE}`,
      JSON.stringify({
        store_id: STORE,
        lines: [
          {
            product_id: P_SILLA,
            variant_id: null,
            variant_name: null,
            slug: 'silla-roble',
            name: 'Silla de roble',
            unit_price: '100.00',
            currency: 'PEN',
            image_path: null,
            quantity: 1,
          },
        ],
      }),
    )
  })

  it('marca la línea, avisa y apaga «Finalizar compra»', async () => {
    const sesion = makeSession()
    render(backend(sesion, [P_SILLA]), '/s/casa-nordica/cart', sesion)

    expect(await screen.findByText(/Quítalos para continuar con el pago/)).toBeInTheDocument()
    expect(screen.getAllByText(/quítalo para continuar/).length).toBeGreaterThan(0)
    const pagar = screen.getAllByRole('link', { name: 'Finalizar compra' })
      .concat(screen.queryAllByRole('button', { name: 'Finalizar compra' }))
    expect(pagar.length).toBeGreaterThan(0)
    for (const b of pagar) expect(b).toHaveAttribute('aria-disabled', 'true')
  })

  it('sin bloqueos, el carrito pasa a pagar', async () => {
    const sesion = makeSession()
    render(backend(sesion, []), '/s/casa-nordica/cart', sesion)

    const [pagar] = await screen.findAllByRole('link', { name: 'Finalizar compra' })
    expect(pagar).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText(/Quítalos para continuar con el pago/)).not.toBeInTheDocument()
  })
})
