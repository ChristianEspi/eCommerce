import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error de inventario con una clave de i18n ya resuelta.
 *
 * Igual que en catálogo, pedidos, precios y clientes: la pantalla nunca ve el
 * `message` de Postgres. Aquí importa especialmente porque los errores del
 * motor llevan dentro nombres de almacén y de restricción, que describen la
 * operación logística del tenant.
 */
export class InventoryError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'inventory', key, code })
    this.name = 'InventoryError'
  }
}

export function mapInventoryCode(code: string): MessageKey {
  switch (code) {
    case 'DUPLICADO':
    case '23505':
      return 'inventory.error.duplicate'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'inventory.error.forbidden'
    case 'MODULO_NO_CONTRATADO':
      return 'inventory.error.notEntitled'
    case 'ALMACEN_NO_ENCONTRADO':
    case 'EXISTENCIA_NO_ENCONTRADA':
    case 'RESERVA_NO_ENCONTRADA':
    case 'TIENDA_NO_DISPONIBLE':
    case 'NO_ENCONTRADO':
    case 'PGRST116':
      return 'inventory.error.notFound'
    case 'RESERVA_NO_VIGENTE':
      return 'inventory.error.reservationStale'
    // «No se sabe» tiene mensaje propio a propósito: decirle al operador que no
    // hay existencia cuando lo que pasa es que el ERP no contesta le hace
    // buscar el problema donde no está.
    case 'DISPONIBILIDAD_DESCONOCIDA':
      return 'inventory.error.unknown'
    case 'STOCK_INSUFICIENTE':
      return 'inventory.error.insufficient'
    // La existencia de la ficha es una sola: cargarla en un segundo almacén la
    // duplicaría y la tienda vendería lo que no hay.
    case 'INVENTARIO_YA_MIGRADO':
      return 'inventory.error.alreadySeeded'
    case 'KIT_SIN_EXISTENCIA':
    case 'KIT_SIN_COMPONENTES':
    case 'KIT_UOM_INVALIDA':
      return 'inventory.error.bundle'
    case 'VARIANTE_REQUERIDA':
    case 'VARIANTE_NO_APLICA':
    case 'VARIANTE_NO_DISPONIBLE':
    case 'PRODUCTO_NO_DISPONIBLE':
      return 'inventory.error.product'
    case 'SIGNO_INCOHERENTE':
      return 'inventory.error.sign'
    case 'MOVIMIENTO_NO_PERMITIDO':
      return 'inventory.error.movementKind'
    case 'ALMACEN_DE_OTRA_SOCIEDAD':
    case 'CANTIDAD_INVALIDA':
    case 'CADUCIDAD_INVALIDA':
    case 'REFERENCIA_INVALIDA':
    case 'CAMPO_INVALIDO':
    case 'DATOS_INVALIDOS':
    case 'ITEMS_REQUERIDOS':
    case '23503':
    case '23514':
      return 'inventory.error.invalid'
    default:
      return 'inventory.error.generic'
  }
}

export function inventoryErrorFromDb(error: PostgrestLike): InventoryError {
  const code = codeFromDbError(error)
  // Un ajuste que deja el físico bajo cero choca con el CHECK de
  // `inventory_levels` (23514). Decir «formato inesperado» no explica nada: lo
  // que pasa es que no hay tanto para sacar.
  if (code === '23514' && /inventory_levels|on_hand/i.test(error?.message ?? '')) {
    return new InventoryError('inventory.error.insufficient', 'STOCK_INSUFICIENTE')
  }
  return new InventoryError(mapInventoryCode(code), code)
}
