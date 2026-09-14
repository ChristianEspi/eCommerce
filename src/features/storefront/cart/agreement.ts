import type { PriceQuote } from '@/domain'

type QuotedLine = PriceQuote['lines'][number]

/**
 * ¿Esta línea sale de un acuerdo DE ESTE COMPRADOR?
 *
 * Solo una lista asignada a su cliente o a su segmento es «precio especial». La
 * lista general de la tienda también resuelve como `price_list`, y con ella un
 * visitante anónimo —o un consumidor con sesión— leía «precio especial» en el
 * precio de todo el mundo (hallazgo A3 de la auditoría H01, visto en el carrito
 * y otra vez en el resumen del checkout).
 *
 * Una sola regla para las tres pantallas que ponen la etiqueta. Es presentación:
 * el importe no depende de esto en nada.
 */
export function esAcuerdoDelComprador(line: Pick<QuotedLine, 'source' | 'scope'>): boolean {
  return line.source === 'price_list' && (line.scope === 'segment' || line.scope === 'customer')
}
