import { screen, waitFor, within } from '@testing-library/react'
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

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CategoriesPage } = await import('./CategoriesPage')

const CATEGORY_ID = '77777777-7777-4777-8777-777777777777'

function backend(categories = defaultCategories()): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        {
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: USER,
          role: 'catalog',
          status: 'active',
        },
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
      categories,
      products: [],
    },
    rpc: {
      category_deletion_usage: () => ({ name: 'Sillas', products: 5, children: 1 }),
    },
  })
}

function defaultCategories() {
  return [
    {
      id: CATEGORY_ID,
      store_id: STORE_A,
      parent_id: null,
      slug: 'sillas',
      name: 'Sillas',
      position: 0,
      is_active: true,
    },
  ]
}

function renderPage(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CategoriesPage />
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('CategoriesPage — CRUD minimo', () => {
  it('lista las categorias de la tienda activa', async () => {
    renderPage(backend())
    expect(await screen.findByText('Sillas')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  it('sin categorias muestra el estado vacio con la accion de crear', async () => {
    renderPage(backend([]))
    expect(await screen.findByText('Aún no creaste categorías')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Nueva categoría' }).length).toBeGreaterThan(0)
  })

  it('el alta escribe el tenant que el JWT resolvio, no uno declarado a mano', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click((await screen.findAllByRole('button', { name: 'Nueva categoría' }))[0]!)
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesas de oficina')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.tables.categories).toHaveLength(2))
    const created = fake.state.tables.categories?.[1]
    expect(created).toMatchObject({
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      name: 'Mesas de oficina',
      slug: 'mesas-de-oficina',
      is_active: true,
    })
  })

  it('un slug invalido no llega a escribir nada', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click((await screen.findAllByRole('button', { name: 'Nueva categoría' }))[0]!)
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Ok')
    await user.clear(within(drawer).getByLabelText('Dirección del producto'))
    await user.type(within(drawer).getByLabelText('Dirección del producto'), 'a b')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    expect(await within(drawer).findByText(/minúsculas, números y guiones/i)).toBeInTheDocument()
    expect(fake.state.tables.categories).toHaveLength(1)
  })

  it('desactivar conserva la fila y solo apaga la bandera', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(fake.state.tables.categories?.[0]?.is_active).toBe(false))
    expect(fake.state.tables.categories).toHaveLength(1)
    expect(await screen.findByText('Categoría desactivada')).toBeInTheDocument()
  })

  it('antes de borrar enseña cuantos productos y cuantas hijas dependen de ella', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Productos con esta categoría')).toBeInTheDocument()
    expect(await within(dialog).findByText('5')).toBeInTheDocument()
    expect(within(dialog).getByText('1')).toBeInTheDocument()
    // Está en uso: el botón lo dice en vez de fingir que no pasa nada.
    expect(
      within(dialog).getByRole('button', { name: 'Eliminar de todas formas' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
  })

  it('eliminar borra la fila', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar de todas formas' }))

    await waitFor(() => expect(fake.state.tables.categories).toHaveLength(0))
  })
})
