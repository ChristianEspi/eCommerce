import type {
  CategoryVariant,
  HomeSectionId,
  ProductCardVariant,
  SectionPresentation,
  ThemePreset,
} from './types'

/**
 * La PRESENTACIÓN de cada sección de la portada (Storefront V3 · P06).
 *
 * ## Qué problema resuelve
 *
 * La portada se componía como «título + fila de tarjetas», repetido. El orden se
 * podía cambiar y las secciones se podían apagar, pero el ritmo era siempre el
 * mismo: seis bandas idénticas una debajo de otra. Para un catálogo denso eso
 * es correcto —lo que se quiere es recorrer— y para una tienda de marca es una
 * lista, no una portada.
 *
 * ## Por qué NO es un maquetador
 *
 * Porque un maquetador libre convierte cada tienda en un caso único, y a partir
 * de ahí ninguna mejora de la vitrina llega a nadie sin romperle la portada a
 * alguien. Aquí cada sección elige entre **tres o cuatro opciones nombradas**, y
 * las opciones válidas dependen de la sección: una presentación de producto en
 * el hero no se rechaza porque sea peligrosa, se rechaza porque no significa
 * nada.
 *
 * No hay CSS libre, ni HTML, ni una URL de fondo, ni un número de columnas. Lo
 * que hay son decisiones de ritmo: cómo se enseña, sobre qué superficie y con
 * qué ancho.
 *
 * ## `auto` y por qué es el defecto
 *
 * `auto` significa «lo que mi tema considere correcto aquí». Es el defecto de
 * todas las secciones y de todas las tiendas que ya existen, así que aplicar V3
 * no cambia ninguna portada: `auto` resuelve exactamente lo que la sección
 * pintaba antes.
 *
 * Y lo resuelve por TEMA, nunca por rubro. Premium favorece lo editorial porque
 * eligió un tema editorial —no porque venda ropa—, y Catalog favorece la
 * densidad porque eligió productividad. El código no pregunta a qué se dedica el
 * comercio; no lo sabe y no puede saberlo.
 */

// ---------------------------------------------------------------------------
// Las listas cerradas, por familia de sección
// ---------------------------------------------------------------------------

/** Cómo se enseña una colección de producto. */
export const PRODUCT_PRESENTATIONS = ['auto', 'rail', 'grid', 'spotlight'] as const
export type ProductPresentation = (typeof PRODUCT_PRESENTATIONS)[number]

/** Cómo se enseñan las familias del catálogo. */
export const CATEGORY_PRESENTATIONS = ['auto', 'tiles', 'pills', 'mosaic'] as const
export type CategoryPresentation = (typeof CATEGORY_PRESENTATIONS)[number]

/** Cómo se enseñan las marcas. */
export const BRAND_PRESENTATIONS = ['auto', 'cards', 'logos'] as const
export type BrandPresentation = (typeof BRAND_PRESENTATIONS)[number]

/** Cómo se enseña lo rebajado y las campañas vigentes. */
export const OFFER_PRESENTATIONS = ['auto', 'band', 'split'] as const
export type OfferPresentation = (typeof OFFER_PRESENTATIONS)[number]

/**
 * La superficie sobre la que va la sección.
 *
 * Tres, y ninguna es un color: son relaciones con el fondo de la página.
 * `soft` es un tinte del acento del tenant y `contrast` su versión con peso.
 * Un cuarto valor que fuera «el color que yo diga» sería CSS del tenant.
 */
export const SECTION_SURFACES = ['plain', 'soft', 'contrast'] as const
export type SectionSurface = (typeof SECTION_SURFACES)[number]

/** Hasta dónde llega la sección: el ancho del contenido o el de la ventana. */
export const SECTION_WIDTHS = ['contained', 'bleed'] as const
export type SectionWidth = (typeof SECTION_WIDTHS)[number]

/**
 * La presentación guardada de una sección. Todo opcional: lo que falta es `auto`.
 *
 * El tipo se declara en `types.ts` —donde `HomeSectionConfig` lo necesita— y se
 * re-exporta aquí, que es donde vive todo lo demás de presentación.
 */
export type { SectionPresentation }

/** La presentación ya RESUELTA, sin `auto` y sin huecos. */
export interface ResolvedPresentation {
  readonly variant: string
  readonly surface: SectionSurface
  readonly width: SectionWidth
}

// ---------------------------------------------------------------------------
// Qué acepta cada sección
// ---------------------------------------------------------------------------

/**
 * Las variantes válidas por sección, y las superficies que admite.
 *
 * `variants: []` significa «esta sección no elige cómo se enseña»: el hero y el
 * contenido del CMS ya tienen su propia variante en el contrato del tema o en
 * el bloque publicado, y ofrecer otra aquí sería una segunda fuente de verdad
 * para el mismo píxel.
 *
 * `surfaces` también se restringe: una banda de familias con superficie de
 * contraste tapa las fotos de las propias familias, así que ahí no se ofrece.
 */
export const SECTION_PRESENTATION_RULES: Readonly<
  Record<
    HomeSectionId,
    { readonly variants: readonly string[]; readonly surfaces: readonly SectionSurface[] }
  >
> = {
  hero: { variants: [], surfaces: ['plain'] },
  services: { variants: [], surfaces: ['plain', 'soft'] },
  offers: { variants: OFFER_PRESENTATIONS, surfaces: SECTION_SURFACES },
  cms: { variants: [], surfaces: ['plain'] },
  promotions: { variants: OFFER_PRESENTATIONS, surfaces: SECTION_SURFACES },
  categories: { variants: CATEGORY_PRESENTATIONS, surfaces: ['plain', 'soft'] },
  brands: { variants: BRAND_PRESENTATIONS, surfaces: ['plain', 'soft'] },
  'new-arrivals': { variants: PRODUCT_PRESENTATIONS, surfaces: SECTION_SURFACES },
  'best-sellers': { variants: PRODUCT_PRESENTATIONS, surfaces: SECTION_SURFACES },
  featured: { variants: PRODUCT_PRESENTATIONS, surfaces: SECTION_SURFACES },
  trust: { variants: BRAND_PRESENTATIONS, surfaces: ['plain', 'soft'] },
  'business-info': { variants: [], surfaces: ['plain', 'soft'] },
  newsletter: { variants: [], surfaces: ['plain', 'soft'] },
}

// ---------------------------------------------------------------------------
// Qué resuelve `auto`, por tema
// ---------------------------------------------------------------------------

/**
 * Lo que cada tema considera correcto cuando la sección dice `auto`.
 *
 * ## La regla que sostiene esta tabla
 *
 * Se lee del TEMA, no del rubro. Premium favorece lo editorial porque el
 * comercio eligió un tema editorial; si mañana una farmacia elige Premium, su
 * portada será editorial — y estará bien, porque lo eligió.
 *
 * ## Y por qué los defectos son los de V2
 *
 * Porque `auto` es lo que tienen guardado TODAS las tiendas que ya existen.
 * Si `auto` de Universal resolviera algo distinto de lo que la portada pintaba
 * ayer, aplicar V3 cambiaría la portada de cada tienda sin que nadie lo pidiera.
 * Universal resuelve exactamente lo de antes; los otros tres estrenan ritmo
 * porque eligieron una personalidad.
 */
const AUTO_POR_TEMA: Readonly<
  Record<
    ThemePreset,
    {
      readonly product: Exclude<ProductPresentation, 'auto'>
      readonly brands: Exclude<BrandPresentation, 'auto'>
      readonly offers: Exclude<OfferPresentation, 'auto'>
      readonly bleedOffers: boolean
    }
  >
> = {
  /**
   * Universal · exactamente lo de V2.
   *
   * `rail` es lo que la fila hacía: rejilla corta con pocos productos y
   * carrusel con muchos —esa adaptación es de la fila y no se toca—.
   */
  universal: { product: 'rail', brands: 'cards', offers: 'band', bleedOffers: false },
  /**
   * Retail · descubrimiento.
   *
   * La rejilla enseña más de una vez lo que hay: en una tienda de conversión, el
   * carrusel esconde la mitad del surtido detrás de un gesto.
   */
  retail: { product: 'grid', brands: 'cards', offers: 'band', bleedOffers: false },
  /**
   * Premium · ritmo editorial.
   *
   * `spotlight` para producto —pocas piezas, grandes—, `logos` para marcas
   * —un muro de logotipos reconocibles vale más que tarjetas con cuenta— y la
   * banda de ofertas a sangre, que es lo que rompe la lista de bandas iguales.
   */
  /**
   * Premium · ritmo editorial.
   *
   * `spotlight` para producto: pocas piezas, grandes, con la puerta al catálogo
   * al lado. Es lo que rompe la lista de bandas iguales.
   *
   * ## Por qué `cards` y `band` y no `logos` y `split`
   *
   * Porque el muro de logotipos y la banda partida son de P07, donde se
   * construyen sus componentes. `auto` no puede resolver a una variante que
   * nadie pinta: sería un contrato que dice que algo cambia y no cambia nada —el
   * mismo defecto que `heroVariant` tuvo en V2 durante tres fases—. La lista
   * cerrada ya las acepta, así que P07 solo tiene que cambiar esta línea.
   */
  premium: { product: 'spotlight', brands: 'cards', offers: 'band', bleedOffers: true },
  /**
   * Catalog · productividad.
   *
   * Carrusel y contenido contenido: la primera pantalla tiene que ser catálogo,
   * no decoración a sangre.
   */
  // `cards` y no `logos` por lo mismo que en Premium: el muro de logotipos es
  // de P07, y `auto` no puede resolver a algo que nadie pinta. Se cambia allí,
  // en una línea, cuando el componente exista.
  catalog: { product: 'rail', brands: 'cards', offers: 'band', bleedOffers: false },
}

/** Lo que `auto` resuelve para las familias: lo que el contrato del tema dice. */
function autoCategorias(categoryVariant: CategoryVariant): string {
  return categoryVariant
}

const deLaLista = <T extends string>(valor: unknown, lista: readonly T[]): T | null =>
  typeof valor === 'string' && (lista as readonly string[]).includes(valor) ? (valor as T) : null

/**
 * La presentación de una sección, ya resuelta.
 *
 * Toma lo que el comercio guardó, descarta lo que no encaja con esa sección y
 * rellena el resto con lo que el tema considera correcto. Nunca devuelve `auto`:
 * quien pinta recibe una decisión tomada.
 */
export function resolveSectionPresentation({
  id,
  presentation,
  preset,
  categoryVariant,
  productCardVariant,
}: {
  id: HomeSectionId
  presentation: SectionPresentation | undefined
  preset: ThemePreset
  categoryVariant: CategoryVariant
  productCardVariant: ProductCardVariant
}): ResolvedPresentation {
  const reglas = SECTION_PRESENTATION_RULES[id]
  const auto = AUTO_POR_TEMA[preset]

  /** Lo que el tema pone donde la sección dijo `auto`. */
  const porDefecto = (): string => {
    if (reglas.variants.length === 0) return 'fixed'
    if (reglas.variants === CATEGORY_PRESENTATIONS) return autoCategorias(categoryVariant)
    if (reglas.variants === BRAND_PRESENTATIONS) return auto.brands
    if (reglas.variants === OFFER_PRESENTATIONS) return auto.offers
    /**
     * Producto. `spotlight` con tarjetas densas sería una contradicción —una
     * pieza grande pintada con la tarjeta de un catálogo— así que ahí se cae al
     * carrusel. Es la única vez que una clave del tema corrige a otra, y por eso
     * está escrito: el ritmo lo elige el tema, pero no puede pedirse algo que su
     * propia tarjeta no sostiene.
     */
    if (auto.product === 'spotlight' && productCardVariant === 'compact') return 'rail'
    return auto.product
  }

  const variant = deLaLista(presentation?.variant, reglas.variants) ?? porDefecto()
  const surface = deLaLista(presentation?.surface, reglas.surfaces) ?? 'plain'
  const width =
    deLaLista(presentation?.width, SECTION_WIDTHS) ??
    // A sangre solo donde el tema lo pide y la sección lo admite: una banda de
    // ofertas a sangre en Catalog se come la primera pantalla de catálogo.
    (auto.bleedOffers && (id === 'offers' || id === 'promotions') ? 'bleed' : 'contained')

  return { variant, surface, width }
}

/**
 * ¿Qué presentación guardada es válida para esta sección?
 *
 * Réplica de la regla de la base, para el saneador del formulario. Devuelve
 * `undefined` cuando no queda nada válido: guardar `{}` sería guardar ruido.
 */
export function sanitizeSectionPresentation(
  id: HomeSectionId,
  valor: unknown,
): SectionPresentation | undefined {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return undefined
  const reglas = SECTION_PRESENTATION_RULES[id]
  const crudo = valor as Record<string, unknown>

  const salida: { variant?: string; surface?: SectionSurface; width?: SectionWidth } = {}

  const variant = deLaLista(crudo.variant, reglas.variants)
  if (variant && variant !== 'auto') salida.variant = variant

  const surface = deLaLista(crudo.surface, reglas.surfaces)
  if (surface && surface !== 'plain') salida.surface = surface

  const width = deLaLista(crudo.width, SECTION_WIDTHS)
  if (width && width !== 'contained') salida.width = width

  return Object.keys(salida).length > 0 ? salida : undefined
}
