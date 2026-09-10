import { useMemo, type ReactNode } from 'react'
import { StorefrontThemeContext } from './theme-context'
import { resolveStoreTheme, type StoreThemeFields } from './resolve'

/**
 * Monta el tema de la tienda para la vitrina, y solo para la vitrina.
 *
 * Va DENTRO de la rama en la que la tienda ya está resuelta —después de la
 * carga, del 404 y del error— porque antes de eso no hay tema que aplicar y
 * pintar uno provisional sería el «flash de branding» que el encargo prohíbe,
 * en versión disposición.
 *
 * No sustituye a `AppearanceProvider` ni lo envuelve por dentro: son dos capas
 * con dueños distintos y se montan una junto a otra. Ver `theme-context.ts`.
 */
export function StorefrontThemeProvider({
  store,
  children,
}: {
  /** La fila de `public_stores`, cruda. La normalización ocurre aquí dentro. */
  store: StoreThemeFields | null | undefined
  children: ReactNode
}) {
  // Las tres referencias que entran son estables mientras la consulta no se
  // repita, así que esto resuelve una vez por tienda y no en cada render de
  // cualquier hijo.
  const theme = useMemo(
    () =>
      resolveStoreTheme({
        theme_preset: store?.theme_preset,
        storefront_style: store?.storefront_style,
        home_layout: store?.home_layout,
      }),
    [store?.theme_preset, store?.storefront_style, store?.home_layout],
  )

  return <StorefrontThemeContext.Provider value={theme}>{children}</StorefrontThemeContext.Provider>
}
