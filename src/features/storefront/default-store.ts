import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { MY_STORES_RPC } from '@/shared/lib/db-schema'
import { STOREFRONT_SLUG, isSupabaseConfigured } from '@/shared/lib/env'
import { getSupabaseClient } from '@/shared/lib/supabase'
import { fetchOnlyPublicStore } from './api'

const miTiendaSchema = z.object({ slug: z.string().min(1), name: z.string().min(1) })
export type MiTienda = z.infer<typeof miTiendaSchema>

/**
 * En qué tiendas compra la persona con sesión.
 *
 * Sale de `public.my_stores()`, que **no acepta argumentos**: el vínculo entre
 * la persona y su empresa lo resuelve la base contra `business_account_users`,
 * y de ahí a las tiendas de esa sociedad. Un navegador no puede preguntar por
 * las tiendas de otro escribiendo un identificador.
 *
 * Puede devolver más de una y por eso devuelve lista: una cuenta B2B pertenece
 * a una SOCIEDAD, y una sociedad puede tener varias tiendas. Quien elige entre
 * ellas es la persona, no una regla que adivine por ella.
 *
 * Ante una respuesta que no encaja con el contrato devuelve lista vacía en vez
 * de lanzar: quien llama es un guard, y dejar sin pantalla a alguien porque el
 * servidor añadió un campo sería peor que enseñarle la salida genérica.
 */
export async function fetchMyStores(): Promise<MiTienda[]> {
  const { data, error } = await getSupabaseClient().rpc(MY_STORES_RPC, {})
  if (error) throw error
  const parsed = miTiendaSchema.array().safeParse(data ?? [])
  return parsed.success ? parsed.data : []
}

export function useMyStores(enabled = true) {
  return useQuery({
    queryKey: ['storefront', 'my-stores'],
    queryFn: fetchMyStores,
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

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
