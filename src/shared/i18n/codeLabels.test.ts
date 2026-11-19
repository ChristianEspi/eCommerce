import { describe, expect, it } from 'vitest'
import { codeLabel, eventLabel } from './codeLabels'
import { esBackoffice } from './messages.es.backoffice'
import { en } from './messages.en'
import type { MessageKey } from './messages'

const es = (key: MessageKey) => (esBackoffice as Record<string, string>)[key] ?? key
const ing = (key: MessageKey) => (en as Record<string, string>)[key] ?? key

describe('códigos de máquina en pantalla', () => {
  it('un evento con texto propio usa ese texto', () => {
    expect(eventLabel(es, 'payment.intent_opened')).toBe('Cobro iniciado')
    expect(eventLabel(es, 'payment.manual_capture')).toBe('Cobro confirmado a mano')
    expect(eventLabel(ing, 'payment.captured')).toBe('Payment confirmed')
  })

  it('una acción de auditoría se compone con su entidad', () => {
    expect(eventLabel(es, 'customer.updated')).toBe('Cambio en cliente')
    expect(eventLabel(es, 'payment_method.deleted')).toBe('Baja de medio de pago')
    expect(eventLabel(ing, 'store.created')).toBe('store created'.replace(/^s/, 'S'))
  })

  it('lo desconocido nunca sale con puntos ni guiones bajos', () => {
    expect(eventLabel(es, 'algo_nuevo.cosa_rara')).toBe('Algo nuevo cosa rara')
    expect(eventLabel(es, 'customer.cosa_rara')).toBe('Cliente · cosa rara')
    expect(eventLabel(es, null)).toBe('—')
  })

  it('los códigos de error se leen; los del proveedor quedan tal cual', () => {
    expect(codeLabel(es, 'STOCK_INSUFICIENTE')).toBe('Stock insuficiente')
    expect(codeLabel(es, 'OTRO_CODIGO_NUEVO')).toBe('Otro codigo nuevo')
    expect(codeLabel(es, 'CLQ51')).toBe('CLQ51')
    expect(codeLabel(ing, 'PAGO_RECHAZADO')).toBe('Payment declined')
    expect(codeLabel(es, 'kind.checkout_failed')).toBe('Compra fallida')
  })
})

describe('resúmenes con códigos dentro', () => {
  it('traduce cada código en su sitio', async () => {
    const { summaryLabel } = await import('./codeLabels')
    expect(summaryLabel(es, 'etapa reserve_inventory')).toBe('Etapa reserva de stock')
    expect(summaryLabel(es, 'checkout_failed · STOCK_INSUFICIENTE')).toBe('Compra fallida · Stock insuficiente')
  })
})
