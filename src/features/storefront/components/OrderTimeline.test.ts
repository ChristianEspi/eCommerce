import { describe, expect, it } from 'vitest'
import { orderSteps, pedidoTerminado } from './orderSteps'

const estados = (input: Parameters<typeof orderSteps>[0]) =>
  Object.fromEntries(orderSteps(input).map((paso) => [paso.key, paso.estado]))

describe('línea de tiempo del pedido', () => {
  it('recojo en tienda: preparando, listo para recoger y recogido; nada de «en camino»', () => {
    const base = { status: 'paid', paid: true, approvalStatus: 'not_required', pickup: true }
    expect(orderSteps({ ...base, fulfillmentStatus: 'unfulfilled' }).map((p) => p.key)).toEqual([
      'placed',
      'payment',
      'preparing',
      'readyForPickup',
      'pickedUp',
    ])
    // Pagado: se está preparando.
    expect(estados({ ...base, fulfillmentStatus: 'unfulfilled' })).toMatchObject({
      payment: 'done',
      preparing: 'current',
      readyForPickup: 'pending',
    })
    // Ya en el punto: listo para recoger.
    expect(estados({ ...base, fulfillmentStatus: 'in_progress', pickupReady: true })).toMatchObject({
      preparing: 'done',
      readyForPickup: 'current',
      pickedUp: 'pending',
    })
    expect(estados({ ...base, fulfillmentStatus: 'fulfilled' }).pickedUp).toBe('done')
    // Sin pagar (transferencia): no se prepara todavía.
    expect(estados({ ...base, status: 'pending', paid: false, fulfillmentStatus: 'unfulfilled' })).toMatchObject({
      payment: 'current',
      preparing: 'pending',
    })
    // Pago al recoger: se prepara ya y el cobro va al final.
    expect(
      orderSteps({ ...base, status: 'pending', paid: false, payOnDelivery: true, fulfillmentStatus: 'unfulfilled' }).map(
        (p) => [p.key, p.estado],
      ),
    ).toEqual([
      ['placed', 'done'],
      ['preparing', 'current'],
      ['readyForPickup', 'pending'],
      ['pickedUp', 'pending'],
      ['paymentOnPickup', 'pending'],
    ])
  })

  it('contra entrega: el pago va al FINAL y no queda «en curso» antes de recibir', () => {
    const base = { status: 'pending', paid: false, approvalStatus: 'not_required', payOnDelivery: true }
    const pasos = orderSteps({ ...base, fulfillmentStatus: 'unfulfilled' })
    expect(pasos.map((p) => p.key)).toEqual(['placed', 'shipping', 'delivered', 'paymentOnDelivery'])
    expect(estados({ ...base, fulfillmentStatus: 'unfulfilled' })).toEqual({
      placed: 'done',
      shipping: 'pending',
      delivered: 'pending',
      paymentOnDelivery: 'pending',
    })
    expect(estados({ ...base, fulfillmentStatus: 'in_progress' }).shipping).toBe('current')
    // Entregado y sin cobrar: ahora sí, el cobro es lo que falta.
    expect(estados({ ...base, fulfillmentStatus: 'fulfilled' })).toMatchObject({
      delivered: 'done',
      paymentOnDelivery: 'current',
    })
    // Ya cobrado: vuelve la línea de siempre, con el pago hecho.
    expect(orderSteps({ ...base, paid: true, fulfillmentStatus: 'fulfilled' }).map((p) => p.key)).toEqual([
      'placed',
      'payment',
      'shipping',
      'delivered',
    ])
  })

  it('sin aprobación el paso no existe; recién registrado, lo que sigue es pagar', () => {
    const pasos = orderSteps({ status: 'pending', paid: false, approvalStatus: 'not_required', fulfillmentStatus: 'unfulfilled' })
    expect(pasos.map((p) => p.key)).toEqual(['placed', 'payment', 'shipping', 'delivered'])
    expect(estados({ status: 'pending', paid: false, approvalStatus: null, fulfillmentStatus: null })).toMatchObject({
      placed: 'done',
      payment: 'current',
      shipping: 'pending',
    })
  })

  it('esperando aprobación: la aprobación está en curso y el pago todavía no', () => {
    expect(estados({ status: 'pending', paid: false, approvalStatus: 'pending', fulfillmentStatus: 'unfulfilled' })).toEqual({
      placed: 'done',
      approval: 'current',
      payment: 'pending',
      shipping: 'pending',
      delivered: 'pending',
    })
  })

  it('una aprobación rechazada se DICE, no se esconde', () => {
    expect(estados({ status: 'pending', paid: false, approvalStatus: 'rejected', fulfillmentStatus: null }).approval).toBe('failed')
  })

  it('pagado y en camino; entregado marca todo lo anterior como hecho', () => {
    expect(estados({ status: 'paid', paid: true, approvalStatus: 'approved', fulfillmentStatus: 'in_progress' })).toMatchObject({
      approval: 'done',
      payment: 'done',
      shipping: 'current',
      delivered: 'pending',
    })
    expect(estados({ status: 'fulfilled', paid: true, approvalStatus: null, fulfillmentStatus: 'fulfilled' })).toMatchObject({
      shipping: 'done',
      delivered: 'done',
    })
  })

  it('un pedido anulado no deja nada «en curso»', () => {
    const pasos = orderSteps({ status: 'cancelled', paid: false, approvalStatus: null, fulfillmentStatus: null })
    expect(pasos.some((paso) => paso.estado === 'current')).toBe(false)
  })
})

describe('pedidoTerminado: cuándo la confirmación deja de consultar', () => {
  it('sin datos o en curso, sigue consultando', () => {
    expect(pedidoTerminado(undefined)).toBe(false)
    expect(pedidoTerminado({ status: 'pending', payment_status: 'pending', fulfillment_status: 'unfulfilled' })).toBe(false)
    // Cobrado pero sin entregar: falta que la tienda despache.
    expect(pedidoTerminado({ status: 'paid', payment_status: 'paid', fulfillment_status: 'in_progress' })).toBe(false)
    // Entregado pero sin cobrar (pago contra entrega aún no registrado).
    expect(pedidoTerminado({ status: 'pending', payment_status: 'pending', fulfillment_status: 'fulfilled' })).toBe(false)
  })

  it('pagado y entregado, cancelado o reembolsado: ya no se mueve', () => {
    expect(pedidoTerminado({ status: 'fulfilled', payment_status: 'paid', fulfillment_status: 'fulfilled' })).toBe(true)
    expect(pedidoTerminado({ status: 'cancelled' })).toBe(true)
    expect(pedidoTerminado({ status: 'refunded' })).toBe(true)
  })
})
