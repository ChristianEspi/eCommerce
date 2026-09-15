import { es as esCore } from './messages.es'
import type { esBackoffice } from './messages.es.backoffice'

/**
 * Registro de diccionarios de la suite (P15-SaaS).
 *
 * Hasta P14 este archivo ERA el diccionario: un único literal con `es` y `en`
 * dentro. Funcionaba, pero tenía un coste medido: el chunk de mensajes pesaba
 * **61,76 kB gzip** de los 283,38 kB del bundle de entrada, y la mitad de esos
 * bytes son un idioma que el visitante no va a leer nunca. Un objeto literal no
 * se puede tree-shakear por mitades, así que la única forma de no enviarlo era
 * partirlo en dos módulos.
 *
 * La regla que sale de ahí, y que conviene no romper:
 *
 *  1. **ES es estático.** Es el idioma por defecto de la suite y el suelo de
 *     `translate`: una clave que falte en otro idioma cae al español, y para
 *     eso el español tiene que estar ya cargado. Sin él, un fallo de red
 *     dejaría la pantalla con claves crudas.
 *  2. **Los demás idiomas se piden.** `loadDictionary` los trae con `import()`
 *     dinámico y los memoriza. Mientras llegan, `dictionary()` devuelve ES: se
 *     ve un primer pintado en español, no un esqueleto ni una clave.
 *  3. **`MESSAGES` ya no vive aquí.** Está en `messages.all.ts`, que importa los
 *     dos de forma estática, y solo lo usan los tests de paridad. Si el código
 *     de producción lo importara volveríamos al punto de partida sin enterarnos.
 */

export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export type MessageKey = keyof typeof esCore | keyof typeof esBackoffice
export type Dictionary = Readonly<Record<MessageKey, string>>

/** El idioma que viaja SIEMPRE en el bundle y del que cuelga el fallback. */
export const DEFAULT_LOCALE: Locale = 'es'

/**
 * El español que está en memoria. Nace con la parte de la VITRINA y gana la del
 * backoffice cuando `loadBackofficeMessages` la trae (cierre · certificación).
 *
 * Es UN objeto y se completa en el sitio a propósito: `translate`, el proveedor
 * y su fallback leen `es`, y así ninguno necesita saber que llegó en dos partes.
 * El tipo dice el diccionario entero porque, cuando una pantalla del backoffice
 * pinta, su parte ya está: la ruta la espera antes de renderizar.
 */
export const es = { ...esCore } as Record<string, string> as Dictionary

let backoffice: Promise<void> | null = null

/** Añade la parte del backoffice. Idempotente y síncrona para quien ya la tiene. */
export function registerBackofficeMessages(messages: Readonly<Record<string, string>>): void {
  Object.assign(es as Record<string, string>, messages)
}

/**
 * Trae la parte del backoffice (`messages.es.backoffice.ts`) y la mezcla en `es`.
 * La piden las rutas `/app` y `/onboarding` ANTES de pintar. Llamarla dos veces
 * no pide dos veces.
 */
export function loadBackofficeMessages(): Promise<void> {
  backoffice ??= import('./messages.es.backoffice').then((module) =>
    registerBackofficeMessages(module.esBackoffice),
  )
  return backoffice
}

/**
 * Cargadores de los idiomas que NO son el de por defecto. Añadir uno es añadir
 * una fila aquí y su módulo; el tipo obliga a que estén todos.
 */
const LOADERS: Record<Exclude<Locale, typeof DEFAULT_LOCALE>, () => Promise<Dictionary>> = {
  en: () => import('./messages.en').then((module) => module.en),
}

const loaded: Partial<Record<Locale, Dictionary>> = { es }

/** El diccionario que YA está en memoria, o `undefined` si todavía no llegó. */
export function loadedDictionary(locale: Locale): Dictionary | undefined {
  return loaded[locale]
}

/** El diccionario a usar ahora mismo: el pedido si está, el español si no. */
export function dictionary(locale: Locale): Dictionary {
  return loaded[locale] ?? es
}

/** Trae un diccionario y lo memoriza. Llamarla dos veces no pide dos veces. */
export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const cached = loaded[locale]
  if (cached) return cached

  // El tipo de `LOADERS` sigue obligando a que estén TODOS los idiomas que no
  // son el de por defecto; el ensanchado es solo para poder buscar por clave.
  const loader = (LOADERS as Record<string, (() => Promise<Dictionary>) | undefined>)[locale]
  // Un idioma sin cargador es un fallo de programación, no del usuario: se cae
  // al español en vez de dejar la interfaz a medias.
  if (!loader) return es

  const next = await loader()
  loaded[locale] = next
  return next
}
