import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { agotado, porAgotarse, type AiEntitlement } from './types'

/**
 * El medidor de IA en pantalla.
 *
 * Lo que se comprueba:
 *
 *  · que los dos finales se NOMBRAN distinto, porque llevan a sitios distintos:
 *    la prueba agotada lleva a contratar, la cuota del mes a ampliar;
 *  · que sin contratar no se inventa un saldo de cero, que se leería como «te
 *    lo has gastado» en vez de «no lo tienes»;
 *  · que el aviso de «queda poco» es relativo y no un número fijo.
 */

const holder = vi.hoisted(() => ({ estado: null as AiEntitlement | null }))

vi.mock('./hooks', () => ({
  useAiEntitlement: () => ({ data: holder.estado }),
  useAiFeedback: () => ({ mutate: vi.fn() }),
}))

const { AiMeter } = await import('./AiMeter')

function pinta(estado: AiEntitlement | null) {
  holder.estado = estado
  renderWithProviders(<AiMeter />)
}

describe('el umbral de aviso', () => {
  // Relativo y no fijo: «te quedan 3» significa algo muy distinto sobre una
  // cuota de 25 que sobre una de 500.
  const base = { enabled: true, status: 'active' as const, plan: 'active' as const }

  it('avisa en el último quinto', () => {
    expect(porAgotarse({ ...base, quota: 500, remaining: 100 })).toBe(true)
    expect(porAgotarse({ ...base, quota: 500, remaining: 101 })).toBe(false)
  })

  it('no avisa de lo que ya se acabó: eso es otro mensaje', () => {
    expect(porAgotarse({ ...base, status: 'quota_exceeded', quota: 500, remaining: 0 })).toBe(false)
    expect(agotado({ ...base, status: 'quota_exceeded' })).toBe(true)
  })

  it('una cuota de cero no divide entre cero', () => {
    expect(porAgotarse({ ...base, quota: 0, remaining: 0 })).toBe(false)
  })
})

describe('el medidor', () => {
  it('mientras no hay dato no pinta nada', () => {
    // Un medidor que aparece en blanco y luego se rellena se lee como un fallo
    // que se arregló solo.
    holder.estado = null
    const { container } = renderWithProviders(<AiMeter />)
    expect(container.textContent).toBe('')
  })

  it('sin contratar dice que no está en el plan, no que se agotó', () => {
    pinta({ enabled: false, status: 'disabled' })

    expect(screen.getByText(/no tiene activado este módulo/i)).toBeInTheDocument()
    expect(screen.queryByText(/se agotó/i)).not.toBeInTheDocument()
  })

  it('en prueba dice cuántas quedan', () => {
    pinta({ enabled: true, status: 'trial', plan: 'trial', used: 5, quota: 25, remaining: 20 })

    expect(screen.getByText('5 / 25')).toBeInTheDocument()
    expect(screen.getByText(/te quedan 20 consultas/i)).toBeInTheDocument()
  })

  it('la prueba agotada y la cuota agotada NO dicen lo mismo', () => {
    pinta({ enabled: true, status: 'trial_expired', plan: 'trial', used: 25, quota: 25, remaining: 0 })
    expect(screen.getByText(/se agotó la prueba/i)).toBeInTheDocument()

    pinta({
      enabled: true,
      status: 'quota_exceeded',
      plan: 'active',
      used: 500,
      quota: 500,
      remaining: 0,
    })
    expect(screen.getByText(/se agotó la cuota del mes/i)).toBeInTheDocument()
  })

  it('en modo compacto, lo no contratado se calla', () => {
    // El medidor compacto vive al lado de un botón; anunciar ahí un módulo que
    // no se tiene es ruido en una pantalla que va de otra cosa.
    holder.estado = { enabled: false, status: 'disabled' }
    const { container } = renderWithProviders(<AiMeter compact />)
    expect(container.textContent).toBe('')
  })
})
