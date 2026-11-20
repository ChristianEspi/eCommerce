import type { PriceQuote } from '@/domain'

/**
 * «Mejora esta cotización» (2026-11-20) — la comparación, sin pantalla.
 *
 * El comprador sube la cotización de OTRO proveedor. La IA solo copia lo que
 * dice el papel (producto, cantidad, precio unitario, moneda, si lleva IGV); el
 * precio de ESTA tienda sale del servidor de precios con la sesión del
 * comprador —lista, convenio, escala por cantidad—, el mismo que cobra el
 * carrito. Aquí solo se ponen los dos números en la misma base y se restan.
 *
 * ## La misma base: con IGV
 *
 * Una cotización peruana suele dar el valor unitario SIN IGV y sumarlo al final;
 * la tienda puede tener precios con o sin impuesto dentro. Comparar un número
 * con IGV contra uno sin él da un 18 % de «ahorro» que no existe. Por eso todo
 * se lleva a precio CON impuesto antes de comparar, con la tasa de la línea de
 * la tienda para los dos lados.
 */

/** Precio unitario de la tienda, con impuesto, por producto. */
export function ourGrossUnits(quote: PriceQuote): Map<string, number> {
  const units = new Map<string, number>()
  for (const line of quote.lines) {
    if (units.has(line.productId)) continue
    const net = Number(line.unitPrice.amount)
    const rate = Number(line.taxRate)
    if (!Number.isFinite(net)) continue
    const gross = quote.taxInclusive || !Number.isFinite(rate) ? net : net * (1 + rate)
    units.set(line.productId, round(gross))
  }
  return units
}

/** Tasa de impuesto de cada producto según la tienda (para llevar el precio rival a la misma base). */
export function taxRates(quote: PriceQuote): Map<string, number> {
  const rates = new Map<string, number>()
  for (const line of quote.lines) {
    const rate = Number(line.taxRate)
    if (!rates.has(line.productId) && Number.isFinite(rate)) rates.set(line.productId, rate)
  }
  return rates
}

/** El precio de la otra cotización, con impuesto. */
export function competitorGross(price: number, includesTax: boolean, taxRate: number): number {
  return round(includesTax ? price : price * (1 + taxRate))
}

export interface ComparableLine {
  readonly index: number
  readonly quantity: number
  /** Unitario de la otra cotización, ya con impuesto. `null` = no se leyó. */
  readonly theirs: number | null
  /** Unitario de la tienda, con impuesto. `null` = sin producto o sin precio. */
  readonly ours: number | null
}

export interface Comparison {
  /** Líneas con los dos precios: las únicas que suman. */
  readonly compared: number
  readonly theirsTotal: number
  readonly oursTotal: number
  /** Positivo = la tienda es más barata. */
  readonly saving: number
  /** Ahorro sobre el total de la otra cotización, en %. 0 sin base. */
  readonly savingPct: number
  /** Índices de las líneas en que la tienda sale más cara. */
  readonly pricier: readonly number[]
}

export function compare(lines: readonly ComparableLine[]): Comparison {
  let compared = 0
  let theirsTotal = 0
  let oursTotal = 0
  const pricier: number[] = []
  for (const line of lines) {
    if (line.theirs === null || line.ours === null || line.quantity < 1) continue
    compared += 1
    theirsTotal += line.theirs * line.quantity
    oursTotal += line.ours * line.quantity
    if (line.ours > line.theirs) pricier.push(line.index)
  }
  theirsTotal = round(theirsTotal)
  oursTotal = round(oursTotal)
  const saving = round(theirsTotal - oursTotal)
  return {
    compared,
    theirsTotal,
    oursTotal,
    saving,
    savingPct: theirsTotal > 0 ? Math.round((saving / theirsTotal) * 1000) / 10 : 0,
    pricier,
  }
}

/**
 * La nota de la solicitud de mejor precio: lo que ofrece la otra cotización en
 * las líneas en que la tienda sale más cara. Sin el nombre del otro proveedor
 * (la IA no lo copia) y dentro del máximo de la nota (1000 caracteres).
 */
export function improvementNote(input: {
  readonly header: string
  readonly currency: string
  readonly lines: ReadonlyArray<{ readonly text: string; readonly quantity: number; readonly theirs: number }>
}): string {
  const out: string[] = [input.header]
  for (const line of input.lines) {
    const row = `- ${line.text.slice(0, 80)} × ${line.quantity}: ${input.currency} ${line.theirs.toFixed(2)}`
    if ([...out, row].join('\n').length > 1000) break
    out.push(row)
  }
  return out.join('\n')
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
