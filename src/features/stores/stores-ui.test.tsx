import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'
import { mapStoreCode } from './errors'

/**
 * Tiendas en pantalla (Stores + Product Master, fase 02).
 *
 *  · la lista enseña todas las tiendas de la sociedad y cuál está en uso;
 *  · con una sola tienda la pantalla sigue siendo útil;
 *  · un rol sin `store.manage` no ve el alta ni el listado;
 *  · crear manda solo slug, nombre, moneda y dominio —nunca tenant— y la tienda
 *    nueva aparece sin recargar;
 *  · «Usar esta tienda» cambia la tienda activa del backoffice;
 *  · suspender pide confirmación; un error de la base se traduce.
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
const { CapabilitiesProvider } = await import('@/features/capabilities/CapabilitiesProvider')
const { StoresPage } = await import('./StoresPage')

const STORE_OUTLET = '55555555-5555-4555-8555-555555555502'

function tienda(id: string, slug: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    slug,
    name,
    status: 'active',
    currency: 'PEN',
    domain: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...extra,
  }
}

function backend(options: { role?: string; stores?: Record<string, unknown>[]; createError?: unknown } = {}): FakeSupabase {
  const { role = 'owner' } = options
  const fake: FakeSupabase = createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'biel', name: 'Biel', status: 'active' }],
      tenant_members: [{ organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' }],
      stores: options.stores ?? [
        tienda(STORE_A, 'biel', 'Biel'),
        tienda(STORE_OUTLET, 'biel-outlet', 'Outlet', { status: 'draft', currency: 'USD' }),
      ],
    },
    rpc: {
      create_store: (args) => {
        if (options.createError) throw options.createError
        const row = tienda('55555555-5555-4555-8555-555555555503', String(args.p_slug), String(args.p_name), {
          status: 'draft',
          currency: args.p_currency,
          domain: args.p_domain,
        })
        fake.state.tables.stores?.push(row)
        return row
      },
      set_store_status: (args) => {
        const row = fake.state.tables.stores?.find((s) => s.id === args.p_store_id)
        if (row) row.status = args.p_status
        return row
      },
    },
  })
  return fake
}

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <StoresPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

function filaCon(texto: string): HTMLElement {
  const fila = screen.getAllByRole('row').find((row) => row.textContent?.includes(texto))
  if (!fila) throw new Error(`No hay una fila con «${texto}»`)
  return fila
}

describe('la lista de tiendas', () => {
  it('enseña todas las tiendas de la sociedad, su estado y cuál está en uso', async () => {
    pintar(backend())
    await screen.findByText('Outlet')

    const biel = filaCon('/s/biel-outlet')
    expect(within(biel).getByText('Borrador')).toBeInTheDocument()
    expect(within(biel).getByText('USD')).toBeInTheDocument()
    expect(within(filaCon('/s/biel')).getByText('Activa')).toBeInTheDocument()
    // La activa es la primera por nombre: la misma regla que el selector.
    expect(within(filaCon('/s/biel')).getByText('En uso')).toBeInTheDocument()
  })

  it('con una sola tienda la pantalla sigue siendo útil', async () => {
    pintar(backend({ stores: [tienda(STORE_A, 'biel', 'Biel')] }))
    await screen.findByText('/s/biel')
    expect(screen.getByRole('button', { name: 'Nueva tienda' })).toBeEnabled()
  })

  it('un rol sin store.manage no ve el alta ni la lista', async () => {
    pintar(backend({ role: 'catalog' }))
    await screen.findByText('Solo el propietario y los administradores gestionan tiendas')
    expect(screen.queryByRole('button', { name: 'Nueva tienda' })).not.toBeInTheDocument()
    expect(screen.queryByText('/s/biel-outlet')).not.toBeInTheDocument()
  })
})

describe('alta y cambio de tienda', () => {
  it('crear manda solo slug, nombre, moneda y dominio, y la tienda aparece sin recargar', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Outlet')

    await user.click(screen.getByRole('button', { name: 'Nueva tienda' }))
    await user.type(await screen.findByLabelText(/^Nombre/), 'Biel Mayoristas')
    // El slug se propone desde el nombre.
    expect(screen.getByLabelText(/^Dirección de la tienda/)).toHaveValue('biel-mayoristas')
    await user.click(screen.getByRole('button', { name: 'Crear tienda' }))

    await vi.waitFor(() => expect(fake.state.rpcCalls.filter((c) => c.name === 'create_store')).toHaveLength(1))
    expect(fake.state.rpcCalls.find((c) => c.name === 'create_store')?.args).toEqual({
      p_slug: 'biel-mayoristas',
      p_name: 'Biel Mayoristas',
      p_currency: 'PEN',
      p_domain: null,
    })
    expect(await screen.findByText('/s/biel-mayoristas')).toBeInTheDocument()
  })

  it('una dirección tomada se explica, sin el texto crudo de la base', async () => {
    const user = userEvent.setup()
    pintar(backend({ createError: { message: 'TIENDA_SLUG_DUPLICADO: esa direccion ya la usa otra tienda', code: '23505' } }))
    await screen.findByText('Outlet')

    await user.click(screen.getByRole('button', { name: 'Nueva tienda' }))
    await user.type(await screen.findByLabelText(/^Nombre/), 'Biel')
    await user.click(screen.getByRole('button', { name: 'Crear tienda' }))

    expect(await screen.findByText('Esa dirección ya la usa otra tienda. Elige otra.')).toBeInTheDocument()
    expect(screen.queryByText(/TIENDA_SLUG_DUPLICADO/)).not.toBeInTheDocument()
  })

  it('«Usar esta tienda» cambia la tienda activa del backoffice', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('Outlet')

    await user.click(within(filaCon('/s/biel-outlet')).getByRole('button', { name: 'Usar esta tienda: Outlet' }))

    expect(await screen.findByText('Ahora trabajas en Outlet.')).toBeInTheDocument()
    await vi.waitFor(() => expect(within(filaCon('/s/biel-outlet')).getByText('En uso')).toBeInTheDocument())
  })

  it('suspender pide confirmación y manda solo la tienda y el estado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Outlet')

    await user.click(within(filaCon('/s/biel')).getByRole('button', { name: 'Suspender: Biel' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Suspender' }))

    await vi.waitFor(() =>
      expect(fake.state.rpcCalls.find((c) => c.name === 'set_store_status')?.args).toEqual({
        p_store_id: STORE_A,
        p_status: 'suspended',
      }),
    )
  })
})

describe('los códigos de la base', () => {
  it('cada código tiene su texto', () => {
    expect(mapStoreCode('TIENDA_DOMINIO_DUPLICADO')).toBe('storesAdmin.error.domainTaken')
    expect(mapStoreCode('TIENDA_MONEDA_EN_USO')).toBe('storesAdmin.error.currencyInUse')
    expect(mapStoreCode('SIN_PERMISO')).toBe('storesAdmin.error.forbidden')
    expect(mapStoreCode('ALGO_RARO')).toBe('storesAdmin.error.generic')
  })
})
