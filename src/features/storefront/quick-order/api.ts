import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { codeFromDbError } from '@/shared/lib/appError'
import { RESOLVE_ORDER_LINES_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import type { ResolvedServerLine, ValidLine } from './lines'

/**
 * La única llamada del pedido rápido: traducir SKU a artículo.
 *
 * ## El cliente CON sesión
 *
 * `resolve_order_lines_for_slug` no la ejecuta `anon`: el SKU no es público y
 * una puerta anónima sería un enumerador del catálogo interno. Además la cuenta
 * B2B —de la que sale el surtido— la resuelve la base a partir de
 * `ebim.user_id()`, así que con el cliente anónimo de la vitrina la respuesta
 * sería la de nadie.
 *
 * ## Lo que viaja
 *
 * Solo `sku` y `quantity`. Ni la tienda (sale del slug), ni la cuenta, ni el
 * usuario, ni un precio: la base rechaza cualquier otra clave con
 * `CAMPO_NO_PERMITIDO`, y este módulo ni siquiera las tiene para mandarlas.
 */

export class QuickOrderError extends AppError {
  constructor(code: string) {
    super({
      boundary: 'checkout',
      code,
      // El techo de sondeo no está en la tabla general de códigos: se clasifica
      // aquí para que la pantalla lo cuente como «espera un poco» y no como un
      // fallo sin explicación.
      ...(code === 'LIMITE_DE_TASA' ? { kind: 'rate_limited' as const } : {}),
      message: 'No se pudo validar el pedido rápido',
    })
    this.name = 'QuickOrderError'
  }
}

const okLineSchema = z.object({
  row: z.number().int().min(1),
  status: z.literal('ok'),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().default(null),
  name: z.string().min(1),
  variant_name: z.string().nullable().default(null),
  quantity: z.number().int().min(1),
})

const rejectedLineSchema = z.object({
  row: z.number().int().min(1),
  status: z.literal('rejected'),
  reason: z.string().min(1),
})

export const resolutionSchema = z.object({
  lines: z.array(z.discriminatedUnion('status', [okLineSchema, rejectedLineSchema])),
})

export async function resolveOrderLines(input: {
  storeSlug: string
  lines: readonly ValidLine[]
}): Promise<ResolvedServerLine[]> {
  if (input.lines.length === 0) return []

  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new QuickOrderError('CONFIG_INCOMPLETA')

  const { data, error } = await supabase.rpc(RESOLVE_ORDER_LINES_RPC, {
    p_store_slug: input.storeSlug,
    p_lines: input.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
  })
  if (error) throw new QuickOrderError(codeFromDbError(error))

  const parsed = resolutionSchema.safeParse(data)
  if (!parsed.success) throw new QuickOrderError('RESPUESTA_INVALIDA')
  return parsed.data.lines
}
