// @vitest-environment node
/**
 * El checkout anota quién compró (H02), sin poder tumbar la compra.
 *
 * Se prueba el ADAPTADOR con llamadores falsos: la base ya tiene su suite
 * (`consumer-account.test.ts`). Aquí se defiende el orden y las garantías:
 *
 *  - sin sesión no se pregunta nada ni se vincula nada;
 *  - con sesión, el usuario es el VERIFICADO por `current_buyer()`, nunca el
 *    `sub` leído del token;
 *  - si ya se verificó en la etapa 2, no se pregunta dos veces;
 *  - si verificar o vincular falla, el pedido se devuelve igual.
 */
import { describe, expect, it, vi } from 'vitest'

import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import type { AccountContext, CheckoutPorts, CheckoutRequest } from '../functions/_shared/checkout/ports.ts'

const ORDER = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'

const REQUEST: CheckoutRequest = {
  storeSlug: 'tienda-a',
  idempotencyKey: 'k'.repeat(32),
  requestHash: 'h'.repeat(64),
  cartToken: null,
  customerName: 'Ana Perez',
  customerEmail: 'ana@compradora.test',
  customerPhone: '+51 999 888 777',
  shippingAddress: { address: 'Av. Arequipa 100' },
  billingAddress: null,
  notes: null,
  items: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
  paymentMethodCode: null,
  couponCodes: [],
  giftCardCodes: [],
  delivery: null,
} as unknown as CheckoutRequest

function account(overrides: Partial<AccountContext> = {}): AccountContext {
  return { hasSession: true, userId: null, accountId: null, role: null, spendingLimit: null, ...overrides }
}

function build(options: {
  hasSession: boolean
  caller?: RpcCaller
  link?: (args: Record<string, unknown>) => unknown
}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const service: RpcCaller = async (fn, args) => {
    calls.push({ fn, args })
    if (fn === 'checkout_place_order') {
      return { order_id: ORDER, order_number: 'A-0001', status: 'pending', currency: 'PEN', grand_total: '10.00' }
    }
    if (fn === 'checkout_link_order_buyer') return options.link ? options.link(args) : true
    return null
  }
  const caller = vi.fn(options.caller ?? (async () => ({ user_id: USER })))
  const ports: CheckoutPorts = createDbPorts({ service, caller, hasSession: options.hasSession })
  return { ports, calls, caller }
}

async function place(ports: CheckoutPorts, acc: AccountContext) {
  return ports.placeOrder({
    intentId: '11111111-1111-4111-8111-111111111111',
    request: REQUEST,
    reservationToken: null,
    payment: { status: 'not_required', providerCode: null, providerReference: null, providerMessage: null },
    account: acc,
    approval: null,
    giftCards: null,
  })
}

describe('el vínculo del comprador en placeOrder', () => {
  it('sin sesión no pregunta quién compra ni vincula', async () => {
    const { ports, calls, caller } = build({ hasSession: false })
    const order = await place(ports, account({ hasSession: false }))

    expect(order.orderId).toBe(ORDER)
    expect(caller).not.toHaveBeenCalled()
    expect(calls.map((c) => c.fn)).not.toContain('checkout_link_order_buyer')
  })

  it('con sesión vincula con el usuario que devuelve current_buyer()', async () => {
    const { ports, calls, caller } = build({ hasSession: true })
    await place(ports, account())

    expect(caller).toHaveBeenCalledWith('current_buyer', {})
    expect(calls.find((c) => c.fn === 'checkout_link_order_buyer')?.args).toEqual({
      p_order_id: ORDER,
      p_user_id: USER,
    })
  })

  it('si la etapa 2 ya verificó al usuario, no pregunta otra vez', async () => {
    const { ports, calls, caller } = build({ hasSession: true })
    await place(ports, account({ userId: USER }))

    expect(caller).not.toHaveBeenCalled()
    expect(calls.find((c) => c.fn === 'checkout_link_order_buyer')?.args).toMatchObject({ p_user_id: USER })
  })

  it('un token que la base no reconoce no vincula nada, y el pedido sigue', async () => {
    const { ports, calls } = build({
      hasSession: true,
      caller: async () => {
        throw new Error('JWSError: firma inválida')
      },
    })
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const order = await place(ports, account())
      expect(order.orderId).toBe(ORDER)
      expect(calls.map((c) => c.fn)).not.toContain('checkout_link_order_buyer')
    } finally {
      errores.mockRestore()
    }
  })

  it('current_buyer sin usuario tampoco vincula', async () => {
    const { ports, calls } = build({ hasSession: true, caller: async () => ({ user_id: null }) })
    await place(ports, account())
    expect(calls.map((c) => c.fn)).not.toContain('checkout_link_order_buyer')
  })

  it('si el vínculo falla, la compra no se cae', async () => {
    const { ports } = build({
      hasSession: true,
      link: () => {
        throw new Error('boom')
      },
    })
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const order = await place(ports, account())
      expect(order).toMatchObject({ orderId: ORDER, orderNumber: 'A-0001' })
      expect(errores).toHaveBeenCalled()
    } finally {
      errores.mockRestore()
    }
  })
})
