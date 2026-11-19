import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import type { PaymentMethod } from './types'

/**
 * Borrar un medio de pago (visto en QAS: se borraba al primer clic).
 *
 * Lo que se comprueba: que el clic en la papelera NO borra, que el diálogo
 * ofrece ocultarlo como salida segura, y que las acciones de cada fila dicen
 * de qué medio son.
 */
const holder = vi.hoisted(() => ({
  remove: { mutateAsync: vi.fn(async () => undefined), isPending: false },
  save: { mutateAsync: vi.fn(async () => undefined), isPending: false },
}))

const SIN_LLAVES = {
  checkout_public_key: null,
  accepts_yape: false,
  has_secret: false,
  secret_hint: null,
  secret_set_at: null,
}

const METODOS: PaymentMethod[] = [
  {
    id: 'm-yape',
    store_id: 's1',
    code: 'yape',
    kind: 'wallet',
    display_name: 'Yape',
    provider_code: null,
    capture_mode: 'manual',
    is_active: true,
    position: 10,
    instructions: null,
    ...SIN_LLAVES,
  },
  {
    id: 'm-credito',
    store_id: 's1',
    code: 'credito',
    kind: 'credit',
    display_name: 'Credito empresa',
    provider_code: null,
    capture_mode: 'manual',
    is_active: false,
    position: 50,
    instructions: null,
    ...SIN_LLAVES,
  },
  {
    id: 'm-tarjeta',
    store_id: 's1',
    code: 'tarjeta',
    kind: 'card',
    display_name: 'Tarjeta',
    provider_code: 'culqi',
    capture_mode: 'automatic',
    is_active: true,
    position: 5,
    instructions: null,
    checkout_public_key: 'pk_test_abcdefgh1234',
    accepts_yape: false,
    has_secret: true,
    secret_hint: 'sk_test_…ab12',
    secret_set_at: '2026-11-13T10:00:00Z',
  },
]

vi.mock('./hooks', () => ({
  usePaymentMethods: () => ({ data: METODOS, isPending: false, isError: false }),
  usePaymentProviders: () => ({ data: [{ code: 'culqi', name: 'Culqi' }] }),
  useSavePaymentMethod: () => holder.save,
  useDeletePaymentMethod: () => holder.remove,
}))

vi.mock('@/features/tenant/tenant-context', () => ({
  useTenant: () => ({
    tenant: { organization_id: 'o1' },
    activeCompanyId: 'c1',
    activeStore: { id: 's1', name: 'FerroMax' },
    can: () => true,
  }),
}))

const { MethodsSection } = await import('./MethodsSection')

beforeEach(() => {
  holder.remove.mutateAsync.mockClear()
  holder.save.mutateAsync.mockClear()
})

describe('borrar un medio de pago', () => {
  it('cada acción de fila dice de qué medio es', () => {
    renderWithProviders(<MethodsSection />)
    expect(screen.getByRole('button', { name: 'Editar: Yape' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar: Credito empresa' })).toBeInTheDocument()
  })

  it('la papelera NO borra: pide confirmación', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar: Yape' }))

    expect(holder.remove.mutateAsync).not.toHaveBeenCalled()
    const dialogo = screen.getByRole('dialog', { name: '¿Eliminar este medio de pago?' })
    expect(within(dialogo).getByText('Yape')).toBeInTheDocument()
  })

  it('publicado, ofrece ocultarlo, y ocultar no borra', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar: Yape' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar del checkout' }))

    expect(holder.remove.mutateAsync).not.toHaveBeenCalled()
    expect(holder.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-yape', code: 'yape', isActive: false }),
    )
  })

  it('confirmar sí borra ese medio y solo ese', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar: Yape' }))
    const dialogo = screen.getByRole('dialog')
    await userEvent.click(within(dialogo).getByRole('button', { name: /eliminar/i }))

    expect(holder.remove.mutateAsync).toHaveBeenCalledWith('m-yape')
  })

  it('ya oculto, no ofrece «ocultar»', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar: Credito empresa' }))
    expect(screen.queryByRole('button', { name: 'Ocultar del checkout' })).not.toBeInTheDocument()
  })
})

describe('llaves de Culqi en el medio de tarjeta', () => {
  it('un medio sin pasarela no pide llaves', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Editar: Yape' }))
    expect(screen.queryByRole('region', { name: 'Conexión con Culqi' })).not.toBeInTheDocument()
  })

  it('con Culqi enseña la pública, la PISTA de la secreta y nunca la secreta', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Editar: Tarjeta' }))

    const bloque = screen.getByRole('region', { name: 'Conexión con Culqi' })
    expect(within(bloque).getByLabelText('Llave pública')).toHaveValue('pk_test_abcdefgh1234')
    // La secreta empieza vacía siempre: no se lee de la base.
    expect(within(bloque).getByLabelText('Llave secreta')).toHaveValue('')
    expect(within(bloque).getByText('Llave secreta guardada: sk_test_…ab12')).toBeInTheDocument()
    expect(within(bloque).getByText('Modo pruebas')).toBeInTheDocument()
  })

  it('mezclar una pública de pruebas con una secreta de producción no deja guardar', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Editar: Tarjeta' }))
    await userEvent.type(screen.getByLabelText('Llave secreta'), 'sk_live_zzzzzzzz9999')

    expect(
      screen.getByText('La llave pública y la secreta deben ser las dos de pruebas o las dos de producción.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('una secreta nueva viaja al guardar (y la pública con el medio)', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Editar: Tarjeta' }))
    await userEvent.type(screen.getByLabelText('Llave secreta'), 'sk_test_nuevanueva5678')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(holder.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'm-tarjeta',
        providerCode: 'culqi',
        publicKey: 'pk_test_abcdefgh1234',
        secretKey: 'sk_test_nuevanueva5678',
        clearSecret: false,
      }),
    )
  })
})

/** 2026-11-19 · Yape por Culqi: interruptor del medio de tarjeta con Culqi. */
describe('Yape por Culqi', () => {
  it('un medio sin pasarela no ofrece el interruptor', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Editar: Yape' }))
    expect(screen.queryByLabelText('Aceptar también Yape en la ventana de Culqi')).not.toBeInTheDocument()
  })

  it('encenderlo en el medio Culqi viaja al guardar', async () => {
    renderWithProviders(<MethodsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Editar: Tarjeta' }))
    const interruptor = screen.getByLabelText('Aceptar también Yape en la ventana de Culqi')
    expect(interruptor).not.toBeChecked()
    await userEvent.click(interruptor)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(holder.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-tarjeta', providerCode: 'culqi', acceptsYape: true }),
    )
  })
})
