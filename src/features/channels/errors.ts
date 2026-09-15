import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error de canales, con su clave de i18n ya resuelta.
 *
 * Las guardas de la base (`ebim.guard_channel_write`, `channel_set_default`)
 * explican POR QUE no se puede: el canal por defecto es por donde entra la
 * vitrina publica. Cada una tiene su texto porque «no se pudo» no le dice al
 * administrador que tiene que elegir otro canal por defecto primero.
 */
export class ChannelError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'catalog', key, code })
    this.name = 'ChannelError'
  }
}

export function mapChannelCode(code: string): MessageKey {
  switch (code) {
    case 'CANAL_POR_DEFECTO_NO_DESACTIVABLE':
      return 'channels.error.defaultInactive'
    case 'CANAL_POR_DEFECTO_PUBLICO':
      return 'channels.error.defaultPublic'
    case 'CANAL_POR_DEFECTO_NO_BORRABLE':
      return 'channels.error.defaultDelete'
    case 'CANAL_DEFECTO_SOLO_POR_FUNCION':
      return 'channels.error.defaultOnlyAction'
    case 'CANAL_INACTIVO':
      return 'channels.error.inactive'
    case 'CANAL_NO_ENCONTRADO':
    case 'NO_ENCONTRADO':
    case 'PGRST116':
      return 'channels.error.notFound'
    case 'DUPLICADO':
    case '23505':
      return 'channels.error.duplicate'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'channels.error.forbidden'
    case 'CANAL_CAMPO_INMUTABLE':
    case 'CAMPO_INVALIDO':
    case '23514':
    case '23503':
    case '22023':
      return 'channels.error.invalid'
    case 'CONFIG_INCOMPLETA':
      return 'auth.notConfigured'
    default:
      return 'channels.error.generic'
  }
}

export function channelErrorFromDb(error: PostgrestLike): ChannelError {
  const code = codeFromDbError(error)
  return new ChannelError(mapChannelCode(code), code)
}