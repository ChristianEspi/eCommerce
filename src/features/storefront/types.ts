import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { moneyText } from '@/shared/lib/money'
import { BRAND_FONTS, BRAND_RADII, DENSITIES } from '@/theme/tokens'

/**
 * Vitrina pública. Todo lo que hay aquí sale de las vistas
 * `public_*` de `20260827090500` + `20260827091200`: solo columnas publicables,
 * solo tienda activa, categoría activa y producto publicado.
 *
 * Nada de esto lleva `organization_id` ni `company_id`, y no por descuido: el
 * comprador anónimo no tiene por qué saber a qué cuenta del hub pertenece la
 * tienda que está mirando, y la vista tampoco se lo sirve.
 */

/**
 * Vistas del modelo de lectura público y buckets privados (la vitrina lee por
 * URL firmada, no por URL pública). Fuente única: `shared/lib/db-schema.ts`.
 */
export {
  PUBLIC_STORES_VIEW,
  PUBLIC_CATEGORIES_VIEW,
  PUBLIC_PRODUCTS_VIEW,
  PUBLIC_PRODUCT_IMAGES_VIEW,
  PUBLIC_PRODUCT_VARIANTS_VIEW,
  PRODUCT_IMAGES_BUCKET,
  STORE_ASSETS_BUCKET,
} from '@/shared/lib/db-schema'

/** Hex #RRGGBB o nada. Un valor raro se descarta y se cae al acento de suite. */
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable()
  .catch(null)

/**
 * Referencia de branding: una URL `https://` externa (el "logo-auto" del
 * contrato §4.3) o una ruta del bucket privado `store-assets`
 * (`{organization_id}/{store_id}/branding/...`).
 *
 * Cualquier otra cosa se descarta y la vitrina cae al fallback neutral. El
 * filtro NO es cosmético: sin él, un `javascript:` o un `http://` guardado en
 * `logo_url` acabaría en el `src` de un `<img>` del dominio de la tienda.
 */
const ASSET_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/i

const assetRef = z
  .string()
  .refine((value) => /^https:\/\//i.test(value) || ASSET_PATH_RE.test(value))
  .nullable()
  .catch(null)

/**
 * Identidad de la tienda. TODO campo es opcional salvo el nombre y el slug: una
 * tienda recién creada no tiene logo ni banner y la vitrina tiene que verse
 * bien igual, con el fallback neutral de los tokens de suite.
 */
export const publicStoreSchema = z.object({
  store_id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().length(3),
  accent_color: hexColor,
  logo_url: assetRef,
  white_label: z.boolean().nullable().default(false),
  default_locale: z.string().nullable().default(null),
  support_email: z.string().nullable().default(null),
  banner_url: assetRef,
  hero_title: z.string().nullable().default(null),
  hero_subtitle: z.string().nullable().default(null),
  contact_phone: z.string().nullable().default(null),
  contact_address: z.string().nullable().default(null),
  /**
   * White-label por tokens (P11-SaaS). Los cuatro son `default(null)` y no
   * `optional`: una respuesta anterior al despliegue de esta fase se lee como
   * la tienda sin white-label que era, sin que ninguna pantalla compruebe
   * `undefined`. Y cada uno se valida contra su lista cerrada — un valor que no
   * esté en ella cae a `null` y la vitrina usa el de suite, en vez de acabar en
   * un `font-family` que el navegador interpreta.
   */
  favicon_url: assetRef,
  font_family: z.enum(BRAND_FONTS).nullable().catch(null).default(null),
  ui_radius: z.enum(BRAND_RADII).nullable().catch(null).default(null),
  ui_density: z.enum(DENSITIES).nullable().catch(null).default(null),
  business_display_name: z.string().nullable().default(null),
  /**
   * P18 · La tienda solo vende a quien ha iniciado sesión.
   *
   * `default(false)` y no `optional`: una respuesta anterior al despliegue de
   * esta fase se lee como la tienda abierta que era. Y quien decide NO es este
   * campo — lo impone el pipeline en `validate_account` con la identidad
   * verificada; esto solo evita enseñar un formulario que se va a rechazar.
   */
  checkout_requires_account: z.boolean().nullable().catch(false).default(false),
  /**
   * Theme Engine (P02). Los tres llegan CRUDOS y así se quedan aquí.
   *
   * `z.unknown()` no es dejadez: es la frontera entre las dos capas. Lo que
   * viene de la base puede ser un tema que esta versión no conoce, un JSON
   * escrito a mano o directamente nada —una respuesta anterior al despliegue de
   * la migración no trae estas columnas—. Validarlo con un `enum` haría fallar
   * el `parse` de TODA la tienda por un campo de presentación, y la vitrina se
   * quedaría en blanco por elegir mal el ancho del contenedor.
   *
   * Quien decide qué significa cada valor es `resolveStoreTheme`, y ahí lo
   * desconocido cae a lo seguro en vez de romper.
   */
  theme_preset: z.unknown(),
  storefront_style: z.unknown(),
  home_layout: z.unknown(),
  /**
   * Storefront V2 · P01 · Las propuestas de valor de la tienda, CRUDAS.
   *
   * `z.unknown()` por el mismo motivo que las tres de arriba: es una respuesta
   * que puede venir de una base anterior a la migración `20260923100000` —y
   * entonces no trae la columna— o traer una entrada escrita a mano. Validarlo
   * aquí haría fallar el `parse` de TODA la tienda por una franja de cuatro
   * frases. Quien decide qué se pinta es `resolveValueProps`, y ahí lo
   * desconocido se descarta entrada a entrada.
   */
  value_props: z.unknown(),
  /**
   * H08 · País por defecto del checkout, derivado de las zonas de entrega de la
   * tienda (migración `20260913120000`). `null` si vende a varios países o no
   * configuró cobertura. `catch(null)` y `default(null)`: una base anterior a la
   * migración, o un valor raro, deja el checkout exactamente como estaba.
   */
  default_country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .catch(null)
    .default(null),
})
export type PublicStore = z.infer<typeof publicStoreSchema>

export const publicCategorySchema = z.object({
  category_id: z.string().uuid(),
  store_id: z.string().uuid(),
  /**
   * De quién cuelga. La portada solo enseña las FAMILIAS —las que no cuelgan de
   * nadie—: con el catálogo real importado, la lista plana mezclaba «Cuidado
   * personal» con «Antimicóticos (hongos)» y las dos se veían igual de
   * importantes.
   */
  parent_id: z.string().uuid().nullable().default(null),
  slug: z.string().min(1),
  name: z.string().min(1),
  position: z.number().int(),
})
export type PublicCategory = z.infer<typeof publicCategorySchema>

/**
 * Producto del catálogo público.
 *
 * `in_stock` es un booleano derivado en la base (`stock > 0`), no la cantidad:
 * el comprador ve si puede comprar, no cuántas unidades quedan — eso es dato
 * de negocio del tenant y está fuera del GRANT de `anon`.
 */
export const publicProductSchema = z.object({
  product_id: z.string().uuid(),
  store_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().default(null),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  price: moneyText,
  compare_at_price: moneyText.nullable().default(null),
  currency: z.string().length(3),
  published_at: z.string().nullable().default(null),
  in_stock: z.boolean().nullable().default(false),
  category_slug: z.string().nullable().default(null),
  category_name: z.string().nullable().default(null),
  primary_image_path: z.string().nullable().default(null),
  primary_image_alt: z.string().nullable().default(null),
  /**
   * PIM (P03-SaaS). `in_stock` de arriba YA viene calculado por tipo desde la
   * vista: para un maestro de variantes es «alguna variante disponible» y para
   * un kit es «se puede armar». La vitrina no vuelve a decidirlo.
   *
   * `default` y no `optional`: una respuesta anterior al despliegue del PIM se
   * lee como el producto simple que era, sin que ninguna pantalla compruebe
   * `undefined`.
   */
  kind: z.enum(['simple', 'variant', 'bundle']).default('simple'),
  brand_name: z.string().nullable().default(null),
  variant_count: z.number().int().default(0),
  /** Precio más bajo que el comprador puede pagar. El «desde» de la tarjeta. */
  price_from: moneyText.nullable().default(null),
})
export type PublicProduct = z.infer<typeof publicProductSchema>

/**
 * Un eje de la variante con el valor que toma: «Talla = M».
 *
 * Sale de `ebim.variant_public_options`, que solo responde por variantes que la
 * vitrina ya enseña. Los CÓDIGOS identifican (dos valores pueden llamarse igual
 * en atributos distintos); las etiquetas y el orden son para pintar.
 */
export const variantOptionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  position: z.number().int().default(0),
  value_code: z.string().min(1),
  label: z.string().min(1),
  value_position: z.number().int().default(0),
})
export type VariantOption = z.infer<typeof variantOptionSchema>

/**
 * Variante publicada. El precio ya llega HEREDADO desde la vista: resolverlo
 * en el navegador significaría tener la regla escrita dos veces, y la copia del
 * cliente es la que nadie comprueba.
 */
export const publicVariantSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  store_id: z.string().uuid(),
  name: z.string().min(1),
  position: z.number().int(),
  is_default: z.boolean(),
  in_stock: z.boolean().nullable().default(false),
  price: moneyText,
  compare_at_price: moneyText.nullable().default(null),
  currency: z.string().length(3),
  /**
   * Su combinación de ejes. `[]` si la variante no tiene ninguno declarado: la
   * ficha cae entonces a elegir por nombre, que es lo que hacía antes.
   */
  options: z
    .array(variantOptionSchema)
    .nullable()
    .default([])
    .transform((value) => value ?? []),
})
export type PublicVariant = z.infer<typeof publicVariantSchema>

/** Variante preseleccionada: la marcada por defecto, o la primera disponible. */
export function defaultVariant(variants: readonly PublicVariant[]): PublicVariant | null {
  if (variants.length === 0) return null
  return (
    variants.find((variant) => variant.is_default && variant.in_stock !== false) ??
    variants.find((variant) => variant.in_stock !== false) ??
    variants[0] ??
    null
  )
}

export const publicProductImageSchema = z.object({
  image_id: z.string().uuid(),
  product_id: z.string().uuid(),
  storage_path: z.string().min(1),
  alt: z.string().nullable().default(null),
  position: z.number().int(),
  is_primary: z.boolean().nullable().default(false),
})
export type PublicProductImage = z.infer<typeof publicProductImageSchema>

/** Imagen ya resuelta a algo que un `<img>` puede pintar. */
export interface GalleryImage extends PublicProductImage {
  url: string | null
}

/** Filtros del catálogo: uno de categoría y uno de disponibilidad. Nada más. */
export const AVAILABILITY_FILTERS = ['all', 'in-stock'] as const
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number]

export const PRODUCT_SORTS = ['recent', 'price-asc', 'price-desc', 'name'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]

export interface CatalogQuery {
  storeId: string | null
  search: string
  categorySlug: string | null
  availability: AvailabilityFilter
  sort: ProductSort
  /**
   * Techo de filas. **Obligatorio desde P15-SaaS**: sin él, `fetchPublicProducts`
   * pedía la categoría entera para pintar cuatro relacionados, y una categoría
   * con dos mil referencias se descargaba entera en cada ficha visitada.
   */
  limit: number
}

/** Descuento en % entero, o `null` si el precio tachado no es mayor que el real. */
export function discountPercent(product: PublicProduct): number | null {
  if (!product.compare_at_price) return null
  const before = Number(product.compare_at_price)
  const now = Number(product.price)
  if (!Number.isFinite(before) || !Number.isFinite(now) || before <= now || before <= 0) return null
  return Math.round(((before - now) / before) * 100)
}

/**
 * Relacionados «simples»: misma categoría, sin el propio producto, y si la
 * categoría no da para llenar la fila se completa con el resto del catálogo.
 * No hay motor de recomendación detrás y no se pretende que lo haya.
 */
export function pickRelated(
  all: PublicProduct[],
  current: PublicProduct,
  limit = 4,
): PublicProduct[] {
  const others = all.filter((item) => item.product_id !== current.product_id)
  const sameCategory = current.category_id
    ? others.filter((item) => item.category_id === current.category_id)
    : []
  const rest = others.filter((item) => !sameCategory.includes(item))
  return [...sameCategory, ...rest].slice(0, limit)
}

/**
 * Pedido tal y como lo ve el COMPRADOR con su token.
 *
 * No es el mismo objeto que devuelve el checkout: `order_by_token` recorta a
 * proposito lo que no necesita ver —el token, los ids de tenant, el id interno
 * del pedido— para que un enlace filtrado no sirva para pivotar a nada mas.
 */
export const trackedOrderSchema = z.object({
  order_number: z.string().min(1),
  status: z.string().min(1),
  /**
   * Cómo va el cobro. `order_by_token` ya lo devolvía y el esquema lo tiraba.
   *
   * Mientras ningún medio cobraba en el acto, daba igual: todo pedido nacía
   * pendiente y la confirmación podía decirlo sin preguntar. Con una pasarela
   * que captura al confirmar, no leerlo significa enseñar «pendiente de pago»
   * sobre una compra ya cobrada — que es peor que no decir nada.
   *
   * `.default('pending')` y no obligatorio: una respuesta anterior al
   * despliegue no lo trae y tiene que seguir pintándose.
   */
  payment_status: z.string().default('pending'),
  currency: z.string().length(3),
  placed_at: z.string(),
  customer_name: z.string().nullable(),
  subtotal: z.string(),
  tax_total: z.string(),
  // P10. `.default('0.00')` y no obligatorio: un pedido anterior al despliegue
  // de esta fase no lo trae, y esa respuesta tiene que seguir pintándose.
  discount_total: z.string().default('0.00'),
  // P12. Mismo criterio que `discount_total`: `.default` y no obligatorio, para
  // que un pedido anterior al despliegue de esta fase siga pintandose.
  shipping_total: z.string().default('0.00'),
  grand_total: z.string(),
  shipping_address: z.record(z.unknown()).default({}),
  /**
   * Como llega el pedido, en el vocabulario del COMPRADOR. Una LISTA porque un
   * pedido puede salir en varias entregas: enseñar solo la primera convertiria
   * un despacho parcial en «tu pedido ya llego» cuando falta media caja.
   *
   * No trae almacen, ni operador, ni lo que cobra el transportista: eso es
   * informacion del comercio.
   */
  deliveries: z
    .array(
      z.object({
        sequence: z.number(),
        method_name: z.string(),
        strategy: z.string(),
        state: z.string(),
        promised_from: z.string().nullable(),
        promised_to: z.string().nullable(),
        pickup_point: z
          .object({ name: z.string(), address: z.record(z.unknown()).default({}) })
          .nullable(),
        tracking_number: z.string().nullable(),
        tracking_url: z.string().nullable(),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string(),
        unit_price: z.string(),
        quantity: z.union([z.number(), z.string()]).transform((v) => Number(v)),
        discount: z.string().default('0.00'),
        /** Solo ETIQUETA e importe: ni el id de la campaña ni el cupón ajeno. */
        discounts: z
          .array(z.object({ label: z.string(), amount: z.string() }))
          .default([]),
      }),
    )
    .default([]),
})
export type TrackedOrder = z.infer<typeof trackedOrderSchema>

/**
 * Un pedido no localizable. Deliberadamente SIN detalle: no se distingue si el
 * numero no existe o si el token es incorrecto, igual que hace la funcion.
 */
export class OrderNotFoundError extends AppError {
  constructor() {
    super({ boundary: 'orders', code: 'PEDIDO_NO_ENCONTRADO', message: 'ORDER_NOT_FOUND' })
    this.name = 'OrderNotFoundError'
  }
}
