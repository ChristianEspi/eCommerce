import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession } from '@/test/supabaseMock'

/**
 * «Mi cuenta» › Preferencias (2026-11-20): el claro/oscuro salió de la cabecera
 * y vive aquí, solo si la tienda lo permite. Por defecto, claro.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorePreferencesSection } = await import('./StorePreferencesSection')

function pintar(showThemeOption: boolean) {
  const fake = createFakeSupabase({
    session: makeSession(),
    rpc: { my_cart_reminders: () => ({ store_enabled: false, receive: true }) },
  })
  holder.client = fake
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug/account" element={<StorePreferencesSection showThemeOption={showThemeOption} />} />
    </Routes>,
    { route: '/s/tienda/account', session: fake.state.session },
  )
}

describe('Preferencias del comprador', () => {
  it('con la opción permitida: empieza en claro y cambia a oscuro', async () => {
    const user = userEvent.setup()
    pintar(true)
    const claro = await screen.findByRole('button', { name: 'Claro' })
    const oscuro = screen.getByRole('button', { name: 'Oscuro' })
    expect(claro).toHaveAttribute('aria-pressed', 'true')
    await user.click(oscuro)
    expect(screen.getByRole('button', { name: 'Oscuro' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('si la tienda no lo permite, no se ofrece', async () => {
    pintar(false)
    expect(await screen.findByText('Preferencias')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Oscuro' })).not.toBeInTheDocument()
  })
})
