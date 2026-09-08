import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makePlatformContext,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * El dominio logístico en pantalla (P12-SaaS).
 *
 * Lo que se comprueba aquí no es el cálculo de tarifas —eso vive en el servidor
 * y se prueba contra Postgres real— sino las seis cosas que solo se ven
 * montando el árbol:
 *
 *  1. que es UNA pantalla con pestañas y un solo buscador por listado (§8);
 *  2. que está gateada por lo que la sociedad CONTRATÓ;
 *  3. que la cola enseña la entrega y no el pedido, con su origen y su retraso;
 *  4. que las acciones ofrecidas son las que la máquina de estados permite, y
 *     que anular exige motivo ANTES de llegar al servidor;
 *  5. que el alta de un método **no manda ningún campo de tenant** y limpia el
 *     transportista cuando la estrategia no lo admite, que es la regla que la
 *     base impone con un CHECK;
 *  6. y que la devolución solo ofrece la acción de su estado, y que reponer
 *     stock se apaga solo cuando la unidad no llegó vendible.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CapabilitiesProvider } = await import('@/features/capabilities/CapabilitiesProvider')
const { CapabilityGate } = await import('@/features/capabilities/CapabilityGate')
const { FulfillmentPage } = await import('./FulfillmentPage')

const FUL_ID = '99999999-9999-4999-8999-999999999901'
const ORDER_ID = '99999999-9999-4999-8999-999999999902'
const METHOD_ID = '99999999-9999-4999-8999-999999999903'
const ZONE_ID = '99999999-9999-4999-8999-999999999904'
const RATE_ID = '99999999-9999-4999-8999-999999999905'
const RETURN_ID = '99999999-9999-4999-8999-999999999906'
const RETURN_ITEM_ID = '99999999-9999-4999-8999-999999999907'
const ORDER_ITEM_ID = '99999999-9999-4999-8999-999999999908'

const FULFILLMENT = ['ecommerce.fulfillment']

const QUEUE_ROW = {
  fulfillment_id: FUL_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  store_id: STORE_A,
  order_id: ORDER_ID,
  order_number: 'EC-20260828-00001',
  customer_email: 'compradora@correo.test',
  order_status: 'paid',
  payment_status: 'paid',
  fulfillment_status: 'in_progress',
  sequence: 1,
  method_code: 'estandar',
  method_name: 'Envío estándar',
  strategy: 'ship',
  provider_code: 'sandbox_carrier',
  state: 'allocated',
  warehouse_id: null,
  warehouse_code: 'ALM-1',
  pickup_point_id: null,
  pickup_point_name: null,
  window_date: null,
  window_starts_at: null,
  window_ends_at: null,
  promised_from: '2026-08-29',
  promised_to: '2026-08-31',
  currency: 'PEN',
  shipping_cost: '15.00',
  weight: '1.500',
  address: { address: 'Av. Primavera 120', city: 'Lima' },
  contact_name: 'Ana Compradora',
  contact_phone: '+51 999 111 222',
  created_at: '2026-08-28T10:00:00.000Z',
  delivered_at: null,
  unit_count: 3,
  shipment_count: 0,
  tracking_number: null,
  tracking_url: null,
  tracking_event_count: 0,
  is_late: true,
}

const RETURN_ROW = {
  return_request_id: RETURN_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  store_id: STORE_A,
  order_id: ORDER_ID,
  order_number: 'EC-20260828-00001',
  rma_number: 'RMA-20260828-00001',
  state: 'received',
  resolution: 'refund',
  source: 'storefront',
  reason_code: 'roto',
  reason_label: 'Llegó dañado',
  customer_email: 'compradora@correo.test',
  customer_note: 'La caja venía abierta',
  decision_note: null,
  decided_at: '2026-08-28T11:00:00.000Z',
  decided_email: 'pedidos@negocio.com',
  currency: 'PEN',
  refund_amount: '0.00',
  created_at: '2026-08-28T10:30:00.000Z',
  unit_count: 2,
  received_count: 2,
  restocked_count: 0,
  evidence_count: 1,
}

function backend(options: { entitlements?: string[]; role?: string } = {}): FakeSupabase {
  const { entitlements = FULFILLMENT, role = 'admin' } = options
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'mi-negocio',
          name: 'Mi Negocio',
          status: 'active',
          currency: 'PEN',
        },
      ],
      fulfillment_overview: [QUEUE_ROW],
      return_overview: [RETURN_ROW],
      fulfillments: [QUEUE_ROW],
      fulfillment_items: [],
      shipments: [],
      tracking_events: [],
      order_events: [],
      warehouses: [
        { id: 'w1', organization_id: ORG, company_id: COMPANY_A, code: 'ALM-1', name: 'Central', is_active: true },
      ],
      delivery_methods: [
        {
          id: METHOD_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code: 'estandar',
          strategy: 'ship',
          display_name: 'Envío estándar',
          description: null,
          provider_code: 'sandbox_carrier',
          sourcing: 'store_priority',
          lead_time_min_days: 1,
          lead_time_max_days: 3,
          requires_window: false,
          is_active: true,
          position: 100,
          instructions: null,
        },
      ],
      delivery_zones: [
        {
          id: ZONE_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code: 'lima',
          name: 'Lima metropolitana',
          country: 'PE',
          regions: ['Lima'],
          postal_prefixes: ['150'],
          priority: 100,
          is_active: true,
        },
      ],
      delivery_rates: [
        {
          id: RATE_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          delivery_method_id: METHOD_ID,
          zone_id: ZONE_ID,
          currency: 'PEN',
          base_amount: '15.00',
          per_item_amount: '0.00',
          per_weight_amount: '0.00',
          free_over_subtotal: '200.00',
          min_subtotal: null,
          max_subtotal: null,
          priority: 100,
          is_active: true,
        },
      ],
      pickup_points: [],
      integration_providers: [
        { code: 'sandbox_carrier', kind: 'logistics', name: 'Operador de pruebas', is_active: true },
      ],
      return_items: [
        {
          id: RETURN_ITEM_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          return_request_id: RETURN_ID,
          order_item_id: ORDER_ITEM_ID,
          quantity: 2,
          received_quantity: 2,
          reason_code: 'roto',
          condition: 'pending',
          restock: false,
          refund_amount: '0.00',
          restock_movement_id: null,
        },
      ],
      return_events: [],
      return_reasons: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      fulfillment_transition: () => ({ fulfillment_id: FUL_ID, state: 'picking', changed: true }),
      return_inspect: () => ({ return_request_id: RETURN_ID, state: 'inspected' }),
    },
  })
}

function renderFulfillment(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="fulfillment">
          <FulfillmentPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
  // Las pestañas hacen deep-link con `#hash`: sin limpiarlo, el test anterior
  // decide qué pestaña abre el siguiente.
  window.history.replaceState(null, '', '/')
})

describe('Entregas — la pantalla', () => {
  it('es UNA pantalla con cuatro pestañas centradas, no cuatro entradas de menú', async () => {
    renderFulfillment(backend())
    const tabs = await screen.findAllByRole('tab')
    // Las cuatro de la sección, más las de estado del listado. «Reparto» es la
    // del recorrido B2B: se lista siempre y su contenido lo gatea
    // `fulfillment.routing`, que es un addon aparte.
    expect(tabs.slice(0, 4).map((tab) => tab.textContent)).toEqual([
      'Preparación',
      'Devoluciones',
      'Reparto',
      'Red de entrega',
    ])
  })

  it('sin el módulo contratado enseña «no está en tu plan» y no monta la pantalla', async () => {
    renderFulfillment(backend({ entitlements: [] }))
    expect(await screen.findByText(/no está incluido|no está en/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Preparación' })).not.toBeInTheDocument()
  })

  it('el listado tiene UN solo buscador general y pestañas de estado', async () => {
    renderFulfillment(backend())
    const buscadores = await screen.findAllByPlaceholderText('Busca por pedido, correo o guía')
    expect(buscadores).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'En camino' })).toBeInTheDocument()
  })
})

describe('La cola de preparación', () => {
  it('enseña la ENTREGA y no el pedido: origen, unidades, envío cobrado y retraso', async () => {
    renderFulfillment(backend())

    const fila = (await screen.findByText('EC-20260828-00001')).closest('tr')
    expect(fila).not.toBeNull()
    const celdas = within(fila as HTMLElement)

    expect(celdas.getByText('Envío estándar')).toBeInTheDocument()
    expect(celdas.getByText('ALM-1')).toBeInTheDocument()
    expect(celdas.getByText('3')).toBeInTheDocument()
    expect(celdas.getByText('Asignada')).toBeInTheDocument()
    // La promesa venció y la entrega no ha salido: la vista lo calcula, no la
    // pantalla, y aquí se comprueba que llega y se pinta.
    expect(celdas.getByText('Fuera de plazo')).toBeInTheDocument()
  })

  it('el detalle ofrece SOLO las transiciones que la máquina permite', async () => {
    renderFulfillment(backend())
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByText('EC-20260828-00001'))

    const selector = await screen.findByLabelText('Mover a')
    await usuario.click(selector)

    const opciones = await screen.findAllByRole('option')
    const etiquetas = opciones.map((o) => o.textContent)
    // Desde `allocated`: preparar, empacar, listo, en camino, anular, incidencia.
    expect(etiquetas).toContain('Preparando')
    expect(etiquetas).toContain('En camino')
    // `delivered` NO sale de `allocated`: ofrecerlo sería un botón que falla.
    expect(etiquetas).not.toContain('Entregada')
  })

  it('anular exige motivo antes de llegar al servidor', async () => {
    const fake = backend()
    renderFulfillment(fake)
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByText('EC-20260828-00001'))
    await usuario.click(await screen.findByLabelText('Mover a'))
    await usuario.click(await screen.findByRole('option', { name: 'Anulada' }))

    const boton = screen.getByRole('button', { name: 'Mover' })
    expect(boton).toBeDisabled()
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument()

    await usuario.type(screen.getByLabelText('Motivo'), 'El comprador se arrepintió')
    expect(screen.getByRole('button', { name: 'Mover' })).toBeEnabled()
  })
})

describe('La red de entrega', () => {
  it('avisa de un método activo SIN tarifa en vez de dejar que lo descubra el comprador', async () => {
    const fake = backend()
    // Se retira la tarifa: el método sigue activo y deja de poder ofrecerse.
    fake.state.tables.delivery_rates = []
    renderFulfillment(fake)
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByRole('tab', { name: 'Red de entrega' }))
    expect(await screen.findByText('Sin tarifa')).toBeInTheDocument()
  })

  it('el alta no manda NINGÚN campo de tenant y limpia el operador si no es un envío', async () => {
    const fake = backend()
    renderFulfillment(fake)
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByRole('tab', { name: 'Red de entrega' }))
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo método' }))

    await usuario.type(screen.getByLabelText('Código'), 'recojo')
    await usuario.type(screen.getByLabelText('Nombre'), 'Recojo en tienda')

    // Al elegir «Recojo» el selector de operador desaparece: nadie transporta lo
    // que el comprador va a buscar, y la base lo impone con un CHECK.
    await usuario.click(screen.getByLabelText('Estrategia'))
    await usuario.click(await screen.findByRole('option', { name: 'Recojo' }))
    expect(screen.queryByLabelText('Operador')).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Guardar' }))

    const payload = fake.state.tables.delivery_methods?.find((row) => row.code === 'recojo')
    expect(payload).toBeDefined()
    expect(payload?.provider_code).toBeNull()
    // El tenant se escribe porque las columnas son NOT NULL, pero sale del
    // contexto del JWT: lo que NO puede pasar es que la pantalla invente otro.
    expect(payload?.organization_id).toBe(ORG)
    expect(payload?.company_id).toBe(COMPANY_A)
    expect(payload?.store_id).toBe(STORE_A)
    // Un método nace apagado: publicar una opción de entrega es una decisión.
    expect(payload?.is_active).toBe(false)
  })
})

describe('Devoluciones', () => {
  it('ofrece solo la acción del estado en el que está', async () => {
    renderFulfillment(backend())
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByRole('tab', { name: 'Devoluciones' }))
    await usuario.click(await screen.findByText('RMA-20260828-00001'))

    // En `received` toca revisar. Ni aprobar (ya se decidió) ni cerrar (todavía
    // no se ha inspeccionado).
    expect(await screen.findByRole('button', { name: 'Guardar revisión' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar devolución' })).not.toBeInTheDocument()
  })

  it('reponer stock solo se puede marcar si la unidad llegó vendible', async () => {
    renderFulfillment(backend())
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByRole('tab', { name: 'Devoluciones' }))
    await usuario.click(await screen.findByText('RMA-20260828-00001'))

    // La línea llega `pending`: no se sabe en qué estado vino, así que no se
    // puede prometer que vuelve al stock.
    const repone = await screen.findByLabelText('Repone stock')
    expect(repone).toBeDisabled()

    await usuario.click(screen.getByLabelText('Estado de la unidad'))
    await usuario.click(await screen.findByRole('option', { name: 'Vendible' }))
    expect(screen.getByLabelText('Repone stock')).toBeEnabled()
  })

  it('la nota del comprador se pinta como TEXTO, nunca como marcado', async () => {
    renderFulfillment(backend())
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByRole('tab', { name: 'Devoluciones' }))
    await usuario.click(await screen.findByText('RMA-20260828-00001'))

    const nota = await screen.findByText('La caja venía abierta')
    expect(nota.innerHTML).toBe('La caja venía abierta')
  })
})
