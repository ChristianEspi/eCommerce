import { describe, expect, it } from 'vitest'
import { installmentFor, readInstallments } from './productDetail'

describe('cuotas de la ficha', () => {
  it('lee lo que la tienda declaró y descarta lo mal formado', () => {
    expect(readInstallments({ count: 3, provider: 'Tarjeta Andes', min_amount: 20 })).toEqual({
      count: 3,
      provider: 'Tarjeta Andes',
      min_amount: 20,
    })
    expect(readInstallments(null)).toBeNull()
    expect(readInstallments({ count: 1 })).toBeNull()
    expect(readInstallments('3')).toBeNull()
  })

  it('divide en céntimos y redondea hacia arriba', () => {
    expect(installmentFor({ count: 3 }, 21.9)).toEqual({ count: 3, amount: 7.3, provider: null })
    expect(installmentFor({ count: 3 }, 10)).toEqual({ count: 3, amount: 3.34, provider: null })
  })

  it('no anuncia nada por debajo del mínimo, sin precio o sin configuración', () => {
    expect(installmentFor({ count: 3, min_amount: 50 }, 21.9)).toBeNull()
    expect(installmentFor({ count: 3 }, 0)).toBeNull()
    expect(installmentFor(null, 21.9)).toBeNull()
  })
})
