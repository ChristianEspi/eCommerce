import { createContext } from 'react'
import type { CSSProperties } from 'react'
import type { ImageRatio, SectionSpacing } from './types'
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

/** La proporción de `ProductMedia`, que hoy viene cableada en `1 / 1`. */
const PROPORCION: Record<ImageRatio, string> = {
  square: '1 / 1',
  portrait: '3 / 4',
  landscape: '4 / 3',
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

  return {
    '--sf-section-gap': `${aire.xs}px`,
    '--sf-section-gap-md': `${aire.md}px`,
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
