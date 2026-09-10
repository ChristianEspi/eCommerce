import { CATALOG_COPY_FUNCTION } from '@/shared/lib/db-schema'
import { catalogClient } from './client'
import { catalogErrorFromInvoke } from './errors'

export { CATALOG_COPY_FUNCTION }

/**
 * Por qué no hay borrador. Son seis y no una porque se resuelven de forma
 * distinta: una se arregla comprando el addon, otra esperando al mes que viene,
 * y otra editando el nombre del producto. Un «no se pudo» genérico deja a quien
 * lo lee sin saber cuál de las tres le toca.
 */
export type MotivoSinBorrador =
  | 'sin_proveedor'
  | 'sin_contratar'
  | 'sin_cuota'
  | 'proveedor'
  | 'vacia'
  | 'clinica'

export interface BorradorDeFicha {
  readonly draft: string | null
  readonly motivo: MotivoSinBorrador | null
}

/**
 * Pide el borrador de la ficha de un producto.
 *
 * No lanza cuando no hay borrador: la ausencia es una respuesta válida y viene
 * con su motivo. Solo lanza si la llamada en sí falló —sin sesión, producto de
 * otra sociedad, red caída—, que son los casos en los que no hay nada que
 * contarle al usuario salvo que algo se rompió.
 */
export async function pedirBorradorDeFicha(productId: string): Promise<BorradorDeFicha> {
  const supabase = catalogClient()
  const { data, error } = await supabase.functions.invoke<{ data: BorradorDeFicha }>(
    CATALOG_COPY_FUNCTION,
    { body: { product_id: productId } },
  )

  if (error) throw await catalogErrorFromInvoke(error)
  return {
    draft: data?.data?.draft ?? null,
    motivo: data?.data?.motivo ?? 'proveedor',
  }
}
