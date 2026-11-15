/**
 * Documentos de identidad para el comprobante peruano (2026-11-15).
 *
 *  · Boleta: DNI, carné de extranjería o pasaporte, y el nombre.
 *  · Factura: RUC (11 dígitos con dígito verificador) y razón social.
 *
 * Es una comprobación de FORMA, no de existencia: que el RUC esté activo lo
 * dice SUNAT (o el PSE al emitir). Evita lo más común: un dígito mal tecleado
 * o un DNI en la casilla del RUC.
 *
 * La misma regla vive en el borde (`supabase/functions/_shared/orders.ts`),
 * que es quien decide; esta copia solo ahorra un viaje.
 */

export type ReceiptIdType = 'dni' | 'ce' | 'passport'
export const RECEIPT_ID_TYPES: readonly ReceiptIdType[] = ['dni', 'ce', 'passport']

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/** RUC válido: 11 dígitos, prefijo de contribuyente y dígito verificador (módulo 11). */
export function isValidRuc(value: string): boolean {
  const ruc = value.trim()
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false
  const suma = PESOS_RUC.reduce((total, peso, i) => total + peso * Number(ruc[i]), 0)
  const resto = 11 - (suma % 11)
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto
  return verificador === Number(ruc[10])
}

/** Número de documento de boleta según su tipo. */
export function isValidReceiptId(type: ReceiptIdType, value: string): boolean {
  const v = value.trim()
  if (type === 'dni') return /^\d{8}$/.test(v)
  if (type === 'ce') return /^[A-Za-z0-9]{8,12}$/.test(v)
  return /^[A-Za-z0-9]{6,15}$/.test(v)
}
