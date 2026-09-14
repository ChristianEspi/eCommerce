import { describe, expect, it } from 'vitest'
import { returnPathFrom, returnPathOr, storefrontSlugOf } from './returnTo'

/**
 * La vuelta después de entrar (N02) no puede ser un redirector abierto: ni por
 * el estado de navegación ni por la URL, que es la que alguien puede fabricar.
 */
describe('returnPathFrom', () => {
  it('toma el estado de navegación si es una ruta interna', () => {
    expect(returnPathFrom({ from: '/s/marathon/account' }, '')).toBe('/s/marathon/account')
  })

  it('sin estado, toma ?from= de la URL', () => {
    expect(returnPathFrom(null, '?from=%2Fs%2Fmarathon%2Faccount')).toBe('/s/marathon/account')
  })

  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['https://evil.com/s/marathon'],
    ['javascript:alert(1)'],
    ['/s/marathon\taccount'],
    [''],
  ])('ignora %j venga por donde venga', (malo) => {
    expect(returnPathFrom({ from: malo }, `?from=${encodeURIComponent(malo)}`)).toBeNull()
  })

  it('un estado malo no tapa una URL buena, y viceversa', () => {
    expect(returnPathFrom({ from: '//evil.com' }, '?from=%2Fs%2Fa%2Fcart')).toBe('/s/a/cart')
  })

  it('con suelo: sin vuelta válida, `/app` (el backoffice de siempre)', () => {
    expect(returnPathOr(null, '?returnTo=%2F%2Fevil.com', '/app', 'returnTo')).toBe('/app')
    expect(returnPathOr(null, '?returnTo=%2Fs%2Fa%2Faccount', '/app', 'returnTo')).toBe('/s/a/account')
  })
})

describe('storefrontSlugOf', () => {
  it('reconoce la vitrina y su slug', () => {
    expect(storefrontSlugOf('/s/marathon')).toBe('marathon')
    expect(storefrontSlugOf('/s/marathon/account')).toBe('marathon')
    expect(storefrontSlugOf('/s/mi-quimica?x=1')).toBe('mi-quimica')
  })

  it('el backoffice y lo que no es ruta interna no son vitrina', () => {
    expect(storefrontSlugOf('/app')).toBeNull()
    expect(storefrontSlugOf('/app/s/marathon')).toBeNull()
    expect(storefrontSlugOf('//s/marathon')).toBeNull()
    expect(storefrontSlugOf(null)).toBeNull()
  })
})
