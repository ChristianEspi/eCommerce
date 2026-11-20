import { describe, expect, it } from 'vitest'
import { promotionHref } from './promotions'

const base = { id: '00000000-0000-4000-8000-000000000001', categorySlug: null, brandCode: null, hasProducts: false }

describe('2026-11-20 · «Ver los productos» de una campaña', () => {
  it('categoría y marca mandan, como antes', () => {
    expect(promotionHref({ ...base, categorySlug: 'gripe', hasProducts: true }, 'qs')).toBe('/s/qs?c=gripe')
    expect(promotionHref({ ...base, brandCode: 'quilab' }, 'qs')).toBe('/s/qs?b=quilab')
  })

  it('una campaña de productos concretos lleva a SUS productos, no a todas las ofertas', () => {
    expect(promotionHref({ ...base, hasProducts: true }, 'qs')).toBe(`/s/qs?ver=todo&campana=${base.id}`)
  })

  it('la de pedido entero sigue yendo a las ofertas (o a donde diga el banner)', () => {
    expect(promotionHref(base, 'qs')).toBe('/s/qs?ver=todo&oferta=1')
    expect(promotionHref(base, 'qs', '/s/qs')).toBe('/s/qs')
  })
})
