import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession } from '@/test/supabaseMock'

/**
 * Estado de cuenta del comprador: lo pagado sin confirmar va aparte de la
 * deuda, para que una transferencia en revisión no se lea como algo que se debe.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { AccountStatementSection } = await import('./AccountStatementSection')

function cuenta(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'aaaa1111-1111-4111-8111-111111111111',
    account_name: 'Distribuidora Andina',
    account_code: 'DIST-01',
    credit_limit: '20000.00',
    payment_terms_days: 30,
    balance_due: '120.93',
    credit_available: '19879.07',
    overdue_amount: '120.93',
    documents: [
      {
        order_id: 'o-credito',
        order_number: 'EC-20260930-00016',
        placed_at: '2026-09-30T10:00:00Z',
        due_at: '2026-10-30',
        days_overdue: 19,
        total: '120.93',
        currency: 'PEN',
        status: 'pending',
        payment_status: 'pending',
      },
    ],
    purchased_12m: '10334.93',
    paid_12m: '9222.09',
    currency: 'PEN',
    ...overrides,
  }
}

function render(data: unknown) {
  const client = createFakeSupabase({ session: makeSession(), rpc: { my_account_statement: () => data } })
  holder.client = client
  renderWithProviders(<AccountStatementSection />, { session: makeSession() })
}

beforeEach(() => {
  holder.client = null
})

describe('estado de cuenta', () => {
  it('separa los pagos por confirmar de la deuda', async () => {
    render([
      cuenta({
        pending_payments: [
          {
            order_id: 'o-transfer',
            order_number: 'EC-20260929-00015',
            placed_at: '2026-09-29T10:00:00Z',
            total: '991.91',
            currency: 'PEN',
            method: 'Transferencia bancaria',
          },
        ],
        pending_payments_total: '991.91',
      }),
    ])

    expect(await screen.findByRole('heading', { name: 'Pagos por confirmar' })).toBeInTheDocument()
    expect(screen.getByText('EC-20260929-00015')).toBeInTheDocument()
    expect(screen.getByText('Transferencia bancaria')).toBeInTheDocument()
    expect(screen.getByText(/No son deuda ni usan tu línea/)).toBeInTheDocument()
    // La deuda sigue siendo solo la de crédito.
    expect(screen.getAllByText('S/ 120.93').length).toBeGreaterThan(0)
  })

  it('sin pagos por confirmar (o contra una base anterior) no enseña la sección', async () => {
    render([cuenta()])

    expect(await screen.findByText('Distribuidora Andina')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pagos por confirmar' })).toBeNull()
  })
})
