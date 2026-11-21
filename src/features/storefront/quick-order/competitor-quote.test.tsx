import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceQuote } from '@/domain'
import { renderWithProviders } from '@/test/render'
import { compare, competitorGross, improvementNote, ourGrossUnits } from './competitorQuote'
import type { IntakeLine } from './intake'

/**
 * «Mejora esta cotización» (2026-11-20).
 *
 * Lo que se fija:
 *  · todo se compara CON IGV, con la tasa de la tienda para los dos lados;
 *  · el precio de la tienda es el del servidor de precios (el del carrito),
 *    nunca uno que traiga la IA;
 *  · solo quien compra para una empresa puede pedir mejor precio, y solo por
 *    las líneas en que la tienda sale más cara, con la referencia en la nota.
 */

const holder = vi.hoisted(() => ({
  result: null as unknown,
  quote: null as unknown,
  context: null as unknown,
  requestQuote: vi.fn(),
}))

vi.mock('./intake', async (importOriginal) => {
  const real = await importOriginal<typeof import('./intake')>()
  return { ...real, readIntake: vi.fn(async () => holder.result) }
})
vi.mock('@/features/pricing/serverPricing', () => ({
  serverPricing: { quote: vi.fn(async () => holder.quote) },
}))
vi.mock('../commerce/context', () => ({
  useCommerceContext: () => ({ context: holder.context, audience: holder.context ? 'enterprise' : 'consumer' }),
}))
vi.mock('../quotes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../quotes')>()
  return { ...real, requestQuote: holder.requestQuote }
})

const { CompetitorQuotePanel } = await import('./CompetitorQuotePanel')

const LEJIA = '11111111-1111-4111-8111-111111111111'
const DETERGENTE = '22222222-2222-4222-8222-222222222222'

const product = (id: string, sku: string, name: string) => ({
  product_id: id,
  slug: sku.toLowerCase(),
  name,
  sku,
  kind: 'simple' as const,
  brand_name: null,
  in_stock: true,
})

const line = (over: Partial<IntakeLine>): IntakeLine => ({
  indice: 0,
  texto: 'Lejía 5L',
  cantidad: 10,
  cantidad_supuesta: false,
  unidad: 'galón',
  sku_leido: null,
  legible: true,
  confianza: 'probable',
  sku_propuesto: 'LEJ-5',
  coincidencia: product(LEJIA, 'LEJ-5', 'Lejía 5 L'),
  alternativas: [],
  precio_competencia: 12,
  ...over,
})

const priced = (productId: string, net: string): PriceQuote['lines'][number] => ({
  productId,
  variantId: null,
  uomCode: null,
  quantity: 1,
  name: 'x',
  unitPrice: { amount: net, currency: 'PEN' },
  compareAtPrice: null,
  netAmount: net,
  taxRate: '0.18',
  source: 'price_list',
  priceListCode: null,
  scope: 'customer',
  minQuantity: null,
})

const quoteOf = (lines: PriceQuote['lines']): PriceQuote => ({
  currency: 'PEN',
  taxInclusive: false,
  lines,
  netTotal: '0',
  discountTotal: '0',
  taxTotal: '0',
  grossTotal: '0',
  promotions: [],
})

beforeEach(() => {
  holder.result = null
  holder.quote = null
  holder.context = null
  holder.requestQuote.mockReset()
})

describe('la comparación', () => {
  it('lleva los dos precios a la misma base con IGV', () => {
    expect(competitorGross(10, false, 0.18)).toBe(11.8)
    expect(competitorGross(11.8, true, 0.18)).toBe(11.8)
    expect(ourGrossUnits(quoteOf([priced(LEJIA, '10.00')])).get(LEJIA)).toBe(11.8)
    expect(ourGrossUnits({ ...quoteOf([priced(LEJIA, '11.80')]), taxInclusive: true }).get(LEJIA)).toBe(11.8)
  })

  it('suma solo las líneas con los dos precios y dice cuáles salen más caras', () => {
    const r = compare([
      { index: 0, quantity: 10, theirs: 14.16, ours: 11.8 },
      { index: 1, quantity: 2, theirs: 50, ours: 60 },
      { index: 2, quantity: 5, theirs: null, ours: 3 },
    ])
    expect(r.compared).toBe(2)
    expect(r.theirsTotal).toBe(241.6)
    expect(r.oursTotal).toBe(238)
    expect(r.saving).toBe(3.6)
    expect(r.savingPct).toBe(1.5)
    expect(r.pricier).toEqual([1])
  })

  it('la nota de mejora no pasa de 1000 caracteres', () => {
    const nota = improvementNote({
      header: 'Mejora esta cotización',
      currency: 'PEN',
      lines: Array.from({ length: 60 }, (_, i) => ({ text: `Producto largo número ${i} `.repeat(4), quantity: 2, theirs: 10 })),
    })
    expect(nota.length).toBeLessThanOrEqual(1000)
    expect(nota).toMatch(/^Mejora esta cotización\n- /)
  })
})

describe('CompetitorQuotePanel', () => {
  async function leer() {
    await userEvent.type(screen.getByRole('textbox', { name: /pega aquí las líneas/i }), 'lejía 10 x 12')
    await userEvent.click(screen.getByRole('button', { name: /comparar precios/i }))
  }

  it('enseña el ahorro con el precio del servidor y pasa lo marcado al pedido', async () => {
    holder.result = {
      data: { lineas: [line({})], notas: null, cotizacion: { moneda: 'PEN', incluye_igv: false } },
      motivo: null,
      interactionId: 'x',
    }
    holder.quote = quoteOf([priced(LEJIA, '10.00')])
    const onAccept = vi.fn()
    renderWithProviders(<CompetitorQuotePanel storeSlug="botica" currency="PEN" onAccept={onAccept} />)
    await leer()

    // 12 sin IGV = 14.16 con IGV; aquí 10 + IGV = 11.80. 10 unidades: ahorro 23.60.
    const resumen = await screen.findByText(/con nosotros ahorras/i)
    expect(resumen.textContent).toMatch(/23[.,]60/)
    expect(screen.getByText('Más barato')).toBeInTheDocument()
    // Sin cuenta de empresa no se ofrece pedir mejor precio.
    expect(screen.queryByRole('button', { name: /pedir mejor precio/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /pasar 1 líneas al pedido/i }))
    expect(onAccept).toHaveBeenCalledWith([{ sku: 'LEJ-5', quantity: 10 }])
  })

  it('con cuenta de empresa pide mejor precio SOLO por las líneas más caras', async () => {
    holder.context = { account_name: 'Distribuidora Prueba SAC' }
    holder.result = {
      data: {
        lineas: [
          line({}),
          line({
            indice: 1,
            texto: 'Detergente 15kg',
            cantidad: 2,
            sku_propuesto: 'DET-15',
            coincidencia: product(DETERGENTE, 'DET-15', 'Detergente industrial 15 kg'),
            precio_competencia: 59,
          }),
        ],
        notas: null,
        cotizacion: { moneda: 'PEN', incluye_igv: true },
      },
      motivo: null,
      interactionId: 'x',
    }
    holder.quote = quoteOf([priced(LEJIA, '10.00'), priced(DETERGENTE, '60.00')])
    holder.requestQuote.mockResolvedValue({ quote_id: 'q', quote_number: 'COT-0007', already_requested: false })
    renderWithProviders(<CompetitorQuotePanel storeSlug="botica" currency="PEN" onAccept={vi.fn()} />)
    await leer()

    const fila = await screen.findByText('Detergente 15kg')
    expect(within(fila.closest('tr')!).getByText('Más caro')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /pedir mejor precio \(1\)/i }))

    expect(holder.requestQuote).toHaveBeenCalledTimes(1)
    const pedido = holder.requestQuote.mock.calls[0]![0] as { lines: unknown[]; notes: string }
    expect(pedido.lines).toEqual([{ product_id: DETERGENTE, quantity: 2 }])
    expect(pedido.notes).toMatch(/Detergente 15kg × 2: PEN 59\.00/)
    expect(await screen.findByText(/COT-0007/)).toBeInTheDocument()
  })

  it('en otra moneda no compara y lo dice', async () => {
    holder.result = {
      data: { lineas: [line({})], notas: null, cotizacion: { moneda: 'USD', incluye_igv: null } },
      motivo: null,
      interactionId: 'x',
    }
    holder.quote = quoteOf([priced(LEJIA, '10.00')])
    renderWithProviders(<CompetitorQuotePanel storeSlug="botica" currency="PEN" onAccept={vi.fn()} />)
    await leer()
    expect(await screen.findByText(/la cotización está en USD/i)).toBeInTheDocument()
    expect(screen.queryByText(/con nosotros ahorras/i)).not.toBeInTheDocument()
  })
})
