import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error de la administración de tiendas con su clave de i18n ya resuelta.
 *
 * Cada código de `create_store`/`update_store`/`set_store_status` tiene texto
 * propio: «esa dirección ya la usa otra tienda» y «no tienes permiso» se
 * corrigen de maneras distintas, y un «no se pudo» genérico no dice cuál.
 */
export class StoreAdminError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'tenancy', key, code })
    this.name = 'StoreAdminError'
  }
}

export function mapStoreCode(code: string): MessageKey {
  switch (code) {
    case 'TIENDA_SLUG_DUPLICADO':
      return 'storesAdmin.error.slugTaken'
    case 'TIENDA_DOMINIO_DUPLICADO':
      return 'storesAdmin.error.domainTaken'
    case 'TIENDA_SLUG_INVALIDO':
      return 'storesAdmin.error.slugFormat'
    case 'TIENDA_DOMINIO_INVALIDO':
      return 'storesAdmin.error.domainFormat'
    case 'TIENDA_NOMBRE_INVALIDO':
      return 'storesAdmin.error.nameRequired'
    case 'MONEDA_NO_ADMITIDA':
      return 'storesAdmin.error.currency'
    case 'TIENDA_MONEDA_EN_USO':
      return 'storesAdmin.error.currencyInUse'
    case 'MODULO_NO_CONTRATADO':
      return 'storesAdmin.error.domainModule'
    case 'TIENDA_NO_ENCONTRADA':
      return 'storesAdmin.error.notFound'
    case 'TIENDA_FUERA_DE_SOCIEDAD_ACTIVA':
    case 'SIN_CONTEXTO':
      return 'storesAdmin.error.otherCompany'
    case 'TIENDA_ESTADO_INVALIDO':
      return 'storesAdmin.error.status'
    case 'TENANT_NO_ACTIVO':
      return 'storesAdmin.error.tenantInactive'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case 'OPERADOR_NO_ES_ACTOR':
    case 'TIENDA_TENANT_INMUTABLE':
    case '42501':
      return 'storesAdmin.error.forbidden'
    case 'CONFIG_INCOMPLETA':
      return 'auth.notConfigured'
    default:
      return 'storesAdmin.error.generic'
  }
}

export function storeErrorFromDb(error: PostgrestLike): StoreAdminError {
  const code = codeFromDbError(error)
  return new StoreAdminError(mapStoreCode(code), code)
}
