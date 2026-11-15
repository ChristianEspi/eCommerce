/**
 * Reglas de pedido compartidas entre `create-order` y `update-order-status`.
 *
 * La máquina de estados está DUPLICADA a propósito: la versión que manda es el
 * trigger `ebim.assert_order_transition` en la base (nadie la puede saltar);
 * esta copia solo existe para devolver un 409 claro antes de ir a la base.
 * Un test verifica que las dos digan lo mismo.
 */
import { badRequest } from './errors.ts'

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'fulfilled',
  'cancelled',
  'refunded',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'refunded', 'cancelled'],
  fulfilled: ['refunded'],
  cancelled: [],
  refunded: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true
  return ORDER_TRANSITIONS[from].includes(to)
}

/**
 * P08-SaaS · los otros dos ejes de estado.
 *
 * Un pedido dejo de tener UN estado: tiene el ciclo comercial (`status`), el del
 * dinero (`payment_status`) y el de la mercancia (`fulfillment_status`). Las dos
 * maquinas de abajo estan DUPLICADAS de `ebim.assert_order_axes` por la misma
 * razon que `ORDER_TRANSITIONS` lo esta desde P02: la que manda es la de la
 * base, y esta copia solo existe para devolver un 409 claro antes de ir alla.
 * El test `edge-shared` compara las tres contra el SQL real.
 */
export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'paid',
  'partially_refunded',
  'refunded',
  'failed',
  'voided',
] as const

export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_TRANSITIONS: Record<PaymentStatusValue, PaymentStatusValue[]> = {
  pending: ['authorized', 'paid', 'failed', 'voided'],
  authorized: ['paid', 'failed', 'voided'],
  paid: ['partially_refunded', 'refunded'],
  partially_refunded: ['refunded'],
  failed: ['pending', 'voided'],
  refunded: [],
  voided: [],
}

export const FULFILLMENT_STATUSES = [
  'unfulfilled',
  'in_progress',
  'partially_fulfilled',
  'fulfilled',
  'returned',
  'cancelled',
] as const

export type FulfillmentStatusValue = (typeof FULFILLMENT_STATUSES)[number]

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatusValue, FulfillmentStatusValue[]> = {
  unfulfilled: ['in_progress', 'partially_fulfilled', 'fulfilled', 'cancelled'],
  in_progress: ['partially_fulfilled', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['fulfilled', 'returned', 'cancelled'],
  fulfilled: ['returned'],
  returned: [],
  cancelled: [],
}

/** Los tres ejes que el comando `public.order_transition` sabe mover. */
export const ORDER_AXES = ['order_status', 'payment_status', 'fulfillment_status'] as const
export type OrderAxis = (typeof ORDER_AXES)[number]

/**
 * Transiciones que se pueden OFRECER desde el estado actual de un eje.
 *
 * No incluye el estado en el que ya se esta: `public.order_transition` responde
 * `TRANSICION_SIN_CAMBIO` a eso, y ofrecerlo en un menu seria ofrecer un error.
 */
export function nextForAxis(axis: OrderAxis, from: string): readonly string[] {
  if (axis === 'order_status') {
    return ORDER_TRANSITIONS[from as OrderStatus] ?? []
  }
  if (axis === 'payment_status') {
    return PAYMENT_TRANSITIONS[from as PaymentStatusValue] ?? []
  }
  return FULFILLMENT_TRANSITIONS[from as FulfillmentStatusValue] ?? []
}

export type OrderItemInput = {
  product_id: string
  quantity: number
  /** Variante concreta. Obligatoria si el producto se vende por variantes (P03). */
  variant_id?: string
  /** Unidad de venta declarada. El FACTOR lo resuelve la base, nunca el cliente. */
  uom_code?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Mismo formato que `units_of_measure_code_fmt` en la base. */
const UOM_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/

/**
 * Campos que el cliente no decide. Si vienen, la petición se cae.
 *
 * Desde P03 entran los del PIM: `uom_id`, `uom_factor` y `base_quantity` son lo
 * que traduce "2 cajas" a existencia descontada. Aceptarlos del payload sería
 * dejar que el comprador decida cuánto se descuenta del almacén — la misma
 * clase de fallo que aceptar el precio. `sku` entra por lo mismo: identifica lo
 * que se despacha y lo resuelve el servidor a partir del producto y la variante.
 *
 * Desde P04 entran los del motor de precios. `segment_id` y `customer_id` son
 * A QUIÉN se le aplica un acuerdo comercial: un comprador que pudiera
 * declararlos se estaría asignando el precio negociado de otro. `price_list_id`
 * y `price_source` son el resultado de la resolución, no una entrada; y
 * `channel_id` lo elige el servidor desde P10 —estaba en la lista negra de la
 * base y faltaba aquí—, porque el canal interno tiene precios preferenciales.
 *
 * La lista se comprueba ANTES de normalizar y no después: normalizar descarta
 * las claves desconocidas, y descartar en silencio un intento de ponerse precio
 * es exactamente el fallo que no se quiere que pase inadvertido.
 */
const FORBIDDEN_ITEM_FIELDS = [
  'price',
  'unit_price',
  'unitPrice',
  'line_total',
  'lineTotal',
  'subtotal',
  'total',
  'currency',
  'discount',
  'organization_id',
  'company_id',
  'tenant_id',
  'store_id',
  'uom_id',
  'uom_factor',
  'factor',
  'base_quantity',
  'sku',
  'variant_sku',
  'channel_id',
  'segment_id',
  'customer_id',
  'price_list_id',
  'price_source',
  // N05: la orden de compra es del PEDIDO. Dentro de una línea no significa
  // nada, y aceptarla en silencio escondería un cliente mal construido.
  'purchase_order_number',
]

/**
 * Normaliza el carrito: solo `product_id`, `quantity` y —desde P03—
 * `variant_id` y `uom_code` sobreviven. Cualquier intento de mandar un precio o
 * un factor de conversión se rechaza explícitamente (contrato §2.6: nadie que
 * entrega un caso se autoasigna su precio).
 *
 * La clave de agrupación es la TERNA producto + variante + unidad: "1 camiseta
 * roja" y "1 camiseta azul" son dos líneas, y "1 caja" no se suma con "1
 * unidad" aunque sean del mismo producto. Es la misma clave que usa
 * `public.create_order`, que es quien manda.
 */
export function normalizeOrderItems(raw: unknown): OrderItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('ITEMS_REQUERIDOS', 'El pedido necesita al menos una linea')
  }
  if (raw.length > 100) {
    throw badRequest('ITEMS_EXCESIVOS', 'Maximo 100 lineas por pedido')
  }

  const merged = new Map<string, OrderItemInput>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw badRequest('ITEM_INVALIDO', 'Cada linea debe ser un objeto {product_id, quantity}')
    }
    const item = entry as Record<string, unknown>

    const offenders = FORBIDDEN_ITEM_FIELDS.filter((field) => field in item)
    if (offenders.length > 0) {
      throw badRequest(
        'CAMPO_NO_PERMITIDO',
        `El precio, el factor y el tenant los decide el servidor. Campos rechazados: ${offenders.join(', ')}`,
      )
    }

    const productId = typeof item.product_id === 'string' ? item.product_id.toLowerCase() : ''
    if (!UUID_RE.test(productId)) {
      throw badRequest('ITEM_INVALIDO', '`product_id` debe ser un uuid')
    }

    let variantId: string | undefined
    if (item.variant_id !== undefined && item.variant_id !== null && item.variant_id !== '') {
      const candidate = typeof item.variant_id === 'string' ? item.variant_id.toLowerCase() : ''
      if (!UUID_RE.test(candidate)) {
        throw badRequest('ITEM_INVALIDO', '`variant_id` debe ser un uuid')
      }
      variantId = candidate
    }

    let uomCode: string | undefined
    if (item.uom_code !== undefined && item.uom_code !== null && item.uom_code !== '') {
      const candidate = typeof item.uom_code === 'string' ? item.uom_code.trim() : ''
      if (!UOM_CODE_RE.test(candidate)) {
        throw badRequest('ITEM_INVALIDO', '`uom_code` no tiene el formato de un codigo de unidad')
      }
      uomCode = candidate.toUpperCase()
    }

    const quantity = item.quantity
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      throw badRequest('CANTIDAD_INVALIDA', 'La cantidad debe ser un entero mayor que cero')
    }
    if (quantity > 10000) {
      throw badRequest('CANTIDAD_INVALIDA', 'La cantidad maxima por linea es 10000')
    }

    const key = `${productId}|${variantId ?? ''}|${uomCode ?? ''}`
    const existing = merged.get(key)
    if (existing) {
      existing.quantity += quantity
      continue
    }

    // Las claves opcionales solo aparecen si tienen valor: una línea de
    // producto simple viaja exactamente igual que antes del PIM.
    const normalized: OrderItemInput = { product_id: productId, quantity }
    if (variantId) normalized.variant_id = variantId
    if (uomCode) normalized.uom_code = uomCode
    merged.set(key, normalized)
  }

  return [...merged.values()]
}

/**
 * Lo que la vitrina pregunta para la entrega.
 *
 * P06 pedía dos campos —calle y referencia— porque no había nada que decidir
 * con más. P12 añade CUATRO opcionales y ninguno es decorativo: son
 * exactamente los que `ebim.delivery_zone_for` necesita para decir «ahí no
 * llegamos» o «esa zona cuesta esto». `city` no participa en la cobertura y
 * entra igual porque es lo que se imprime en la etiqueta.
 *
 * Siguen siendo OPCIONALES: una tienda que no configura zonas no tiene por qué
 * pedirle el código postal a nadie, y exigirlo rompería el checkout mínimo que
 * funciona desde P06.
 */
export type ShippingAddress = {
  address: string
  reference?: string
  city?: string
  region?: string
  postal_code?: string
  /** ISO 3166-1 alpha-2, en mayúsculas. */
  country?: string
  /**
   * El punto exacto de entrega (2026-11-15): el pin del mapa del checkout o
   * el GPS del comprador. Grados decimales WGS84, 6 decimales (~10 cm). Van
   * los dos o ninguno: media coordenada no ubica nada.
   */
  latitude?: number
  longitude?: number
}

const SHIPPING_FIELDS = ['address', 'reference', 'city', 'region', 'postal_code', 'country', 'latitude', 'longitude']

/** Los cuatro opcionales, con su tope. `country` se valida aparte por su forma. */
const SHIPPING_OPTIONAL: ReadonlyArray<{ key: 'reference' | 'city' | 'region' | 'postal_code'; max: number }> = [
  { key: 'reference', max: 200 },
  { key: 'city', max: 120 },
  { key: 'region', max: 120 },
  { key: 'postal_code', max: 12 },
]

/**
 * Dirección de entrega: calle obligatoria y el resto opcional.
 *
 * Las claves desconocidas se RECHAZAN en vez de guardarse: `shipping_address`
 * es un `jsonb` y sin esta puerta se convierte en el vertedero por el que
 * entra cualquier cosa que se le ocurra al cliente.
 */
export function normalizeShippingAddress(raw: unknown): ShippingAddress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('CAMPO_INVALIDO', '`shipping_address` debe ser un objeto')
  }

  const source = raw as Record<string, unknown>
  const unknown = Object.keys(source).filter((key) => !SHIPPING_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw badRequest(
      'CAMPO_NO_PERMITIDO',
      `\`shipping_address\` solo admite ${SHIPPING_FIELDS.join(', ')}. Campos rechazados: ${unknown.join(', ')}`,
    )
  }

  const address = typeof source.address === 'string' ? source.address.trim() : ''
  if (address.length < 3 || address.length > 300) {
    throw badRequest(
      'CAMPO_INVALIDO',
      '`shipping_address.address` debe tener entre 3 y 300 caracteres',
    )
  }

  const normalized: ShippingAddress = { address }

  for (const field of SHIPPING_OPTIONAL) {
    const value = source[field.key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') {
      throw badRequest('CAMPO_INVALIDO', `\`shipping_address.${field.key}\` debe ser texto`)
    }
    const trimmed = value.trim()
    if (trimmed.length > field.max) {
      throw badRequest(
        'CAMPO_INVALIDO',
        `\`shipping_address.${field.key}\` supera los ${field.max} caracteres`,
      )
    }
    if (trimmed !== '') normalized[field.key] = trimmed
  }

  // El país decide la cobertura, así que su forma se comprueba: un «Perú» donde
  // se espera «PE» no encajaría con ninguna zona y el comprador vería «no
  // llegamos a tu dirección» sin entender por qué.
  const rawCountry = source.country
  if (rawCountry !== undefined && rawCountry !== null) {
    if (typeof rawCountry !== 'string') {
      throw badRequest('CAMPO_INVALIDO', '`shipping_address.country` debe ser texto')
    }
    const country = rawCountry.trim().toUpperCase()
    if (country !== '') {
      if (!/^[A-Z]{2}$/.test(country)) {
        throw badRequest(
          'CAMPO_INVALIDO',
          '`shipping_address.country` debe ser un codigo ISO 3166-1 alpha-2 (dos letras)',
        )
      }
      normalized.country = country
    }
  }

  const coordenada = (key: 'latitude' | 'longitude', limite: number): number | undefined => {
    const value = source[key]
    if (value === undefined || value === null || value === '') return undefined
    const numero = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (!Number.isFinite(numero) || Math.abs(numero) > limite) {
      throw badRequest('CAMPO_INVALIDO', `\`shipping_address.${key}\` debe ser un numero entre -${limite} y ${limite}`)
    }
    return Math.round(numero * 1e6) / 1e6
  }
  const latitude = coordenada('latitude', 90)
  const longitude = coordenada('longitude', 180)
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw badRequest('CAMPO_INVALIDO', '`shipping_address` lleva latitude y longitude juntas, o ninguna')
  }
  if (latitude !== undefined && longitude !== undefined) {
    normalized.latitude = latitude
    normalized.longitude = longitude
  }

  return normalized
}

/**
 * Dirección FISCAL: la de entrega más los datos del comprobante.
 *
 * `billing_address` ya era un `jsonb` del pedido, pero pasaba por la misma
 * puerta que la de entrega y no admitía nada fiscal. Un comprador empresa
 * necesita pedir FACTURA con su RUC y razón social, y cargarla a un centro de
 * costo; sin esto esos datos llegaban por correo después del pedido.
 *
 * Se aceptan cuatro claves más, cerradas y con tope, y nada más: la puerta
 * sigue rechazando lo que no conoce.
 *  - `document_type`: `invoice` (factura) o `receipt` (boleta).
 *  - `tax_id`: el RUC o documento fiscal. Obligatorio con factura.
 *  - `legal_name`: la razón social. Obligatoria con factura.
 *  - `cost_center`: a qué centro de costo se carga. Opcional.
 */
export type BillingAddress = ShippingAddress & {
  document_type?: 'invoice' | 'receipt'
  tax_id?: string
  legal_name?: string
  cost_center?: string
  /** Tipo del documento del adquirente: `ruc` (factura) o `dni`/`ce`/`passport` (boleta). */
  id_type?: 'ruc' | 'dni' | 'ce' | 'passport'
}

const BILLING_EXTRA = ['document_type', 'tax_id', 'legal_name', 'cost_center', 'id_type'] as const

/**
 * Tipo de documento del adquirente (2026-11-15): `ruc` en factura; `dni`,
 * `ce` (carné de extranjería) o `passport` en boleta. Mismas reglas que
 * `src/shared/lib/peruDocs.ts`, que solo adelanta el aviso en la pantalla.
 */
const ID_TYPES = ['ruc', 'dni', 'ce', 'passport'] as const
type IdType = (typeof ID_TYPES)[number]

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/** RUC: 11 dígitos, prefijo de contribuyente y dígito verificador (módulo 11). */
export function isValidRuc(value: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(value)) return false
  const suma = PESOS_RUC.reduce((total, peso, i) => total + peso * Number(value[i]), 0)
  const resto = 11 - (suma % 11)
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto
  return verificador === Number(value[10])
}

function documentoValido(type: IdType, value: string): boolean {
  if (type === 'ruc') return isValidRuc(value)
  if (type === 'dni') return /^\d{8}$/.test(value)
  if (type === 'ce') return /^[A-Z0-9]{8,12}$/.test(value)
  return /^[A-Z0-9]{6,15}$/.test(value)
}

export function normalizeBillingAddress(raw: unknown): BillingAddress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('CAMPO_INVALIDO', '`billing_address` debe ser un objeto')
  }
  const source = raw as Record<string, unknown>
  const direccion: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!(BILLING_EXTRA as readonly string[]).includes(key)) direccion[key] = value
  }
  const normalized: BillingAddress = { ...normalizeShippingAddress(direccion) }

  const texto = (key: 'tax_id' | 'legal_name' | 'cost_center', min: number, max: number) => {
    const value = source[key]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') throw badRequest('CAMPO_INVALIDO', `\`billing_address.${key}\` debe ser texto`)
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (trimmed.length < min || trimmed.length > max) {
      throw badRequest('CAMPO_INVALIDO', `\`billing_address.${key}\` debe tener entre ${min} y ${max} caracteres`)
    }
    return trimmed
  }

  const documentType = source.document_type
  if (documentType !== undefined && documentType !== null) {
    if (documentType !== 'invoice' && documentType !== 'receipt') {
      throw badRequest('CAMPO_INVALIDO', '`billing_address.document_type` debe ser `invoice` o `receipt`')
    }
    normalized.document_type = documentType
  }

  const taxId = texto('tax_id', 3, 20)
  if (taxId !== undefined) {
    if (!/^[0-9A-Za-z-]+$/.test(taxId)) {
      throw badRequest('CAMPO_INVALIDO', '`billing_address.tax_id` solo admite letras, dígitos y guiones')
    }
    normalized.tax_id = taxId.toUpperCase()
  }
  const legalName = texto('legal_name', 2, 200)
  if (legalName !== undefined) normalized.legal_name = legalName
  const costCenter = texto('cost_center', 1, 60)
  if (costCenter !== undefined) normalized.cost_center = costCenter

  const rawIdType = source.id_type
  if (rawIdType !== undefined && rawIdType !== null) {
    if (typeof rawIdType !== 'string' || !(ID_TYPES as readonly string[]).includes(rawIdType)) {
      throw badRequest('CAMPO_INVALIDO', '`billing_address.id_type` debe ser `ruc`, `dni`, `ce` o `passport`')
    }
    normalized.id_type = rawIdType as IdType
  }

  // Una factura sin RUC o sin razón social no se puede emitir: se rechaza aquí
  // y no cuando alguien intente facturar el pedido.
  if (normalized.document_type === 'invoice' && (!normalized.tax_id || !normalized.legal_name)) {
    throw badRequest('CAMPO_INVALIDO', 'La factura necesita `tax_id` y `legal_name`')
  }
  // Factura = RUC, y un RUC con su dígito verificador (2026-11-15).
  if (normalized.document_type === 'invoice') {
    if (normalized.id_type !== undefined && normalized.id_type !== 'ruc') {
      throw badRequest('CAMPO_INVALIDO', 'La factura se emite a un RUC')
    }
    normalized.id_type = 'ruc'
  }
  if (normalized.tax_id && normalized.id_type && !documentoValido(normalized.id_type, normalized.tax_id)) {
    throw badRequest('CAMPO_INVALIDO', `\`billing_address.tax_id\` no es un ${normalized.id_type.toUpperCase()} valido`)
  }

  return normalized
}
