import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A, type FakeSupabase } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'

/**
 * Bandeja de aprobaciones del comprador B2B y «volver a comprar» B2B
 * (cierre, items 2 y 6b).
 *
 * Lo que se fija aquí es lo que el SQL no puede ver:
 *  · la pestaña solo existe para quien puede decidir, y esa señal sale del
 *    servidor (rol en la cuenta / `can_decide`), no de nada del navegador;
 *  · aprobar con doble clic manda UNA sola llamada;
 *  · rechazar no sale sin motivo;
 *  · un error del servidor se pinta traducido, nunca con su texto crudo;
 *  · el detalle B2B ofrece «volver a comprar», que va al CARRITO.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const PRODUCTO = '0f000000-0000-4000-8000-0000000000f1'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    ids.filter((id) => id === PRODUCTO).map((id) => ({ product_id: id, store_id: STORE_A, name: 'Guantes', price: '9.00' })),
  ),
  fetchPublicVariants: vi.fn(async () => []),
}))

const { StoreAccountPage } = await import('../StoreAccountPage')
const { MyApprovalsSection } = await import('./MyApprovalsSection')
const { CartContext } = await import('../cart/cart-context')

const PENDIENTE = {
  order_id: '0f000000-0000-4000-8000-0000000000a1',
  order_number: 'MQ-2026-0200',
  status: 'pending',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  approval_status: 'pending',
  currency: 'PEN',
  grand_total: '2450.50',
  placed_at: '2026-09-13T10:00:00.000Z',
  account_name: 'Policlinico Andino SAC',
  my_role: 'approver',
  can_decide: true,
  purchase_order_number: 'OC-2026-0042',
  buyer_email: 'compras@andino.test',
}

const DETALLE = {
  order_id: PENDIENTE.order_id,
  order_number: PENDIENTE.order_number,
  status: 'pending',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  placed_at: PENDIENTE.placed_at,
  currency: 'PEN',
  subtotal: '2450.50',
  discount_total: '0.00',
  tax_total: '0.00',
  shipping_total: '0.00',
  grand_total: '2450.50',
  purchase_order_number: 'OC-2026-0042',
  approval_status: 'pending',
  can_decide: true,
  approval_decided_at: null,
  approval_decided_email: null,
  approval_reason: null,
  items: [
    {
      product_id: PRODUCTO,
      variant_id: null,
      name: 'Guantes de nitrilo',
      sku: 'GUA-NIT',
      variant_label: null,
      quantity: 3,
      unit_price: '8.00',
      total: '24.00',
    },
  ],
}

function cuenta(role: string) {
  return {
    account_id: '0f000000-0000-4000-8000-0000000000c1',
    code: 'ANDINO',
    name: 'Policlinico Andino SAC',
    customer_name: 'Policlinico Andino SAC',
    customer_kind: 'company',
    role,
    status: 'active',
    spending_limit: null,
    requires_approval: true,
    approval_threshold: '1000.00',
    purchase_order_required: false,
    default_location_id: null,
    locations: [],
    addresses: [],
  }
}

function backend(role: string, rpc: Record<string, (args: Record<string, unknown>) => unknown> = {}): FakeSupabase {
  const puede = role === 'admin' || role === 'approver'
  return createFakeSupabase({
    session: makeSession({ withTenantClaims: false }),
    rpc: {
      my_business_accounts: () => [cuenta(role)],
      my_business_orders: (args) =>
        args.p_only_pending
          ? [{ ...PENDIENTE, my_role: role, can_decide: puede, buyer_email: puede ? PENDIENTE.buyer_email : null }]
          : [{ ...PENDIENTE, my_role: role, can_decide: puede }],
      my_business_order_detail: () => ({ ...DETALLE, can_decide: puede }),
      ...rpc,
    },
  })
}

const STOREFRONT = {
  store: { store_id: STORE_A, name: 'Tienda A', slug: 'tienda-a' },
  storeSlug: 'tienda-a',
}

function pintarCuenta(fake: FakeSupabase, cart?: CartApi) {
  holder.client = fake
  const page = (
    <Routes>
      <Route path="*" element={<Outlet context={STOREFRONT} />}>
        <Route path="*" element={<StoreAccountPage />} />
      </Route>
    </Routes>
  )
  return renderWithProviders(cart ? <CartContext.Provider value={cart}>{page}</CartContext.Provider> : page, {
    session: fake.state.session,
  })
}

function pintarBandeja(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(<MyApprovalsSection storeSlug="tienda-a" storeId={STORE_A} />, {
    session: fake.state.session,
  })
}

const decisiones = (fake: FakeSupabase) => fake.state.rpcCalls.filter((c) => c.name === 'order_approval_decide')

beforeEach(() => {
  holder.client = null
  window.history.replaceState(null, '', '/')
})

describe('la pestaña Aprobaciones', () => {
  it('NO aparece para un comprador que no puede decidir', async () => {
    pintarCuenta(backend('buyer'))

    expect(await screen.findByRole('tab', { name: 'Mis pedidos' })).toBeInTheDocument()
    // Se espera a que la cola haya contestado: la ausencia no puede ser prisa.
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /Aprobaciones/ })).not.toBeInTheDocument(),
    )
  })

  it('aparece para el aprobador, con cuántas esperan, y lista lo mínimo para decidir', async () => {
    const user = userEvent.setup()
    const fake = backend('approver')
    pintarCuenta(fake)

    const tab = await screen.findByRole('tab', { name: 'Aprobaciones (1)' })
    await user.click(tab)

    const fila = await screen.findByRole('article', { name: 'MQ-2026-0200' })
    expect(within(fila).getByText(/Policlinico Andino SAC/)).toBeInTheDocument()
    expect(within(fila).getByText(/compras@andino\.test/)).toBeInTheDocument()
    expect(within(fila).getByText('OC-2026-0042')).toBeInTheDocument()
    expect(within(fila).getByText('S/ 2,450.50')).toBeInTheDocument()

    // La cola se pide sin ningún id: solo «pendientes» y el límite.
    const cola = fake.state.rpcCalls.find((c) => c.name === 'my_business_orders' && c.args.p_only_pending)
    expect(Object.keys(cola?.args ?? {}).sort()).toEqual(['p_limit', 'p_only_pending'])
  })
})

describe('decidir desde la bandeja', () => {
  it('aprobar con doble clic llama UNA sola vez a la RPC', async () => {
    const user = userEvent.setup()
    let soltar: (value: unknown) => void = () => undefined
    const fake = backend('approver', {
      order_approval_decide: () =>
        new Promise((resolve) => {
          soltar = resolve
        }),
    })
    pintarBandeja(fake)

    const aprobar = await screen.findByRole('button', { name: 'Aprobar' })
    // Dos clics en el MISMO tick, antes de que React repinte el botón
    // deshabilitado: es el hueco que cubre el `ref`, no el `disabled`.
    act(() => {
      fireEvent.click(aprobar)
      fireEvent.click(aprobar)
    })
    // Y el doble clic de verdad, ya con el botón deshabilitado, tampoco pasa.
    await user.dblClick(aprobar).catch(() => undefined)

    expect(decisiones(fake)).toHaveLength(1)
    expect(decisiones(fake)[0]?.args).toEqual({ p_order_id: PENDIENTE.order_id, p_approve: true, p_reason: null })
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeDisabled()

    await act(async () => {
      soltar({ order_id: PENDIENTE.order_id, order_number: PENDIENTE.order_number, approval_status: 'approved', status: 'pending', decided_at: null, already_decided: false })
    })
    expect(await screen.findByText('Pedido MQ-2026-0200 aprobado.')).toBeInTheDocument()
    expect(decisiones(fake)).toHaveLength(1)
  })

  it('tras decidir se vuelve a pedir la cola', async () => {
    const user = userEvent.setup()
    const fake = backend('approver', {
      order_approval_decide: () => ({ order_id: PENDIENTE.order_id, approval_status: 'approved', already_decided: false }),
    })
    pintarBandeja(fake)
    const colas = () => fake.state.rpcCalls.filter((c) => c.name === 'my_business_orders').length

    const aprobar = await screen.findByRole('button', { name: 'Aprobar' })
    const antes = colas()
    await user.click(aprobar)
    await waitFor(() => expect(colas()).toBeGreaterThan(antes))
  })

  it('rechazar exige motivo y lo manda recortado', async () => {
    const user = userEvent.setup()
    const fake = backend('approver', {
      order_approval_decide: () => ({ order_id: PENDIENTE.order_id, approval_status: 'rejected', already_decided: false }),
    })
    pintarBandeja(fake)

    await user.click(await screen.findByRole('button', { name: 'Rechazar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar el pedido MQ-2026-0200' })
    const confirmar = within(dialogo).getByRole('button', { name: 'Rechazar pedido' })

    expect(confirmar).toBeDisabled()
    await user.type(within(dialogo).getByRole('textbox', { name: /Motivo del rechazo/ }), '   ')
    expect(confirmar).toBeDisabled()
    expect(decisiones(fake)).toHaveLength(0)

    await user.type(within(dialogo).getByRole('textbox', { name: /Motivo del rechazo/ }), 'Fuera de presupuesto ')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    await waitFor(() => expect(decisiones(fake)).toHaveLength(1))
    expect(decisiones(fake)[0]?.args).toEqual({
      p_order_id: PENDIENTE.order_id,
      p_approve: false,
      p_reason: 'Fuera de presupuesto',
    })
    expect(await screen.findByText('Pedido MQ-2026-0200 rechazado.')).toBeInTheDocument()
  })

  it.each([
    ['SIN_PERMISO: hace falta ser aprobador de la cuenta o personal de pedidos', '42501', 'No tienes permiso para decidir sobre este pedido.'],
    ['APROBACION_NO_APLICA: el pedido MQ-2026-0200 no espera autorizacion', '22023', 'Este pedido ya no espera aprobación. Actualizamos la lista.'],
    ['MOTIVO_REQUERIDO: rechazar una compra exige un motivo', '22023', 'Rechazar un pedido exige un motivo.'],
  ])('el error %s se pinta traducido, sin el texto del servidor', async (message, code, traducido) => {
    const user = userEvent.setup()
    const fake = backend('approver', {
      order_approval_decide: () => {
        throw { message, code }
      },
    })
    pintarBandeja(fake)

    await user.click(await screen.findByRole('button', { name: 'Aprobar' }))
    expect(await screen.findByText(traducido)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(message.split(':')[0] ?? ''))).not.toBeInTheDocument()
  })

  it('una fila sin can_decide se lee pero no ofrece botones', async () => {
    pintarBandeja(
      backend('approver', { my_business_orders: () => [{ ...PENDIENTE, my_role: 'viewer', can_decide: false }] }),
    )
    expect(await screen.findByRole('article', { name: 'MQ-2026-0200' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument()
  })

  it('sin pendientes dice que no hay nada', async () => {
    pintarBandeja(backend('approver', { my_business_orders: () => [] }))
    expect(await screen.findByText('No hay compras esperando tu aprobación')).toBeInTheDocument()
  })

  it('si la cola falla ofrece reintentar, sin el texto del servidor', async () => {
    pintarBandeja(
      backend('approver', {
        my_business_orders: () => {
          throw { message: 'ERROR_RARO: relation public.orders does not exist', code: 'XX000' }
        },
      }),
    )
    // La consulta reintenta dos veces antes de rendirse (misma política que «Mis pedidos»).
    expect(await screen.findByRole('button', { name: 'Reintentar' }, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByText(/relation public\.orders/)).not.toBeInTheDocument()
  }, 15_000)
})

describe('volver a comprar en el portal B2B', () => {
  it('el detalle de «Mis pedidos» ofrece el botón y manda producto y cantidad al carrito', async () => {
    const user = userEvent.setup()
    const add = vi.fn(async () => true)
    const openCart = vi.fn()
    const fake = backend('buyer')
    pintarCuenta(fake, { add, openCart } as unknown as CartApi)

    await user.click(await screen.findByRole('button', { name: /MQ-2026-0200/ }))
    const panel = await screen.findByRole('presentation')
    const volver = await within(panel).findByRole('button', { name: 'Volver a comprar' })

    await user.click(volver)
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    // Producto del catálogo de HOY y la cantidad del pedido: nunca su precio.
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ product_id: PRODUCTO, price: '9.00' }), 3, null)
    // Ni un pedido creado por la puerta de atrás.
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('create_order')
    expect(fake.state.invocations).toEqual([])
  })
})
