import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession } from '@/test/supabaseMock'

/**
 * Favoritos: el corazón, el almacén y la lista.
 *
 * ## El fallo que da nombre a este archivo
 *
 * El catálogo se lee con el cliente ANÓNIMO de la vitrina —las policies
 * públicas son `to anon`—, y los favoritos se llamaban con ese mismo cliente.
 * Pero un favorito es de una PERSONA: `toggle_product_favorite` deriva quién es
 * del `sub` del JWT, y el cliente de la vitrina se crea con
 * `persistSession: false`, así que no lleva ninguno. La función levantaba
 * `SESION_REQUERIDA`, el hook revertía y el corazón se apagaba solo: desde
 * fuera, «no hace nada».
 *
 * Por eso la prueba mira CON QUÉ cliente se llama, no solo que se llame.
 */

const holder = vi.hoisted(() => ({
  anon: null as unknown,
  auth: null as unknown,
}))

vi.mock('@/shared/lib/supabase', () => ({
  // Dos clientes distintos a propósito: es justo lo que se está comprobando.
  tryGetSupabaseClient: () => holder.auth,
  getSupabaseClient: () => holder.auth,
  tryGetStorefrontClient: () => holder.anon,
  tryGetStorefrontRpcClient: () => holder.auth,
  getStorefrontClient: () => holder.anon,
}))

const { useFavorites, resetFavoritesCache } = await import('./useFavorites')

const STORE = 'd0000000-0000-4000-8000-0000000000a1'
const PRODUCTO = 'eeee1111-1111-4111-8111-111111111111'

function Harness() {
  const favorites = useFavorites(STORE)
  return (
    <button type="button" onClick={() => void favorites.toggle(PRODUCTO)}>
      {favorites.isFavorite(PRODUCTO) ? 'guardado' : 'guardar'}
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
  // Los favoritos son UN conjunto por tienda para toda la aplicación —si no, el
  // corazón de una tarjeta y el botón de la cabecera se contradicen—, y ese
  // conjunto vive en el módulo. Entre casos hay que vaciarlo o el segundo
  // empieza con lo que guardó el primero.
  resetFavoritesCache()
  holder.anon = createFakeSupabase({ rpc: {} })
})

describe('Favoritos', () => {
  it('sin sesión se guardan en el navegador, que es lo que el comprador espera', async () => {
    const user = userEvent.setup()
    holder.auth = createFakeSupabase({ rpc: {} })
    renderWithProviders(<Harness />)

    await user.click(await screen.findByRole('button', { name: 'guardar' }))

    expect(await screen.findByRole('button', { name: 'guardado' })).toBeInTheDocument()
    expect(localStorage.getItem(`ebim.favoritos.${STORE}`) ?? localStorage.getItem(`ebim.favorites.${STORE}`))
      .toContain(PRODUCTO)
  })

  it('con sesión llama al servidor CON el cliente que lleva el JWT', async () => {
    const user = userEvent.setup()
    const session = makeSession()
    const auth = createFakeSupabase({
      session,
      rpc: {
        my_product_favorites: () => [],
        toggle_product_favorite: () => true,
      },
    })
    holder.auth = auth
    renderWithProviders(<Harness />, { session })

    await user.click(await screen.findByRole('button', { name: 'guardar' }))

    await waitFor(() =>
      expect(auth.state.rpcCalls.map((call) => call.name)).toContain('toggle_product_favorite'),
    )
    // Y NO por el anónimo: ahí la función se quedaría sin usuario.
    const anon = holder.anon as { state: { rpcCalls: Array<{ name: string }> } }
    expect(anon.state.rpcCalls.map((call) => call.name)).not.toContain('toggle_product_favorite')
    expect(await screen.findByRole('button', { name: 'guardado' })).toBeInTheDocument()
  })

  it('si el servidor rechaza, el corazón no miente: vuelve atrás', async () => {
    const user = userEvent.setup()
    const session = makeSession()
    holder.auth = createFakeSupabase({
      session,
      rpc: {
        my_product_favorites: () => [],
        toggle_product_favorite: () => {
          throw new Error('SESION_REQUERIDA')
        },
      },
    })
    renderWithProviders(<Harness />, { session })

    await user.click(await screen.findByRole('button', { name: 'guardar' }))

    // Se enciende optimista y se apaga al fallar: una lista que dice guardar lo
    // que no guardó es peor que un corazón que se apaga.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'guardar' })).toBeInTheDocument(),
    )
  })
})
