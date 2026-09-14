import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Crear cuenta de consumidor desde la tienda (N02).
 *
 * Lo que se fija:
 *  · la alta manda a Auth correo normalizado, contraseña y SOLO nombre y
 *    teléfono como metadatos: ni organización, ni sociedad, ni rol;
 *  · no llama a ninguna función ni Edge Function (no hay tenant que crear);
 *  · el enlace del correo vuelve a una ruta INTERNA de esta tienda;
 *  · con sesión inmediata entra a «Mi cuenta» de la tienda; con confirmación
 *    por correo lo dice;
 *  · la cuenta recién creada ve la cuenta de consumidor, no el portal B2B.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StoreRegisterPage } = await import('./StoreRegisterPage')
const { StoreAccountPage } = await import('./StoreAccountPage')

const STORE = {
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  slug: 'marathon',
  name: 'Marathon Sports',
  currency: 'PEN',
  accent_color: '#056769',
  logo_url: null,
  white_label: false,
  default_locale: 'es',
}

function Donde() {
  const location = useLocation()
  return <p data-testid="donde">{location.pathname}</p>
}

function pintar(options: { confirmEmail?: boolean; route?: string; cuentaReal?: boolean } = {}) {
  const fake: FakeSupabase = createFakeSupabase({
    confirmEmail: options.confirmEmail ?? false,
    rpc: { my_business_accounts: () => [], my_pending_business_accounts: () => [] },
  })
  holder.client = fake
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<Outlet context={{ store: STORE, storeSlug: 'marathon' }} />}>
        <Route path="register" element={<StoreRegisterPage />} />
        <Route path="account" element={options.cuentaReal ? <StoreAccountPage /> : <Donde />} />
        <Route path="cart" element={<Donde />} />
      </Route>
      <Route path="*" element={<Donde />} />
    </Routes>,
    { route: options.route ?? '/s/marathon/register', liveSession: true },
  )
  return fake
}

async function rellenar(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Nombre y apellido/), 'Ana Consumidora')
  await user.type(screen.getByLabelText(/^Correo/), '  Ana.Compra@Correo.TEST ')
  await user.type(screen.getByLabelText(/^Teléfono/), '+51 999 111 222')
  await user.type(screen.getByLabelText(/^Contraseña/), 'clave-segura-1')
  await user.type(screen.getByLabelText(/^Repite la contraseña/), 'clave-segura-1')
  await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
}

beforeEach(() => {
  holder.client = null
})

describe('StoreRegisterPage', () => {
  it('crea SOLO la cuenta de acceso: metadatos seguros, sin tenant ni funciones', async () => {
    const user = userEvent.setup()
    const fake = pintar()
    await rellenar(user)

    await waitFor(() => expect(fake.state.signUps).toHaveLength(1))
    const alta = fake.state.signUps[0] as { email: string; password: string; options: { data: Record<string, unknown>; emailRedirectTo: string } }
    expect(alta.email).toBe('ana.compra@correo.test')
    expect(alta.password).toBe('clave-segura-1')
    expect(alta.options.data).toEqual({ full_name: 'Ana Consumidora', phone: '+51 999 111 222' })
    for (const prohibida of ['organization_id', 'org_id', 'company_id', 'companies', 'role', 'tenant', 'apps']) {
      expect(Object.keys(alta.options.data)).not.toContain(prohibida)
    }
    expect(alta.options.emailRedirectTo).toBe(`${window.location.origin}/s/marathon/account`)
    // Nada que dé de alta un tenant, una membresía o una cuenta de empresa.
    expect(fake.state.invocations).toEqual([])
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('bootstrap_tenant')
  })

  it('con sesión inmediata entra a «Mi cuenta» de ESTA tienda', async () => {
    const user = userEvent.setup()
    pintar()
    await rellenar(user)
    expect(await screen.findByTestId('donde')).toHaveTextContent('/s/marathon/account')
  })

  it('y esa cuenta nueva ve la cuenta de consumidor, no el portal B2B ni el alta de empresa', async () => {
    const user = userEvent.setup()
    pintar({ cuentaReal: true })
    await rellenar(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Estado de cuenta' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Créala ahora/)).not.toBeInTheDocument()
  })

  it('si el proyecto exige confirmar el correo, lo dice y no entra', async () => {
    const user = userEvent.setup()
    pintar({ confirmEmail: true })
    await rellenar(user)
    expect(await screen.findByRole('status')).toHaveTextContent('Te enviamos un correo a ana.compra@correo.test')
    expect(screen.queryByTestId('donde')).not.toBeInTheDocument()
  })

  it('respeta un `from` de ESTA tienda, e ignora el de otra tienda o uno externo', async () => {
    const user = userEvent.setup()
    const fake = pintar({ route: '/s/marathon/register?from=%2Fs%2Fmarathon%2Fcart' })
    await rellenar(user)
    expect(await screen.findByTestId('donde')).toHaveTextContent('/s/marathon/cart')
    expect((fake.state.signUps[0] as { options: { emailRedirectTo: string } }).options.emailRedirectTo).toBe(
      `${window.location.origin}/s/marathon/cart`,
    )
  })

  it.each([['%2F%2Fevil.com'], ['%2Fs%2Fotra-tienda%2Faccount'], ['https%3A%2F%2Fevil.com']])(
    'un from %s no manda fuera de la cuenta de esta tienda',
    async (malo) => {
      const user = userEvent.setup()
      const fake = pintar({ route: `/s/marathon/register?from=${malo}` })
      await rellenar(user)
      expect(await screen.findByTestId('donde')).toHaveTextContent('/s/marathon/account')
      expect((fake.state.signUps[0] as { options: { emailRedirectTo: string } }).options.emailRedirectTo).toBe(
        `${window.location.origin}/s/marathon/account`,
      )
    },
  )

  it('valida antes de enviar: contraseña corta y confirmación distinta', async () => {
    const user = userEvent.setup()
    const fake = pintar()
    await user.type(await screen.findByLabelText(/Nombre y apellido/), 'Ana')
    await user.type(screen.getByLabelText(/^Correo/), 'ana@correo.test')
    await user.type(screen.getByLabelText(/^Contraseña/), 'corta')
    await user.type(screen.getByLabelText(/^Repite la contraseña/), 'otra')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(await screen.findByText('Las dos contraseñas no coinciden')).toBeInTheDocument()
    expect(fake.state.signUps).toEqual([])
  })
})
