import { normalizeHeader, type AxisColumn, type SheetSpec } from './columns'

/**
 * Lectura de una hoja ya abierta: celdas → filas para el servidor.
 *
 * Función PURA: no abre archivos ni sabe qué hay en el catálogo. Solo decide
 * qué columna es cada cabecera y qué se manda de cada celda. Validar precios,
 * slugs y referencias es del servidor, que lo hace en la misma transacción en
 * la que escribe; repetirlo aquí sería mantener dos reglas que se separan.
 *
 * Lo único que se rechaza aquí es lo que impide LEER la hoja: que esté vacía,
 * que falte la columna que identifica la fila o que tenga más filas de las que
 * el servidor admite.
 */

export type SheetCell = string | number | boolean | Date | null | undefined

/** Una fila lista para el servidor. `row` es el número de fila del Excel. */
export type ImportRow = { row: number } & Record<string, unknown>

export type SheetIssue =
  | { readonly kind: 'empty' }
  | { readonly kind: 'missingHeaders'; readonly headers: readonly string[] }
  | { readonly kind: 'tooManyRows'; readonly max: number }

export interface ParsedSheet {
  readonly rows: readonly ImportRow[]
  readonly issue: SheetIssue | null
  /** Cabeceras que no corresponden a ninguna columna: se ignoran y se avisan. */
  readonly ignoredHeaders: readonly string[]
}

type Target = { readonly key: string } | { readonly axis: string } | null

function isBlank(cell: SheetCell): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')
}

/** Lo que viaja de una celda. Las fechas no son de ninguna columna: van como texto. */
function cellValue(cell: SheetCell): string | number | boolean | undefined {
  if (isBlank(cell)) return undefined
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  if (typeof cell === 'string') return cell.trim()
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined
  return cell ?? undefined
}

export function parseSheet(
  data: readonly (readonly SheetCell[])[],
  spec: SheetSpec,
  axes: readonly AxisColumn[] = [],
): ParsedSheet {
  const headerIndex = data.findIndex((line) => line.some((cell) => !isBlank(cell)))
  if (headerIndex < 0) return { rows: [], issue: { kind: 'empty' }, ignoredHeaders: [] }

  const byHeader = new Map<string, Target>()
  for (const column of spec.columns) {
    byHeader.set(normalizeHeader(column.header), { key: column.key })
    byHeader.set(normalizeHeader(column.key), { key: column.key })
  }
  for (const axis of axes) {
    // Una columna de la hoja gana a un eje que se llame igual.
    if (!byHeader.has(normalizeHeader(axis.header))) byHeader.set(normalizeHeader(axis.header), { axis: axis.code })
    if (!byHeader.has(normalizeHeader(axis.code))) byHeader.set(normalizeHeader(axis.code), { axis: axis.code })
  }

  const headerLine = data[headerIndex] ?? []
  const ignoredHeaders: string[] = []
  const targets: Target[] = headerLine.map((cell) => {
    if (isBlank(cell)) return null
    const target = byHeader.get(normalizeHeader(String(cell))) ?? null
    if (!target) ignoredHeaders.push(String(cell).trim())
    return target
  })

  const presentKeys = new Set(
    targets.flatMap((target) => (target && 'key' in target ? [target.key] : [])),
  )
  const missing = spec.requiredHeaders
    .filter((group) => !group.some((key) => presentKeys.has(key)))
    .map((group) =>
      group
        .map((key) => spec.columns.find((column) => column.key === key)?.header ?? key)
        .join(' / '),
    )
  if (missing.length > 0) {
    return { rows: [], issue: { kind: 'missingHeaders', headers: missing }, ignoredHeaders }
  }

  const rows: ImportRow[] = []
  for (let index = headerIndex + 1; index < data.length; index += 1) {
    const line = data[index] ?? []
    if (line.every(isBlank)) continue

    const row: ImportRow = { row: index + 1 }
    const rowAxes: Record<string, string | number | boolean> = {}
    targets.forEach((target, column) => {
      const value = cellValue(line[column])
      if (target === null || value === undefined) return
      if ('key' in target) row[target.key] = value
      else rowAxes[target.axis] = value
    })
    if (Object.keys(rowAxes).length > 0) row.axes = rowAxes
    // Una fila con solo el número no dice nada: se trata como vacía.
    if (Object.keys(row).length > 1) rows.push(row)
  }

  if (rows.length === 0) return { rows: [], issue: { kind: 'empty' }, ignoredHeaders }
  if (rows.length > spec.maxRows) {
    return { rows: [], issue: { kind: 'tooManyRows', max: spec.maxRows }, ignoredHeaders }
  }
  return { rows, issue: null, ignoredHeaders }
}

/** Busca la hoja por su nombre de plantilla, sin tildes ni mayúsculas. */
export function findSheet<T extends { readonly sheet: string }>(
  sheets: readonly T[],
  spec: SheetSpec,
  fallbackToFirst: boolean,
): T | null {
  const wanted = normalizeHeader(spec.name)
  const byName = sheets.find(
    (sheet) => normalizeHeader(sheet.sheet) === wanted || normalizeHeader(sheet.sheet) === normalizeHeader(spec.id),
  )
  if (byName) return byName
  return fallbackToFirst ? (sheets[0] ?? null) : null
}
