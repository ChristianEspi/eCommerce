import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error de crédito y cobranza, con su clave de i18n ya resuelta.
 *
 * Los tres códigos que el dominio lanza a propósito —cobrar de más, tocar un
 * comprobante emitido, tocar uno aceptado— SÍ se traducen a una frase: describen
 * algo que quien está delante puede entender y arreglar. El resto se degrada,
 * porque los nombres de restricción de estas tablas describen la política de
 * crédito del tenant.
 */
export class CreditError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'credit', key, code })
    this.name = 'CreditError'
  }
}

export function mapCreditCode(code: string): MessageKey {
  switch (code) {
    case 'COBRO_EXCEDE_DEUDA':
      return 'credit.error.overpay'
    case 'COMPROBANTE_EMITIDO':
      return 'credit.error.issued'
    case 'COMPROBANTE_ACEPTADO':
      return 'credit.error.accepted'
    case 'COMPROBANTE_SIN_LINEAS':
      return 'credit.error.noLines'
    case 'COMPROBANTE_DESCUADRADO':
      return 'credit.error.unbalanced'
    case 'COMPROBANTE_NO_EMITIBLE':
      return 'credit.error.notIssuable'
    case 'COMPROBANTE_NO_ENCONTRADO':
      return 'credit.error.notFound'
    case 'DUPLICADO':
    case '23505':
      return 'credit.error.duplicate'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'credit.error.forbidden'
    case 'MODULO_NO_CONTRATADO':
      return 'credit.error.notEntitled'
    case 'NO_ENCONTRADO':
    case 'PGRST116':
      return 'credit.error.notFound'
    case 'CAMPO_INVALIDO':
    case 'DATOS_INVALIDOS':
    case '23503':
    case '23514':
      return 'credit.error.invalid'
    default:
      return 'credit.error.generic'
  }
}

export function creditErrorFromDb(error: PostgrestLike): CreditError {
  const code = codeFromDbError(error)
  return new CreditError(mapCreditCode(code), code)
}
