import { z } from 'zod'

/**
 * Vocabulario del inventario en el cliente.
 *
 * Las cantidades entran y salen como TEXTO decimal y se convierten a `number`
 * en un solo sitio (`toQuantity`). `inventory_levels` guarda `numeric(18,6)` y
 * PostgREST lo serializa como cadena: parsearlo suelto en cada pantalla es como
 * acaban dos vistas del mismo almacén diciendo cifras distintas.
 *
 * Este archivo NO decide disponibilidad. La autoridad es `ebim.atp` en el
 * servidor; aquí solo viven las formas que viajan y las reglas de PRESENTACIÓN
 * —qué aviso es más urgente, cómo se lee un estado de reserva— que no mueven ni
 * una unidad.
 */

export {
  WAREHOUSES_TABLE,
  STORE_WAREHOUSES_TABLE,
  INVENTORY_LEVELS_TABLE,
  INVENTORY_MOVEMENTS_TABLE,
  INVENTORY_RESERVATIONS_TABLE,
  INVENTORY_ALERTS_VIEW,
  PRODUCTS_TABLE,
  PRODUCT_VARIANTS_TABLE,
  INVENTORY_AVAILABILITY_RPC,
  AVAILABILITY_PUBLIC_RPC,
  RESERVE_INVENTORY_RPC,
  RELEASE_RESERVATION_RPC,
  COMMIT_RESERVATION_RPC,
  ADJUST_INVENTORY_RPC,
  SET_INVENTORY_POLICY_RPC,
  SEED_INVENTORY_RPC,
} from '@/shared/lib/db-schema'

// ---------------------------------------------------------------------------
// Enumerados: copia EXACTA de los tipos de Postgres (migración 200000).
// Un test contra la base compara las dos listas, igual que hace el PIM con
// `product_kind`: si alguien añade un valor en SQL y no aquí, falla.
// ---------------------------------------------------------------------------

export const WAREHOUSE_KINDS = ['warehouse', 'store', 'virtual'] as const
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number]

export const INVENTORY_SOURCES = ['local', 'erp'] as const
export type InventorySource = (typeof INVENTORY_SOURCES)[number]

export const STALENESS_POLICIES = ['unknown', 'trust_last_known'] as const
export type StalenessPolicy = (typeof STALENESS_POLICIES)[number]

export const MOVEMENT_KINDS = [
  'receipt',
  'issue',
  'return',
  'adjustment',
  'count',
  'transfer_in',
  'transfer_out',
] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]

export const RESERVATION_STATUSES = ['held', 'committed', 'released', 'expired'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

/**
 * Movimientos que un humano puede escribir desde el backoffice. `issue` NO está:
 * la salida por venta la hace el pedido, y permitirla a mano sería la puerta por
 * la que un almacén se descuadra sin que exista el documento que lo explique.
 * `count` tampoco: es la entrada del ERP, con saldo absoluto.
 */
export const MANUAL_MOVEMENT_KINDS = [
  'receipt',
  'adjustment',
  'return',
  'transfer_in',
  'transfer_out',
] as const
export type ManualMovementKind = (typeof MANUAL_MOVEMENT_KINDS)[number]

/**
 * Signo obligatorio de cada motivo. El servidor lo vuelve a comprobar
 * (`SIGNO_INCOHERENTE`); esto solo evita el viaje. Una «entrada» de −5 es un
 * asiento que nadie sabrá leer dentro de seis meses.
 */
export function requiredSign(kind: ManualMovementKind): 'positive' | 'negative' | 'any' {
  if (kind === 'receipt' || kind === 'return' || kind === 'transfer_in') return 'positive'
  if (kind === 'transfer_out') return 'negative'
  return 'any'
}

export function signMatches(kind: ManualMovementKind, quantity: number): boolean {
  if (quantity === 0) return false
  const sign = requiredSign(kind)
  if (sign === 'positive') return quantity > 0
  if (sign === 'negative') return quantity < 0
  return true
}

// ---------------------------------------------------------------------------
// Cantidades
// ---------------------------------------------------------------------------

/**
 * `numeric` de Postgres llega como cadena. Se acepta también `number` porque
 * PGlite y algunas rutas lo devuelven ya convertido.
 */
export const quantityText = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value), { message: 'inventory.error.quantity' })

/** Formato de cantidad: sin decimales cuando no los tiene. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export const warehouseSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(WAREHOUSE_KINDS),
  source: z.enum(INVENTORY_SOURCES),
  stale_after: z.string().nullable().default(null),
  stale_policy: z.enum(STALENESS_POLICIES),
  allows_backorder: z.boolean(),
  priority: z.number(),
  is_active: z.boolean(),
  is_default: z.boolean(),
  city: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
})
export type Warehouse = z.infer<typeof warehouseSchema>

export const inventoryLevelSchema = z.object({
  id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  store_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  on_hand_qty: quantityText,
  reserved_qty: quantityText,
  available_qty: quantityText,
  safety_stock: quantityText,
  reorder_point: quantityText,
  synced_at: z.string(),
  allow_backorder: z.boolean(),
})
export type InventoryLevel = z.infer<typeof inventoryLevelSchema>

/** Nivel con el nombre de lo que representa. Es lo que la pantalla enseña. */
export interface LevelRow extends InventoryLevel {
  warehouseCode: string
  warehouseName: string
  sku: string
  name: string
}

export const inventoryMovementSchema = z.object({
  id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  kind: z.enum(MOVEMENT_KINDS),
  quantity: quantityText,
  on_hand_after: quantityText,
  reason: z.string().nullable().default(null),
  reference_kind: z.string().nullable().default(null),
  reference_id: z.string().uuid().nullable().default(null),
  external_ref: z.string().nullable().default(null),
  source: z.enum(INVENTORY_SOURCES),
  occurred_at: z.string(),
})
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>

export const reservationSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  status: z.enum(RESERVATION_STATUSES),
  reference_kind: z.string(),
  reference_key: z.string(),
  expires_at: z.string(),
  committed_at: z.string().nullable().default(null),
  released_at: z.string().nullable().default(null),
  order_id: z.string().uuid().nullable().default(null),
  created_at: z.string(),
})
export type Reservation = z.infer<typeof reservationSchema>

export const ALERT_KINDS = ['below_reorder', 'negative', 'stale', 'unmapped', 'bundle_low'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const inventoryAlertSchema = z.object({
  store_id: z.string().uuid(),
  warehouse_id: z.string().uuid().nullable().default(null),
  warehouse_code: z.string().nullable().default(null),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  sku: z.string(),
  name: z.string(),
  kind: z.enum(ALERT_KINDS),
  available_qty: quantityText.nullable().default(null),
  reorder_point: quantityText.nullable().default(null),
  synced_at: z.string().nullable().default(null),
  /** Solo en `bundle_low`: el componente que deja armar pocos kits. */
  limiting_component: z.string().nullable().default(null),
})
export type InventoryAlert = z.infer<typeof inventoryAlertSchema>

/**
 * Orden de urgencia de los avisos. Es PRESENTACIÓN, no política: un saldo
 * negativo es un descuadre que ya ocurrió, y una referencia publicada sin
 * existencia registrada es una venta que no se puede cerrar — las dos pesan más
 * que un umbral que alguien puso por prudencia.
 */
export const ALERT_SEVERITY: Record<AlertKind, number> = {
  negative: 40,
  unmapped: 30,
  stale: 20,
  bundle_low: 15,
  below_reorder: 10,
}

export function compareAlerts(a: InventoryAlert, b: InventoryAlert): number {
  const severity = ALERT_SEVERITY[b.kind] - ALERT_SEVERITY[a.kind]
  if (severity !== 0) return severity
  return a.sku.localeCompare(b.sku)
}

// ---------------------------------------------------------------------------
// Disponibilidad tal y como responde el servidor
// ---------------------------------------------------------------------------

export const availabilitySchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  quantity: quantityText,
  available: quantityText.nullable().default(null),
  unknown: z.boolean(),
  backorder: z.boolean().default(false),
  source: z.enum(['catalog', 'warehouse', 'erp']),
  in_stock: z.boolean(),
})
export type AvailabilityRow = z.infer<typeof availabilitySchema>

/** Respuesta de la puerta ANÓNIMA: mismo semáforo, sin cifra. */
export const publicAvailabilitySchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  quantity: quantityText,
  unknown: z.boolean(),
  source: z.enum(['catalog', 'warehouse', 'erp']),
  in_stock: z.boolean(),
})
export type PublicAvailabilityRow = z.infer<typeof publicAvailabilitySchema>

export const reservationResultSchema = z.object({
  reservation_id: z.string().uuid(),
  token: z.string().length(64),
  status: z.enum(RESERVATION_STATUSES),
  expires_at: z.string(),
  created: z.boolean().default(true),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable().default(null),
        warehouse_id: z.string().uuid(),
        quantity: quantityText,
      }),
    )
    .default([]),
})
export type ReservationResult = z.infer<typeof reservationResultSchema>

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

export const warehouseFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/, 'inventory.error.code'),
    name: z.string().trim().min(1, 'inventory.error.name').max(160, 'inventory.error.name'),
    kind: z.enum(WAREHOUSE_KINDS),
    source: z.enum(INVENTORY_SOURCES),
    stale_policy: z.enum(STALENESS_POLICIES),
    /** Minutos. `null` = nunca caduca. */
    stale_minutes: z
      .union([z.number().int().positive(), z.nan()])
      .nullable()
      .default(null),
    allows_backorder: z.boolean().default(false),
    priority: z.number().int().min(0).max(9999).default(100),
    is_active: z.boolean().default(true),
    is_default: z.boolean().default(false),
    city: z.string().trim().max(120).optional().default(''),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z]{2})?$/, 'inventory.error.country')
      .optional()
      .default(''),
  })
  // El CHECK `warehouses_local_never_stale` en la base dice lo mismo. Aquí se
  // repite para que el formulario lo explique antes de viajar: un almacén
  // propio no puede tener la cifra «vieja» porque esta base ES su verdad.
  .refine((v) => v.source === 'erp' || v.stale_minutes == null || Number.isNaN(v.stale_minutes), {
    path: ['stale_minutes'],
    message: 'inventory.error.staleLocal',
  })
export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>

export const movementFormSchema = z
  .object({
    warehouse_id: z.string().uuid('inventory.error.warehouse'),
    product_id: z.string().uuid('inventory.error.product'),
    variant_id: z.string().uuid().nullable().default(null),
    kind: z.enum(MANUAL_MOVEMENT_KINDS),
    quantity: z
      .number({ invalid_type_error: 'inventory.error.quantity' })
      .refine((value) => value !== 0, 'inventory.error.quantity'),
    reason: z.string().trim().max(500).optional().default(''),
  })
  // «Traslado enviado: 5» quiere decir que salen cinco. Pedir que se escriba
  // «−5» era un error de formulario que nadie entendía («el signo no
  // coincide»): el motivo ya dice la dirección, así que el signo se pone solo.
  // Una ENTRADA negativa sí sigue siendo un error: ahí el signo contradice.
  .transform((v) =>
    requiredSign(v.kind) === 'negative' && v.quantity > 0 ? { ...v, quantity: -v.quantity } : v,
  )
  .refine((v) => signMatches(v.kind, v.quantity), {
    path: ['quantity'],
    message: 'inventory.error.sign',
  })
export type MovementFormValues = z.infer<typeof movementFormSchema>

export const policyFormSchema = z.object({
  warehouse_id: z.string().uuid('inventory.error.warehouse'),
  product_id: z.string().uuid('inventory.error.product'),
  variant_id: z.string().uuid().nullable().default(null),
  safety_stock: z.number().min(0, 'inventory.error.quantity'),
  reorder_point: z.number().min(0, 'inventory.error.quantity'),
})
export type PolicyFormValues = z.infer<typeof policyFormSchema>

/**
 * Minutos → `interval` de Postgres. Se envía como texto porque PostgREST no
 * tiene un tipo para intervalos: `'90 minutes'` es lo que Postgres entiende.
 */
export function staleInterval(minutes: number | null | undefined): string | null {
  if (minutes == null || Number.isNaN(minutes) || minutes <= 0) return null
  return `${Math.round(minutes)} minutes`
}
