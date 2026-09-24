import { z } from 'zod'
import { moneyText } from '@/shared/lib/money'
import type { MessageKey } from '@/shared/i18n/messages'
import { PRODUCT_KINDS as PIM_PRODUCT_KINDS, type ProductKind } from './pim/types'

/** Nombres reales de las tablas. Fuente unica: `shared/lib/db-schema.ts`. */
export {
  PRODUCTS_TABLE,
  CATEGORIES_TABLE,
  PRODUCT_IMAGES_TABLE,
} from '@/shared/lib/db-schema'

export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/**
 * Tipo de producto (P03-SaaS). Reexportado desde el vocabulario del PIM para
 * que exista un solo sitio donde está escrito el enum de la base.
 */
export { PRODUCT_KINDS, type ProductKind } from './pim/types'

/**
 * Importe del catálogo. Vive en `src/shared/lib/money.ts` porque la vitrina
 * pública lo necesita igual que el backoffice; se reexporta aquí para no
 * romper a quien ya lo importaba de este módulo.
 */
export { moneyText } from '@/shared/lib/money'

/**
 * Producto del catálogo con los nombres de columna reales de
 * `20260827090300_catalog.sql`. `organization_id`/`company_id` viajan en la
 * fila solo como lectura: el filtro de tenant lo aplica la RLS con los claims
 * del JWT, nunca una condición que arme el cliente.
 *
 * Nota de nomenclatura: el encargo llamaba `stock_qty` a la cantidad; la
 * columna se llama `stock` desde P02 y es la que conocen las policies, la
 * función de pedido y los tests de aislamiento. Se respeta el nombre real.
 */
export const productSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  store_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().default(null),
  sku: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().default(null),
  status: z.enum(PRODUCT_STATUSES),
  price: moneyText,
  compare_at_price: moneyText.nullable().default(null),
  currency: z.string().length(3),
  stock: z.number().int(),
  published_at: z.string().nullable().default(null),
  updated_at: z.string(),
  /**
   * PIM (P03-SaaS). `default` y no `optional` a propósito: una fila que llegue
   * de una respuesta anterior al despliegue del PIM se lee como el producto
   * simple que era, y ninguna pantalla tiene que comprobar `undefined`.
   */
  kind: z.enum(PIM_PRODUCT_KINDS).default('simple'),
  brand_id: z.string().uuid().nullable().default(null),
  family_id: z.string().uuid().nullable().default(null),
  /**
   * Categoría fiscal del producto. `null` = la que la sociedad marcó por
   * defecto, que es el primer escalón de `ebim.effective_tax_rate` después del
   * producto. Nulo no es «sin impuesto»: es «el de siempre».
   */
  tax_category_id: z.string().uuid().nullable().default(null),
})
export type Product = z.infer<typeof productSchema>

/**
 * Producto MAESTRO de la sociedad activa (ADR 018), tal como lo lista
 * `admin_product_masters`: una fila por producto aunque se venda en varias
 * tiendas.
 *
 * No trae precio, slug, categoría ni estado propios porque no los tiene: son de
 * cada publicación. `publication_state` es un estado AGREGADO («publicado en al
 * menos una tienda»), no un estado global que alguien pueda creer vigente en
 * todas.
 */
export const productMasterSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  origin_store_id: z.string().uuid().nullable().default(null),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  kind: z.enum(PIM_PRODUCT_KINDS).default('simple'),
  brand_id: z.string().uuid().nullable().default(null),
  brand_name: z.string().nullable().default(null),
  family_id: z.string().uuid().nullable().default(null),
  family_name: z.string().nullable().default(null),
  tax_category_id: z.string().uuid().nullable().default(null),
  stock: z.number().int(),
  legacy_sku_conflict: z.boolean().default(false),
  updated_at: z.string(),
  publication_count: z.number().int().nonnegative().default(0),
  published_count: z.number().int().nonnegative().default(0),
  store_ids: z.array(z.string().uuid()).default([]),
  published_store_names: z.array(z.string()).default([]),
  category_ids: z.array(z.string().uuid()).default([]),
  publication_state: z.enum(PRODUCT_STATUSES).default('draft'),
})
export type ProductMaster = z.infer<typeof productMasterSchema>

/**
 * Lo que los paneles del PIM necesitan del producto. `price`/`currency` son los
 * de la tienda de ORIGEN —la que hereda el precio propio de variantes y
 * presentaciones durante la transición—; `price` nulo cuando el maestro no está
 * publicado ahí, y entonces no se inventa un precio heredado.
 */
export interface PimProduct {
  id: string
  sku: string
  name: string
  kind: ProductKind
  price: string | null
  currency: string
}

/** Candidato de kit o de relacionado: lo mínimo para reconocerlo. */
export type ProductCandidate = Pick<PimProduct, 'id' | 'sku' | 'name' | 'kind'> & { stock: number }

/**
 * Una tienda de la sociedad y la publicación del producto en ella
 * (`product_store_publications`). Los campos de la publicación son nulos cuando
 * el producto no está en esa tienda.
 */
export const productPublicationSchema = z.object({
  store_id: z.string().uuid(),
  store_name: z.string(),
  store_slug: z.string(),
  store_status: z.string(),
  store_currency: z.string(),
  is_origin: z.boolean().default(false),
  publication_id: z.string().uuid().nullable().default(null),
  category_id: z.string().uuid().nullable().default(null),
  category_name: z.string().nullable().default(null),
  slug: z.string().nullable().default(null),
  status: z.enum(PRODUCT_STATUSES).nullable().default(null),
  published_at: z.string().nullable().default(null),
  price: moneyText.nullable().default(null),
  compare_at_price: moneyText.nullable().default(null),
  currency: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
})
export type ProductPublication = z.infer<typeof productPublicationSchema>

export const categorySchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable().default(null),
  slug: z.string(),
  name: z.string(),
  position: z.number().int(),
  is_active: z.boolean(),
  /**
   * Storefront V2 · P03 · Foto opcional de la categoría y su texto alternativo.
   *
   * `catch(null).default(null)`: una base anterior a la migración
   * `20260923160000` no trae estas columnas, y una respuesta sin ellas se lee
   * como la categoría sin foto que era. La ausencia de imagen NO invalida la
   * categoría — es el caso normal y la vitrina cae a tinte + icono.
   */
  image_url: z.string().nullable().catch(null).default(null),
  image_alt: z.string().nullable().catch(null).default(null),
})
export type Category = z.infer<typeof categorySchema>

export const productImageSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  store_id: z.string().uuid(),
  storage_path: z.string(),
  alt: z.string().nullable().default(null),
  position: z.number().int(),
  is_primary: z.boolean(),
})
export type ProductImage = z.infer<typeof productImageSchema>

/** Conteo real de uso, para la eliminación segura (contrato §4.2). */
export const productUsageSchema = z.object({
  name: z.string(),
  order_lines: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
  /**
   * PIM (P03-SaaS). `bundles` no es informativo: la FK del componente es
   * `restrict`, así que si es mayor que cero el borrado FALLA. Enseñarlo antes
   * es la diferencia entre entender por qué y comerse un error de integridad.
   * Con `default(0)` una respuesta anterior al despliegue del PIM sigue
   * pintando el diálogo en vez de romperlo al validar.
   */
  variants: z.number().int().nonnegative().default(0),
  bundles: z.number().int().nonnegative().default(0),
  /** Tiendas donde sigue publicado (ADR 018). Con más de cero el servidor niega el borrado. */
  publications: z.number().int().nonnegative().default(0),
})
export type ProductUsage = z.infer<typeof productUsageSchema>

export const categoryUsageSchema = z.object({
  name: z.string(),
  products: z.number().int().nonnegative(),
  children: z.number().int().nonnegative(),
})
export type CategoryUsage = z.infer<typeof categoryUsageSchema>

// ---------------------------------------------------------------------------
// Formularios. Los mensajes de error son CLAVES de i18n, no texto: el mismo
// esquema tiene que servir en ES y en EN sin duplicarse.
// ---------------------------------------------------------------------------

/** Mismo formato que `requireSlug` de la Edge Function (3–62, minúsculas). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
/** Mismo formato que `requireMoney`: hasta 12 enteros y 2 decimales. */
export const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/

const errorKey = (key: MessageKey) => key

/**
 * Formulario del producto MAESTRO, con la publicación inicial opcional.
 *
 * Los datos del maestro (nombre, SKU, descripción, tipo, marca, familia,
 * impuesto, stock) se validan siempre. Slug, categoría, precio y estado son de
 * la publicación en la tienda activa: solo se validan cuando `publish` está
 * marcado, que solo ocurre en el alta. Al editar, cada tienda se administra en
 * la pestaña «Tiendas».
 */
export const productFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, errorKey('catalog.error.name'))
      .max(240, errorKey('catalog.error.name')),
    sku: z
      .string()
      .trim()
      .min(1, errorKey('catalog.error.sku'))
      .max(64, errorKey('catalog.error.sku')),
    description: z.string().trim().max(8000, errorKey('catalog.error.description')),
    stock: z
      .string()
      .trim()
      .regex(/^\d{1,9}$/, errorKey('catalog.error.stock')),
    kind: z.enum(PIM_PRODUCT_KINDS),
    /** Cadena vacía = sin marca. El `null` lo pone la capa de datos. */
    brand_id: z.string(),
    family_id: z.string(),
    /** Cadena vacía = la categoría fiscal por defecto de la sociedad. */
    tax_category_id: z.string(),
    /** Publicar ya en la tienda activa. Solo tiene sentido en el alta. */
    publish: z.boolean(),
    slug: z.string().trim().toLowerCase(),
    category_id: z.string(),
    price: z.string().trim(),
    status: z.enum(PRODUCT_STATUSES),
  })
  .superRefine((values, ctx) => {
    if (!values.publish) return
    if (!SLUG_RE.test(values.slug)) {
      ctx.addIssue({ code: 'custom', path: ['slug'], message: errorKey('catalog.error.slug') })
    }
    if (!MONEY_RE.test(values.price)) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: errorKey('catalog.error.price') })
    }
  })
export type ProductFormValues = z.infer<typeof productFormSchema>

/** Formulario de la publicación de UNA tienda (pestaña «Tiendas»). */
export const publicationFormSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, errorKey('catalog.error.slug')),
  category_id: z.string(),
  price: z.string().trim().regex(MONEY_RE, errorKey('catalog.error.price')),
  status: z.enum(PRODUCT_STATUSES),
})
export type PublicationFormValues = z.infer<typeof publicationFormSchema>

export const categoryFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, errorKey('catalog.error.name'))
    .max(160, errorKey('catalog.error.name')),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, errorKey('catalog.error.slug')),
  is_active: z.boolean(),
  /**
   * De quién cuelga. Cadena vacía = raíz, no `null`, porque es lo que devuelve
   * un `<select>` vacío y convertirlo aquí evita que cada pantalla se acuerde.
   *
   * Con defecto: una categoría sin madre es el caso NORMAL, y quien construye
   * el objeto —un formulario, una prueba— no tiene por qué declarar la ausencia.
   */
  parent_id: z.string().default(''),
  /**
   * La RUTA de la foto, no una URL firmada: una firma caduca en una hora y
   * dejaría la portada sin fotos al día siguiente. Lo que llega aquí siempre
   * viene de `buildCategoryImagePath`, nunca escrito a mano; la FORMA la valida
   * `ebim.is_category_image_ref` contra las columnas de tenant de la fila.
   */
  image_url: z.string().max(1024).nullable().default(null),
  /**
   * Texto ALTERNATIVO, no pie de foto: describe la imagen para quien no la ve.
   * Cadena vacía = sin alt, y entonces la vitrina pinta la imagen como
   * decorativa y el nombre de la categoría hace de nombre accesible. Guardar
   * el nombre aquí haría que un lector dijera «Abrigos, Abrigos».
   */
  image_alt: z
    .string()
    .trim()
    .max(160, errorKey('catalog.error.imageAlt'))
    .default(''),
})
export type CategoryFormValues = z.infer<typeof categoryFormSchema>

/** Valores de partida del formulario a partir de un producto existente. */
export function productToForm(product: ProductMaster | null): ProductFormValues {
  return {
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    description: product?.description ?? '',
    stock: String(product?.stock ?? 0),
    kind: product?.kind ?? 'simple',
    brand_id: product?.brand_id ?? '',
    family_id: product?.family_id ?? '',
    tax_category_id: product?.tax_category_id ?? '',
    // El alta publica en la tienda activa por defecto: es el flujo de siempre y
    // lo que espera quien crea un producto para venderlo. Al editar no aplica.
    publish: product === null,
    slug: '',
    category_id: '',
    price: '',
    status: 'draft',
  }
}

/** Valores de partida de la publicación de una tienda. */
export function publicationToForm(publication: ProductPublication | null): PublicationFormValues {
  return {
    slug: publication?.slug ?? '',
    category_id: publication?.category_id ?? '',
    price: publication?.price ?? '',
    status: publication?.status ?? 'draft',
  }
}

export function categoryToForm(category: Category | null): CategoryFormValues {
  return {
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    is_active: category?.is_active ?? true,
    parent_id: category?.parent_id ?? '',
    image_url: category?.image_url ?? null,
    image_alt: category?.image_alt ?? '',
  }
}

// ---------------------------------------------------------------------------
// El árbol de categorías, en el cliente
//
// La lista completa ya viaja al backoffice para el desplegable del producto, y
// son decenas de filas, no miles: armar el árbol aquí es una pasada sobre un
// array frente a una consulta recursiva por pantalla. El servidor guarda la
// jerarquía y pone las barandillas; el orden y la sangría son presentación.
// ---------------------------------------------------------------------------

export interface CategoryNode {
  category: Category
  /** 0 = raíz. La sangría de la tabla y el prefijo del desplegable salen de aquí. */
  depth: number
  /** «Salud › Sistema nervioso». Es lo que hace legible un selector de 30 filas. */
  path: string
}

/**
 * Aplana el árbol EN ORDEN DE LECTURA: cada madre seguida de su descendencia.
 *
 * Las huérfanas —una fila cuyo padre ya no está visible por un filtro— se
 * tratan como raíces en vez de desaparecer: una categoría que existe y no sale
 * en su pantalla es la clase de dato que nadie vuelve a encontrar.
 */
export function categoryTree(categories: Category[]): CategoryNode[] {
  const byParent = new Map<string, Category[]>()
  const ids = new Set(categories.map((category) => category.id))

  for (const category of categories) {
    const key = category.parent_id && ids.has(category.parent_id) ? category.parent_id : ''
    const siblings = byParent.get(key) ?? []
    siblings.push(category)
    byParent.set(key, siblings)
  }

  const order = (list: Category[]) =>
    [...list].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const out: CategoryNode[] = []
  const walk = (parent: string, depth: number, prefix: string) => {
    for (const category of order(byParent.get(parent) ?? [])) {
      const path = prefix ? `${prefix} › ${category.name}` : category.name
      out.push({ category, depth, path })
      walk(category.id, depth + 1, path)
    }
  }
  walk('', 0, '')
  return out
}

/**
 * Las que NO pueden ser madre de `categoryId`: ella misma y su descendencia.
 *
 * La base lo rechaza igual (`CATEGORIA_CICLO`), pero un desplegable que ofrece
 * una opción que va a fallar es un desplegable que miente.
 */
export function categoryDescendants(categories: Category[], categoryId: string): Set<string> {
  const blocked = new Set([categoryId])
  let grew = true
  while (grew) {
    grew = false
    for (const category of categories) {
      if (category.parent_id && blocked.has(category.parent_id) && !blocked.has(category.id)) {
        blocked.add(category.id)
        grew = true
      }
    }
  }
  return blocked
}
