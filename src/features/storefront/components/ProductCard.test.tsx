import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CartProvider } from '../cart/CartProvider'
import type { PublicProduct } from '../types'
import { ProductCard } from './ProductCard'

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => null,
  getSupabaseClient: () => null,
  tryGetStorefrontClient: () => null,
  tryGetStorefrontRpcClient: () => null,
  getStorefrontClient: () => null,
}))

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

function product(overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    product_id: 'cccc1111-1111-4111-8111-111111111111',
    store_id: STORE,
    category_id: null,
    slug: 'silla-roble',
    name: 'Silla de roble',
    description: null,
    price: '389.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: null,
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'simple',
    brand_name: null,
    variant_count: 0,
    price_from: null,
    ...overrides,
  } as PublicProduct
}

function render(item: PublicProduct, onQuickView = vi.fn()) {
  renderWithProviders(
    <CartProvider storeId={STORE} storeSlug="casa-nordica" currency="PEN">
      <ProductCard product={item} storeSlug="casa-nordica" onQuickView={onQuickView} />
    </CartProvider>,
  )
  return { onQuickView }
}

beforeEach(() => localStorage.clear())

describe('comprar desde la rejilla', () => {
  it('un producto simple entra al carrito sin salir del catálogo', async () => {
    const user = userEvent.setup()
    render(product())

    await user.click(await screen.findByRole('button', { name: 'Agregar al carrito' }))

    expect(localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)).toContain('silla-roble')
  })

  it('con variantes NO añade nada: lleva a elegir', async () => {
    // Meter «la primera» variante en el carrito es mandarle a alguien la talla
    // que no era. El color y la medida cambian precio y stock, así que esa
    // decisión no se toma por el comprador.
    const user = userEvent.setup()
    const { onQuickView } = render(product({ kind: 'variant', variant_count: 3 }))

    await user.click(await screen.findByRole('button', { name: 'Elegir opciones' }))

    expect(onQuickView).toHaveBeenCalledWith('silla-roble')
    expect(localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)).toBeNull()
  })

  it('sin stock el botón no se puede pulsar', async () => {
    render(product({ in_stock: false }))

    expect(await screen.findByRole('button', { name: 'Agregar al carrito' })).toBeDisabled()
  })
})

describe('la tarjeta sigue siendo navegable', () => {
  it('el nombre es un enlace de verdad a la ficha', async () => {
    // Se conserva tras meter el botón: el enlace pasó de envolver la tarjeta a
    // envolver el nombre —un `<button>` dentro de un `<a>` es HTML inválido—,
    // pero ctrl-clic, rueda y «abrir en pestaña nueva» tienen que seguir yendo
    // a la ficha, y un buscador tiene que poder indexarla.
    render(product())

    expect(await screen.findByRole('link', { name: 'Silla de roble' })).toHaveAttribute(
      'href',
      '/s/casa-nordica/product/silla-roble',
    )
  })

  it('un clic normal en el nombre abre la vista rápida, no navega', async () => {
    const user = userEvent.setup()
    const { onQuickView } = render(product())

    await user.click(await screen.findByRole('link', { name: 'Silla de roble' }))

    expect(onQuickView).toHaveBeenCalledWith('silla-roble')
  })
})
