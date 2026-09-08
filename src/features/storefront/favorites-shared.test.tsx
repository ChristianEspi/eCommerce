import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase } from '@/test/supabaseMock'

/**
 * Un solo conjunto de favoritos para toda la tienda.
 *
 * El fallo se veía así: marcabas el corazón de una tarjeta y el botón de
 * favoritos de la cabecera seguía sin aparecer —solo se pinta cuando hay algo
 * guardado— hasta recargar la página. No era un fallo de la cabecera: eran dos
 * componentes con su propio `useState` sobre el mismo dato, o sea dos copias
 * que se contradicen.
 *
 * Aquí se compra la propiedad que lo arregla: dos consumidores del mismo
 * `storeId` ven lo mismo, en el mismo render, sin recargar nada.
 */

const holder = vi.hoisted(() => ({ anon: null as unknown, auth: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.auth,
  getSupabaseClient: () => holder.auth,
  tryGetStorefrontClient: () => holder.anon,
  tryGetStorefrontRpcClient: () => holder.auth,
  getStorefrontClient: () => holder.anon,
}))

const { useFavorites, resetFavoritesCache } = await import('./useFavorites')

const STORE = 'd0000000-0000-4000-8000-0000000000a1'
const OTRA_TIENDA = 'd0000000-0000-4000-8000-0000000000b2'
const PRODUCTO = 'eeee1111-1111-4111-8111-111111111111'

/** La tarjeta: marca. */
function Tarjeta({ storeId = STORE }: { storeId?: string }) {
  const favorites = useFavorites(storeId)
  return (
    <button type="button" onClick={() => void favorites.toggle(PRODUCTO)}>
      marcar
    </button>
  )
}

/** La cabecera: solo se pinta cuando hay algo guardado, como en la tienda. */
function Cabecera({ storeId = STORE }: { storeId?: string }) {
  const favorites = useFavorites(storeId)
  if (favorites.ids.size === 0) return null
  return <span>Favoritos {favorites.ids.size}</span>
}

beforeEach(() => {
  localStorage.clear()
  resetFavoritesCache()
  holder.anon = createFakeSupabase({ rpc: {} })
  holder.auth = createFakeSupabase({ rpc: {} })
})

describe('los favoritos son un solo conjunto por tienda', () => {
  it('marcar en una tarjeta enciende el contador de la cabecera SIN recargar', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <Cabecera />
        <Tarjeta />
      </>,
    )

    expect(screen.queryByText(/Favoritos/)).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'marcar' }))

    expect(await screen.findByText('Favoritos 1')).toBeInTheDocument()
  })

  it('desmarcar lo apaga en los dos sitios', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <Cabecera />
        <Tarjeta />
      </>,
    )

    await user.click(await screen.findByRole('button', { name: 'marcar' }))
    await screen.findByText('Favoritos 1')

    await user.click(screen.getByRole('button', { name: 'marcar' }))

    await waitFor(() => expect(screen.queryByText(/Favoritos/)).not.toBeInTheDocument())
  })

  it('cada tienda tiene los suyos: marcar en una no enciende la otra', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <Cabecera storeId={OTRA_TIENDA} />
        <Tarjeta />
      </>,
    )

    await user.click(await screen.findByRole('button', { name: 'marcar' }))

    // Un favorito es de una tienda: enseñarlo en otra sería contarle a un
    // comercio lo que alguien guardó en el de al lado.
    await waitFor(() => expect(screen.queryByText(/Favoritos/)).not.toBeInTheDocument())
  })
})
