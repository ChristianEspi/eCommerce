import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'

/**
 * La cuenta del consumidor registrado (hardening H02-H04).
 *
 * Lo que se fija aquí:
 *  · quien entra sin cuenta de empresa ve SU cuenta, no un «no estás vinculado»;
 *  · sus pedidos salen de una función que solo recibe el slug de la tienda;
 *  · el detalle pinta los importes GUARDADOS y «volver a comprar» manda al
 *    carrito producto y cantidad —nunca el precio del pedido viejo—;
 *  · «Mis datos» solo escribe nombre y teléfono;
 *  · si la base todavía no tiene las funciones, se dice «no activada», no
 *    «algo salió mal».
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const PRODUCTO = '0c000000-0000-4000-8000-0000000000f1'
const RETIRADO = '0c000000-0000-4000-8000-0000000000f2'

vi.mock('../api', () => ({
  // El catálogo de HOY: el precio aquí es 15.00, el del pedido fue 12.50.
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    ids
      .filter((id) => id === PRODUCTO)
      .map((id) => ({ product_id: id, store_id: STORE_A, name: 'Jabón', price: '15.00' })),
  ),
  fetchPublicVariants: vi.fn(async () => []),
}))

const { MyOrdersSection } = await import('./MyOrdersSection')
const { ConsumerProfileSection } = await import('./ConsumerProfileSection')
const { ConsumerAddressesSection } = await import('./ConsumerAddressesSection')
const { CartContext } = await import('../cart/cart-context')

const PEDIDO = {
  order_id: '0c000000-0000-4000-8000-0000000000a1',
  order_number: 'T-0007',
  placed_at: '2026-09-10T15:00:00.000Z',
  status: 'pending',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  approval_status: 'not_required',
  currency: 'PEN',
  grand_total: '35.00',
  item_count: 3,
}

const DETALLE = {
  order_id: PEDIDO.order_id,
  order_number: PEDIDO.order_number,
  status: 'pending',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  placed_at: PEDIDO.placed_at,
  currency: 'PEN',
  subtotal: '35.00',
  discount_total: '0.00',
  tax_total: '0.00',
  shipping_total: '0.00',
  grand_total: '35.00',
  shipping_address: { address: 'Av. Primavera 120', city: 'Lima', country: 'PE' },
  items: [
    { product_id: PRODUCTO, variant_id: null, name: 'Jabón', sku: 'JAB-1', variant_label: null, quantity: 2, unit_price: '12.50', total: '25.00' },
    { product_id: RETIRADO, variant_id: null, name: 'Retirado', sku: 'RET-1', variant_label: null, quantity: 1, unit_price: '10.00', total: '10.00' },
  ],
  deliveries: [{ method_name: 'Envío a domicilio', state: 'pending' }],
}

function missing() {
  const error = new Error('Could not find the function public.my_consumer_orders(p_limit, p_store_slug) in the schema cache')
  Object.assign(error, { code: 'PGRST202' })
  throw error
}

beforeEach(() => {
  holder.client = null
})

describe('Mis pedidos del consumidor', () => {
  function pintar(rpc: Record<string, (args: Record<string, unknown>) => unknown>) {
    const fake = createFakeSupabase({ session: makeSession({ withTenantClaims: false }), rpc })
    holder.client = fake
    const add = vi.fn(async () => true)
    const openCart = vi.fn()
    const cart = { add, openCart } as unknown as CartApi
    renderWithProviders(
      <CartContext.Provider value={cart}>
        <MyOrdersSection storeSlug="tienda-a" source="consumer" storeId={STORE_A} />
      </CartContext.Provider>,
      { session: fake.state.session },
    )
    return { fake, add, openCart }
  }

  it('pide la lista con el slug de la tienda y NADA más', async () => {
    const { fake } = pintar({ my_consumer_orders: () => [PEDIDO] })

    expect(await screen.findByRole('button', { name: /T-0007/ })).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_consumer_orders')?.args).toEqual({
      p_store_slug: 'tienda-a',
      p_limit: 50,
    })
    // No toca el portal B2B.
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('my_business_orders')
  })

  it('el detalle pinta lo guardado y la entrega', async () => {
    const user = userEvent.setup()
    const { fake } = pintar({ my_consumer_orders: () => [PEDIDO], my_consumer_order_detail: () => DETALLE })

    await user.click(await screen.findByRole('button', { name: /T-0007/ }))
    const panel = await screen.findByRole('presentation')

    expect(within(panel).getByText('Jabón')).toBeInTheDocument()
    expect(within(panel).getAllByText('S/ 35.00').length).toBeGreaterThan(0)
    expect(within(panel).getByText('S/ 12.50 c/u')).toBeInTheDocument()
    expect(within(panel).getByText(/Envío a domicilio · Av\. Primavera 120, Lima, PE/)).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_consumer_order_detail')?.args).toEqual({
      p_store_slug: 'tienda-a',
      p_order_id: PEDIDO.order_id,
    })
  })

  it('volver a comprar manda producto y cantidad al carrito con el producto de HOY', async () => {
    const user = userEvent.setup()
    const { add, openCart, fake } = pintar({
      my_consumer_orders: () => [PEDIDO],
      my_consumer_order_detail: () => DETALLE,
    })

    await user.click(await screen.findByRole('button', { name: /T-0007/ }))
    await user.click(await screen.findByRole('button', { name: 'Volver a comprar' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    // El producto que entra es el del catálogo actual (15.00), no una línea
    // armada con el 12.50 del pedido.
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ product_id: PRODUCTO, price: '15.00' }), 2, null)
    expect(await screen.findByText('1 añadidos; 1 no disponibles.')).toBeInTheDocument()
    expect(openCart).toHaveBeenCalled()
    // Volver a comprar no crea nada en el servidor.
    expect(fake.state.invocations).toEqual([])
  })

  it('sin pedidos, un estado vacío que dice cómo aparecerán', async () => {
    pintar({ my_consumer_orders: () => [] })
    expect(await screen.findByText('Todavía no hay pedidos')).toBeInTheDocument()
  })

  it('si la base todavía no tiene la función, dice «no activada» y no «error»', async () => {
    pintar({ my_consumer_orders: missing })
    expect(await screen.findByText('Aún no disponible en esta tienda')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument()
  })
})

describe('Mis datos', () => {
  it('muestra el correo sin dejarlo editar y guarda solo nombre y teléfono', async () => {
    const user = userEvent.setup()
    const session = makeSession({ withTenantClaims: false, email: 'ana@consumidora.test' })
    const fake = createFakeSupabase({ session })
    holder.client = fake
    const update = vi.spyOn(fake.auth, 'updateUser')
    renderWithProviders(<ConsumerProfileSection />, { session })

    const correo = await screen.findByLabelText('Correo')
    expect(correo).toHaveValue('ana@consumidora.test')
    expect(correo).toHaveAttribute('readonly')

    await user.type(screen.getByLabelText('Nombre y apellido'), 'Ana Pérez')
    await user.type(screen.getByLabelText('Teléfono'), '+51 999 111 222')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({ data: { full_name: 'Ana Pérez', phone: '+51 999 111 222' } })
  })

  it('un teléfono con letras no se guarda', async () => {
    const user = userEvent.setup()
    const session = makeSession({ withTenantClaims: false })
    const fake = createFakeSupabase({ session })
    holder.client = fake
    const update = vi.spyOn(fake.auth, 'updateUser')
    renderWithProviders(<ConsumerProfileSection />, { session })

    await user.type(await screen.findByLabelText('Teléfono'), 'llámame')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/Teléfono no válido/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('Mis direcciones', () => {
  it('lista las direcciones de sus pedidos, la última usada primero', async () => {
    const fake = createFakeSupabase({
      session: makeSession({ withTenantClaims: false }),
      rpc: {
        my_checkout_profile: () => ({
          contact: { name: 'Ana', phone: '999' },
          addresses: [
            { address: 'Jr. Lampa 55', city: 'Lima', country: 'PE' },
            { address: 'Av. Primavera 120', city: 'Lima', country: 'PE' },
          ],
        }),
      },
    })
    holder.client = fake
    renderWithProviders(<ConsumerAddressesSection storeSlug="tienda-a" />, { session: fake.state.session })

    expect(await screen.findByText('Jr. Lampa 55')).toBeInTheDocument()
    expect(screen.getByText('Av. Primavera 120')).toBeInTheDocument()
    expect(screen.getByText('Última')).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_checkout_profile')?.args).toEqual({
      p_store_slug: 'tienda-a',
    })
  })

  it('sin direcciones, lo dice', async () => {
    const fake = createFakeSupabase({
      session: makeSession({ withTenantClaims: false }),
      rpc: { my_checkout_profile: () => ({ contact: null, addresses: [] }) },
    })
    holder.client = fake
    renderWithProviders(<ConsumerAddressesSection storeSlug="tienda-a" />, { session: fake.state.session })
    expect(await screen.findByText('Todavía no hay direcciones')).toBeInTheDocument()
  })
})
