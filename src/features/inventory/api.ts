import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient, tryGetStorefrontClient } from '@/shared/lib/supabase'
import { InventoryError, inventoryErrorFromDb } from './errors'
import { ADMIN_PRODUCT_MASTERS_VIEW } from '@/shared/lib/db-schema'
import {
  ADJUST_INVENTORY_RPC,
  AVAILABILITY_PUBLIC_RPC,
  COMMIT_RESERVATION_RPC,
  INVENTORY_ALERTS_VIEW,
  INVENTORY_AVAILABILITY_RPC,
  INVENTORY_LEVELS_TABLE,
  INVENTORY_MOVEMENTS_TABLE,
  INVENTORY_RESERVATIONS_TABLE,
  PRODUCTS_TABLE,
  PRODUCT_VARIANTS_TABLE,
  RELEASE_RESERVATION_RPC,
  RESERVE_INVENTORY_RPC,
  SEED_INVENTORY_RPC,
  SET_INVENTORY_POLICY_RPC,
  STORE_WAREHOUSES_TABLE,
  WAREHOUSES_TABLE,
  availabilitySchema,
  inventoryAlertSchema,
  inventoryLevelSchema,
  inventoryMovementSchema,
  publicAvailabilitySchema,
  reservationResultSchema,
  reservationSchema,
  staleInterval,
  warehouseSchema,
  type InventoryAlert,
  type InventoryLevel,
  type InventoryMovement,
  type LevelRow,
  type MovementFormValues,
  type PolicyFormValues,
  type Reservation,
  type ReservationResult,
  type Warehouse,
  type WarehouseFormValues,
} from './types'

/**
 * Acceso a datos del inventario.
 *
 * Tres reglas, y la tercera es propia de este dominio:
 *
 *  1. **Ninguna consulta declara el tenant.** `organization_id` y `company_id`
 *     se escriben en el `insert` de almacén porque las columnas son NOT NULL,
 *     pero salen del contexto derivado del JWT; quien decide si esa escritura
 *     vale es la RLS. Ningún `select` filtra por tenant.
 *  2. **Ninguna disponibilidad se calcula aquí.** A «cuánto puedo prometer»
 *     responde el servidor (`ebim.atp`). Un ATP calculado en el navegador es un
 *     ATP que el navegador puede cambiar.
 *  3. **Nada escribe existencia con un `update`.** `inventory_levels` no tiene
 *     GRANT de escritura para nadie: entrada, corrección y reserva pasan por
 *     funciones que mueven y anotan en la misma transacción. Por eso este
 *     módulo tiene tantos `rpc` y tan pocos `from().update()`.
 */

export interface TenantScope {
  organizationId: string
  companyId: string
}

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new InventoryError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

// ---------------------------------------------------------------------------
// Almacenes
// ---------------------------------------------------------------------------

const WAREHOUSE_SELECT =
  'id, code, name, kind, source, stale_after, stale_policy, allows_backorder, priority, ' +
  'is_active, is_default, city, country'

export async function fetchWarehouses(): Promise<Warehouse[]> {
  const { data, error } = await client()
    .from(WAREHOUSES_TABLE)
    .select(WAREHOUSE_SELECT)
    .order('priority')
    .order('code')
  if (error) throw inventoryErrorFromDb(error)
  return warehouseSchema.array().parse(data ?? [])
}

export async function saveWarehouse(input: {
  id?: string | null
  scope: TenantScope
  values: WarehouseFormValues
}): Promise<void> {
  const supabase = client()
  const fields = {
    code: input.values.code,
    name: input.values.name,
    kind: input.values.kind,
    source: input.values.source,
    stale_policy: input.values.stale_policy,
    // Un almacén local nunca caduca: la base lo impide con un CHECK y aquí se
    // fuerza para que el formulario no mande algo que va a rebotar.
    stale_after:
      input.values.source === 'erp' ? staleInterval(input.values.stale_minutes) : null,
    allows_backorder: input.values.allows_backorder,
    priority: input.values.priority,
    is_active: input.values.is_active,
    is_default: input.values.is_default,
    city: input.values.city ? input.values.city : null,
    country: input.values.country ? input.values.country : null,
  }

  const { error } = input.id
    ? await supabase.from(WAREHOUSES_TABLE).update(fields).eq('id', input.id)
    : await supabase.from(WAREHOUSES_TABLE).insert({
        organization_id: input.scope.organizationId,
        company_id: input.scope.companyId,
        ...fields,
      })

  if (error) throw inventoryErrorFromDb(error)
}

export async function deleteWarehouse(id: string): Promise<void> {
  const { error } = await client().from(WAREHOUSES_TABLE).delete().eq('id', id)
  if (error) throw inventoryErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Qué almacenes sirven a la tienda
// ---------------------------------------------------------------------------

export interface StoreWarehouseLink {
  id: string
  warehouse_id: string
  priority: number
  is_active: boolean
}

export async function fetchStoreWarehouses(storeId: string | null): Promise<StoreWarehouseLink[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(STORE_WAREHOUSES_TABLE)
    .select('id, warehouse_id, priority, is_active')
    .eq('store_id', storeId)
    .order('priority')
  if (error) throw inventoryErrorFromDb(error)
  return (data ?? []) as StoreWarehouseLink[]
}

export async function linkStoreWarehouse(input: {
  scope: TenantScope
  storeId: string
  warehouseId: string
  priority: number
}): Promise<void> {
  const { error } = await client().from(STORE_WAREHOUSES_TABLE).insert({
    organization_id: input.scope.organizationId,
    company_id: input.scope.companyId,
    store_id: input.storeId,
    warehouse_id: input.warehouseId,
    priority: input.priority,
  })
  if (error) throw inventoryErrorFromDb(error)
}

/**
 * Los almacenes que sirven a la tienda, o `null` si la tienda no declara
 * ninguno (entonces la sirven todos los de la sociedad, como `ebim.serving_warehouses`).
 *
 * ADR 018: la existencia es de almacén × producto maestro. Su `store_id` es solo
 * un ancla informativa, así que «lo de esta tienda» se lee por los almacenes que
 * la sirven, no por esa columna.
 */
async function servingWarehouseIds(storeId: string): Promise<string[] | null> {
  const links = await fetchStoreWarehouses(storeId)
  const active = links.filter((link) => link.is_active).map((link) => link.warehouse_id)
  return links.length === 0 ? null : active
}

export async function unlinkStoreWarehouse(id: string): Promise<void> {
  const { error } = await client().from(STORE_WAREHOUSES_TABLE).delete().eq('id', id)
  if (error) throw inventoryErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Existencias
// ---------------------------------------------------------------------------

const LEVEL_SELECT =
  'id, warehouse_id, store_id, product_id, variant_id, on_hand_qty, reserved_qty, ' +
  'available_qty, safety_stock, reorder_point, synced_at, allow_backorder'

/**
 * Existencias de una tienda, con el nombre de lo que representan.
 *
 * El nombre se resuelve en dos consultas más y no con un `select` anidado de
 * PostgREST porque la referencia puede ser un producto o una variante, y un
 * `embed` que a veces trae `null` obliga a la pantalla a decidir cuál mirar —
 * que es exactamente la decisión que se acaba tomando de dos maneras distintas.
 */
export async function fetchLevels(input: {
  storeId: string | null
  warehouseId?: string | null
  term?: string
}): Promise<LevelRow[]> {
  if (!input.storeId) return []
  const supabase = client()

  const serving = await servingWarehouseIds(input.storeId)
  if (serving !== null && serving.length === 0) return []
  let query = supabase.from(INVENTORY_LEVELS_TABLE).select(LEVEL_SELECT)
  if (serving !== null) query = query.in('warehouse_id', serving)
  if (input.warehouseId) query = query.eq('warehouse_id', input.warehouseId)

  const { data, error } = await query.limit(500)
  if (error) throw inventoryErrorFromDb(error)

  const levels: InventoryLevel[] = inventoryLevelSchema.array().parse(data ?? [])
  if (levels.length === 0) return []

  const warehouses = await fetchWarehouses()
  const byWarehouse = new Map(warehouses.map((w) => [w.id, w]))

  const productIds = [...new Set(levels.map((l) => l.product_id))]
  const variantIds = [...new Set(levels.map((l) => l.variant_id).filter((v): v is string => !!v))]

  const [products, variants] = await Promise.all([
    supabase.from(PRODUCTS_TABLE).select('id, sku, name').in('id', productIds),
    variantIds.length
      ? supabase.from(PRODUCT_VARIANTS_TABLE).select('id, sku, name').in('id', variantIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (products.error) throw inventoryErrorFromDb(products.error)
  if (variants.error) throw inventoryErrorFromDb(variants.error)

  const productById = new Map(
    (products.data ?? []).map((p) => [p.id as string, p as { sku: string; name: string }]),
  )
  const variantById = new Map(
    (variants.data ?? []).map((v) => [v.id as string, v as { sku: string; name: string }]),
  )

  const rows: LevelRow[] = levels.map((level) => {
    const product = productById.get(level.product_id)
    const variant = level.variant_id ? variantById.get(level.variant_id) : undefined
    return {
      ...level,
      warehouseCode: byWarehouse.get(level.warehouse_id)?.code ?? '—',
      warehouseName: byWarehouse.get(level.warehouse_id)?.name ?? '—',
      sku: variant?.sku ?? product?.sku ?? '—',
      name: variant ? `${product?.name ?? ''} · ${variant.name}` : (product?.name ?? '—'),
    }
  })

  const term = (input.term ?? '').trim().toLowerCase()
  const filtered = term
    ? rows.filter(
        (row) =>
          row.sku.toLowerCase().includes(term) ||
          row.name.toLowerCase().includes(term) ||
          row.warehouseCode.toLowerCase().includes(term),
      )
    : rows

  return filtered.sort((a, b) => a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode))
}

/** Búsqueda de referencias para dar de alta un movimiento. */
export interface StockProduct {
  id: string
  sku: string
  name: string
  kind: 'simple' | 'variant' | 'bundle'
}

export async function searchStockProducts(input: {
  storeId: string | null
  term: string
}): Promise<StockProduct[]> {
  if (!input.storeId) return []
  // ADR 018: la existencia física es del MAESTRO de la sociedad (almacén ×
  // producto), no de una tienda: se ofrece cualquier producto de la sociedad
  // activa, esté publicado donde esté. La vista ya se limita a esa sociedad.
  let query = client()
    .from(ADMIN_PRODUCT_MASTERS_VIEW)
    .select('id, sku, name, kind')
    // Un kit no lleva existencia propia: la lleva cada componente. Ofrecerlo
    // aquí sería ofrecer un movimiento que el servidor rechaza.
    .neq('kind', 'bundle')

  const filter = buildTextSearchFilter(input.term, ['sku', 'name'])
  if (filter) query = query.or(filter)

  const { data, error } = await query.order('sku').limit(30)
  if (error) throw inventoryErrorFromDb(error)
  return (data ?? []) as StockProduct[]
}

export interface StockVariant {
  id: string
  sku: string
  name: string
}

export async function fetchStockVariants(productId: string | null): Promise<StockVariant[]> {
  if (!productId) return []
  const { data, error } = await client()
    .from(PRODUCT_VARIANTS_TABLE)
    .select('id, sku, name')
    .eq('product_id', productId)
    .eq('is_active', true)
    .order('position')
  if (error) throw inventoryErrorFromDb(error)
  return (data ?? []) as StockVariant[]
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

const MOVEMENT_SELECT =
  'id, warehouse_id, product_id, variant_id, kind, quantity, on_hand_after, reason, ' +
  'reference_kind, reference_id, external_ref, source, occurred_at'

export async function fetchMovements(input: {
  storeId: string | null
  warehouseId?: string | null
}): Promise<InventoryMovement[]> {
  if (!input.storeId) return []
  const serving = await servingWarehouseIds(input.storeId)
  if (serving !== null && serving.length === 0) return []
  let query = client().from(INVENTORY_MOVEMENTS_TABLE).select(MOVEMENT_SELECT)
  if (serving !== null) query = query.in('warehouse_id', serving)
  if (input.warehouseId) query = query.eq('warehouse_id', input.warehouseId)

  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(200)
  if (error) throw inventoryErrorFromDb(error)
  return inventoryMovementSchema.array().parse(data ?? [])
}

export async function adjustInventory(values: MovementFormValues): Promise<void> {
  const { error } = await client().rpc(ADJUST_INVENTORY_RPC, {
    p_warehouse_id: values.warehouse_id,
    p_product_id: values.product_id,
    p_variant_id: values.variant_id,
    p_quantity: values.quantity,
    p_kind: values.kind,
    p_reason: values.reason ? values.reason : null,
    p_external_ref: null,
  })
  if (error) throw inventoryErrorFromDb(error)
}

export async function setInventoryPolicy(values: PolicyFormValues): Promise<void> {
  const { error } = await client().rpc(SET_INVENTORY_POLICY_RPC, {
    p_warehouse_id: values.warehouse_id,
    p_product_id: values.product_id,
    p_variant_id: values.variant_id,
    p_safety_stock: values.safety_stock,
    p_reorder_point: values.reorder_point,
  })
  if (error) throw inventoryErrorFromDb(error)
}

/** La transición desde `products.stock`: se pulsa una vez y es idempotente. */
export async function seedInventory(input: {
  warehouseId: string
  storeId: string
}): Promise<number> {
  const { data, error } = await client().rpc(SEED_INVENTORY_RPC, {
    p_warehouse_id: input.warehouseId,
    p_store_id: input.storeId,
  })
  if (error) throw inventoryErrorFromDb(error)
  return Number((data as { seeded?: number } | null)?.seeded ?? 0)
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

const RESERVATION_SELECT =
  'id, store_id, status, reference_kind, reference_key, expires_at, committed_at, ' +
  'released_at, order_id, created_at'

export async function fetchReservations(storeId: string | null): Promise<Reservation[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(INVENTORY_RESERVATIONS_TABLE)
    .select(RESERVATION_SELECT)
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw inventoryErrorFromDb(error)
  return reservationSchema.array().parse(data ?? [])
}

export async function reserveStock(input: {
  storeId: string
  referenceKey: string
  items: Array<{ product_id: string; variant_id?: string | null; uom_code?: string | null; quantity: number }>
  ttlSeconds?: number
}): Promise<ReservationResult> {
  const { data, error } = await client().rpc(RESERVE_INVENTORY_RPC, {
    p_store_id: input.storeId,
    p_reference_key: input.referenceKey,
    p_items: input.items,
    p_ttl_seconds: input.ttlSeconds ?? 900,
    p_reference_kind: 'manual',
  })
  if (error) throw inventoryErrorFromDb(error)
  return reservationResultSchema.parse(data)
}

export async function releaseReservation(input: { id: string; reason?: string }): Promise<void> {
  const { error } = await client().rpc(RELEASE_RESERVATION_RPC, {
    p_reservation_id: input.id,
    p_reason: input.reason ?? null,
  })
  if (error) throw inventoryErrorFromDb(error)
}

export async function commitReservation(input: { id: string; reason?: string }): Promise<void> {
  const { error } = await client().rpc(COMMIT_RESERVATION_RPC, {
    p_reservation_id: input.id,
    p_reason: input.reason ?? null,
  })
  if (error) throw inventoryErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

export interface AvailabilityItem {
  product_id: string
  variant_id?: string | null
  quantity?: number
}

/** Backoffice: la cifra sale, porque quien pregunta es de la sociedad. */
export async function fetchAvailability(input: {
  storeId: string
  items: readonly AvailabilityItem[]
}) {
  const { data, error } = await client().rpc(INVENTORY_AVAILABILITY_RPC, {
    p_store_id: input.storeId,
    p_items: input.items,
  })
  if (error) throw inventoryErrorFromDb(error)
  return availabilitySchema.array().parse(data ?? [])
}

/**
 * Vitrina: mismo semáforo, SIN cifra, y por el cliente anónimo. La tienda la
 * resuelve el servidor a partir del slug de la URL pública — igual que el
 * precio y que el pedido.
 */
export async function fetchPublicAvailability(input: {
  storeSlug: string
  items: readonly AvailabilityItem[]
}) {
  const supabase = tryGetStorefrontClient()
  if (!supabase) throw new InventoryError('auth.notConfigured', 'CONFIG_INCOMPLETA')

  const { data, error } = await supabase.rpc(AVAILABILITY_PUBLIC_RPC, {
    p_store_slug: input.storeSlug,
    p_items: input.items,
  })
  if (error) throw inventoryErrorFromDb(error)
  return publicAvailabilitySchema.array().parse(data ?? [])
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

const ALERT_SELECT =
  'store_id, warehouse_id, warehouse_code, product_id, variant_id, sku, name, kind, ' +
  'available_qty, reorder_point, synced_at'

export async function fetchAlerts(storeId: string | null): Promise<InventoryAlert[]> {
  if (!storeId) return []
  // Las alertas con almacén van por los almacenes que sirven a la tienda; las de
  // «publicado sin existencia» no tienen almacén y se leen por la tienda de su
  // publicación.
  const serving = await servingWarehouseIds(storeId)
  let query = client().from(INVENTORY_ALERTS_VIEW).select(ALERT_SELECT)
  query =
    serving === null
      ? query.or(`warehouse_id.not.is.null,store_id.eq.${storeId}`)
      : serving.length === 0
        ? query.eq('store_id', storeId).is('warehouse_id', null)
        : query.or(`warehouse_id.in.(${serving.join(',')}),store_id.eq.${storeId}`)
  const { data, error } = await query.limit(200)
  if (error) throw inventoryErrorFromDb(error)
  return inventoryAlertSchema.array().parse(data ?? [])
}
