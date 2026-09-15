import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'
import type { CartApi } from '../cart/cart-context'
import type { CartLine } from '../cart/cart'

/**
 * Pedidos programados del comprador en la vitrina (cierre, item 4).
 *
 * Lo que se fija:
 *
 *  · la propuesta vencida se pasa al CARRITO, no a un pedido, y un doble clic es
 *    una sola llamada;
 *  · pausar, reanudar y editar mandan solo la plantilla y lo que cambia, nunca
 *    una cuenta ni un precio;
 *  · quien solo lee no ve botones; sin cuenta de empresa se explica por qué;
 *  · una cantidad que el carrito no admite se avisa ANTES y no se ofrece;
 *  · programar desde el carrito manda qué y cuánto, con clave de alta.
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

const { MyScheduledOrdersSection } = await import('./MyScheduledOrdersSection')
const { ScheduleCartButton } = await import('../cart/ScheduleCartButton')
const { CartContext } = await import('../cart/cart-context')
const { isoDateFromToday, scheduleFormError, mapScheduleCode } = await import('../scheduledOrders')

const PLANTILLA = '0a000000-0000-4000-8000-0000000000f1'
const RUN = '0a000000-0000-4000-8000-0000000000f2'

function plantilla(extra: Record<string, unknown> = {}) {
  return {
    id: PLANTILLA,
    name: 'Reposición semanal',
    created_at: '2026-09-01T10:00:00Z',
    schedule: {
      id: 's-1',
      status: 'active',
      interval_days: 7,
      next_run_on: '2026-09-21',
      ends_on: null,
      last_run_at: null,
    },
    pending_run: null,
    items: [
      { product_id: JABON, variant_id: null, slug: 'jabon', name: 'Jabón', variant_name: null, quantity: 10, available: true },
      { product_id: CHAMPU, variant_id: null, slug: 'champu', name: 'Champú', variant_name: null, quantity: 4, available: true },
    ],
    ...extra,
  }
}

function lista(extra: Record<string, unknown> = {}, templates = [plantilla()]) {
  return { has_account: true, entitled: true, can_manage: true, templates, ...extra }
}

function pintar(rpc: Record<string, (args: Record<string, unknown>) => unknown>) {
  const fake = createFakeSupabase({ session: makeSession(), rpc })
  holder.client = fake
  const add = vi.fn(async () => true)
  const openCart = vi.fn()
  const cart = { add, openCart } as unknown as CartApi
  renderWithProviders(
    <CartContext.Provider value={cart}>
      <MyScheduledOrdersSection storeSlug="tienda-a" storeId={STORE_A} />
    </CartContext.Provider>,
    { session: fake.state.session },
  )
  return { fake, add, openCart }
}

beforeEach(() => {
  holder.client = null
})

describe('los pedidos programados del comprador', () => {
  it('enseña nombre, frecuencia, estado y líneas, y marca lo que ya no se vende', async () => {
    pintar({
      my_order_schedules: () =>
        lista({}, [
          plantilla({
            items: [
              { product_id: JABON, variant_id: null, slug: 'jabon', name: 'Jabón', variant_name: null, quantity: 10, available: false },
            ],
          }),
        ]),
    })

    expect(await screen.findByText('Reposición semanal')).toBeInTheDocument()
    expect(screen.getByText(/Cada 7 días/)).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Jabón')).toBeInTheDocument()
    expect(screen.getByText('Ya no está disponible: no entrará al carrito.')).toBeInTheDocument()
  })

  it('la propuesta vencida pasa al carrito, sin crear un pedido', async () => {
    const user = userEvent.setup()
    const { fake, add, openCart } = pintar({
      my_order_schedules: () => lista({}, [plantilla({ pending_run: { id: RUN, run_on: '2026-09-14', status: 'ready' } })]),
      take_my_order_schedule_run: () => ({
        run_id: RUN,
        already_taken: false,
        lines: [
          { product_id: JABON, variant_id: null, quantity: 10 },
          { product_id: CHAMPU, variant_id: null, quantity: 4 },
        ],
      }),
    })

    await user.click(await screen.findByRole('button', { name: 'Pasar al carrito' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(2))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ product_id: JABON }), 10, null)
    expect(openCart).toHaveBeenCalled()
    expect(fake.state.rpcCalls.find((c) => c.name === 'take_my_order_schedule_run')?.args).toEqual({
      p_store_slug: 'tienda-a',
      p_run_id: RUN,
    })
    expect(fake.state.invocations).toEqual([])
  })

  it('un doble clic en «Pasar al carrito» es UNA llamada', async () => {
    const user = userEvent.setup()
    let resolver: (v: unknown) => void = () => {}
    const { fake } = pintar({
      my_order_schedules: () => lista({}, [plantilla({ pending_run: { id: RUN, run_on: '2026-09-14', status: 'ready' } })]),
      take_my_order_schedule_run: () => new Promise((r) => (resolver = r)),
    })

    await user.dblClick(await screen.findByRole('button', { name: 'Pasar al carrito' }))
    resolver({ run_id: RUN, already_taken: false, lines: [] })

    await waitFor(() =>
      expect(fake.state.rpcCalls.filter((c) => c.name === 'take_my_order_schedule_run')).toHaveLength(1),
    )
  })

  it('pausar manda solo la plantilla y el estado', async () => {
    const user = userEvent.setup()
    const { fake } = pintar({
      my_order_schedules: () => lista(),
      set_my_order_schedule_status: () => plantilla({ schedule: { ...plantilla().schedule, status: 'paused' } }),
    })

    await user.click(await screen.findByRole('button', { name: 'Pausar' }))

    expect(await screen.findByText('Programación en pausa.')).toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'set_my_order_schedule_status')?.args).toEqual({
      p_store_slug: 'tienda-a',
      p_template_id: PLANTILLA,
      p_status: 'paused',
    })
  })

  it('editar no reenvía las líneas', async () => {
    const user = userEvent.setup()
    const { fake } = pintar({
      my_order_schedules: () => lista(),
      save_my_order_schedule: () => ({ ...plantilla(), replayed: false }),
    })

    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('dialog')
    const nombre = within(dialogo).getByLabelText(/Nombre/)
    await user.clear(nombre)
    await user.type(nombre, 'Quincenal')
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await screen.findByText('Programación guardada.')
    const args = fake.state.rpcCalls.find((c) => c.name === 'save_my_order_schedule')?.args as Record<string, unknown>
    expect(args).toMatchObject({ p_template_id: PLANTILLA, p_name: 'Quincenal', p_lines: null, p_request_key: null })
  })

  it('quien solo lee no ve botones', async () => {
    pintar({
      my_order_schedules: () => lista({ can_manage: false }, [plantilla({ pending_run: { id: RUN, run_on: '2026-09-14', status: 'ready' } })]),
    })

    expect(await screen.findByText('Reposición semanal')).toBeInTheDocument()
    for (const nombre of ['Pasar al carrito', 'Pausar', 'Editar', 'Eliminar', 'Pedir ahora']) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument()
    }
  })

  it('sin cuenta de empresa se explica, no se pinta vacío', async () => {
    pintar({ my_order_schedules: () => ({ has_account: false, entitled: false, can_manage: false, templates: [] }) })
    expect(await screen.findByText('Los pedidos programados son para cuentas de empresa')).toBeInTheDocument()
  })

  it('una cantidad que el carrito no admite se avisa y no se ofrece', async () => {
    pintar({
      my_order_schedules: () =>
        lista({}, [
          plantilla({
            pending_run: { id: RUN, run_on: '2026-09-14', status: 'ready' },
            items: [
              { product_id: JABON, variant_id: null, slug: 'jabon', name: 'Jabón', variant_name: null, quantity: 500, available: true },
            ],
          }),
        ]),
    })

    expect(await screen.findByText(/supera lo que admite el carrito/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pasar al carrito' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pedir ahora' })).not.toBeInTheDocument()
  })

  it('el error del servidor se traduce, no se pinta crudo', async () => {
    const user = userEvent.setup()
    pintar({
      my_order_schedules: () => lista(),
      set_my_order_schedule_status: () => {
        throw { message: 'PROGRAMACION_TERMINADA: la fecha de fin ya paso (tabla order_schedules)' }
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Pausar' }))

    expect(await screen.findByText('Esta programación ya terminó.')).toBeInTheDocument()
    expect(screen.queryByText(/order_schedules/)).not.toBeInTheDocument()
  })
})

describe('programar desde el carrito', () => {
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
        save_my_order_schedule: () => ({ ...plantilla(), replayed: false }),
      },
    })
    holder.client = fake
    renderWithProviders(<ScheduleCartButton storeSlug="tienda-a" lines={lineas} />, { session: fake.state.session })
    return { fake }
  }

  it('sin cuenta de empresa en esta tienda, el botón no aparece', async () => {
    const { fake } = pintarBoton(null)
    await waitFor(() => expect(fake.state.rpcCalls.map((c) => c.name)).toContain('my_commerce_context'))
    expect(screen.queryByRole('button', { name: 'Programar este pedido' })).not.toBeInTheDocument()
  })

  it('sin nombre no se envía; con nombre manda qué y cuánto, nunca un precio', async () => {
    const user = userEvent.setup()
    const { fake } = pintarBoton(CONTEXTO_EMPRESA)

    await user.click(await screen.findByRole('button', { name: 'Programar este pedido' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Programar' }))
    expect(await within(dialogo).findByText('Escribe un nombre de hasta 120 caracteres.')).toBeInTheDocument()
    expect(fake.state.rpcCalls.map((c) => c.name)).not.toContain('save_my_order_schedule')

    await user.type(within(dialogo).getByLabelText(/Nombre/), 'Semanal')
    await user.click(within(dialogo).getByRole('button', { name: 'Programar' }))

    await waitFor(() => expect(fake.state.rpcCalls.map((c) => c.name)).toContain('save_my_order_schedule'))
    const args = fake.state.rpcCalls.find((c) => c.name === 'save_my_order_schedule')?.args as Record<string, unknown>
    expect(args).toMatchObject({
      p_store_slug: 'tienda-a',
      p_template_id: null,
      p_name: 'Semanal',
      p_lines: [{ product_id: JABON, quantity: 3 }],
      p_interval_days: 7,
      p_next_run_on: isoDateFromToday(1),
      p_ends_on: null,
    })
    expect(String(args.p_request_key)).toMatch(/^sol-/)
    expect(JSON.stringify(args)).not.toMatch(/price/)
  })
})

describe('reglas puras', () => {
  it('la primera fecha no puede ser anterior al mínimo y el fin no antes del inicio', () => {
    const base = { name: 'X', intervalDays: 7, nextRunOn: '2026-09-15', endsOn: null, today: '2026-09-15' }
    expect(scheduleFormError(base)).toBeNull()
    expect(scheduleFormError({ ...base, name: '  ' })).toBe('name')
    expect(scheduleFormError({ ...base, intervalDays: 0 })).toBe('interval')
    expect(scheduleFormError({ ...base, nextRunOn: '2026-09-14' })).toBe('nextRunOn')
    expect(scheduleFormError({ ...base, endsOn: '2026-09-10' })).toBe('endsOn')
  })

  it('fecha local desplazada, sin saltos por zona horaria', () => {
    expect(isoDateFromToday(1, new Date(2026, 11, 31, 23, 30))).toBe('2027-01-01')
  })

  it('un código desconocido cae en el mensaje genérico', () => {
    expect(mapScheduleCode('ALGO_RARO')).toBe('account.schedules.error.generic')
    expect(mapScheduleCode('FUERA_DE_SURTIDO')).toBe('account.schedules.error.lines')
  })
})
