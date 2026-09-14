import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'
import type { CartLine } from '../cart/cart'

/**
 * Cotizaciones del comprador en la vitrina (cierre A3).
 *
 * Lo que se fija:
 *
 *  · aceptar pasa las líneas al CARRITO y no crea ningún pedido;
 *  · un doble clic es UNA aceptación;
 *  · una cotización que el carrito no puede sostener tal cual NO se acepta, y
 *    se dice por qué: aceptarla crearía un acuerdo que acabaría cobrándose a
 *    precio de catálogo sin avisar;
 *  · el error del servidor se traduce, nunca se pinta crudo;
 *  · pedir una cotización manda qué y cuánto, nunca un precio, y un doble envío
 *    reutiliza la misma clave.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const JABON = '0a000000-0000-4000-8000-0000000000e1'
const CHAMPU = '0a000000-0000-4000-8000-0000000000e2'

vi.mock('../api', () => ({
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    ids.map((id) => ({ product_id: id, store_id: STORE_A, name: id === JABON ? 'Jabón' : 'Champú' })),
  ),
  fetchPublicVariants: vi.fn(async () => []),
  fetchOnlyPublicStore: vi.fn(async () => null),
}))

const { MyQuotesSection } = await import('./MyQuotesSection')
const { RequestQuoteButton } = await import('../cart/RequestQuoteButton')
const { CartContext } = await import('../cart/cart-context')

const COT_VIGENTE = '0a000000-0000-4000-8000-0000000000c1'
const COT_GRANDE = '0a000000-0000-4000-8000-0000000000c2'
const COT_SOLICITADA = '0a000000-0000-4000-8000-0000000000c3'

function cotizacion(extra: Record<string, unknown> = {}) {
  return {
    quote_id: COT_VIGENTE,
    quote_number: 'COT-0101',
    status: 'sent',
    currency: 'PEN',
    issued_at: '2026-09-10',
    valid_until: '2026-09-30',
    subtotal: '145.00',
    tax_total: '0.00',
    grand_total: '145.00',
    order_id: null,
    accepted_at: null,
    items: [
      { product_id: JABON, variant_id: null, name: 'Jabón', uom_code: null, quantity: '10.000', unit_price: '7.00', line_total: '70.00' },
      { product_id: CHAMPU, variant_id: null, name: 'Champú', uom_code: null, quantity: '5.000', unit_price: '15.00', line_total: '75.00' },
    ],
    ...extra,
  }
}

function pintarCotizaciones(rpc: Record<string, (args: Record<string, unknown>) => unknown>) {
  const fake = createFakeSupabase({ session: makeSession(), rpc })
  holder.client = fake
  const add = vi.fn(async () => true)
  const openCart = vi.fn()
  const cart = { add, openCart } as unknown as CartApi
  renderWithProviders(
    <CartContext.Provider value={cart}>
      <MyQuotesSection storeSlug="tienda-a" storeId={STORE_A} />
    </CartContext.Provider>,
    { session: fake.state.session },
  )
  return { fake, add, openCart }
}

beforeEach(() => {
  holder.client = null
})

describe('las cotizaciones del comprador', () => {
  it('enseña número, estado, total y líneas', async () => {
    pintarCotizaciones({ my_quotes: () => [cotizacion()] })

    expect(await screen.findByText('COT-0101')).toBeInTheDocument()
    expect(screen.getByText('Por aceptar')).toBeInTheDocument()
    expect(screen.getByText('Jabón')).toBeInTheDocument()
  })

  it('aceptar pasa las líneas al carrito y no crea ningún pedido', async () => {
    const user = userEvent.setup()
    const { fake, add, openCart } = pintarCotizaciones({
      my_quotes: () => [cotizacion()],
      accept_quote: () => ({
        quote_id: COT_VIGENTE,
        quote_number: 'COT-0101',
        already_accepted: false,
        lines: [
          { product_id: JABON, variant_id: null, uom_code: null, quantity: 10 },
          { product_id: CHAMPU, variant_id: null, uom_code: null, quantity: 5 },
        ],
      }),
    })

    await user.click(await screen.findByRole('button', { name: 'Aceptar y llevar al carrito' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(2))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ product_id: JABON }), 10, null)
    expect(openCart).toHaveBeenCalled()
    // Solo el id de la cotización sale del navegador: ni cuenta, ni cliente, ni precio.
    expect(fake.state.rpcCalls.find((c) => c.name === 'accept_quote')?.args).toEqual({ p_quote_id: COT_VIGENTE })
    expect(fake.state.invocations).toEqual([])
  })

  it('un doble clic es UNA aceptación', async () => {
    const user = userEvent.setup()
    let resolver: (v: unknown) => void = () => {}
    const { fake } = pintarCotizaciones({
      my_quotes: () => [cotizacion()],
      accept_quote: () => new Promise((r) => (resolver = r)),
    })

    const boton = await screen.findByRole('button', { name: 'Aceptar y llevar al carrito' })
    await user.dblClick(boton)
    resolver({ quote_id: COT_VIGENTE, quote_number: 'COT-0101', already_accepted: false, lines: [] })

    await waitFor(() => expect(fake.state.rpcCalls.filter((c) => c.name === 'accept_quote')).toHaveLength(1))
  })

  it('una cotización que el carrito no puede sostener no se acepta, y se dice por qué', async () => {
    const { fake } = pintarCotizaciones({
      my_quotes: () => [
        cotizacion({
          quote_id: COT_GRANDE,
          quote_number: 'COT-0500',
          items: [{ product_id: JABON, variant_id: null, name: 'Jabón', uom_code: null, quantity: '500.000', unit_price: '6.00', line_total: '3000.00' }],
        }),
      ],
    })

    expect(await screen.findByText(/mayores a las que admite el carrito/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aceptar y llevar al carrito' })).not.toBeInTheDocument()
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('accept_quote')
  })

  it('una solicitud pendiente se enseña sin botón de aceptar', async () => {
    pintarCotizaciones({ my_quotes: () => [cotizacion({ quote_id: COT_SOLICITADA, status: 'requested' })] })

    expect(await screen.findByText('Solicitada')).toBeInTheDocument()
    expect(screen.getByText(/está preparando el precio/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aceptar y llevar al carrito' })).not.toBeInTheDocument()
  })

  it('el error del servidor se traduce, no se pinta crudo', async () => {
    const user = userEvent.setup()
    pintarCotizaciones({
      my_quotes: () => [cotizacion()],
      accept_quote: () => {
        throw { message: 'COTIZACION_VENCIDA: la cotizacion vencio el 2026-09-01 (tabla quotes)' }
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Aceptar y llevar al carrito' }))

    expect(await screen.findByText('La cotización ya venció. Pide una nueva a la tienda.')).toBeInTheDocument()
    expect(screen.queryByText(/tabla quotes/)).not.toBeInTheDocument()
  })
})

describe('pedir una cotización desde el carrito', () => {
  const CONTEXTO_EMPRESA = {
    account_name: 'Botica Central',
    account_code: 'BOT-01',
    customer_name: 'Botica Central SAC',
    requires_approval: false,
    purchase_order_required: false,
    has_spending_limit: false,
    has_credit_terms: false,
    locations_count: 1,
    has_commercial_pricing: false,
    accounts_in_store: 1,
  }

  const lineas = [
    { product_id: JABON, variant_id: null, variant_name: null, slug: 'jabon', name: 'Jabón', unit_price: '10.00', currency: 'PEN', image_path: null, quantity: 3 },
  ] as CartLine[]

  function pintarBoton(context: unknown) {
    const fake = createFakeSupabase({
      session: makeSession(),
      rpc: {
        my_commerce_context: () => context,
        request_quote: () => ({ quote_id: 'q-1', quote_number: 'SOL-20260914-ABC123', already_requested: false }),
      },
    })
    holder.client = fake
    renderWithProviders(<RequestQuoteButton storeSlug="tienda-a" lines={lineas} />, { session: fake.state.session })
    return { fake }
  }

  it('sin cuenta de empresa en esta tienda, el botón no aparece', async () => {
    const { fake } = pintarBoton(null)
    await waitFor(() => expect(fake.state.rpcCalls.map((c) => c.name)).toContain('my_commerce_context'))
    expect(screen.queryByRole('button', { name: 'Solicitar cotización' })).not.toBeInTheDocument()
  })

  it('manda qué y cuánto, nunca un precio, y enseña el número', async () => {
    const user = userEvent.setup()
    const { fake } = pintarBoton(CONTEXTO_EMPRESA)

    await user.click(await screen.findByRole('button', { name: 'Solicitar cotización' }))
    await user.click(await screen.findByRole('button', { name: 'Enviar solicitud' }))

    expect(await screen.findByText('Solicitud enviada con el número SOL-20260914-ABC123.')).toBeInTheDocument()
    const args = fake.state.rpcCalls.find((c) => c.name === 'request_quote')?.args as Record<string, unknown>
    expect(args.p_lines).toEqual([{ product_id: JABON, quantity: 3 }])
    expect(JSON.stringify(args)).not.toMatch(/price/)
    expect(String(args.p_request_key)).toMatch(/^sol-/)
  })

  it('reintentar desde el mismo diálogo reutiliza la clave: una sola solicitud', async () => {
    const user = userEvent.setup()
    let intentos = 0
    const fake = createFakeSupabase({
      session: makeSession(),
      rpc: {
        my_commerce_context: () => CONTEXTO_EMPRESA,
        request_quote: () => {
          intentos += 1
          if (intentos === 1) throw { message: 'ERROR_RED: se corto la conexion' }
          return { quote_id: 'q-1', quote_number: 'SOL-1', already_requested: true }
        },
      },
    })
    holder.client = fake
    renderWithProviders(<RequestQuoteButton storeSlug="tienda-a" lines={lineas} />, { session: fake.state.session })

    await user.click(await screen.findByRole('button', { name: 'Solicitar cotización' }))
    await user.click(await screen.findByRole('button', { name: 'Enviar solicitud' }))
    await screen.findByText('No se pudo enviar la solicitud. Inténtalo de nuevo.')
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud' }))

    await screen.findByText(/Solicitud enviada/)
    const claves = fake.state.rpcCalls.filter((c) => c.name === 'request_quote').map((c) => c.args.p_request_key)
    expect(claves).toHaveLength(2)
    expect(claves[0]).toBe(claves[1])
  })
})
