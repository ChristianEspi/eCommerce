import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error del Monitor de Integraciones.
 *
 * Dos casos importan y hay que distinguirlos, porque llevan a dos acciones
 * distintas de quien mira:
 *
 *  · `SIN_PERMISO` — la cola y las credenciales las ven `owner` y `admin`. Un
 *    `viewer` tiene que leer «no tienes permiso» y no «no hay mensajes»: lo
 *    segundo le haría creer que sus integraciones van bien.
 *  · `SIN_MODULO` — publicar (credenciales, endpoints, suscripciones) exige el
 *    addon. Es una llamada al comercial, no una incidencia. MIRAR no lo exige:
 *    la observabilidad no se vende, decisión de P13.
 */
export class IntegrationsError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'integrations', key, code })
    this.name = 'IntegrationsError'
  }
}

export function mapIntegrationsCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'integrations.error.forbidden'
    case 'SIN_MODULO':
      return 'integrations.error.noModule'
    case 'MENSAJE_NO_ENCONTRADO':
    case 'ENTREGA_NO_ENCONTRADA':
    case 'CIRCUITO_NO_ENCONTRADO':
    case 'CREDENCIAL_NO_ENCONTRADA':
    case 'FUENTE_NO_ENCONTRADA':
    case 'FLUJO_NO_ENCONTRADO':
    case 'PGRST116':
      return 'integrations.error.notFound'
    case 'MOTIVO_REQUERIDO':
      return 'integrations.error.reasonRequired'
    case 'MENSAJE_YA_ENTREGADO':
      return 'integrations.error.alreadyDelivered'
    case 'MENSAJE_EN_VUELO':
      return 'integrations.error.inFlight'
    case 'ENDPOINT_INACTIVO':
      return 'integrations.error.endpointInactive'
    case 'SCOPES_REQUERIDOS':
    case 'SCOPE_DESCONOCIDO':
      return 'integrations.error.scopes'
    case 'DUPLICADO':
    case '23505':
      return 'integrations.error.duplicate'
    case 'DATOS_INVALIDOS':
    case '23514':
      return 'integrations.error.invalid'
    case 'ALMACEN_NO_ERP':
      return 'integrations.sources.error.warehouseNotErp'
    case 'CONFIG_INCOMPLETA':
      return 'auth.notConfigured'
    default:
      return 'integrations.error.generic'
  }
}

export function integrationsErrorFromDb(error: PostgrestLike): IntegrationsError {
  const code = codeFromDbError(error)
  return new IntegrationsError(mapIntegrationsCode(code), code)
}

export function isForbidden(error: unknown): boolean {
  return (
    error instanceof IntegrationsError &&
    (error.code === 'SIN_PERMISO' || error.code === '42501' || error.code === 'NO_AUTENTICADO')
  )
}

/** «No lo tienes contratado» no es «no tienes permiso»: son dos pantallas. */
export function isMissingModule(error: unknown): boolean {
  return error instanceof IntegrationsError && error.code === 'SIN_MODULO'
}
