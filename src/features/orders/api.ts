import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ORDER_APPROVAL_DECIDE_RPC,
  ORDER_TRANSITION_RPC,
  UPDATE_ORDER_STATUS_FUNCTION,
} from '@/shared/lib/db-schema'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { OrderError, orderErrorFromDb, orderErrorFromInvoke } from './errors'
import {
  ORDERS_PAGE_SIZE,
  ORDERS_TABLE,
  ORDER_EXTERNAL_REFS_TABLE,
  ORDER_ITEMS_TABLE,
  ORDER_NOTES_TABLE,
  ORDER_TAGS_TABLE,
  ORDER_TIMELINE_TABLE,
  normalizeTag,
  orderEventSchema,
  orderExternalRefSchema,
  orderItemSchema,
  orderNoteSchema,
  orderSchema,
  orderTagSchema,
  rangeStart,
  type Order,
  type OrderAxis,
  type OrderEvent,
  type OrderExternalRef,
  type OrderItem,
  type OrderNote,
  type OrderStatus,
  type OrderTag,
  type OrdersFilter,
  type OrdersPage,
} from './types'

/**
 * Acceso a datos de pedidos.
 *
 * Tres reglas gobiernan este archivo:
 *
 *  1. **Leer es una consulta bajo RLS; ESCRIBIR un estado no.** Ningún eje se
 *     mueve con un `update`. `status` pasa por la Edge Function
 *     `update-order-status` (encargo P07) y los tres ejes de P08 por el comando
 *     `public.order_transition`, que además de la máquina de estados escribe la
 *     línea de tiempo y publica el hecho de dominio. Aquí no existe ni un
 *     `.from('orders').update(...)`, y hay un test que lo comprueba sobre el
 *     código: la autoridad vive en un solo sitio.
 *  2. **Ninguna consulta lleva filtro de tenant.** `store_id` se filtra por
 *     alcance de pantalla, no por seguridad: el aislamiento lo pone la RLS con
 *     los claims del JWT.
 *  3. **La paginación la hace el servidor.** `range()` + `count: 'exact'`. Un
 *     `slice` del navegador sobre «los últimos mil» es una consulta que crece
 *     con el negocio del cliente hasta que un día no vuelve.
 */

export { UPDATE_ORDER_STATUS_FUNCTION }

/** `::text` en todo el dinero: el céntimo no pasa por el float del navegador. */
const ORDER_SELECT = [
  'id',
  'organization_id',
  'company_id',
  'store_id',
  'order_number',
  'customer_name',
  'customer_email',
  'customer_phone',
  'status',
  'payment_status',
  'fulfillment_status',
  'approval_status',
  'source_channel',
  'currency',
  'subtotal::text',
  'tax_total::text',
  'shipping_total::text',
  'discount_total::text',
  'grand_total::text',
  'tax_inclusive',
  'shipping_address',
  'billing_address',
  'customer_snapshot',
  // N05 · orden de compra del comprador B2B.
  'purchase_order_number',
  'approval_reason',
  'approval_decided_email',
  'approval_decided_at',
  'notes',
  'placed_at',
  'updated_at',
].join(', ')

const ITEM_SELECT = [
  'id',
  'order_id',
  'product_id',
  'sku',
  'name',
  'variant_label',
  'uom_code',
  'unit_price::text',
  'quantity',
  'line_total::text',
  'discount_amount::text',
  'tax_rate::text',
  'tax_amount::text',
  'tax_category_code',
  'price_source',
  'price_list_code',
].join(', ')

const EVENT_SELECT =
  'id, order_id, event_type, axis, from_value, to_value, note, payload, source, actor_email, created_at'

const NOTE_SELECT = 'id, order_id, body, author_email, created_at'
const TAG_SELECT = 'id, order_id, tag'
const EXTERNAL_REF_SELECT = 'id, order_id, system_code, ref_type, external_id, external_url'

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new OrderError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

/**
 * Consulta base del listado, con los filtros de pantalla ya aplicados.
 *
 * Vive aparte porque la usan DOS llamantes con necesidades distintas —la tabla
 * paginada y la exportación, que se lleva todo lo filtrado— y tenerla escrita
 * dos veces es la forma más barata de que un día exporten cosas distintas de
 * las que se ven.
 */
function filteredQuery(filter: OrdersFilter, options: { count: boolean }) {
  let query = client()
    .from(ORDERS_TABLE)
    .select(ORDER_SELECT, options.count ? { count: 'exact' } : undefined)
    .eq('store_id', filter.storeId as string)
    // Orden TOTAL: sin el desempate por `id`, dos pedidos del mismo instante se
    // reparten mal entre páginas y el operador ve uno dos veces y otro ninguna.
    .order('placed_at', { ascending: false })
    .order('id', { ascending: false })

  // `awaiting_approval` no es un `status`: es la cola de lo que espera firma.
  if (filter.status === 'awaiting_approval') {
    query = query.eq('approval_status', 'pending')
  } else if (filter.status !== 'all') {
    query = query.eq('status', filter.status)
  }

  const from = rangeStart(filter.range, new Date(`${filter.today}T00:00:00`))
  if (from) query = query.gte('placed_at', from)

  const searchFilter = buildTextSearchFilter(filter.search, [
    'order_number',
    'customer_name',
    'customer_email',
  ])
  if (searchFilter) query = query.or(searchFilter)

  return query
}

/**
 * Listado paginado.
 *
 * El término se sanea antes de entrar en el `or=`: una coma o un paréntesis no
 * son «texto que no encuentra nada» en PostgREST, son sintaxis del filtro.
 */
export async function fetchOrders(filter: OrdersFilter): Promise<OrdersPage> {
  if (!filter.storeId) return { rows: [], total: 0 }

  const first = filter.page * ORDERS_PAGE_SIZE
  const { data, error, count } = await filteredQuery(filter, { count: true }).range(
    first,
    first + ORDERS_PAGE_SIZE - 1,
  )

  if (error) throw orderErrorFromDb(error)
  return { rows: orderSchema.array().parse(data ?? []), total: count ?? 0 }
}

/** Tope de la exportación. Un CSV que no cabe en memoria no es un informe. */
export const EXPORT_LIMIT = 5000

/**
 * Filas para exportar: **lo filtrado, no la página**.
 *
 * Desde que el listado pagina, exportar «lo que se ve» exportaría 25 filas y
 * nadie lo notaría hasta abrir el archivo. Se repite la consulta sin `range` y
 * con un tope explícito.
 *
 * El tenant lo sigue poniendo la RLS —esta consulta no lleva `organization_id`,
 * igual que las demás— y el permiso lo comprueba la pantalla antes de llamar:
 * un rol sin lectura no llega hasta aquí, y si llegara, la RLS devolvería cero
 * filas en vez de datos de otro.
 */
export async function fetchOrdersForExport(filter: OrdersFilter): Promise<Order[]> {
  if (!filter.storeId) return []
  const { data, error } = await filteredQuery(filter, { count: false }).range(0, EXPORT_LIMIT - 1)
  if (error) throw orderErrorFromDb(error)
  return orderSchema.array().parse(data ?? [])
}

/**
 * Un pedido por id. El panel de detalle NO se queda con la fila que había en el
 * listado: tras un cambio de estado esa copia miente, y la bitácora que se pinta
 * al lado sí estaría al día. Se relee del servidor y se muestran las dos cosas
 * del mismo momento.
 */
export async function fetchOrder(orderId: string | null): Promise<Order | null> {
  if (!orderId) return null
  const { data, error } = await client()
    .from(ORDERS_TABLE)
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle()

  if (error) throw orderErrorFromDb(error)
  return data ? orderSchema.parse(data) : null
}

export async function fetchOrderItems(orderId: string | null): Promise<OrderItem[]> {
  if (!orderId) return []
  const { data, error } = await client()
    .from(ORDER_ITEMS_TABLE)
    .select(ITEM_SELECT)
    .eq('order_id', orderId)
    .order('created_at')

  if (error) throw orderErrorFromDb(error)
  return orderItemSchema.array().parse(data ?? [])
}

/**
 * Línea de tiempo del pedido (`order_events`, migración `20260828110200`).
 *
 * Es de solo lectura por construcción: la tabla no da INSERT a `authenticated`
 * y la escribe el trigger `ebim.log_order_timeline`. Aquí no hay ninguna
 * función que «registre» un evento — si existiera, la línea de tiempo podría
 * contar una historia distinta de la que cuentan las columnas de estado.
 */
export async function fetchOrderEvents(orderId: string | null): Promise<OrderEvent[]> {
  if (!orderId) return []
  const { data, error } = await client()
    .from(ORDER_TIMELINE_TABLE)
    .select(EVENT_SELECT)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw orderErrorFromDb(error)
  return orderEventSchema.array().parse(data ?? [])
}

export async function fetchOrderNotes(orderId: string | null): Promise<OrderNote[]> {
  if (!orderId) return []
  const { data, error } = await client()
    .from(ORDER_NOTES_TABLE)
    .select(NOTE_SELECT)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })

  if (error) throw orderErrorFromDb(error)
  return orderNoteSchema.array().parse(data ?? [])
}

export async function fetchOrderTags(orderId: string | null): Promise<OrderTag[]> {
  if (!orderId) return []
  const { data, error } = await client()
    .from(ORDER_TAGS_TABLE)
    .select(TAG_SELECT)
    .eq('order_id', orderId)
    .order('tag')

  if (error) throw orderErrorFromDb(error)
  return orderTagSchema.array().parse(data ?? [])
}

export async function fetchOrderExternalRefs(
  orderId: string | null,
): Promise<OrderExternalRef[]> {
  if (!orderId) return []
  const { data, error } = await client()
    .from(ORDER_EXTERNAL_REFS_TABLE)
    .select(EXTERNAL_REF_SELECT)
    .eq('order_id', orderId)
    .order('system_code')
    .order('ref_type')

  if (error) throw orderErrorFromDb(error)
  return orderExternalRefSchema.array().parse(data ?? [])
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface UpdateStatusInput {
  orderId: string
  status: OrderStatus
  note?: string
}

/**
 * Cambio del estado COMERCIAL por la Edge Function de P07.
 *
 * Sigue viva y sigue siendo válida: el GRANT por columna de `orders` permite
 * `status`, la policy y los dos triggers deciden, y desde P08 el trigger de
 * sincronización adelanta además los ejes de pago y entrega. Se conserva porque
 * hay clientes que la usan; lo que la pantalla usa hoy es `transitionOrder`,
 * que además deja el motivo y publica el hecho de dominio.
 */
export async function updateOrderStatus(input: UpdateStatusInput): Promise<void> {
  const note = input.note?.trim() ?? ''
  const body: Record<string, unknown> = { order_id: input.orderId, status: input.status }
  if (note) body.notes = note

  const { error } = await client().functions.invoke(UPDATE_ORDER_STATUS_FUNCTION, { body })
  if (error) throw await orderErrorFromInvoke(error)
}

export interface TransitionInput {
  orderId: string
  axis: OrderAxis
  to: string
  reason?: string
}

/**
 * El COMANDO de transición (P08-SaaS).
 *
 * No lleva tenant: el servidor lo saca de la fila del pedido y comprueba el rol
 * sobre ese tenant. No lleva el estado anterior: el «desde» lo lee la base, que
 * es quien sabe la verdad. Y no lleva importes: los tres ejes no tocan dinero.
 */
export async function transitionOrder(input: TransitionInput): Promise<void> {
  const reason = input.reason?.trim() ?? ''
  const { error } = await client().rpc(ORDER_TRANSITION_RPC, {
    p_order_id: input.orderId,
    p_axis: input.axis,
    p_to: input.to,
    p_reason: reason === '' ? null : reason,
  })
  if (error) throw orderErrorFromDb(error)
}

export interface ApprovalInput {
  orderId: string
  approve: boolean
  reason?: string
}

/** Decisión de una compra B2B pendiente. Rechazar exige motivo (lo pide la base). */
export async function decideOrderApproval(input: ApprovalInput): Promise<void> {
  const reason = input.reason?.trim() ?? ''
  const { error } = await client().rpc(ORDER_APPROVAL_DECIDE_RPC, {
    p_order_id: input.orderId,
    p_approve: input.approve,
    p_reason: reason === '' ? null : reason,
  })
  if (error) throw orderErrorFromDb(error)
}

/**
 * Anotación interna. Solo viaja `order_id` y el texto: el tenant, la tienda y
 * el autor los estampa el trigger `ebim.stamp_order_annotation` desde la fila
 * del pedido y desde el JWT. Aunque alguien mandara los tres uuids, se
 * sobreescriben antes de tocar disco.
 */
export async function addOrderNote(input: { orderId: string; body: string }): Promise<void> {
  const body = input.body.trim()
  if (body === '') throw new OrderError('orders.error.invalid', 'CAMPO_INVALIDO')
  const { error } = await client()
    .from(ORDER_NOTES_TABLE)
    .insert({ order_id: input.orderId, body })
  if (error) throw orderErrorFromDb(error)
}

export async function deleteOrderNote(noteId: string): Promise<void> {
  const { error } = await client().from(ORDER_NOTES_TABLE).delete().eq('id', noteId)
  if (error) throw orderErrorFromDb(error)
}

export async function addOrderTag(input: { orderId: string; tag: string }): Promise<void> {
  const tag = normalizeTag(input.tag)
  if (tag === '') throw new OrderError('orders.error.tagInvalid', 'CAMPO_INVALIDO')
  const { error } = await client()
    .from(ORDER_TAGS_TABLE)
    .insert({ order_id: input.orderId, tag })
  if (error) throw orderErrorFromDb(error)
}

export async function deleteOrderTag(tagId: string): Promise<void> {
  const { error } = await client().from(ORDER_TAGS_TABLE).delete().eq('id', tagId)
  if (error) throw orderErrorFromDb(error)
}

export interface ExternalRefInput {
  orderId: string
  systemCode: string
  refType: string
  externalId: string
  externalUrl?: string
}

export async function addOrderExternalRef(input: ExternalRefInput): Promise<void> {
  const url = input.externalUrl?.trim() ?? ''
  const { error } = await client()
    .from(ORDER_EXTERNAL_REFS_TABLE)
    .insert({
      order_id: input.orderId,
      system_code: input.systemCode.trim().toLowerCase(),
      ref_type: input.refType.trim().toLowerCase(),
      external_id: input.externalId.trim(),
      external_url: url === '' ? null : url,
    })
  if (error) throw orderErrorFromDb(error)
}

export async function deleteOrderExternalRef(refId: string): Promise<void> {
  const { error } = await client().from(ORDER_EXTERNAL_REFS_TABLE).delete().eq('id', refId)
  if (error) throw orderErrorFromDb(error)
}
