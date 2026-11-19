// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { validarEsquema } from '../functions/_shared/aiCore.ts'
import {
  ESQUEMA_PLAN,
  ESQUEMA_RESPUESTA,
  ejecutarHerramienta,
  herramientasMcp,
  historialParaModelo,
  revisarRespuesta,
  validarPlan,
  type PuertosComercio,
} from '../functions/_shared/commerceAgent.ts'
import { atenderTurno, type PuertosTurno } from '../functions/_shared/commerceAgentTurn.ts'

/**
 * Núcleo conversacional (2026-11-19): lista cerrada de herramientas de solo
 * lectura, plan validado, datos de la base y respuesta con candados.
 */

const ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'a'.repeat(64)
const USO = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }

const comercio = (): PuertosComercio => ({
  buscar: vi.fn(async () => [{ product_id: ID, name: 'Jarabe para la tos', brand_name: 'Tusil', in_stock: true, price: '18.50' }]),
  producto: vi.fn(async () => ({ name: 'Jarabe para la tos', in_stock: true })),
  pedido: vi.fn(async () => ({ order_number: 'ORD-1001', status: 'confirmed', payment_status: 'paid', fulfillment_status: 'unfulfilled', grand_total: '99.00' })),
})

describe('plan: lista cerrada, y ante la duda, responder', () => {
  it('los esquemas aceptan respuestas típicas', () => {
    expect(validarEsquema(ESQUEMA_PLAN, { herramienta: 'buscar_productos', consulta: 'jarabe', solo_con_stock: false, product_id: '', numero_pedido: '', token: '' }).ok).toBe(true)
    expect(validarEsquema(ESQUEMA_RESPUESTA, { texto: 'Hola', product_ids: [] }).ok).toBe(true)
  })

  it('una herramienta desconocida o con argumentos inventados cae en responder', () => {
    expect(validarPlan({ herramienta: 'borrar_pedido' }).herramienta).toBe('responder')
    expect(validarPlan({ herramienta: 'ver_producto', product_id: 'no-uuid' }).herramienta).toBe('responder')
    expect(validarPlan({ herramienta: 'estado_pedido', numero_pedido: 'ORD-1', token: 'corto' }).herramienta).toBe('responder')
  })

  it('el pedido exige número y token completos', () => {
    expect(validarPlan({ herramienta: 'estado_pedido', numero_pedido: 'ORD-1001', token: TOKEN })).toEqual({
      herramienta: 'estado_pedido',
      args: { numero_pedido: 'ORD-1001', token: TOKEN },
    })
  })
})

describe('ejecutar: los datos son de la base; el modelo no ve importes', () => {
  it('buscar devuelve los datos tal cual al canal, y al modelo sin precio', async () => {
    const r = await ejecutarHerramienta({ herramienta: 'buscar_productos', args: { consulta: 'tos', solo_con_stock: true } }, comercio())
    expect(r.productosPermitidos).toEqual([ID])
    expect(r.paraModelo).not.toContain('18.50')
    expect(JSON.stringify(r.datos)).toContain('18.50')
  })

  it('el pedido llega al modelo como estados, sin el total', async () => {
    const r = await ejecutarHerramienta({ herramienta: 'estado_pedido', args: { numero_pedido: 'ORD-1001', token: TOKEN } }, comercio())
    expect(r.paraModelo).toContain('confirmed')
    expect(r.paraModelo).not.toContain('99.00')
  })
})

describe('redactar: candados', () => {
  it('sin dinero ni contacto; productos solo de la lista', () => {
    expect(revisarRespuesta({ texto: 'Cuesta S/ 18.50', product_ids: [] }, [ID])).toEqual({ ok: false, motivo: 'bloqueada' })
    expect(revisarRespuesta({ texto: 'Escríbenos a ventas@x.pe', product_ids: [] }, [ID])).toEqual({ ok: false, motivo: 'bloqueada' })
    const ok = revisarRespuesta({ texto: 'Te recomiendo este jarabe.', product_ids: [ID, 'inventado'] }, [ID])
    expect(ok).toEqual({ ok: true, value: { texto: 'Te recomiendo este jarabe.', productIds: [ID] } })
  })

  it('el historial se recorta a los últimos turnos', () => {
    const turnos = Array.from({ length: 10 }, (_, i) => ({ rol: 'cliente' as const, texto: `m${i}` }))
    expect(historialParaModelo(turnos).split('\n')).toHaveLength(6)
  })
})

describe('un turno completo', () => {
  const ia = (): PuertosTurno['ia'] => ({
    hayProveedor: () => true,
    consumir: vi.fn(async () => ({ allowed: true })),
    registrar: vi.fn(async () => 'traza'),
  })

  it('planifica, ejecuta contra la base y redacta con lo permitido', async () => {
    const puertosComercio = comercio()
    const r = await atenderTurno([{ rol: 'cliente', texto: 'algo para la tos' }], {
      comercio: puertosComercio,
      ia: ia(),
      planificar: async () => ({ data: { herramienta: 'buscar_productos', consulta: 'jarabe tos', solo_con_stock: true }, usage: USO, model: 'm', latencyMs: 1, motivo: null }),
      redactar: async () => ({ data: { texto: 'Tenemos este jarabe.', product_ids: [ID] }, usage: USO, model: 'm', latencyMs: 1, motivo: null }),
    })
    expect(puertosComercio.buscar).toHaveBeenCalledWith('jarabe tos', true)
    expect(r.respuesta).toEqual({ texto: 'Tenemos este jarabe.', productIds: [ID] })
  })

  it('sin proveedor: no llama a la base con nada inventado y no rompe', async () => {
    const puertosComercio = comercio()
    const r = await atenderTurno([{ rol: 'cliente', texto: 'hola' }], {
      comercio: puertosComercio,
      ia: { ...ia(), hayProveedor: () => false },
      planificar: vi.fn(),
      redactar: vi.fn(),
    })
    expect(r.plan.herramienta).toBe('responder')
    expect(r.respuesta).toBeNull()
    expect(puertosComercio.buscar).not.toHaveBeenCalled()
  })
})

describe('MCP', () => {
  it('las mismas tres herramientas, todas de solo lectura', () => {
    const tools = herramientasMcp()
    expect(tools.map((t) => t.name)).toEqual(['buscar_productos', 'ver_producto', 'estado_pedido'])
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true)
  })
})
