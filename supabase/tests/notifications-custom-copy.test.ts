// @vitest-environment node
/**
 * Textos de correo de la tienda: validación, armado seguro y uso en el envío.
 */
import { describe, expect, it } from 'vitest'
import {
  defaultCopy,
  EDITABLE_KIND_LIST,
  fillHtml,
  fillText,
  resolveCopyFromParams,
  sampleValues,
  validateCopy,
  variablesOf,
} from '../functions/_shared/notifications/customCopy.ts'
import { dispatchPendingEmails, type ClaimedEmail } from '../functions/_shared/notifications/dispatch.ts'
import { renderEmail } from '../functions/_shared/notifications/templates.ts'

const NOW = new Date('2026-11-20T15:00:00Z')
const PARAMS = {
  order_number: 'EC-1',
  grand_total: '715.2',
  currency: 'PEN',
  customer_name: 'Ana <b>Torres</b>',
  store_name: 'Mi Tienda',
  store_slug: 'mitienda',
}

describe('catálogo', () => {
  it('cada aviso editable trae texto original válido en los dos idiomas', () => {
    for (const kind of EDITABLE_KIND_LIST) {
      for (const locale of ['es', 'en'] as const) {
        const copy = defaultCopy(kind, locale)
        expect(copy).not.toBeNull()
        expect(validateCopy(kind, copy!)).toEqual([])
      }
    }
    expect(variablesOf('order.rejected', 'es').map((v) => v.key)).toContain('motivo')
    expect(variablesOf('order.confirmed', 'es').map((v) => v.key)).not.toContain('motivo')
  })
})

describe('validación', () => {
  it('vacío, largo y variable desconocida', () => {
    const issues = validateCopy('order.confirmed', { subject: '', title: 'x'.repeat(121), body: 'Hola {{clave}}' })
    expect(issues).toEqual([
      { field: 'subject', code: 'VACIO' },
      { field: 'title', code: 'MUY_LARGO' },
      { field: 'body', code: 'VARIABLE_DESCONOCIDA', variable: 'clave' },
    ])
  })
})

describe('armado', () => {
  it('asunto en texto plano; mensaje escapado, variables en negrita y párrafos', () => {
    const v = new Map([
      ['pedido', 'EC-1'],
      ['cliente', 'Ana <b>Torres</b>'],
    ])
    expect(fillText('Pedido  {{ pedido }} {{nada}}', v)).toBe('Pedido EC-1')
    const html = fillHtml('Hola {{cliente}} <script>x</script>\nlínea 2\n\nPárrafo {{pedido}}', v)
    expect(html).toContain('Hola <strong>Ana &lt;b&gt;Torres&lt;/b&gt;</strong> &lt;script&gt;x&lt;/script&gt;<br />línea 2')
    expect(html).toContain('</p><p style=')
    expect(html).toContain('Párrafo <strong>EC-1</strong>')
    expect(html).not.toContain('<script>')
  })

  it('desde los parámetros de la cola: total y fecha formateados', () => {
    const r = resolveCopyFromParams(
      'order.confirmed',
      { subject: 'Pedido {{pedido}} - {{tienda}}', title: 'Gracias {{cliente}}', body: '{{total}} el {{fecha}}' },
      PARAMS,
      NOW,
    )
    expect(r).toEqual({
      subject: 'Pedido EC-1 - Mi Tienda',
      title: 'Gracias Ana <b>Torres</b>',
      bodyHtml: '<strong>S/ 715.20</strong> el <strong>20/11/2026</strong>',
    })
    // El título se escapa al pintarse en renderEmail.
    const correo = renderEmail('order.confirmed', 'es', PARAMS, 'https://t.pe', r)!
    expect(correo.subject).toBe('Pedido EC-1 - Mi Tienda')
    expect(correo.html).toContain('Gracias Ana &lt;b&gt;Torres&lt;/b&gt;')
    expect(correo.html).toContain('https://t.pe/s/mitienda/account')
  })

  it('un texto inválido o de un aviso no editable no se usa', () => {
    expect(resolveCopyFromParams('order.confirmed', { subject: 'a', title: 'b', body: '{{clave}}' }, PARAMS, NOW)).toBeNull()
    expect(resolveCopyFromParams('auth.recovery', { subject: 'a', title: 'b', body: 'c' }, PARAMS, NOW)).toBeNull()
  })

  it('valores de ejemplo para la vista previa', () => {
    expect(sampleValues('order.confirmed').get('total')).toBe('S/ 1,250.40')
  })
})

describe('despachador', () => {
  const email = (id: string, kind = 'order.confirmed'): ClaimedEmail => ({
    id,
    kind,
    locale: 'es',
    to_address: 'a@b.pe',
    params: PARAMS,
    attempts: 1,
  })

  it('usa el texto de la tienda y lo marca; sin texto, el original', async () => {
    const enviados: Array<{ subject: string; custom?: boolean }> = []
    await dispatchPendingEmails(
      {
        claim: async () => [email('1'), email('2')],
        complete: async () => undefined,
        fail: async () => undefined,
        token: async () => 't',
        send: async (_t, m) => {
          enviados.push({ subject: m.subject, custom: m.custom })
          return { ok: true, reference: null }
        },
        customCopies: async () => new Map([['1', { subject: 'Propio {{pedido}}', title: 'T', body: 'B' }]]),
      },
      { limit: 10, baseUrl: 'https://t.pe', now: NOW },
    )
    expect(enviados).toEqual([
      { subject: 'Propio EC-1', custom: true },
      { subject: 'Recibimos tu pedido EC-1', custom: false },
    ])
  })

  it('si leer los textos falla, sale el original igual', async () => {
    const enviados: string[] = []
    const r = await dispatchPendingEmails(
      {
        claim: async () => [email('1')],
        complete: async () => undefined,
        fail: async () => undefined,
        token: async () => 't',
        send: async (_t, m) => {
          enviados.push(m.subject)
          return { ok: true, reference: null }
        },
        customCopies: async () => {
          throw new Error('caída')
        },
      },
      { limit: 10, baseUrl: 'https://t.pe', now: NOW },
    )
    expect(r.sent).toBe(1)
    expect(enviados).toEqual(['Recibimos tu pedido EC-1'])
  })
})
