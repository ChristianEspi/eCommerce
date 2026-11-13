import { describe, expect, it } from 'vitest'
import { MESSAGES } from '@/shared/i18n/messages.all'
import type { MessageKey } from '@/shared/i18n/messages'
import { analyticsBook } from '@/features/analytics/exportExcel'
import { reviewsBook } from '@/features/catalog/reviews/api'
import { complaintsBook } from '@/features/complaints/exportExcel'
import { parsePriceCsv } from '@/features/pricing/importCsv'
import { priceImportColumns, priceTemplateBook } from '@/features/pricing/priceTemplate'
import { statementImportColumns, statementTemplateBook, statementText } from '@/features/payments/statementTemplate'
import { parseOrderCsv, quickOrderImportColumns, quickOrderTemplateBook } from '@/features/storefront/quick-order/lines'
import {
  buildGuide,
  cellText,
  excelDate,
  excelNumber,
  findImportTable,
  normalizeHeader,
  sheetCells,
  sheetName,
  tableToCsv,
  xlsxFileName,
  type ExcelBook,
} from './excel'

const t = (key: MessageKey) => MESSAGES.es[key] ?? key

/**
 * Lo que `read-excel-file` devolvería al abrir el libro que se descarga: la
 * guía (si es plantilla, primero) y cada hoja con su cabecera y sus filas.
 */
function asRead(book: ExcelBook) {
  const guide = { data: buildGuide(book, t).rows.map((row) => [...row]) }
  const sheets = book.sheets.map((sheet) => ({
    data: [sheet.columns.map((column) => column.header), ...sheet.rows.map((row) => [...row])],
  }))
  return book.template ? [guide, ...sheets] : [...sheets, guide]
}

describe('valores para la hoja', () => {
  it('un importe de la base es un número; vacío o ilegible es celda vacía, no un 0', () => {
    expect(excelNumber('236.00')).toBe(236)
    expect(excelNumber('1,5')).toBe(1.5)
    expect(excelNumber(null)).toBeNull()
    expect(excelNumber('')).toBeNull()
    expect(excelNumber('abc')).toBeNull()
  })

  it('un día suelto no cambia de fecha; un instante se escribe con la hora LOCAL', () => {
    expect(excelDate('2026-11-13')?.toISOString()).toBe('2026-11-13T00:00:00.000Z')
    const instant = new Date('2026-11-13T16:21:00Z')
    const local = excelDate('2026-11-13T16:21:00Z') as Date
    // Los campos UTC del resultado son la hora de pared local del instante.
    expect(local.getUTCHours()).toBe(instant.getHours())
    expect(local.getUTCMinutes()).toBe(instant.getMinutes())
    expect(excelDate('no es fecha')).toBeNull()
    expect(excelDate(null)).toBeNull()
  })

  it('nombres de hoja y de archivo válidos', () => {
    expect(sheetName('Ventas: [enero]/feb')).toBe('Ventas   enero  feb')
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
    expect(xlsxFileName('pedidos-2026-11-13')).toBe('pedidos-2026-11-13.xlsx')
    expect(xlsxFileName('a/b:c')).toBe('a-b-c.xlsx')
  })
})

describe('celdas de una hoja', () => {
  const sheet = {
    name: 'Pedidos',
    columns: [
      { header: 'Cliente', description: '', format: 'text' as const },
      { header: 'Total', description: '', format: 'money' as const },
      { header: 'Fecha', description: '', format: 'datetime' as const },
    ],
    rows: [['=HYPERLINK("http://x")', 236, new Date(Date.UTC(2026, 10, 13, 11, 21))], [null, null, null]],
  }

  it('la cabecera va en negrita', () => {
    const [header] = sheetCells(sheet)
    expect(header?.[0]).toMatchObject({ value: 'Cliente', type: String, fontWeight: 'bold' })
  })

  it('un texto que parece fórmula se escribe como TEXTO, nunca como fórmula', () => {
    const cell = sheetCells(sheet)[1]?.[0]
    expect(cell).toMatchObject({ value: '=HYPERLINK("http://x")', type: String })
    expect(cell?.type).not.toBe('Formula')
  })

  it('el importe es número con formato de dos decimales y la fecha, fecha', () => {
    const row = sheetCells(sheet)[1]
    expect(row?.[1]).toMatchObject({ value: 236, type: Number, format: '#,##0.00' })
    expect(row?.[2]).toMatchObject({ type: Date, format: 'dd/mm/yyyy hh:mm' })
  })

  it('una celda vacía queda vacía', () => {
    expect(sheetCells(sheet)[2]).toEqual([null, null, null])
  })
})

describe('la hoja «Guía»', () => {
  it('una plantilla dice qué columnas son obligatorias; una exportación no', () => {
    const plantilla = buildGuide(priceTemplateBook('mayorista', t), t)
    const cabecera = plantilla.rows[plantilla.boldRows[1] as number]
    expect(cabecera).toEqual(['Hoja', 'Columna', 'Qué contiene', 'Formato', 'Obligatoria'])
    expect(plantilla.rows).toContainEqual([
      'Precios',
      'Precio unitario',
      MESSAGES.es['exports.pricing.desc.unitPrice'],
      'Importe',
      'Sí',
    ])
    expect(plantilla.rows[0]).toEqual(['Plantilla de precios · lista mayorista'])

    const exportacion = buildGuide(
      { fileName: 'x', guide: { title: 'T', paragraphs: [] }, sheets: [{ name: 'H', columns: [{ header: 'A', description: 'd', format: 'text' }], rows: [] }] },
      t,
    )
    expect(exportacion.rows.at(-1)).toEqual(['H', 'A', 'd', 'Texto'])
  })
})

describe('leer una importación', () => {
  it('normaliza cabeceras: tildes, mayúsculas, espacios y paréntesis', () => {
    expect(normalizeHeader('Precio anterior (tachado)')).toBe(normalizeHeader('precio_anterior'))
    expect(normalizeHeader('CANTIDAD MÍNIMA')).toBe('cantidadminima')
  })

  it('el texto de una celda: fecha como AAAA-MM-DD, número tal cual, vacío como vacío', () => {
    expect(cellText(new Date(Date.UTC(2026, 10, 13)))).toBe('2026-11-13')
    expect(cellText(99.9)).toBe('99.9')
    expect(cellText(null)).toBe('')
    expect(cellText('  SKU-1 ')).toBe('SKU-1')
  })

  it('encuentra la tabla después de la guía y entiende la cabecera clara y la técnica', () => {
    const table = findImportTable(
      [
        { data: [['Guía'], [], ['Hoja', 'Columna']] },
        {
          data: [
            ['SKU', 'Descripción', 'cantidad'],
            ['A-1', 'Jabón', 3],
            [null, null, null],
            [],
          ],
        },
      ],
      [
        { key: 'sku', header: 'SKU' },
        { key: 'cantidad', header: 'Cantidad' },
      ],
    )
    expect(table).toEqual({ keys: ['sku', null, 'cantidad'], rows: [['A-1', 'Jabón', '3']] })
  })

  it('sin ninguna cabecera conocida no hay tabla', () => {
    expect(findImportTable([{ data: [['Nombre', 'Precio']] }], [{ key: 'sku', header: 'SKU' }])).toBeNull()
  })

  it('al texto CSV con comillas cuando hacen falta', () => {
    expect(tableToCsv({ keys: ['sku', null], rows: [['A,1', 'dice "hola"']] })).toBe('sku,\r\n"A,1","dice ""hola"""')
  })
})

describe('exportaciones con valores traducidos', () => {
  it('reclamaciones: tipo y estado en palabras, monto como número, fecha como fecha', () => {
    const [sheet] = complaintsBook(
      [
        {
          id: '11111111-1111-4111-8111-111111111111', code: 'R-0001', kind: 'reclamo', status: 'in_progress',
          consumer_name: 'Ana', doc_type: 'dni', doc_number: '12345678', consumer_email: 'a@b.pe',
          consumer_phone: null, consumer_address: null, is_minor: false, guardian_name: null, item_kind: 'producto',
          item_description: 'Mochila', amount: 99.9, order_reference: null, detail: 'Llegó rota', request: 'Cambio',
          response: null, responded_at: null, created_at: '2026-11-13T15:00:00Z',
        },
      ],
      t,
      'libro',
    ).sheets
    const row = sheet!.rows[0]!
    expect(row.slice(2, 4)).toEqual(['Reclamo', MESSAGES.es['complaints.status.inProgress']])
    expect(row[5]).toBe('DNI 12345678')
    expect(row[8]).toBe(99.9)
    expect(row[1]).toBeInstanceOf(Date)
    expect(row[11]).toBeNull()
  })

  it('reseñas: estado como la pestaña y compra verificada en Sí/No', () => {
    const [sheet] = reviewsBook(
      [
        {
          id: '11111111-1111-4111-8111-111111111111', product_id: '22222222-2222-4222-8222-222222222222',
          product_name: 'Mochila', display_name: 'Ana', rating: 5, title: null, body: 'Muy buena',
          status: 'published', verified_purchase: true, rejection_reason: null, moderated_at: null,
          created_at: '2026-11-13T15:00:00Z',
        },
      ],
      t,
      'resenas',
    ).sheets
    const row = sheet!.rows[0]!
    expect(row[1]).toBe(5)
    expect(row[5]).toBe('Sí')
    expect(row[6]).toBe(MESSAGES.es['admin.reviews.tab.published'])
  })

  it('analítica: el día es fecha (sin correrse de día) y el importe, número', () => {
    const [sheet] = analyticsBook([{ day: '2026-11-13', orders: 3, units: 7, revenue: '450.50', currency: 'PEN' }], 30, t).sheets
    const [day, orders, units, revenue, currency] = sheet!.rows[0]!
    expect((day as Date).toISOString().slice(0, 10)).toBe('2026-11-13')
    expect([orders, units, revenue, currency]).toEqual([3, 7, 450.5, 'PEN'])
  })
})

describe('las plantillas se leen con el MISMO validador de siempre', () => {
  it('precios: la plantilla descargada, rellenada, pasa por parsePriceCsv', () => {
    const book = priceTemplateBook('base', t)
    const sheets = asRead(book)
    // El comercio rellena una fila más, con escala y precio tachado.
    sheets[1]?.data.push(['SKU-2', null, 'CAJA', 12, 80.5, 95])
    const table = findImportTable(sheets, priceImportColumns(t))
    expect(table).not.toBeNull()
    const parsed = parsePriceCsv(tableToCsv(table!))
    expect(parsed.issues).toEqual([])
    expect(parsed.rows).toEqual([
      expect.objectContaining({ sku: 'SKU-EJEMPLO', minQuantity: '1', unitPrice: '99.9', compareAtPrice: null }),
      expect.objectContaining({ sku: 'SKU-2', uomCode: 'CAJA', minQuantity: '12', unitPrice: '80.5', compareAtPrice: '95' }),
    ])
  })

  it('pedido rápido: la plantilla descargada pasa por parseOrderCsv', () => {
    const table = findImportTable(asRead(quickOrderTemplateBook(t)), quickOrderImportColumns(t))
    expect(parseOrderCsv(tableToCsv(table!))).toEqual({
      fileIssue: null,
      lines: [{ row: 2, sku: 'SKU-EJEMPLO', quantityText: '1' }],
    })
  })

  it('conciliación: la plantilla rellena el cuadro en el orden fecha;referencia;bruto;comisión;moneda', () => {
    const book = statementTemplateBook(t)
    const sheets = asRead(book)
    const table = findImportTable(sheets, statementImportColumns(t))
    const today = new Date()
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(statementText(table!)).toBe(`${day};OP-000123;150;4.5;PEN`)
  })

  it('conciliación: columnas en otro orden y filas incompletas', () => {
    const text = statementText({
      keys: ['gross_amount', 'external_reference', 'settlement_date', null],
      rows: [
        ['100', 'OP-1', '2026-11-13', 'nota'],
        ['', 'OP-2', '2026-11-13', ''],
      ],
    })
    expect(text).toBe('2026-11-13;OP-1;100;;')
  })
})
