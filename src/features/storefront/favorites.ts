import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Favoritos del comprador: los del servidor y los del navegador.
 *
 * ## Dos almacenes, y no es un capricho
 *
 * Con sesión, el favorito vive en `product_favorites` y viaja con la persona:
 * lo guarda en el móvil y lo encuentra en el escritorio. Sin sesión no hay a
 * quién atribuirlo, y montar una tabla con un token de portador para cada
 * visitante que pulsa un corazón por curiosidad sería una tabla que crece por
 * mirar. Así que el anónimo guarda en `localStorage`, que además es lo que
 * espera: en ese navegador y en ninguno más.
 *
 * Al iniciar sesión, lo del navegador SUBE (`mergeLocalFavorites`) y se vacía
 * el rincón local. Sin eso, el comprador que guardó cinco cosas antes de entrar
 * las pierde justo cuando por fin podían ser suyas de verdad, que es el momento
 * exacto en el que menos se entiende.
 *
 * ## Con qué cliente se llama, y por qué NO es el de la vitrina
 *
 * El catálogo se lee con el cliente ANÓNIMO —las policies públicas son `to
 * anon`— pero un favorito es de una PERSONA: `toggle_product_favorite` deriva
 * quién es de `ebim.user_id()`, o sea del `sub` del JWT. El cliente de la
 * vitrina se crea con `persistSession: false` y no lleva sesión NUNCA, así que
 * llamar desde él dejaba a la función sin usuario y levantando
 * `SESION_REQUERIDA` — el corazón se encendía, la llamada fallaba y la vuelta
 * atrás lo apagaba. Desde fuera: «no hace nada».
 *
 * Es la misma distinción que ya hacía el checkout al resolver la cuenta B2B:
 * datos públicos con el cliente público, identidad con el que la lleva.
 *
 * ## Por qué RPC y no una tabla abierta
 *
 * El comprador no es miembro del tenant: su JWT no trae `org_id` ni
 * `companies[]`. Escribir `product_favorites` desde el navegador exigiría que
 * el cliente declarase el tenant, que es justo lo que la regla de suite
 * prohíbe. `toggle_product_favorite` es `SECURITY DEFINER` y lo deriva del
 * producto (ver la migración `20260831120000_product_favorites.sql`).
 */

const STORAGE_PREFIX = 'ebim.favorites.'

export const TOGGLE_FAVORITE_RPC = 'toggle_product_favorite'
export const MY_FAVORITES_RPC = 'my_product_favorites'

/**
 * El cliente CON sesión. Estas dos funciones solo se llaman con sesión abierta
 * (`useFavorites` guarda en `localStorage` mientras no la hay), así que un
 * `null` aquí es «no hay backend configurado», no «no hay usuario».
 */
function client() {
  return tryGetSupabaseClient()
}

/** Los favoritos de ESTA tienda en este navegador. Sin sesión, son todos. */
export function readLocalFavorites(storeId: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + storeId)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // Modo privado, cuota llena o JSON corrupto: el catálogo no se queda sin
    // corazones por eso, simplemente no hay nada guardado.
    return []
  }
}

export function writeLocalFavorites(storeId: string, ids: string[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + storeId, JSON.stringify([...new Set(ids)]))
  } catch {
    /* la persistencia local es una mejora, nunca un requisito */
  }
}

export function toggleLocalFavorite(storeId: string, productId: string): boolean {
  const current = readLocalFavorites(storeId)
  const saved = current.includes(productId)
  writeLocalFavorites(storeId, saved ? current.filter((id) => id !== productId) : [...current, productId])
  return !saved
}

/** Los del servidor. Devuelve `null` si no hay cliente configurado. */
export async function fetchServerFavorites(storeId: string): Promise<string[]> {
  const supabase = client()
  if (!supabase) return []

  const { data, error } = await supabase.rpc(MY_FAVORITES_RPC, { p_store_id: storeId })
  // Un fallo aquí no puede tumbar el catálogo: se pinta sin corazones marcados,
  // que es exactamente lo que ve quien no ha guardado nada todavía.
  if (error) return []
  return (data ?? []).map((row: { product_id: string }) => row.product_id)
}

/** Interruptor del servidor. Devuelve el estado NUEVO. */
export async function toggleServerFavorite(productId: string, storeId: string): Promise<boolean> {
  const supabase = client()
  if (!supabase) return false

  // ADR 018: el mismo producto se vende en varias tiendas; el favorito es de
  // ESTA tienda.
  const { data, error } = await supabase.rpc(TOGGLE_FAVORITE_RPC, {
    p_product_id: productId,
    p_store_id: storeId,
  })
  if (error) throw error
  return Boolean(data)
}

/**
 * Sube lo guardado sin sesión y vacía el rincón local.
 *
 * Se llama al detectar sesión. Los toggles van de uno en uno porque la función
 * es un interruptor: mandar los cinco en paralelo podría cruzarse con lo que ya
 * estuviera guardado en el servidor y APAGAR un favorito que ya existía.
 */
export async function mergeLocalFavorites(storeId: string): Promise<string[]> {
  const local = readLocalFavorites(storeId)
  if (local.length === 0) return fetchServerFavorites(storeId)

  const remote = new Set(await fetchServerFavorites(storeId))
  for (const productId of local) {
    if (remote.has(productId)) continue
    try {
      await toggleServerFavorite(productId, storeId)
      remote.add(productId)
    } catch {
      // Un producto que ya no está publicado no se puede guardar. No es un
      // error de la sesión: se queda fuera y el resto sube igual.
    }
  }
  writeLocalFavorites(storeId, [])
  return [...remote]
}
