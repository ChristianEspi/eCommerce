import { z } from 'zod'
import { moneyText } from '@/shared/lib/money'

/**
 * Pedidos del backoffice.
 *
 * **Los estados son los de la base, no los del encargo.** El encargo sugería
 * `pending/confirmed/preparing/ready/completed/cancelled` «salvo definición
 * EBIM distinta», y la definición EBIM existe desde P02: el enum
 * `public.order_status` de `20260827090400_orders.sql`, con su máquina de
 * estados en trigger (`ebim.assert_order_transition`), sus policies, su
 * `create_order` y sus tests de aislamiento. Renombrarlo sería tocar la mitad
 * del esquema para no ganar nada — mismo criterio que las decisiones 14
 * (`tenant_id`) y 31 (`stock_qty`).
 *
 * **Desde P08-SaaS un pedido tiene CUATRO ejes** y no uno. `status` sigue
 * siendo el ciclo comercial; `payment_status` dice dónde está el dinero,
 * `fulfillment_status` dónde está la mercancía y `approval_status` si alguien
 * de la empresa compradora tiene que firmar. Mezclarlos en una sola columna
 * dejaba sin nombre a estados normales del comercio real —pagado y no
 * despachado, despachado a crédito, reembolsado en parte—.
 */
export const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'paid',
  'partially_refunded',
  'refunded',
  'failed',
  'voided',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const FULFILLMENT_STATUSES = [
  'unfulfilled',
  'in_progress',
  'partially_fulfilled',
  'fulfilled',
  'returned',
  'cancelled',
] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

export const APPROVAL_STATUSES = ['not_required', 'pending', 'approved', 'rejected'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const ORDER_SOURCES = [
  'storefront',
  'backoffice',
  'api',
  'import',
  'scheduled',
  'repeat',
] as const
export type OrderSource = (typeof ORDER_SOURCES)[number]

/** Los tres ejes que el comando `public.order_transition` sabe mover. */
export const ORDER_AXES = ['order_status', 'payment_status', 'fulfillment_status'] as const
export type OrderAxis = (typeof ORDER_AXES)[number]

/**
 * Copia de las tres máquinas de estados que viven en los triggers de la base
 * (`ebim.assert_order_transition` y `ebim.assert_order_axes`) y en
 * `supabase/functions/_shared/orders.ts`.
 *
 * Existe para no ofrecer en el menú una transición que la base va a rechazar:
 * la autoridad sigue siendo el trigger. Un test compara las copias, igual que
 * hace `roles.test.ts` con la matriz de permisos.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'refunded', 'cancelled'],
  fulfilled: ['refunded'],
  cancelled: [],
  refunded: [],
}

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['authorized', 'paid', 'failed', 'voided'],
  authorized: ['paid', 'failed', 'voided'],
  paid: ['partially_refunded', 'refunded'],
  partially_refunded: ['refunded'],
  failed: ['pending', 'voided'],
  refunded: [],
  voided: [],
}

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  unfulfilled: ['in_progress', 'partially_fulfilled', 'fulfilled', 'cancelled'],
  in_progress: ['partially_fulfilled', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['fulfilled', 'returned', 'cancelled'],
  fulfilled: ['returned'],
  returned: [],
  cancelled: [],
}

/** Transiciones que el backoffice puede ofrecer desde el estado actual. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from]
}

/**
 * Lo mismo, por eje. Devuelve `[]` ante un valor desconocido en vez de
 * reventar: la base puede ganar un estado antes de que este bundle se
 * despliegue, y una pantalla en blanco es peor que un menú corto.
 */
export function nextForAxis(axis: OrderAxis, from: string): readonly string[] {
  if (axis === 'order_status') return ORDER_TRANSITIONS[from as OrderStatus] ?? []
  if (axis === 'payment_status') return PAYMENT_TRANSITIONS[from as PaymentStatus] ?? []
  return FULFILLMENT_TRANSITIONS[from as FulfillmentStatus] ?? []
}

/** Nombres reales de las tablas. Fuente unica: `shared/lib/db-schema.ts`. */
export {
  ORDERS_TABLE,
  ORDER_ITEMS_TABLE,
  ORDER_EVENTS_TABLE,
  ORDER_TIMELINE_TABLE,
  ORDER_NOTES_TABLE,
  ORDER_TAGS_TABLE,
  ORDER_EXTERNAL_REFS_TABLE,
} from '@/shared/lib/db-schema'

/**
 * Dirección de entrega: exactamente las dos claves que acepta `create-order`
 * (`address` + `reference` opcional). Se valida al leer porque `jsonb` no
 * garantiza forma: un pedido antiguo con otra estructura se pinta vacío, no
 * revienta la pantalla.
 */
export const shippingAddressSchema = z
  .object({
    address: z.string().nullable().default(null),
    reference: z.string().nullable().default(null),
  })
  .partial()
  .catch({})
export type ShippingAddress = z.infer<typeof shippingAddressSchema>

/**
 * Snapshot del cliente (P08-SaaS). Todas las claves opcionales: un pedido B2C
 * solo trae correo y nombre, y uno B2B trae además la ficha que resolvió el
 * servidor. `.catch({})` porque es `jsonb`: un pedido antiguo no lo tiene.
 */
export const customerSnapshotSchema = z
  .object({
    email: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
    phone: z.string().nullable().default(null),
    customer_code: z.string().nullable().default(null),
    customer_name: z.string().nullable().default(null),
    legal_name: z.string().nullable().default(null),
    tax_id: z.string().nullable().default(null),
    account_code: z.string().nullable().default(null),
    account_name: z.string().nullable().default(null),
  })
  .partial()
  .catch({})
export type CustomerSnapshot = z.infer<typeof customerSnapshotSchema>

/**
 * Todo el dinero llega como TEXTO (`grand_total::text` en el `select`): un
 * `numeric` en JSON se vuelve float en el primer `JSON.parse` (decisión P02
 * #19). Hasta P06 este esquema lo leía como `number` — se corrige en P07, que
 * es la primera pantalla que enseña importes de pedido.
 */
export const orderSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  store_id: z.string().uuid(),
  order_number: z.string(),
  customer_name: z.string().nullable().default(null),
  customer_email: z.string(),
  customer_phone: z.string().nullable().default(null),
  status: z.enum(ORDER_STATUSES),
  payment_status: z.enum(PAYMENT_STATUSES).catch('pending'),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES).catch('unfulfilled'),
  approval_status: z.enum(APPROVAL_STATUSES).catch('not_required'),
  source_channel: z.enum(ORDER_SOURCES).catch('storefront'),
  currency: z.string().length(3),
  subtotal: moneyText,
  tax_total: moneyText,
  shipping_total: moneyText,
  discount_total: moneyText,
  grand_total: moneyText,
  tax_inclusive: z.boolean().nullable().default(false),
  shipping_address: shippingAddressSchema.nullable().default(null),
  billing_address: shippingAddressSchema.nullable().default(null),
  customer_snapshot: customerSnapshotSchema.nullable().default(null),
  purchase_order_number: z.string().nullable().default(null),
  approval_reason: z.string().nullable().default(null),
  approval_decided_email: z.string().nullable().default(null),
  approval_decided_at: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  placed_at: z.string(),
  updated_at: z.string().nullable().default(null),
})
export type Order = z.infer<typeof orderSchema>

/** Línea del pedido: snapshot del producto en el momento de la compra. */
export const orderItemSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  product_id: z.string().uuid().nullable().default(null),
  sku: z.string(),
  name: z.string(),
  variant_label: z.string().nullable().default(null),
  uom_code: z.string().nullable().default(null),
  unit_price: moneyText,
  quantity: z.number().int(),
  line_total: moneyText,
  discount_amount: z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
    .catch('0.00'),
  // `null` = línea anterior a P08: no se registró. Cero significa «sin
  // impuesto», que no es lo mismo, y por eso no se rellena con un default.
  tax_rate: z.string().nullable().default(null),
  tax_amount: z.string().nullable().default(null),
  tax_category_code: z.string().nullable().default(null),
  price_source: z.string().nullable().default(null),
  price_list_code: z.string().nullable().default(null),
})
export type OrderItem = z.infer<typeof orderItemSchema>

/**
 * Evento de la línea de tiempo `order_events` (P08-SaaS).
 *
 * Reemplaza a la lectura de `order_status_events` en esta pantalla: aquella
 * solo cuenta uno de los cuatro ejes, y la migración `20260828110200` trajo su
 * historial aquí para que un pedido antiguo no aparezca sin memoria.
 */
export const ORDER_EVENT_AXES = [
  'order_status',
  'payment_status',
  'fulfillment_status',
  'approval_status',
] as const
export type OrderEventAxis = (typeof ORDER_EVENT_AXES)[number]

export const ORDER_EVENT_SOURCES = [
  'storefront',
  'backoffice',
  'system',
  'api',
  'import',
] as const
export type OrderEventSource = (typeof ORDER_EVENT_SOURCES)[number]

export const orderEventSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  event_type: z.string(),
  axis: z.enum(ORDER_EVENT_AXES).nullable().default(null),
  from_value: z.string().nullable().default(null),
  to_value: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
  // Los hechos de logística dejan `to_value` nulo —esa columna es de los ejes
  // del pedido— y guardan el movimiento aquí. Sin leerlo, la línea de tiempo
  // sabe que la entrega cambió de estado pero no a cuál.
  payload: z.record(z.unknown()).nullable().default({}),
  source: z.enum(ORDER_EVENT_SOURCES).catch('system'),
  actor_email: z.string().nullable().default(null),
  created_at: z.string(),
})
export type OrderEvent = z.infer<typeof orderEventSchema>

export const orderNoteSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  body: z.string(),
  author_email: z.string().nullable().default(null),
  created_at: z.string(),
})
export type OrderNote = z.infer<typeof orderNoteSchema>

export const orderTagSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  tag: z.string(),
})
export type OrderTag = z.infer<typeof orderTagSchema>

export const orderExternalRefSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  system_code: z.string(),
  ref_type: z.string(),
  external_id: z.string(),
  external_url: z.string().nullable().default(null),
})
export type OrderExternalRef = z.infer<typeof orderExternalRefSchema>

/** Mismo formato que `order_tags_fmt` en la base. Normalizar aquí es cortesía. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Rango de diacriticos combinantes, escrito con escapes: un caracter
    // invisible dentro de una clase de regex es una bomba de relojeria en un
    // diff.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// ---------------------------------------------------------------------------
// Filtros del listado
// ---------------------------------------------------------------------------

/**
 * Filtro de fecha por PRESETS, no por un panel de dos calendarios.
 *
 * La regla de suite (§8) es un buscador general + tabs de estado; el encargo
 * pide además filtrar por fecha. Un `Select` con rangos cerrados cumple las dos
 * cosas: es un solo control, no un formulario de filtros escondido en un panel.
 */
export const ORDER_DATE_RANGES = ['all', 'today', 'week', 'month', 'quarter'] as const
export type OrderDateRange = (typeof ORDER_DATE_RANGES)[number]

const RANGE_DAYS: Record<Exclude<OrderDateRange, 'all' | 'today'>, number> = {
  week: 7,
  month: 30,
  quarter: 90,
}

/**
 * Inicio del rango en ISO, o `null` para «todos».
 *
 * `now` se recibe como parámetro para que el test no dependa del reloj y para
 * que la clave de react-query no cambie cada milisegundo.
 */
export function rangeStart(range: OrderDateRange, now: Date): string | null {
  if (range === 'all') return null
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range !== 'today') start.setDate(start.getDate() - RANGE_DAYS[range] + 1)
  return start.toISOString()
}

/**
 * Las pestañas del listado.
 *
 * Son los cinco estados comerciales de siempre, más `awaiting_approval`, que no
 * es un `status` sino una cola: los pedidos B2B que esperan la firma de alguien
 * de la empresa compradora. Se ofrece como pestaña y no como un filtro más
 * porque es la única lista que alguien mira para ACTUAR, y esconderla detrás de
 * un panel de filtros es esconder trabajo pendiente.
 */
export type OrderStatusFilter = OrderStatus | 'all' | 'awaiting_approval'

/** Tamaño de página del listado. */
export const ORDERS_PAGE_SIZE = 25

export interface OrdersFilter {
  storeId: string | null
  search: string
  status: OrderStatusFilter
  range: OrderDateRange
  /** Día de referencia (`YYYY-MM-DD`): estabiliza la clave de caché. */
  today: string
  /** Base 0. La paginación la hace el SERVIDOR, no un `slice` del navegador. */
  page: number
}

export interface OrdersPage {
  readonly rows: Order[]
  /** Total de filas que cumplen el filtro, no las de esta página. */
  readonly total: number
}
