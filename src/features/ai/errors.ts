import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error de la frontera de IA.
 *
 * El catálogo es corto porque aquí casi nada puede salir mal de forma
 * irreversible: se lee un saldo y se deja una opinión. Lo que sí tiene nombre
 * propio es quedarse sin cuota, porque no es un fallo del sistema sino un
 * estado del contrato, y confundirlo con un error genérico manda a la persona a
 * reintentar algo que nunca va a funcionar.
 */
export class AiError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'ai', key, code })
    this.name = 'AiError'
  }
}

export function mapAiCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_CUOTA':
      return 'ai.error.quota'
    case 'NO_CONTRATADO':
      return 'ai.error.notEntitled'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'ai.error.forbidden'
    default:
      return 'ai.error.generic'
  }
}

export function aiErrorFromDb(error: PostgrestLike): AiError {
  const code = codeFromDbError(error)
  return new AiError(mapAiCode(code), code)
}
