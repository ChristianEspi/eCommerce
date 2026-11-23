import { z } from 'zod'
import { SHOPPING_CHAT_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { intakeLineSchema } from '../quick-order/intake'

/**
 * Asistente de compra conversacional, del lado de la vitrina (2026-11-22).
 *
 * El navegador manda la conversación (los últimos turnos, solo texto) y recibe
 * la herramienta que se usó, sus DATOS —salidos de la base con la sesión del
 * comprador— y una frase. La vitrina pinta las cifras desde los datos; la frase
 * nunca trae precios ni saldos.
 */

export const CHAT_MAX_TURNS = 8
export const CHAT_MAX_TEXT = 400

const orderSchema = z.object({
  order_id: z.string(),
  order_number: z.string(),
  status: z.string(),
  payment_status: z.string(),
  fulfillment_status: z.string().nullable(),
  placed_at: z.string(),
  total: z.string(),
  currency: z.string(),
})
export type ChatOrder = z.infer<typeof orderSchema>

const creditSchema = z.object({
  cuenta: z.string(),
  limite: z.string().nullable(),
  disponible: z.string().nullable(),
  saldo: z.string(),
  vencido: z.string(),
  moneda: z.string(),
  proximo: z
    .object({ order_number: z.string(), due_at: z.string().nullable(), total: z.string(), days_overdue: z.number() })
    .nullable(),
})
export type ChatCredit = z.infer<typeof creditSchema>

/** Una presentación comparada: precio y precio por unidad calculados en el servidor. */
const compareRowSchema = z.object({
  variant_id: z.string(),
  nombre: z.string(),
  en_stock: z.boolean(),
  precio: z.string().nullable(),
  moneda: z.string(),
  contenido: z.object({ cantidad: z.number().positive(), unidad: z.enum(['un', 'ml', 'g']) }).nullable(),
  por_unidad: z.string().nullable(),
  mejor: z.boolean(),
})
export type ChatCompareRow = z.infer<typeof compareRowSchema>

export const chatDataSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('productos'), product_ids: z.array(z.string().uuid()), consulta: z.string() }),
  z.object({ tipo: z.literal('pedidos'), pedidos: z.array(orderSchema) }),
  z.object({ tipo: z.literal('pedido'), pedido: orderSchema.nullable() }),
  z.object({ tipo: z.literal('credito'), credito: creditSchema.nullable() }),
  z.object({
    tipo: z.literal('carrito'),
    origen: z.string().nullable(),
    lineas: z.array(intakeLineSchema),
    avisos: z.array(z.string()),
  }),
  z.object({
    tipo: z.literal('sustitutos'),
    producto: z.string(),
    principio_activo: z.string().nullable(),
    product_ids: z.array(z.string().uuid()),
  }),
  z.object({
    tipo: z.literal('reposicion'),
    items: z.array(
      z.object({
        sku: z.string(),
        nombre: z.string(),
        cantidad: z.number().int(),
        compras: z.number().int(),
        cada_dias: z.number().int(),
        dias_restantes: z.number().int(),
      }),
    ),
    lineas: z.array(intakeLineSchema),
  }),
  z.object({
    tipo: z.literal('ficha'),
    product_id: z.string().uuid().nullable(),
    comparacion: z.array(compareRowSchema),
  }),
  z.object({ tipo: z.literal('ninguno') }),
])
export type ChatData = z.infer<typeof chatDataSchema>

export const chatReplySchema = z.object({
  herramienta: z.string(),
  datos: chatDataSchema,
  respuesta: z.string().nullable(),
  product_ids: z.array(z.string()).default([]),
  motivo: z.string().nullable().default(null),
})
export type ChatReply = z.infer<typeof chatReplySchema>

export interface ChatTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export class ChatError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'ChatError'
    this.code = code
  }
}

/** Los últimos turnos que caben, terminando en el del comprador. */
export function turnsToSend(turns: readonly ChatTurn[]): ChatTurn[] {
  return turns
    .filter((t) => t.text.trim().length > 0)
    .slice(-CHAT_MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, CHAT_MAX_TEXT) }))
}

export async function sendChat(input: {
  storeSlug: string
  locale: 'es' | 'en'
  turns: readonly ChatTurn[]
}): Promise<ChatReply> {
  const client = tryGetSupabaseClient()
  if (!client) throw new ChatError('CONFIG_INCOMPLETA')
  const { data, error } = await client.functions.invoke<{ data: unknown }>(SHOPPING_CHAT_FUNCTION, {
    body: { store_slug: input.storeSlug, locale: input.locale, messages: turnsToSend(input.turns) },
  })
  if (error) throw new ChatError(await codeFromInvokeError(error))
  const parsed = chatReplySchema.safeParse(data?.data)
  if (!parsed.success) throw new ChatError('RESPUESTA_INVALIDA')
  return parsed.data
}
