import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTextSearchFilter } from '@/shared/lib/search'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { PromotionsError, promotionsErrorFromDb } from './errors'
import {
  ADMIN_STORE_PRODUCTS_VIEW,
  BRANDS_TABLE,
  CATEGORIES_TABLE,
  PRODUCTS_TABLE,
  PRODUCT_VARIANTS_TABLE,
} from '@/shared/lib/db-schema'
import {
  COUPONS_TABLE,
  GIFT_CARD_ADJUST_RPC,
  GIFT_CARD_CANCEL_RPC,
  GIFT_CARD_ISSUE_RPC,
  GIFT_CARD_OVERVIEW_VIEW,
  GIFT_CARD_TRANSACTIONS_TABLE,
  PROMOTIONS_TABLE,
  PROMOTION_AUDIENCES_TABLE,
  PROMOTION_EVENTS_TABLE,
  PROMOTION_OVERVIEW_VIEW,
  PROMOTION_SCOPES_TABLE,
  PROMOTION_SIMULATE_RPC,
  PROMOTION_TIERS_TABLE,
  couponSchema,
  giftCardSchema,
  promotionEventSchema,
  promotionSchema,
  promotionScopeSchema,
  promotionTierSchema,
  simulationSchema,
  type Coupon,
  type GiftCard,
  type Promotion,
  type PromotionEvent,
  type PromotionFormValues,
  type PromotionScope,
  type PromotionTier,
  type ScopeKind,
  type Simulation,
} from './types'

/**
 * Acceso a datos de promociones.
 *
 * Cuatro reglas, y las cuatro son consecuencia de cómo está construido el
 * dominio:
 *
 *  1. **Ninguna consulta declara el tenant.** Ni un `eq('organization_id', …)`.
 *     La RLS decide, y las nueve tablas están en `default deny`. El
 *     `organization_id`/`company_id` de una escritura sale del contexto que el
 *     JWT resolvió, nunca de un formulario.
 *  2. **Aquí no se calcula ni un descuento.** No hay una sola resta. Lo que la
 *     pantalla enseña lo calculó `ebim.evaluate_promotions`; lo que se cobra lo
 *     vuelve a calcular `create_order`. Una tercera aritmética en el navegador
 *     sería un tercer número que puede discrepar de los otros dos.
 *  3. **El contador de usos y el saldo no se escriben.** No existe un `update`
 *     sobre `usage_count` ni sobre `gift_cards.balance`: no hay GRANT que lo
 *     permita. Emitir, ajustar y anular son `rpc`.
 *  4. **El código de una tarjeta regalo se recibe UNA vez**, en la respuesta de
 *     `gift_card_issue`, y no se guarda en ningún estado de React que
 *     sobreviva al diálogo. Después ya no existe forma de leerlo.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new PromotionsError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

/** El tenant que la sesión resolvió. Nunca sale de un campo del formulario. */
export interface PromotionScopeIds {
  readonly organizationId: string
  readonly companyId: string
  readonly storeId: string
}

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

export interface PromotionFilter {
  readonly storeId: string | null
  /** `all` o uno de los estados efectivos. Tabs, no un panel de filtros. */
  readonly status: string
  readonly term: string
}

export async function fetchPromotions(filter: PromotionFilter): Promise<Promotion[]> {
  if (!filter.storeId) return []
  let query = client()
    .from(PROMOTION_OVERVIEW_VIEW)
    .select('*')
    .eq('store_id', filter.storeId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(200)

  if (filter.status !== 'all') query = query.eq('effective_status', filter.status)

  // Un solo buscador general (regla de suite §8). El término se neutraliza en
  // `shared/lib/search` porque los separadores del filtro `or` de PostgREST son
  // parte de su sintaxis.
  const search = buildTextSearchFilter(filter.term, ['code', 'name'])
  if (search) query = query.or(search)

  const { data, error } = await query
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => promotionSchema.parse(row))
}

function toRow(scope: PromotionScopeIds, values: PromotionFormValues) {
  const nullable = (raw: string) => {
    const value = raw.trim()
    return value === '' ? null : value
  }
  return {
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    code: values.code.trim(),
    name: values.name.trim(),
    description: nullable(values.description),
    image_url: values.imageUrl,
    kind: values.kind,
    status: values.status,
    priority: values.priority,
    stack_group: nullable(values.stackGroup),
    is_exclusive: values.isExclusive,
    requires_coupon: values.requiresCoupon,
    value_percent: nullable(values.valuePercent),
    value_amount: nullable(values.valueAmount),
    max_discount_amount: nullable(values.maxDiscountAmount),
    buy_quantity: nullable(values.buyQuantity),
    free_quantity: nullable(values.freeQuantity),
    min_subtotal: nullable(values.minSubtotal),
    min_quantity: nullable(values.minQuantity),
    valid_from: new Date(values.validFrom).toISOString(),
    valid_to: values.validTo === '' ? null : new Date(values.validTo).toISOString(),
    usage_limit: values.usageLimit === '' ? null : Number(values.usageLimit),
    usage_limit_per_customer:
      values.usageLimitPerCustomer === '' ? null : Number(values.usageLimitPerCustomer),
  }
}

export async function createPromotion(
  scope: PromotionScopeIds,
  values: PromotionFormValues,
): Promise<string> {
  const { data, error } = await client()
    .from(PROMOTIONS_TABLE)
    .insert(toRow(scope, values))
    .select('id')
    .single()
  if (error) throw promotionsErrorFromDb(error)
  return String((data as { id: string }).id)
}

export async function updatePromotion(
  scope: PromotionScopeIds,
  id: string,
  values: PromotionFormValues,
  /** La campaña tal como estaba. Sirve para no mandar lo que no ha cambiado. */
  previa?: { image_url: string | null } | null,
): Promise<void> {
  // `promotions` tiene GRANT **por columna** para `authenticated`: la RLS filtra
  // filas y nunca columnas, así que la lista de lo actualizable se enumera una a
  // una en la migración. Mandar una columna que no está en esa lista no da un
  // aviso, da un 42501 —«tu rol no puede hacer ese cambio»— y tumba la consulta
  // ENTERA, aunque el valor enviado sea idéntico al que ya había.
  //
  // Lo que NO viaja, y ninguno por olvido:
  //
  //  · el TENANT (`organization_id`, `company_id`, `store_id`) — mover una
  //    campaña de tenant no es una edición, es una fuga, y la policy la
  //    rechazaría de todas formas;
  //  · `kind` — el tipo es inmutable después de crear: sus alcances y escalas
  //    cuelgan de él por clave ajena compuesta, y la pantalla ya bloquea el
  //    selector. Se seguía enviando igualmente, y era la mitad del 42501;
  //  · `image_url` **si no cambió** — es la otra mitad. La columna se añadió en
  //    `20260902230000` sin ampliar el grant, así que hasta que se aplique
  //    `20260908220000_promotion_image_grant.sql` cualquier edición que la
  //    incluya falla. Enviándola solo cuando de verdad cambia, editar el resto
  //    de la campaña funciona ya; cambiar la foto necesita esa migración.
  const row = toRow(scope, values)
  const fuera = new Set(['organization_id', 'company_id', 'store_id', 'kind'])
  if (previa && previa.image_url === row.image_url) fuera.add('image_url')

  const editable = Object.fromEntries(
    Object.entries(row).filter(([key]) => !fuera.has(key)),
  )
  const { error } = await client().from(PROMOTIONS_TABLE).update(editable).eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

/**
 * Cambiar el estado y nada más.
 *
 * Existe aparte del guardado completo porque pausar una campaña que está
 * descontando ahora mismo tiene que ser un clic, no abrir un formulario de
 * veinte campos y acordarse de no tocar nada más.
 */
export async function setPromotionStatus(id: string, status: string): Promise<void> {
  const { error } = await client().from(PROMOTIONS_TABLE).update({ status }).eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

export async function deletePromotion(id: string): Promise<void> {
  const { error } = await client().from(PROMOTIONS_TABLE).delete().eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Alcance y escalas
// ---------------------------------------------------------------------------

/**
 * A qué se puede apuntar un alcance, buscándolo por su nombre.
 *
 * El campo era un `Identificador` de texto libre, y lo que la tabla guarda son
 * `product_id`, `category_id` y `brand_id`: **uuids**. Teclear el SKU —que es lo
 * que cualquiera hace, porque es el identificador que la gente conoce— mandaba
 * `QS-000004` a una columna uuid y Postgres lo rechazaba antes de mirar nada,
 * así que la pantalla contestaba «No pudimos completar la operación» a algo que
 * nunca iba a poder completarse.
 *
 * El uuid no se teclea: se elige. Se busca por nombre o código y el identificador
 * viaja por debajo, que es lo que ya hacen Precios y el simulador.
 */
export interface ScopeCandidate {
  id: string
  name: string
  code: string | null
}

export async function searchScopeTargets(input: {
  storeId: string | null
  kind: ScopeKind
  term: string
}): Promise<ScopeCandidate[]> {
  if (!input.storeId || input.kind === 'all') return []

  // Cada tabla tiene su propia forma, y darla por supuesta se paga con un 400:
  //
  //  · `categories` cuelga de una TIENDA y se filtra por ella;
  //  · `brands` cuelga de la SOCIEDAD —no tiene `store_id`— y su código se
  //    llama `code`, no `slug`. Filtrarla por tienda pedía una columna que no
  //    existe, y el buscador de marcas respondía 400 sin decir nada en pantalla.
  //
  // El aislamiento de la marca no se pierde por no filtrar aquí: lo garantiza su
  // RLS por `organization_id`/`company_id`, que es donde tiene que estar.
  //  · el producto es un MAESTRO de la sociedad (ADR 018): lo que tiene tienda
  //    es su publicación, `admin_store_products`, que lo expone como
  //    `product_id`. Un alcance solo puede apuntar a lo publicado aquí (la clave
  //    ajena lo exige).
  const porTipo = {
    category: { tabla: CATEGORIES_TABLE, id: 'id', codigo: 'slug', porTienda: true },
    brand: { tabla: BRANDS_TABLE, id: 'id', codigo: 'code', porTienda: false },
    product: { tabla: ADMIN_STORE_PRODUCTS_VIEW, id: 'product_id', codigo: 'sku', porTienda: true },
    variant: { tabla: ADMIN_STORE_PRODUCTS_VIEW, id: 'product_id', codigo: 'sku', porTienda: true },
  } as const satisfies Record<
    Exclude<ScopeKind, 'all'>,
    { tabla: string; id: string; codigo: string; porTienda: boolean }
  >

  const { tabla, id, codigo, porTienda } = porTipo[input.kind]

  let query = client().from(tabla).select(`${id}, name, ${codigo}`).order('name').limit(20)
  if (porTienda) query = query.eq('store_id', input.storeId)

  const filtro = buildTextSearchFilter(input.term, ['name', codigo])
  if (filtro) query = query.or(filtro)

  const { data, error } = await query
  if (error) throw promotionsErrorFromDb(error)

  return (data ?? []).map((fila) => {
    const row = fila as Record<string, unknown>
    const code = row[codigo]
    return {
      id: String(row[id]),
      name: String(row.name),
      code: typeof code === 'string' ? code : null,
    }
  })
}

/**
 * Cómo se llama aquello a lo que apunta cada alcance.
 *
 * La pastilla decía «Producto» y nada más: con dos alcances de producto no había
 * forma de saber cuál era cuál, ni de reconocer el que acababas de añadir. La
 * tabla guarda uuids, así que los nombres hay que ir a buscarlos.
 *
 * Una consulta por tipo y solo con los ids que de verdad aparecen: son cuatro
 * como mucho, y casi siempre una.
 */
export async function fetchScopeNames(
  scopes: readonly PromotionScope[],
): Promise<Record<string, string>> {
  const porTabla: Array<[string, Array<string | null>]> = [
    [PRODUCTS_TABLE, scopes.map((s) => s.product_id)],
    [PRODUCT_VARIANTS_TABLE, scopes.map((s) => s.variant_id)],
    [CATEGORIES_TABLE, scopes.map((s) => s.category_id)],
    [BRANDS_TABLE, scopes.map((s) => s.brand_id)],
  ]

  const nombres: Record<string, string> = {}
  await Promise.all(
    porTabla.map(async ([tabla, crudos]) => {
      const ids = [...new Set(crudos.filter((id): id is string => Boolean(id)))]
      if (ids.length === 0) return
      const { data, error } = await client().from(tabla).select('id, name').in('id', ids)
      // Un nombre que no se puede leer no rompe la pantalla: la pastilla se
      // queda con su etiqueta de siempre, que es lo que hacía hasta ahora.
      if (error) return
      for (const fila of data ?? []) {
        const row = fila as { id: string; name: string }
        nombres[row.id] = row.name
      }
    }),
  )
  return nombres
}

/** Las variantes de un producto ya elegido: el segundo paso del alcance `variant`. */
export async function fetchScopeVariants(productId: string | null): Promise<ScopeCandidate[]> {
  if (!productId) return []
  const { data, error } = await client()
    .from(PRODUCT_VARIANTS_TABLE)
    .select('id, name, sku')
    .eq('product_id', productId)
    .order('position')
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((fila) => {
    const row = fila as { id: string; name: string; sku: string | null }
    return { id: row.id, name: row.name, code: row.sku }
  })
}

export async function fetchScopes(promotionId: string | null): Promise<PromotionScope[]> {
  if (!promotionId) return []
  const { data, error } = await client()
    .from(PROMOTION_SCOPES_TABLE)
    .select(
      'id, promotion_id, scope_kind, product_id, variant_id, category_id, brand_id, required_quantity, is_exclusion, include_descendants',
    )
    .eq('promotion_id', promotionId)
    .order('is_exclusion', { ascending: true })
    .order('scope_kind', { ascending: true })
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => promotionScopeSchema.parse(row))
}

export interface ScopeInput {
  readonly promotionId: string
  readonly promotionKind: string
  readonly scopeKind: ScopeKind
  readonly productId: string | null
  readonly variantId: string | null
  readonly categoryId: string | null
  readonly brandId: string | null
  readonly requiredQuantity: string | null
  readonly isExclusion: boolean
  /** Solo para `category`: la campana cubre tambien las subcategorias. */
  readonly includeDescendants?: boolean
}

export async function addScope(scope: PromotionScopeIds, input: ScopeInput): Promise<void> {
  const { error } = await client().from(PROMOTION_SCOPES_TABLE).insert({
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    promotion_id: input.promotionId,
    // Denormalizado del padre, con FK compuesta contra `promotions (id, kind)`:
    // declarar aquí un tipo distinto del de la campaña no da una fila mal, da
    // un error de clave ajena.
    promotion_kind: input.promotionKind,
    scope_kind: input.scopeKind,
    product_id: input.productId,
    variant_id: input.variantId,
    category_id: input.categoryId,
    brand_id: input.brandId,
    required_quantity: input.requiredQuantity,
    is_exclusion: input.isExclusion,
    // Solo tiene sentido en un alcance de categoria; la base lo comprueba con
    // un CHECK, asi que mandarlo en otro alcance seria un error, no un dato.
    include_descendants: input.scopeKind === 'category' ? input.includeDescendants : false,
  })
  if (error) throw promotionsErrorFromDb(error)
}

export async function removeScope(id: string): Promise<void> {
  const { error } = await client().from(PROMOTION_SCOPES_TABLE).delete().eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

export async function fetchTiers(promotionId: string | null): Promise<PromotionTier[]> {
  if (!promotionId) return []
  const { data, error } = await client()
    .from(PROMOTION_TIERS_TABLE)
    .select('id, promotion_id, min_quantity, discount_percent, discount_amount')
    .eq('promotion_id', promotionId)
    .order('min_quantity', { ascending: true })
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => promotionTierSchema.parse(row))
}

export async function addTier(
  scope: PromotionScopeIds,
  input: {
    promotionId: string
    minQuantity: string
    discountPercent: string | null
    discountAmount: string | null
  },
): Promise<void> {
  const { error } = await client().from(PROMOTION_TIERS_TABLE).insert({
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    promotion_id: input.promotionId,
    promotion_kind: 'volume_tier',
    min_quantity: input.minQuantity,
    discount_percent: input.discountPercent,
    discount_amount: input.discountAmount,
  })
  if (error) throw promotionsErrorFromDb(error)
}

export async function removeTier(id: string): Promise<void> {
  const { error } = await client().from(PROMOTION_TIERS_TABLE).delete().eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

export async function addChannelAudience(
  scope: PromotionScopeIds,
  input: { promotionId: string; channelId: string },
): Promise<void> {
  const { error } = await client().from(PROMOTION_AUDIENCES_TABLE).insert({
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    promotion_id: input.promotionId,
    audience_kind: 'channel',
    channel_id: input.channelId,
  })
  if (error) throw promotionsErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Cupones
// ---------------------------------------------------------------------------

const COUPON_SELECT =
  'id, promotion_id, code, code_normalized, is_active, valid_from, valid_to, usage_limit, usage_limit_per_customer, usage_count, notes'

export async function fetchCoupons(
  storeId: string | null,
  term: string,
): Promise<Coupon[]> {
  if (!storeId) return []
  let query = client()
    .from(COUPONS_TABLE)
    .select(COUPON_SELECT)
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  const search = buildTextSearchFilter(term, ['code', 'code_normalized'])
  if (search) query = query.or(search)

  const { data, error } = await query
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => couponSchema.parse(row))
}

export async function createCoupon(
  scope: PromotionScopeIds,
  input: {
    promotionId: string
    code: string
    validFrom: string
    validTo: string
    usageLimit: string
    usageLimitPerCustomer: string
    notes: string
  },
): Promise<void> {
  const { error } = await client().from(COUPONS_TABLE).insert({
    organization_id: scope.organizationId,
    company_id: scope.companyId,
    store_id: scope.storeId,
    promotion_id: input.promotionId,
    // Se manda TAL CUAL lo escribió el operador: `code_normalized` es una
    // columna GENERADA y normalizarlo aquí sería una segunda regla que un día
    // deja de coincidir con la de la base.
    code: input.code.trim(),
    valid_from: input.validFrom === '' ? null : new Date(input.validFrom).toISOString(),
    valid_to: input.validTo === '' ? null : new Date(input.validTo).toISOString(),
    usage_limit: input.usageLimit === '' ? null : Number(input.usageLimit),
    usage_limit_per_customer:
      input.usageLimitPerCustomer === '' ? null : Number(input.usageLimitPerCustomer),
    notes: input.notes.trim() === '' ? null : input.notes.trim(),
  })
  if (error) throw promotionsErrorFromDb(error)
}

export async function setCouponActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await client().from(COUPONS_TABLE).update({ is_active: isActive }).eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await client().from(COUPONS_TABLE).delete().eq('id', id)
  if (error) throw promotionsErrorFromDb(error)
}

// ---------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------

export async function fetchPromotionEvents(storeId: string | null): Promise<PromotionEvent[]> {
  if (!storeId) return []
  const { data, error } = await client()
    .from(PROMOTION_EVENTS_TABLE)
    .select(
      'id, promotion_id, entity, action, promotion_status, actor_email, occurred_at, before_state, after_state',
    )
    .eq('store_id', storeId)
    .order('occurred_at', { ascending: false })
    .limit(100)
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => promotionEventSchema.parse(row))
}

// ---------------------------------------------------------------------------
// Tarjetas regalo
// ---------------------------------------------------------------------------

export async function fetchGiftCards(
  storeId: string | null,
  status: string,
  term: string,
): Promise<GiftCard[]> {
  if (!storeId) return []
  let query = client()
    .from(GIFT_CARD_OVERVIEW_VIEW)
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status !== 'all') query = query.eq('effective_status', status)

  const search = buildTextSearchFilter(term, ['code_last4', 'issued_to_email'])
  if (search) query = query.or(search)

  const { data, error } = await query
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => giftCardSchema.parse(row))
}

export interface IssuedGiftCard {
  readonly giftCardId: string
  /** La ÚNICA vez que el código sale de la base. No se guarda en ningún sitio. */
  readonly code: string
  readonly balance: string
  readonly currency: string
}

export async function issueGiftCard(input: {
  storeId: string
  amount: string
  expiresAt: string
  email: string
  notes: string
}): Promise<IssuedGiftCard> {
  const { data, error } = await client().rpc(GIFT_CARD_ISSUE_RPC, {
    p_store_id: input.storeId,
    p_amount: input.amount,
    p_expires_at: input.expiresAt === '' ? null : new Date(input.expiresAt).toISOString(),
    p_email: input.email.trim() === '' ? null : input.email.trim(),
    p_notes: input.notes.trim() === '' ? null : input.notes.trim(),
  })
  if (error) throw promotionsErrorFromDb(error)
  const row = (data ?? {}) as Record<string, unknown>
  return {
    giftCardId: String(row.gift_card_id ?? ''),
    code: String(row.code ?? ''),
    balance: String(row.balance ?? '0.00'),
    currency: String(row.currency ?? ''),
  }
}

export async function adjustGiftCard(input: {
  giftCardId: string
  amount: string
  reason: string
}): Promise<void> {
  const { error } = await client().rpc(GIFT_CARD_ADJUST_RPC, {
    p_gift_card_id: input.giftCardId,
    p_amount: input.amount,
    p_reason: input.reason,
  })
  if (error) throw promotionsErrorFromDb(error)
}

export async function cancelGiftCard(input: {
  giftCardId: string
  reason: string
}): Promise<void> {
  const { error } = await client().rpc(GIFT_CARD_CANCEL_RPC, {
    p_gift_card_id: input.giftCardId,
    p_reason: input.reason,
  })
  if (error) throw promotionsErrorFromDb(error)
}

export interface GiftCardMovement {
  readonly id: string
  readonly kind: string
  readonly amount: string
  readonly balanceAfter: string
  readonly reference: string | null
  readonly actorEmail: string | null
  readonly createdAt: string
}

export async function fetchGiftCardMovements(
  giftCardId: string | null,
): Promise<GiftCardMovement[]> {
  if (!giftCardId) return []
  const { data, error } = await client()
    .from(GIFT_CARD_TRANSACTIONS_TABLE)
    .select('id, kind, amount, balance_after, reference, actor_email, created_at')
    .eq('gift_card_id', giftCardId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw promotionsErrorFromDb(error)
  return (data ?? []).map((row) => {
    const entry = row as Record<string, unknown>
    return {
      id: String(entry.id),
      kind: String(entry.kind),
      amount: String(entry.amount),
      balanceAfter: String(entry.balance_after),
      reference: entry.reference === null ? null : String(entry.reference),
      actorEmail: entry.actor_email === null ? null : String(entry.actor_email),
      createdAt: String(entry.created_at),
    }
  })
}

// ---------------------------------------------------------------------------
// Simulación (regla 9)
// ---------------------------------------------------------------------------

export interface SimulationInput {
  readonly storeId: string
  readonly items: ReadonlyArray<{ productId: string; variantId: string | null; quantity: number }>
  readonly couponCodes: readonly string[]
  readonly channelId: string | null
  readonly segmentId: string | null
  readonly customerId: string | null
  /** Fecha en la que simular. Es lo que permite comprobar una campaña programada. */
  readonly at: string | null
}

export async function simulate(input: SimulationInput): Promise<Simulation> {
  const { data, error } = await client().rpc(PROMOTION_SIMULATE_RPC, {
    p_store_id: input.storeId,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      ...(item.variantId ? { variant_id: item.variantId } : {}),
      quantity: item.quantity,
    })),
    p_coupon_codes: input.couponCodes.length > 0 ? [...input.couponCodes] : null,
    p_channel_id: input.channelId,
    p_segment_id: input.segmentId,
    p_customer_id: input.customerId,
    p_at: input.at === '' || input.at === null ? null : new Date(input.at).toISOString(),
  })
  if (error) throw promotionsErrorFromDb(error)
  return simulationSchema.parse(data)
}
