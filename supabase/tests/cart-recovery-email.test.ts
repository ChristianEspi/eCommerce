// @vitest-environment node
/**
 * El correo `cart.recovery`: plantilla ES/EN, enlace al carrito y enlace de baja.
 *
 * Sin red y sin secretos, igual que `notifications-email.test.ts`. Lo que se fija
 * es lo que convierte un recordatorio en un problema si se rompe: que salga sin
 * forma de darse de baja, que el enlace de baja lleve a otro sitio o que el
 * nombre de la tienda entre como HTML.
 */
import { describe, expect, it } from 'vitest'
import { dispatchPendingEmails, type ClaimedEmail, type DispatchPorts } from '../functions/_shared/notifications/dispatch.ts'
import {
  actionUrl,
  renderEmail,
  TEMPLATE_KINDS,
  unsubscribeUrl,
} from '../functions/_shared/notifications/templates.ts'

const BASE = 'https://tienda.ebim.test'
const TOKEN = 'ab'.repeat(32)

const params = {
  store_name: 'Química Suiza',
  store_slug: 'miquimica',
  line_count: 3,
  unsubscribe_token: TOKEN,
}

describe('plantilla cart.recovery', () => {
  it('existe entre las plantillas que puede usar la base', () => {
    expect(TEMPLATE_KINDS).toContain('cart.recovery')
  })

  it('en español: asunto con la tienda, botón al carrito y enlace de baja', () => {
    const correo = renderEmail('cart.recovery', 'es', params, BASE)
    expect(correo?.subject).toBe('Dejaste productos en tu carrito de Química Suiza')
    expect(correo?.html).toContain('href="https://tienda.ebim.test/s/miquimica/cart"')
    expect(correo?.html).toContain(`href="https://tienda.ebim.test/s/miquimica/unsubscribe?token=${TOKEN}"`)
    expect(correo?.html).toContain('Darme de baja')
    expect(correo?.html).toContain('lang="es"')
  })

  it('en inglés', () => {
    const correo = renderEmail('cart.recovery', 'en', params, BASE)
    expect(correo?.subject).toBe('You left items in your Química Suiza cart')
    expect(correo?.html).toContain('Back to my cart')
    expect(correo?.html).toContain('Unsubscribe')
    expect(correo?.html).toContain('lang="en"')
  })

  it('no lleva precios ni importes: se confirman al pagar', () => {
    const correo = renderEmail('cart.recovery', 'es', { ...params, grand_total: '999.00', currency: 'PEN' }, BASE)
    expect(correo?.html).not.toContain('999.00')
    expect(correo?.html).not.toContain('PEN')
  })

  it('el nombre de la tienda no entra como HTML', () => {
    const correo = renderEmail('cart.recovery', 'es', { ...params, store_name: '<script>x</script>' }, BASE)
    expect(correo?.html).not.toContain('<script>')
    expect(correo?.html).toContain('&lt;script&gt;')
  })

  it('SIN secreto de baja válido no se renderiza: un recordatorio no sale sin baja', () => {
    for (const token of [undefined, '', 'corto', 'AB'.repeat(32), `${'a'.repeat(63)}"`]) {
      expect(renderEmail('cart.recovery', 'es', { ...params, unsubscribe_token: token }, BASE)).toBeNull()
    }
  })

  it('con un slug raro o una base insegura tampoco', () => {
    expect(renderEmail('cart.recovery', 'es', { ...params, store_slug: '../admin' }, BASE)).toBeNull()
    expect(renderEmail('cart.recovery', 'es', params, 'javascript:alert(1)')).toBeNull()
  })

  it('el enlace de baja es solo de esta plantilla', () => {
    expect(unsubscribeUrl('order.confirmed', params, BASE)).toBeNull()
    expect(renderEmail('order.confirmed', 'es', { ...params, order_number: 'EC-1' }, BASE)?.html).not.toContain('unsubscribe')
    expect(actionUrl('cart.recovery', params, `${BASE}/`)).toBe(`${BASE}/s/miquimica/cart`)
  })
})

describe('el worker con cart.recovery', () => {
  const correo = (id: string, extra: Record<string, unknown> = {}): ClaimedEmail => ({
    id, kind: 'cart.recovery', locale: 'es', to_address: `${id}@cliente.com`, attempts: 1,
    params: { ...params, ...extra },
  })

  it('envía el recordatorio válido y cierra sin reintento el que no tiene baja', async () => {
    const completed: string[] = []
    const failed: Array<[string, string, boolean]> = []
    const html: string[] = []
    const ports: DispatchPorts = {
      claim: async () => [correo('a'), correo('b', { unsubscribe_token: null })],
      token: async () => 'tok',
      complete: async (id) => { completed.push(id) },
      fail: async (id, code, retryable) => { failed.push([id, code, retryable]) },
      send: async (_t, message) => {
        html.push(message.html)
        return { ok: true, reference: 'r' }
      },
    }

    const informe = await dispatchPendingEmails(ports, { limit: 10, baseUrl: BASE })
    expect(informe).toEqual({ claimed: 2, sent: 1, failed: 1, stoppedBy: null })
    expect(completed).toEqual(['a'])
    expect(failed).toEqual([['b', 'PLANTILLA_DESCONOCIDA', false]])
    expect(html[0]).toContain('/s/miquimica/unsubscribe?token=')
  })
})