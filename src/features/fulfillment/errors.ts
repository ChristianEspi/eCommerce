import type { MessageKey } from '@/shared/i18n/messages'
import { UiError, codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'

/**
 * Error logístico con su clave de i18n ya resuelta.
 *
 * La pantalla NUNCA ve el mensaje crudo: los de la base traen dentro nombres de
 * restricción y de tabla, y los del operador traen su vocabulario. El código de
 * resultado del transportista se enseña aparte y a propósito —hace falta para
 * llamarles— pero como dato de una columna, no como texto de error.
 */
export class FulfillmentError extends UiError {
  constructor(key: MessageKey, code: string) {
    super({ boundary: 'fulfillment', key, code })
    this.name = 'FulfillmentError'
  }
}

export function mapFulfillmentCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case 'OPERADOR_NO_ES_ACTOR':
    case '42501':
      return 'fulfillment.error.forbidden'
    case 'MODULO_NO_CONTRATADO':
      return 'fulfillment.error.notEntitled'
    case 'DUPLICADO':
    case '23505':
      return 'fulfillment.error.duplicate'
    case 'ENTREGA_NO_ENCONTRADA':
    case 'ENVIO_NO_ENCONTRADO':
    case 'DEVOLUCION_NO_ENCONTRADA':
    case 'PEDIDO_NO_ENCONTRADO':
    case 'LINEA_NO_ENCONTRADA':
    case 'NO_ENCONTRADO':
    case 'PGRST116':
      return 'fulfillment.error.notFound'
    case 'ENTREGA_TRANSICION_INVALIDA':
    case 'ENVIO_TRANSICION_INVALIDA':
    case 'DEVOLUCION_TRANSICION_INVALIDA':
      return 'fulfillment.error.transition'
    case 'ENTREGA_CANTIDAD_EXCEDIDA':
    case 'ENVIO_CANTIDAD_EXCEDIDA':
    case 'DEVOLUCION_CANTIDAD_EXCEDIDA':
      return 'fulfillment.error.quantity'
    case 'ENTREGA_SIN_LINEAS':
      return 'fulfillment.error.noLines'
    case 'MOTIVO_REQUERIDO':
      return 'fulfillment.error.reasonRequired'
    // P19 · No es un fallo: es la regla de la tienda. Sin mensaje propio caía en
    // «vuelve a intentarlo», que invita a repetir algo que nunca va a pasar.
    case 'PAGO_PENDIENTE':
      return 'fulfillment.error.unpaid'
    case 'MOTIVO_NO_VALIDO':
    case 'LINEAS_NO_VALIDAS':
    case 'DECISION_NO_VALIDA':
    case 'RESOLUCION_NO_VALIDA':
    case 'ESTADO_NO_VALIDO':
    case 'ORIGEN_NO_VALIDO':
      return 'fulfillment.error.invalid'
    case 'DIRECCION_NO_ENTREGABLE':
    case 'FUERA_DE_COBERTURA':
      return 'fulfillment.error.coverage'
    case 'ENTREGA_NO_DISPONIBLE':
    case 'SIN_TARIFA':
    case 'PESO_NO_DECLARADO':
      return 'fulfillment.error.noRate'
    case 'PUNTO_DE_RECOJO_REQUERIDO':
    case 'PUNTO_DE_RECOJO_NO_VALIDO':
    case 'PUNTO_DE_RECOJO_NO_APLICA':
      return 'fulfillment.error.pickup'
    case 'ALMACEN_NO_ENCONTRADO':
    case 'ALMACEN_DE_OTRA_SOCIEDAD':
      return 'fulfillment.error.warehouse'
    case 'ENTREGA_IMPORTE_INMUTABLE':
    case 'DEVOLUCION_IDENTIDAD_INMUTABLE':
    case 'BITACORA_INMUTABLE':
      return 'fulfillment.error.immutable'
    case 'ENTREGA_CERRADA':
    case 'ENVIO_NO_APLICA':
    case 'PEDIDO_CANCELADO':
      return 'fulfillment.error.closed'
    case 'EVIDENCIA_RUTA_INVALIDA':
      return 'fulfillment.error.evidencePath'
    // Recorrido B2B, fase 09. Una prueba de entrega no se edita ni se borra:
    // se corrige con una entrega nueva.
    case 'EVIDENCIA_INMUTABLE':
      return 'fulfillment.error.podImmutable'
    case 'IDEMPOTENCIA_INVALIDA':
      return 'fulfillment.error.idempotency'
    case 'CONFIG_INCOMPLETA':
      return 'auth.notConfigured'
    default:
      return 'fulfillment.error.generic'
  }
}

export function fulfillmentErrorFromDb(error: PostgrestLike): FulfillmentError {
  const code = codeFromDbError(error)
  return new FulfillmentError(mapFulfillmentCode(code), code)
}
