/**
 * Validación del cuerpo del checkout y **el resumen de la petición**.
 *
 * El resumen (`request_hash`) es la mitad menos obvia de la idempotencia. La
 * clave sola dice «esta es la misma petición»; el hash lo *comprueba*. Sin él:
 *
 *  · un cliente con un error de programación podría reusar la clave para una
 *    compra distinta y recibir el pedido anterior como si fuera el suyo;
 *  · y quien adivinara una clave ajena obtendría el resultado guardado, que
 *    incluye el token de acceso al pedido.
 *
 * Con él, las dos cosas exigen además reproducir exactamente lo que se pidió.
 *
 * El hash tiene que ser **canónico**: el mismo carrito escrito en otro orden de
 * líneas o de claves JSON tiene que dar el mismo resumen, o el reintento del
 * navegador —que reserializa— se leería como una petición distinta y crearía el
 * segundo pedido que todo esto existe para impedir.
 */
import { badRequest } from '../errors.ts'
import { normalizeOrderItems, normalizeShippingAddress, type OrderItemInput } from '../orders.ts'
import {
  optionalText,
  rejectUnknownFields,
  requireEmail,
  requireSlug,
  requireText,
} from '../validation.ts'
import type { CheckoutRequest, DeliveryChoice } from './ports.ts'

export const CHECKOUT_ALLOWED_FIELDS = [
  'store_slug',
  'idempotency_key',
  'cart_token',
  'customer_email',
  'customer_name',
  'customer_phone',
  'items',
  'shipping_address',
  // P08: direccion FISCAL. Opcional, y si no viene se factura donde se
  // entrega. Es una direccion, no un importe: puede venir del comprador.
  'billing_address',
  'notes',
  'accept_price_changes',
  // P09: QUE medio de pago eligio el comprador. Un codigo del comercio, no una
  // instruccion de cobro: sin importe, sin proveedor y sin credencial.
  'payment_method_code',
  // P09: el instrumento ya TOKENIZADO por la pasarela en el navegador.
  // No es un dato de tarjeta: es la referencia de un solo uso que la
  // pasarela devuelve a cambio de uno, y por eso puede cruzar el servidor
  // sin meterlo en el alcance de PCI.
  'payment_token',
  // P10: los codigos que el comprador tecleo. Dos listas y no una porque son
  // dos cosas distintas: el cupon cambia el PRECIO y la tarjeta paga una PARTE
  // del precio. Ninguno de los dos lleva importe.
  'coupon_codes',
  'gift_card_codes',
  // P12: COMO quiere que le llegue. Un codigo de metodo del comercio, un punto
  // de recojo y una franja. Ni importe, ni transportista, ni almacen: cuanto
  // cuesta lo decide el servidor con la tarifa delante.
  'delivery',
] as const

/** Mismo formato que `checkout_intents_key_fmt` en la base. */
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{24,200}$/
const TOKEN_RE = /^[a-f0-9]{64}$/i

export function requireIdempotencyKey(body: Record<string, unknown>): string {
  const raw = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : ''
  if (!IDEMPOTENCY_RE.test(raw)) {
    throw badRequest(
      'IDEMPOTENCIA_INVALIDA',
      'Falta `idempotency_key`: un texto de 24 a 200 caracteres seguros para URL, generado al azar por el cliente',
    )
  }
  return raw
}

export function optionalCartToken(body: Record<string, unknown>): string | null {
  const raw = typeof body.cart_token === 'string' ? body.cart_token.trim() : ''
  if (raw === '') return null
  if (!TOKEN_RE.test(raw)) {
    throw badRequest('CAMPO_INVALIDO', '`cart_token` no tiene la forma de un token de carrito')
  }
  return raw.toLowerCase()
}

/** Mismo formato que `payment_methods_code_fmt` en la base (P09). */
const METHOD_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/

/**
 * El medio de pago elegido.
 *
 * Se valida la FORMA aquí y la EXISTENCIA en la base: que el código
 * corresponda a un medio activo de esa tienda lo decide `payment_intent_open`,
 * que es quien tiene delante la fila y el tenant. Comprobarlo aquí sería una
 * segunda autoridad sobre el mismo dato, y la del borde siempre acaba
 * desactualizada respecto a la de la fila.
 *
 * NO entra en el `request_hash`: el medio de pago es CÓMO se paga, no QUÉ se
 * compra. Si entrara, un comprador cuya tarjeta se rechaza no podría reintentar
 * con transferencia sin que el intento se leyera como otra compra.
 */
/**
 * El token del instrumento, si el medio lo necesita.
 *
 * Se comprueba la FORMA y nada mas: que sea texto corto y sin espacios. Que
 * el token exista, no haya caducado y corresponda a esta tienda lo decide la
 * pasarela, que es la unica que puede saberlo — validarlo aqui seria una
 * segunda autoridad sobre un dato que no es nuestro.
 *
 * NO entra en el `request_hash`, igual que el medio de pago: reintentar la
 * misma compra con otra tarjeta despues de un rechazo tiene que seguir
 * siendo la misma compra.
 */
const PAYMENT_TOKEN_RE = /^[A-Za-z0-9_-]{6,120}$/

export function optionalPaymentToken(body: Record<string, unknown>): string | null {
  const raw = typeof body.payment_token === 'string' ? body.payment_token.trim() : ''
  if (raw === '') return null
  if (!PAYMENT_TOKEN_RE.test(raw)) {
    throw badRequest('CAMPO_INVALIDO', '`payment_token` no tiene la forma de un token de pago')
  }
  return raw
}

export function optionalPaymentMethodCode(body: Record<string, unknown>): string | null {
  const raw = typeof body.payment_method_code === 'string' ? body.payment_method_code.trim() : ''
  if (raw === '') return null
  const normalized = raw.toLowerCase()
  if (!METHOD_CODE_RE.test(normalized)) {
    throw badRequest('CAMPO_INVALIDO', '`payment_method_code` no tiene la forma de un medio de pago')
  }
  return normalized
}

/**
 * Los códigos tecleados por el comprador (P10).
 *
 * Se normalizan aquí IGUAL que en la base —mayúsculas y solo alfanumérico, la
 * misma regla que `coupons.code_normalized`— por una razón concreta: el hash de
 * la petición se calcula sobre esta lista, y si «verano-25» y «VERANO25»
 * dieran resúmenes distintos, el mismo carrito con el mismo cupón parecería dos
 * compras distintas según cómo lo hubiera tecleado el comprador.
 *
 * La validez NO se comprueba aquí: que el código exista, esté vigente y le
 * quede uso lo decide la base con la fila delante. Comprobarlo en el borde
 * sería una segunda autoridad sobre el mismo dato, y la del borde siempre acaba
 * desactualizada respecto a la de la fila.
 */
function codeList(
  body: Record<string, unknown>,
  field: 'coupon_codes' | 'gift_card_codes',
  max: number,
): string[] {
  const raw = body[field]
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw badRequest('CAMPO_INVALIDO', `\`${field}\` tiene que ser una lista de codigos`)
  }
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw badRequest('CAMPO_INVALIDO', `\`${field}\` solo admite texto`)
    }
    const normalized = entry.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized === '') continue
    if (normalized.length > 40) {
      throw badRequest('CAMPO_INVALIDO', `Un codigo de \`${field}\` es demasiado largo`)
    }
    seen.add(normalized)
  }
  if (seen.size > max) {
    throw badRequest('CODIGOS_EXCESIVOS', `Como maximo ${max} codigos en \`${field}\``)
  }
  // Ordenados: la lista es un CONJUNTO, y el orden en que el comprador los
  // tecleo no puede cambiar el resumen de la peticion.
  return [...seen].sort()
}

/**
 * Serialización CANÓNICA: claves ordenadas y líneas ordenadas por su terna.
 * Es lo que hace que el mismo carrito dé siempre el mismo resumen aunque el
 * navegador reserialice en otro orden.
 */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function itemKey(item: OrderItemInput): string {
  return `${item.product_id}|${item.variant_id ?? ''}|${item.uom_code ?? ''}`
}

/**
 * SHA-256 en hexadecimal. `crypto.subtle` es estándar de la plataforma: existe
 * igual en Deno y en Node, así que la misma función corre en el borde y en los
 * tests sin un polyfill que pudiera calcular otra cosa.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Mismo formato que `delivery_methods_code_fmt` en la base (P12). */
const DELIVERY_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

/**
 * La elección de entrega (P12).
 *
 * Se valida la FORMA aquí y todo lo demás en la base: que el método exista y
 * esté activo, que cubra la dirección, que el punto de recojo sea de esa tienda
 * y cuánto cuesta lo decide `ebim.quote_delivery_choice`, que tiene las filas
 * delante. Comprobarlo aquí sería una segunda autoridad sobre el mismo dato, y
 * la del borde siempre acaba desactualizada respecto a la de la fila.
 *
 * **No lleva importe y no puede llevarlo**: `amount`, `price` o `cost` dentro
 * de este objeto se rechazan como campo no permitido, igual que en el resto del
 * cuerpo. El envío gratis no lo declara el navegador.
 */
export function optionalDelivery(body: Record<string, unknown>): DeliveryChoice | null {
  const raw = body.delivery
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('CAMPO_INVALIDO', '`delivery` debe ser un objeto')
  }

  const source = raw as Record<string, unknown>
  rejectUnknownFields(source, ['method_code', 'pickup_point_id', 'window'])

  const methodCode =
    typeof source.method_code === 'string' ? source.method_code.trim().toLowerCase() : ''
  if (!DELIVERY_CODE_RE.test(methodCode)) {
    throw badRequest('CAMPO_INVALIDO', '`delivery.method_code` no tiene la forma de un metodo de entrega')
  }

  let pickupPointId: string | null = null
  if (source.pickup_point_id !== undefined && source.pickup_point_id !== null) {
    const value = typeof source.pickup_point_id === 'string' ? source.pickup_point_id.trim() : ''
    if (!UUID_RE.test(value)) {
      throw badRequest('CAMPO_INVALIDO', '`delivery.pickup_point_id` no es un identificador valido')
    }
    pickupPointId = value.toLowerCase()
  }

  let window: DeliveryChoice['window'] = null
  if (source.window !== undefined && source.window !== null) {
    if (typeof source.window !== 'object' || Array.isArray(source.window)) {
      throw badRequest('CAMPO_INVALIDO', '`delivery.window` debe ser un objeto')
    }
    const slot = source.window as Record<string, unknown>
    rejectUnknownFields(slot, ['date', 'starts_at', 'ends_at'])
    const date = typeof slot.date === 'string' ? slot.date.trim() : ''
    const startsAt = typeof slot.starts_at === 'string' ? slot.starts_at.trim() : ''
    const endsAt = typeof slot.ends_at === 'string' ? slot.ends_at.trim() : ''
    if (!DATE_RE.test(date) || !TIME_RE.test(startsAt) || !TIME_RE.test(endsAt)) {
      throw badRequest('CAMPO_INVALIDO', '`delivery.window` necesita date, starts_at y ends_at')
    }
    window = { date, startsAt, endsAt }
  }

  return { methodCode, pickupPointId, window }
}

/**
 * El resumen de LO QUE SE PIDIÓ.
 *
 * Entra: tienda, líneas (ordenadas), contacto, dirección y notas. NO entra la
 * clave de idempotencia —sería circular— ni el token del carrito ni
 * `accept_price_changes`: aceptar un precio nuevo es la misma compra, y si
 * entrara en el hash, confirmar el cambio se leería como una petición distinta
 * y crearía un segundo pedido. Ese es justo el fallo que la fase pide evitar.
 */
export async function requestHash(input: {
  storeSlug: string
  items: readonly OrderItemInput[]
  customerEmail: string
  customerName: string
  customerPhone: string
  shippingAddress: Record<string, unknown>
  billingAddress: Record<string, unknown> | null
  notes: string | null
  /** Omitirlo y pasar `[]` dan el MISMO resumen: no hay dos formas de «sin cupón». */
  couponCodes?: readonly string[]
  /** P12. Omitirlo y pasar `null` dan el MISMO resumen. */
  delivery?: DeliveryChoice | null
}): Promise<string> {
  const ordered = [...input.items].sort((a, b) => (itemKey(a) < itemKey(b) ? -1 : 1))
  return await sha256Hex(
    canonical({
      store_slug: input.storeSlug.toLowerCase(),
      items: ordered.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        uom_code: item.uom_code ?? null,
        quantity: item.quantity,
      })),
      customer_email: input.customerEmail.toLowerCase(),
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
      shipping_address: input.shippingAddress,
      // Entra en el resumen: cambiar la direccion fiscal ES pedir otra cosa, y
      // reusar la clave con otra factura tiene que dar conflicto y no la
      // respuesta guardada del pedido anterior.
      billing_address: input.billingAddress,
      notes: input.notes,
      // Los cupones SÍ entran en el resumen: añadir un cupón cambia lo que se
      // paga, así que es otra petición. Reusar la misma clave con otro cupón
      // tiene que dar conflicto y no devolver el pedido anterior —que se
      // cobró por otro importe—.
      //
      // Las tarjetas regalo NO entran, por la misma razón que
      // `payment_method_code`: son CÓMO se paga, no QUÉ se compra. Si entraran,
      // un comprador cuya tarjeta se quedó sin saldo no podría reintentar con
      // otra sin que el intento se leyera como una compra distinta.
      coupon_codes: input.couponCodes ?? [],
      // La ENTREGA sí entra en el resumen, por la misma razón que los cupones y
      // por la contraria que el medio de pago: cambiar de método cambia lo que
      // se paga, así que es otra petición. Reusar la misma clave con otro
      // método tiene que dar conflicto y no devolver el pedido anterior, que se
      // cobró con otro transporte.
      delivery: input.delivery ?? null,
    }),
  )
}

export interface ParsedCheckoutBody extends CheckoutRequest {
  readonly acceptPriceChanges: boolean
}

/**
 * El cuerpo entero, validado. Rechaza campos desconocidos ANTES de normalizar,
 * por la misma razón de siempre: descartar en silencio un intento de ponerse
 * precio es el fallo que no se quiere que pase inadvertido.
 */
export async function parseCheckoutBody(
  body: Record<string, unknown>,
): Promise<ParsedCheckoutBody> {
  rejectUnknownFields(body, CHECKOUT_ALLOWED_FIELDS)

  const storeSlug = requireSlug(body, 'store_slug')
  const items = normalizeOrderItems(body.items)
  const customerEmail = requireEmail(body, 'customer_email')
  const customerName = requireText(body, 'customer_name', { min: 2, max: 200 })
  const customerPhone = requireText(body, 'customer_phone', { min: 6, max: 40 })
  const shippingAddress = normalizeShippingAddress(body.shipping_address)
  const billingAddress =
    body.billing_address === undefined || body.billing_address === null
      ? null
      : normalizeShippingAddress(body.billing_address)
  const notes = optionalText(body, 'notes', 1000)
  const paymentMethodCode = optionalPaymentMethodCode(body)
  const paymentToken = optionalPaymentToken(body)
  // Cinco cupones es el mismo tope que impone `ebim.evaluate_promotions`, y no
  // es una limitación técnica: más de cinco códigos en un carrito es un intento
  // de probar códigos, no una compra. Tres tarjetas regalo es lo que cabe en un
  // pago partido razonable.
  const couponCodes = codeList(body, 'coupon_codes', 5)
  const giftCardCodes = codeList(body, 'gift_card_codes', 3)
  const delivery = optionalDelivery(body)

  const hash = await requestHash({
    storeSlug,
    items,
    customerEmail,
    customerName,
    customerPhone,
    shippingAddress: { ...shippingAddress },
    billingAddress: billingAddress === null ? null : { ...billingAddress },
    notes: notes ?? null,
    couponCodes,
    delivery,
  })

  return {
    storeSlug,
    idempotencyKey: requireIdempotencyKey(body),
    requestHash: hash,
    cartToken: optionalCartToken(body),
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    billingAddress,
    notes: notes ?? null,
    items,
    paymentMethodCode,
    paymentToken,
    couponCodes,
    giftCardCodes,
    delivery,
    acceptPriceChanges: body.accept_price_changes === true,
  }
}
