import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Login y recuperación que saben de dónde se vino (N02).
 *
 *  · desde la vitrina, entrar vuelve a la vitrina y la acción secundaria es
 *    «crea tu cuenta» en esa tienda, no el alta de empresa;
 *  · desde el backoffice (o sin `from`), todo igual que antes: `/app` y
 *    onboarding;
 *  · la vuelta nunca sale del sitio, la pida quien la pida.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { LoginPage } = await import('./LoginPage')
const { ForgotPasswordPage } = await import('./ForgotPasswordPage')
const { ResetPasswordPage } = await import('./ResetPasswordPage')

function Donde() {
  const location = useLocation()
  return <p data-testid="donde">{`${location.pathname}${location.search}`}</p>
}

function pintar(route: string, session: ReturnType<typeof makeSession> | null = null) {
  const fake: FakeSupabase = createFakeSupabase({ session })
  holder.client = fake
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/recuperar" element={<ForgotPasswordPage />} />
      <Route path="/nueva-clave" element={<ResetPasswordPage />} />
      <Route path="*" element={<Donde />} />
    </Routes>,
    { route, liveSession: true },
  )
  return fake
}

async function entrar(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Correo corporativo'), 'ana@correo.test')
  await user.type(screen.getByLabelText('Contraseña'), 'clave-segura-1')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

beforeEach(() => {
  holder.client = null
})

describe('login desde la vitrina', () => {
  it('/s/marathon/account → login → vuelve a /s/marathon/account (no a /app)', async () => {
    const user = userEvent.setup()
    pintar('/login?from=%2Fs%2Fmarathon%2Faccount')
    await entrar(user)
    expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/s\/marathon\/account$/)
  })

  it('ofrece crear cuenta en ESA tienda en vez del alta de empresa', async () => {
    pintar('/login?from=%2Fs%2Fmarathon%2Faccount')
    const crear = await screen.findByRole('link', { name: '¿Primera vez en la tienda? Crea tu cuenta' })
    expect(crear).toHaveAttribute('href', '/s/marathon/register')
    expect(screen.queryByRole('link', { name: /Créala ahora/ })).not.toBeInTheDocument()
  })

  it('«¿Olvidaste tu contraseña?» conserva la vuelta y el correo vuelve a la cuenta de la tienda', async () => {
    const user = userEvent.setup()
    const fake = pintar('/login?from=%2Fs%2Fmarathon%2Faccount')
    await user.click(await screen.findByRole('link', { name: '¿Olvidaste tu contraseña?' }))
    await user.type(await screen.findByLabelText('Correo corporativo'), 'ana@correo.test')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))
    await waitFor(() => expect(fake.state.resetRequests).toHaveLength(1))
    expect(fake.state.resetRequests[0]?.options).toEqual({
      redirectTo: `${window.location.origin}/nueva-clave?returnTo=%2Fs%2Fmarathon%2Faccount`,
    })
  })
})

describe('login del backoffice, igual que siempre', () => {
  it('sin from: entrar lleva a /app y la secundaria es el alta de empresa', async () => {
    const user = userEvent.setup()
    pintar('/login')
    expect(await screen.findByRole('link', { name: /Créala ahora/ })).toHaveAttribute('href', '/onboarding')
    await entrar(user)
    expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/app$/)
  })

  it('con from del backoffice vuelve ahí y no ofrece registro de consumidor', async () => {
    const user = userEvent.setup()
    pintar('/login?from=%2Fapp%2Forders')
    expect(screen.queryByRole('link', { name: /Crea tu cuenta/ })).not.toBeInTheDocument()
    await entrar(user)
    expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/app\/orders$/)
  })

  it.each([['%2F%2Fevil.com'], ['https%3A%2F%2Fevil.com'], ['%2F%5Cevil.com']])(
    'un from %s no es un redirector: acaba en /app',
    async (malo) => {
      const user = userEvent.setup()
      pintar(`/login?from=${malo}`)
      await entrar(user)
      expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/app$/)
    },
  )

  it('recuperar sin vuelta: el enlace es el de siempre', async () => {
    const user = userEvent.setup()
    const fake = pintar('/recuperar')
    await user.type(await screen.findByLabelText('Correo corporativo'), 'ana@correo.test')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))
    await waitFor(() => expect(fake.state.resetRequests).toHaveLength(1))
    expect(fake.state.resetRequests[0]?.options).toEqual({ redirectTo: `${window.location.origin}/nueva-clave` })
  })
})

describe('clave nueva: a dónde se vuelve', () => {
  async function fijar(route: string) {
    const user = userEvent.setup()
    pintar(route, makeSession({ withTenantClaims: false }))
    await user.type(await screen.findByLabelText('Contraseña nueva'), 'clave-nueva-123')
    await user.type(screen.getByLabelText('Repite la contraseña'), 'clave-nueva-123')
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
  }

  it('con returnTo de tienda, vuelve a la cuenta de la tienda', async () => {
    await fijar('/nueva-clave?returnTo=%2Fs%2Fmarathon%2Faccount')
    expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/s\/marathon\/account$/)
  })

  it('sin returnTo, /app como siempre', async () => {
    await fijar('/nueva-clave')
    expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/app$/)
  })

  it('un returnTo externo no se respeta', async () => {
    await fijar('/nueva-clave?returnTo=%2F%2Fevil.com')
    expect(await screen.findByTestId('donde')).toHaveTextContent(/^\/app$/)
  })
})
