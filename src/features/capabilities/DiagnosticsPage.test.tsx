import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makePlatformContext,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * Área de diagnóstico (P02-SaaS).
 *
 * Existe para responder «¿por qué este cliente no ve el módulo?» sin abrir la
 * base de datos. Estas pruebas fijan las tres cosas que la hacen útil y la que
 * la haría peligrosa:
 *
 *  · enseña el ORIGEN de la configuración, no solo el veredicto;
 *  · enseña por qué un módulo está apagado (no contratado ≠ interruptor);
 *  · enseña los códigos que el hub manda y esta versión no conoce;
 *  · NO enseña ni una credencial.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CapabilitiesProvider } = await import('./CapabilitiesProvider')
const { DiagnosticsPage } = await import('./DiagnosticsPage')

function backend(options: {
  role?: 'owner' | 'admin' | 'viewer'
  context?: Record<string, unknown>
} = {}): FakeSupabase {
  const { role = 'admin', context = makePlatformContext() } = options
  return createFakeSupabase({
    session: makeSession(),
    rpc: { effective_capabilities: () => context },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'mi-negocio',
          name: 'Mi Negocio',
          status: 'active',
          currency: 'PEN',
        },
      ],
      tenant_feature_flags: [],
    },
  })
}

function renderPage() {
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <DiagnosticsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
}

beforeEach(() => {
  holder.client = backend()
  window.history.replaceState(null, '', '/app/diagnostics')
})

describe('DiagnosticsPage', () => {
  it('dice de dónde salió la configuración y cuál es la sociedad activa', async () => {
    holder.client = backend({
      context: makePlatformContext({ source: 'provisioning', plan: 'piloto' }),
    })
    renderPage()

    expect(
      await screen.findByText(/Configuración cargada por el operador/),
    ).toBeInTheDocument()
    expect(screen.getByText(COMPANY_A)).toBeInTheDocument()
    expect(screen.getByText(ORG)).toBeInTheDocument()
    expect(screen.getByText('piloto')).toBeInTheDocument()
  })

  /**
   * «Nunca hablamos con el hub» no es «el hub dice que no lo tienes». Son dos
   * incidencias distintas y solo una se arregla vendiendo algo.
   */
  it('distingue «sin contexto» de «no contratado»', async () => {
    renderPage()
    expect(await screen.findByText(/Nunca se leyó la configuración del hub/)).toBeInTheDocument()
  })

  it('separa el módulo no contratado del apagado por interruptor', async () => {
    holder.client = backend({
      context: makePlatformContext({
        source: 'hub',
        entitlements: ['ecommerce.payments', 'ecommerce.promotions'],
        flags: { promotions: false },
      }),
    })
    renderPage()

    await screen.findByRole('tab', { name: 'Módulos' })
    await userEvent.click(screen.getByRole('tab', { name: 'Módulos' }))

    const pagos = (await screen.findByText('payments')).closest('tr')
    const promos = screen.getByText('promotions').closest('tr')
    const precios = screen.getByText('pricing.lists').closest('tr')

    expect(within(pagos as HTMLElement).getByText('Activo')).toBeInTheDocument()
    expect(within(promos as HTMLElement).getByText('Apagado por interruptor')).toBeInTheDocument()
    expect(within(precios as HTMLElement).getByText('No contratado')).toBeInTheDocument()
  })

  /**
   * Un código que el hub manda y esta versión no conoce es la señal de que el
   * catálogo va por delante del binario desplegado. Perderlo en silencio es
   * cómo un cliente jura haber comprado algo que no aparece por ningún lado.
   */
  it('avisa de los addons que esta versión no reconoce', async () => {
    holder.client = backend({
      context: makePlatformContext({
        source: 'hub',
        entitlements: ['ecommerce.todavia-no-existe'],
      }),
    })
    renderPage()

    await userEvent.click(await screen.findByRole('tab', { name: 'Módulos' }))
    expect(
      await screen.findByText(/El hub declara módulos que esta versión no conoce/),
    ).toBeInTheDocument()
    expect(screen.getByText('ecommerce.todavia-no-existe')).toBeInTheDocument()
  })

  /** Lo baseline no lleva interruptor: sería un botón de caída, no una opción. */
  it('no ofrece apagar un módulo incluido', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Módulos' }))

    const catalogo = (await screen.findByText('catalog')).closest('tr')
    expect(within(catalogo as HTMLElement).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('un rol sin `tenant.manage` no entra', async () => {
    holder.client = backend({ role: 'viewer' })
    renderPage()
    expect(await screen.findByText('No tienes acceso a esto')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Módulos' })).not.toBeInTheDocument()
  })

  /**
   * La prueba que impide que un panel de soporte se vuelva una filtración: se
   * puede enseñar el host del proyecto —ya viaja en cada petición— pero jamás
   * una clave, ni siquiera la publicable.
   */
  it('no pinta ninguna credencial', async () => {
    renderPage()
    await screen.findByText(/Nunca se leyó la configuración del hub/)

    const texto = document.body.textContent ?? ''
    expect(texto).not.toMatch(/sb_publishable|sb_secret|service_role|eyJhbGciOi/)
    expect(texto).not.toMatch(/Bearer /)
  })

  it('el botón de refresco llama a la Edge Function, no al hub desde el navegador', async () => {
    renderPage()
    const client = holder.client as FakeSupabase
    await userEvent.click(await screen.findByRole('button', { name: /Volver a leer del hub/ }))

    expect(client.state.invocations.map((i) => i.name)).toContain('platform-context')
    expect(client.state.invocations[0]?.body).toEqual({ action: 'refresh' })
  })
})
