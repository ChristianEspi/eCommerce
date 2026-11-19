import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { matchesProposal, type AiActionProposal } from './api'

/**
 * «Acciones de la IA», en pantalla (2026-11-19).
 *
 *  · lo pendiente se decide con confirmación, nunca con un clic suelto;
 *  · aprobar manda `approve` con el id y la nota, y nada más;
 *  · lo ejecutado no ofrece decidir otra vez.
 */

const holder = vi.hoisted(() => ({ rows: [] as unknown[], decide: vi.fn() }))

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>()
  return {
    ...real,
    listProposals: vi.fn(async () => holder.rows),
    decideAction: (input: unknown) => holder.decide(input),
  }
})

vi.mock('@/features/tenant/tenant-context', () => ({
  useTenant: () => ({ activeCompanyId: 'c1', can: () => true }),
}))

const { AiActionsPage } = await import('./AiActionsPage')

const proposal = (over: Partial<AiActionProposal>): AiActionProposal => ({
  id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  kind: 'promotion.create_draft',
  title: 'Liquidación de stock',
  rationale: 'Productos sin rotación',
  payload: { name: 'Liquidación de stock', value_percent: 15, product_ids: ['a', 'b'] },
  source_feature: 'inventory',
  status: 'pending',
  proposed_by: '33333333-3333-4333-8333-333333333333',
  decided_by: null,
  decided_at: null,
  decision_note: null,
  result: null,
  error_code: null,
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  created_at: new Date().toISOString(),
  ...over,
})

beforeEach(() => {
  holder.decide.mockReset()
  holder.decide.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', status: 'executed' })
})

describe('AiActionsPage', () => {
  it('aprobar pide confirmación y manda solo id, decisión y nota', async () => {
    holder.rows = [proposal({})]
    renderWithProviders(<AiActionsPage />)
    expect(await screen.findByText(/15 % de descuento en 2 productos/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/BORRADOR/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /nota/i }), 'ok')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar' }))

    await waitFor(() =>
      expect(holder.decide).toHaveBeenCalledWith({
        id: '11111111-1111-4111-8111-111111111111',
        decision: 'approve',
        note: 'ok',
      }),
    )
  })

  it('lo ejecutado no se vuelve a decidir', async () => {
    holder.rows = [proposal({ status: 'executed' })]
    renderWithProviders(<AiActionsPage />)
    await screen.findByText(/Por aprobar/)
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument()
  })
})

describe('búsqueda general', () => {
  it('busca en título, motivo y tipo', () => {
    const p = proposal({})
    expect(matchesProposal(p, 'rotación')).toBe(true)
    expect(matchesProposal(p, 'promotion')).toBe(true)
    expect(matchesProposal(p, 'zzz')).toBe(false)
  })
})
