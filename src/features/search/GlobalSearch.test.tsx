import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
} from '@/test/supabaseMock'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CapabilitiesProvider } = await import('@/features/capabilities/CapabilitiesProvider')
const { GlobalSearch } = await import('./GlobalSearch')

function backend(role: 'admin' | 'viewer' = 'admin') {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'casa-nordica',
          name: 'Casa Nórdica',
          status: 'active',
          currency: 'PEN',
        },
      ],
      orders: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          store_id: STORE_A,
          order_number: 'EC-20260827-00008',
          customer_name: 'Ana Compradora',
          customer_email: 'ana@compradora.test',
          placed_at: '2026-08-27T13:29:56Z',
        },
      ],
      products: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          store_id: STORE_A,
          sku: 'SIL-ROB-01',
          name: 'Silla de roble nórdica',
        },
      ],
    },
  })
}

function render(role: 'admin' | 'viewer' = 'admin') {
  holder.client = backend(role)
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <GlobalSearch />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('apertura', () => {
  it('se abre con Ctrl+K desde cualquier parte', async () => {
    const user = userEvent.setup()
    render()

    await screen.findByRole('button', { name: /Buscar en todo/ })
    await user.keyboard('{Control>}k{/Control}')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('la pista del atajo se enseña: uno que nadie descubre no existe', async () => {
    render()
    expect(await screen.findByText('Ctrl K')).toBeInTheDocument()
  })
})

describe('secciones', () => {
  it('encuentra pantallas por su nombre, no solo datos', async () => {
    // Un buscador que solo halla datos obliga a saberse el menú de memoria.
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: /Buscar en todo/ }))
    await user.type(screen.getByPlaceholderText(/Buscar pedidos/), 'produc')

    expect(await screen.findByText('Ir a')).toBeInTheDocument()
  })

  it('NUNCA ofrece una pantalla que el rol no puede abrir', async () => {
    // Es la razón por la que las secciones salen de `visibleNavItems` y no de
    // una lista propia: dos listas se separan y una de ellas se convierte en un
    // atajo a lo prohibido.
    const user = userEvent.setup()
    render('viewer')

    await user.click(await screen.findByRole('button', { name: /Buscar en todo/ }))
    await user.type(screen.getByPlaceholderText(/Buscar pedidos/), 'oper')

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    // «Operación» exige `tenant.manage`: la bitácora lleva dentro el correo de
    // cada operador. Configuración NO sirve para esta prueba: va sin permiso a
    // proposito, para que un tenant mal configurado pueda llegar a sus ajustes.
    expect(screen.queryByText('Operación')).not.toBeInTheDocument()
  })
})

describe('datos', () => {
  it('encuentra un pedido por su número', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: /Buscar en todo/ }))
    await user.type(screen.getByPlaceholderText(/Buscar pedidos/), '00008')

    expect(await screen.findByText('EC-20260827-00008')).toBeInTheDocument()
  })

  it('con una sola letra no consulta: no acota nada y cuesta lo mismo', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: /Buscar en todo/ }))
    await user.type(screen.getByPlaceholderText(/Buscar pedidos/), 'a')

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.queryByText('EC-20260827-00008')).not.toBeInTheDocument()
  })
})
