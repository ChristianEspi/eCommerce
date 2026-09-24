import { createContext } from 'react'
import type { CSSProperties } from 'react'
import type { ContentWidth, HeaderVariant, ImageRatio, SectionSpacing } from './types'
import { DEFAULT_STORE_THEME, type ResolvedStoreTheme } from './resolve'

/**
 * El tema de la tienda, disponible para toda la vitrina.
 *
 * ## Qué entra en este contexto y qué no
 *
 * Entra lo **resuelto**: el preset, su definición completa, las siete claves de
 * estilo ya con lo que la tienda pisó encima, y el orden entero de la portada.
 *
 * No entra el JSON crudo de la fila. No es una cuestión de limpieza: si cada
 * componente pudiera leer `storefront_style` sin normalizar, cada uno decidiría
 * a su manera qué hacer con un valor que no reconoce, y la tienda se vería
 * distinta según qué parte de la pantalla hubiera tenido más suerte. Aquí la
 * decisión ya está tomada, una vez, en `resolveStoreTheme`.
 *
 * ## Dónde termina este contexto y empieza `AppearanceProvider`
 *
 * `AppearanceProvider` sigue mandando en el color, la tipografía, el radio y la
 * densidad — es de suite y lo comparten el backoffice y la vitrina. Esto manda
 * en la DISPOSICIÓN: qué variante de cabecera, cuánto ancho, qué proporción de
 * imagen, cuánto aire. Repetir cualquiera de los dos lados en el otro crearía
 * dos fuentes de verdad para el mismo píxel.
 */
export const StorefrontThemeContext = createContext<ResolvedStoreTheme>(DEFAULT_STORE_THEME)

/**
 * Cuánto aire entre secciones, en píxeles.
 *
 * Los tres valores no son una escala inventada: `comfortable` es exactamente el
 * `{ xs: 2, md: 3 }` de MUI que la portada ya usaba, para que una tienda que no
 * eligió tema no cambie ni un píxel.
 */
const AIRE: Record<SectionSpacing, { xs: number; md: number }> = {
  compact: { xs: 12, md: 16 },
  comfortable: { xs: 16, md: 24 },
  spacious: { xs: 24, md: 40 },
}

/**
 * El aire ALREDEDOR del contenido, que no es el mismo que el aire entre
 * secciones.
 *
 * Son dos medidas distintas y confundirlas cambia la tienda de quien no eligió
 * nada: la portada separaba sus bandas con `{ xs: 2, md: 3 }` y el contenedor
 * respiraba con `{ xs: 2.5, md: 4 }`. `comfortable` conserva las dos.
 */
const MARGEN: Record<SectionSpacing, { xs: number; md: number }> = {
  compact: { xs: 14, md: 22 },
  comfortable: { xs: 20, md: 32 },
  spacious: { xs: 28, md: 48 },
}

/**
 * La altura de la barra.
 *
 * `standard` es la de hoy, al píxel. `compact` recorta lo justo para que en
 * `catalog` —miles de referencias, quien busca sabe lo que busca— la primera
 * pantalla sea catálogo y no navegación.
 */
const BARRA: Record<HeaderVariant, { xs: number; md: number }> = {
  standard: { xs: 60, md: 68 },
  compact: { xs: 52, md: 56 },
}

/** La proporción de `ProductMedia`, que hoy viene cableada en `1 / 1`. */
const PROPORCION: Record<ImageRatio, string> = {
  square: '1 / 1',
  portrait: '3 / 4',
  landscape: '4 / 3',
}

/**
 * El ancho máximo del contenido, en píxeles (Storefront V2 · P05).
 *
 * ## Por qué no se usan los de MUI
 *
 * `Container maxWidth="lg"` son 1200 px y `xl` son 1536. Eran los de una
 * herramienta de trabajo, y en la vitrina se notaban: en un monitor de 1920 la
 * tienda dejaba 360 px de margen a cada lado, así que el catálogo se veía en
 * una columna estrecha con dos desiertos al lado. Un eCommerce moderno usa el
 * ancho que tiene.
 *
 * `lg` sube a 1320 y `xl` a 1680, que es lo que cabe cómodo en 1440 y en 1920
 * dejando aire real. No se sube más: a partir de ahí las filas de producto se
 * estiran tanto que recorrerlas obliga a mover la cabeza.
 *
 * ## Y por qué esto NO convierte el texto en líneas infinitas
 *
 * Porque el ancho del CONTENEDOR y la medida del TEXTO son dos cosas distintas,
 * y aquí solo se toca la primera. Los bloques de texto llevan su propio tope —el
 * titular de la portada a 680 px, su bajada a 560, la descripción del pie a
 * 368— y una rejilla de tarjetas gana columnas en vez de ensanchar las que
 * tiene. Lo que crece es cuánto CABE, no cuánto mide una línea.
 */
const ANCHO: Record<ContentWidth, number> = {
  lg: 1320,
  xl: 1680,
}

/**
 * El alto de la caja de búsqueda y el aire de la barra de familias.
 *
 * Es la otra mitad de `headerVariant`, y la que le da sentido de verdad: hasta
 * P05 lo único que cambiaba entre `standard` y `compact` eran doce píxeles de
 * altura de la barra. Con esto, `compact` recorta también la caja de búsqueda y
 * el aire de la fila de familias, y la suma sí se nota: la primera pantalla de
 * un catálogo de miles de referencias gana casi treinta píxeles de producto.
 */
const BUSCADOR: Record<HeaderVariant, number> = {
  standard: 42,
  compact: 34,
}

const AIRE_NAV: Record<HeaderVariant, number> = {
  standard: 6,
  compact: 2,
}

/**
 * Las variables CSS del tema, para colgarlas de la frontera `.sf-scope`.
 *
 * Van como variables y no como props porque así una hoja de estilos puede
 * usarlas sin que ningún componente se entere, que es la diferencia entre
 * tematizar y repartir `if (theme === 'retail')` por el JSX. La versión `-md`
 * existe porque una media query no puede leer un valor distinto de la misma
 * variable: se declaran las dos y `storefront.css` elige.
 */
export function themeCssVars(theme: ResolvedStoreTheme): CSSProperties {
  const aire = AIRE[theme.style.sectionSpacing]
  const margen = MARGEN[theme.style.sectionSpacing]
  const barra = BARRA[theme.style.headerVariant]

  return {
    '--sf-section-gap': `${aire.xs}px`,
    '--sf-section-gap-md': `${aire.md}px`,
    '--sf-main-pad': `${margen.xs}px`,
    '--sf-main-pad-md': `${margen.md}px`,
    '--sf-header-h': `${barra.xs}px`,
    '--sf-header-h-md': `${barra.md}px`,
    '--sf-content-w': `${ANCHO[theme.style.contentWidth]}px`,
    '--sf-search-h': `${BUSCADOR[theme.style.headerVariant]}px`,
    '--sf-nav-pad': `${AIRE_NAV[theme.style.headerVariant]}px`,
    /**
     * Cuánto hay que bajar para que un ancla no quede DEBAJO de la cabecera.
     *
     * La cabecera es pegajosa y la barra de familias va justo debajo, así que un
     * enlace a `#marcas` dejaba la sección medio tapada — se saltaba a ella y
     * había que subir a mano. Estaba resuelto con un `96` escrito a mano en un
     * componente, que dejó de ser cierto en cuanto la barra cambió de alto por
     * tema.
     *
     * Sale del alto real de la barra más el de la fila de familias (su aire por
     * dos, más la píldora de 30 px) y un respiro de 12.
     */
    '--sf-anchor-offset': `${barra.md + AIRE_NAV[theme.style.headerVariant] * 2 + 30 + 12}px`,
    '--sf-image-ratio': PROPORCION[theme.style.imageRatio],
    '--sf-grid-xs': String(theme.definition.gridColumns.xs),
    '--sf-grid-sm': String(theme.definition.gridColumns.sm),
    '--sf-grid-lg': String(theme.definition.gridColumns.lg),
  } as CSSProperties
}

/**
 * Los atributos que la frontera de la vitrina expone al DOM.
 *
 * Valores de LISTA CERRADA, nunca texto del tenant: un `data-` con contenido
 * libre acaba en un selector de CSS, y ahí un nombre de tienda con comillas es
 * un problema. Estos cuatro salen de listas que este repositorio escribe.
 */
export function themeDataAttributes(theme: ResolvedStoreTheme): Record<string, string> {
  return {
    'data-store-theme': theme.preset,
    'data-store-header': theme.style.headerVariant,
    'data-store-cards': theme.style.productCardVariant,
    'data-store-spacing': theme.style.sectionSpacing,
  }
}
