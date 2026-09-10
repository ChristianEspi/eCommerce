import { useContext } from 'react'
import { StorefrontThemeContext } from './theme-context'
import type { ResolvedStoreTheme } from './resolve'

/**
 * El tema de la tienda que se está pintando.
 *
 * Fuera de la vitrina devuelve el tema por defecto en vez de lanzar. Es la
 * misma decisión que gobierna todo el módulo: esto es presentación, y una
 * excepción aquí convertiría un componente montado en un sitio inesperado —una
 * prueba, una vista previa, un trozo reutilizado— en una pantalla rota. El
 * backoffice no lo usa, y si algún día lo usara, se vería como `universal`.
 */
export function useStorefrontTheme(): ResolvedStoreTheme {
  return useContext(StorefrontThemeContext)
}
