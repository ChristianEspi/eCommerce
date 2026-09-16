import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSessionContext } from '@/features/auth/session-context'
import {
  fetchServerFavorites,
  mergeLocalFavorites,
  readLocalFavorites,
  toggleLocalFavorite,
  toggleServerFavorite,
} from './favorites'

/**
 * Los favoritos de la tienda abierta, vengan de donde vengan.
 *
 * El componente que pinta un corazón no debería saber si hay sesión: pregunta
 * «¿está guardado?» y dice «alterna». Aquí se decide el almacén —servidor con
 * sesión, navegador sin ella— y se resuelve la subida de lo local al entrar.
 *
 * ## Optimista, y con vuelta atrás
 *
 * El corazón se pinta ANTES de que el servidor conteste. Un corazón que tarda
 * 300 ms en encenderse se pulsa dos veces, y dos pulsaciones sobre un
 * interruptor son ninguna. Si la llamada falla, se revierte: es mejor un
 * corazón que se apaga solo que una lista que dice guardar cosas que no guardó.
 *
 * ## Un solo conjunto para toda la tienda
 *
 * Los favoritos NO viven en el componente. Vivían, y se veía: al pulsar el
 * corazón de una tarjeta, el botón de la cabecera —que es otro componente con
 * su propio `useState`— seguía diciendo que no había nada guardado hasta
 * recargar la página. Dos copias del mismo dato es un dato que se contradice.
 *
 * Ahora hay UN conjunto por tienda en un almacén de módulo, y cada componente
 * se suscribe con `useSyncExternalStore`. Sigue sin ser React Query a
 * propósito: no es dato que caduque ni que se comparta entre pantallas de
 * servidor, es un conjunto pequeño que se lee una vez por tienda y se muta con
 * una pulsación.
 */

interface Estado {
  readonly ids: ReadonlySet<string>
  readonly ready: boolean
}

const VACIO: Estado = { ids: new Set(), ready: false }

/** Un estado por tienda, y una lista de quién quiere enterarse. */
const estados = new Map<string, Estado>()
const oyentes = new Map<string, Set<() => void>>()
/** Qué combinación (tienda + sesión) ya se cargó, para no pedirla por cada tarjeta. */
const cargado = new Map<string, string>()

function leer(storeId: string | null): Estado {
  if (!storeId) return VACIO
  return estados.get(storeId) ?? VACIO
}

function escribir(storeId: string, estado: Estado): void {
  estados.set(storeId, estado)
  for (const avisar of oyentes.get(storeId) ?? []) avisar()
}

/**
 * Vacía el almacén.
 *
 * Existe por los TESTS y se dice aquí para que nadie lo use en la app: un
 * almacén de módulo vive lo que vive el módulo, así que dos casos de prueba
 * seguidos comparten los favoritos del primero. En la aplicación no hace falta
 * —una pestaña, una tienda, una sesión— y llamarlo sería tirar un dato bueno.
 */
export function resetFavoritesCache(): void {
  estados.clear()
  cargado.clear()
  oyentes.clear()
}

function suscribir(storeId: string | null, avisar: () => void): () => void {
  if (!storeId) return () => {}
  const lista = oyentes.get(storeId) ?? new Set<() => void>()
  lista.add(avisar)
  oyentes.set(storeId, lista)
  return () => {
    lista.delete(avisar)
  }
}
export function useFavorites(storeId: string | null) {
  const { status } = useSessionContext()
  const authenticated = status === 'authenticated'

  const estado = useSyncExternalStore(
    useCallback((avisar) => suscribir(storeId, avisar), [storeId]),
    useCallback(() => leer(storeId), [storeId]),
    useCallback(() => leer(storeId), [storeId]),
  )
  const { ids, ready } = estado

  useEffect(() => {
    if (!storeId) return

    // Una sola carga por tienda y estado de sesión, la pida quien la pida: sin
    // esto, una rejilla de veinticuatro tarjetas dispararía veinticuatro
    // consultas idénticas.
    const clave = `${storeId}|${authenticated}`
    if (cargado.get(storeId) === clave) return
    cargado.set(storeId, clave)

    escribir(storeId, { ids: leer(storeId).ids, ready: false })

    const run = authenticated
      ? // Al entrar, lo del navegador sube y el rincon local queda vacio.
        mergeLocalFavorites(storeId)
      : Promise.resolve(readLocalFavorites(storeId))

    void run
      .then((list) => {
        // Si mientras tanto cambió la sesión, manda la carga nueva.
        if (cargado.get(storeId) !== clave) return
        escribir(storeId, { ids: new Set(list), ready: true })
      })
      .catch(() => {
        if (cargado.get(storeId) !== clave) return
        escribir(storeId, { ids: new Set(), ready: true })
      })
  }, [storeId, authenticated])

  const toggle = useCallback(
    async (productId: string) => {
      if (!storeId) return

      const saved = ids.has(productId)
      const next = new Set(ids)
      if (saved) next.delete(productId)
      else next.add(productId)
      escribir(storeId, { ids: next, ready: true })

      if (!authenticated) {
        toggleLocalFavorite(storeId, productId)
        return
      }

      try {
        await toggleServerFavorite(productId, storeId)
      } catch {
        // Vuelta atras: el corazon no puede decir que guardo algo que el
        // servidor rechazo.
        const rollback = await fetchServerFavorites(storeId)
        escribir(storeId, { ids: new Set(rollback), ready: true })
      }
    },
    [authenticated, ids, storeId],
  )

  return useMemo(
    () => ({
      /** `true` si el producto está guardado. */
      isFavorite: (productId: string) => ids.has(productId),
      /** Alterna y persiste donde corresponda. */
      toggle,
      /** Los ids guardados, para pintar una lista. */
      ids,
      /** `false` mientras se cargan: evita el parpadeo del corazón vacío. */
      ready,
      /** Con sesión viajan con la persona; sin ella, solo en este navegador. */
      persisted: authenticated,
    }),
    [authenticated, ids, ready, toggle],
  )
}
