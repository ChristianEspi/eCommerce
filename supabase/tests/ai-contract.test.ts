// @vitest-environment node
/**
 * El contrato de las llamadas a IA.
 *
 * Se prueba sin red y sin clave porque lo que hay que vigilar de una llamada a
 * un modelo no es cómo viaja, es qué se le deja devolver. Por eso esa parte vive
 * en `_shared` —TypeScript puro— y el transporte en `_runtime`.
 */
import { describe, expect, it } from 'vitest'
import {
  AI_DEFAULT_MODEL,
  AI_USAGE_CERO,
  ESQUEMA_SUGERENCIA,
  filtrarPermitidos,
  listarCandidatos,
  normalizarUso,
  recortarRespuesta,
} from '../functions/_shared/ai.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('el identificador del modelo', () => {
  it('no lleva sufijo de fecha', () => {
    // `claude-haiku-4-5-20251001` —lo que había escrito aquí antes, y lo que
    // sigue escrito en cinco funciones de GMAO— no es un identificador válido.
    expect(AI_DEFAULT_MODEL).toBe('claude-haiku-4-5')
    expect(AI_DEFAULT_MODEL).not.toMatch(/-\d{8}$/)
  })
})

describe('la lista cerrada', () => {
  const permitidos = new Set([A, B])

  it('descarta lo que el modelo se inventó', () => {
    // La barrera que impide recomendar un producto que la tienda no vende.
    expect(filtrarPermitidos([A, C, B], permitidos)).toEqual([A, B])
  })

  it('sobrevive a que `ids` no sea una lista', () => {
    // Las salidas estructuradas hacen esto improbable, no imposible: un fallo
    // del proveedor puede devolver otra forma, y aquí no puede explotar.
    expect(filtrarPermitidos(null, permitidos)).toEqual([])
    expect(filtrarPermitidos('nope', permitidos)).toEqual([])
    expect(filtrarPermitidos([1, 2, 3], permitidos)).toEqual([])
  })

  it('no repite un identificador que el modelo dijo dos veces', () => {
    expect(filtrarPermitidos([A, A, B], permitidos)).toEqual([A, B])
  })

  it('respeta el ORDEN del modelo', () => {
    // Es su respuesta a «qué encaja mejor». Reordenarla por el orden del
    // catálogo tira justo lo único que aportó.
    expect(filtrarPermitidos([B, A], permitidos)).toEqual([B, A])
  })

  it('corta en el máximo pedido', () => {
    const muchos = new Set([A, B, C])
    expect(filtrarPermitidos([A, B, C], muchos, 2)).toEqual([A, B])
  })
})

describe('lo que se suma al contador', () => {
  it('lee el usage del proveedor', () => {
    expect(
      normalizarUso({ input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900 }),
    ).toEqual({ inputTokens: 120, outputTokens: 40, cacheReadTokens: 900 })
  })

  it('nunca deja pasar un NaN al plano de cobro', () => {
    // Este objeto acaba sumándose a un contador de facturación. Un NaN colado
    // ahí envenena el total del mes sin que nadie lo note hasta que el número
    // deja de tener sentido.
    expect(normalizarUso({ input_tokens: 'x', output_tokens: null })).toEqual(AI_USAGE_CERO)
    expect(normalizarUso(undefined)).toEqual(AI_USAGE_CERO)
    expect(normalizarUso({ input_tokens: -5 })).toEqual(AI_USAGE_CERO)
  })

  it('redondea hacia abajo en vez de guardar decimales', () => {
    expect(normalizarUso({ input_tokens: 10.9 }).inputTokens).toBe(10)
  })
})

describe('el texto que llega a la pantalla', () => {
  it('se recorta al máximo', () => {
    expect(recortarRespuesta('x'.repeat(700))).toHaveLength(600)
  })

  it('lo que no es texto sale vacío, no «undefined»', () => {
    expect(recortarRespuesta(null)).toBe('')
    expect(recortarRespuesta({ reply: 'hola' })).toBe('')
  })
})

describe('lo que ve el modelo', () => {
  it('una línea por candidato, con su identificador', () => {
    const lista = listarCandidatos([
      { product_id: A, name: 'Champú', brand_name: 'Marca', price: '19.90', currency: 'PEN', in_stock: true },
      { product_id: B, name: 'Jabón', in_stock: false },
    ])

    expect(lista.split('\n')).toHaveLength(2)
    expect(lista).toContain(`id=${A}`)
    expect(lista).toContain('PEN 19.90')
    expect(lista).toContain('sin stock')
  })

  it('el esquema cierra la forma de la respuesta', () => {
    // `additionalProperties: false` es lo que sustituye al apaño de recortar
    // entre la primera llave y la última.
    expect(ESQUEMA_SUGERENCIA.additionalProperties).toBe(false)
    expect(ESQUEMA_SUGERENCIA.required).toEqual(['reply', 'ids'])
  })
})
