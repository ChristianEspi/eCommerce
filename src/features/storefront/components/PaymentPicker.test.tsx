import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { PaymentPicker } from './PaymentPicker'

/**
 * 2026-11-19 · Que no carguen los medios de pago es un error y se dice como
 * tal, con «Reintentar»; «acuerda el pago por separado» queda para la tienda
 * que de verdad no publica ninguno.
 */
describe('PaymentPicker sin medios', () => {
  it('si la consulta falla dice que no cargó y deja reintentar', async () => {
    const onRetry = vi.fn()
    renderWithProviders(
      <PaymentPicker methods={[]} loading={false} failed selectedCode="" onSelect={() => {}} error={null} onRetry={onRetry} />,
    )
    expect(screen.getByText(/No pudimos cargar las formas de pago/)).toBeInTheDocument()
    expect(screen.queryByText(/acuerda el pago por separado/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('una tienda sin medios publicados sigue diciendo que acuerda el pago', () => {
    renderWithProviders(
      <PaymentPicker methods={[]} loading={false} failed={false} selectedCode="" onSelect={() => {}} error={null} />,
    )
    expect(screen.getByText('Esta tienda acuerda el pago por separado.')).toBeInTheDocument()
  })
})
