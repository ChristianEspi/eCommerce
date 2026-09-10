import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/shared/i18n/I18nProvider'
import { AppearanceProvider } from '@/theme/AppearanceProvider'
import { DEFAULT_APPEARANCE } from '@/theme/appearance'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,

  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { SessionProvider } = await import('@/features/auth/SessionProvider')
const { routes } = await import('./routes')

/**
 * El alta escribe en el "backend" falso lo mismo que escribe la función
 * `bootstrap_tenant` de la base: tenant + membresía owner + tienda. Así el
 * paso siguiente del flujo lee datos coherentes en vez de un mock a medida.
 */
function fakeBackend(): FakeSupabase {
  const fake = createFakeSupabase({
    tables: { tenants: [], tenant_members: [], stores: [], products: [], orders: [] },
    rpc: {
      dashboard_kpis: () => ({ products: 3, published: 2, orders: 1, sales: '150.00', currency: 'PEN' }),
    },
  })

  fake.state.functions['bootstrap-tenant'] = (body) => {
    const slug = String(body.store_slug)
    fake.state.tables.tenants = [
      { organization_id: ORG, slug, name: String(body.tenant_name), status: 'active' },
    ]
    fake.state.tables.tenant_members = [
      {
        organization_id: ORG,
        company_id: COMPANY_A,
        user_id: USER,
        role: 'owner',
        status: 'active',
      },
    ]
    fake.state.tables.stores = [
      {
        id: STORE_A,
        organization_id: ORG,
        company_id: COMPANY_A,
        slug,
        name: String(body.tenant_name),
        status: 'draft',
        currency: String(body.currency),
      },
    ]
    return {
      organization_id: ORG,
      company_id: COMPANY_A,
      tenant_slug: slug,
      store_id: STORE_A,
      store_slug: slug,
      admin_email: 'duenio@negocio.com',
    }
  }

  return fake
}

function renderApp(initialPath: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

  // Se devuelve el router además del árbol: con `createMemoryRouter` la barra
  // del navegador no se mueve, así que `window.location` no sirve para afirmar
  // a dónde acabó una redirección.
  return {
    router,
    ...render(
      <I18nProvider initial="es">
        <AppearanceProvider initial={DEFAULT_APPEARANCE}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <RouterProvider router={router} />
            </SessionProvider>
          </QueryClientProvider>
        </AppearanceProvider>
      </I18nProvider>,
    ),
  }
}

describe('flujo login → onboarding → /app', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = fakeBackend()
    holder.client = fake
  })

  it('sin sesión, /app manda al login', async () => {
    renderApp('/app')
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('un usuario sin espacio entra, es llevado al alta y termina en el panel', async () => {
    const user = userEvent.setup()
    renderApp('/login')

    // 1 · Login
    await user.type(await screen.findByLabelText('Correo corporativo'), 'duenio@negocio.com')
    await user.type(screen.getByLabelText('Contraseña'), 'secreto123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    // 2 · Sin tenant → alta mínima, sin pasar por el backoffice
    expect(await screen.findByRole('heading', { name: 'Crea tu tienda' })).toBeInTheDocument()
    expect(screen.getByText('duenio@negocio.com')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Nombre del negocio'), 'Bodega Central')
    expect(screen.getByLabelText<HTMLInputElement>('Dirección de la tienda').value).toBe(
      'bodega-central',
    )
    // La moneda ya no viene con un default cableado: se elige. Es una decision
    // contable y practicamente inmutable tras el primer pedido.
    await user.click(screen.getByLabelText('Moneda'))
    await user.click(await screen.findByRole('option', { name: /^PEN/ }))

    await user.click(screen.getByRole('button', { name: 'Crear mi tienda' }))

    // 3 · Con espacio creado → panel con KPIs reales
    expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeInTheDocument()
    // El nombre aparece en el selector de tienda y en el encabezado del panel.
    await waitFor(() => expect(screen.getAllByText(/Bodega Central/).length).toBeGreaterThan(0))

    // El alta no declaró el tenant: lo derivó el servidor del token.
    expect(fake.state.invocations[0]?.body).not.toHaveProperty('organization_id')
    expect(fake.state.invocations[0]?.body).not.toHaveProperty('company_id')
  })

  it('quien ya tiene espacio va directo al panel y ve solo cifras reales', async () => {
    fake.state.session = makeSession()
    fake.state.tables.tenants = [
      { organization_id: ORG, slug: 'bodega', name: 'Bodega Central', status: 'active' },
    ]
    fake.state.tables.tenant_members = [
      { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'owner', status: 'active' },
    ]
    fake.state.tables.stores = [
      {
        id: STORE_A,
        organization_id: ORG,
        company_id: COMPANY_A,
        slug: 'bodega',
        name: 'Bodega Central',
        status: 'active',
        currency: 'PEN',
      },
    ]

    renderApp('/app')

    expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeInTheDocument()
    expect(await screen.findByText('3')).toBeInTheDocument()
    // «Publicados» deja de ser tarjeta propia: acompana al total de productos,
    // que es la comparacion que de verdad se lee. La cifra sigue siendo real.
    expect(screen.getByText(/2 publicados/)).toBeInTheDocument()
    expect(screen.getByText(/150[.,]00/)).toBeInTheDocument()
  })

  it('sin pedidos con moneda única, las ventas se muestran como guion y no como cero', async () => {
    fake.state.session = makeSession()
    fake.state.rpc.dashboard_kpis = () => ({
      products: 5,
      published: 0,
      orders: 0,
      sales: null,
      currency: null,
    })
    fake.state.tables.tenants = [
      { organization_id: ORG, slug: 'bodega', name: 'Bodega Central', status: 'active' },
    ]
    fake.state.tables.tenant_members = [
      { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'owner', status: 'active' },
    ]
    fake.state.tables.stores = [
      {
        id: STORE_A,
        organization_id: ORG,
        company_id: COMPANY_A,
        slug: 'bodega',
        name: 'Bodega Central',
        status: 'active',
        currency: 'PEN',
      },
    ]

    renderApp('/app')

    expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeInTheDocument()
    // TRES guiones con este escenario (5 productos, 0 publicados, 0 pedidos):
    // ventas y ticket medio, que sin moneda unica no se pueden afirmar, y el
    // medidor de pedidos cobrados, que sin pedidos no tiene sobre que calcular
    // una razon. En los tres casos un 0 se leeria como un dato.
    expect(await screen.findAllByText('—')).toHaveLength(3)
    expect(screen.getByText('Sin pedidos con una moneda única todavía')).toBeInTheDocument()
  })

  it('una sesión sin la jerarquía del hub no entra: no es un usuario nuevo', async () => {
    fake.state.session = makeSession({ withTenantClaims: false })
    renderApp('/app')

    expect(
      await screen.findByText('Tu cuenta no está habilitada para eCommerce'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Crea tu tienda' })).not.toBeInTheDocument()
  })

  /**
   * Un COMPRADOR no es un empleado sin permisos.
   *
   * Los dos llegan a `/app` con un token sin `org_id`, y desde el token no se
   * distinguen. Lo que los separa es un dato de servidor: el vínculo con una
   * cuenta B2B, que `my_business_accounts()` resuelve sin aceptar argumentos.
   * Para el comprador ese cartel era un final del que no se salía.
   */
  it('un comprador acaba en el panel de SU tienda, no en el cartel', async () => {
    // El destino sale del vínculo, no del despliegue: `my_stores()` resuelve
    // persona → cuenta B2B → sociedad → tiendas de esa sociedad. Y va al PANEL
    // de su cuenta: quien escribe la dirección del backoffice no viene a mirar
    // escaparate, viene a ver lo suyo.
    fake.state.session = makeSession({ withTenantClaims: false })
    fake.state.rpc.my_stores = () => [{ slug: 'botica-sur', name: 'Botica Sur' }]
    // La del despliegue es OTRA. Si el guard la usara, esta prueba lo cazaría.
    fake.state.tables.public_stores = [{ slug: 'bodega', name: 'Bodega Central' }]

    const { router } = renderApp('/app')

    await waitFor(() => expect(router.state.location.pathname).toBe('/s/botica-sur/account'))
    // Y el cartel no llega a quedarse: uno que dice «no estás habilitado» y se
    // va solo es peor que no enseñarlo.
    expect(
      screen.queryByText('Tu cuenta no está habilitada para eCommerce'),
    ).not.toBeInTheDocument()
  })

  it('con varias tiendas propias no se elige por él: se le enseñan las suyas', async () => {
    fake.state.session = makeSession({ withTenantClaims: false })
    fake.state.rpc.my_stores = () => [
      { slug: 'botica-sur', name: 'Botica Sur' },
      { slug: 'botica-norte', name: 'Botica Norte' },
    ]

    const { router } = renderApp('/app')

    const sur = await screen.findByRole('link', { name: 'Entrar a Botica Sur' })
    expect(sur).toHaveAttribute('href', '/s/botica-sur/account')
    expect(screen.getByRole('link', { name: 'Entrar a Botica Norte' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app')
  })

  it('sin vínculo de compra no se adivina: se deja el cartel y una puerta', async () => {
    // Mandar a la vitrina a un empleado mal configurado le esconde su problema
    // real, así que aquí no se redirige. Pero tampoco se le deja sin salida.
    fake.state.session = makeSession({ withTenantClaims: false })
    fake.state.rpc.my_stores = () => []
    fake.state.tables.public_stores = [{ slug: 'bodega', name: 'Bodega Central' }]

    renderApp('/app')

    expect(
      await screen.findByText('Tu cuenta no está habilitada para eCommerce'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Ver la tienda' })).toBeInTheDocument()
  })

  it('cerrar sesión devuelve al login', async () => {
    const user = userEvent.setup()
    fake.state.session = makeSession()
    fake.state.tables.tenants = [
      { organization_id: ORG, slug: 'bodega', name: 'Bodega Central', status: 'active' },
    ]
    fake.state.tables.tenant_members = [
      { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'owner', status: 'active' },
    ]
    fake.state.tables.stores = [
      {
        id: STORE_A,
        organization_id: ORG,
        company_id: COMPANY_A,
        slug: 'bodega',
        name: 'Bodega Central',
        status: 'active',
        currency: 'PEN',
      },
    ]

    renderApp('/app')
    await screen.findByRole('heading', { name: 'Resumen' })

    await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }))

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })
})
