import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const holder = vi.hoisted(() => ({
  estado: null as AiEntitlement | null,
  traza: [] as unknown[],
  opinar: null as unknown,
}))

vi.mock('./hooks', () => ({
  useAiEntitlement: () => ({ data: holder.estado }),
  useAiInteractions: () => ({ data: holder.traza, isLoading: false, isError: false }),
  useAiFeedback: () => holder.opinar,
}))

const { AiMeter } = await import('./AiMeter')
const { AiSection } = await import('./AiSection')

function traza(extra: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    feature: 'assistant',
    model: 'claude-haiku-4-5',
    status: 'ai',
    prompt_excerpt: 'algo para el dolor de cabeza',
    reply_excerpt: 'Te recomiendo estos dos',
    input_tokens: 120,
    output_tokens: 40,
    cache_read_tokens: 0,
    latency_ms: 900,
    feedback: null,
    created_at: '2026-09-10T10:00:00.000Z',
    ...extra,
  }
}

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

describe('la traza en Diagnóstico', () => {
  const activa: AiEntitlement = {
    enabled: true,
    status: 'active',
    plan: 'active',
    used: 3,
    quota: 500,
    remaining: 497,
  }

  function pintaSeccion(estado: AiEntitlement | null, filas: unknown[]) {
    holder.estado = estado
    holder.traza = filas
    holder.opinar = { mutate: vi.fn(), isPending: false }
    renderWithProviders(<AiSection />)
  }

  it('sin contratar no enseña una tabla vacía', () => {
    pintaSeccion({ enabled: false, status: 'disabled' }, [])

    expect(screen.queryByText(/últimas consultas/i)).not.toBeInTheDocument()
  })

  it('enseña qué se preguntó y qué costó', () => {
    pintaSeccion(activa, [traza()])

    expect(screen.getByText('algo para el dolor de cabeza')).toBeInTheDocument()
    // Entrada y salida por separado: la salida cuesta cinco veces más, y
    // sumarlas escondería cuál de las dos se disparó.
    expect(screen.getByText(/120 \/ 40/)).toBeInTheDocument()
  })

  it('«sin modelo» no se pinta como un error', () => {
    // `search` es el modo en el que el asistente funciona sin proveedor.
    // Enseñarlo en rojo haría creer que algo se rompió.
    pintaSeccion(activa, [traza({ status: 'search', reply_excerpt: null })])

    // Anclada: el aviso de «todas sin modelo» contiene esa misma frase, y sin
    // anclar la prueba pasaría por el texto equivocado.
    expect(screen.getByText(/^Sin modelo$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Error$/)).not.toBeInTheDocument()
  })

  it('avisa cuando NINGUNA consulta llegó al modelo', () => {
    // Es la llamada de soporte más previsible: «contraté la IA y el asistente
    // responde igual que antes». Casi siempre es la clave sin configurar.
    pintaSeccion(activa, [traza({ status: 'search' }), traza({ status: 'search' })])

    expect(screen.getByText(/falta configurar la clave del proveedor/i)).toBeInTheDocument()
  })

  it('no avisa si alguna sí llegó', () => {
    pintaSeccion(activa, [traza({ status: 'search' }), traza({ status: 'ai' })])

    expect(screen.queryByText(/falta configurar la clave/i)).not.toBeInTheDocument()
  })

  it('el pulgar se puede pulsar por cada consulta', async () => {
    const opinar = { mutate: vi.fn(), isPending: false }
    holder.estado = activa
    holder.traza = [traza()]
    holder.opinar = opinar
    renderWithProviders(<AiSection />)

    // Anclada al principio: «No sirvió: assistant» contiene «Sirvió: assistant».
    await userEvent.click(screen.getByRole('button', { name: /^Sirvió: assistant$/ }))

    expect(opinar.mutate).toHaveBeenCalledWith({
      id: '99999999-9999-4999-8999-999999999999',
      value: 1,
    })
  })

  it('sin uso todavía, lo dice en vez de enseñar una tabla en blanco', () => {
    pintaSeccion(activa, [])

    expect(screen.getByText(/todavía no se ha usado la ia/i)).toBeInTheDocument()
  })
})

