import { describe, expect, it } from 'vitest'
import { en } from '@/shared/i18n/messages.en'
import { esBackoffice } from '@/shared/i18n/messages.es.backoffice'
import { ROW_REASONS, axisColumns, rowReasonKey } from './api'
import {
  ATTRIBUTE_VALUES_SHEET,
  CATEGORIES_SHEET,
  PRODUCTS_SHEET,
  VOCABULARY_SHEETS,
  normalizeHeader,
  type AxisColumn,
} from './columns'
import { buildTemplate } from './excel'
import { findSheet, parseSheet } from './parse'

const TALLA: AxisColumn = { code: 'talla', header: 'Talla', sampleValues: ['S', 'M', 'L'] }

describe('lectura de la hoja', () => {
  it('reconoce la cabecera de la plantilla, sin tildes, con asterisco o por su clave técnica', () => {
    const parsed = parseSheet(
      [
        ['SKU *', 'NOMBRE', 'precio', 'Categoría', 'compare_at_price', 'Talla', 'Otra cosa'],
        ['BIE-1', 'Polo', 59.9, 'hombre-polos', '69,90', 'M', 'x'],
      ],
      PRODUCTS_SHEET,
      [TALLA],
    )

    expect(parsed.issue).toBeNull()
    expect(parsed.ignoredHeaders).toEqual(['Otra cosa'])
    expect(parsed.rows).toEqual([
      {
        row: 2, sku: 'BIE-1', name: 'Polo', price: 59.9, category_slug: 'hombre-polos',
        compare_at_price: '69,90', axes: { talla: 'M' },
      },
    ])
  })

  it('numera con la fila del Excel, salta las vacías y omite las celdas vacías', () => {
    const parsed = parseSheet(
      [
        [null, null],
        ['Slug', 'Nombre'],
        ['mujer', 'Mujer'],
        [null, '   '],
        ['hombre', null],
        [new Date('2026-09-16T12:00:00Z'), 'Fecha'],
      ],
      CATEGORIES_SHEET,
    )

    expect(parsed.rows).toEqual([
      { row: 3, slug: 'mujer', name: 'Mujer' },
      { row: 5, slug: 'hombre' },
      { row: 6, slug: '2026-09-16', name: 'Fecha' },
    ])
  })

  it('sin la columna que identifica la fila no se lee la hoja', () => {
    expect(parseSheet([['Nombre', 'Precio'], ['Polo', 10]], PRODUCTS_SHEET).issue).toEqual({
      kind: 'missingHeaders',
      headers: ['SKU'],
    })
    // Valores: basta el código O la etiqueta.
    expect(parseSheet([['Atributo', 'Etiqueta'], ['talla', 'S']], ATTRIBUTE_VALUES_SHEET).issue).toBeNull()
    expect(parseSheet([['Atributo', 'Posición'], ['talla', 1]], ATTRIBUTE_VALUES_SHEET).issue).toEqual({
      kind: 'missingHeaders',
      headers: ['Código / Etiqueta'],
    })
  })

  it('una hoja vacía o con más filas que el máximo se rechaza', () => {
    expect(parseSheet([], CATEGORIES_SHEET).issue).toEqual({ kind: 'empty' })
    expect(parseSheet([['Slug', 'Nombre']], CATEGORIES_SHEET).issue).toEqual({ kind: 'empty' })

    const many = [['Slug'], ...Array.from({ length: CATEGORIES_SHEET.maxRows + 1 }, (_, i) => [`c-${i}`])]
    expect(parseSheet(many, CATEGORIES_SHEET).issue).toEqual({ kind: 'tooManyRows', max: 1000 })
  })

  it('encuentra la hoja por su nombre, sin tildes; si no, la primera solo cuando se permite', () => {
    const sheets = [{ sheet: 'Resumen' }, { sheet: 'CATEGORIAS' }]
    expect(findSheet(sheets, CATEGORIES_SHEET, false)).toEqual({ sheet: 'CATEGORIAS' })
    expect(findSheet([{ sheet: 'Hoja1' }], PRODUCTS_SHEET, true)).toEqual({ sheet: 'Hoja1' })
    expect(findSheet([{ sheet: 'Hoja1' }], PRODUCTS_SHEET, false)).toBeNull()
  })

  it('normaliza cabeceras', () => {
    expect(normalizeHeader('  Slug de la madre * ')).toBe('slugdelamadre')
    expect(normalizeHeader('variant_sku')).toBe(normalizeHeader('Variant SKU'))
  })
})

describe('plantilla', () => {
  it('el libro de catálogo avanzado trae sus cinco hojas y las instrucciones', () => {
    const sheets = buildTemplate(VOCABULARY_SHEETS)
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Marcas', 'Familias', 'Unidades', 'Atributos', 'Valores', 'Instrucciones',
    ])
    expect(sheets[0]?.header).toEqual(['Código *', 'Nombre *', 'Descripción', 'Activa'])
  })

  it('la de productos añade una columna por eje y la rellena solo en filas de variante', () => {
    const [productos] = buildTemplate([PRODUCTS_SHEET], [TALLA])
    expect(productos?.header.at(-1)).toBe('Talla')
    const talla = productos?.header.length ? productos.header.length - 1 : -1
    expect(productos?.rows.map((row) => row[talla])).toEqual([null, 'M', 'L'])
  })

  it('una plantilla descargada se vuelve a leer sin cabeceras ignoradas', () => {
    const [productos] = buildTemplate([PRODUCTS_SHEET], [TALLA])
    const parsed = parseSheet([productos!.header, ...productos!.rows], PRODUCTS_SHEET, [TALLA])
    expect(parsed.issue).toBeNull()
    expect(parsed.ignoredHeaders).toEqual([])
    expect(parsed.rows).toHaveLength(PRODUCTS_SHEET.examples.length)
  })
})

describe('motivos y ejes', () => {
  it('cada motivo por fila tiene texto en los dos idiomas', () => {
    for (const reason of [...ROW_REASONS, 'DESCONOCIDO']) {
      const key = `catalogImport.reason.${reason}`
      expect(esBackoffice, key).toHaveProperty([key])
      expect(en, key).toHaveProperty([key])
    }
    expect(rowReasonKey('ALGO_NUEVO')).toBe('catalogImport.reason.DESCONOCIDO')
    expect(rowReasonKey('SKU_REPETIDO')).toBe('catalogImport.reason.SKU_REPETIDO')
  })

  it('solo los ejes de variante activos son columnas, en su orden', () => {
    const base = { unit: null, is_filterable: true, data_type: 'option' as const }
    const columns = axisColumns(
      [
        { ...base, id: '00000000-0000-4000-8000-000000000002', code: 'color', name: 'Color', is_variant_axis: true, position: 2, is_active: true },
        { ...base, id: '00000000-0000-4000-8000-000000000001', code: 'talla', name: 'Talla', is_variant_axis: true, position: 1, is_active: true },
        { ...base, id: '00000000-0000-4000-8000-000000000003', code: 'material', name: 'Material', is_variant_axis: false, position: 0, is_active: true },
        { ...base, id: '00000000-0000-4000-8000-000000000004', code: 'tono', name: 'Tono', is_variant_axis: true, position: 3, is_active: false },
      ],
      [
        { id: '00000000-0000-4000-8000-0000000000a2', attribute_id: '00000000-0000-4000-8000-000000000001', code: 'm', label: 'M', position: 2, is_active: true },
        { id: '00000000-0000-4000-8000-0000000000a1', attribute_id: '00000000-0000-4000-8000-000000000001', code: 's', label: 'S', position: 1, is_active: true },
      ],
    )
    expect(columns).toEqual([
      { code: 'talla', header: 'Talla', sampleValues: ['S', 'M'] },
      { code: 'color', header: 'Color', sampleValues: [] },
    ])
  })
})
