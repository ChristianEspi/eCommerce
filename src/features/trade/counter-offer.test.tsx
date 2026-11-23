/**
 * 2026-11-22 · Contrapropuesta a «Mejora esta cotización».
 *
 * Lo que se fija: la nota de la vitrina se lee línea a línea; la propuesta
 * iguala a la competencia sin bajar del descuento máximo; lo que ya es más
 * barato o no tiene dato se queda igual; «Aplicar» guarda solo lo que cambia.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { leerNotaCompetencia, proponerContraoferta } from './counterOffer'

const holder = vi.hoisted(() => ({ update: vi.fn(async () => undefined) }))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), updateQuoteItemPrice: holder.update }))

const { QuoteCounterOffer } = await import('./QuoteCounterOffer')

const NOTA = [
  'Mejora esta cotización: otro proveedor me ofrece estos precios unitarios con IGV.',
  '- Consiv 18 mg × 4: PEN 95.00',
  '- Lejía 5 L × 10: PEN 12.00',
  '- Guantes × 2: PEN 30.00',
].join('\n')

const item = (id: string, nombre: string, precio: string, position: number) => ({
  id,
  quote_id: '00000000-0000-4000-8000-0000000000aa',
  product_id: '00000000-0000-4000-8000-0000000000bb',
  variant_id: null,
  uom_code: null,
  quantity: '4',
  unit_price: precio,
  tax_rate: null,
  tax_amount: null,
  line_total: '0.00',
  position,
  product_name: nombre,
})

const ITEMS = [
  item('00000000-0000-4000-8000-000000000001', 'Consiv', '100.00', 0),
  item('00000000-0000-4000-8000-000000000002', 'Lejía', '15.00', 1),
  item('00000000-0000-4000-8000-000000000003', 'Guantes', '25.00', 2),
]

describe('contrapropuesta', () => {
  it('lee la nota y aplica la regla: igualar, tope, ya mejor', () => {
    const competencia = leerNotaCompetencia(NOTA)
    expect(competencia).toEqual([
      { texto: 'Consiv 18 mg', cantidad: 4, moneda: 'PEN', precio: 95 },
      { texto: 'Lejía 5 L', cantidad: 10, moneda: 'PEN', precio: 12 },
      { texto: 'Guantes', cantidad: 2, moneda: 'PEN', precio: 30 },
    ])
    expect(leerNotaCompetencia('Pedido trimestral')).toBeNull()
    const filas = proponerContraoferta(ITEMS, competencia!, 10)
    expect(filas.map((f) => [f.propuesta, f.regla])).toEqual([
      [95, 'igualar'],
      [13.5, 'tope'],
      [25, 'ya_mejor'],
    ])
    // Si las líneas ya no cuadran con la nota, nada se empareja.
    expect(proponerContraoferta(ITEMS.slice(0, 2), competencia!, 10).every((f) => f.regla === 'sin_dato')).toBe(true)
  })

  it('«Aplicar» guarda solo las líneas que cambian', async () => {
    renderWithProviders(
      <QuoteCounterOffer
        quote={{ id: '00000000-0000-4000-8000-0000000000aa', notes: NOTA, currency: 'PEN' } as never}
        items={ITEMS}
      />,
    )
    expect(screen.getByText('Contrapropuesta')).toBeInTheDocument()
    expect(screen.getByText('Hasta tu descuento máximo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar 2 precios' }))
    await screen.findByText(/Precios aplicados/)
    expect(holder.update).toHaveBeenCalledTimes(2)
    expect(holder.update).toHaveBeenCalledWith(expect.objectContaining({ id: ITEMS[1]!.id, unitPrice: '13.50' }))
  })
})
