import { internalPathOr, isInternalPath } from '@/domain/href'

/**
 * A dónde vuelve alguien después de entrar, registrarse o cambiar la clave (N02).
 *
 * Dos fuentes, y ninguna es de confianza por sí sola:
 *
 *  · `location.state.from`: la pone la propia app al mandar al login. No
 *    sobrevive a un F5 ni a abrir el enlace de un correo.
 *  · `?from=` / `?returnTo=` en la URL: sí sobrevive, y precisamente por eso lo
 *    puede escribir cualquiera en un enlace.
 *
 * Las dos pasan por `isInternalPath` (el mismo guard del redirector abierto de
 * P16: nada de `//otro.com`, `/\otro.com`, esquemas ni caracteres de control).
 * Lo que no pasa se ignora y se usa el suelo de siempre.
 */
export function returnPathFrom(state: unknown, search: string, param = 'from'): string | null {
  const fromState = state && typeof state === 'object' ? (state as { from?: unknown }).from : undefined
  if (isInternalPath(fromState)) return fromState
  const fromQuery = new URLSearchParams(search).get(param)
  return isInternalPath(fromQuery) ? fromQuery : null
}

/** El destino con suelo: `/app` para el backoffice, que es el comportamiento de siempre. */
export function returnPathOr(state: unknown, search: string, fallback: string, param = 'from'): string {
  return internalPathOr(returnPathFrom(state, search, param), fallback)
}

const STOREFRONT_PATH = /^\/s\/([a-z0-9][a-z0-9-]{0,62})(?:[/?#]|$)/

/** El slug de la tienda si el destino es una ruta de vitrina (`/s/:slug/...`), si no `null`. */
export function storefrontSlugOf(path: string | null): string | null {
  if (!isInternalPath(path)) return null
  return STOREFRONT_PATH.exec(path)?.[1] ?? null
}
