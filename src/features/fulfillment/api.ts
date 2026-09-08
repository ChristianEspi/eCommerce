import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { FulfillmentError, fulfillmentErrorFromDb } from './errors'
import {
  DELIVERY_METHODS_TABLE,
  DELIVERY_RATES_TABLE,
  DELIVERY_ZONES_TABLE,
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
  deliveryMethodSchema,
  deliveryRateSchema,
  deliveryZoneSchema,
  fulfillmentItemSchema,
  fulfillmentSchema,
  orderFactSchema,
  pickupPointSchema,
  returnEventSchema,
  returnItemSchema,
  returnReasonSchema,
  returnSchema,
  shipmentSchema,
  trackingEventSchema,
  type DeliveryMethod,
  type DeliveryRate,
  type DeliveryZone,
  type FulfillmentItem,
  type FulfillmentRow,
  type MethodFormValues,
  type OrderFact,
  type PickupPoint,
  type PickupPointFormValues,
  type RateFormValues,
  type ReturnEvent,
  type ReturnItem,
  type ReturnReason,
  type ReturnRow,
  type ShipmentRow,
  type TrackingEventRow,
  type ZoneFormValues,
} from './types'

/**
 * Acceso a datos del dominio logístico.
 *
 * Tres reglas, y las tres son consecuencia de cómo está construido el dominio:
 *
 *  1. **Ninguna consulta declara el tenant.** Ni un `eq('organization_id', …)`.
 *     La RLS decide, y las quince tablas están en `default deny`.
 *  2. **Nada de aquí mueve una entrega con un `update`.** No hay un solo
 *     `update` sobre `fulfillments`, `shipments` ni `return_requests`: no
 *     existe la policy que lo permitiría. Mover es un `rpc`. Lo que este módulo
 *     escribe directamente son zonas, métodos, tarifas y puntos, que son
 *     configuración.
 *  3. **La clave de idempotencia la pone quien llama.** Va en la firma y no se
 *     genera aquí dentro: si la generara esta función, cada reintento traería
 *     una clave nueva y no protegería de nada — que en un envío significa dos
 *     guías pagadas por el mismo paquete.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new FulfillmentError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

export interface StoreScope {
  organizationId: string
  companyId: string
  storeId: string
}

// ---------------------------------------------------------------------------
// La red de entrega (configuración del comercio)
// ---------------------------------------------------------------------------

const ZONE_SELECT =
  'id, store_id, code, name, country, regions, postal_prefixes, priority, is_active'

export async function fetchZones(storeId: string | null): Promise<DeliveryZone[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(DELIVERY_ZONES_TABLE)
    .select(ZONE_SELECT)
    .eq('store_id', storeId)
    .order('priority', { ascending: true })
    .order('code', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => deliveryZoneSchema.parse(row))
}

/** Texto separado por comas → lista limpia. La base rechaza vacíos y nulos. */
function toList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export async function saveZone(scope: StoreScope, values: ZoneFormValues): Promise<void> {
  const payload = {
    code: values.code.trim().toLowerCase(),
    name: values.name.trim(),
    country: values.country.trim().toUpperCase(),
    regions: toList(values.regions),
    postal_prefixes: toList(values.postalPrefixes),
    priority: values.priority,
    is_active: values.isActive,
  }
  if (values.id) {
    const { error } = await client().from(DELIVERY_ZONES_TABLE).update(payload).eq('id', values.id)
    if (error) throw fulfillmentErrorFromDb(error)
    return
  }
  // El tenant se escribe porque las columnas son NOT NULL, pero sale del
  // contexto derivado del JWT y quien decide si vale es la policy de `insert`.
  const { error } = await client()
    .from(DELIVERY_ZONES_TABLE)
    .insert({
      ...payload,
      organization_id: scope.organizationId,
      company_id: scope.companyId,
      store_id: scope.storeId,
    })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function deleteZone(id: string): Promise<void> {
  const { error } = await client().from(DELIVERY_ZONES_TABLE).delete().eq('id', id)
  if (error) throw fulfillmentErrorFromDb(error)
}

const METHOD_SELECT =
  'id, store_id, code, strategy, display_name, description, provider_code, sourcing, ' +
  'lead_time_min_days, lead_time_max_days, requires_window, is_active, position, instructions'

export async function fetchMethods(storeId: string | null): Promise<DeliveryMethod[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(DELIVERY_METHODS_TABLE)
    .select(METHOD_SELECT)
    .eq('store_id', storeId)
    .order('position', { ascending: true })
    .order('code', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => deliveryMethodSchema.parse(row))
}

export async function saveMethod(scope: StoreScope, values: MethodFormValues): Promise<void> {
  const payload = {
    code: values.code.trim().toLowerCase(),
    display_name: values.displayName.trim(),
    strategy: values.strategy,
    description: values.description.trim() === '' ? null : values.description.trim(),
    // Nadie transporta un recojo ni una descarga: la base lo exige con un CHECK
    // y la pantalla no puede ofrecer una combinación que se va a rechazar.
    provider_code:
      values.strategy === 'ship' && values.providerCode !== '' ? values.providerCode : null,
    sourcing: values.sourcing,
    lead_time_min_days: values.leadTimeMinDays,
    lead_time_max_days: values.leadTimeMaxDays,
    requires_window: values.strategy === 'digital' ? false : values.requiresWindow,
    is_active: values.isActive,
    position: values.position,
    instructions: values.instructions.trim() === '' ? null : values.instructions.trim(),
  }
  if (values.id) {
    const { error } = await client()
      .from(DELIVERY_METHODS_TABLE)
      .update(payload)
      .eq('id', values.id)
    if (error) throw fulfillmentErrorFromDb(error)
    return
  }
  const { error } = await client()
    .from(DELIVERY_METHODS_TABLE)
    .insert({
      ...payload,
      organization_id: scope.organizationId,
      company_id: scope.companyId,
      store_id: scope.storeId,
    })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function deleteMethod(id: string): Promise<void> {
  const { error } = await client().from(DELIVERY_METHODS_TABLE).delete().eq('id', id)
  if (error) throw fulfillmentErrorFromDb(error)
}

const RATE_SELECT =
  'id, delivery_method_id, zone_id, currency, base_amount, per_item_amount, ' +
  'per_weight_amount, free_over_subtotal, min_subtotal, max_subtotal, priority, is_active'

export async function fetchRates(storeId: string | null): Promise<DeliveryRate[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(DELIVERY_RATES_TABLE)
    .select(RATE_SELECT)
    .eq('store_id', storeId)
    .order('priority', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => deliveryRateSchema.parse(row))
}

/** Texto de importe → `numeric` o `null`. Nunca un `number` intermedio. */
function amount(raw: string): string {
  const trimmed = raw.trim()
  return trimmed === '' ? '0' : trimmed
}

export async function saveRate(scope: StoreScope, values: RateFormValues): Promise<void> {
  const payload = {
    delivery_method_id: values.deliveryMethodId,
    zone_id: values.zoneId === '' ? null : values.zoneId,
    currency: values.currency.toUpperCase(),
    base_amount: amount(values.baseAmount),
    per_item_amount: amount(values.perItemAmount),
    per_weight_amount: amount(values.perWeightAmount),
    free_over_subtotal:
      values.freeOverSubtotal.trim() === '' ? null : values.freeOverSubtotal.trim(),
    priority: values.priority,
    is_active: values.isActive,
  }
  if (values.id) {
    const { error } = await client().from(DELIVERY_RATES_TABLE).update(payload).eq('id', values.id)
    if (error) throw fulfillmentErrorFromDb(error)
    return
  }
  const { error } = await client()
    .from(DELIVERY_RATES_TABLE)
    .insert({
      ...payload,
      organization_id: scope.organizationId,
      company_id: scope.companyId,
      store_id: scope.storeId,
    })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function deleteRate(id: string): Promise<void> {
  const { error } = await client().from(DELIVERY_RATES_TABLE).delete().eq('id', id)
  if (error) throw fulfillmentErrorFromDb(error)
}

const POINT_SELECT =
  'id, store_id, code, name, address, zone_id, warehouse_id, contact_phone, is_active, position'

export async function fetchPickupPoints(storeId: string | null): Promise<PickupPoint[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(PICKUP_POINTS_TABLE)
    .select(POINT_SELECT)
    .eq('store_id', storeId)
    .order('position', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => pickupPointSchema.parse(row))
}

export async function savePickupPoint(
  scope: StoreScope,
  values: PickupPointFormValues,
): Promise<void> {
  const payload = {
    code: values.code.trim().toLowerCase(),
    name: values.name.trim(),
    address: { address: values.address.trim() },
    warehouse_id: values.warehouseId === '' ? null : values.warehouseId,
    contact_phone: values.contactPhone.trim() === '' ? null : values.contactPhone.trim(),
    is_active: values.isActive,
    position: values.position,
  }
  if (values.id) {
    const { error } = await client().from(PICKUP_POINTS_TABLE).update(payload).eq('id', values.id)
    if (error) throw fulfillmentErrorFromDb(error)
    return
  }
  const { error } = await client()
    .from(PICKUP_POINTS_TABLE)
    .insert({
      ...payload,
      organization_id: scope.organizationId,
      company_id: scope.companyId,
      store_id: scope.storeId,
    })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function deletePickupPoint(id: string): Promise<void> {
  const { error } = await client().from(PICKUP_POINTS_TABLE).delete().eq('id', id)
  if (error) throw fulfillmentErrorFromDb(error)
}

/** Operadores de logística del catálogo GLOBAL. Códigos, nunca marcas en el código. */
export async function fetchCarriers(): Promise<{ code: string; name: string }[]> {
  const { data, error } = await client()
    .from(INTEGRATION_PROVIDERS_TABLE)
    .select('code, name')
    .eq('kind', 'logistics')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => ({ code: String(row.code), name: String(row.name) }))
}

export async function fetchWarehouses(): Promise<{ id: string; code: string; name: string }[]> {
  const { data, error } = await client()
    .from(WAREHOUSES_TABLE)
    .select('id, code, name')
    .eq('is_active', true)
    .order('priority', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
  }))
}

// ---------------------------------------------------------------------------
// La cola de preparación
// ---------------------------------------------------------------------------

const FULFILLMENT_SELECT =
  'fulfillment_id, order_id, order_number, customer_email, order_status, payment_status, ' +
  'fulfillment_status, ' +
  'sequence, method_code, method_name, strategy, provider_code, state, warehouse_id, ' +
  'warehouse_code, pickup_point_id, pickup_point_name, window_date, window_starts_at, ' +
  'window_ends_at, promised_from, promised_to, currency, shipping_cost, weight, address, ' +
  'contact_name, contact_phone, created_at, delivered_at, unit_count, shipment_count, ' +
  'tracking_number, tracking_url, tracking_event_count, is_late'

export interface QueueFilter {
  storeId: string | null
  state: string
  term: string
}

export async function fetchFulfillments(filter: QueueFilter): Promise<FulfillmentRow[]> {
  if (!filter.storeId) return []
  let query = client()
    .from(FULFILLMENT_OVERVIEW_VIEW)
    .select(FULFILLMENT_SELECT)
    .eq('store_id', filter.storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (filter.state !== '') query = query.eq('state', filter.state)

  const term = filter.term.trim()
  if (term !== '') {
    // Un solo buscador general (regla de suite §8): número de pedido, correo o
    // guía. `%` y `,` se escapan porque `or` los interpreta.
    const safe = term.replace(/[%,()]/g, ' ')
    query = query.or(
      `order_number.ilike.%${safe}%,customer_email.ilike.%${safe}%,tracking_number.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => fulfillmentSchema.parse(row))
}

export async function fetchFulfillmentItems(id: string | null): Promise<FulfillmentItem[]> {
  if (!id) return []
  const { data, error } = await client()
    .from(FULFILLMENT_ITEMS_TABLE)
    .select('id, order_item_id, quantity')
    .eq('fulfillment_id', id)
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => fulfillmentItemSchema.parse(row))
}

export async function fetchShipments(fulfillmentId: string | null): Promise<ShipmentRow[]> {
  if (!fulfillmentId) return []
  const { data, error } = await client()
    .from(SHIPMENTS_TABLE)
    .select(
      'id, provider_code, service_code, state, tracking_number, tracking_url, cost, currency, last_error_code, created_at',
    )
    .eq('fulfillment_id', fulfillmentId)
    .order('created_at', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => shipmentSchema.parse(row))
}

export async function fetchTrackingEvents(
  shipmentIds: readonly string[],
): Promise<TrackingEventRow[]> {
  if (shipmentIds.length === 0) return []
  const { data, error } = await client()
    .from(TRACKING_EVENTS_TABLE)
    // Sin `payload`: el sobre del operador está redactado en la base, pero
    // enseñarlo entero convertiría la pantalla en un visor de integraciones.
    .select(
      'id, shipment_id, external_event_id, status, provider_status, occurred_at, description, location, source, signature_verified',
    )
    .in('shipment_id', [...shipmentIds])
    .order('occurred_at', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => trackingEventSchema.parse(row))
}

/**
 * Los hechos LOGÍSTICOS del pedido, de su línea de tiempo única (P08).
 *
 * Se filtra por prefijo y no se lee la tabla entera: el relato completo del
 * pedido es de la pantalla de pedidos, y repetirlo aquí obligaría a mantener
 * dos vistas del mismo hilo.
 */
export async function fetchOrderFacts(orderId: string | null): Promise<OrderFact[]> {
  if (!orderId) return []
  const { data, error } = await client()
    .from(ORDER_TIMELINE_TABLE)
    .select('id, event_type, from_value, to_value, note, payload, actor_email, created_at')
    .eq('order_id', orderId)
    .or('event_type.like.fulfillment.*,event_type.like.shipment.*,event_type.like.return.*')
    .order('created_at', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => orderFactSchema.parse(row))
}

export interface FulfillmentCreateInput {
  orderId: string
  methodCode: string
  pickupPointId: string | null
}

export async function createFulfillment(input: FulfillmentCreateInput): Promise<void> {
  const { error } = await client().rpc(FULFILLMENT_CREATE_RPC, {
    p_order_id: input.orderId,
    p_method_code: input.methodCode,
    p_lines: null,
    p_pickup_point_id: input.pickupPointId,
    p_window: null,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function transitionFulfillment(input: {
  fulfillmentId: string
  to: string
  reason: string
}): Promise<void> {
  const { error } = await client().rpc(FULFILLMENT_TRANSITION_RPC, {
    p_fulfillment_id: input.fulfillmentId,
    p_to: input.to,
    p_reason: input.reason.trim() === '' ? null : input.reason.trim(),
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function assignFulfillment(input: {
  fulfillmentId: string
  warehouseId: string | null
}): Promise<void> {
  const { error } = await client().rpc(FULFILLMENT_ASSIGN_RPC, {
    p_fulfillment_id: input.fulfillmentId,
    p_warehouse_id: input.warehouseId,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function openShipment(input: {
  fulfillmentId: string
  idempotencyKey: string
  serviceCode: string
}): Promise<void> {
  const { error } = await client().rpc(SHIPMENT_OPEN_RPC, {
    p_fulfillment_id: input.fulfillmentId,
    p_idempotency_key: input.idempotencyKey,
    p_service_code: input.serviceCode.trim() === '' ? null : input.serviceCode.trim(),
    p_lines: null,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function noteTracking(input: {
  shipmentId: string
  status: string
  description: string
}): Promise<void> {
  const { error } = await client().rpc(SHIPMENT_TRACK_NOTE_RPC, {
    p_shipment_id: input.shipmentId,
    p_status: input.status,
    p_description: input.description.trim() === '' ? null : input.description.trim(),
    p_occurred_at: null,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Devoluciones
// ---------------------------------------------------------------------------

const RETURN_SELECT =
  'return_request_id, order_id, order_number, rma_number, state, resolution, source, ' +
  'reason_code, reason_label, customer_email, customer_note, decision_note, decided_at, ' +
  'decided_email, currency, refund_amount, created_at, unit_count, received_count, ' +
  'restocked_count, evidence_count'

export async function fetchReturns(filter: QueueFilter): Promise<ReturnRow[]> {
  if (!filter.storeId) return []
  let query = client()
    .from(RETURN_OVERVIEW_VIEW)
    .select(RETURN_SELECT)
    .eq('store_id', filter.storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (filter.state !== '') query = query.eq('state', filter.state)

  const term = filter.term.trim()
  if (term !== '') {
    const safe = term.replace(/[%,()]/g, ' ')
    query = query.or(
      `rma_number.ilike.%${safe}%,order_number.ilike.%${safe}%,customer_email.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => returnSchema.parse(row))
}

export async function fetchReturnItems(id: string | null): Promise<ReturnItem[]> {
  if (!id) return []
  const { data, error } = await client()
    .from(RETURN_ITEMS_TABLE)
    .select(
      'id, order_item_id, quantity, received_quantity, reason_code, condition, restock, refund_amount, restock_movement_id',
    )
    .eq('return_request_id', id)
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => returnItemSchema.parse(row))
}

export async function fetchReturnEvents(id: string | null): Promise<ReturnEvent[]> {
  if (!id) return []
  const { data, error } = await client()
    .from(RETURN_EVENTS_TABLE)
    .select('id, event_type, from_state, to_state, note, actor_email, created_at')
    .eq('return_request_id', id)
    .order('created_at', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => returnEventSchema.parse(row))
}

export async function fetchReturnReasons(storeId: string | null): Promise<ReturnReason[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(RETURN_REASONS_TABLE)
    .select('id, store_id, code, label, requires_evidence, restock_default, is_active, position')
    .eq('store_id', storeId)
    .order('position', { ascending: true })
  if (error) throw fulfillmentErrorFromDb(error)
  return (data ?? []).map((row) => returnReasonSchema.parse(row))
}

export async function decideReturn(input: {
  returnId: string
  decision: 'approve' | 'reject'
  note: string
}): Promise<void> {
  const { error } = await client().rpc(RETURN_DECIDE_RPC, {
    p_return_id: input.returnId,
    p_decision: input.decision,
    p_note: input.note.trim() === '' ? null : input.note.trim(),
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function receiveReturn(returnId: string): Promise<void> {
  const { error } = await client().rpc(RETURN_RECEIVE_RPC, {
    p_return_id: returnId,
    p_items: null,
    p_note: null,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export interface InspectLine {
  return_item_id: string
  condition: string
  restock: boolean
  refund_amount: string
}

export async function inspectReturn(input: {
  returnId: string
  lines: readonly InspectLine[]
  refundAmount: string | null
}): Promise<void> {
  const { error } = await client().rpc(RETURN_INSPECT_RPC, {
    p_return_id: input.returnId,
    p_items: input.lines,
    // `null` = que lo sume la base. La suma es un DEFECTO razonable, no la
    // autoridad: hay portes no reembolsables y acuerdos.
    p_refund_amount: input.refundAmount,
    p_note: null,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function completeReturn(input: {
  returnId: string
  resolution: string
}): Promise<void> {
  const { error } = await client().rpc(RETURN_COMPLETE_RPC, {
    p_return_id: input.returnId,
    p_resolution: input.resolution,
    p_note: null,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}

export async function cancelReturn(input: { returnId: string; reason: string }): Promise<void> {
  const { error } = await client().rpc(RETURN_CANCEL_RPC, {
    p_return_id: input.returnId,
    p_reason: input.reason,
  })
  if (error) throw fulfillmentErrorFromDb(error)
}
