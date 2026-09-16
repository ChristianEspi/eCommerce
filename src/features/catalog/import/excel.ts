import { templateHeader, type AxisColumn, type ImportColumn, type SheetSpec } from './columns'
import type { SheetCell } from './parse'

/**
 * Lectura y escritura de libros Excel (.xlsx).
 *
 * Las dos librerías se piden con `import()` en el momento de usarlas: son de la
 * pantalla de importación y no tienen por qué viajar en el bundle del panel ni,
 * menos aún, en el de la vitrina (`docs/performance-budget.md`).
 */

export interface WorkbookSheet {
  readonly sheet: string
  readonly data: readonly (readonly SheetCell[])[]
}

export class WorkbookReadError extends Error {
  constructor() {
    super('LIBRO_ILEGIBLE')
    this.name = 'WorkbookReadError'
  }
}

export async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  try {
    const sheets = await readXlsxFile(file)
    return sheets.map((sheet) => ({ sheet: sheet.sheet, data: sheet.data as unknown as SheetCell[][] }))
  } catch {
    // Un .xls antiguo, un CSV renombrado o un archivo dañado: la causa exacta no
    // le sirve al comercio, lo que le sirve es saber que debe guardar como .xlsx.
    throw new WorkbookReadError()
  }
}

/** Una hoja de plantilla en celdas: cabecera y filas de ejemplo. */
export interface TemplateSheet {
  readonly name: string
  readonly header: readonly string[]
  readonly rows: readonly (readonly (string | number | null)[])[]
}

const KIND_LABEL: Record<ImportColumn['kind'], string> = {
  text: 'texto',
  number: 'número (coma o punto decimal)',
  integer: 'número entero',
  boolean: 'sí / no',
}

/**
 * Las hojas de una plantilla. Función pura: la prueba la mira sin escribir un
 * archivo, y la descarga solo convierte esto en .xlsx.
 */
export function buildTemplate(specs: readonly SheetSpec[], axes: readonly AxisColumn[] = []): TemplateSheet[] {
  const sheets: TemplateSheet[] = specs.map((spec) => {
    const withAxes = spec.id === 'products' && axes.length > 0
    const header = [
      ...spec.columns.map(templateHeader),
      ...(withAxes ? axes.map((axis) => axis.header) : []),
    ]
    const rows = spec.examples.map((example, index) => [
      ...spec.columns.map((column) => example[column.key] ?? null),
      // Los ejes de ejemplo solo en las filas de variante.
      ...(withAxes
        ? axes.map((axis) => (example.variant_sku ? (axis.sampleValues[index % Math.max(axis.sampleValues.length, 1)] ?? null) : null))
        : []),
    ])
    return { name: spec.name, header, rows }
  })

  const guide: (string | number | null)[][] = []
  for (const spec of specs) {
    for (const column of spec.columns) {
      guide.push([spec.name, column.header, column.required ? 'sí, al crear' : 'no', KIND_LABEL[column.kind]])
    }
    if (spec.id === 'products') {
      for (const axis of axes) guide.push([spec.name, axis.header, 'solo en filas de variante', 'valor o código existente'])
    }
  }
  sheets.push({
    name: 'Instrucciones',
    header: ['Hoja', 'Columna', 'Obligatoria', 'Formato'],
    rows: [
      ...guide,
      [null, null, null, null],
      ['Notas', 'Borra las filas de ejemplo antes de cargar tus datos.', null, null],
      ['Notas', 'Una celda vacía no borra: conserva el valor actual al actualizar.', null, null],
      ['Notas', 'Lo que ya existe (mismo SKU o código) se actualiza; lo nuevo se crea.', null, null],
      ['Notas', 'Si una sola fila tiene error no se aplica nada: corrige y vuelve a subir.', null, null],
    ],
  })
  return sheets
}

export async function downloadTemplate(fileName: string, sheets: readonly TemplateSheet[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  await writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      stickyRowsCount: 1,
      columns: sheet.header.map((title) => ({ width: Math.min(Math.max(title.length + 4, 14), 40) })),
      data: [
        sheet.header.map((title) => ({ value: title, fontWeight: 'bold' as const })),
        ...sheet.rows.map((row) => row.map((value) => (value === null ? null : { value }))),
      ],
    })),
  ).toFile(fileName)
}
