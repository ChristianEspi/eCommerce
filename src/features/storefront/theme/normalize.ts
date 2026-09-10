import {
  CATEGORY_VARIANTS,
  CONTENT_WIDTHS,
  HEADER_VARIANTS,
  HERO_VARIANTS,
  HOME_SECTION_IDS,
  IMAGE_RATIOS,
  PRODUCT_CARD_VARIANTS,
  SECTION_SPACINGS,
  THEME_PRESET_IDS,
  type HomeLayout,
  type HomeSectionConfig,
  type HomeSectionId,
  type StorefrontStyle,
  type ThemeDefinition,
  type ThemePreset,
} from './types'

/**
 * De lo que llega de la base a lo que la vitrina puede pintar.
 *
 * ## La regla, que es una sola
 *
 * **Nada de aquí lanza.** Estas funciones son el borde por el que entra la
 * configuración menos fiable que tiene la vitrina: una fila pública que puede
 * venir de una versión anterior al despliegue, de un editor que guardó algo
 * raro o de una escritura a mano. Si cualquiera de esos casos pudiera tirar el
 * render, un JSON con una clave de más cerraría la tienda.
 *
 * Así que lo desconocido no se rechaza: se sustituye por lo seguro y se sigue.
 *
 * ## Por qué no hace falta sanear
 *
 * No se busca `<script>` ni `javascript:` ni `url(`. La lista de claves es
 * cerrada y la de valores también, así que lo que no está nombrado no entra —
 * por ausencia, no por filtro. Un filtro solo detiene lo que alguien previó;
 * una lista blanca detiene también lo que nadie imaginó.
 */

/** Cuánto puede pedir una sección de colección. */
export const MAX_ITEMS_LIMITS = { min: 1, max: 24 } as const

/**
 * Las secciones donde un tope significa algo.
 *
 * El hero enseña una cosa y la franja de servicios cuatro fijas: un `maxItems`
 * ahí no es una preferencia, es ruido que alguien tendría que interpretar. Se
 * descarta en la normalización, así que nunca llega a la pantalla.
 */
export const SECTIONS_WITH_MAX_ITEMS: ReadonlySet<HomeSectionId> = new Set<HomeSectionId>([
  'offers',
  'promotions',
  'categories',
  'brands',
  'new-arrivals',
  'best-sellers',
  'featured',
])

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Devuelve el valor si está en la lista cerrada; si no, el de reserva. */
function deLaLista<T extends string>(
  valor: unknown,
  permitidos: readonly T[],
  reserva: T,
): T {
  return typeof valor === 'string' && (permitidos as readonly string[]).includes(valor)
    ? (valor as T)
    : reserva
}

/**
 * El preset, o `universal`.
 *
 * Sin recortar espacios ni bajar mayúsculas a propósito: este valor lo escribe
 * la base contra una lista cerrada, no una persona. Si llega `'Retail'` es que
 * algo escribió fuera del contrato, y adivinar la intención escondería el
 * defecto en vez de enseñarlo.
 */
export function normalizeThemePreset(valor: unknown): ThemePreset {
  return deLaLista(valor, THEME_PRESET_IDS, 'universal')
}

/**
 * El estilo de la tienda, completo y con todas sus claves resueltas.
 *
 * Devuelve siempre el objeto entero —nunca uno parcial— para que quien lo
 * consuma no tenga que decidir de dónde sacar lo que falta. Lo que la tienda no
 * pisó, lo pone el preset.
 *
 * Una clave inválida no invalida el objeto: cae ella sola al valor del preset y
 * el resto de la configuración se conserva. Tirar toda la configuración por un
 * campo mal escrito castiga al comercio por un error que probablemente no
 * cometió.
 */
export function normalizeStorefrontStyle(
  valor: unknown,
  preset: ThemePreset,
  presets: Readonly<Record<ThemePreset, ThemeDefinition>>,
): StorefrontStyle {
  const base = presets[normalizeThemePreset(preset)]
  const crudo = esObjetoPlano(valor) ? valor : {}

  return {
    headerVariant: deLaLista(crudo.headerVariant, HEADER_VARIANTS, base.headerVariant),
    heroVariant: deLaLista(crudo.heroVariant, HERO_VARIANTS, base.heroVariant),
    productCardVariant: deLaLista(
      crudo.productCardVariant,
      PRODUCT_CARD_VARIANTS,
      base.productCardVariant,
    ),
    categoryVariant: deLaLista(crudo.categoryVariant, CATEGORY_VARIANTS, base.categoryVariant),
    contentWidth: deLaLista(crudo.contentWidth, CONTENT_WIDTHS, base.contentWidth),
    imageRatio: deLaLista(crudo.imageRatio, IMAGE_RATIOS, base.imageRatio),
    sectionSpacing: deLaLista(crudo.sectionSpacing, SECTION_SPACINGS, base.sectionSpacing),
  }
}

/** Un entero dentro de los límites, o nada. */
function topeValido(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) return null
  return Math.min(Math.max(valor, MAX_ITEMS_LIMITS.min), MAX_ITEMS_LIMITS.max)
}

function seccionNormalizada(
  crudo: Record<string, unknown>,
  porDefecto: HomeSectionConfig,
): HomeSectionConfig {
  const enabled = typeof crudo.enabled === 'boolean' ? crudo.enabled : porDefecto.enabled
  if (!SECTIONS_WITH_MAX_ITEMS.has(porDefecto.id)) return { id: porDefecto.id, enabled }

  const tope = topeValido(crudo.maxItems)
  return tope === null
    ? { id: porDefecto.id, enabled }
    : { id: porDefecto.id, enabled, maxItems: tope }
}

/**
 * El orden de la Home, siempre completo y sin repetidos.
 *
 * Tres decisiones que valen la pena explicar:
 *
 * **Devuelve TODAS las secciones conocidas.** Lo guardado manda en el orden y en
 * el estado de lo que menciona; lo que no menciona se añade al final con su
 * valor por defecto. Si lo guardado fuera la lista completa, cada sección nueva
 * exigiría reescribir la configuración de todas las tiendas, y hasta entonces
 * sería invisible.
 *
 * **Un identificador repetido gana la primera vez.** Es la posición que el
 * editor eligió; las repeticiones posteriores son un accidente de guardado, y
 * pintar la sección dos veces se lee como un fallo de la tienda.
 *
 * **Una sección desconocida se ignora en silencio.** No se puede pintar lo que
 * no existe, y detener la Home entera por una entrada de más sería cambiar un
 * hueco por una pantalla vacía.
 */
export function normalizeHomeLayout(
  valor: unknown,
  porDefecto: HomeLayout,
): HomeLayout {
  const defectoPorId = new Map(porDefecto.sections.map((s) => [s.id, s]))
  const crudo = esObjetoPlano(valor) ? valor : {}
  const guardadas = Array.isArray(crudo.sections) ? crudo.sections : []

  const salida: HomeSectionConfig[] = []
  const vistas = new Set<HomeSectionId>()

  for (const entrada of guardadas) {
    if (!esObjetoPlano(entrada)) continue
    const id = entrada.id
    if (typeof id !== 'string') continue
    if (!(HOME_SECTION_IDS as readonly string[]).includes(id)) continue
    if (vistas.has(id as HomeSectionId)) continue

    const base = defectoPorId.get(id as HomeSectionId)
    if (!base) continue

    vistas.add(id as HomeSectionId)
    salida.push(seccionNormalizada(entrada, base))
  }

  for (const seccion of porDefecto.sections) {
    if (!vistas.has(seccion.id)) salida.push(seccion)
  }

  return { version: 1, sections: salida }
}
