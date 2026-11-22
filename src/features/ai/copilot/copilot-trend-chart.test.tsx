/**
 * 2026-11-22 · Gráfico de tendencia del Copilot: leyenda siempre, tabla para
 * lectores de pantalla con las cifras de la base, y pedidos (no importes)
 * cuando la ventana mezcla monedas.
 */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { copilotAnswerSchema, type CopilotChart } from './copilot'
import { CopilotTrendChart } from './CopilotTrendChart'

const chart: CopilotChart = {
  kind: 'sales_trend',
  days: 7,
  currency: 'PEN',
  current: [
    { day: '2026-11-20', revenue: '100.00', orders: 1 },
    { day: '2026-11-21', revenue: '250.00', orders: 2 },
  ],
  previous: [
    { day: '2026-11-13', revenue: '80.00', orders: 1 },
    { day: '2026-11-14', revenue: null, orders: 1 },
  ],
}

describe('CopilotTrendChart', () => {
  it('leyenda de los dos periodos y tabla con los importes de la base', () => {
    renderWithProviders(<CopilotTrendChart chart={chart} />)
    expect(screen.getByText('Ventas por día · últimos 7 días')).toBeInTheDocument()
    const tabla = screen.getByRole('table')
    const filas = within(tabla).getAllByRole('row')
    expect(filas).toHaveLength(3)
    expect(filas[2]).toHaveTextContent(/250[.,]00/)
    // Día con monedas mezcladas en el periodo anterior: guion, no cero.
    expect(filas[2]).toHaveTextContent('—')
  })

  it('sin moneda única dibuja pedidos', () => {
    renderWithProviders(<CopilotTrendChart chart={{ ...chart, currency: null }} />)
    expect(screen.getByText('Pedidos por día · últimos 7 días')).toBeInTheDocument()
  })
})

describe('contrato de la respuesta', () => {
  it('una respuesta de un servidor anterior (sin gráficos ni borrador) sigue siendo válida', () => {
    const r = copilotAnswerSchema.parse({
      kind: 'answer',
      answerable: true,
      answer: 'Hola',
      highlights: [],
      links: [],
      follow_ups: [],
      tools: [],
      discarded: 0,
      metrics: {},
      entities: {},
    })
    expect(r.charts).toEqual([])
    expect(r.draft).toBeNull()
  })
})
