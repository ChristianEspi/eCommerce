import { z } from 'zod'
import type { MessageKey } from '@/shared/i18n/messages'
import { UiError } from '@/shared/lib/appError'
import { CHECKOUT_FUNCTION, CREATE_ORDER_FUNCTION } from '@/shared/lib/db-schema'
import { failureFromInvokeError } from '@/shared/lib/edgeError'
import { moneyText } from '@/shared/lib/money'
import { tryGetStorefrontClient, tryGetSupabaseClient } from '@/shared/lib/supabase'
import { toOrderItems, type Cart } from './cart/cart'

export { CREATE_ORDER_FUNCTION, CHECKOUT_FUNCTION }

/**
 * Checkout del storefront (P07-SaaS).
 *
 * Cuatro datos obligatorios —nombre, correo, teléfono y dirección— y una
 * referencia opcional. Sigue sin haber pasarela de pago: el pedido nace en
 * `pending` y la tienda lo cobra por su canal.
 *
 * Lo que NO viaja en esta petición es tan importante como lo que viaja: ni
 * precios de cobro, ni subtotal, ni total, ni moneda, ni `store_id`, ni
 * `organization_id`. El servidor resuelve la tienda por el slug de la URL y
 * vuelve a leer los precios de la base. El carrito del navegador es una lista
 * de deseos, no una factura.
 *
 * ## Lo que cambia respecto de P06, y es toda la fase
 *
 * **Cada intento lleva una clave de idempotencia.** La genera el navegador con
 * el generador de números aleatorios criptográfico y viaja en el cuerpo; el
 * servidor la ancla en `checkout_intents`. Repetir la misma petición —porque se
 * perdió la respuesta, porque alguien hizo doble clic, porque el móvil cambió
 * de red a mitad— devuelve **el mismo pedido**, no uno nuevo.
 *
 * El botón deshabilitado sigue estando, pero como cortesía: no es seguridad y
 * no se confía en él. Quien mande la petición dos veces desde una consola
 * obtiene exactamente el mismo pedido.
 *
 * **Y sigue sin salir ni un céntimo del navegador.** El aviso de «el precio
 * cambió» no lo produce una lista de precios esperados dentro de la petición:
 * lo produce el servidor comparando la cotización vigente con el snapshot que
 * el propio motor escribió en el carrito. Por eso el cuerpo del checkout no
 * lleva ningún importe, y hay un test que lo comprueba sobre el cuerpo entero.
 */
export const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, 'store.checkout.error.name').max(200, 'store.checkout.error.name'),
  customerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'store.checkout.error.email'),
  customerPhone: z
    .string()
    .trim()
    .min(6, 'store.checkout.error.phone')
    .max(40, 'store.checkout.error.phone'),
  address: z
    .string()
    .trim()
    .min(3, 'store.checkout.error.address')
    .max(300, 'store.checkout.error.address'),
  reference: z.string().trim().max(200, 'store.checkout.error.reference').optional(),
  /**
   * Los cuatro campos de COBERTURA (P12-SaaS).
   *
   * Opcionales a propósito: una tienda que no ha configurado zonas no tiene por
   * qué pedirle el código postal a nadie, y exigirlos rompería el checkout
   * mínimo que funciona desde P06. Cuando sí hay zonas, son exactamente lo que
   * `ebim.delivery_zone_for` necesita para decir «ahí no llegamos».
   */
  city: z.string().trim().max(120, 'store.checkout.error.address').optional(),
  region: z.string().trim().max(120, 'store.checkout.error.address').optional(),
  postalCode: z.string().trim().max(12, 'store.checkout.error.address').optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'store.checkout.error.address')
    .optional()
    .or(z.literal('')),
  /**
   * CÓMO quiere recibirlo. Un código del comercio y nada más: ni importe, ni
   * transportista, ni almacén. Cuánto cuesta lo decide el servidor dos veces
   * —una para enseñárselo y otra, con la fila delante, para cobrárselo—.
   */
  deliveryMethodCode: z.string().trim().max(40).optional(),
  pickupPointId: z.string().uuid().optional().or(z.literal('')),
  /**
   * CÓMO quiere pagarlo (P09-SaaS). Un código del comercio, nada más.
   *
   * Opcional en el esquema porque el borde también lo trata como opcional: una
   * tienda sin `payment_methods` configurados sigue vendiendo, y exigirlo aquí
   * rompería el checkout mínimo que funciona desde P06. Cuando la tienda SÍ
   * tiene medios, la pantalla lo exige antes de enviar.
   *
   * No viaja ni el importe ni el proveedor: que el código corresponda a un medio
   * vivo de esta tienda lo decide `payment_intent_open`, que es quien tiene la
   * fila delante.
   */
  paymentMethodCode: z.string().trim().max(40).optional(),
  /**
   * El cupón que el comprador teclea (P10-SaaS).
   *
   * **Un solo campo, no cinco.** El motor admite hasta cinco códigos por
   * compra, pero un formulario que ofrece cinco casillas es un formulario que
   * invita a probar códigos; el caso real es uno. Y lo que se manda es TEXTO:
   * ni importe, ni campaña, ni «ya aplicado». Cuánto descuenta —o si descuenta
   * algo— lo decide el servidor cuando ya tiene la fila delante y bloqueada.
   */
  couponCode: z.string().trim().max(40, 'store.checkout.error.coupon').optional(),
})
export type CheckoutValues = z.infer<typeof checkoutSchema>

/** Respuesta del pipeline. Todo el dinero llega como texto decimal. */
export const orderResultSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string().min(1),
  // Secreto de portador del comprador: es lo unico que le permite volver a su
  // pedido tras recargar. Opcional para no romper una respuesta anterior al
  // despliegue de P11, que simplemente no traera enlace permanente.
  access_token: z.string().length(64).nullable().optional(),
  status: z.string().min(1),
  currency: z.string().length(3),
  subtotal: moneyText,
  tax_total: moneyText,
  // P12. Con la tienda sin métodos configurados es '0.00', que es lo que
  // devolvía P11: una respuesta anterior al despliegue simplemente no lo trae.
  shipping_total: moneyText.default('0.00'),
  /** Cómo y cuándo llega. `null` = no se eligió entrega, que no es «gratis». */
  delivery: z
    .object({
      method_code: z.string(),
      method_name: z.string(),
      strategy: z.string(),
      amount: moneyText.optional(),
      promised_from: z.string().nullable().optional(),
      promised_to: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  // P10. Con cero campañas es '0.00', que es lo que devolvía P07: una respuesta
  // anterior al despliegue simplemente no lo trae y el resumen no lo pinta.
  discount_total: moneyText.default('0.00'),
  grand_total: moneyText,
  /** Qué campañas rebajaron el pedido. Solo etiqueta e importe. */
  promotions: z
    .array(z.object({ code: z.string(), label: z.string(), amount: moneyText }))
    .default([]),
  /**
   * Qué pasó con el código tecleado. Es la mitad que casi nunca se devuelve, y
   * la única forma de que el comprador sepa por qué su cupón no hizo nada en
   * vez de suponer que el comercio se lo comió.
   */
  coupons: z.array(z.object({ code: z.string(), status: z.string() })).default([]),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        sku: z.string(),
        name: z.string(),
        unit_price: moneyText,
        quantity: z.union([z.number(), z.string()]).transform((value) => Number(value)),
      }),
    )
    .default([]),
  /** `true` = esta petición no creó nada: devolvió el pedido que ya existía. */
  replay: z.boolean().default(false),
  intent_id: z.string().uuid().optional(),
  payment_status: z.string().optional(),
})
export type OrderResult = z.infer<typeof orderResultSchema>

/**
 * Las once etapas, tal y como las nombra el servidor.
 *
 * Es una copia del enum `public.checkout_stage`, igual que la del orquestador
 * del borde. Aquí solo se usa para elegir un texto: `mapCheckoutStage` traduce
 * la etapa a «qué se estaba haciendo cuando falló», que es la diferencia entre
 * «algo salió mal» y «no pudimos apartar el stock».
 */
export const CHECKOUT_STAGES = [
  'resolve_context',
  'validate_account',
  'resolve_prices',
  'resolve_promotions',
  'calculate_taxes',
  'reserve_inventory',
  'validate_delivery',
  'authorize_payment',
  'create_order',
  'publish_events',
  'notify',
] as const
export type CheckoutStage = (typeof CHECKOUT_STAGES)[number]

export class CheckoutError extends UiError {
  /** En qué etapa del pipeline murió, si el servidor lo dijo. */
  readonly stage: CheckoutStage | null
  /**
   * Si el SERVIDOR aconseja reintentar. No se llama `retryable` porque
   * `AppError` ya expone uno derivado del `kind`, y dos propiedades con el
   * mismo nombre y distinto origen es como se acaba leyendo la que no era.
   */
  readonly retryAdvised: boolean

  constructor(
    key: MessageKey,
    code: string,
    options: { stage?: string | null; retryable?: boolean } = {},
  ) {
    super({ boundary: 'checkout', key, code })
    this.name = 'CheckoutError'
    this.stage = isStage(options.stage) ? options.stage : null
    this.retryAdvised = options.retryable ?? false
  }
}

function isStage(value: string | null | undefined): value is CheckoutStage {
  return typeof value === 'string' && (CHECKOUT_STAGES as readonly string[]).includes(value)
}

/**
 * El carrito de servidor al que apunta el token ya no existe.
 *
 * Pasa mas de lo que parece: el carrito de un invitado CADUCA (retencion de
 * carritos de invitado), y un entorno de demostracion se puede vaciar entero.
 * El token vive en `localStorage` del comprador, asi que sobrevive a la fila
 * que nombraba — y sin recuperacion deja a esa persona sin poder comprar hasta
 * que alguien le diga que borre datos del sitio.
 */
export const CART_GONE_CODE = 'CARRITO_NO_ENCONTRADO'

/** Códigos del servidor traducidos a algo que el comprador pueda hacer. */
export function mapCheckoutCode(code: string): MessageKey {
  switch (code) {
    case CART_GONE_CODE:
      return 'store.checkout.error.cartGone'
    case 'STOCK_INSUFICIENTE':
      return 'store.checkout.error.stock'
    case 'DISPONIBILIDAD_DESCONOCIDA':
      return 'store.checkout.error.stockUnknown'
    case 'PRECIO_CAMBIADO':
      return 'store.checkout.error.priceChanged'
    case 'PRODUCTO_NO_DISPONIBLE':
    case 'VARIANTE_NO_DISPONIBLE':
      return 'store.checkout.error.product'
    case 'PRODUCTO_FUERA_DE_CANAL':
      return 'store.checkout.error.channel'
    case 'CANAL_EXIGE_SESION':
    case 'CANAL_NO_PUBLICO':
      return 'store.checkout.error.channelAuth'
    case 'COMPRA_EXIGE_SESION':
      return 'store.checkout.error.needsAccount'
    case 'LIMITE_DE_AUTORIZACION':
      return 'store.checkout.error.spendingLimit'
    case 'PAGO_RECHAZADO':
      return 'store.checkout.error.payment'
    case 'DIRECCION_NO_ENTREGABLE':
    case 'FUERA_DE_COBERTURA':
      return 'store.checkout.error.delivery'
    case 'ENTREGA_NO_DISPONIBLE':
    case 'ENTREGA_NO_INDICADA':
      return 'store.checkout.error.delivery.method'
    case 'PUNTO_DE_RECOJO_REQUERIDO':
    case 'PUNTO_DE_RECOJO_NO_VALIDO':
    case 'PUNTO_DE_RECOJO_NO_APLICA':
      return 'store.checkout.error.delivery.pickup'
    case 'LIMITE_DE_PEDIDOS':
      return 'store.checkout.error.rateLimit'
    case 'CHECKOUT_EN_CURSO':
      return 'store.checkout.error.inFlight'
    case 'IDEMPOTENCIA_EN_CONFLICTO':
      return 'store.checkout.error.idempotency'
    case 'TIENDA_NO_DISPONIBLE':
      return 'store.checkout.error.store'
    case 'ITEMS_REQUERIDOS':
      return 'store.checkout.error.emptyCart'
    case 'MONEDA_INCONSISTENTE':
    case 'CAMPO_INVALIDO':
    case 'CAMPO_NO_PERMITIDO':
    case 'TENANT_NO_ADMITIDO':
    case 'CANTIDAD_INVALIDA':
    case 'IDEMPOTENCIA_INVALIDA':
      return 'store.checkout.error.invalid'
    default:
      return 'store.checkout.error.generic'
  }
}

/**
 * Qué pasó con el cupón, en texto humano.
 *
 * Devuelve una CLAVE de i18n, nunca el estado crudo del servidor: los estados
 * son vocabulario del motor (`no_aplicable`, `agotado_para_ti`) y sirven para
 * diagnosticar, no para enseñárselos a quien está pagando.
 */
export function mapCouponStatus(status: string): MessageKey {
  switch (status) {
    case 'aplicado':
      return 'store.checkout.coupon.applied'
    case 'no_existe':
      return 'store.checkout.coupon.unknown'
    case 'inactivo':
    case 'fuera_de_vigencia':
      return 'store.checkout.coupon.expired'
    case 'agotado':
    case 'agotado_para_ti':
      return 'store.checkout.coupon.usedUp'
    case 'no_aplicable':
      return 'store.checkout.coupon.notApplicable'
    default:
      return 'store.checkout.coupon.unknown'
  }
}

/** Qué se estaba haciendo. Es la mitad del mensaje que un comprador entiende. */
export function mapCheckoutStage(stage: CheckoutStage | null): MessageKey | null {
  switch (stage) {
    case 'resolve_prices':
    case 'calculate_taxes':
      return 'store.checkout.stage.prices'
    case 'reserve_inventory':
      return 'store.checkout.stage.stock'
    case 'validate_delivery':
      return 'store.checkout.stage.delivery'
    case 'authorize_payment':
      return 'store.checkout.stage.payment'
    case 'create_order':
      return 'store.checkout.stage.order'
    default:
      return null
  }
}

/**
 * Clave de idempotencia: 32 bytes del generador CRIPTOGRÁFICO del navegador,
 * en hexadecimal.
 *
 * `Math.random()` no vale y no es purismo: dos pestañas abiertas en el mismo
 * milisegundo pueden producir la misma secuencia, y una colisión aquí no es un
 * duplicado — es que la segunda compra recibiría el pedido de la primera. El
 * servidor exige además que el resumen de la petición coincida, así que una
 * colisión daría `IDEMPOTENCIA_EN_CONFLICTO` en vez de un pedido cruzado; aun
 * así, la clave se genera bien desde el principio.
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface StartCheckoutInput extends CheckoutValues {
  /**
   * El instrumento ya TOKENIZADO por la pasarela, cuando el medio lo pide.
   *
   * No es un dato de tarjeta: es la referencia de un solo uso que Culqi
   * devuelve a cambio de uno, creada contra sus servidores desde el propio
   * navegador. El numero no pasa por aqui, ni por el borde, ni por la base.
   */
  paymentToken?: string | null
  /** Slug de la URL pública. La tienda la resuelve el servidor a partir de él. */
  storeSlug: string
  cart: Cart
  /** La misma en cada reintento del MISMO intento de compra. */
  idempotencyKey: string
  /** Carrito del servidor que se convierte en pedido, si lo hay. */
  cartToken?: string | null
  /** El comprador ya vio el precio nuevo y sigue adelante. */
  acceptPriceChanges?: boolean
  /**
   * Aviso de que el token de carrito estaba muerto. Quien lo guarda —el
   * proveedor del carrito— es el unico que puede tirarlo del almacenamiento.
   */
  onCartGone?: () => void
  /** Con sesión, la petición viaja con el JWT para poder resolver su cuenta B2B. */
  authenticated?: boolean
}

/**
 * La dirección tal y como viaja: solo los campos con contenido.
 *
 * Mandar `city: ''` y `city` ausente tienen que dar el MISMO resumen de
 * petición, o el mismo carrito parecería dos compras distintas según si el
 * comprador tocó el campo y lo borró.
 */
export function shippingAddressOf(values: CheckoutValues): Record<string, string> {
  const address: Record<string, string> = { address: values.address }
  if (values.reference) address.reference = values.reference
  if (values.city) address.city = values.city
  if (values.region) address.region = values.region
  if (values.postalCode) address.postal_code = values.postalCode
  if (values.country) address.country = values.country
  return address
}

export async function startCheckout(input: StartCheckoutInput): Promise<OrderResult> {
  // Con sesión hace falta el cliente que la lleva: es lo único que permite al
  // servidor resolver la cuenta B2B del comprador (`my_business_accounts()`).
  // Sin sesión, el cliente anónimo de la vitrina, como todo lo demás.
  const client = input.authenticated ? tryGetSupabaseClient() : tryGetStorefrontClient()
  if (!client) throw new CheckoutError('store.checkout.error.generic', 'CONFIG_INCOMPLETA')
  // Se ata a una constante para que el cierre de `invoke` no vuelva a dudar de
  // que existe: dentro de una funcion anidada, TypeScript pierde el estrechado.
  const supabase = client

  const items = toOrderItems(input.cart)
  if (items.length === 0) {
    throw new CheckoutError('store.checkout.error.emptyCart', 'ITEMS_REQUERIDOS')
  }

  async function invoke(cartToken: string | null) {
    return supabase.functions.invoke<{ data: unknown }>(CHECKOUT_FUNCTION, {
    body: {
      store_slug: input.storeSlug,
      idempotency_key: input.idempotencyKey,
      cart_token: cartToken,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      shipping_address: shippingAddressOf(input),
      // P12. La ELECCIÓN de entrega, sin un solo importe dentro. `null` cuando
      // la tienda no tiene métodos: el pedido nace con transporte cero, que es
      // exactamente lo que hacía antes de esta fase.
      delivery: input.deliveryMethodCode
        ? {
            method_code: input.deliveryMethodCode,
            pickup_point_id: input.pickupPointId ? input.pickupPointId : null,
          }
        : null,
      // P09. El medio elegido, por código. Se omite cuando no hay elección —una
      // tienda sin medios configurados—: el borde lo trata como opcional y el
      // pedido nace sin intento de pago, que es lo que hacía hasta ahora.
      //
      // No entra en el `request_hash` del servidor a propósito: el medio es CÓMO
      // se paga, no QUÉ se compra, y si entrara, quien ve rechazada su tarjeta no
      // podría reintentar con transferencia sin que se leyera como otra compra.
      ...(input.paymentMethodCode ? { payment_method_code: input.paymentMethodCode } : {}),
      // El token del instrumento. Se omite cuando no hay: un `null` seria
      // «no tokenizo», que es distinto de «no se pregunto».
      ...(input.paymentToken ? { payment_token: input.paymentToken } : {}),
      items,
      accept_price_changes: input.acceptPriceChanges === true,
      // P10. La lista viaja vacía cuando no se tecleó nada: un `[]` es «no hay
      // cupón», que es distinto de «no se preguntó».
      coupon_codes: input.couponCode ? [input.couponCode] : [],
    },
    })
  }

  let { data, error } = await invoke(input.cartToken ?? null)

  if (error) {
    let failure = await failureFromInvokeError(error)

    /**
     * El carrito de servidor ya no esta: se sigue SIN el.
     *
     * El token es un ancla, no la compra: las lineas viajan en el cuerpo de la
     * peticion, asi que lo unico que se pierde al soltarlo es marcar ese
     * carrito como convertido y el aviso de cambio de precio. Cambiar eso por
     * «no pudimos registrar el pedido» seria perder la venta por un dato
     * accesorio.
     *
     * Se reintenta UNA vez y solo por este codigo. La clave de idempotencia es
     * la misma a proposito: si el primer intento hubiese llegado a crear el
     * pedido, el servidor devuelve ese y no un segundo.
     */
    if (failure.code === CART_GONE_CODE && input.cartToken) {
      input.onCartGone?.()
      ;({ data, error } = await invoke(null))
      failure = error ? await failureFromInvokeError(error) : failure
    }

    if (error) {
      throw new CheckoutError(mapCheckoutCode(failure.code), failure.code, {
        stage: failure.stage,
        retryable: failure.retryable,
      })
    }
  }

  const parsed = orderResultSchema.safeParse(data?.data)
  if (!parsed.success) {
    throw new CheckoutError('store.checkout.error.generic', 'RESPUESTA_INVALIDA')
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Recuperación tras una recarga
// ---------------------------------------------------------------------------

const ATTEMPT_PREFIX = 'ebim.ecommerce.checkout-attempt.v1'

export interface PendingAttempt {
  key: string
  startedAt: number
}

/**
 * El intento en curso, en `sessionStorage`.
 *
 * **Solo la clave y la hora.** Ni el nombre, ni el correo, ni el teléfono, ni
 * la dirección: guardar los datos de contacto para poder reenviar solos sería
 * dejar datos personales en el navegador para ahorrarle al comprador rellenar
 * un formulario que ya tiene delante.
 *
 * Lo que esto compra es lo importante: si el comprador recarga sin saber si su
 * pedido llegó a existir, al reenviar se usa **la misma clave** y el servidor
 * devuelve el pedido que ya había en vez de crear el segundo. La pantalla se lo
 * dice antes, para que no tenga que adivinarlo.
 *
 * `sessionStorage` y no `localStorage`: el intento muere con la pestaña, que es
 * exactamente lo que dura.
 */
function attemptStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function attemptStorageKey(storeSlug: string): string {
  return `${ATTEMPT_PREFIX}:${storeSlug}`
}

/** Un intento deja de ser recuperable pasada media hora. */
const ATTEMPT_TTL_MS = 30 * 60 * 1000

export function readPendingAttempt(storeSlug: string): PendingAttempt | null {
  const store = attemptStorage()
  if (!store) return null
  try {
    const raw = store.getItem(attemptStorageKey(storeSlug))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const result = z
      .object({ key: z.string().regex(/^[a-f0-9]{64}$/), startedAt: z.number() })
      .safeParse(parsed)
    if (!result.success) return null
    if (Date.now() - result.data.startedAt > ATTEMPT_TTL_MS) return null
    return result.data
  } catch {
    return null
  }
}

export function writePendingAttempt(storeSlug: string, attempt: PendingAttempt): void {
  const store = attemptStorage()
  if (!store) return
  try {
    store.setItem(attemptStorageKey(storeSlug), JSON.stringify(attempt))
  } catch {
    /* almacenamiento bloqueado: se pierde la recuperación, no la compra */
  }
}

export function clearPendingAttempt(storeSlug: string): void {
  const store = attemptStorage()
  if (!store) return
  try {
    store.removeItem(attemptStorageKey(storeSlug))
  } catch {
    /* nada que hacer */
  }
}
