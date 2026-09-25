import {
  normalizeHomeLayout as normalizeHomeLayoutCon,
  normalizeStorefrontStyle as normalizeStorefrontStyleCon,
  normalizeThemePreset,
  sanitizeHomeLayout as sanitizeHomeLayoutCon,
} from './normalize'
import type { HomeLayout, HomeSectionConfig, StorefrontStyle, ThemeDefinition, ThemePreset } from './types'

export {
  MAX_ITEMS_LIMITS,
  SECTIONS_WITH_MAX_ITEMS,
  normalizeThemePreset,
  sanitizeStorefrontStyle,
} from './normalize'
export * from './types'

/**
 * Los cuatro presets, escritos como datos.
 *
 * ## Qué distingue a cada uno, y por qué
 *
 * Ninguno inventa un componente: los cuatro combinan las mismas piezas con
 * valores distintos. Esa es la prueba de que el Theme Engine es configuración y
 * no cuatro aplicaciones — si un preset necesitara un árbol propio, dejaría de
 * serlo.
 *
 * **universal** es el suelo y la compatibilidad. Sus valores no son una opinión
 * de diseño: son *exactamente* lo que la vitrina ya hace hoy —`Container` en
 * `lg`, `ProductMedia` en `1 / 1`, `ProductGrid` repartiendo 2/3/4—. Cambiarlos
 * es cambiarle la tienda a quien nunca eligió tema, así que hay un test que los
 * fija.
 *
 * **retail** vende por repetición: más productos a la vista y menos aire entre
 * secciones, porque quien compra jabón y paracetamol no está contemplando, está
 * llenando una lista.
 *
 * **premium** hace lo contrario y por el mismo motivo: menos productos por
 * fila, foto vertical —la proporción de la ropa y el calzado— y aire de sobra.
 * Una prenda se mira; un envase se identifica.
 *
 * **catalog** es para quien tiene miles de referencias y sabe lo que busca:
 * ancho extra, cinco columnas, tarjeta compacta y las categorías en píldoras,
 * que ocupan una línea en vez de una parrilla. La cabecera se reduce para que
 * la primera pantalla sea catálogo y no navegación.
 */
export const THEME_PRESETS: Readonly<Record<ThemePreset, ThemeDefinition>> = {
  universal: {
    id: 'universal',
    headerVariant: 'standard',
    heroVariant: 'product',
    productCardVariant: 'comfortable',
    categoryVariant: 'tiles',
    contentWidth: 'lg',
    imageRatio: 'square',
    sectionSpacing: 'comfortable',
    /**
     * `contain`, que es lo que la tarjeta hacía cableado para todas las tiendas
     * (Storefront V3 · P02).
     *
     * ## Desvío consciente del prompt de la fase, que proponía `cover`
     *
     * Universal es el tema de quien no ha elegido, y la plataforma NO sabe qué
     * vende. `cover` recorta: en una caja de medicamento se come el nombre del
     * principio activo, y en un tornillo, la métrica. Es pérdida de información
     * sobre la foto de otro, y es irreversible desde la vitrina.
     *
     * Y hay un segundo motivo, del mismo prompt: exige que Universal conserve
     * una apariencia compatible. Hoy TODAS las tiendas ven `contain`, así que
     * poner `cover` aquí recortaría las fotos de cada tienda que nunca eligió
     * tema. Los dos requisitos chocaban; se resuelve del lado que no destruye
     * datos ajenos.
     *
     * Quien quiera el encuadre lleno lo tiene a un control de distancia —o
     * eligiendo Premium, que es donde la fotografía manda—.
     */
    productMediaFit: 'contain',
    gridColumns: { xs: 2, sm: 3, lg: 4 },
  },
  retail: {
    id: 'retail',
    headerVariant: 'standard',
    heroVariant: 'product',
    productCardVariant: 'compact',
    categoryVariant: 'tiles',
    contentWidth: 'lg',
    imageRatio: 'square',
    sectionSpacing: 'compact',
    // Retail vende producto envasado y fotografiado sobre fondo claro, donde el
    // recorte se come justo lo que identifica la referencia.
    productMediaFit: 'contain',
    gridColumns: { xs: 2, sm: 4, lg: 5 },
  },
  premium: {
    id: 'premium',
    /**
     * Storefront V3 · P02 · Premium pasa a ser BRAND-FIRST de verdad.
     *
     * Hasta V3 declaraba `standard` / `comfortable` / `tiles`: las mismas piezas
     * que Universal con más aire y proporción vertical. Se distinguía en las
     * medidas, no en la composición — y eso es exactamente lo que el pack V3
     * rechaza como rediseño.
     *
     * Las tres variantes nuevas le dan su propia forma:
     *
     *  · `brand` — la marca al centro y la navegación en su fila. Una tienda de
     *    marca no compite por el clic en la primera pantalla, compite por ser
     *    reconocida.
     *  · `editorial` — la tarjeta suelta el recuadro y deja mandar a la
     *    fotografía, con el texto debajo.
     *  · `mosaic` — las familias en azulejos de tamaños distintos, que es lo que
     *    dice cuál manda. Azulejos iguales reparten la atención por igual.
     */
    headerVariant: 'brand',
    heroVariant: 'statement',
    productCardVariant: 'editorial',
    categoryVariant: 'mosaic',
    contentWidth: 'lg',
    imageRatio: 'portrait',
    sectionSpacing: 'spacious',
    /**
     * El ÚNICO preset con `cover`, y por eso existe la clave.
     *
     * Premium es el tema que se elige cuando la fotografía es el argumento de
     * venta: ropa, muebles, joyería. Ahí `contain` deja franjas vacías arriba y
     * abajo de cada prenda y la rejilla se ve descosida, mientras que el recorte
     * no pierde nada que importe — la foto es de estudio y está encuadrada para
     * esto.
     */
    productMediaFit: 'cover',
    gridColumns: { xs: 2, sm: 2, lg: 3 },
  },
  catalog: {
    id: 'catalog',
    headerVariant: 'compact',
    heroVariant: 'product',
    productCardVariant: 'compact',
    categoryVariant: 'pills',
    contentWidth: 'xl',
    imageRatio: 'square',
    sectionSpacing: 'compact',
    // Seis columnas de referencias: recortar aquí haría irreconocible la mitad
    // del catálogo.
    productMediaFit: 'contain',
    gridColumns: { xs: 2, sm: 4, lg: 6 },
  },
} as const

export const DEFAULT_THEME_PRESET: ThemePreset = 'universal'

/**
 * El orden heredado de la Home.
 *
 * No es un orden nuevo: es el que `StoreHomePage` ya pinta hoy, transcrito. Es
 * la otra mitad del contrato de compatibilidad —una tienda que nunca configuró
 * nada tiene que seguir viéndose igual— y por eso hay un test que lo fija
 * sección por sección.
 *
 * Cuatro quedan apagadas, cada una por su motivo:
 *
 *  · `categories` hoy solo aparece en el catálogo (`CategoryBar`), no en la
 *    portada; encenderla añadiría una sección que nadie pidió.
 *  · `featured` va HOY dentro de `offers`: `OffersFeaturedBand` pinta lo
 *    rebajado y lo destacado en la misma banda. Separarlas es una decisión de
 *    P06, no un valor por defecto.
 *  · `business-info` tiene componente desde P09, y sigue apagada: es el
 *    comercio quien decide si quiere repetir su contacto a media portada, y
 *    encenderla de oficio añadiría una sección que nadie pidió a todas las
 *    tiendas que ya existen.
 *  · `newsletter` no tiene componente: no hay dónde guardar una suscripción ni
 *    su consentimiento. Declarada y apagada; cuando exista, se enciende sin
 *    tocar el contrato.
 */
const SECCIONES_HEREDADAS: readonly HomeSectionConfig[] = [
  { id: 'hero', enabled: true },
  { id: 'services', enabled: true },
  { id: 'offers', enabled: true },
  { id: 'cms', enabled: true },
  { id: 'promotions', enabled: true },
  { id: 'brands', enabled: true },
  { id: 'new-arrivals', enabled: true },
  { id: 'best-sellers', enabled: true },
  { id: 'trust', enabled: true },
  { id: 'categories', enabled: false },
  { id: 'featured', enabled: false },
  { id: 'business-info', enabled: false },
  { id: 'newsletter', enabled: false },
]

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: 1,
  sections: SECCIONES_HEREDADAS,
}

/**
 * Las dos normalizaciones, ya atadas a los presets y al orden heredado.
 *
 * Los núcleos viven en `normalize.ts` y reciben sus tablas como argumento, que
 * es lo que los deja probar sin arrastrar los presets. Aquí se cierran con los
 * valores de verdad para que quien las use no pueda pasarles otros por error.
 */
export function normalizeStorefrontStyle(valor: unknown, preset: ThemePreset): StorefrontStyle {
  return normalizeStorefrontStyleCon(valor, preset, THEME_PRESETS)
}

export function normalizeHomeLayout(valor: unknown): HomeLayout {
  return normalizeHomeLayoutCon(valor, DEFAULT_HOME_LAYOUT)
}

/** Lo que se GUARDA del orden de la Home: sin completar. Ver `normalize.ts`. */
export function sanitizeHomeLayout(valor: unknown): HomeLayout {
  return sanitizeHomeLayoutCon(valor, DEFAULT_HOME_LAYOUT)
}

/** El preset resuelto, listo para que el proveedor lo exponga (P04). */
export function resolveThemeDefinition(valor: unknown): ThemeDefinition {
  return THEME_PRESETS[normalizeThemePreset(valor)]
}
