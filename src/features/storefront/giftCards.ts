import { z } from 'zod'
import { GIFT_CARD_BALANCE_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { storefrontClient } from './api'

/**
 * Tarjeta de regalo en la caja (2026-11-12).
 *
 * El checkout del servidor aceptaba `gift_card_codes` desde P10, pero la vitrina
 * no tenía dónde escribir el código: ninguna tarjeta emitida se podía gastar.
 *
 * Aquí solo se CONSULTA el saldo para enseñarlo antes de pagar. Cuánto se usa
 * lo decide el checkout al cobrar (como mucho el total) y la tarjeta es un
 * medio de pago, no un descuento: no toca subtotal ni impuesto. La consulta
 * es por tienda y por código completo, y el servidor no distingue «no existe»
 * de «es de otra tienda».
 */
export const giftCardBalanceSchema = z.object({
  found: z.boolean(),
  last4: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  balance: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  expires_at: z.string().nullable().default(null),
})
export type GiftCardBalance = z.infer<typeof giftCardBalanceSchema>

export async function fetchGiftCardBalance(storeSlug: string, code: string): Promise<GiftCardBalance> {
  const { data, error } = await storefrontClient().rpc(GIFT_CARD_BALANCE_PUBLIC_RPC, {
    p_store_slug: storeSlug,
    p_code: code.trim(),
  })
  if (error) throw new Error('GIFT_CARD_UNAVAILABLE')
  return giftCardBalanceSchema.parse(data)
}

/** Si la tarjeta se puede usar ahora mismo, y si no, por qué (clave i18n). */
export function giftCardProblem(
  card: GiftCardBalance,
): 'store.checkout.giftCard.notFound' | 'store.checkout.giftCard.empty' | 'store.checkout.giftCard.inactive' | null {
  if (!card.found) return 'store.checkout.giftCard.notFound'
  if (card.status !== 'active') {
    return card.status === 'depleted' ? 'store.checkout.giftCard.empty' : 'store.checkout.giftCard.inactive'
  }
  if (Number(card.balance ?? '0') <= 0) return 'store.checkout.giftCard.empty'
  return null
}
