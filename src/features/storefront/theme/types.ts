/**
 * Los contratos del Theme Engine de la vitrina. Tipos y nada más.
 *
 * ## Qué decide este archivo y qué no
 *
 * Aquí vive **la presentación**: qué variante de cabecera, de portada, de
 * tarjeta; cuánto ancho, qué proporción de imagen, cuánto aire entre secciones.
 * Nada de esto toca precio, stock, promociones, impuestos ni checkout, y esa
 * frontera no es una recomendación: es la condición para que el mismo código
 * sirva a una farmacia y a una tienda de ropa sin bifurcarse.
 *
 * Lo que **no** vive aquí, porque ya tiene dueño:
 *
 *  · el modo claro/oscuro, el color de acento, la tipografía, el radio y la
 *    densidad son de `AppearanceProvider` (`src/theme/`). Repetirlos aquí
 *    crearía dos fuentes de verdad para el mismo píxel, y el día que
 *    discreparan nadie sabría cuál manda;
 *  · el contenido editorial es del CMS. El orden de la Home dice QUÉ se pinta y
 *    en qué orden, nunca con qué texto ni con qué foto.
 *
 * ## Por qué todas las listas son cerradas
 *
 * Un tenant no escribe CSS, ni HTML, ni JavaScript, ni URLs. Escribe **una
 * opción de una lista**. Eso no se consigue filtrando lo peligroso —siempre se
 * escapa algo— sino no aceptando nada que no esté nombrado de antemano. Un
 * valor fuera de la lista no se rechaza con un error: cae al del preset, porque
 * una tienda en blanco por un JSON raro es una tienda cerrada.
 */

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

/**
 * Los cuatro presets, y no hay más.
 *
 * NO son rubros. No existe `pharmacy` ni `fashion`: una farmacia se ve como una
 * farmacia porque elige `retail` y tiene su catálogo, no porque el código
 * pregunte a qué se dedica. En cuanto una condición mire el rubro, el mismo
 * código deja de servir para el rubro siguiente.
 */
export const THEME_PRESET_IDS = ['universal', 'retail', 'premium', 'catalog'] as const
export type ThemePreset = (typeof THEME_PRESET_IDS)[number]

// ---------------------------------------------------------------------------
// Variantes de presentación
//
// Cada lista está anclada a un componente que YA existe. No se declara ninguna
// variante que hoy no tenga dónde aplicarse: un contrato con opciones que no
// hacen nada es un contrato que miente.
// ---------------------------------------------------------------------------

/** `StorefrontLayout`: cabecera completa o reducida. */
export const HEADER_VARIANTS = ['standard', 'compact'] as const
export type HeaderVariant = (typeof HEADER_VARIANTS)[number]

/**
 * Las dos portadas que la vitrina ya tiene: `StoreFeaturedHero` —producto,
 * precio y descuento— y `StoreHero` —el lema del comercio—.
 *
 * Es una PREFERENCIA, no una orden: sin productos rebajados no hay portada de
 * producto que pintar, y la regla actual de caer al lema se conserva.
 */
export const HERO_VARIANTS = ['product', 'statement'] as const
export type HeroVariant = (typeof HERO_VARIANTS)[number]

/** `ProductCard` ya distingue las dos con su prop `compact`. */
export const PRODUCT_CARD_VARIANTS = ['comfortable', 'compact'] as const
export type ProductCardVariant = (typeof PRODUCT_CARD_VARIANTS)[number]

/** Azulejos con icono (`CategoryDoor`) o píldoras (`CategoryBar`). Los dos existen. */
export const CATEGORY_VARIANTS = ['tiles', 'pills'] as const
export type CategoryVariant = (typeof CATEGORY_VARIANTS)[number]

/** Los valores de `Container` que la vitrina usa hoy. */
export const CONTENT_WIDTHS = ['lg', 'xl'] as const
export type ContentWidth = (typeof CONTENT_WIDTHS)[number]

/** Se traduce a la prop `ratio` de `ProductMedia`, que hoy viene con `1 / 1`. */
export const IMAGE_RATIOS = ['square', 'portrait', 'landscape'] as const
export type ImageRatio = (typeof IMAGE_RATIOS)[number]

/** El `gap` entre secciones de la Home, hoy fijo en `{ xs: 2, md: 3 }`. */
export const SECTION_SPACINGS = ['compact', 'comfortable', 'spacious'] as const
export type SectionSpacing = (typeof SECTION_SPACINGS)[number]

/** Columnas de `ProductGrid`, que hoy reparte 2 / 3 / 4. */
export interface GridColumns {
  readonly xs: number
  readonly sm: number
  readonly lg: number
}

/**
 * Lo que un preset resuelve, como DATOS.
 *
 * Datos y no JSX: cuatro presets con cuatro árboles de React serían cuatro
 * aplicaciones disfrazadas de una, y la quinta industria obligaría a la quinta
 * copia. Los componentes leen estos valores; no preguntan qué tema hay puesto.
 */
export interface ThemeDefinition {
  readonly id: ThemePreset
  readonly headerVariant: HeaderVariant
  readonly heroVariant: HeroVariant
  readonly productCardVariant: ProductCardVariant
  readonly categoryVariant: CategoryVariant
  readonly contentWidth: ContentWidth
  readonly imageRatio: ImageRatio
  readonly sectionSpacing: SectionSpacing
  readonly gridColumns: GridColumns
}

/**
 * Lo que una tienda puede pisarle a su preset.
 *
 * Es un subconjunto de `ThemeDefinition` a propósito: `gridColumns` queda
 * fuera. Es el único campo que no es una elección entre opciones nombradas sino
 * tres números, y abrirlo a configuración libre invita a una rejilla de once
 * columnas en un móvil. Si algún día hace falta, será una lista cerrada de
 * densidades, no tres enteros sueltos.
 */
export interface StorefrontStyle {
  readonly headerVariant: HeaderVariant
  readonly heroVariant: HeroVariant
  readonly productCardVariant: ProductCardVariant
  readonly categoryVariant: CategoryVariant
  readonly contentWidth: ContentWidth
  readonly imageRatio: ImageRatio
  readonly sectionSpacing: SectionSpacing
}

// ---------------------------------------------------------------------------
// Composición de la Home
// ---------------------------------------------------------------------------

/**
 * Las secciones que la Home sabe pintar.
 *
 * Cerrada por el mismo motivo que todo lo demás: una sección desconocida no se
 * pinta, se ignora. Y el orden de esta constante es el orden de reserva — el
 * que reciben las secciones que una configuración guardada no mencionaba.
 *
 * Ojo con dos de ellas: `business-info` y `newsletter` **no tienen componente
 * todavía**. Se declaran porque el contrato las contempla y porque una sección
 * declarada y apagada es más honesta que un identificador que aparece de golpe
 * tres fases después; se quedan apagadas por defecto hasta que exista qué
 * pintar.
 */
export const HOME_SECTION_IDS = [
  'hero',
  'services',
  'offers',
  'cms',
  'promotions',
  'categories',
  'brands',
  'new-arrivals',
  'best-sellers',
  'featured',
  'trust',
  'business-info',
  'newsletter',
] as const
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number]

export interface HomeSectionConfig {
  readonly id: HomeSectionId
  readonly enabled: boolean
  /** Solo en las secciones que pintan una colección. Ver `SECTIONS_WITH_MAX_ITEMS`. */
  readonly maxItems?: number
}

export interface HomeLayout {
  /** Una sola versión por ahora. Existe para poder migrar sin adivinar. */
  readonly version: 1
  readonly sections: readonly HomeSectionConfig[]
}
