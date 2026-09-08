import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Con QUÉ cliente se pide el precio, que resultó ser media función.
 *
 * ## El fallo que este archivo existe para que no vuelva
 *
 * P19 hizo que el precio del acuerdo saliera de `ebim.user_id()` dentro de la
 * base. El motor quedó perfecto y el comprador B2B seguía viendo el precio de
 * catálogo, porque la vitrina pide sus datos con el cliente **anónimo** —una
 * regla correcta, escrita para las vistas, cuyas policies son `to anon`—. Sin
 * token no hay `user_id()`, y sin `user_id()` no hay acuerdo.
 *
 * No lo cazó ningún test: los dobles del resto de la suite devuelven el MISMO
 * objeto para los dos accesores, así que usar uno u otro daba igual. Aquí no:
 * son dos dobles distintos, y la llamada tiene que aterrizar en el que lleva la
 * sesión. Es la única forma de que esto se pueda comprobar sin un navegador.
 *
 * Se afirma sobre las funciones que COTIZAN. Las vistas del catálogo siguen
 * siendo anónimas a propósito y eso no cambia.
 */
const holder = vi.hoisted(() => ({
  anonimo: { rpc: vi.fn() },
  conSesion: { rpc: vi.fn() },
}))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.conSesion,
  getSupabaseClient: () => holder.conSesion,
  tryGetStorefrontClient: () => holder.anonimo,
  getStorefrontClient: () => holder.anonimo,
  tryGetStorefrontRpcClient: () => holder.conSesion,
}))

const { quotePublicCart } = await import('./api')
const { fetchDeliveryOptions } = await import('@/features/storefront/delivery')
const { PRICE_QUOTE_PUBLIC_RPC, DELIVERY_OPTIONS_PUBLIC_RPC } = await import('@/shared/lib/db-schema')

const COTIZACION = {
  currency: 'PEN',
  channel: 'b2c',
  quoted_at: '2026-09-08T00:00:00.000Z',
  tax_inclusive: false,
  subtotal: '184.00',
  tax_total: '33.12',
  grand_total: '217.12',
  lines: [
    {
      line_key: '0',
      product_id: 'cccc1111-1111-4111-8111-111111111111',
      variant_id: null,
      uom_code: null,
      quantity: '2',
      name: 'Silla de roble',
      unit_price: '92.00',
      compare_at_price: null,
      net_amount: '184.00',
      tax_rate: '0.18',
      source: 'price_list',
      price_list_id: null,
      price_list_code: 'convenio',
      scope: 'segment',
      min_quantity: null,
    },
  ],
}

const ENTREGA = { currency: 'PEN', zone: null, options: [] }

const CARRITO = {
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  lines: [
    {
      product_id: 'cccc1111-1111-4111-8111-111111111111',
      variant_id: null,
      variant_name: null,
      slug: 'silla-roble',
      name: 'Silla de roble',
      unit_price: '100.00',
      currency: 'PEN',
      image_path: null,
      quantity: 2,
    },
  ],
}

beforeEach(() => {
  holder.anonimo.rpc.mockReset()
  holder.conSesion.rpc.mockReset()
  holder.anonimo.rpc.mockResolvedValue({ data: COTIZACION, error: null })
  holder.conSesion.rpc.mockResolvedValue({ data: COTIZACION, error: null })
})

describe('el precio se pide con el cliente que lleva la sesion', () => {
  it('la cotizacion del carrito NO va por el cliente anonimo', async () => {
    await quotePublicCart({
      storeSlug: 'la-tienda',
      items: [{ product_id: CARRITO.lines[0]!.product_id, quantity: 2 }],
    })

    expect(holder.conSesion.rpc).toHaveBeenCalledWith(PRICE_QUOTE_PUBLIC_RPC, expect.anything())
    // Lo importante es esto: con el anonimo, el comprador B2B ve catalogo.
    expect(holder.anonimo.rpc).not.toHaveBeenCalled()
  })

  it('la entrega tampoco: el umbral de envio gratis mira el mismo subtotal', async () => {
    holder.conSesion.rpc.mockResolvedValue({ data: ENTREGA, error: null })
    holder.anonimo.rpc.mockResolvedValue({ data: ENTREGA, error: null })

    await fetchDeliveryOptions({
      storeSlug: 'la-tienda',
      address: { address: 'Av. Arequipa 100' },
      cart: CARRITO,
    })

    expect(holder.conSesion.rpc).toHaveBeenCalledWith(
      DELIVERY_OPTIONS_PUBLIC_RPC,
      expect.anything(),
    )
    expect(holder.anonimo.rpc).not.toHaveBeenCalled()
  })

  it('y sigue sin declarar quien compra: solo tienda y articulos', async () => {
    await quotePublicCart({
      storeSlug: 'la-tienda',
      items: [{ product_id: CARRITO.lines[0]!.product_id, quantity: 2 }],
    })

    const [, cuerpo] = holder.conSesion.rpc.mock.calls[0]!
    // El cliente lo deduce el servidor del token. Si algun dia apareciera aqui
    // un `customer_id`, cualquiera podria pedir el precio de otra empresa.
    expect(Object.keys(cuerpo as object).sort()).toEqual(['p_items', 'p_store_slug'])
  })
})
