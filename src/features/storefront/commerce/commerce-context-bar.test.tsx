import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * La barra «para quién se compra» (H05-H06).
 *
 * Lo que se fija: que el consumidor no ve nada; que comercio y empresa se
 * distinguen por las banderas de proceso y no por un nombre; que «convenio» o
 * «condiciones» solo se prometen si el servidor lo dice; que la pregunta lleva
 * el slug y nada más; y que un fallo no rompe la tienda.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { CommerceContextBar } = await import('./CommerceContextBar')
const { useCartQuote } = await import('@/features/pricing/useCartQuote')

const PRODUCTO = 'cccc1111-1111-4111-8111-111111111111'
const LINEAS = [{ productId: PRODUCTO, variantId: null, uomCode: null, quantity: 1 }]

/** Un resumen de carrito que cotiza contra el servidor, como el de la vitrina. */
function TotalDelCarrito() {
  const quote = useCartQuote('tienda-a', 'PEN', LINEAS)
  return <p data-testid="total">{quote.data?.grossTotal ?? '…'}</p>
}

function cotizacion(unit: string) {
  return {
    currency: 'PEN',
    channel: 'b2c',
    tax_inclusive: false,
    quoted_at: '2026-09-13T00:00:00.000Z',
    subtotal: unit,
    discount_total: '0.00',
    promotions: { applied: [] },
    tax_total: '0.00',
    grand_total: unit,
    lines: [
      {
        product_id: PRODUCTO,
        variant_id: null,
        name: 'Jabón',
        uom_code: null,
        quantity: 1,
        unit_price: unit,
        compare_at_price: null,
        net_amount: unit,
        tax_rate: '0',
        source: 'price_list',
        price_list_id: null,
        price_list_code: null,
        scope: 'customer',
        min_quantity: '1',
      },
    ],
  }
}

const BASE = {
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

function pintar(respuesta: (() => unknown) | null, session = makeSession({ withTenantClaims: false })) {
  const fake: FakeSupabase = createFakeSupabase({
    session,
    rpc: respuesta ? { my_commerce_context: respuesta } : {},
  })
  holder.client = fake
  const view = renderWithProviders(<CommerceContextBar storeSlug="tienda-a" />, { session })
  return { fake, view }
}

beforeEach(() => {
  holder.client = null
})

describe('CommerceContextBar', () => {
  it('sin sesión no pregunta ni pinta', async () => {
    const fake = createFakeSupabase({ rpc: { my_commerce_context: () => BASE } })
    holder.client = fake
    const { container } = renderWithProviders(<CommerceContextBar storeSlug="tienda-a" />, { session: null })
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
    expect(fake.state.rpcCalls).toEqual([])
  })

  it('consumidor con sesión: el servidor no devuelve cuenta y no se pinta nada', async () => {
    const { fake, view } = pintar(() => null)
    await waitFor(() => expect(fake.state.rpcCalls.map((c) => c.name)).toContain('my_commerce_context'))
    expect(view.container).toBeEmptyDOMElement()
  })

  it('comercio: «Cuenta comercial», su nombre y condiciones activas', async () => {
    const { fake } = pintar(() => BASE)

    const region = await screen.findByRole('complementary', { name: 'Contexto de compra' })
    expect(region).toHaveAttribute('data-commerce-audience', 'trade')
    expect(screen.getByText('Cuenta comercial')).toBeInTheDocument()
    expect(screen.getByText('Bodega Esperanza')).toBeInTheDocument()
    expect(screen.getByText('Condiciones comerciales activas')).toBeInTheDocument()
    expect(screen.queryByText(/Enterprise|Comprando para/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver cuenta' })).toHaveAttribute('href', '/s/tienda-a/account')

    // La pregunta lleva el slug de la tienda y NADA más; y no se cotiza nada.
    expect(fake.state.rpcCalls).toEqual([{ name: 'my_commerce_context', args: { p_store_slug: 'tienda-a' } }])
  })

  it('empresa sin convenio vigente: «Comprando para», sin prometer convenio', async () => {
    pintar(() => ({ ...BASE, account_name: 'Corporación Andina SAC', requires_approval: true, has_commercial_pricing: false }))

    const region = await screen.findByRole('complementary', { name: 'Contexto de compra' })
    expect(region).toHaveAttribute('data-commerce-audience', 'enterprise')
    expect(screen.getByText('Comprando para')).toBeInTheDocument()
    expect(screen.queryByText('Precio convenio activo')).not.toBeInTheDocument()
    expect(screen.queryByText('Condiciones comerciales activas')).not.toBeInTheDocument()
  })

  it('empresa con convenio vigente: «Precio convenio activo»', async () => {
    pintar(() => ({ ...BASE, account_name: 'Corporación Andina SAC', has_credit_terms: true }))
    expect(await screen.findByText('Precio convenio activo')).toBeInTheDocument()
  })

  it('un nombre larguísimo no rompe la barra: se recorta y conserva el nombre completo', async () => {
    const largo = 'Distribuidora Comercial e Industrial de Productos Farmacéuticos y Afines del Sur Andino SAC'
    pintar(() => ({ ...BASE, account_name: largo }))
    const nombre = await screen.findByText(largo)
    expect(nombre).toHaveAttribute('title', largo)
  })

  it('si la consulta falla, la tienda sigue y la barra no aparece', async () => {
    const { fake, view } = pintar(() => {
      throw Object.assign(new Error('Could not find the function public.my_commerce_context'), { code: 'PGRST202' })
    })
    await waitFor(() => expect(fake.state.rpcCalls.length).toBeGreaterThan(0))
    expect(view.container).toBeEmptyDOMElement()
  })

  it('con una sola cuenta no hay selector ni se pregunta la lista', async () => {
    const { fake } = pintar(() => BASE)
    await screen.findByText('Bodega Esperanza')
    expect(screen.queryByRole('button', { name: /Cambiar cuenta/ })).not.toBeInTheDocument()
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('my_store_business_accounts')
  })
})

describe('CommerceContextBar · varias cuentas en la tienda (N01)', () => {
  const A = { account_id: '11111111-1111-4111-8111-111111111111', code: 'ZETA', name: 'Zeta Distribuciones', customer_name: 'Zeta Distribuciones', is_effective: true }
  const B = {
    account_id: '22222222-2222-4222-8222-222222222222',
    code: 'ALFA',
    name: 'Alfa Corporativo Industrial y Comercial de los Andes del Sur SAC',
    customer_name: 'Alfa SAC',
    is_effective: false,
  }

  function pintarMulti(select: (args: Record<string, unknown>) => unknown, conCarrito = false) {
    let efectiva = A.account_id
    const session = makeSession({ withTenantClaims: false })
    const fake: FakeSupabase = createFakeSupabase({
      session,
      rpc: {
        my_commerce_context: () => ({
          ...BASE,
          requires_approval: true,
          accounts_in_store: 2,
          account_name: efectiva === A.account_id ? A.name : B.name,
        }),
        my_store_business_accounts: () => [
          { ...A, is_effective: efectiva === A.account_id },
          { ...B, is_effective: efectiva === B.account_id },
        ],
        select_store_business_account: (args) => {
          const result = select(args)
          efectiva = String(args.p_account_id)
          return result
        },
        // El precio lo decide la cuenta efectiva del SERVIDOR: A cotiza 8, B cotiza 6.
        promotion_quote_for_slug: () => cotizacion(efectiva === A.account_id ? '8.00' : '6.00'),
      },
    })
    holder.client = fake
    renderWithProviders(
      <>
        <CommerceContextBar storeSlug="tienda-a" />
        {conCarrito && <TotalDelCarrito />}
      </>,
      { session },
    )
    return fake
  }

  it('el nombre es un selector; elegir PIDE la cuenta al servidor y vuelve a preguntar el contexto', async () => {
    const user = userEvent.setup()
    const fake = pintarMulti(() => ({ account_id: B.account_id }))

    const boton = await screen.findByRole('button', { name: /Comprando para: Zeta Distribuciones\. Cambiar cuenta/ })
    expect(boton).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(boton)

    const menu = await screen.findByRole('menu')
    const opciones = within(menu).getAllByRole('menuitem')
    expect(opciones.map((o) => o.textContent)).toEqual([A.name, `${B.name}${B.customer_name}`])
    await user.click(within(menu).getByText(B.name))

    expect(await screen.findByRole('status')).toHaveTextContent(`Ahora compras para ${B.name}.`)
    expect(await screen.findByRole('button', { name: new RegExp(`Comprando para: ${B.name}`) })).toHaveAttribute('title', B.name)

    const seleccion = fake.state.rpcCalls.filter((c) => c.name === 'select_store_business_account')
    // Solo el slug y la cuenta elegida: ni precio, ni cliente, ni segmento, ni lista.
    expect(seleccion).toEqual([
      { name: 'select_store_business_account', args: { p_store_slug: 'tienda-a', p_account_id: B.account_id } },
    ])
    const contextos = fake.state.rpcCalls.filter((c) => c.name === 'my_commerce_context')
    expect(contextos.length).toBeGreaterThanOrEqual(2)
  })

  it('con un carrito a la vista: recotiza con la cuenta nueva y avisa de que cambió el precio', async () => {
    const user = userEvent.setup()
    const fake = pintarMulti(() => ({ account_id: B.account_id }), true)
    expect(await screen.findByText('8.00')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Cambiar cuenta/ }))
    await user.click(within(await screen.findByRole('menu')).getByText(B.name))

    expect(await screen.findByRole('status')).toHaveTextContent(`Ahora compras para ${B.name}. Los precios se actualizaron.`)
    expect(screen.getByTestId('total')).toHaveTextContent('6.00')
    // Recotizar no es vaciar: la petición sigue llevando la misma línea y ningún precio.
    const cotizaciones = fake.state.rpcCalls.filter((c) => c.name === 'promotion_quote_for_slug')
    expect(cotizaciones.length).toBe(2)
    for (const c of cotizaciones) {
      expect(c.args).toEqual({ p_store_slug: 'tienda-a', p_items: [{ product_id: PRODUCTO, quantity: 1 }] })
    }
  })

  it('si el servidor rechaza la cuenta, lo dice y la barra sigue con la de antes', async () => {
    const user = userEvent.setup()
    pintarMulti(() => {
      throw Object.assign(new Error('CUENTA_NO_DISPONIBLE: esa cuenta no esta disponible'), { code: 'P0001' })
    })
    await user.click(await screen.findByRole('button', { name: /Cambiar cuenta/ }))
    await user.click(within(await screen.findByRole('menu')).getByText(B.name))

    expect(await screen.findByRole('status')).toHaveTextContent('No pudimos cambiar de cuenta')
    expect(screen.getByRole('button', { name: /Comprando para: Zeta Distribuciones/ })).toBeInTheDocument()
  })
})
