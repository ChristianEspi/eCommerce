// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { watchActionHref } from './links'

const base = { count: 3, samples: [] as Array<{ label: string }> }

describe('watchActionHref (2026-11-23)', () => {
  it('un aviso de inventario de UN artículo lleva a sus alertas filtradas', () => {
    expect(
      watchActionHref({
        ...base,
        key: 'inventory.below_reorder',
        href: '/app/inventory?alerta=below_reorder#alertas',
        samples: [{ label: 'VIT-VTC-1G0' }],
      }),
    ).toBe('/app/inventory?alerta=below_reorder&buscar=VIT-VTC-1G0#alertas')
  })

  it('con varios artículos deja el enlace del módulo', () => {
    expect(
      watchActionHref({
        ...base,
        key: 'inventory.negative',
        href: '/app/inventory?alerta=negative#alertas',
        samples: [{ label: 'A' }, { label: 'B' }],
      }),
    ).toBe('/app/inventory?alerta=negative#alertas')
  })

  it('«Cobrar» abre Pedidos en la pestaña de pendientes; «Despachar», en pagados', () => {
    expect(watchActionHref({ ...base, key: 'orders.unpaid', href: '/app/orders' })).toBe('/app/orders?estado=pending')
    expect(watchActionHref({ ...base, key: 'orders.paid_unshipped', href: '/app/orders' })).toBe('/app/orders?estado=paid')
    expect(watchActionHref({ ...base, key: 'orders.awaiting_approval', href: '/app/orders' })).toBe(
      '/app/orders?estado=awaiting_approval',
    )
  })

  it('un solo pedido sin cobrar se abre buscado por su número', () => {
    expect(
      watchActionHref({ key: 'orders.unpaid', href: '/app/orders', count: 1, samples: [{ label: 'MQ-2026-0041' }] }),
    ).toBe('/app/orders?estado=pending&buscar=MQ-2026-0041')
  })

  it('un aviso que no se afina conserva su enlace', () => {
    expect(watchActionHref({ ...base, key: 'credit.overdue', href: '/app/credit' })).toBe('/app/credit')
  })
})
