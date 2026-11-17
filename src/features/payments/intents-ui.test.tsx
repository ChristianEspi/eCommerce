import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import type { PaymentIntent } from './types'

/**
 * «Confirmar cobro» (QAS, 2026-11-17): un Yape o una transferencia quedaba
 * «Abierto» para siempre porque no había con qué confirmarlo. Ahora el detalle
 * del cobro lo ofrece, y solo cuando tiene sentido: sin pasarela y pendiente.
 */
const holder = vi.hoisted(() => ({
  confirm: { mutateAsync: vi.fn(async () => undefined), isPending: false },
}))

const BASE: Omit<PaymentIntent, 'intent_id' | 'order_number' | 'method_name' | 'provider_code' | 'capture_mode' | 'status' | 'method_code' | 'method_kind'> = {
  order_id: 'o1',
  customer_email: 'compras@cliente.pe',
  order_payment_status: 'pending',
  currency: 'PEN',
  amount: '440.86',
  amount_captured: '0',
  amount_refunded: '0',
  provider_reference: null,
  last_error_code: null,
  created_at: '2026-11-13T21:52:20Z',
  attempt_count: 0,
  failed_attempt_count: 0,
  refund_count: 0,
}

const COBROS: PaymentIntent[] = [
  {
    ...BASE,
    intent_id: 'i-yape',
    order_number: 'EC-20261113-00045',
    method_code: 'yape',
    method_name: 'Yape',
    method_kind: 'wallet',
    provider_code: null,
    capture_mode: 'manual',
    status: 'open',
  },
  {
    ...BASE,
    intent_id: 'i-tarjeta',
    order_number: 'EC-20261113-00046',
    method_code: 'tarjeta',
    method_name: 'Tarjeta',
    method_kind: 'card',
    provider_code: 'culqi',
    capture_mode: 'automatic',
    status: 'open',
  },
  {
    ...BASE,
    intent_id: 'i-cobrado',
    order_number: 'EC-20261113-00047',
    method_code: 'yape',
    method_name: 'Yape cobrado',
    method_kind: 'wallet',
    provider_code: null,
    capture_mode: 'manual',
    status: 'captured',
    amount_captured: '440.86',
  },
]

const vacio = { data: [], isPending: false, isError: false }

vi.mock('./hooks', () => ({
  usePaymentIntents: () => ({ data: COBROS, isPending: false, isError: false }),
  usePaymentAttempts: () => vacio,
  usePaymentEvents: () => vacio,
  usePaymentsOf: () => vacio,
  useRefundsOf: () => vacio,
  useRequestRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmOfflinePayment: () => holder.confirm,
}))

vi.mock('./ai/PaymentsAiSection', () => ({ PaymentIntentAiToggle: () => null }))

vi.mock('@/features/tenant/tenant-context', () => ({
  useTenant: () => ({
    activeStore: { id: 's1', name: 'Química Suiza' },
    can: () => true,
  }),
}))

const { IntentsSection } = await import('./IntentsSection')

beforeEach(() => {
  holder.confirm.mutateAsync.mockClear()
})

async function abrir(numero: string) {
  renderWithProviders(<IntentsSection />)
  await userEvent.click(screen.getByText(numero))
  return screen.getByRole('dialog')
}

describe('confirmar el cobro de un medio sin pasarela', () => {
  it('un Yape pendiente ofrece confirmarlo, con número de operación', async () => {
    const panel = await abrir('EC-20261113-00045')
    await userEvent.type(within(panel).getByLabelText('N.º de operación (opcional)'), 'OP-778812')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirmar cobro' }))
    expect(holder.confirm.mutateAsync).toHaveBeenCalledWith({
      intentId: 'i-yape',
      reference: 'OP-778812',
      note: '',
    })
    expect(within(panel).queryByRole('button', { name: 'Confirmar cobro' })).not.toBeInTheDocument()
  })

  it('un cobro de pasarela no se confirma a mano', async () => {
    const panel = await abrir('EC-20261113-00046')
    expect(within(panel).queryByRole('button', { name: 'Confirmar cobro' })).not.toBeInTheDocument()
  })

  it('uno ya cobrado tampoco', async () => {
    const panel = await abrir('EC-20261113-00047')
    expect(within(panel).queryByRole('button', { name: 'Confirmar cobro' })).not.toBeInTheDocument()
  })
})
