/**
 * Escalas de suite EBIM (handoff eExpense → eSupplier, esupplier-014).
 * Los colores viven en CSS vars (`tokens.css`) para que el theming por tenant
 * sea un cambio de variables, nunca de componentes.
 */

export const C = {
  accent: 'var(--accent)',
  /** AA: usar SIEMPRE para texto/links sobre fondo claro. Nunca `accent` puro. */
  accentDeep: 'var(--accent-deep)',
  accentSoft: 'var(--accent-soft)',
  accent2: 'var(--accent2)',
  ink: 'var(--text)',
  muted: 'var(--muted)',
  neutralSoft: 'var(--neutral-soft)',
  line: 'var(--border)',
  card: 'var(--card)',
  bg: 'var(--bg)',
  sidebar: 'var(--sidebar)',
  heroGrad: 'var(--hero-grad)',
  badgeGrad: 'var(--badge-grad)',
  amber: 'var(--amber)',
  amberSoft: 'var(--amber-soft)',
  red: 'var(--red)',
  redSoft: 'var(--red-soft)',
  blue: 'var(--blue)',
  blueSoft: 'var(--blue-soft)',
  /** Semántico de «resultado bueno» (entregado). Fijo: el acento del tenant no lo cambia. */
  green: 'var(--green)',
  greenSoft: 'var(--green-soft)',
  client: 'var(--client)',
  white: '#FFFFFF',
} as const

/** Spacing base 4. */
export const S = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const

/** Radios. Card=lg(14); inputs/botones=md(12); hero=xl(18); chips=pill. */
export const R = { sm: 8, md: 12, lg: 14, xl: 18, pill: 999 } as const

/** Densidad (cableada a data-density). */
export const D = {
  controlH: 'var(--control-h)',
  rowH: 'var(--row-h)',
  padY: 'var(--pad-y)',
  padX: 'var(--pad-x)',
} as const

/** Escala tipográfica (px). DM Sans. */
export const T = {
  hero: 30,
  kpiBig: 28,
  figure: 26,
  kpiCard: 24,
  pageTitle: 21,
  cardTitle: 14.5,
  body: 13,
  bodyStrong: 13.5,
  label: 11,
  micro: 10,
} as const

/**
 * Escala tipografica de la VITRINA.
 *
 * `T` esta calibrada para el backoffice, que es una herramienta de trabajo:
 * cuerpo a 13 px y etiquetas a 11 px caben mas filas en pantalla, y quien las
 * lee esta sentado mirando datos. La tienda publica no compite por lo mismo —lo
 * dice el propio `storefront.css`: «el backoffice es una herramienta; la vitrina
 * vende»— y sin embargo heredaba esos mismos numeros en ochenta y siete sitios.
 *
 * Un catalogo con el cuerpo a 13 px se lee como un listado de inventario. Aqui
 * cada papel sube un escalon, sin inventar tamanos nuevos: los mismos nombres,
 * la misma jerarquia, un paso mas grandes. La escala sigue siendo una lista
 * cerrada — el problema que resuelve no es que los numeros fueran pequenos sino
 * que ademas cada componente elegia el suyo.
 *
 * Solo la usa `src/features/storefront`. El backoffice sigue con `T`, intacto.
 */
export const TS = {
  /** Titular de portada. */
  hero: 32,
  /** Cifra grande: precio destacado, importe de una oferta. */
  figure: 26,
  /** Titulo de pagina o de seccion. */
  pageTitle: 23,
  /** Nombre de producto en tarjeta. */
  cardTitle: 15.5,
  /** Cuerpo. Es el cambio que mas se nota: 13 -> 14. */
  body: 14,
  bodyStrong: 14.5,
  /** Versalitas de contexto: categoria, vigencia, estado. */
  label: 12,
  micro: 10.5,
} as const

/** Sombras (conmutan light/dark). */
export const SH = {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  hero: 'var(--shadow-hero)',
} as const

export const FONT_STACK = "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"

/**
 * White-label del tenant (P11-SaaS): tipografía y radio, por TOKEN.
 *
 * ## Por qué la lista está cerrada y por qué todas las pilas son locales
 *
 * El encargo pide «tipografía de una whitelist» y prohíbe ejecutar código
 * arbitrario del tenant. Una fuente elegida por URL sería contenido remoto que
 * el comercio decide y que la vitrina carga en su propio dominio: no es
 * JavaScript, pero es exactamente la misma clase de agujero (fuga de la
 * navegación al proveedor de fuentes, y un recurso de terceros que puede
 * cambiar sin que nadie lo revise).
 *
 * `dm-sans` es la de suite y ya viene cargada en `index.html`; `plus-jakarta`
 * es la de la vitrina y se auto-aloja con `@fontsource` (llega en el chunk del
 * storefront, no en el del backoffice); las otras cuatro son pilas del sistema
 * operativo y no cuestan ni una petición. Añadir una
 * fuente web nueva es una decisión de producto —hay que cargarla, medirla y
 * comprobar su contraste— y por eso es una línea de código, no una fila.
 *
 * Los nombres son los mismos que el CHECK `store_settings_font` de la migración
 * `20260828140200`: si las dos listas se separan, un valor válido en la base
 * caería aquí al fallback y el tenant vería otra fuente sin que nada fallara.
 */
export const BRAND_FONTS = [
  'dm-sans',
  'plus-jakarta',
  'system',
  'grotesk',
  'serif',
  'mono',
  // Resumen v2 (migración 20260927100000): las que proponen los temas.
  'archivo',
  'fraunces',
  'plex',
  // Premium desde 2026-09-27 (elección del operador): sustituye a Fraunces
  // como propuesta del tema. Fraunces sigue en la lista: hay tiendas que
  // pueden tenerla guardada.
  'jost',
] as const
export type BrandFont = (typeof BRAND_FONTS)[number]

export const BRAND_FONT_STACKS: Record<BrandFont, string> = {
  'dm-sans': FONT_STACK,
  // La de la VITRINA por defecto (P17). Se auto-aloja con `@fontsource`, que es
  // la diferencia entre servir la fuente desde el dominio del comercio y pedirle
  // al navegador del comprador que la baje de un tercero.
  'plus-jakarta': "'Plus Jakarta Sans', 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  grotesk: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  // Resumen v2 · Auto-alojadas con `@fontsource` (ver `storefrontFonts.ts`).
  // Retail: grotesca de cifras firmes, para leer precios de un vistazo.
  archivo: "'Archivo', 'Helvetica Neue', Arial, system-ui, sans-serif",
  // Premium: serifa editorial; la reserva es la serifa del sistema.
  fraunces: "'Fraunces', Georgia, 'Times New Roman', serif",
  // Catálogo: técnica y compacta, pensada para códigos y tablas.
  plex: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  // Premium: geométrica y fina, de boutique; legible en precios y botones.
  jost: "'Jost', 'Helvetica Neue', Arial, system-ui, sans-serif",
}

/** Radio del tenant. `soft` es el de suite y el default cuando no hay token. */
export const BRAND_RADII = ['sharp', 'soft', 'round'] as const
export type BrandRadius = (typeof BRAND_RADII)[number]

export type RadiusScale = { sm: number; md: number; lg: number; xl: number; pill: number }

export const BRAND_RADIUS_SCALES: Record<BrandRadius, RadiusScale> = {
  sharp: { sm: 2, md: 4, lg: 4, xl: 6, pill: 6 },
  soft: { sm: 8, md: 12, lg: 14, xl: 18, pill: 999 },
  round: { sm: 12, md: 18, lg: 22, xl: 28, pill: 999 },
}

export function brandFontStack(token: string | null | undefined): string {
  return (BRAND_FONTS as readonly string[]).includes(token ?? '')
    ? BRAND_FONT_STACKS[token as BrandFont]
    : FONT_STACK
}

export function brandRadiusScale(token: string | null | undefined): RadiusScale {
  return (BRAND_RADII as readonly string[]).includes(token ?? '')
    ? BRAND_RADIUS_SCALES[token as BrandRadius]
    : BRAND_RADIUS_SCALES.soft
}

/** Presets de acento de suite. El default de suite es `forest`. */
export const ACCENTS = ['forest', 'indigo', 'cobalt', 'teal', 'graphite'] as const
export type Accent = (typeof ACCENTS)[number]

export const COLOR_MODES = ['light', 'dark'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const DENSITIES = ['comoda', 'equilibrada', 'compacta'] as const
export type Density = (typeof DENSITIES)[number]

/** Default de suite: forest + light + equilibrada. */
export const DEFAULT_ACCENT: Accent = 'forest'
export const DEFAULT_COLOR_MODE: ColorMode = 'light'
export const DEFAULT_DENSITY: Density = 'equilibrada'

/**
 * `accent-deep` resuelto por preset. MUI necesita valores reales (no CSS vars)
 * para calcular contraste; el resto del sistema usa las vars.
 */
export const ACCENT_HEX: Record<Accent, { light: string; lightDeep: string; dark: string; darkDeep: string }> = {
  forest: { light: '#5AA97F', lightDeep: '#3F8A66', dark: '#5AA97F', darkDeep: '#6FD29A' },
  indigo: { light: '#6366F1', lightDeep: '#4F46E5', dark: '#818CF8', darkDeep: '#A5B4FC' },
  cobalt: { light: '#2563EB', lightDeep: '#1D4ED8', dark: '#3B82F6', darkDeep: '#60A5FA' },
  teal: { light: '#0D9488', lightDeep: '#0F766E', dark: '#2DD4BF', darkDeep: '#5EEAD4' },
  graphite: { light: '#475569', lightDeep: '#334155', dark: '#94A3B8', darkDeep: '#CBD5E1' },
}

/** Densidad → alturas reales (para MUI, que no lee CSS vars al calcular). */
export const DENSITY_METRICS: Record<Density, { controlH: number; rowH: number; padY: number; padX: number }> = {
  comoda: { controlH: 40, rowH: 52, padY: 12, padX: 14 },
  equilibrada: { controlH: 36, rowH: 44, padY: 9, padX: 12 },
  compacta: { controlH: 32, rowH: 38, padY: 6, padX: 10 },
}

