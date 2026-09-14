import { toCsv } from '@/shared/lib/csv'
import { MAX_LINE_QUANTITY } from '../cart/cart'

/**
 * Pedido rápido y pedido masivo por CSV: el TEXTO, antes de preguntar a nadie.
 *
 * Mismo reparto que la importación de precios (`features/pricing/importCsv.ts`):
 * **parsear y resolver son dos pasos**. Este archivo solo lee lo que escribió o
 * pegó el comprador —no sabe qué productos existen— y el servidor, después,
 * traduce cada SKU con `resolve_order_lines_for_slug`. Así la pantalla enseña
 * el informe fila a fila ANTES de tocar el carrito.
 *
 * Cuatro decisiones:
 *
 *  1. **La fila es la del archivo**, como la numera la hoja de cálculo (la
 *     cabecera es la 1). «Fila 7: SKU no encontrado» tiene que llevar al
 *     comprador a la fila 7 de SU hoja, no a la séptima que sobrevivió.
 *  2. **Un SKU repetido se rechaza en todas sus apariciones** (`SKU_DUPLICADO`).
 *     Sumar inventaría una intención —¿5 más 3, u 8 en total?— y quedarse con
 *     la primera escondería la segunda. El servidor aplica la misma regla.
 *  3. **La cantidad es un entero entre 1 y el tope del carrito** (99). El
 *     servidor admite más, pero el carrito de la vitrina recorta a 99 en
 *     silencio: se dice aquí, con su motivo, en vez de dejar que se recorte.
 *  4. **El separador se deduce de la línea**, no se prueba con todos a la vez.
 *     `SKU;1,5` con «coma o punto y coma» indistintos daría `[SKU, 1, 5]` y una
 *     cantidad de 1 que nadie escribió.
 */

/** Tope de filas de datos por carga: el mismo que aplica el servidor. */
export const QUICK_ORDER_MAX_ROWS = 100

/** Cabecera de la plantilla. Estable: cambiarla rompe las hojas guardadas. */
export const QUICK_ORDER_CSV_HEADERS = ['sku', 'cantidad'] as const

/** Motivos que decide el NAVEGADOR antes de preguntar. */
export type ClientRejectReason =
  | 'FORMATO_INVALIDO'
  | 'SKU_REQUERIDO'
  | 'SKU_DUPLICADO'
  | 'CANTIDAD_INVALIDA'
  | 'CANTIDAD_MAXIMA'

/** Motivos que devuelve `resolve_order_lines_for_slug`. */
export const SERVER_REJECT_REASONS = [
  'SKU_REQUERIDO',
  'SKU_DUPLICADO',
  'CANTIDAD_INVALIDA',
  'SKU_NO_ENCONTRADO',
  'NO_DISPONIBLE',
  'VARIANTE_REQUERIDA',
  'FUERA_DE_SURTIDO',
] as const
export type ServerRejectReason = (typeof SERVER_REJECT_REASONS)[number]

/**
 * `DESCONOCIDO` cubre un código nuevo del servidor que esta versión del
 * navegador aún no conoce: se rechaza la fila con un texto genérico en vez de
 * pintar un código crudo o, peor, aceptarla.
 */
export type RejectReason = ClientRejectReason | ServerRejectReason | 'DESCONOCIDO'

/** Problemas del ARCHIVO entero: con ellos no se resuelve ninguna fila. */
export type FileIssue = 'ARCHIVO_VACIO' | 'CABECERA_INVALIDA' | 'LIMITE_FILAS'

/** Una fila tal como se leyó: texto, sin validar. */
export interface DraftLine {
  readonly row: number
  readonly sku: string
  readonly quantityText: string
  /** Más columnas con contenido de las que se esperan (solo al pegar). */
  readonly malformed?: boolean
}

export interface ParsedLines {
  readonly lines: readonly DraftLine[]
  readonly fileIssue: FileIssue | null
}

/** Fila que pasó la validación del navegador y va al servidor. */
export interface ValidLine {
  readonly row: number
  readonly sku: string
  readonly quantity: number
}

export interface RejectedLine {
  readonly row: number
  readonly sku: string
  readonly status: 'rejected'
  readonly reason: RejectReason
}

export interface AcceptedLine {
  readonly row: number
  readonly sku: string
  readonly status: 'ok'
  readonly product_id: string
  readonly variant_id: string | null
  readonly name: string
  readonly variant_name: string | null
  readonly quantity: number
}

export type ReportLine = AcceptedLine | RejectedLine

/** Lo que devuelve el servidor por fila, ya validado por el módulo de datos. */
export type ResolvedServerLine =
  | {
      readonly row: number
      readonly status: 'ok'
      readonly product_id: string
      readonly variant_id: string | null
      readonly name: string
      readonly variant_name: string | null
      readonly quantity: number
    }
  | { readonly row: number; readonly status: 'rejected'; readonly reason: string }

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** El separador de UNA línea: tabulador (copiar de Excel), punto y coma o coma. */
export function detectDelimiter(line: string): '\t' | ';' | ',' {
  if (line.includes('\t')) return '\t'
  if (line.includes(';')) return ';'
  return ','
}

/** Campos de una línea con un separador dado, respetando comillas dobles. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      fields.push(current)
      current = ''
      continue
    }
    current += char
  }
  fields.push(current)
  return fields.map((field) => field.trim())
}

/** El BOM (U+FEFF) al principio del texto. Por código y no literal: es invisible. */
const BOM_AT_START = new RegExp(`^${String.fromCharCode(0xfeff)}`)

/**
 * Líneas numeradas como en el editor: la primera es la 1, y las vacías cuentan
 * aunque se descarten. El BOM se quita porque Excel lo escribe siempre y, sin
 * quitarlo, la primera cabecera no es `sku` sino `sku` con un carácter
 * invisible delante.
 */
function numberedLines(text: string): Array<{ row: number; text: string }> {
  return text
    .replace(BOM_AT_START, '')
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ row: index + 1, text: line }))
    .filter((line) => line.text.trim().length > 0)
}

/**
 * «Pegar líneas»: `SKU<separador>cantidad` por línea, sin cabecera.
 *
 * Una línea con una sola columna llega sin cantidad y se rechaza por eso: poner
 * 1 por defecto sería decidir por el comprador cuántas cajas quiere.
 */
export function parsePastedLines(text: string): ParsedLines {
  const lines = numberedLines(text)
  if (lines.length === 0) return { lines: [], fileIssue: 'ARCHIVO_VACIO' }
  if (lines.length > QUICK_ORDER_MAX_ROWS) return { lines: [], fileIssue: 'LIMITE_FILAS' }

  return {
    fileIssue: null,
    lines: lines.map(({ row, text: raw }) => {
      const fields = splitDelimited(raw, detectDelimiter(raw))
      const [sku = '', quantityText = '', ...rest] = fields
      return rest.some((field) => field.length > 0)
        ? { row, sku, quantityText, malformed: true }
        : { row, sku, quantityText }
    }),
  }
}

/**
 * CSV con cabecera `sku,cantidad` (se admite `quantity` para la hoja en
 * inglés). Columnas de más se ignoran —una hoja real trae descripción y
 * precio de referencia— y el orden de las columnas da igual.
 */
export function parseOrderCsv(text: string): ParsedLines {
  const lines = numberedLines(text)
  const [header, ...data] = lines
  if (!header) return { lines: [], fileIssue: 'ARCHIVO_VACIO' }

  const delimiter = detectDelimiter(header.text)
  const columns = splitDelimited(header.text, delimiter).map((field) => field.toLowerCase())
  const skuColumn = columns.indexOf('sku')
  const quantityColumn = columns.findIndex((field) => field === 'cantidad' || field === 'quantity')
  if (skuColumn < 0 || quantityColumn < 0) return { lines: [], fileIssue: 'CABECERA_INVALIDA' }

  if (data.length === 0) return { lines: [], fileIssue: 'ARCHIVO_VACIO' }
  if (data.length > QUICK_ORDER_MAX_ROWS) return { lines: [], fileIssue: 'LIMITE_FILAS' }

  return {
    fileIssue: null,
    lines: data.map(({ row, text: raw }) => {
      const fields = splitDelimited(raw, delimiter)
      return { row, sku: fields[skuColumn] ?? '', quantityText: fields[quantityColumn] ?? '' }
    }),
  }
}

/** Filas del editor (SKU + cantidad) con la misma forma que las leídas. */
export function draftsFromEditor(
  rows: ReadonlyArray<{ sku: string; quantity: string; malformed?: boolean }>,
): ParsedLines {
  const lines: DraftLine[] = rows
    .map((line, index) => ({
      row: index + 1,
      sku: line.sku.trim(),
      quantityText: line.quantity.trim(),
      ...(line.malformed ? { malformed: true } : {}),
    }))
    .filter((line) => line.sku.length > 0 || line.quantityText.length > 0)
  if (lines.length === 0) return { lines: [], fileIssue: 'ARCHIVO_VACIO' }
  if (lines.length > QUICK_ORDER_MAX_ROWS) return { lines: [], fileIssue: 'LIMITE_FILAS' }
  return { lines, fileIssue: null }
}

/** La plantilla descargable. Una fila de ejemplo para que se vea el formato. */
export function quickOrderCsvTemplate(): string {
  return toCsv([...QUICK_ORDER_CSV_HEADERS], [['SKU-EJEMPLO', '1']])
}

// ---------------------------------------------------------------------------
// Validación del navegador
// ---------------------------------------------------------------------------

const INTEGER = /^\d{1,5}$/

/**
 * Separa lo que puede ir al servidor de lo que ya se sabe que no. Nada de lo
 * rechazado aquí viaja: preguntar por una fila con cantidad «abc» solo gastaría
 * una consulta para oír lo mismo.
 */
export function checkLines(lines: readonly DraftLine[]): {
  valid: ValidLine[]
  rejected: RejectedLine[]
} {
  const seen = new Map<string, number>()
  for (const line of lines) {
    const key = line.sku.trim().toLowerCase()
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  const valid: ValidLine[] = []
  const rejected: RejectedLine[] = []
  const reject = (line: DraftLine, reason: RejectReason) =>
    rejected.push({ row: line.row, sku: line.sku.trim(), status: 'rejected', reason })

  for (const line of lines) {
    const sku = line.sku.trim()
    const text = line.quantityText.trim()
    if (line.malformed) reject(line, 'FORMATO_INVALIDO')
    else if (!sku) reject(line, 'SKU_REQUERIDO')
    else if ((seen.get(sku.toLowerCase()) ?? 0) > 1) reject(line, 'SKU_DUPLICADO')
    else if (!INTEGER.test(text) || Number(text) < 1) reject(line, 'CANTIDAD_INVALIDA')
    else if (Number(text) > MAX_LINE_QUANTITY) reject(line, 'CANTIDAD_MAXIMA')
    else valid.push({ row: line.row, sku, quantity: Number(text) })
  }
  return { valid, rejected }
}

function knownServerReason(reason: string): RejectReason {
  return (SERVER_REJECT_REASONS as readonly string[]).includes(reason)
    ? (reason as ServerRejectReason)
    : 'DESCONOCIDO'
}

/**
 * Junta el veredicto del navegador y el del servidor en UN informe ordenado
 * por fila del archivo.
 *
 * El servidor numera por posición en lo que se le mandó (1..n), no por fila
 * del archivo: la traducción de una numeración a la otra vive aquí y solo aquí.
 * Una fila enviada sin respuesta —no debería pasar— se rechaza como
 * `DESCONOCIDO`: lo que no se sabe no entra al carrito.
 */
export function buildReport(
  sent: readonly ValidLine[],
  locallyRejected: readonly RejectedLine[],
  resolved: readonly ResolvedServerLine[],
): ReportLine[] {
  const byPosition = new Map(resolved.map((line) => [line.row, line]))
  const fromServer: ReportLine[] = sent.map((line, index) => {
    const answer = byPosition.get(index + 1)
    if (!answer) return { row: line.row, sku: line.sku, status: 'rejected', reason: 'DESCONOCIDO' }
    if (answer.status === 'rejected') {
      return { row: line.row, sku: line.sku, status: 'rejected', reason: knownServerReason(answer.reason) }
    }
    return {
      row: line.row,
      sku: line.sku,
      status: 'ok',
      product_id: answer.product_id,
      variant_id: answer.variant_id,
      name: answer.name,
      variant_name: answer.variant_name,
      // La cantidad es la que el comprador escribió; el servidor la devuelve
      // igual, pero la de la hoja es la que se promete en pantalla.
      quantity: line.quantity,
    }
  })
  return [...fromServer, ...locallyRejected].sort((a, b) => a.row - b.row)
}
