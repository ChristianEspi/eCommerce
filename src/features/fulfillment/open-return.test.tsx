import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, createFakeSupabase, makeSession } from '@/test/supabaseMock'

/** 2026-11-11 · Abrir una devolución desde el pedido (teléfono, mostrador). */
const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))
const { OpenReturnSection } = await import('./OpenReturnSection')

const ORDER = '99999999-9999-4999-8999-0000000000a1'
const LINE = '99999999-9999-4999-8999-0000000000a2'

describe('OpenReturnSection', () => {
  it('abre la devolución con la línea, las unidades y el motivo elegidos', async () => {
    const llamadas: Record<string, unknown>[] = []
    const fake = createFakeSupabase({
      session: makeSession(),
      tables: {
        return_reasons: [
          { id: '99999999-9999-4999-8999-0000000000a3', organization_id: ORG, company_id: COMPANY_A, store_id: STORE_A, code: 'defectuoso', label: 'Llegó dañado o no funciona', requires_evidence: true, restock_default: false, is_active: true, position: 10 },
        ],
      },
      rpc: { return_open: (args) => { llamadas.push(args); return { return_request_id: 'r', rma_number: 'RMA-20261111-00007', state: 'requested' } } },
    })
    holder.client = fake
    const user = userEvent.setup()
    renderWithProviders(
      <OpenReturnSection orderId={ORDER} storeId={STORE_A} lines={[{ id: LINE, name: 'Taladro', variant_label: null, quantity: 3 }]} />,
      { session: fake.state.session },
    )

    await user.click(screen.getByRole('button', { name: 'Abrir devolución' }))
    await user.click(screen.getByRole('checkbox', { name: 'Taladro' }))
    await user.click(screen.getByRole('combobox', { name: 'Unidades' }))
    await user.click(await screen.findByRole('option', { name: '2' }))
    await user.click(screen.getByRole('combobox', { name: 'Motivo' }))
    await user.click(await screen.findByRole('option', { name: 'Llegó dañado o no funciona' }))
    await user.click(screen.getAllByRole('button', { name: 'Abrir devolución' }).at(-1)!)

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({ p_order_id: ORDER, p_reason_code: 'defectuoso', p_items: [{ order_item_id: LINE, quantity: 2 }] })
    expect(await screen.findByText('Devolución RMA-20261111-00007 abierta')).toBeInTheDocument()
  })
})
