import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, createFakeSupabase, makeSession } from '@/test/supabaseMock'

/** 2026-11-11 · Los datos de atención avisan si quedan sin guardar. */
const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))
const { HelpContactSection } = await import('./HelpContactSection')

describe('HelpContactSection', () => {
  it('editar el RUC muestra que falta pulsar «Guardar datos de atención»', async () => {
    const fake = createFakeSupabase({
      session: makeSession(),
      tables: {
        store_settings: [
          { store_id: STORE_A, organization_id: ORG, company_id: COMPANY_A, legal_name: 'Ferro', tax_id: '20123456789', whatsapp_phone: null, help_note: null, business_hours: null, social_links: [] },
        ],
      },
    })
    holder.client = fake
    const user = userEvent.setup()
    renderWithProviders(<HelpContactSection storeId={STORE_A} canManage />, { session: fake.state.session })

    const ruc = await screen.findByDisplayValue('20123456789')
    expect(screen.queryByText(/cambios sin guardar/)).not.toBeInTheDocument()
    await user.clear(ruc)
    await user.type(ruc, '20999999999')
    expect(screen.getByText(/cambios sin guardar/)).toBeInTheDocument()
  })
})
