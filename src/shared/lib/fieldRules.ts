import { z } from 'zod'
import { isValidReceiptId, isValidRuc } from './peruDocs'

/**
 * Reglas de campo de toda la suite (2026-11-18).
 *
 * Un campo dice QUÉ dato es —un RUC, un teléfono, un importe— y de ahí salen
 * tres cosas a la vez, para que no se contradigan:
 *
 *   1. lo que se deja TECLEAR (`sanitize`): en un DNI no entra una letra, en
 *      un importe no entra una segunda coma;
 *   2. el MÁXIMO de caracteres (`maxLength`) y el teclado del móvil
 *      (`inputMode`);
 *   3. la VALIDACIÓN del formulario (`zRule`), con el mismo máximo.
 *
 * El filtro de tecleo es ayuda, no seguridad: lo que decide es el esquema zod
 * en el cliente y la base (o el borde) en el servidor.
 */

export type DocType = 'ruc' | 'dni' | 'ce' | 'passport'
export const DOC_TYPES: readonly DocType[] = ['ruc', 'dni', 'ce', 'passport']

export type FieldRuleKind =
  | DocType
  /** Documento cuyo tipo aún no se sabe: dígitos y letras, hasta 15. */
  | 'document'
  | 'phone'
  | 'email'
  | 'url'
  /** Entero sin signo (cantidades, días, posiciones). */
  | 'integer'
  /** Entero que puede ser negativo (ajustes de stock). */
  | 'signedInteger'
  /** Decimal sin signo, hasta 4 decimales (cantidades fraccionables, pesos). */
  | 'decimal'
  /** Decimal con signo. */
  | 'signedDecimal'
  /** Importe: hasta 2 decimales. */
  | 'money'
  /** Porcentaje: 0–100 con hasta 2 decimales. */
  | 'percent'
  /** Código interno: letras, dígitos, guion, guion bajo y punto. Sin espacios. */
  | 'code'
  /** SKU / referencia de producto: como `code` más la barra. */
  | 'sku'
  /** Identificador en una URL: minúsculas, dígitos y guiones. */
  | 'slug'
  /** Nombre de PERSONA: solo letras, espacios, apóstrofo, punto y guion. */
  | 'personName'
  /** Texto libre corto (nombres de cosas, títulos, razón social). */
  | 'text'
  /** Texto libre largo (notas, descripciones). */
  | 'longText'
  | 'postalCode'
  /** Código de país ISO de 2 letras. */
  | 'country'
  /** Código de moneda ISO de 3 letras. */
  | 'currency'
  /** Color hexadecimal #RRGGBB. */
  | 'hexColor'
  /** Código de un solo uso (OTP), solo dígitos. */
  | 'otp'

export type InputMode = 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'text'

export interface FieldRule {
  maxLength: number
  inputMode: InputMode
  /** Deja solo lo que el tipo admite. Idempotente. */
  sanitize?: (value: string) => string
  autoComplete?: string
  /** El valor se guarda en mayúsculas. */
  uppercase?: boolean
}

const digits = (value: string) => value.replace(/\D+/g, '')
const alnumUpper = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '').toUpperCase()

/**
 * Deja un número decimal bien formado mientras se teclea: acepta coma o punto
 * (se guarda punto), un solo separador, `decimals` cifras tras él y, si se
 * permite, un signo menos delante.
 */
export function sanitizeDecimal(value: string, decimals: number, signed = false): string {
  const negative = signed && value.trimStart().startsWith('-')
  let out = value.replace(/,/g, '.').replace(/[^\d.]+/g, '')
  const dot = out.indexOf('.')
  if (dot >= 0) {
    const entera = out.slice(0, dot)
    const fraccion = out.slice(dot + 1).replace(/\./g, '')
    out = decimals > 0 ? `${entera}.${fraccion.slice(0, decimals)}` : entera
  }
  return negative ? `-${out}` : out
}

function sanitizeInteger(value: string, signed = false): string {
  const negative = signed && value.trimStart().startsWith('-')
  const out = digits(value)
  return negative ? `-${out}` : out
}

export const FIELD_RULES: Record<FieldRuleKind, FieldRule> = {
  ruc: { maxLength: 11, inputMode: 'numeric', sanitize: (v) => digits(v).slice(0, 11) },
  dni: { maxLength: 8, inputMode: 'numeric', sanitize: (v) => digits(v).slice(0, 8) },
  ce: { maxLength: 12, inputMode: 'text', sanitize: (v) => alnumUpper(v).slice(0, 12), uppercase: true },
  passport: {
    maxLength: 15,
    inputMode: 'text',
    sanitize: (v) => alnumUpper(v).slice(0, 15),
    uppercase: true,
  },
  document: {
    maxLength: 15,
    inputMode: 'text',
    sanitize: (v) => alnumUpper(v).slice(0, 15),
    uppercase: true,
  },
  phone: {
    maxLength: 20,
    inputMode: 'tel',
    autoComplete: 'tel',
    // Dígitos, un «+» solo al principio, espacios y guiones de lectura.
    sanitize: (v) => {
      const plus = v.trimStart().startsWith('+')
      const rest = v.replace(/[^\d\s\-()]+/g, '').replace(/\s{2,}/g, ' ')
      return (plus ? '+' : '') + rest.trimStart()
    },
  },
  email: {
    maxLength: 254,
    inputMode: 'email',
    autoComplete: 'email',
    sanitize: (v) => v.replace(/\s+/g, ''),
  },
  url: { maxLength: 2048, inputMode: 'url', sanitize: (v) => v.replace(/\s+/g, '') },
  integer: { maxLength: 9, inputMode: 'numeric', sanitize: (v) => sanitizeInteger(v) },
  signedInteger: { maxLength: 10, inputMode: 'text', sanitize: (v) => sanitizeInteger(v, true) },
  decimal: { maxLength: 15, inputMode: 'decimal', sanitize: (v) => sanitizeDecimal(v, 4) },
  signedDecimal: { maxLength: 16, inputMode: 'text', sanitize: (v) => sanitizeDecimal(v, 4, true) },
  money: { maxLength: 15, inputMode: 'decimal', sanitize: (v) => sanitizeDecimal(v, 2) },
  percent: { maxLength: 6, inputMode: 'decimal', sanitize: (v) => sanitizeDecimal(v, 2) },
  code: { maxLength: 40, inputMode: 'text', sanitize: (v) => v.replace(/[^A-Za-z0-9._-]+/g, '') },
  sku: { maxLength: 64, inputMode: 'text', sanitize: (v) => v.replace(/[^A-Za-z0-9._/-]+/g, '') },
  slug: {
    maxLength: 80,
    inputMode: 'text',
    sanitize: (v) =>
      v
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]+/g, ''),
  },
  personName: {
    maxLength: 120,
    inputMode: 'text',
    autoComplete: 'name',
    sanitize: (v) => v.replace(/[^\p{L}\p{M}\s'.-]+/gu, '').replace(/\s{2,}/g, ' '),
  },
  text: { maxLength: 200, inputMode: 'text' },
  longText: { maxLength: 2000, inputMode: 'text' },
  postalCode: {
    maxLength: 10,
    inputMode: 'text',
    sanitize: (v) => v.replace(/[^A-Za-z0-9 -]+/g, '').toUpperCase(),
    uppercase: true,
  },
  country: { maxLength: 2, inputMode: 'text', sanitize: (v) => v.replace(/[^A-Za-z]+/g, '').toUpperCase(), uppercase: true },
  currency: { maxLength: 3, inputMode: 'text', sanitize: (v) => v.replace(/[^A-Za-z]+/g, '').toUpperCase(), uppercase: true },
  hexColor: {
    maxLength: 7,
    inputMode: 'text',
    sanitize: (v) => {
      const hex = v.replace(/[^0-9A-Fa-f]+/g, '').slice(0, 6)
      return `#${hex}`.toUpperCase()
    },
  },
  otp: { maxLength: 6, inputMode: 'numeric', autoComplete: 'one-time-code', sanitize: (v) => digits(v).slice(0, 6) },
}

export function ruleFor(kind: FieldRuleKind, overrides: Partial<FieldRule> = {}): FieldRule {
  return { ...FIELD_RULES[kind], ...overrides }
}

/** Aplica el filtro y el máximo de una regla a un valor ya escrito. */
export function applyRule(rule: FieldRule, value: string): string {
  const clean = rule.sanitize ? rule.sanitize(value) : value
  return clean.length > rule.maxLength ? clean.slice(0, rule.maxLength) : clean
}

// ---------------------------------------------------------------------------
// Documentos de identidad
// ---------------------------------------------------------------------------

/** El número tiene la forma de su tipo (RUC con dígito verificador). */
export function isValidDocument(type: DocType, value: string): boolean {
  if (type === 'ruc') return isValidRuc(value)
  return isValidReceiptId(type, value)
}

/**
 * El tipo más probable de un número ya guardado, para precargar el selector:
 * 11 dígitos es RUC, 8 es DNI, el resto se lee como carné de extranjería.
 */
export function detectDocType(value: string | null | undefined): DocType | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (/^\d{11}$/.test(v)) return 'ruc'
  if (/^\d{8}$/.test(v)) return 'dni'
  if (/^[A-Za-z0-9]{8,12}$/.test(v)) return 'ce'
  return 'passport'
}

// ---------------------------------------------------------------------------
// Zod: la misma regla en el esquema del formulario
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Esquema de un campo de texto según su regla. `message` es la CLAVE de i18n
 * del error; `required` exige al menos un carácter.
 *
 *   name: zRule('personName', 'customers.error.name', { required: true })
 *   ruc:  zRule('ruc', 'customers.error.ruc')          // vacío o RUC válido
 */
export function zRule(
  kind: FieldRuleKind,
  message: string,
  options: { required?: boolean; max?: number; min?: number } = {},
) {
  const max = options.max ?? FIELD_RULES[kind].maxLength
  const base = z.string().trim().max(max, message)
  return base.superRefine((raw, ctx) => {
    if (!raw) {
      if (options.required) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
      return
    }
    if (options.min !== undefined && raw.length < options.min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
      return
    }
    if (!matchesRule(kind, raw)) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  })
}

/** ¿El valor (no vacío) tiene la forma que su regla pide? */
export function matchesRule(kind: FieldRuleKind, value: string): boolean {
  const v = value.trim()
  switch (kind) {
    case 'ruc':
    case 'dni':
    case 'ce':
    case 'passport':
      return isValidDocument(kind, v)
    case 'document':
      return /^[A-Za-z0-9]{6,15}$/.test(v)
    case 'phone':
      return /^\+?[\d\s\-()]{6,20}$/.test(v) && digits(v).length >= 6
    case 'email':
      return EMAIL_RE.test(v)
    case 'url':
      return /^https?:\/\/[^\s]+$/i.test(v)
    case 'integer':
    case 'otp':
      return /^\d+$/.test(v)
    case 'signedInteger':
      return /^-?\d+$/.test(v)
    case 'decimal':
      return /^\d+(\.\d{1,4})?$/.test(v)
    case 'signedDecimal':
      return /^-?\d+(\.\d{1,4})?$/.test(v)
    case 'money':
      return /^\d+(\.\d{1,2})?$/.test(v)
    case 'percent':
      return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100
    case 'code':
      return /^[A-Za-z0-9._-]+$/.test(v)
    case 'sku':
      return /^[A-Za-z0-9._/-]+$/.test(v)
    case 'slug':
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)
    case 'personName':
      return /^[\p{L}\p{M}\s'.-]+$/u.test(v)
    case 'postalCode':
      return /^[A-Za-z0-9 -]{3,10}$/.test(v)
    case 'country':
      return /^[A-Za-z]{2}$/.test(v)
    case 'currency':
      return /^[A-Za-z]{3}$/.test(v)
    case 'hexColor':
      return /^#[0-9A-Fa-f]{6}$/.test(v)
    case 'text':
    case 'longText':
      return true
  }
}

/**
 * Valida un par «tipo de documento + número» en un esquema de objeto. Úsalo en
 * `.superRefine` del objeto:
 *
 *   schema.superRefine(refineDocument('doc_type', 'doc_number', 'customers.error.taxId'))
 */
export function refineDocument<T extends Record<string, unknown>>(
  typeKey: keyof T & string,
  numberKey: keyof T & string,
  message: string,
  options: { required?: boolean } = {},
) {
  return (values: T, ctx: z.RefinementCtx) => {
    const type = values[typeKey] as DocType | '' | null | undefined
    const number = String(values[numberKey] ?? '').trim()
    if (!number) {
      if (options.required) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [numberKey], message })
      return
    }
    if (!type || !DOC_TYPES.includes(type)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [typeKey], message })
      return
    }
    if (!isValidDocument(type, number)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [numberKey], message })
    }
  }
}
