import { describe, expect, it } from 'vitest'
import { esAcuerdoDelComprador } from './agreement'

describe('esAcuerdoDelComprador', () => {
  it('lista de segmento o de cliente: es un acuerdo', () => {
    expect(esAcuerdoDelComprador({ source: 'price_list', scope: 'segment' })).toBe(true)
    expect(esAcuerdoDelComprador({ source: 'price_list', scope: 'customer' })).toBe(true)
  })

  it('la lista general de la tienda o de canal no lo es (hallazgo A3)', () => {
    expect(esAcuerdoDelComprador({ source: 'price_list', scope: 'store' })).toBe(false)
    expect(esAcuerdoDelComprador({ source: 'price_list', scope: 'channel' })).toBe(false)
    expect(esAcuerdoDelComprador({ source: 'price_list', scope: null })).toBe(false)
  })

  it('el precio de catálogo tampoco', () => {
    expect(esAcuerdoDelComprador({ source: 'catalog', scope: null })).toBe(false)
  })
})
