import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  FIELD_RULES,
  applyRule,
  detectDocType,
  matchesRule,
  refineDocument,
  sanitizeDecimal,
  zRule,
} from './fieldRules'

describe('lo que se deja teclear', () => {
  it('un DNI o un RUC solo admiten dígitos y su largo', () => {
    expect(applyRule(FIELD_RULES.dni, '4567-89a12345')).toBe('45678912')
    expect(applyRule(FIELD_RULES.ruc, '20 100 047 2181 999')).toBe('20100047218')
  })

  it('carné y pasaporte: letras y dígitos, en mayúsculas', () => {
    expect(applyRule(FIELD_RULES.ce, 'ab-12 34567890xyz')).toBe('AB1234567890')
    expect(applyRule(FIELD_RULES.passport, 'p 1234567')).toBe('P1234567')
  })

  it('un importe: un solo separador, coma o punto, dos decimales', () => {
    expect(applyRule(FIELD_RULES.money, '1,234.567')).toBe('1.23')
    expect(applyRule(FIELD_RULES.money, 'S/ 99,9')).toBe('99.9')
    expect(sanitizeDecimal('-12.5', 2, true)).toBe('-12.5')
    expect(sanitizeDecimal('-12.5', 2)).toBe('12.5')
  })

  it('un teléfono deja el + inicial, espacios y guiones', () => {
    expect(applyRule(FIELD_RULES.phone, '+51 999-888 777 ext')).toBe('+51 999-888 777 ')
    expect(applyRule(FIELD_RULES.phone, '9a9b9')).toBe('999')
  })

  it('un nombre de persona no admite números', () => {
    expect(applyRule(FIELD_RULES.personName, 'José Pérez 33')).toBe('José Pérez ')
    expect(applyRule(FIELD_RULES.personName, "María O'Neil-Ríos")).toBe("María O'Neil-Ríos")
  })

  it('un código no admite espacios ni símbolos', () => {
    expect(applyRule(FIELD_RULES.code, 'CLI 020/ñ')).toBe('CLI020')
    expect(applyRule(FIELD_RULES.slug, 'Mi Tienda Ñ')).toBe('mi-tienda-')
  })
})

describe('validación', () => {
  it('RUC con dígito verificador', () => {
    expect(matchesRule('ruc', '20100047218')).toBe(true)
    expect(matchesRule('ruc', '20100047219')).toBe(false)
    expect(matchesRule('ruc', '30100047218')).toBe(false)
  })

  it('zRule: vacío pasa si no es obligatorio, mal formado no', () => {
    const schema = zRule('dni', 'field.error.dni')
    expect(schema.safeParse('').success).toBe(true)
    expect(schema.safeParse('12345678').success).toBe(true)
    expect(schema.safeParse('1234567').success).toBe(false)
    expect(zRule('dni', 'x', { required: true }).safeParse('').success).toBe(false)
  })

  it('porcentaje hasta 100', () => {
    expect(matchesRule('percent', '100')).toBe(true)
    expect(matchesRule('percent', '100.01')).toBe(false)
  })

  it('tipo + número de documento en un objeto', () => {
    const schema = z
      .object({ doc_type: z.string(), doc_number: z.string() })
      .superRefine(refineDocument('doc_type', 'doc_number', 'field.error.document'))
    expect(schema.safeParse({ doc_type: 'dni', doc_number: '12345678' }).success).toBe(true)
    expect(schema.safeParse({ doc_type: 'ruc', doc_number: '12345678' }).success).toBe(false)
    expect(schema.safeParse({ doc_type: '', doc_number: '' }).success).toBe(true)
  })

  it('detecta el tipo de un número ya guardado', () => {
    expect(detectDocType('20100047218')).toBe('ruc')
    expect(detectDocType('12345678')).toBe('dni')
    expect(detectDocType('X123')).toBe('passport')
    expect(detectDocType('')).toBeNull()
  })
})
