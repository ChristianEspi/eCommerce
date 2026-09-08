import { z } from 'zod'

/**
 * Tipos y esquemas del dominio logístico en el backoffice.
 *
 * Tres reglas propias de esta pantalla, y las tres vienen de la fase:
 *
 *  1. **Los importes son TEXTO.** Vienen como `numeric` de Postgres y se
 *     formatean, nunca se suman aquí. Un coste de envío recalculado en el
 *     navegador es un segundo número que puede discrepar del que se cobró.
 *  2. **Aquí no se decide ninguna tarifa.** La pantalla enseña lo que costó y
 *     configura los renglones; cuánto cuesta una entrega concreta lo resuelve
 *     `ebim.delivery_options` en el servidor, siempre.
 *  3. **Ninguna marca de transportista.** El operador es el `code` de una fila
 *     de `integration_providers`, igual que la pasarela en P09.
 */

// Los nombres de persistencia viven en `db-schema.ts` y se reexportan aquí,
// igual que hacen catálogo, precios, inventario y pagos: dos copias de un
// nombre de tabla no se separan el día que se escriben, se separan el día que
// una de las dos cambia.
export {
  DELIVERY_METHODS_TABLE,
  DELIVERY_OPTIONS_ORDER_RPC,
  DELIVERY_RATES_TABLE,
  DELIVERY_ZONES_TABLE,
  FULFILLMENTS_TABLE,
  FULFILLMENT_ASSIGN_RPC,
  FULFILLMENT_CREATE_RPC,
  FULFILLMENT_ITEMS_TABLE,
  FULFILLMENT_OVERVIEW_VIEW,
  FULFILLMENT_TRANSITION_RPC,
  INTEGRATION_PROVIDERS_TABLE,
  ORDER_TIMELINE_TABLE,
  PICKUP_POINTS_TABLE,
  RETURN_CANCEL_RPC,
  RETURN_COMPLETE_RPC,
  RETURN_DECIDE_RPC,
  RETURN_EVENTS_TABLE,
  RETURN_INSPECT_RPC,
  RETURN_ITEMS_TABLE,
  RETURN_OVERVIEW_VIEW,
  RETURN_REASONS_TABLE,
  RETURN_RECEIVE_RPC,
  SHIPMENTS_TABLE,
  SHIPMENT_OPEN_RPC,
  SHIPMENT_TRACK_NOTE_RPC,
  TRACKING_EVENTS_TABLE,
  WAREHOUSES_TABLE,
} from '@/shared/lib/db-schema'

// ---------------------------------------------------------------------------
// Vocabularios. Copias de los enums de Postgres: de ellos cuelgan las máquinas
// de estado de la pantalla, así que al menos no pueden desviarse en silencio.
// ---------------------------------------------------------------------------
export const DELIVERY_STRATEGIES = ['ship', 'pickup', 'local_delivery', 'digital'] as const
export type DeliveryStrategy = (typeof DELIVERY_STRATEGIES)[number]

export const SOURCING_STRATEGIES = ['store_priority', 'single_warehouse_atp'] as const
export type SourcingStrategy = (typeof SOURCING_STRATEGIES)[number]

export const FULFILLMENT_STATES = [
  'pending',
  'allocated',
  'picking',
  'packed',
  'ready',
  'in_transit',
  'delivered',
  'failed',
  'cancelled',
] as const
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number]

export const SHIPMENT_STATES = [
  'draft',
  'created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned',
  'cancelled',
] as const
export type ShipmentState = (typeof SHIPMENT_STATES)[number]

export const TRACKING_STATUSES = [
  'label_created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivery_attempted',
  'delivered',
  'exception',
  'returned',
  'cancelled',
  'info',
] as const
export type TrackingStatus = (typeof TRACKING_STATUSES)[number]

export const RETURN_STATES = [
  'requested',
  'approved',
  'rejected',
  'in_transit',
  'received',
  'inspected',
  'completed',
  'cancelled',
] as const
export type ReturnState = (typeof RETURN_STATES)[number]

export const RETURN_RESOLUTIONS = ['refund', 'exchange', 'store_credit', 'repair'] as const
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number]

export const RETURN_CONDITIONS = ['pending', 'sellable', 'damaged', 'used', 'missing'] as const
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number]

/**
 * Las transiciones que la pantalla OFRECE, copia de `ebim.fulfillment_allowed_next`.
 *
 * Es una comodidad, no una autoridad: quien decide es el trigger de la base, y
 * un botón de más aquí produce un error de dominio, no un salto ilegal. Existe
 * para no ofrecer acciones que se sabe que van a fallar.
 */
/**
 * El paso que toca AHORA, uno solo, por estado y por estrategia.
 *
 * `FULFILLMENT_NEXT` dice qué es legal; esto dice qué es lo normal. Son cosas
 * distintas y la pantalla necesitaba las dos: obligar a elegir entre seis
 * destinos legales para hacer lo único que se hace el 95 % de las veces
 * convertía «vino y se lo llevó» en cuatro clics y un desplegable.
 *
 * La bifurcación está en `ready`, y es real: una entrega que ya está lista o
 * sale a la calle (`in_transit`) o se la lleva el cliente del mostrador
 * (`delivered`). Quien lo sabe es la ESTRATEGIA del método, no el operador.
 *
 * Devuelve `null` en los estados terminales y en `failed`, donde no hay un paso
 * obvio: una incidencia se resuelve mirándola, no avanzándola a ciegas.
 */
export function siguientePaso(
  state: FulfillmentState,
  strategy: DeliveryStrategy,
): FulfillmentState | null {
  if (state === 'pending') return 'allocated'
  if (state === 'allocated') return 'picking'
  if (state === 'picking') return 'packed'
  if (state === 'packed') return 'ready'
  if (state === 'ready') {
    return strategy === 'ship' || strategy === 'local_delivery' ? 'in_transit' : 'delivered'
  }
  if (state === 'in_transit') return 'delivered'
  return null
}

export const FULFILLMENT_NEXT: Record<FulfillmentState, readonly FulfillmentState[]> = {
  pending: ['allocated', 'cancelled'],
  allocated: ['picking', 'packed', 'ready', 'in_transit', 'cancelled', 'failed'],
  picking: ['packed', 'ready', 'in_transit', 'cancelled', 'failed'],
  packed: ['ready', 'in_transit', 'cancelled', 'failed'],
  ready: ['in_transit', 'delivered', 'cancelled', 'failed'],
  in_transit: ['delivered', 'failed', 'cancelled'],
  failed: ['in_transit', 'ready', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

// ---------------------------------------------------------------------------
// Esquemas de lectura
// ---------------------------------------------------------------------------
export const deliveryZoneSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code: z.string(),
  name: z.string(),
  country: z.string(),
  regions: z.array(z.string()).default([]),
  postal_prefixes: z.array(z.string()).default([]),
  priority: z.number(),
  is_active: z.boolean(),
})
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>

export const deliveryMethodSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code: z.string(),
  strategy: z.enum(DELIVERY_STRATEGIES),
  display_name: z.string(),
  description: z.string().nullable(),
  provider_code: z.string().nullable(),
  sourcing: z.enum(SOURCING_STRATEGIES),
  lead_time_min_days: z.number(),
  lead_time_max_days: z.number(),
  requires_window: z.boolean(),
  is_active: z.boolean(),
  position: z.number(),
  instructions: z.string().nullable(),
})
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>

export const deliveryRateSchema = z.object({
  id: z.string(),
  delivery_method_id: z.string(),
  zone_id: z.string().nullable(),
  currency: z.string(),
  base_amount: z.coerce.string(),
  per_item_amount: z.coerce.string(),
  per_weight_amount: z.coerce.string(),
  free_over_subtotal: z.coerce.string().nullable(),
  min_subtotal: z.coerce.string().nullable(),
  max_subtotal: z.coerce.string().nullable(),
  priority: z.number(),
  is_active: z.boolean(),
})
export type DeliveryRate = z.infer<typeof deliveryRateSchema>

export const pickupPointSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code: z.string(),
  name: z.string(),
  address: z.record(z.unknown()).default({}),
  zone_id: z.string().nullable(),
  warehouse_id: z.string().nullable(),
  contact_phone: z.string().nullable(),
  is_active: z.boolean(),
  position: z.number(),
})
export type PickupPoint = z.infer<typeof pickupPointSchema>

export const fulfillmentSchema = z.object({
  fulfillment_id: z.string(),
  order_id: z.string(),
  order_number: z.string(),
  customer_email: z.string().nullable(),
  order_status: z.string(),
  /**
   * El estado del PAGO, que la vista ya devolvía y esta pantalla ignoraba.
   *
   * Quien prepara un recojo entrega mercancía en mano: no verlo aquí obliga a
   * abrir otra pantalla o a fiarse. Es la única columna del pedido que cambia
   * lo que la persona hace con el paquete.
   */
  payment_status: z.string(),
  fulfillment_status: z.string(),
  sequence: z.number(),
  method_code: z.string(),
  method_name: z.string(),
  strategy: z.enum(DELIVERY_STRATEGIES),
  provider_code: z.string().nullable(),
  state: z.enum(FULFILLMENT_STATES),
  warehouse_id: z.string().nullable(),
  warehouse_code: z.string().nullable(),
  pickup_point_id: z.string().nullable(),
  pickup_point_name: z.string().nullable(),
  window_date: z.string().nullable(),
  window_starts_at: z.string().nullable(),
  window_ends_at: z.string().nullable(),
  promised_from: z.string().nullable(),
  promised_to: z.string().nullable(),
  currency: z.string(),
  shipping_cost: z.coerce.string(),
  weight: z.coerce.string().nullable(),
  address: z.record(z.unknown()).default({}),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  created_at: z.string(),
  delivered_at: z.string().nullable(),
  unit_count: z.coerce.number(),
  shipment_count: z.coerce.number(),
  tracking_number: z.string().nullable(),
  tracking_url: z.string().nullable(),
  tracking_event_count: z.coerce.number(),
  is_late: z.boolean(),
})
export type FulfillmentRow = z.infer<typeof fulfillmentSchema>

export const fulfillmentItemSchema = z.object({
  id: z.string(),
  order_item_id: z.string(),
  quantity: z.number(),
})
export type FulfillmentItem = z.infer<typeof fulfillmentItemSchema>

export const shipmentSchema = z.object({
  id: z.string(),
  provider_code: z.string().nullable(),
  service_code: z.string().nullable(),
  state: z.enum(SHIPMENT_STATES),
  tracking_number: z.string().nullable(),
  tracking_url: z.string().nullable(),
  cost: z.coerce.string().nullable(),
  currency: z.string().nullable(),
  last_error_code: z.string().nullable(),
  created_at: z.string(),
})
export type ShipmentRow = z.infer<typeof shipmentSchema>

export const trackingEventSchema = z.object({
  id: z.string(),
  shipment_id: z.string(),
  external_event_id: z.string(),
  status: z.enum(TRACKING_STATUSES),
  provider_status: z.string().nullable(),
  occurred_at: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  source: z.string(),
  signature_verified: z.boolean(),
})
export type TrackingEventRow = z.infer<typeof trackingEventSchema>

export const returnSchema = z.object({
  return_request_id: z.string(),
  order_id: z.string(),
  order_number: z.string(),
  rma_number: z.string(),
  state: z.enum(RETURN_STATES),
  resolution: z.enum(RETURN_RESOLUTIONS),
  source: z.string(),
  reason_code: z.string(),
  reason_label: z.string(),
  customer_email: z.string(),
  customer_note: z.string().nullable(),
  decision_note: z.string().nullable(),
  decided_at: z.string().nullable(),
  decided_email: z.string().nullable(),
  currency: z.string(),
  refund_amount: z.coerce.string(),
  created_at: z.string(),
  unit_count: z.coerce.number(),
  received_count: z.coerce.number(),
  restocked_count: z.coerce.number(),
  evidence_count: z.coerce.number(),
})
export type ReturnRow = z.infer<typeof returnSchema>

export const returnItemSchema = z.object({
  id: z.string(),
  order_item_id: z.string(),
  quantity: z.number(),
  received_quantity: z.number(),
  reason_code: z.string(),
  condition: z.enum(RETURN_CONDITIONS),
  restock: z.boolean(),
  refund_amount: z.coerce.string(),
  restock_movement_id: z.string().nullable(),
})
export type ReturnItem = z.infer<typeof returnItemSchema>

export const returnEventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  from_state: z.string().nullable(),
  to_state: z.string().nullable(),
  note: z.string().nullable(),
  actor_email: z.string().nullable(),
  created_at: z.string(),
})
export type ReturnEvent = z.infer<typeof returnEventSchema>

export const returnReasonSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  code: z.string(),
  label: z.string(),
  requires_evidence: z.boolean(),
  restock_default: z.boolean(),
  is_active: z.boolean(),
  position: z.number(),
})
export type ReturnReason = z.infer<typeof returnReasonSchema>

/** Un hecho de la línea de tiempo del pedido, filtrado a lo logístico. */
export const orderFactSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  from_value: z.string().nullable(),
  to_value: z.string().nullable(),
  note: z.string().nullable(),
  payload: z.record(z.unknown()).default({}),
  actor_email: z.string().nullable(),
  created_at: z.string(),
})
export type OrderFact = z.infer<typeof orderFactSchema>

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------
export interface ZoneFormValues {
  id?: string
  code: string
  name: string
  country: string
  /** Texto separado por comas. Se parte al guardar; la base valida la forma. */
  regions: string
  postalPrefixes: string
  priority: number
  isActive: boolean
}

export interface MethodFormValues {
  id?: string
  code: string
  displayName: string
  strategy: DeliveryStrategy
  description: string
  providerCode: string
  sourcing: SourcingStrategy
  leadTimeMinDays: number
  leadTimeMaxDays: number
  requiresWindow: boolean
  isActive: boolean
  position: number
  instructions: string
}

export interface RateFormValues {
  id?: string
  deliveryMethodId: string
  zoneId: string
  currency: string
  baseAmount: string
  perItemAmount: string
  perWeightAmount: string
  freeOverSubtotal: string
  priority: number
  isActive: boolean
}

export interface PickupPointFormValues {
  id?: string
  code: string
  name: string
  address: string
  warehouseId: string
  contactPhone: string
  isActive: boolean
  position: number
}

/**
 * Clave de idempotencia de un envío.
 *
 * La genera el navegador —igual que la del checkout y la de una devolución de
 * pago— porque tiene que sobrevivir a que el operador pulse dos veces o se le
 * corte la red a media respuesta. No identifica a nadie y no autoriza nada:
 * solo ancla la petición, y es lo que impide pagar dos guías por el mismo
 * paquete. El formato coincide con `shipments_idem_fmt` (8 a 200 caracteres).
 */
export function newIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2).padEnd(24, '0')
  return `${prefix}-${random}`.slice(0, 200)
}
