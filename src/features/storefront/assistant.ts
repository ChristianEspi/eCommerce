import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { SHOPPING_ASSISTANT_FUNCTION } from '@/shared/lib/db-schema'
import { tryGetStorefrontClient } from '@/shared/lib/supabase'
import { fetchPublicProductsByIds } from './api'
import type { PublicProduct } from './types'

/**
 * El asistente de compra, del lado del navegador.
 *
 * ## Lo que llega del servidor, y lo que NO
 *
 * Llegan un texto corto y una lista de identificadores. Nada más. Ni precios,
 * ni stock, ni fotos: el modelo no es fuente de verdad para nada que se cobre,
 * y la forma de garantizarlo no es pedirle que se porte bien, es **no darle
 * dónde escribirlo**. Con lo que llega no se puede pintar un producto; hay que
 * ir al catálogo, y eso es exactamente lo que hace `askAssistant`.
 *
 * ## Dos viajes y no uno
 *
 * El primero pregunta al asistente; el segundo resuelve los productos con
 * `fetchPublicProductsByIds`, la misma función que usa el resto de la vitrina.
 * Cuesta una consulta más y compra una garantía: lo que se enseña en las
 * tarjetas del asistente sale del mismo sitio que lo que se enseña en el
 * catálogo, así que no pueden discrepar.
 *
 * `fetchPublicProductsByIds` respeta el orden pedido, que aquí importa: el
 * asistente devuelve los productos ordenados por lo bien que encajan, y
 * reordenarlos alfabéticamente tiraría la recomendación.
 *
 * ## `mode` no es un estado de error
 *
 * `search` significa que el proveedor de IA no estaba configurado o no
 * contestó, y que lo que se devuelve son los resultados de la búsqueda del
 * catálogo. Se pinta igual de bien. La tienda no puede depender de que un
 * tercero esté disponible.
 */

export const assistantAnswerSchema = z.object({
  mode: z.enum(['ai', 'search']),
  reply: z.string().nullable().default(null),
  product_ids: z.array(z.string().uuid()).default([]),
})
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>

export interface AssistantResult extends AssistantAnswer {
  /** Los productos ya resueltos contra el catálogo, en el orden sugerido. */
  products: PublicProduct[]
}

export class AssistantError extends Error {}

export async function askAssistant(input: {
  storeSlug: string
  storeId: string | null
  message: string
}): Promise<AssistantResult> {
  const client = tryGetStorefrontClient()
  if (!client) throw new AssistantError('CONFIG_INCOMPLETA')

  const { data, error } = await client.functions.invoke<{ data: unknown }>(
    SHOPPING_ASSISTANT_FUNCTION,
    { body: { store_slug: input.storeSlug, message: input.message } },
  )
  if (error) throw new AssistantError('ASSISTANT_FAILED')

  const answer = assistantAnswerSchema.parse(data?.data ?? {})
  // Segundo viaje: del identificador al producto de verdad.
  const products = await fetchPublicProductsByIds(input.storeId, answer.product_ids)
  return { ...answer, products }
}

/**
 * Una sola pregunta en vuelo.
 *
 * Es una mutación y no una consulta a propósito: preguntar tiene coste —una
 * llamada a un proveedor externo— y no debe repetirse porque la ventana
 * recupere el foco, que es justo lo que haría una consulta en caché.
 */
export function useAssistant() {
  return useMutation({
    mutationFn: askAssistant,
    retry: false,
  })
}
