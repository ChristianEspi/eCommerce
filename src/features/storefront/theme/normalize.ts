import { sanitizeSectionPresentation } from './presentation'
import {
  CATEGORY_VARIANTS,
  CONTENT_WIDTHS,
  HEADER_VARIANTS,
  HERO_VARIANTS,
  HOME_SECTION_IDS,
  IMAGE_RATIOS,
  PRODUCT_CARD_VARIANTS,
  PRODUCT_MEDIA_FITS,
  SECTION_SPACINGS,
  THEME_PRESET_IDS,
  type HomeLayout,
  type SectionPresentation,
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
 *
 * ## Dos familias de funciones, y la diferencia importa
 *
 * **`sanitize*` es lo que se GUARDA.** Devuelve lo que la tienda dijo de
 * verdad, sin nada de más: un estilo con dos claves sigue teniendo dos, y un
 * orden de Home vacío sigue vacío. Vacío ahí no significa «portada en blanco»,
 * significa «lo que no digo, lo hereda del tema».
 *
 * **`normalize*` es lo que se PINTA.** Completa: rellena el estilo con el
 * preset y añade al final las secciones que la configuración no mencionaba.
 *
 * Confundirlas tiene una consecuencia concreta y silenciosa: si el formulario
 * guardara la versión completa, la primera vez que alguien tocara el teléfono
 * de contacto congelaría el orden de la portada de esa tienda, y el día que la
 * suite añadiera una sección nueva esa tienda no la vería nunca.
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
 * Las siete claves del estilo con su lista de valores, en un solo sitio.
 *
 * Escribirlas una vez y recorrerlas es lo que impide el fallo clásico de esta
 * clase de código: añadir una octava opción al contrato y que una de las dos
 * funciones se quede sin enterarse.
 */
const CLAVES_DE_ESTILO = [
  ['headerVariant', HEADER_VARIANTS],
  ['heroVariant', HERO_VARIANTS],
  ['productCardVariant', PRODUCT_CARD_VARIANTS],
  ['categoryVariant', CATEGORY_VARIANTS],
  ['contentWidth', CONTENT_WIDTHS],
  ['imageRatio', IMAGE_RATIOS],
  ['sectionSpacing', SECTION_SPACINGS],
  // Storefront V3 · P02. Entra en la MISMA tabla que las siete de V2: es lo que
  // impide el fallo clásico de añadir una opción y que una de las dos funciones
  // se quede sin enterarse.
  ['productMediaFit', PRODUCT_MEDIA_FITS],
] as const satisfies ReadonlyArray<readonly [keyof StorefrontStyle, readonly string[]]>

/**
 * Lo que la tienda dijo de verdad: SOLO las claves válidas que traía.
 *
 * Parcial a propósito. Es lo que se guarda y lo que edita el formulario, porque
 * un estilo completo guardado convertiría «heredo de mi tema» en «tengo estos
 * siete valores fijos», y cambiar de tema después no cambiaría nada.
 */
export function sanitizeStorefrontStyle(valor: unknown): Partial<StorefrontStyle> {
  const crudo = esObjetoPlano(valor) ? valor : {}
  const salida: Record<string, string> = {}

  for (const [clave, permitidos] of CLAVES_DE_ESTILO) {
    const dado = crudo[clave]
    if (typeof dado === 'string' && (permitidos as readonly string[]).includes(dado)) {
      salida[clave] = dado
    }
  }

  return salida as Partial<StorefrontStyle>
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

  // El preset primero y lo que pisó la tienda encima. `id` y `gridColumns` se
  // quedan fuera enumerando las claves: un `...base` habría colado los dos en
  // un objeto que el contrato dice que no los tiene.
  return {
    headerVariant: base.headerVariant,
    heroVariant: base.heroVariant,
    productCardVariant: base.productCardVariant,
    categoryVariant: base.categoryVariant,
    contentWidth: base.contentWidth,
    imageRatio: base.imageRatio,
    sectionSpacing: base.sectionSpacing,
    // Storefront V3 · P02.
    productMediaFit: base.productMediaFit,
    ...sanitizeStorefrontStyle(valor),
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
  /**
   * La presentación, saneada POR SECCIÓN (Storefront V3 · P06).
   *
   * Las opciones válidas dependen del `id`: `spotlight` significa algo en una
   * fila de producto y nada en el hero. `sanitizeSectionPresentation` descarta
   * lo que no encaja y devuelve `undefined` si no queda nada — guardar `{}`
   * sería guardar ruido, y una presentación ausente ya significa `auto`.
   *
   * Se sanea SIEMPRE, también en las secciones sin tope: el ritmo de las
   * familias o de las marcas no depende de cuántos elementos enseñan.
   */
  const presentation = sanitizeSectionPresentation(porDefecto.id, crudo.presentation)

  const base: { id: HomeSectionId; enabled: boolean; presentation?: SectionPresentation } = {
    id: porDefecto.id,
    enabled,
  }
  if (presentation) base.presentation = presentation

  if (!SECTIONS_WITH_MAX_ITEMS.has(porDefecto.id)) return base

  const tope = topeValido(crudo.maxItems)
  return tope === null ? base : { ...base, maxItems: tope }
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
function seccionesReconocidas(valor: unknown, porDefecto: HomeLayout): HomeSectionConfig[] {
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

  return salida
}

/**
 * Lo que la tienda dijo de verdad sobre su portada: sin completar.
 *
 * Es lo que se guarda. Una lista vacía se queda vacía porque significa «uso el
 * orden heredado», y sustituirla por las trece secciones de hoy congelaría esa
 * tienda en el orden de hoy.
 */
export function sanitizeHomeLayout(valor: unknown, porDefecto: HomeLayout): HomeLayout {
  const sections = seccionesReconocidas(valor, porDefecto)
  return { version: versionDe(sections), sections }
}

/**
 * Qué versión declara lo guardado (Storefront V3 · P06).
 *
 * `2` en cuanto alguna sección lleva presentación; `1` mientras no. No se sube
 * la versión «porque ahora estamos en V3»: una tienda que solo ordenó sus
 * secciones sigue siendo V1, y escribir `2` en su fila haría creer que usa algo
 * que no usa. La versión describe el CONTENIDO, no la fecha del despliegue.
 */
function versionDe(sections: readonly HomeSectionConfig[]): 1 | 2 {
  return sections.some((s) => s.presentation !== undefined) ? 2 : 1
}

export function normalizeHomeLayout(
  valor: unknown,
  porDefecto: HomeLayout,
): HomeLayout {
  const salida = seccionesReconocidas(valor, porDefecto)
  const vistas = new Set(salida.map((s) => s.id))

  for (const seccion of porDefecto.sections) {
    if (!vistas.has(seccion.id)) salida.push(seccion)
  }

  return { version: versionDe(salida), sections: salida }
}
