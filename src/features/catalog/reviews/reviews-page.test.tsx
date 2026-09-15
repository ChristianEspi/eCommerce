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
  makePlatformContext,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * Moderación de reseñas en el backoffice (cierre).
 *
 * Se comprueba la anatomía de listado (tabs de estado + buscador general), que
 * publicar y rechazar van por la FUNCIÓN —nunca un update a la tabla—, que
 * rechazar exige motivo antes de llamar, y que un rol sin `catalog.write` lee
 * pero no ve botones. Quién puede de verdad lo decide la base
 * (`supabase/tests/product-reviews.test.ts`).
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
const { ReviewsPage } = await import('./ReviewsPage')

const PRODUCT = '88888888-8888-4888-8888-888888888801'
const PENDIENTE = '77777777-7777-4777-8777-777777777701'
const PUBLICADA = '77777777-7777-4777-8777-777777777702'

function review(id: string, status: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    product_id: PRODUCT,
    display_name: 'Ana C.',
    rating: 4,
    title: null,
    body,
    status,
    verified_purchase: true,
    rejection_reason: null,
    moderated_at: null,
    created_at: '2026-09-10T00:00:00.000Z',
    ...extra,
  }
}

function backend(role = 'admin'): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [{ organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' }],
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
      products: [{ id: PRODUCT, organization_id: ORG, company_id: COMPANY_A, store_id: STORE_A, name: 'Silla de roble' }],
      product_reviews: [
        review(PENDIENTE, 'pending', 'Cómoda, pero tardó en llegar.'),
        review(PUBLICADA, 'published', 'Excelente acabado de la madera.', { display_name: 'Beto P.' }),
      ],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ source: 'hub' }),
      moderate_product_review: () => ({ review_id: PENDIENTE, status: 'published' }),
    },
  })
}

function renderPage(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <ReviewsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('ReviewsPage', () => {
  it('abre en pendientes, con tabs de estado y un buscador general', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    expect(await screen.findByText('Cómoda, pero tardó en llegar.')).toBeInTheDocument()
    expect(screen.queryByText('Excelente acabado de la madera.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Pendientes', 'Publicadas', 'Rechazadas'])
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)

    await user.click(screen.getByRole('tab', { name: 'Publicadas' }))
    expect(await screen.findByText('Excelente acabado de la madera.')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), 'nada que coincida')
    expect(await screen.findByText('No hay reseñas en esta pestaña.')).toBeInTheDocument()
  })

  it('publicar llama a la función de moderación, no a la tabla', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: /^Publicar/ }))

    await waitFor(() =>
      expect(fake.state.rpcCalls.find((call) => call.name === 'moderate_product_review')?.args).toEqual({
        p_review_id: PENDIENTE,
        p_decision: 'publish',
        p_reason: null,
      }),
    )
    expect(await screen.findByText('Reseña publicada')).toBeInTheDocument()
    expect(fake.state.tables.product_reviews?.find((row) => row.id === PENDIENTE)?.status).toBe('pending')
  })

  it('rechazar exige motivo antes de llamar, y lo manda', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: /^Rechazar/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Rechazar' }))
    expect(within(dialog).getByText('Rechazar exige un motivo de 3 a 500 caracteres.')).toBeInTheDocument()
    expect(fake.state.rpcCalls.map((call) => call.name)).not.toContain('moderate_product_review')

    await user.type(within(dialog).getByRole('textbox'), 'No habla de este producto.')
    await user.click(within(dialog).getByRole('button', { name: 'Rechazar' }))

    await waitFor(() =>
      expect(fake.state.rpcCalls.find((call) => call.name === 'moderate_product_review')?.args).toEqual({
        p_review_id: PENDIENTE,
        p_decision: 'reject',
        p_reason: 'No habla de este producto.',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('un error de la base se cuenta por su código', async () => {
    const user = userEvent.setup()
    const fake = backend()
    fake.state.rpc.moderate_product_review = () => {
      throw { message: 'SIN_CAMBIOS: la resena ya esta en ese estado', code: '22023' }
    }
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: /^Publicar/ }))
    expect(await screen.findByText('La reseña ya estaba en ese estado.')).toBeInTheDocument()
  })

  it('un lector ve la cola pero no puede moderar', async () => {
    renderPage(backend('viewer'))

    expect(await screen.findByText('Cómoda, pero tardó en llegar.')).toBeInTheDocument()
    expect(screen.getByText('Tu rol puede leer las reseñas, pero no moderarlas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Publicar|^Rechazar/ })).not.toBeInTheDocument()
  })
})
