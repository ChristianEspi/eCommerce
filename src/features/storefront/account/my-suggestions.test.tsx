import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'

/**
 * El sugerido de pedido, desde la cuenta del comprador.
 *
 * Antes el comprador no lo veía en ningún sitio: la tienda lo marcaba
 * «Enviado» y «Enviar» no enviaba nada. Lo que se fija aquí es lo que el
 * comprador hace con él: que pasarlo al carrito ponga las líneas con su
 * cantidad, que lo que ya no se vende se diga en vez de desaparecer en
 * silencio, y que aceptar no sea confirmar un pedido.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const PRODUCTO = '0a000000-0000-4000-8000-0000000000f1'
const RETIRADO = '0a000000-0000-4000-8000-0000000000f2'

vi.mock('../api', () => ({
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    ids.filter((id) => id === PRODUCTO).map((id) => ({ product_id: id, store_id: STORE_A, name: 'Alitraq' })),
  ),
  fetchPublicVariants: vi.fn(async () => []),
}))

const { MySuggestionsSection } = await import('./MySuggestionsSection')
const { CartContext } = await import('../cart/cart-context')

const SUGERIDO = '0a000000-0000-4000-8000-0000000000aa'

function sugeridos() {
  return [
    {
      id: SUGERIDO,
      store_id: STORE_A,
      generated_at: '2026-09-12T10:00:00.000Z',
      customer_name: 'Policlinico Andino',
      items: [
        { product_id: PRODUCTO, variant_id: null, name: 'Alitraq Polvo Oral', sku: 'QS-1', quantity: '12.000', reason: 'Compró 12 en los últimos 30 días' },
        { product_id: RETIRADO, variant_id: null, name: 'Producto retirado', sku: 'QS-2', quantity: '3.000', reason: 'Compró 3 en los últimos 30 días' },
      ],
    },
  ]
}

function pintar() {
  const fake = createFakeSupabase({
    session: makeSession(),
    rpc: {
      my_order_suggestions: () => sugeridos(),
      accept_order_suggestion: () => [
        { product_id: PRODUCTO, variant_id: null, quantity: '12.000' },
        { product_id: RETIRADO, variant_id: null, quantity: '3.000' },
      ],
      discard_order_suggestion: () => null,
    },
  })
  holder.client = fake
  const add = vi.fn(async () => true)
  const openCart = vi.fn()
  const cart = { add, openCart } as unknown as CartApi
  renderWithProviders(
    <CartContext.Provider value={cart}>
      <MySuggestionsSection storeId={STORE_A} />
    </CartContext.Provider>,
    { session: fake.state.session },
  )
  return { fake, add, openCart }
}

beforeEach(() => {
  holder.client = null
})

describe('sugeridos del comprador', () => {
  it('enseña cada línea con su cantidad y el motivo', async () => {
    pintar()
    expect(await screen.findByText('Alitraq Polvo Oral')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Compró 12 en los últimos 30 días')).toBeInTheDocument()
  })

  it('pasarlo al carrito añade lo disponible y dice cuánto quedó fuera', async () => {
    const user = userEvent.setup()
    const { fake, add, openCart } = pintar()

    await user.click(await screen.findByRole('button', { name: 'Pasar al carrito' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ product_id: PRODUCTO }), 12, null)
    expect(await screen.findByText('Añadimos 1 productos al carrito; 1 ya no están disponibles.')).toBeInTheDocument()
    expect(openCart).toHaveBeenCalled()
    // Aceptar va por su función: ningún pedido se crea desde aquí.
    expect(fake.state.rpcCalls.map((c) => c.name)).toContain('accept_order_suggestion')
    expect(fake.state.invocations).toEqual([])
  })

  it('descartarlo llama a su función con el id y nada más', async () => {
    const user = userEvent.setup()
    const { fake } = pintar()

    await user.click(await screen.findByRole('button', { name: 'Descartar' }))

    await waitFor(() =>
      expect(fake.state.rpcCalls.find((c) => c.name === 'discard_order_suggestion')?.args).toEqual({
        p_suggestion_id: SUGERIDO,
      }),
    )
  })

  it('los sugeridos de otra tienda no se enseñan en esta', async () => {
    const fake = createFakeSupabase({
      session: makeSession(),
      rpc: { my_order_suggestions: () => sugeridos().map((s) => ({ ...s, store_id: 'otra-tienda' })) },
    })
    holder.client = fake
    renderWithProviders(<MySuggestionsSection storeId={STORE_A} />, { session: fake.state.session })

    expect(await screen.findByText('No tienes pedidos sugeridos')).toBeInTheDocument()
  })
})
