// @vitest-environment node
/**
 * Envío por EBIM MailHub, sin red y sin token real.
 *
 * Lo que se fija: el pedido recibido va por la plantilla publicada con sus 5
 * variables; si falta una, sale como HTML en vez de rebotar en MailHub; cada
 * correo lleva su idempotencyKey; un token malo para la pasada sin quemar
 * intentos; y nada se envía a dominios de demo.
 */
import { describe, expect, it } from 'vitest'
import {
  fechaLima,
  formatTotal,
  isTestAddress,
  mailhubConfigFromEnv,
  mailhubTemplateFor,
  referenceFor,
  sendMailhubMail,
  type MailhubConfig,
  type MailhubMessage,
} from '../functions/_shared/notifications/mailhub.ts'

const BASE = 'https://tienda.ebim.pe'
const CONFIG: MailhubConfig = { url: 'https://hub.example.co/functions/v1/mailhub-send', token: 'mh_qas_x' }
const NOW = new Date('2026-11-20T15:00:00Z')

const PARAMS = {
  order_number: 'EC-20261120-00001',
  grand_total: '1250.4',
  currency: 'PEN',
  store_name: 'Quimica Suiza',
  store_slug: 'miquimica',
}

const MENSAJE: MailhubMessage = {
  to: 'comprador@empresa.pe',
  subject: 'Recibimos tu pedido',
  html: '<p>hola</p>',
  emailId: '11111111-1111-4111-8111-111111111111',
  referenceId: 'EC-20261120-00001',
  template: null,
}

function fetchQueResponde(status: number, body: unknown) {
  const llamadas: Array<{ url: string; init: RequestInit }> = []
  const fn = async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init: init ?? {} })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn, llamadas }
}

describe('configuración', () => {
  it('dice qué falta y exige https', () => {
    expect(mailhubConfigFromEnv(() => undefined)).toEqual({
      config: null,
      missing: ['EBIM_MAILHUB_URL', 'EBIM_MAILHUB_TOKEN'],
    })
    const env: Record<string, string> = { EBIM_MAILHUB_URL: 'http://x', EBIM_MAILHUB_TOKEN: 't' }
    expect(mailhubConfigFromEnv((k) => env[k]).config).toBeNull()
    env.EBIM_MAILHUB_URL = 'https://x/functions/v1/mailhub-send'
    expect(mailhubConfigFromEnv((k) => env[k]).config).toEqual({ url: env.EBIM_MAILHUB_URL, token: 't' })
  })
})

describe('plantilla pedido-recibido', () => {
  it('order.confirmed en español va por plantilla con las 5 variables ya formateadas', () => {
    expect(mailhubTemplateFor('order.confirmed', 'es', PARAMS, BASE, NOW)).toEqual({
      templateKey: 'pedido-recibido',
      variables: {
        pedido: 'EC-20261120-00001',
        fecha: '20/11/2026',
        total: 'S/ 1,250.40',
        tienda: { nombre: 'Quimica Suiza' },
        enlace: 'https://tienda.ebim.pe/s/miquimica/account?pedido=EC-20261120-00001#pedidos',
      },
    })
  })

  it('si falta un dato obligatorio, o es inglés, o es otro aviso: HTML propio', () => {
    expect(mailhubTemplateFor('order.confirmed', 'es', { ...PARAMS, store_name: '' }, BASE, NOW)).toBeNull()
    expect(mailhubTemplateFor('order.confirmed', 'es', { ...PARAMS, grand_total: 'x' }, BASE, NOW)).toBeNull()
    expect(mailhubTemplateFor('order.confirmed', 'en', PARAMS, BASE, NOW)).toBeNull()
    expect(mailhubTemplateFor('order.shipped', 'es', PARAMS, BASE, NOW)).toBeNull()
  })

  it('formatos de total, fecha de Lima y referencia', () => {
    expect(formatTotal('715.2', 'PEN')).toBe('S/ 715.20')
    expect(formatTotal('10', 'usd')).toBe('US$ 10.00')
    expect(formatTotal('', 'PEN')).toBeNull()
    // 02:00 UTC del 21 todavía es el 20 en Lima.
    expect(fechaLima(new Date('2026-11-21T02:00:00Z'))).toBe('20/11/2026')
    expect(referenceFor('id-1', PARAMS)).toBe('EC-20261120-00001')
    expect(referenceFor('id-1', {})).toBe('id-1')
  })
})

describe('envío', () => {
  it('con plantilla: sin asunto, con templateKey, token en cabecera e idempotencia por id', async () => {
    const { fn, llamadas } = fetchQueResponde(202, { emailId: 'mh-1', status: 'queued' })
    const template = mailhubTemplateFor('order.confirmed', 'es', PARAMS, BASE, NOW)
    const r = await sendMailhubMail(CONFIG, { ...MENSAJE, template }, fn)
    expect(r).toEqual({ ok: true, reference: 'mh-1' })
    const llamada = llamadas[0]!
    expect(llamada.url).toBe(CONFIG.url)
    expect((llamada.init.headers as Record<string, string>)['X-MailHub-Key']).toBe('mh_qas_x')
    const body = JSON.parse(String(llamada.init.body))
    expect(body.subject).toBeUndefined()
    expect(body.from).toBeUndefined()
    expect(body.content).toMatchObject({ type: 'template', templateKey: 'pedido-recibido' })
    expect(body.idempotencyKey).toBe(`ecommerce-${MENSAJE.emailId}`)
    expect(body.to).toEqual(['comprador@empresa.pe'])
  })

  it('sin plantilla: HTML con asunto', async () => {
    const { fn, llamadas } = fetchQueResponde(202, { emailId: 'mh-2' })
    await sendMailhubMail(CONFIG, MENSAJE, fn)
    const body = JSON.parse(String(llamadas[0]!.init.body))
    expect(body).toMatchObject({ subject: 'Recibimos tu pedido', content: { type: 'html', html: '<p>hola</p>' } })
  })

  it('token o plantilla mal: para la pasada sin gastar el intento', async () => {
    expect(await sendMailhubMail(CONFIG, MENSAJE, fetchQueResponde(401, { code: 'invalid_token' }).fn)).toEqual({
      ok: false,
      code: 'MAILHUB_INVALID_TOKEN',
      retryable: true,
      stopBatch: true,
    })
    const sinPlantilla = await sendMailhubMail(CONFIG, MENSAJE, fetchQueResponde(404, { error: { code: 'template_not_found' } }).fn)
    expect(sinPlantilla).toMatchObject({ code: 'MAILHUB_TEMPLATE_NOT_FOUND', stopBatch: true })
  })

  it('5xx se reintenta; una variable que falta no', async () => {
    expect(await sendMailhubMail(CONFIG, MENSAJE, fetchQueResponde(503, {}).fn)).toMatchObject({
      retryable: true,
      stopBatch: false,
    })
    expect(
      await sendMailhubMail(CONFIG, MENSAJE, fetchQueResponde(422, { code: 'template_variables_missing' }).fn),
    ).toMatchObject({ code: 'MAILHUB_TEMPLATE_VARIABLES_MISSING', retryable: false })
  })

  it('a dominios de demo no se envía nada', async () => {
    expect(isTestAddress('prueba.b2b@miquimica.demo')).toBe(true)
    expect(isTestAddress('ana@example.com')).toBe(true)
    expect(isTestAddress('ana@empresa.pe')).toBe(false)
    const { fn, llamadas } = fetchQueResponde(202, {})
    const r = await sendMailhubMail(CONFIG, { ...MENSAJE, to: 'owner@ferromax.demo' }, fn)
    expect(r).toEqual({ ok: false, code: 'DESTINO_DE_PRUEBA', retryable: false, stopBatch: false })
    expect(llamadas).toHaveLength(0)
  })
})
