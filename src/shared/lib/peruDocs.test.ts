import { describe, expect, it } from 'vitest'
import { isValidReceiptId, isValidRuc } from './peruDocs'

describe('documentos del comprobante', () => {
  it('RUC: once dígitos, prefijo de contribuyente y dígito verificador', () => {
    // RUC públicos conocidos (SUNAT y una persona natural de ejemplo).
    expect(isValidRuc('20131312955')).toBe(true)
    expect(isValidRuc('20100047218')).toBe(true)
    expect(isValidRuc('20131312954')).toBe(false) // verificador mal
    expect(isValidRuc('2013131295')).toBe(false) // 10 dígitos
    expect(isValidRuc('30131312955')).toBe(false) // prefijo inexistente
    expect(isValidRuc('12345678')).toBe(false) // un DNI no es un RUC
  })

  it('boleta: DNI de 8 dígitos; CE y pasaporte alfanuméricos', () => {
    expect(isValidReceiptId('dni', '45781236')).toBe(true)
    expect(isValidReceiptId('dni', '4578123')).toBe(false)
    expect(isValidReceiptId('dni', '4578123A')).toBe(false)
    expect(isValidReceiptId('ce', '001234567')).toBe(true)
    expect(isValidReceiptId('passport', 'AB123456')).toBe(true)
    expect(isValidReceiptId('passport', 'AB 12')).toBe(false)
  })
})
