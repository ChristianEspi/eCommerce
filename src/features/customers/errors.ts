import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error del dominio de clientes con una clave de i18n ya resuelta.
 *
 * La pantalla nunca ve el `message` de Postgres. Aquí importa especialmente:
 * los errores de estas tablas llevan dentro nombres de restricción que
 * describen la estructura comercial del tenant y, peor, el texto de la fila
 * puede contener datos personales del comprador.
 */
export class CustomersError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'customers', key, code })
    this.name = 'CustomersError'
  }
}

export function mapCustomersCode(code: string): MessageKey {
  switch (code) {
    /**
     * El caso más común al vincular a alguien, y el que más caro sale callar.
     *
     * Vincular exige que esa persona YA tenga cuenta: la identidad es de la
     * plataforma y esta pantalla solo le da acceso a una cuenta de empresa. Sin
     * este caso, el intento respondía «No pudimos completar la operación», que
     * no dice qué hacer.
     *
     * Y decirlo tampoco bastaba: no hay pantalla de registro a la que mandar a
     * nadie, así que el aviso era una pared. Ahora el panel acompaña este
     * código con el botón que crea la cuenta ahí mismo.
     */
    case 'SIN_CUENTA':
      return 'customers.error.noAccount'
    case 'CORREO_DE_SUITE':
      return 'customers.error.suiteEmail'
    case 'CORREO_INVALIDO':
      return 'customers.error.email'
    case 'DUPLICADO':
    case '23505':
      return 'customers.error.duplicate'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'customers.error.forbidden'
    case 'CLIENTE_NO_ENCONTRADO':
    case 'CUENTA_NO_ENCONTRADA':
    case 'NO_ENCONTRADO':
    case 'PGRST116':
      return 'customers.error.notFound'
    case 'MONTO_INVALIDO':
    case 'CAMPO_INVALIDO':
    case 'DATOS_INVALIDOS':
    case '23503':
    case '23514':
      return 'customers.error.invalid'
    default:
      return 'customers.error.generic'
  }
}

export function customersErrorFromDb(error: PostgrestLike): CustomersError {
  const code = codeFromDbError(error)
  return new CustomersError(mapCustomersCode(code), code)
}
