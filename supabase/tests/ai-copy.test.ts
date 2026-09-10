// @vitest-environment node
/**
 * El segundo candado de la redacción de fichas.
 *
 * El primero es el sistema, que se lo prohíbe al modelo. Este es la revisión de
 * lo que devuelve, y existe porque **un prompt es una petición, no una
 * garantía**. De las 281 fichas vacías del catálogo, 181 son medicamentos: un
 * borrador que se cuele diciendo para qué sirve no es una errata, es una
 * afirmación sanitaria publicada en una botica.
 *
 * Se prueba sin red y sin clave a propósito: lo que hay que vigilar de esta
 * funcionalidad no es cómo viaja la llamada, es qué se le deja escribir.
 */
import { describe, expect, it } from 'vitest'
import {
  FICHA_MAX_CARACTERES,
  SISTEMA_FICHA,
  datosDeProducto,
  revisarBorrador,
  tieneAfirmacionClinica,
} from '../functions/_shared/aiCopy.ts'

describe('lo que se le cuenta al modelo', () => {
  it('nombre, marca, categoria y SKU. Ni precio ni stock', () => {
    const texto = datosDeProducto({
      name: 'Amoxicilina 500 mg',
      brandName: 'Quilab',
      categoryName: 'Antiinfecciosos',
      sku: 'QS-1',
    })

    expect(texto).toContain('Amoxicilina 500 mg')
    expect(texto).toContain('Quilab')
    expect(texto).toContain('Antiinfecciosos')
    // El modelo no emite dinero (regla 2 de `ai.ts`), así que ni lo ve.
    expect(texto).not.toMatch(/precio|stock|S\/|\d+\.\d{2}/i)
  })

  it('lo que falta se dice, no se omite: el hueco callado se rellena inventando', () => {
    const texto = datosDeProducto({
      name: 'Jarabe X',
      brandName: null,
      categoryName: null,
      sku: 'QS-2',
    })
    expect(texto).toContain('(sin marca)')
    expect(texto).toContain('(sin categoria)')
  })
})

describe('el sistema deja escrito lo que no se puede decir', () => {
  it('prohíbe la indicación, la dosis y la promesa de eficacia', () => {
    for (const prohibido of ['indicaciones', 'dosis', 'eficacia', 'para que sirve']) {
      expect(SISTEMA_FICHA.toLowerCase()).toContain(prohibido)
    }
  })

  it('y ofrece una salida honesta: mejor vacía que falsa', () => {
    expect(SISTEMA_FICHA).toMatch(/descripcion vacia/i)
  })
})

describe('la revisión del borrador', () => {
  it('deja pasar una descripción de presentación', () => {
    const resultado = revisarBorrador(
      'Caja de 21 capsulas de 500 mg del laboratorio Quilab, de la linea de antiinfecciosos.',
    )
    expect(resultado).toEqual({
      ok: true,
      description:
        'Caja de 21 capsulas de 500 mg del laboratorio Quilab, de la linea de antiinfecciosos.',
    })
  })

  it('normaliza los espacios: un borrador con saltos no es dos borradores', () => {
    const resultado = revisarBorrador('  Frasco   de 120 ml.\n\nLaboratorio Adium.  ')
    expect(resultado).toEqual({ ok: true, description: 'Frasco de 120 ml. Laboratorio Adium.' })
  })

  it('corta a la medida en vez de devolver un prospecto', () => {
    const largo = `Frasco de 120 ml. ${'Presentacion en caja. '.repeat(40)}`
    const resultado = revisarBorrador(largo)
    if (!resultado.ok) throw new Error('se esperaba un borrador valido')
    expect(resultado.description.length).toBeLessThanOrEqual(FICHA_MAX_CARACTERES)
  })

  it('una respuesta vacía es una respuesta, no un error', () => {
    expect(revisarBorrador('   ')).toEqual({ ok: false, motivo: 'vacia' })
    expect(revisarBorrador(null)).toEqual({ ok: false, motivo: 'vacia' })
    expect(revisarBorrador(42)).toEqual({ ok: false, motivo: 'vacia' })
  })
})

describe('el candado sanitario', () => {
  const prohibidos = [
    'Indicado para el dolor de cabeza.',
    'Indicaciones: fiebre y malestar general.',
    'Contraindicaciones: embarazo.',
    'Para el tratamiento de infecciones respiratorias.',
    'Alivia el dolor muscular en minutos.',
    'Ayuda a prevenir la caida del cabello.',
    'Dosis: una capsula cada ocho horas.',
    'Modo de empleo: aplicar sobre la zona afectada.',
    'Eficaz contra la gripe.',
    'Recomendado para pieles sensibles.',
    'Util cuando aparecen los sintomas.',
  ]

  it.each(prohibidos)('bloquea «%s»', (texto) => {
    expect(tieneAfirmacionClinica(texto)).toBe(true)
    expect(revisarBorrador(texto)).toEqual({ ok: false, motivo: 'clinica' })
  })

  /**
   * Y no bloquea lo que sí se puede decir.
   *
   * Un filtro que tumba fichas correctas se desactiva en una semana y entonces
   * no protege de nada. Por eso son frases y no palabras sueltas: «se trata de»
   * lleva «trata» dentro, y «crema para manos» lleva «para».
   */
  const permitidos = [
    'Caja de 21 capsulas de 500 mg. Laboratorio Quilab.',
    'Se trata de una presentacion en frasco de 120 ml.',
    'Crema para manos de 75 ml, marca Eucerin.',
    'Ampolla bebible de 10 ml, envase con 20 unidades.',
    'Shampoo de 1 litro de la linea profesional Sebastian.',
  ]

  it.each(permitidos)('deja pasar «%s»', (texto) => {
    expect(tieneAfirmacionClinica(texto)).toBe(false)
    expect(revisarBorrador(texto).ok).toBe(true)
  })
})
