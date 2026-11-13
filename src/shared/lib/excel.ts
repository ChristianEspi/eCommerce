import type { MessageKey } from '@/shared/i18n/messages'

/**
 * Libros Excel (.xlsx) de la app: exportaciones, plantillas e importaciones.
 *
 * Sustituye a los CSV (2026-11-13). Un CSV no lleva formato: el comercio lo
 * abría con las cabeceras técnicas (`payment_status`), los estados en inglés
 * (`paid`), los importes como texto y sin decir qué era cada columna. El libro
 * lleva cabeceras claras, importes y fechas como números de verdad, la fila de
 * títulos fija y una hoja «Guía» que explica cada columna.
 *
 * **Las librerías se piden con `import()`** al pulsar el botón: no viajan en el
 * bundle del panel ni en el de la vitrina (`docs/performance-budget.md`). Es el
 * mismo criterio que ya seguía la importación de catálogo.
 *
 * **Fórmulas.** Un texto se escribe como celda de TEXTO, nunca como fórmula:
 * un nombre de comprador «=HYPERLINK(...)» se ve tal cual y no se ejecuta. Por
 * eso aquí no hace falta el apóstrofo que el CSV anteponía.
 */

export type Translate = (key: MessageKey) => string

export type ExcelFormat = 'text' | 'integer' | 'decimal' | 'money' | 'date' | 'datetime'
export type ExcelValue = string | number | boolean | Date | null

export interface ExcelColumn {
  /** Cabecera clara, en el idioma de quien descarga. */
  readonly header: string
  /** Qué contiene: va a la hoja «Guía». */
  readonly description: string
  readonly format: ExcelFormat
  /** Solo en plantillas: si la importación la exige. */
  readonly required?: boolean
  /** Ancho en caracteres. Sin él se calcula de la cabecera. */
  readonly width?: number
}

export interface ExcelSheet {
  readonly name: string
  readonly columns: readonly ExcelColumn[]
  readonly rows: readonly (readonly ExcelValue[])[]
}

export interface ExcelBook {
  readonly fileName: string
  readonly sheets: readonly ExcelSheet[]
  readonly guide: {
    readonly title: string
    /** Párrafos que se leen antes de la tabla de columnas. */
    readonly paragraphs: readonly string[]
  }
  /**
   * Plantilla de importación: la guía va PRIMERO (es lo que hay que leer antes
   * de rellenar) y dice qué columnas son obligatorias. En una exportación los
   * datos van primero.
   */
  readonly template?: boolean
}

const NUMBER_FORMAT: Record<ExcelFormat, string | undefined> = {
  text: '@',
  integer: '0',
  decimal: '#,##0.###',
  money: '#,##0.00',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
}

const FORMAT_LABEL: Record<ExcelFormat, MessageKey> = {
  text: 'excel.format.text',
  integer: 'excel.format.integer',
  decimal: 'excel.format.decimal',
  money: 'excel.format.money',
  date: 'excel.format.date',
  datetime: 'excel.format.datetime',
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

/**
 * Un importe de la base («236.00») como número para la hoja.
 *
 * En la app los importes viajan como texto para no redondear; en un libro que
 * se va a sumar y filtrar tienen que ser números, o Excel los alinea a la
 * izquierda y `SUMA` da cero. Vacío o ilegible → celda vacía, nunca un 0 que
 * no estaba.
 */
export function excelNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Una fecha de la base como fecha de Excel, con la HORA LOCAL de quien
 * descarga.
 *
 * Excel no guarda zona horaria y `write-excel-file` convierte con la hora UTC:
 * sin este ajuste un pedido de las 11:21 en Lima salía a las 16:21. Se corre
 * el instante para que sus campos UTC sean la hora de pared local.
 *
 * Un día suelto (`2026-11-13`, sin hora) es un día y no un instante: se deja
 * en medianoche UTC para que no cambie de fecha en ninguna zona.
 */
export function excelDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number]
    return new Date(Date.UTC(year, month - 1, day))
  }
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) return null
  return new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000)
}

/** Nombre de hoja válido: Excel admite 31 caracteres y prohíbe `[]:*?/\`. */
export function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, ' ').trim()
  return (clean || 'Hoja').slice(0, 31)
}

/** Nombre de archivo sin caracteres que el sistema rechace, con su `.xlsx`. */
export function xlsxFileName(base: string): string {
  const clean = base.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export'
  return clean.toLowerCase().endsWith('.xlsx') ? clean : `${clean}.xlsx`
}

// ---------------------------------------------------------------------------
// La guía
// ---------------------------------------------------------------------------

export interface GuideSheet {
  readonly rows: readonly (readonly ExcelValue[])[]
  /** Filas (índice 0) que van en negrita: título y cabecera de la tabla. */
  readonly boldRows: readonly number[]
  readonly titleRow: number
}

/**
 * La hoja «Guía» de un libro. Función pura: el test la lee sin escribir un
 * archivo.
 *
 *   Título
 *   (párrafos)
 *   Hoja | Columna | Qué contiene | Formato [| Obligatoria]
 *   …una fila por columna de cada hoja…
 */
export function buildGuide(book: ExcelBook, t: Translate): GuideSheet {
  const rows: ExcelValue[][] = []
  const boldRows: number[] = []

  rows.push([book.guide.title])
  boldRows.push(0)
  rows.push([])
  for (const paragraph of book.guide.paragraphs) rows.push([paragraph])
  rows.push([])

  const header: ExcelValue[] = [
    t('excel.guide.colSheet'),
    t('excel.guide.colColumn'),
    t('excel.guide.colMeaning'),
    t('excel.guide.colFormat'),
  ]
  if (book.template) header.push(t('excel.guide.colRequired'))
  boldRows.push(rows.length)
  rows.push(header)

  for (const sheet of book.sheets) {
    for (const column of sheet.columns) {
      const row: ExcelValue[] = [sheet.name, column.header, column.description, t(FORMAT_LABEL[column.format])]
      if (book.template) row.push(t(column.required ? 'common.yes' : 'common.no'))
      rows.push(row)
    }
  }
  return { rows, boldRows, titleRow: 0 }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/** Lo que `write-excel-file` recibe por celda. Tipado local: la librería es dinámica. */
type WriterCell = {
  value?: string | number | boolean | Date
  type?: StringConstructor | NumberConstructor | BooleanConstructor | DateConstructor
  format?: string
  fontWeight?: 'bold'
  fontSize?: number
  backgroundColor?: string
  textColor?: string
  wrap?: boolean
  alignVertical?: 'top'
} | null

const HEADER_FILL = '#E8F3EE'
const HEADER_TEXT = '#0B3B2E'

function writerCell(value: ExcelValue, format: ExcelFormat | null): WriterCell {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return { value, type: String, ...(format === 'text' ? { format: '@' } : {}) }
  if (typeof value === 'boolean') return { value, type: Boolean }
  if (value instanceof Date) {
    return { value, type: Date, format: NUMBER_FORMAT[format === 'date' ? 'date' : 'datetime'] }
  }
  return { value, type: Number, ...(format && format !== 'text' ? { format: NUMBER_FORMAT[format] } : {}) }
}

/**
 * Las celdas de una hoja de datos. Pura y exportada para el test: es donde se
 * decide que un texto es texto (y no fórmula) y que un importe es número.
 */
export function sheetCells(sheet: ExcelSheet): WriterCell[][] {
  const header: WriterCell[] = sheet.columns.map((column) => ({
    value: column.header,
    type: String,
    fontWeight: 'bold',
    backgroundColor: HEADER_FILL,
    textColor: HEADER_TEXT,
  }))
  return [
    header,
    ...sheet.rows.map((row) => sheet.columns.map((column, index) => writerCell(row[index] ?? null, column.format))),
  ]
}

function columnWidth(column: ExcelColumn, rows: readonly (readonly ExcelValue[])[], index: number): number {
  if (column.width) return column.width
  let longest = column.header.length
  for (const row of rows.slice(0, 200)) {
    const value = row[index]
    if (typeof value === 'string') longest = Math.max(longest, Math.min(value.length, 60))
    else if (value instanceof Date) longest = Math.max(longest, 16)
    else if (typeof value === 'number') longest = Math.max(longest, String(value).length + 3)
  }
  return Math.min(Math.max(longest + 2, 10), 60)
}

/** Descarga el libro: hojas de datos y la guía, con sus formatos. */
export async function downloadWorkbook(book: ExcelBook, t: Translate): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')

  const dataSheets = book.sheets.map((sheet) => ({
    sheet: sheetName(sheet.name),
    stickyRowsCount: 1,
    columns: sheet.columns.map((column, index) => ({ width: columnWidth(column, sheet.rows, index) })),
    data: sheetCells(sheet),
  }))

  const guide = buildGuide(book, t)
  const guideSheet = {
    sheet: sheetName(t('excel.guide.sheet')),
    columns: [{ width: 22 }, { width: 28 }, { width: 70 }, { width: 22 }, { width: 14 }],
    data: guide.rows.map((row, rowIndex) =>
      row.map((value): WriterCell => {
        if (value === null || value === '') return null
        const bold = guide.boldRows.includes(rowIndex)
        return {
          value: value as string,
          type: String,
          wrap: true,
          alignVertical: 'top',
          ...(bold ? { fontWeight: 'bold' as const } : {}),
          ...(rowIndex === guide.titleRow ? { fontSize: 14 } : {}),
          ...(bold && rowIndex !== guide.titleRow
            ? { backgroundColor: HEADER_FILL, textColor: HEADER_TEXT }
            : {}),
        }
      }),
    ),
  }

  const sheets = book.template ? [guideSheet, ...dataSheets] : [...dataSheets, guideSheet]
  // El tipo de la librería es más estricto que lo que aquí se arma (celdas
  // vacías, filas de distinto largo); la forma es la documentada.
  await (writeXlsxFile as unknown as (sheets: unknown[]) => { toFile: (name: string) => Promise<void> })(sheets).toFile(
    xlsxFileName(book.fileName),
  )
}

// ---------------------------------------------------------------------------
// Lectura (importaciones)
// ---------------------------------------------------------------------------

export class WorkbookReadError extends Error {
  constructor(readonly reason: 'unreadable' | 'noHeader') {
    super(reason === 'unreadable' ? 'LIBRO_ILEGIBLE' : 'SIN_CABECERA')
    this.name = 'WorkbookReadError'
  }
}

/** Una columna que una importación entiende: su clave técnica y su cabecera clara. */
export interface ImportColumn {
  readonly key: string
  readonly header: string
}

/** «Precio unitario», «precio_unitario» y «PRECIO UNITARIO» son la misma cabecera. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

/** El texto de una celda leída, como lo escribiría quien teclea un CSV. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    // `read-excel-file` entrega la fecha de la celda en UTC: sus campos UTC son
    // lo que se ve en la celda.
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value).trim()
}

export interface ImportTable {
  /** Clave técnica de cada columna; `null` si la cabecera no es de la plantilla. */
  readonly keys: readonly (string | null)[]
  /** Filas de datos (sin la cabecera), con las vacías conservadas. */
  readonly rows: readonly (readonly string[])[]
}

/**
 * Encuentra la tabla en las hojas leídas: la fila (de las veinte primeras de
 * cada hoja) con MÁS cabeceras conocidas; a igualdad, la primera.
 *
 * No vale «la primera fila con alguna cabecera conocida»: la «Guía» de la
 * plantilla va primero y su tabla de columnas nombra «SKU» en una celda, así
 * que se tomaba la guía por los datos. La cabecera de verdad nombra TODAS las
 * columnas a la vez; la guía, una por fila. Pura, para el test.
 */
export function findImportTable(
  sheets: readonly { readonly data: readonly (readonly unknown[])[] }[],
  columns: readonly ImportColumn[],
): ImportTable | null {
  const known = new Map<string, string>()
  for (const column of columns) {
    known.set(normalizeHeader(column.key), column.key)
    known.set(normalizeHeader(column.header), column.key)
  }

  let best: { sheet: (typeof sheets)[number]; index: number; keys: (string | null)[]; score: number } | null = null
  for (const sheet of sheets) {
    const limit = Math.min(sheet.data.length, 20)
    for (let index = 0; index < limit; index += 1) {
      const keys = (sheet.data[index] ?? []).map((cell) => known.get(normalizeHeader(cellText(cell))) ?? null)
      const score = new Set(keys.filter((key) => key !== null)).size
      if (score > (best?.score ?? 0)) best = { sheet, index, keys, score }
    }
  }
  if (!best) return null

  const { keys } = best
  const rows = best.sheet.data.slice(best.index + 1).map((row) => keys.map((_, at) => cellText(row[at])))
  // Las filas vacías del final no son datos: Excel las arrastra por formato.
  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell === '')) rows.pop()
  return { keys, rows }
}

/** Un campo para el texto que entienden los lectores CSV (comillas y comas). */
function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}

/**
 * La tabla como texto CSV con las cabeceras TÉCNICAS, para pasarla al mismo
 * validador que ya leía el CSV: una sola regla de validación, no dos.
 */
export function tableToCsv(table: ImportTable): string {
  const header = table.keys.map((key) => quote(key ?? ''))
  return [header.join(','), ...table.rows.map((row) => row.map(quote).join(','))].join('\r\n')
}

/** El texto de un archivo con `FileReader` (jsdom no implementa `Blob.text()`). */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function isCsvFile(file: File): boolean {
  return /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain'
}

/** Lee un .xlsx y encuentra su tabla. Lanza `WorkbookReadError` si no puede. */
export async function readImportTable(file: File, columns: readonly ImportColumn[]): Promise<ImportTable> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  let sheets: { data: unknown[][] }[]
  try {
    const read = await readXlsxFile(file)
    sheets = read.map((sheet) => ({ data: sheet.data as unknown as unknown[][] }))
  } catch {
    // Un .xls antiguo o un archivo dañado: lo útil es decir «guárdalo como .xlsx».
    throw new WorkbookReadError('unreadable')
  }
  const table = findImportTable(sheets, columns)
  if (!table) throw new WorkbookReadError('noHeader')
  return table
}

/**
 * El texto CSV de un archivo de importación, sea .xlsx o .csv. El CSV se sigue
 * aceptando tal cual: quien ya tenía su archivo no tiene por qué rehacerlo.
 */
export async function readImportText(file: File, columns: readonly ImportColumn[]): Promise<string> {
  if (isCsvFile(file)) return readFileText(file)
  return tableToCsv(await readImportTable(file, columns))
}

/** Lo que acepta el selector de archivo de una importación. */
export const IMPORT_ACCEPT =
  '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
