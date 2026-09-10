import {
  DEFAULT_THEME_PRESET,
  THEME_PRESETS,
  normalizeHomeLayout,
  normalizeStorefrontStyle,
  normalizeThemePreset,
} from './presets'
import type { HomeLayout, StorefrontStyle, ThemeDefinition, ThemePreset } from './types'

/**
 * El puente entre la fila que devuelve la base y lo que la vitrina pinta.
 *
 * ## Por qué existe una función en vez de leer los campos donde hagan falta
 *
 * Porque son DOS CAPAS y mezclarlas se paga caro:
 *
 *  · lo **crudo** es lo que vino de `public_stores`. Puede faltar entero —una
 *    respuesta anterior al despliegue de la migración no trae esas columnas—,
 *    puede traer un JSON escrito a mano y puede traer un nombre de tema que
 *    esta versión no conoce;
 *  · lo **resuelto** es un tema completo, con las siete claves de estilo
 *    puestas y el orden de la Home entero. Un componente que reciba esto no
 *    tiene que preguntarse nada.
 *
 * Si cada componente leyera `store.theme_preset` por su cuenta, cada uno
 * decidiría a su manera qué hacer con lo que falta, y la tienda se vería
 * distinta según qué parte de la pantalla hubiera tenido más suerte.
 *
 * ## Y por qué no lanza nunca
 *
 * Es el borde de datos menos fiable de la vitrina. Una tienda en blanco por un
 * JSON raro es una tienda CERRADA: pierde ventas de verdad. Así que lo
 * desconocido no se rechaza, se sustituye por lo seguro y se sigue.
 */
export interface ResolvedStoreTheme {
  readonly preset: ThemePreset
  /** El preset entero, incluidas las columnas de rejilla que el estilo no pisa. */
  readonly definition: ThemeDefinition
  /** Las siete claves, ya con lo que la tienda pisó encima. */
  readonly style: StorefrontStyle
  /** El orden completo: lo guardado primero, lo que faltaba detrás. */
  readonly layout: HomeLayout
}

/**
 * Lo que hace falta de una tienda para resolver su tema.
 *
 * Estructural y con las tres claves opcionales a propósito: así esto no importa
 * `PublicStore` —que sería un ciclo— y sirve igual para la fila pública, para
 * la de ajustes del backoffice y para una vista previa que todavía no se ha
 * guardado.
 */
export interface StoreThemeFields {
  readonly theme_preset?: unknown
  readonly storefront_style?: unknown
  readonly home_layout?: unknown
}

export function resolveStoreTheme(fila: StoreThemeFields | null | undefined): ResolvedStoreTheme {
  const preset = normalizeThemePreset(fila?.theme_preset)

  return {
    preset,
    definition: THEME_PRESETS[preset],
    style: normalizeStorefrontStyle(fila?.storefront_style, preset),
    layout: normalizeHomeLayout(fila?.home_layout),
  }
}

/** El tema de una tienda que no tiene tienda: la vitrina sin datos aún. */
export const DEFAULT_STORE_THEME: ResolvedStoreTheme = resolveStoreTheme({
  theme_preset: DEFAULT_THEME_PRESET,
})
