import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'

/**
 * La cuenta del consumidor registrado (hardening H02-H04).
 *
 * Lo que se fija aquí:
 *  · quien entra sin cuenta de empresa ve SU cuenta, no un «no estás vinculado»;
 *  · sus pedidos salen de una función que solo recibe el slug de la tienda;
 *  · el detalle pinta los importes GUARDADOS y «volver a comprar» manda al
 *    carrito producto y cantidad —nunca el precio del pedido viejo—;
 *  · «Mis datos» solo escribe nombre y teléfono;
 *  · si la base todavía no tiene las funciones, se dice «no activada», no
 *    «algo salió mal».
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const PRODUCTO = '0c000000-0000-4000-8000-0000000000f1'
const RETIRADO = '0c000000-0000-4000-8000-0000000000f2'

vi.mock('../api', () => ({
  // El catálogo de HOY: el precio aquí es 15.00, el del pedido fue 12.50.
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    ids
      .filter((id) => id === PRODUCTO)
      .map((id) => ({ product_id: id, store_id: STORE_A, name: 'Jabón', price: '15.00' })),
  ),
  fetchPublicVariants: vi.fn(async () => []),
}))

const { MyOrdersSection } = await import('./MyOrdersSection')
const { ConsumerProfileSection } = await import('./ConsumerProfileSection')
const { ConsumerAddressesSection } = await import('./ConsumerAddressesSection')
const { CartContext } = await import('../cart/cart-context')

const PEDIDO = {
  order_id: '0c000000-0000-4000-8000-0000000000a1',
  order_number: 'T-0007',
  placed_at: '2026-09-10T15:00:00.000Z',
  status: 'pending',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  approval_status: 'not_required',
  currency: 'PEN',
  grand_total: '35.00',
  item_count: 3,
}

const DETALLE = {
  order_id: PEDIDO.order_id,
  order_number: PEDIDO.order_number,
  status: 'pending',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  placed_at: PEDIDO.placed_at,
  currency: 'PEN',
  subtotal: '35.00',
  discount_total: '0.00',
  tax_total: '0.00',
  shipping_total: '0.00',
  grand_total: '35.00',
  shipping_address: { address: 'Av. Primavera 120', city: 'Lima', country: 'PE' },
  items: [
    { product_id: PRODUCTO, variant_id: null, name: 'Jabón', sku: 'JAB-1', variant_label: null, quantity: 2, unit_price: '12.50', total: '25.00' },
    { product_id: RETIRADO, variant_id: null, name: 'Retirado', sku: 'RET-1', variant_label: null, quantity: 1, unit_price: '10.00', total: '10.00' },
  ],
  deliveries: [{ method_name: 'Envío a domicilio', state: 'pending' }],
}

function missing() {
  const error = new Error('Could not find the function public.my_consumer_orders(p_limit, p_store_slug) in the schema cache')
  Object.assign(error, { code: 'PGRST202' })
  throw error
}

beforeEach(() => {
  holder.client = null
})

describe('Mis pedidos del consumidor', () => {
  function pintar(rpc: Record<string, (args: Record<string, unknown>) => unknown>) {
    const fake = createFakeSupabase({ session: makeSession({ withTenantClaims: false }), rpc })
    holder.client = fake
    const add = vi.fn(async () => true)
    const openCart = vi.fn()
    const cart = { add, openCart } as unknown as CartApi
    renderWithProviders(
      <CartContext.Provider value={cart}>
        <MyOrdersSection storeSlug="tienda-a" source="consumer" storeId={STORE_A} />
      </CartContext.Provider>,
      { session: fake.state.session },
    )
    return { fake, add, openCart }
  }

  it('pide la lista con el slug de la tienda y NADA más', async () => {
    const { fake } = pintar({ my_consumer_orders: () => [PEDIDO] })

    expect(await screen.findByRole('button', { name: /T-0007/ })).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_consumer_orders')?.args).toEqual({
      p_store_slug: 'tienda-a',
      p_limit: 50,
    })
    // No toca el portal B2B.
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('my_business_orders')
  })

  it('el detalle pinta lo guardado y la entrega', async () => {
    const user = userEvent.setup()
    const { fake } = pintar({ my_consumer_orders: () => [PEDIDO], my_consumer_order_detail: () => DETALLE })

    await user.click(await screen.findByRole('button', { name: /T-0007/ }))
    const panel = await screen.findByRole('presentation')

    expect(within(panel).getByText('Jabón')).toBeInTheDocument()
    expect(within(panel).getAllByText('S/ 35.00').length).toBeGreaterThan(0)
    expect(within(panel).getByText('S/ 12.50 c/u')).toBeInTheDocument()
    expect(within(panel).getByText(/Envío a domicilio · Av\. Primavera 120, Lima, PE/)).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_consumer_order_detail')?.args).toEqual({
      p_store_slug: 'tienda-a',
      p_order_id: PEDIDO.order_id,
    })
  })

  it('volver a comprar manda producto y cantidad al carrito con el producto de HOY', async () => {
    const user = userEvent.setup()
    const { add, openCart, fake } = pintar({
      my_consumer_orders: () => [PEDIDO],
      my_consumer_order_detail: () => DETALLE,
    })

    await user.click(await screen.findByRole('button', { name: /T-0007/ }))
    await user.click(await screen.findByRole('button', { name: 'Volver a comprar' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    // El producto que entra es el del catálogo actual (15.00), no una línea
    // armada con el 12.50 del pedido.
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ product_id: PRODUCTO, price: '15.00' }), 2, null)
    expect(await screen.findByText('1 añadidos; 1 no disponibles.')).toBeInTheDocument()
    expect(openCart).toHaveBeenCalled()
    // Volver a comprar no crea nada en el servidor.
    expect(fake.state.invocations).toEqual([])
  })

  it('sin pedidos, un estado vacío que dice cómo aparecerán', async () => {
    pintar({ my_consumer_orders: () => [] })
    expect(await screen.findByText('Todavía no hay pedidos')).toBeInTheDocument()
  })

  it('si la base todavía no tiene la función, dice «no activada» y no «error»', async () => {
    pintar({ my_consumer_orders: missing })
    expect(await screen.findByText('Aún no disponible en esta tienda')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument()
  })
})

describe('Mis datos', () => {
  it('muestra el correo sin dejarlo editar y guarda solo nombre y teléfono', async () => {
    const user = userEvent.setup()
    const session = makeSession({ withTenantClaims: false, email: 'ana@consumidora.test' })
    const fake = createFakeSupabase({ session })
    holder.client = fake
    const update = vi.spyOn(fake.auth, 'updateUser')
    renderWithProviders(<ConsumerProfileSection />, { session })

    const correo = await screen.findByLabelText('Correo')
    expect(correo).toHaveValue('ana@consumidora.test')
    expect(correo).toHaveAttribute('readonly')

    await user.type(screen.getByLabelText('Nombre y apellido'), 'Ana Pérez')
    await user.type(screen.getByLabelText('Teléfono'), '+51 999 111 222')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({ data: { full_name: 'Ana Pérez', phone: '+51 999 111 222' } })
  })

  it('un teléfono con letras no se guarda', async () => {
    const user = userEvent.setup()
    const session = makeSession({ withTenantClaims: false })
    const fake = createFakeSupabase({ session })
    holder.client = fake
    const update = vi.spyOn(fake.auth, 'updateUser')
    renderWithProviders(<ConsumerProfileSection />, { session })

    await user.type(await screen.findByLabelText('Teléfono'), 'llámame')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/Teléfono no válido/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('Mis direcciones', () => {
  /**
   * N06: con la libreta desplegada, las de pedidos van debajo («Usadas en tus
   * pedidos»). Aquí se simula una base SIN libreta todavía: la pestaña tiene
   * que seguir enseñando lo de H04, sin error.
   */
  it('lista las direcciones de sus pedidos, la última usada primero', async () => {
    const fake = createFakeSupabase({
      session: makeSession({ withTenantClaims: false }),
      rpc: {
        my_consumer_addresses: missing,
        my_checkout_profile: () => ({
          contact: { name: 'Ana', phone: '999' },
          addresses: [
            { address: 'Jr. Lampa 55', city: 'Lima', country: 'PE' },
            { address: 'Av. Primavera 120', city: 'Lima', country: 'PE' },
          ],
        }),
      },
    })
    holder.client = fake
    renderWithProviders(<ConsumerAddressesSection storeSlug="tienda-a" />, { session: fake.state.session })

    expect(await screen.findByText('Jr. Lampa 55')).toBeInTheDocument()
    expect(screen.getByText('Av. Primavera 120')).toBeInTheDocument()
    expect(screen.getByText('Última')).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_checkout_profile')?.args).toEqual({
      p_store_slug: 'tienda-a',
    })
  })

  it('sin direcciones, lo dice', async () => {
    const fake = createFakeSupabase({
      session: makeSession({ withTenantClaims: false }),
      rpc: { my_consumer_addresses: () => [], my_checkout_profile: () => ({ contact: null, addresses: [] }) },
    })
    holder.client = fake
    renderWithProviders(<ConsumerAddressesSection storeSlug="tienda-a" />, { session: fake.state.session })
    expect(await screen.findByText('Todavía no hay direcciones')).toBeInTheDocument()
  })
})

/**
 * N06 · La libreta editable.
 *
 * Lo que se fija: agregar manda SOLO la dirección (sin usuario, tienda ni
 * tenant); editar lleva su id; eliminar pide confirmación; marcar
 * predeterminada; las de pedidos que ya están guardadas no se repiten y las que
 * no, se pueden guardar con un gesto.
 */
describe('Mis direcciones · libreta (N06)', () => {
  const CASA = {
    id: '0c000000-0000-4000-8000-00000000ad01',
    label: 'Casa',
    address: 'Av. Primavera 120',
    city: 'Lima',
    country: 'PE',
    is_default: true,
  }
  const OFICINA = {
    id: '0c000000-0000-4000-8000-00000000ad02',
    label: 'Oficina con un nombre larguísimo de edificio corporativo en San Isidro',
    address: 'Jr. Lampa 55',
    city: 'Lima',
    is_default: false,
  }

  function pintarLibreta(libreta: Array<Record<string, unknown>>, historial: Array<Record<string, unknown>> = []) {
    let actual = [...libreta]
    const fake = createFakeSupabase({
      session: makeSession({ withTenantClaims: false }),
      rpc: {
        my_consumer_addresses: () => actual,
        my_checkout_profile: () => ({ contact: null, addresses: historial }),
        save_my_consumer_address: (args) => {
          const input = args.p_address as Record<string, unknown>
          const guardada = { id: (args.p_address_id as string) ?? '0c000000-0000-4000-8000-00000000ad09', is_default: false, ...input }
          actual = [...actual.filter((a) => a.id !== guardada.id), guardada]
          return guardada
        },
        delete_my_consumer_address: (args) => {
          actual = actual.filter((a) => a.id !== args.p_address_id)
          return actual
        },
        set_default_my_consumer_address: (args) => {
          actual = actual.map((a) => ({ ...a, is_default: a.id === args.p_address_id }))
          return actual
        },
      },
    })
    holder.client = fake
    renderWithProviders(<ConsumerAddressesSection storeSlug="tienda-a" />, { session: fake.state.session })
    return fake
  }

  it('lista la libreta con la predeterminada marcada, y no repite las de pedidos ya guardadas', async () => {
    pintarLibreta([CASA, OFICINA], [
      { address: 'av. primavera 120 ', city: 'LIMA' },
      { address: 'Calle Nueva 9', city: 'Lima' },
    ])
    expect(await screen.findByRole('heading', { name: 'Casa' })).toBeInTheDocument()
    expect(screen.getByText('Predeterminada')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: OFICINA.label })).toBeInTheDocument()
    expect(screen.getByText('Usadas en tus pedidos')).toBeInTheDocument()
    expect(screen.getByText('Calle Nueva 9')).toBeInTheDocument()
    expect(screen.queryByText('av. primavera 120')).not.toBeInTheDocument()
  })

  it('agregar manda SOLO la dirección: sin usuario, tienda ni tenant', async () => {
    const user = userEvent.setup()
    const fake = pintarLibreta([])
    await user.click(await screen.findByRole('button', { name: 'Agregar dirección' }))
    const dialogo = await screen.findByRole('dialog')
    await user.type(within(dialogo).getByLabelText(/Nombre \(Casa/), 'Casa de playa')
    await user.type(within(dialogo).getByLabelText(/Dirección de entrega/), 'Malecón 45')
    await user.type(within(dialogo).getByLabelText(/^País/), 'pe')
    await user.click(within(dialogo).getByLabelText('Proponerla primero al comprar'))
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar dirección' }))

    await waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === 'save_my_consumer_address')).toBe(true))
    const llamada = fake.state.rpcCalls.find((c) => c.name === 'save_my_consumer_address')!
    expect(llamada.args).toEqual({
      p_store_slug: 'tienda-a',
      p_address_id: null,
      p_address: { label: 'Casa de playa', address: 'Malecón 45', country: 'PE', is_default: true },
    })
    expect(await screen.findByRole('heading', { name: 'Casa de playa' })).toBeInTheDocument()
  })

  it('no guarda sin nombre ni dirección', async () => {
    const user = userEvent.setup()
    const fake = pintarLibreta([])
    await user.click(await screen.findByRole('button', { name: 'Agregar dirección' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar dirección' }))
    expect(within(dialogo).getAllByText('Completa este campo')).toHaveLength(2)
    expect(fake.state.rpcCalls.some((c) => c.name === 'save_my_consumer_address')).toBe(false)
  })

  it('editar lleva el id de la dirección y los datos cambiados', async () => {
    const user = userEvent.setup()
    const fake = pintarLibreta([CASA])
    await user.click(await screen.findByRole('button', { name: 'Editar: Casa' }))
    const dialogo = await screen.findByRole('dialog')
    const campo = within(dialogo).getByLabelText(/Dirección de entrega/)
    await user.clear(campo)
    await user.type(campo, 'Av. Primavera 130')
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar dirección' }))
    await waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === 'save_my_consumer_address')).toBe(true))
    expect(fake.state.rpcCalls.find((c) => c.name === 'save_my_consumer_address')!.args).toMatchObject({
      p_address_id: CASA.id,
      p_address: { label: 'Casa', address: 'Av. Primavera 130', city: 'Lima', country: 'PE' },
    })
  })

  it('eliminar pide confirmación y luego borra por id', async () => {
    const user = userEvent.setup()
    const fake = pintarLibreta([CASA, OFICINA])
    await user.click(await screen.findByRole('button', { name: `Eliminar: ${OFICINA.label}` }))
    const confirmacion = await screen.findByRole('dialog')
    expect(confirmacion).toHaveTextContent(`¿Eliminar «${OFICINA.label}»?`)
    expect(fake.state.rpcCalls.some((c) => c.name === 'delete_my_consumer_address')).toBe(false)
    await user.click(within(confirmacion).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() =>
      expect(fake.state.rpcCalls.find((c) => c.name === 'delete_my_consumer_address')?.args).toEqual({
        p_store_slug: 'tienda-a',
        p_address_id: OFICINA.id,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('heading', { name: OFICINA.label })).not.toBeInTheDocument())
  })

  it('marcar predeterminada otra dirección', async () => {
    const user = userEvent.setup()
    const fake = pintarLibreta([CASA, OFICINA])
    await user.click(await screen.findByRole('button', { name: 'Usar por defecto' }))
    await waitFor(() =>
      expect(fake.state.rpcCalls.find((c) => c.name === 'set_default_my_consumer_address')?.args).toEqual({
        p_store_slug: 'tienda-a',
        p_address_id: OFICINA.id,
      }),
    )
  })

  it('una dirección de un pedido se guarda en la libreta con un gesto, con sus datos ya puestos', async () => {
    const user = userEvent.setup()
    pintarLibreta([], [{ address: 'Calle Nueva 9', city: 'Arequipa', country: 'PE' }])
    await user.click(await screen.findByRole('button', { name: 'Guardar en mi libreta' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByLabelText(/Dirección de entrega/)).toHaveValue('Calle Nueva 9')
    expect(within(dialogo).getByLabelText(/^Ciudad/)).toHaveValue('Arequipa')
    expect(within(dialogo).getByLabelText(/Nombre \(Casa/)).toHaveValue('')
  })
})
