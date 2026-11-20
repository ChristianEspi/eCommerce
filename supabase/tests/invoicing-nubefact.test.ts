// @vitest-environment node
/**
 * Nubefact (fase 2), sin red: la petición que se arma, cómo se lee cada
 * respuesta del manual v3.1 y qué hace el trabajador en cada caso.
 */
import { describe, expect, it } from 'vitest'
import type { InvoiceIssuePayloadV1 as DomainPayload } from '../../src/domain/ports/invoicing'
import {
  authHeader,
  buildConsultarComprobante,
  buildGenerarComprobante,
  fechaNubefact,
  parseCredentials,
  parseNubefactResponse,
  type InvoiceIssuePayloadV1,
  type NubefactCredentials,
  type ProviderResult,
} from '../functions/_shared/invoicing/nubefact.ts'
import { runInvoicingPass, type ClaimedIssue, type InvoicingPorts } from '../functions/_shared/invoicing/worker.ts'

// El contrato del dominio y el que lee el trabajador son el mismo (en tipos).
const _compatible: (p: DomainPayload) => InvoiceIssuePayloadV1 = (p) => p
void _compatible

const NOW = new Date('2026-11-20T15:00:00Z')
const CREDS: NubefactCredentials = {
  ruta: 'https://api.nubefact.com/api/v1/03989d1a-6c8c-4b71-b1cd-7d37001deaa0',
  token: 'd0a80b88cde446d092025465bdb4673e103a0d881ca6479ebbab10664dbc5677',
}

function boleta(over: Partial<InvoiceIssuePayloadV1> = {}): InvoiceIssuePayloadV1 {
  return {
    schema_version: 2,
    operation: 'invoice.issue',
    idempotency_key: 'invoice.issue:inv-1',
    store_id: 's',
    invoice_id: 'inv-1',
    order_id: 'o',
    document_type: 'receipt',
    series: 'B001',
    number: '00000123',
    issued_at: '2026-11-20T15:00:00Z',
    currency: 'PEN',
    customer: { name: 'Ana Torres', tax_id: '74705043', doc_type: 'dni', address: null },
    totals: { net: '122.88', tax: '22.12', gross: '145.00' },
    lines: [
      {
        position: 0, description: 'Jabón', quantity: '3', unit_price: '33.33', net_amount: '100.00',
        tax_rate: '0.1800', tax_amount: '18.00', tax_affectation: 'gravado', line_kind: 'item',
      },
      {
        position: 1, description: 'Envío', quantity: '1', unit_price: '22.88', net_amount: '22.88',
        tax_rate: '0.1800', tax_amount: '4.12', tax_affectation: 'gravado', line_kind: 'shipping',
      },
    ],
    ...over,
  }
}

describe('petición generar_comprobante', () => {
  it('boleta con DNI: códigos del manual, número entero, fecha de Lima y totales por afectación', () => {
    const r = buildGenerarComprobante(boleta(), NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body).toMatchObject({
      operacion: 'generar_comprobante',
      tipo_de_comprobante: 2,
      serie: 'B001',
      numero: 123,
      sunat_transaction: 1,
      cliente_tipo_de_documento: '1',
      cliente_numero_de_documento: '74705043',
      cliente_denominacion: 'Ana Torres',
      fecha_de_emision: '20-11-2026',
      moneda: 1,
      porcentaje_de_igv: 18,
      total_gravada: 122.88,
      total_exonerada: '',
      total_igv: 22.12,
      total: 145,
      enviar_automaticamente_a_la_sunat: true,
      enviar_automaticamente_al_cliente: false,
    })
    const items = r.body.items as Record<string, unknown>[]
    expect(items[0]).toMatchObject({
      unidad_de_medida: 'NIU', cantidad: 3, valor_unitario: 33.3333333333, precio_unitario: 39.3333333333,
      subtotal: 100, tipo_de_igv: 1, igv: 18, total: 118, anticipo_regularizacion: false,
    })
    expect(items[1]).toMatchObject({ unidad_de_medida: 'ZZ', tipo_de_igv: 1, igv: 4.12, total: 27 })
  })

  it('factura con RUC, exonerado/inafecto y dólares', () => {
    const r = buildGenerarComprobante(
      boleta({
        document_type: 'invoice',
        series: 'F001',
        currency: 'USD',
        customer: { name: 'Cliente SAC', tax_id: '20123456789', doc_type: 'ruc', address: 'Av. Fiscal 9' },
        totals: { net: '30.00', tax: '0.00', gross: '30.00' },
        lines: [
          { position: 0, description: 'Libro', quantity: '1', unit_price: '10', net_amount: '10.00', tax_rate: '0', tax_amount: '0.00', tax_affectation: 'exonerado', line_kind: 'item' },
          { position: 1, description: 'Servicio', quantity: '1', unit_price: '20', net_amount: '20.00', tax_rate: '0', tax_amount: '0.00', tax_affectation: 'inafecto', line_kind: 'item' },
        ],
      }),
      NOW,
    )
    if (!r.ok) throw new Error('no armó')
    expect(r.body).toMatchObject({
      tipo_de_comprobante: 1, moneda: 2, cliente_tipo_de_documento: '6', cliente_direccion: 'Av. Fiscal 9',
      total_gravada: '', total_exonerada: 10, total_inafecta: 20, total_igv: 0, total: 30,
    })
    expect((r.body.items as Record<string, unknown>[]).map((i) => i.tipo_de_igv)).toEqual([8, 9])
  })

  it('sin documento va como «varios»; CE y pasaporte con su código', () => {
    const sin = buildGenerarComprobante(boleta({ customer: { name: 'Cliente', tax_id: null, doc_type: null, address: null } }), NOW)
    if (!sin.ok) throw new Error()
    expect(sin.body).toMatchObject({ cliente_tipo_de_documento: '-', cliente_numero_de_documento: '-' })
    const ce = buildGenerarComprobante(boleta({ customer: { name: 'X', tax_id: '001234567', doc_type: 'ce', address: null } }), NOW)
    const pas = buildGenerarComprobante(boleta({ customer: { name: 'X', tax_id: 'AB12345', doc_type: 'passport', address: null } }), NOW)
    if (!ce.ok || !pas.ok) throw new Error()
    expect([ce.body.cliente_tipo_de_documento, pas.body.cliente_tipo_de_documento]).toEqual(['4', '7'])
  })

  it('nota de crédito (v3): tipo 3, documento que modifica, tipo de nota y motivo', () => {
    const r = buildGenerarComprobante(
      boleta({
        schema_version: 3,
        document_type: 'credit_note',
        series: 'BC01',
        number: '00000004',
        reference: { document_type: 'receipt', series: 'B001', number: '00000123' },
        credit_note: { type: 1, reason: 'Pedido EC-1 cancelado' },
      }),
      NOW,
    )
    if (!r.ok) throw new Error('no armó')
    expect(r.body).toMatchObject({
      tipo_de_comprobante: 3,
      serie: 'BC01',
      numero: 4,
      documento_que_se_modifica_tipo: 2,
      documento_que_se_modifica_serie: 'B001',
      documento_que_se_modifica_numero: 123,
      tipo_de_nota_de_credito: 1,
      observaciones: 'Pedido EC-1 cancelado',
      total: 145,
    })
    expect(buildGenerarComprobante(boleta({ schema_version: 3, document_type: 'credit_note' }), NOW).ok).toBe(false)
    expect(buildConsultarComprobante('credit_note', 'FC01', '00000002')).toMatchObject({ tipo_de_comprobante: 3, numero: 2 })
  })

  it('versión vieja del mensaje o moneda desconocida: no se arma', () => {
    expect(buildGenerarComprobante(boleta({ schema_version: 1 }), NOW).ok).toBe(false)
    expect(buildGenerarComprobante(boleta({ currency: 'BOB' }), NOW).ok).toBe(false)
    expect(buildGenerarComprobante(boleta({ number: 'x' }), NOW).ok).toBe(false)
  })

  it('consulta, fecha de Lima de madrugada, cabecera y credenciales', () => {
    expect(buildConsultarComprobante('invoice', 'F001', '00000007')).toEqual({
      operacion: 'consultar_comprobante', tipo_de_comprobante: 1, serie: 'F001', numero: 7,
    })
    expect(fechaNubefact(new Date('2026-11-21T03:00:00Z'))).toBe('20-11-2026')
    expect(authHeader('abc')).toBe('Token token="abc"')
    expect(parseCredentials(CREDS)).toEqual(CREDS)
    expect(parseCredentials({ ruta: 'http://api.nubefact.com/api/v1/x', token: CREDS.token })).toBeNull()
    expect(parseCredentials({ ruta: 'https://evil.com/api/v1/03989d1a-6c8c', token: CREDS.token })).toBeNull()
  })
})

describe('respuesta', () => {
  const ok = {
    tipo_de_comprobante: 1, serie: 'F001', numero: 7,
    enlace: 'https://www.nubefact.com/cpe/abc', aceptada_por_sunat: true,
    sunat_description: 'La Factura numero F001-7, ha sido aceptada', sunat_note: null, sunat_responsecode: '0',
    sunat_soap_error: '', cadena_para_codigo_qr: '20600695771 | 01 | F001 | 7 | 4.12 | 27.00 | 20/11/2026 | 6 | 20123456789 | h=',
    codigo_hash: 'h=', enlace_del_pdf: 'https://www.nubefact.com/cpe/abc.pdf', enlace_del_xml: 'https://www.nubefact.com/cpe/abc.xml',
    enlace_del_cdr: 'https://www.nubefact.com/cpe/abc.cdr',
  }

  it('aceptada por SUNAT: estado, enlaces, QR y hash', () => {
    expect(parseNubefactResponse(200, ok)).toEqual({
      kind: 'result',
      result: {
        status: 'accepted', number: '7', document_ref: ok.enlace, pdf_url: ok.enlace_del_pdf, xml_url: ok.enlace_del_xml,
        cdr_url: ok.enlace_del_cdr, sunat_code: '0', sunat_description: ok.sunat_description,
        qr_string: ok.cadena_para_codigo_qr, hash_code: 'h=', detail: ok.sunat_description,
      },
    })
  })

  it('boleta recibida sin confirmar: «issued»; rechazo de SUNAT 2xxx: «rejected»', () => {
    const boletaR = parseNubefactResponse(200, { ...ok, aceptada_por_sunat: false, sunat_responsecode: '', enlace_del_pdf: undefined })
    expect(boletaR).toMatchObject({ kind: 'result', result: { status: 'issued', pdf_url: `${ok.enlace}.pdf` } })
    expect(parseNubefactResponse(200, { ...ok, aceptada_por_sunat: false, sunat_responsecode: '2800' })).toMatchObject({
      result: { status: 'rejected' },
    })
  })

  it('errores del manual: 23 ya existe, 10 credenciales, 20 datos, 40 y 5xx reintento', () => {
    expect(parseNubefactResponse(400, { errors: 'Este documento ya existe en NubeFacT', codigo: 23 })).toEqual({ kind: 'exists' })
    expect(parseNubefactResponse(401, { errors: 'token incorrecto', codigo: 10 })).toMatchObject({
      kind: 'error', code: 'NUBEFACT_10', retryable: true, stopTenant: true,
    })
    expect(parseNubefactResponse(400, { errors: 'El archivo enviado no cumple con el formato establecido', codigo: 20 })).toMatchObject({
      kind: 'error', code: 'NUBEFACT_20', retryable: false,
    })
    expect(parseNubefactResponse(500, { errors: 'Error interno', codigo: 40 })).toMatchObject({ retryable: true, stopTenant: false })
    expect(parseNubefactResponse(502, null)).toMatchObject({ code: 'NUBEFACT_HTTP_502', retryable: true })
  })
})

describe('trabajador', () => {
  type Llamada = { op: string; args: unknown[] }

  function puertos(over: Partial<InvoicingPorts> & { mensajes?: ClaimedIssue[]; respuestas?: Array<{ status: number; body: unknown }> }) {
    const llamadas: Llamada[] = []
    const respuestas = [...(over.respuestas ?? [])]
    const anota = (op: string) => async (...args: unknown[]) => {
      llamadas.push({ op, args })
    }
    const ports: InvoicingPorts = {
      now: () => NOW,
      reclaimStale: async () => undefined,
      claim: async () => over.mensajes ?? [],
      credentials: async () => CREDS,
      post: async (_c, body) => {
        llamadas.push({ op: 'post', args: [body] })
        const r = respuestas.shift()
        if (!r) throw new Error('sin red')
        return r
      },
      record: anota('record') as InvoicingPorts['record'],
      succeed: anota('succeed') as InvoicingPorts['succeed'],
      fail: anota('fail') as InvoicingPorts['fail'],
      giveUp: anota('giveUp') as InvoicingPorts['giveUp'],
      awaiting: async () => [],
      ...over,
    }
    return { ports, llamadas }
  }
  const msg = (id: string, company = 'c1', payload: InvoiceIssuePayloadV1 = boleta()): ClaimedIssue => ({
    id, organization_id: 'o1', company_id: company, payload: payload as unknown as Record<string, unknown>,
  })
  const okBody = { numero: 123, enlace: 'https://www.nubefact.com/cpe/x', aceptada_por_sunat: false, sunat_responsecode: '' }

  it('emite, registra en el comprobante y cierra el mensaje', async () => {
    const { ports, llamadas } = puertos({ mensajes: [msg('m1')], respuestas: [{ status: 200, body: okBody }] })
    const r = await runInvoicingPass(ports)
    expect(r).toMatchObject({ claimed: 1, issued: 1, failed: 0, gaveUp: 0 })
    const record = llamadas.find((l) => l.op === 'record')
    expect(record?.args[0]).toBe('inv-1')
    expect((record?.args[1] as ProviderResult).status).toBe('issued')
    expect(llamadas.find((l) => l.op === 'succeed')?.args[0]).toBe('m1')
  })

  it('«ya existe» consulta y registra lo que Nubefact tiene: nunca emite dos veces', async () => {
    const { ports, llamadas } = puertos({
      mensajes: [msg('m1')],
      respuestas: [
        { status: 400, body: { errors: 'Este documento ya existe en NubeFacT', codigo: 23 } },
        { status: 200, body: { ...okBody, aceptada_por_sunat: true } },
      ],
    })
    await runInvoicingPass(ports)
    const posts = llamadas.filter((l) => l.op === 'post').map((l) => (l.args[0] as Record<string, unknown>).operacion)
    expect(posts).toEqual(['generar_comprobante', 'consultar_comprobante'])
    expect((llamadas.find((l) => l.op === 'record')?.args[1] as ProviderResult).status).toBe('accepted')
  })

  it('token malo: falla ese y NO llama por los demás de la misma sociedad', async () => {
    const { ports, llamadas } = puertos({
      mensajes: [msg('m1'), msg('m2'), msg('m3', 'c2')],
      respuestas: [
        { status: 401, body: { errors: 'token incorrecto', codigo: 10 } },
        { status: 200, body: okBody },
      ],
    })
    const r = await runInvoicingPass(ports)
    expect(r).toMatchObject({ failed: 2, issued: 1 })
    expect(llamadas.filter((l) => l.op === 'post')).toHaveLength(2)
    expect(llamadas.filter((l) => l.op === 'fail').map((l) => l.args[0])).toEqual(['m1', 'm2'])
  })

  it('rechazo por datos: se cierra sin reintento; sin credenciales: espera', async () => {
    const datos = puertos({ mensajes: [msg('m1')], respuestas: [{ status: 400, body: { errors: 'formato', codigo: 20 } }] })
    expect(await runInvoicingPass(datos.ports)).toMatchObject({ gaveUp: 1 })
    const sin = puertos({ mensajes: [msg('m1')], credentials: async () => null })
    expect(await runInvoicingPass(sin.ports)).toMatchObject({ failed: 1 })
    expect(sin.llamadas.find((l) => l.op === 'fail')?.args[1]).toBe('NUBEFACT_SIN_CREDENCIALES')
    expect(sin.llamadas.some((l) => l.op === 'post')).toBe(false)
  })

  it('sin red: reintento, no rechazo', async () => {
    const { ports, llamadas } = puertos({ mensajes: [msg('m1')], respuestas: [] })
    expect(await runInvoicingPass(ports)).toMatchObject({ failed: 1, gaveUp: 0 })
    expect(llamadas.find((l) => l.op === 'fail')?.args[1]).toBe('sin respuesta del emisor')
  })

  it('confirma lo pendiente de SUNAT', async () => {
    const { ports, llamadas } = puertos({
      awaiting: async () => [
        { invoice_id: 'inv-9', organization_id: 'o1', company_id: 'c1', document_type: 'receipt', series: 'B001', number: '00000009' },
      ],
      respuestas: [{ status: 200, body: { ...okBody, numero: 9, aceptada_por_sunat: true } }],
    })
    expect(await runInvoicingPass(ports)).toMatchObject({ checked: 1, confirmed: 1 })
    expect((llamadas.find((l) => l.op === 'post')?.args[0] as Record<string, unknown>).operacion).toBe('consultar_comprobante')
  })
})
