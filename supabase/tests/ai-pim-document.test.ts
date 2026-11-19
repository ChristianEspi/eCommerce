// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validarEsquema } from '../functions/_shared/aiCore.ts'
import { construirContexto, datosParaPim } from '../functions/_shared/aiPim.ts'
import { ESQUEMA_TRANSCRIPCION, revisarTranscripcion } from '../functions/_shared/aiPimDocument.ts'

/**
 * Ficha desde el documento del proveedor (2026-11-19): la transcripción es una
 * FUENTE más del asistente de ficha, con sus mismos candados.
 */

const FICHA = [
  'Nombre: Donecil 10 mg',
  'Laboratorio: ABL Pharma',
  'Presentación: caja x 30 comprimidos recubiertos',
  'Precio sugerido: S/ 79.00',
  'Indicado para el tratamiento de la demencia',
  'Contacto: ventas@abl.pe · +51 987 654 321 · www.abl.pe',
  'Registro sanitario: EE-01234',
].join('\n')

describe('transcripción revisada', () => {
  it('el esquema acepta una respuesta típica', () => {
    expect(validarEsquema(ESQUEMA_TRANSCRIPCION, { es_ficha: true, texto: FICHA }).ok).toBe(true)
  })

  it('fuera precios, lenguaje clínico, correos, teléfonos y webs; quedan los datos', () => {
    const r = revisarTranscripcion({ es_ficha: true, texto: FICHA })
    if (!r.ok) throw new Error('debería revisar')
    expect(r.value).toContain('Presentación: caja x 30 comprimidos recubiertos')
    expect(r.value).toContain('Registro sanitario: EE-01234')
    expect(r.value).not.toMatch(/S\/|79/)
    expect(r.value).not.toMatch(/demencia|Indicado/)
    expect(r.value).not.toMatch(/ventas@|987|www\./)
  })

  it('no es una ficha ⇒ vacía', () => {
    expect(revisarTranscripcion({ es_ficha: false, texto: FICHA })).toEqual({ ok: false, motivo: 'vacia' })
    expect(revisarTranscripcion({ es_ficha: true, texto: 'ok' })).toEqual({ ok: false, motivo: 'vacia' })
  })
})

describe('el documento como fuente del asistente de ficha', () => {
  const filas = {
    producto: { id: 'p1', sku: 'DON-10', name: 'Donecil', description: null, kind: 'simple' },
    categoriaActualId: null,
    categorias: [],
    atributos: [],
    opciones: [],
    valores: [],
    similares: [],
  }

  it('sus números pasan a ser «dichos por los datos»', () => {
    const sin = construirContexto(filas)
    const con = construirContexto({ ...filas, documento: 'Presentación: caja x 30 comprimidos' })
    expect(sin.numerosFuente.has('30')).toBe(false)
    expect(con.numerosFuente.has('30')).toBe(true)
    expect(con.documento).toContain('caja x 30')
  })

  it('viaja delimitado como dato al modelo', () => {
    const con = construirContexto({ ...filas, documento: 'Laboratorio: ABL Pharma' })
    expect(datosParaPim(con, ['description'], 'es')).toContain('ficha_tecnica_del_proveedor')
    expect(datosParaPim(construirContexto(filas), ['description'], 'es')).not.toContain('ficha_tecnica_del_proveedor')
  })
})

describe('catalog-copy · extract', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'functions', 'catalog-copy', 'index.ts'), 'utf8')

  it('valida el archivo y comprueba el producto ANTES de transcribir', () => {
    const extract = src.slice(src.indexOf("if (mode === 'extract')"))
    expect(extract.indexOf('validarAdjunto(')).toBeLessThan(extract.indexOf('ejecutarIA<'))
    expect(extract.indexOf("from('admin_product_masters')")).toBeLessThan(extract.indexOf('ejecutarIA<'))
  })

  it('solo `extract` admite archivo', () => {
    expect(src).toMatch(/mode !== 'extract' && body\.file !== undefined/)
  })
})
