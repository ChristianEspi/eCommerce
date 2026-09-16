import type { Locale } from '@/shared/i18n/messages'

const LOCALE_TAG: Record<Locale, string> = { es: 'es-PE', en: 'en-US' }

/** Formatea importes con la moneda de la sociedad, no con una moneda cableada. */
export function formatMoney(amount: number, currency: string, locale: Locale = 'es'): string {
  try {
    return new Intl.NumberFormat(LOCALE_TAG[locale], {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Importe en texto o raya cuando no hay importe. Un precio que no existe se
 * pinta «—», nunca «S/ 0.00»: un cero en una columna de precios se lee como
 * «gratis».
 */
export function formatMoneyOrDash(amount: string | null, currency: string, locale: Locale = 'es'): string {
  return amount === null ? '—' : formatMoney(Number(amount), currency, locale)
}

export function formatDate(value: string | Date, locale: Locale = 'es'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], { dateStyle: 'medium' }).format(date)
}

/** Fecha + hora para la bitácora: un cambio de estado se identifica por minuto. */
export function formatDateTime(value: string | Date, locale: Locale = 'es'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/**
 * Solo la hora. En un listado donde muchas filas comparten dia, repetir la
 * fecha completa gasta ancho sin distinguir nada: lo que separa un pedido de
 * otro es la hora.
 */
export function formatTime(value: string | Date, locale: Locale = 'es'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], { timeStyle: 'short' }).format(date)
}

/**
 * Tiempo relativo («hace 3 d»). En un listado operativo la pregunta no suele
 * ser «que dia fue» sino «cuanto lleva ahi»: un pedido de hace cuatro dias sin
 * cobrar se ve de un vistazo, y una fecha absoluta obliga a restar mentalmente.
 *
 * Usa `Intl.RelativeTimeFormat`, que ya sabe decirlo en cada idioma: componerlo
 * a mano obliga a traducir plurales y a acertar con el genero.
 */
export function formatRelative(value: string | Date, locale: Locale = 'es'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]

  const rtf = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(Math.round(seconds), 'second')
}
