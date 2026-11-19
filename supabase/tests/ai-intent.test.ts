// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validarEsquema } from '../functions/_shared/aiCore.ts'
import { respuestaVitrinaSinSalud } from '../functions/_shared/ai.ts'
import {
  ESQUEMA_INTENCION,
  fusionarResultados,
  hayQueReescribir,
  limpiarTermino,
  revisarIntencion,
} from '../functions/_shared/aiIntent.ts'

/**
 * Búsqueda por intención (2026-11-19): el modelo propone QUÉ buscar, el
 * buscador decide qué existe.
 */

describe('cuándo se reescribe', () => {
  it('solo si la búsqueda normal no sirvió', () => {
    expect(hayQueReescribir('empty', 0)).toBe(true)
    expect(hayQueReescribir('fuzzy', 5)).toBe(true)
    expect(hayQueReescribir('fts', 3)).toBe(false)
  })
})

describe('los términos del modelo, revisados', () => {
  it('el esquema acepta una respuesta típica', () => {
    expect(validarEsquema(ESQUEMA_INTENCION, { terminos: ['jarabe tos', 'antitusivo'] }).ok).toBe(true)
  })

  it('minúsculas, sin signos, sin repetir y sin el término ya buscado', () => {
    const r = revisarIntencion({ terminos: ['Jarabe, TOS!', 'jarabe tos', 'tos niño', 'antitusivo'] }, 'tos niño')
    expect(r).toEqual({ ok: true, value: ['jarabe tos', 'antitusivo'] })
  })

  it('fuera frases largas, correos y números largos', () => {
    expect(limpiarTermino('un jarabe muy bueno para la tos')).toBeNull()
    expect(limpiarTermino('ventas@botica.pe')).toBeNull()
    expect(limpiarTermino('987654321')).toBeNull()
    expect(limpiarTermino('ab')).toBeNull()
  })

  it('como mucho cuatro; ninguno útil ⇒ vacía', () => {
    const r = revisarIntencion({ terminos: ['uno x', 'dos x', 'tres x', 'cuatro x', 'cinco x'] }, '')
    expect(r.ok && r.value).toHaveLength(4)
    expect(revisarIntencion({ terminos: [] }, 'x')).toEqual({ ok: false, motivo: 'vacia' })
  })
})

describe('fusión de resultados', () => {
  it('intercala por término y no repite producto', () => {
    const a = [{ product_id: '1' }, { product_id: '2' }, { product_id: '3' }]
    const b = [{ product_id: '2' }, { product_id: '4' }]
    expect(fusionarResultados([a, b], 8).map((x) => x.product_id)).toEqual(['1', '2', '4', '3'])
    expect(fusionarResultados([a, b], 2).map((x) => x.product_id)).toEqual(['1', '2'])
  })
})

describe('candado sanitario de la respuesta pública', () => {
  it('bloquea la respuesta real vista en QAS (efecto, niño y comparar precio)', () => {
    expect(
      respuestaVitrinaSinSalud(
        'Tenemos varias opciones para la tos de tu hijo. Te recomiendo el Codipront Expectorante que ayuda a expulsar flemas, o el Sulfaquilab Balsámico si buscas algo más económico.',
      ),
    ).toBe(false)
  })

  it.each([
    'Este jarabe sirve para la gripe.',
    'Alivia el dolor de cabeza en minutos.',
    'Toma 5 ml cada 8 horas.',
    'Está indicado para adultos.',
    'Es el más barato de la lista.',
  ])('bloquea: %s', (frase) => {
    expect(respuestaVitrinaSinSalud(frase)).toBe(false)
  })

  it.each([
    'Encontré estos jarabes y expectorantes de la tienda; confírmalo con el farmacéutico.',
    'Tenemos protector solar en crema y en spray de dos marcas.',
    'Hay tres presentaciones del Donecil: 5 mg y 10 mg en caja de 30.',
  ])('deja pasar: %s', (frase) => {
    expect(respuestaVitrinaSinSalud(frase)).toBe(true)
  })

  it('el asistente lo aplica a su respuesta', () => {
    const src = readFileSync(join(process.cwd(), 'supabase', 'functions', 'shopping-assistant', 'index.ts'), 'utf8')
    expect(src).toMatch(/respuestaVitrinaSinSalud\(reply\)/)
  })
})

describe('shopping-assistant', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'functions', 'shopping-assistant', 'index.ts'), 'utf8')

  it('reescribe solo tras el intento determinista y vuelve a pasar por el buscador', () => {
    expect(src.indexOf('hayQueReescribir(')).toBeGreaterThan(src.indexOf('let items = await buscar(query)'))
    expect(src).toMatch(/for \(const termino of terminosIntencion\)[\s\S]*?await buscar\(termino\)/)
  })

  it('la reescritura gasta cuota de la tienda como el resto', () => {
    expect(src).toMatch(/async function reescribir[\s\S]*?medidorDeTienda\(/)
  })
})
