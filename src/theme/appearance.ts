import {
  ACCENTS,
  COLOR_MODES,
  DEFAULT_ACCENT,
  DEFAULT_COLOR_MODE,
  DEFAULT_DENSITY,
  DENSITIES,
  type Accent,
  type ColorMode,
  type Density,
} from './tokens'

/** Keys homologadas de suite: `<app>-color-mode` / `<app>-accent` / `<app>-density`. */
export const STORAGE_KEYS = {
  mode: 'ecommerce-color-mode',
  accent: 'ecommerce-accent',
  density: 'ecommerce-density',
} as const

export interface Appearance {
  mode: ColorMode
  accent: Accent
  density: Density
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: DEFAULT_COLOR_MODE,
  accent: DEFAULT_ACCENT,
  density: DEFAULT_DENSITY,
}

function readKey<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null
  } catch {
    return null
  }
}

/**
 * Lee la apariencia del dispositivo (anti-flash). El servidor la hidrata al login.
 *
 * Sin elección guardada, CLARO (default de suite, CLAUDE.md), no el tema del
 * sistema operativo (2026-11-20, a pedido del operador): quien tiene Windows en
 * oscuro veía la tienda oscura sin haberlo pedido. El oscuro se elige —en
 * «Mi cuenta» de la tienda o en Apariencia del backoffice— y entonces se guarda.
 */
export function readStoredAppearance(): Appearance {
  return {
    mode: readKey(STORAGE_KEYS.mode, COLOR_MODES) ?? DEFAULT_COLOR_MODE,
    accent: readKey(STORAGE_KEYS.accent, ACCENTS) ?? DEFAULT_ACCENT,
    density: readKey(STORAGE_KEYS.density, DENSITIES) ?? DEFAULT_DENSITY,
  }
}

/**
 * ¿El visitante ya eligió densidad en este dispositivo?
 *
 * Lo usa la vitrina (P11-SaaS) para decidir si la densidad que el tenant fijó
 * en su branding es aplicable: una preferencia guardada gana siempre, porque es
 * la del usuario y a menudo es de accesibilidad. La convención de suite —el
 * default no se guarda— es justo lo que hace que esta pregunta se pueda
 * responder: hay clave solo si alguien la eligió.
 */
export function hasStoredDensity(): boolean {
  return readKey(STORAGE_KEYS.density, DENSITIES) !== null
}

/** Persiste omitiendo los defaults (convención de suite: el default no se guarda). */
export function persistAppearance(next: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEYS.mode, next.mode)
    if (next.accent === DEFAULT_ACCENT) localStorage.removeItem(STORAGE_KEYS.accent)
    else localStorage.setItem(STORAGE_KEYS.accent, next.accent)
    if (next.density === DEFAULT_DENSITY) localStorage.removeItem(STORAGE_KEYS.density)
    else localStorage.setItem(STORAGE_KEYS.density, next.density)
  } catch {
    /* almacenamiento no disponible: la apariencia sigue viva en memoria */
  }
}

/** Refleja la apariencia en el `<html>` para que las CSS vars se resuelvan. */
/**
 * El color del tenant, TAMBIEN en las variables CSS.
 *
 * `accent_color` llegaba solo al tema de MUI (`primary.main`), y la mitad de la
 * vitrina no se pinta con MUI sino con `var(--accent)`. El resultado en una
 * tienda con acento propio era una pantalla partida en dos: los botones de MUI
 * del color del comercio y las pildoras, los estados y los enlaces del verde de
 * suite. Se veia exactamente como lo que era, un fallo.
 *
 * `--accent-deep` no es el mismo color: es el que escribe TEXTO, y el contrato
 * lo dice —«`accent` para rellenos; `accent-deep` para texto, nunca `accent`
 * puro»—. Se deriva oscureciendo en claro y aclarando en oscuro, porque el hex
 * del comercio puede ser un amarillo palido y sobre blanco no se leeria.
 *
 * Se aplica en el elemento raiz, igual que `data-theme` y `data-density`, y se
 * RETIRA cuando no hay tenant: al salir de la vitrina al backoffice, el acento
 * de suite tiene que volver sin recargar.
 */
/**
 * Todo lo que el color del tenant PISA. Poner y quitar leen la misma lista: el
 * dia que se anada una variable, olvidarla en el borrado dejaria el rojo de una
 * tienda pintando el backoffice al salir de la vitrina.
 */
const TENANT_ACCENT_VARS = [
  '--accent',
  '--accent-deep',
  '--accent-soft',
  '--accent2',
  '--hero-grad',
  '--badge-grad',
  '--sidebar',
] as const

/**
 * Las variables del color del tenant, como DATO (Resumen v2).
 *
 * La misma cuenta que pinta la vitrina, separada de dónde se aplica: el
 * `<html>` en la tienda, o una ZONA concreta —la vista previa del taller de
 * diseño— como estilo en línea, sin repintar el backoffice de alrededor.
 */
export function tenantAccentVars(hex: string, mode: ColorMode): Record<(typeof TENANT_ACCENT_VARS)[number], string> {
  const deep =
    mode === 'dark'
      ? `color-mix(in srgb, ${hex} 72%, #FFFFFF)`
      : `color-mix(in srgb, ${hex} 78%, #071A16)`
  return {
    '--accent': hex,
    '--accent-deep': deep,
    '--accent-soft': `color-mix(in srgb, ${hex} 14%, var(--card))`,
    // Segundo acento: el mas oscuro de la familia, para textos sobre relleno
    // tenue y para el extremo de los degradados.
    '--accent2': `color-mix(in srgb, ${hex} 60%, #071A16)`,
    // El HERO y las pastillas de campana tambien son del tenant.
    //
    // Sin estas dos, una tienda que elegia rojo se quedaba con el degradado verde
    // de la suite ocupando media portada, y con los chips de descuento en verde
    // sobre botones rojos: el color cambiaba en los botones y en nada mas. Es
    // texto claro sobre fondo oscuro en los dos casos, asi que el degradado
    // arranca del acento muy oscurecido y termina en el acento.
    '--hero-grad':
      `linear-gradient(135deg, color-mix(in srgb, ${hex} 30%, #06120f) 0%, ` +
      `color-mix(in srgb, ${hex} 70%, #000) 55%, ${hex} 100%)`,
    '--badge-grad': `linear-gradient(135deg, ${hex} 0%, color-mix(in srgb, ${hex} 68%, #000) 100%)`,
    // La barra lateral del backoffice (2026-11-13). Texto blanco encima, así
    // que va del acento MUY oscurecido al acento oscurecido: con una marca
    // clara (amarillo, celeste) el blanco sigue leyéndose.
    '--sidebar':
      mode === 'dark'
        ? `linear-gradient(180deg, color-mix(in srgb, ${hex} 30%, #050807) 0%, ` +
          `color-mix(in srgb, ${hex} 45%, #050807) 100%)`
        : `linear-gradient(180deg, color-mix(in srgb, ${hex} 45%, #06120f) 0%, ` +
          `color-mix(in srgb, ${hex} 70%, #06120f) 100%)`,
  }
}

export function applyTenantAccentToDom(
  hex: string | null,
  mode: ColorMode,
  root: HTMLElement = document.documentElement,
): void {
  if (!hex) {
    for (const name of TENANT_ACCENT_VARS) root.style.removeProperty(name)
    return
  }
  for (const [name, value] of Object.entries(tenantAccentVars(hex, mode))) root.style.setProperty(name, value)
}

export function applyAppearanceToDom(next: Appearance, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', next.mode)
  if (next.accent === DEFAULT_ACCENT) root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', next.accent)
  if (next.density === DEFAULT_DENSITY) root.removeAttribute('data-density')
  else root.setAttribute('data-density', next.density)
}
