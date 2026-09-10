import { useQuery } from '@tanstack/react-query'
import { STOREFRONT_SLUG, isSupabaseConfigured } from '@/shared/lib/env'
import { fetchOnlyPublicStore } from './api'

/**
 * A qué tienda lleva este despliegue, cuando la URL no lo dice.
 *
 * En un SaaS multitenant cada tienda vive en su slug y la raíz no tiene por qué
 * conocer ninguna. El destino sale, EN ESTE ORDEN:
 *
 *  1. `VITE_STOREFRONT_SLUG` — el despliegue lo declara y manda sobre todo.
 *  2. La base, cuando el proyecto tiene EXACTAMENTE una tienda activa, que es
 *     el caso de una demo o de un cliente único.
 *  3. `null` — con varias tiendas no se elige ninguna, y sobre todo no se
 *     listan: la lista de tiendas activas de un SaaS es la lista de clientes.
 *
 * ## Por qué es un módulo y no dos copias
 *
 * La portada ya resolvía esto. Al necesitarlo también el guard del backoffice
 * —para no dejar a un comprador en un cartel sin salida— había dos sitios con
 * la misma regla. Dos copias de una regla no se separan el día que se escriben,
 * se separan el día que alguien cambia una de las dos.
 */
export function useDefaultStoreSlug(enabled = true): {
  slug: string | null
  name: string | null
  isLoading: boolean
} {
  const declarado = STOREFRONT_SLUG !== ''

  const query = useQuery({
    queryKey: ['storefront', 'only-store'],
    queryFn: fetchOnlyPublicStore,
    // Sin backend configurado no hay a quién preguntar, y con slug declarado
    // tampoco hace falta: el declarado manda.
    enabled: enabled && isSupabaseConfigured && !declarado,
    staleTime: 5 * 60 * 1000,
  })

  return {
    slug: STOREFRONT_SLUG || query.data?.slug || null,
    // El nombre solo lo sabe la base. Con slug declarado no hay a quién
    // preguntarle cómo se llama, y ponerle el slug de nombre sería inventarlo.
    name: declarado ? null : (query.data?.name ?? null),
    isLoading: query.isLoading && query.fetchStatus !== 'idle',
  }
}
