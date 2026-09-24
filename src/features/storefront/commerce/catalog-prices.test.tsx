import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'
import type { PublicProduct } from '../types'

/**
 * El precio comercial en el catálogo, sin N+1 (N03).
 *
 * Se defiende que:
 *  · el invitado no hace NINGUNA petición por esto;
 *  · el consumidor con sesión solo pregunta el contexto (el mismo que la barra)
 *    y no cotiza;
 *  · con condiciones comerciales, N tarjetas cuestan UNA cotización, sin
 *    variantes, cantidad 1 y sin precio ni identidad en la petición;
 *  · un precio menor se pinta con su etiqueta; igual no añade ruido;
 *  · cambiar de cuenta vuelve a pedir el precio y pinta el nuevo;
 *  · lo que llega al carrito es el producto tal cual (el carrito recotiza).
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { ProductGrid } = await import('../components/ProductGrid')
const { CommerceContextBar } = await import('./CommerceContextBar')
const { CartContext } = await import('../cart/cart-context')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

function producto(id: string, name: string, price: string, extra: Partial<PublicProduct> = {}): PublicProduct {
  return {
    product_id: id,
    store_id: STORE,
    category_id: null,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    description: null,
    price,
    compare_at_price: null,
    currency: 'PEN',
    published_at: null,
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'simple',
    brand_name: null,
    variant_count: 0,
    price_from: null,
    ...extra,
  } as PublicProduct
}

const GEL = producto('11111111-0000-4000-8000-000000000001', 'Alcohol en gel', '20.00')
const JABON = producto('11111111-0000-4000-8000-000000000002', 'Jabon liquido', '15.00')
const GUANTES = producto('11111111-0000-4000-8000-000000000003', 'Guantes nitrilo', '30.00')
const POLO = producto('11111111-0000-4000-8000-000000000004', 'Polo uniforme', '45.00', { kind: 'variant', variant_count: 3 })
const PRODUCTOS = [GEL, JABON, GUANTES, POLO]

const CONTEXTO = {
  account_name: 'Bodega Esperanza',
  account_code: 'BOD',
  customer_name: 'Bodega Esperanza',
  requires_approval: false,
  purchase_order_required: false,
  has_spending_limit: false,
  has_credit_terms: false,
  locations_count: 0,
  has_commercial_pricing: true,
  accounts_in_store: 1,
}

function linea(product: PublicProduct, unit: string, source = 'price_list') {
  return { product_id: product.product_id, variant_id: null, quantity: 1, unit_price: unit, source, scope: 'segment' }
}

function pintar(options: {
  session?: boolean
  context?: unknown
  quote?: (args: Record<string, unknown>) => unknown
  extraRpc?: Record<string, (args: Record<string, unknown>) => unknown>
  conBarra?: boolean
}) {
  const session = options.session === false ? null : makeSession({ withTenantClaims: false })
  const fake: FakeSupabase = createFakeSupabase({
    session,
    rpc: {
      my_commerce_context: () => options.context ?? null,
      price_quote_for_slug: options.quote ?? (() => ({ lines: [] })),
      ...(options.extraRpc ?? {}),
    },
  })
  holder.client = fake
  const add = vi.fn(async () => true)
  renderWithProviders(
    <CartContext.Provider value={{ add, openCart: vi.fn() } as unknown as CartApi}>
      {options.conBarra && <CommerceContextBar storeSlug="tienda-a" />}
      <ProductGrid products={PRODUCTOS} storeSlug="tienda-a" thumbnails={{}} />
    </CartContext.Provider>,
    { session },
  )
  return { fake, add }
}

const llamadas = (fake: FakeSupabase, name: string) => fake.state.rpcCalls.filter((c) => c.name === name)
const tarjeta = (name: string) => screen.getByRole('heading', { name }).closest('.MuiCard-root') as HTMLElement

beforeEach(() => {
  holder.client = null
})

describe('precio comercial en la rejilla', () => {
  it('invitado: cero peticiones de contexto y de cotización', async () => {
    const { fake } = pintar({ session: false })
    await screen.findByText('Alcohol en gel')
    await new Promise((r) => setTimeout(r, 30))
    expect(fake.state.rpcCalls).toEqual([])
    expect(screen.queryByText('Tu precio comercial')).not.toBeInTheDocument()
  })

  it('consumidor con sesión: pregunta el contexto (el de la barra) y NO cotiza', async () => {
    const { fake } = pintar({ context: null })
    await waitFor(() => expect(llamadas(fake, 'my_commerce_context')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(llamadas(fake, 'price_quote_for_slug')).toEqual([])
  })

  it('comercio: UNA cotización para N tarjetas, sin variantes, cantidad 1 y sin identidad', async () => {
    const { fake } = pintar({
      context: CONTEXTO,
      quote: () => ({ lines: [linea(GEL, '16.00'), linea(JABON, '15.00'), linea(GUANTES, '30.00', 'catalog')] }),
    })

    expect(await within(await waitFor(() => tarjeta('Alcohol en gel'))).findByText('Tu precio comercial')).toBeInTheDocument()
    const cotizaciones = llamadas(fake, 'price_quote_for_slug')
    expect(cotizaciones).toHaveLength(1)
    const args = cotizaciones[0]!.args as { p_store_slug: string; p_items: Array<Record<string, unknown>> }
    expect(args.p_store_slug).toBe('tienda-a')
    expect(args.p_items).toEqual(
      [GEL, JABON, GUANTES].map((p) => ({ product_id: p.product_id, quantity: 1 })).sort((a, b) => a.product_id.localeCompare(b.product_id)),
    )
    expect(JSON.stringify(args)).not.toMatch(/price"|customer|segment|price_list_id|business_account|audience/)

    // Menor que el público: precio grande, público tachado y etiqueta.
    const gel = tarjeta('Alcohol en gel')
    expect(within(gel).getByText(/16\.00/)).toBeInTheDocument()
    expect(within(gel).getByText(/20\.00/).tagName).toBe('S')
    // Igual al público, o de catálogo: nada nuevo que decir.
    expect(within(tarjeta('Jabon liquido')).queryByText('Tu precio comercial')).not.toBeInTheDocument()
    expect(within(tarjeta('Guantes nitrilo')).queryByText('Tu precio comercial')).not.toBeInTheDocument()
    // Con variantes: el precio de siempre.
    expect(within(tarjeta('Polo uniforme')).queryByText('Tu precio comercial')).not.toBeInTheDocument()
  })

  it('empresa: la etiqueta es «Precio convenio» (la audiencia solo cambia el texto)', async () => {
    pintar({ context: { ...CONTEXTO, requires_approval: true }, quote: () => ({ lines: [linea(GEL, '16.00')] }) })
    expect(await screen.findByText('Precio convenio')).toBeInTheDocument()
    expect(screen.queryByText('Tu precio comercial')).not.toBeInTheDocument()
  })

  it('con cuenta pero SIN condiciones vigentes no se cotiza', async () => {
    const { fake } = pintar({ context: { ...CONTEXTO, has_commercial_pricing: false } })
    await waitFor(() => expect(llamadas(fake, 'my_commerce_context')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(llamadas(fake, 'price_quote_for_slug')).toEqual([])
  })

  it('si la cotización falla, la rejilla sigue con el precio público', async () => {
    pintar({
      context: CONTEXTO,
      quote: () => {
        throw Object.assign(new Error('PRODUCTO_NO_DISPONIBLE: x'), { code: 'P0001' })
      },
    })
    expect(await screen.findByText('Alcohol en gel')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('Tu precio comercial')).not.toBeInTheDocument()
  })

  it('lo que llega al carrito es el producto con su precio público: el carrito recotiza', async () => {
    const user = userEvent.setup()
    const { add } = pintar({ context: CONTEXTO, quote: () => ({ lines: [linea(GEL, '16.00')] }) })
    const gel = await waitFor(() => tarjeta('Alcohol en gel'))
    await within(gel).findByText('Tu precio comercial')
    await user.click(within(gel).getByRole('button', { name: /^Agregar al carrito/ }))
    expect(add).toHaveBeenCalledWith(GEL, 1, null)
  })
})

describe('cambiar de cuenta (N01) cambia el precio de la rejilla', () => {
  it('elegir B invalida la cotización y pinta el precio de B', async () => {
    const user = userEvent.setup()
    const A = { account_id: 'a0000000-0000-4000-8000-00000000000a', code: 'A', name: 'Andina', customer_name: 'Andina', is_effective: true }
    const B = { account_id: 'b0000000-0000-4000-8000-00000000000b', code: 'B', name: 'Boreal', customer_name: 'Boreal', is_effective: false }
    let efectiva = A.account_id
    const { fake } = pintar({
      conBarra: true,
      context: undefined,
      extraRpc: {
        my_commerce_context: () => ({ ...CONTEXTO, accounts_in_store: 2, account_name: efectiva === A.account_id ? 'Andina' : 'Boreal', account_code: efectiva === A.account_id ? 'A' : 'B' }),
        my_store_business_accounts: () => [
          { ...A, is_effective: efectiva === A.account_id },
          { ...B, is_effective: efectiva === B.account_id },
        ],
        select_store_business_account: (args) => {
          efectiva = String(args.p_account_id)
          return { account_id: efectiva }
        },
        price_quote_for_slug: () => ({ lines: [linea(GEL, efectiva === A.account_id ? '18.00' : '12.00')] }),
      },
    })

    const gel = await waitFor(() => tarjeta('Alcohol en gel'))
    expect(await within(gel).findByText(/18\.00/)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Cambiar cuenta/ }))
    await user.click(within(await screen.findByRole('menu')).getByText('Boreal'))

    expect(await within(tarjeta('Alcohol en gel')).findByText(/12\.00/)).toBeInTheDocument()
    expect(within(tarjeta('Alcohol en gel')).queryByText(/18\.00/)).not.toBeInTheDocument()
    expect(llamadas(fake, 'price_quote_for_slug')).toHaveLength(2)
  })
})
