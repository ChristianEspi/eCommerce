import { codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'
import { ACCEPT_QUOTE_RPC, MY_QUOTES_RPC, REQUEST_QUOTE_RPC } from '@/shared/lib/db-schema'
import type { MessageKey } from '@/shared/i18n/messages'
import { getSupabaseClient } from '@/shared/lib/supabase'
import { MAX_LINE_QUANTITY } from './cart/cart'

/**
 * Cotizaciones del comprador en la vitrina (cierre A3).
 *
 * ## Aceptar no es comprar
 *
 * `accept_quote` convierte el precio cotizado en un acuerdo que el motor de
 * precios ya sabe leer y devuelve las líneas para el CARRITO. El pedido sale del
 * checkout de siempre, con su sesión, su surtido, su crédito y su aprobación, y
 * aun así cobra lo cotizado. Aquí no se calcula ni se manda un solo importe.
 *
 * ## Ningún id de cuenta viaja
 *
 * Las tres funciones resuelven la cuenta y el cliente desde la sesión. El único
 * identificador que sale del navegador es el de la cotización, y la base
 * responde lo mismo para «no existe» que para «es de otro cliente».
 *
 * ## Todo lo decimal llega como texto
 *
 * Importes y cantidades se quedan como texto: se formatean para pintar, no se
 * opera con ellos.
 */

export type QuoteStatus = 'requested' | 'sent' | 'accepted' | 'rejected' | 'expired'

export interface MyQuoteItem {
  readonly product_id: string
  readonly variant_id: string | null
  readonly name: string
  readonly uom_code: string | null
  readonly quantity: string
  readonly unit_price: string
  readonly line_total: string
}

export interface MyQuote {
  readonly quote_id: string
  readonly quote_number: string
  readonly status: QuoteStatus
  readonly currency: string
  readonly issued_at: string
  readonly valid_until: string
  readonly subtotal: string
  readonly tax_total: string
  readonly grand_total: string
  readonly order_id: string | null
  readonly accepted_at: string | null
  readonly items: readonly MyQuoteItem[]
}

export interface AcceptedQuoteLine {
  readonly product_id: string
  readonly variant_id: string | null
  readonly uom_code: string | null
  readonly quantity: number
}

export interface AcceptedQuote {
  readonly quote_id: string
  readonly quote_number: string
  readonly already_accepted: boolean
  readonly lines: readonly AcceptedQuoteLine[]
}

export interface QuoteRequestLine {
  readonly product_id: string
  readonly variant_id?: string | null
  readonly quantity: number
}

/** Clave de caché de las cotizaciones del comprador en una tienda. */
export const myQuotesKey = (storeSlug: string) => ['my-quotes', storeSlug] as const

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().rpc(name, params)
  if (error) throw error
  return data as T
}

export async function fetchMyQuotes(storeSlug: string): Promise<MyQuote[]> {
  const data = await rpc<MyQuote[] | null>(MY_QUOTES_RPC, { p_store_slug: storeSlug })
  return Array.isArray(data) ? data : []
}

export async function acceptQuote(quoteId: string): Promise<AcceptedQuote> {
  return rpc<AcceptedQuote>(ACCEPT_QUOTE_RPC, { p_quote_id: quoteId })
}

export async function requestQuote(input: {
  storeSlug: string
  lines: readonly QuoteRequestLine[]
  notes: string | null
  requestKey: string
}): Promise<{ quote_id: string; quote_number: string; already_requested: boolean }> {
  return rpc(REQUEST_QUOTE_RPC, {
    p_store_slug: input.storeSlug,
    p_lines: input.lines.map((line) => ({
      product_id: line.product_id,
      ...(line.variant_id ? { variant_id: line.variant_id } : {}),
      quantity: line.quantity,
    })),
    p_notes: input.notes,
    p_request_key: input.requestKey,
  })
}

/**
 * Por qué una cotización NO se puede pasar al carrito tal cual, o `null`.
 *
 * Se mira ANTES de aceptar, y no es cosmética: el acuerdo de precio exige la
 * cantidad cotizada. El carrito de la vitrina recorta cada línea a
 * `MAX_LINE_QUANTITY` y no guarda presentación, así que una cotización de 500
 * unidades entraría con 99, no alcanzaría el mínimo del acuerdo y se cobraría a
 * precio de catálogo SIN AVISAR. Mejor no aceptarla y decirlo que crear un
 * acuerdo que el carrito no puede usar.
 */
export function quoteCartBlocker(quote: Pick<MyQuote, 'items'>): 'tooLarge' | 'presentation' | null {
  if (quote.items.some((item) => Number(item.quantity) > MAX_LINE_QUANTITY)) return 'tooLarge'
  if (quote.items.some((item) => item.uom_code !== null)) return 'presentation'
  return null
}

/** Una cotización se ofrece para aceptar solo en estos estados. */
export function isAcceptable(quote: Pick<MyQuote, 'status' | 'order_id'>): boolean {
  return quote.order_id === null && (quote.status === 'sent' || quote.status === 'accepted')
}

/** El código de dominio del servidor, traducido a algo que el comprador pueda hacer. */
export function mapQuoteCode(code: string): MessageKey {
  switch (code) {
    case 'COTIZACION_VENCIDA':
      return 'account.quotes.error.expired'
    case 'COTIZACION_YA_CONVERTIDA':
      return 'account.quotes.error.converted'
    case 'COTIZACION_NO_ACEPTABLE':
    case 'COTIZACION_MONEDA_INCONSISTENTE':
    case 'COTIZACION_CANTIDAD_NO_ENTERA':
    case 'COTIZACION_UOM_NO_DISPONIBLE':
    case 'COTIZACION_PRODUCTO_NO_DISPONIBLE': // ADR 018: ya no publicado en esta tienda

      return 'account.quotes.error.notAcceptable'
    case 'SIN_PERMISO':
      return 'account.quotes.error.forbidden'
    case 'COTIZACION_NO_ENCONTRADA':
      return 'account.quotes.error.notFound'
    default:
      return 'account.quotes.error.generic'
  }
}

/** Los códigos de `request_quote`, traducidos. */
export function mapQuoteRequestCode(code: string): MessageKey {
  switch (code) {
    case 'CUENTA_NO_VINCULADA':
    case 'SIN_PERMISO':
      return 'store.cart.requestQuote.error.forbidden'
    case 'SIN_MODULO':
      return 'store.cart.requestQuote.error.unavailable'
    case 'PRODUCTO_NO_DISPONIBLE':
    case 'CANTIDAD_INVALIDA':
    case 'LINEA_DUPLICADA':
    case 'ITEMS_EXCESIVOS':
    case 'ITEMS_REQUERIDOS':
      return 'store.cart.requestQuote.error.lines'
    default:
      return 'store.cart.requestQuote.error.generic'
  }
}

/**
 * El código de dominio de un error de la base.
 *
 * Delega en `codeFromDbError`, que es la ÚNICA pieza que lee el texto de un
 * error del servidor (lo vigila `architecture.test.ts`): ese texto lleva
 * nombres de tabla y de policy, y aquí solo interesa el código.
 */
export function quoteErrorCode(error: unknown): string {
  return codeFromDbError(error as PostgrestLike)
}

/** Una clave de solicitud nueva por intento de envío. */
export function newRequestKey(): string {
  return `sol-${crypto.randomUUID()}`
}
