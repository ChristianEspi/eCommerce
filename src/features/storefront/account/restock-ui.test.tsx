/**
 * 2026-11-22 · Reposición predictiva en «Mi cuenta».
 *
 * Lo que se fija:
 *  · cada producto dice su motivo (cada cuánto lo pide y cuándo le toca);
 *  · se puede quitar uno y cambiar la cantidad; «Añadir» manda SKU + cantidad al
 *    verificador del pedido rápido, no al carrito a ciegas;
 *  · cambiar el periodo vuelve a preguntar con ese horizonte;
 *  · sin historial regular, un estado vacío que explica por qué.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'

const holder = vi.hoisted(() => ({
  fetch: vi.fn(),
  add: vi.fn(),
}))

vi.mock('../portal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../portal')>()),
  fetchMyReplenishment: holder.fetch,
}))
vi.mock('../quick-order/addBySku', () => ({ addSkuLinesToCart: holder.add }))

const { MyRestockSection } = await import('./MyRestockSection')
const { CartContext } = await import('../cart/cart-context')

const STORE = '99999999-9999-4999-8999-999999999999'

function pintar() {
  const cart = { cart: { lines: [] }, setQuantity: vi.fn(), add: vi.fn(), openCart: vi.fn() }
  renderWithProviders(
    <CartContext.Provider value={cart as never}>
      <MyRestockSection storeSlug="botica" storeId={STORE} />
    </CartContext.Provider>,
  )
  return cart
}

const item = (sku: string, nombre: string, cantidad: number, cada: number, dias: number) => ({
  sku,
  nombre,
  cantidad,
  compras: 3,
  cada_dias: cada,
  ultima_compra: '2026-11-10',
  le_toca: '2026-11-25',
  dias_restantes: dias,
})

beforeEach(() => {
  holder.fetch.mockReset()
  holder.add.mockReset()
})

describe('MyRestockSection', () => {
  it('muestra el motivo, deja ajustar y añade por el verificador', async () => {
    holder.fetch.mockResolvedValue([item('LEJ-5', 'Lejía 5 L', 2, 10, 2), item('JAB-1', 'Jabón líquido', 12, 14, -3)])
    holder.add.mockResolvedValue({ result: { added: 1, updated: 0, unchanged: 0, skipped: 0 }, rejected: 0, accepted: [] })
    const cart = pintar()

    expect(await screen.findByText('Sueles pedirlo cada 10 días · te toca en 2 días')).toBeInTheDocument()
    expect(screen.getByText('Sueles pedirlo cada 14 días · te tocaba hace 3 días')).toBeInTheDocument()
    expect(holder.fetch).toHaveBeenCalledWith('botica', 7)

    await userEvent.click(screen.getByRole('checkbox', { name: /jabón líquido/i }))
    const cantidad = screen.getByRole('textbox', { name: /cantidad · lejía 5 l/i })
    await userEvent.clear(cantidad)
    await userEvent.type(cantidad, '5')
    await userEvent.click(screen.getByRole('button', { name: /añadir 1 al carrito/i }))

    expect(holder.add).toHaveBeenCalledWith(expect.anything(), { storeId: STORE, storeSlug: 'botica' }, [{ row: 1, sku: 'LEJ-5', quantity: 5 }])
    expect(await screen.findByText('Listo, lo añadimos al carrito.')).toBeInTheDocument()
    expect(cart.openCart).toHaveBeenCalled()
  })

  it('el periodo cambia el horizonte; sin historial regular, estado vacío', async () => {
    holder.fetch.mockResolvedValue([])
    pintar()
    expect(await screen.findByText('Nada que reponer por ahora')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Próximas 4 semanas' }))
    expect(holder.fetch).toHaveBeenCalledWith('botica', 30)
  })
})
