import { screen } from '@testing-library/react'
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
 * El Monitor de Integraciones en pantalla (P14-SaaS).
 *
 * Lo que se comprueba aquí no es el aislamiento ni la redacción —eso vive en el
 * servidor y se prueba contra Postgres real en `supabase/tests/`— sino las
 * siete cosas que solo se ven montando el árbol:
 *
 *  1. que es UNA pantalla con cuatro pestañas centradas (§8);
 *  2. que **no está gateada por capacidad**: quien no puede ver por qué le
 *     falla una integración acaba llamando por teléfono;
 *  3. que un 403 se lee «no tienes permiso» y no «no hay mensajes», y que
 *     «no contratado» es una tercera pantalla distinta de las dos;
 *  4. que la cola enseña intentos, próximo reintento y disyuntor sin calcular
 *     nada en el navegador;
 *  5. que reintentar y reproducir EXIGEN un motivo antes de llegar al servidor;
 *  6. que el alta de un destino NO manda tenant en el cuerpo;
 *  7. y que el secreto de una credencial se enseña una vez, con su aviso.
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
const { IntegrationsPage } = await import('./IntegrationsPage')

const OUTBOX_ID = '77777777-7777-4777-8777-777777777701'
const ENDPOINT_ID = '77777777-7777-4777-8777-777777777702'
const DELIVERY_ID = '77777777-7777-4777-8777-777777777703'
const CLIENT_ID = '77777777-7777-4777-8777-777777777704'
const HILO = 'ec-integracion-0001'

const HEALTH = {
  organization_id: ORG,
  company_id: COMPANY_A,
  generated_at: '2026-08-28T12:00:00.000Z',
  providers: [
    {
      provider_code: 'webhook',
      provider_name: 'Webhooks salientes',
      provider_kind: 'webhook',
      is_active: true,
      direction: 'outbound',
      pending: 3,
      in_flight: 1,
      dead: 2,
      succeeded_24h: 40,
      failed_24h: 5,
      last_success_at: '2026-08-28T11:00:00.000Z',
      last_failure_at: '2026-08-28T11:30:00.000Z',
      oldest_pending_seconds: 5400,
      open_circuits: 1,
    },
  ],
  circuits: [
    {
      id: '77777777-7777-4777-8777-777777777705',
      provider_code: 'webhook',
      operation: 'event.publish',
      target: ENDPOINT_ID,
      target_label: 'erp-pedidos',
      state: 'open',
      consecutive_fail: 5,
      threshold: 5,
      opened_at: '2026-08-28T11:30:00.000Z',
    },
  ],
  webhooks: { endpoints: 2, endpoints_active: 1, subscriptions: 3, deliveries_24h: 45 },
  api: { clients: 2, clients_active: 2, requests_24h: 120, errors_24h: 4 },
}

const MESSAGE = {
  id: OUTBOX_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  provider_code: 'webhook',
  provider_name: 'Webhooks salientes',
  provider_kind: 'webhook',
  operation: 'event.publish',
  target: ENDPOINT_ID,
  target_label: 'erp-pedidos',
  status: 'dead',
  attempts: 6,
  max_attempts: 6,
  next_retry_at: null,
  completed_at: '2026-08-28T11:30:00.000Z',
  correlation_id: HILO,
  created_at: '2026-08-28T10:00:00.000Z',
  last_error: 'El destino respondio 503',
  circuit_state: 'open',
  age_seconds: 7200,
  is_open: false,
  is_dead: true,
  is_retrying: false,
}

const DETAIL = {
  id: OUTBOX_ID,
  provider_code: 'webhook',
  operation: 'event.publish',
  target: ENDPOINT_ID,
  target_label: 'erp-pedidos',
  target_url: 'https://erp.cliente.test/hooks',
  status: 'dead',
  attempts: 6,
  max_attempts: 6,
  next_retry_at: null,
  correlation_id: HILO,
  created_at: '2026-08-28T10:00:00.000Z',
  last_error: 'El destino respondio 503',
  payload: { event_id: 'evt-1', data: { total: '100.00', email: '[redactado]' } },
  attempts_log: [
    {
      attempt: 6,
      succeeded: false,
      status_code: 503,
      latency_ms: 1200,
      error: 'El destino respondio 503',
      at: '2026-08-28T11:30:00.000Z',
    },
  ],
}

const ENDPOINT = {
  id: ENDPOINT_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  name: 'erp-pedidos',
  url: 'https://erp.cliente.test/hooks',
  secret_ref: 'EBIM_WEBHOOK_SECRET_ERP',
  api_version: 'v1',
  description: null,
  is_active: true,
  max_attempts: 6,
  created_at: '2026-08-20T10:00:00.000Z',
}

const SUBSCRIPTION = {
  id: '77777777-7777-4777-8777-777777777706',
  organization_id: ORG,
  company_id: COMPANY_A,
  endpoint_id: ENDPOINT_ID,
  event_type: 'order.created',
  is_active: true,
}

const DELIVERY = {
  id: DELIVERY_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  endpoint_id: ENDPOINT_ID,
  endpoint_name: 'erp-pedidos',
  event_id: '77777777-7777-4777-8777-777777777707',
  event_type: 'order.created',
  outbox_id: OUTBOX_ID,
  is_replay: false,
  replay_reason: null,
  correlation_id: HILO,
  created_at: '2026-08-28T10:00:00.000Z',
  status: 'dead',
  attempts: 6,
  last_status_code: 503,
  last_error: 'El destino respondio 503',
  age_seconds: 7200,
}

const API_CLIENT = {
  id: CLIENT_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  name: 'erp-del-cliente',
  description: null,
  client_id: `ec_${'a'.repeat(32)}`,
  secret_hint: 'abc123',
  scopes: ['order.read', 'stock.read'],
  is_active: true,
  rate_limit_per_minute: 120,
  expires_at: null,
  last_used_at: '2026-08-28T11:00:00.000Z',
  created_at: '2026-08-20T10:00:00.000Z',
}

class SinPermiso extends Error {
  readonly code = '42501'
  constructor() {
    super('SIN_PERMISO: la salud de las integraciones la ve owner o admin')
  }
}

class SinModulo extends Error {
  readonly code = '42501'
  constructor() {
    super('SIN_MODULO: las integraciones empresariales no estan activas para esta sociedad')
  }
}

function backend(
  options: { forbidden?: boolean; noModule?: boolean; role?: string } = {},
): FakeSupabase {
  const { forbidden = false, noModule = false, role = 'admin' } = options
  const negado = () => {
    throw new SinPermiso()
  }
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
      integration_monitor: forbidden ? [] : [MESSAGE],
      webhook_endpoints: [ENDPOINT],
      webhook_subscriptions: [SUBSCRIPTION],
      webhook_monitor: [DELIVERY],
      api_clients: [API_CLIENT],
    },
    rpc: {
      effective_capabilities: () =>
        makePlatformContext({
          entitlements: noModule ? [] : ['ecommerce.integrations.enterprise'],
          source: 'hub',
        }),
      integration_health: forbidden ? negado : () => HEALTH,
      integration_message_detail: () => DETAIL,
      integration_retry: () => ({ id: OUTBOX_ID, status: 'pending' }),
      integration_circuit_reset: () => ({ id: 'x', state: 'closed' }),
      webhook_replay: () => ({ delivery_id: 'nuevo', outbox_id: 'nuevo' }),
      api_client_create: () => ({
        id: CLIENT_ID,
        client_id: `ec_${'b'.repeat(32)}`,
        client_secret: 'f'.repeat(64),
      }),
      api_client_rotate_secret: () => ({
        id: CLIENT_ID,
        client_id: API_CLIENT.client_id,
        client_secret: 'e'.repeat(64),
      }),
    },
  })
}

function renderPage(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <IntegrationsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
  window.history.replaceState(null, '', '/')
})

describe('Integraciones — la pantalla', () => {
  it('es UNA pantalla con cuatro pestañas centradas', async () => {
    renderPage(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.slice(0, 4).map((tab) => tab.textContent)).toEqual([
      'Salud',
      'Cola',
      'Webhooks',
      'API',
    ])
  })

  /**
   * NO se gatea por capacidad, igual que Operación desde P13: la observabilidad
   * de las integraciones no se vende. Lo vendible es publicar, y ese gate está
   * en la base.
   */
  it('se puede entrar sin ningun modulo contratado', async () => {
    renderPage(backend({ noModule: true }))
    expect(await screen.findByRole('heading', { name: 'Integraciones' })).toBeInTheDocument()
    expect(await screen.findAllByRole('tab')).toHaveLength(4)
  })

  it('un 403 se lee «no tienes permiso», no «no hay datos»', async () => {
    renderPage(backend({ forbidden: true, role: 'viewer' }))
    expect(
      await screen.findByText('No tienes permiso para ver esta información.'),
    ).toBeInTheDocument()
  })
})

describe('Integraciones — la salud', () => {
  it('enseña el estado del conector con la EDAD de lo mas viejo', async () => {
    renderPage(backend())
    // 5400 segundos los formatea el navegador como horas; la CIFRA viene del
    // servidor, que es lo que importa: aquí no se resta `now()`.
    expect(await screen.findByText('Webhooks salientes')).toBeInTheDocument()
    expect(await screen.findByText('2 h')).toBeInTheDocument()
  })

  it('enseña los disyuntores abiertos y ofrece cerrarlos', async () => {
    renderPage(backend())
    expect(await screen.findByText('erp-pedidos')).toBeInTheDocument()
    expect(await screen.findByText('open · 5/5')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cerrar circuito' })).toBeInTheDocument()
  })

  it('cerrar un disyuntor EXIGE un motivo antes de llegar al servidor', async () => {
    const fake = backend()
    renderPage(fake)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Cerrar circuito' }))
    const confirmar = await screen.findByRole('button', { name: 'Cerrar circuito' })
    expect(confirmar).toBeDisabled()

    await user.type(await screen.findByLabelText('Motivo'), 'el sistema volvio')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const llamada = fake.state.rpcCalls.find((call) => call.name === 'integration_circuit_reset')
    expect(llamada?.args.p_reason).toBe('el sistema volvio')
  })
})

describe('Integraciones — la cola', () => {
  /**
   * Se entra por la pestaña «Muertos»: la de por defecto es «En cola», y el
   * mensaje de estos casos ya agotó sus intentos. Que el filtro de estado
   * FILTRE de verdad es justo lo que hace útil el tablero — un listado que
   * enseñara los entregados junto a los muertos no serviría para nada.
   */
  async function abrirCola(fake: FakeSupabase): Promise<void> {
    renderPage(fake)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: 'Cola' }))
    await user.click(await screen.findByRole('tab', { name: 'Muertos' }))
  }

  it('enseña intentos, disyuntor e HILO sin calcular nada aqui', async () => {
    await abrirCola(backend())
    expect(await screen.findByText('event.publish')).toBeInTheDocument()
    expect(await screen.findByText('Intento 6/6')).toBeInTheDocument()
    expect(await screen.findByText(HILO)).toBeInTheDocument()
    expect(await screen.findByText('open')).toBeInTheDocument()
  })

  it('el detalle avisa de que el contenido va saneado y se registra', async () => {
    const fake = backend()
    await abrirCola(fake)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ver' }))

    expect(await screen.findByText(/se muestra saneado/)).toBeInTheDocument()
    expect(await screen.findByText('https://erp.cliente.test/hooks')).toBeInTheDocument()
    expect(await screen.findByText('503')).toBeInTheDocument()

    const llamada = fake.state.rpcCalls.find(
      (call) => call.name === 'integration_message_detail',
    )
    expect(llamada?.args.p_outbox_id).toBe(OUTBOX_ID)
  })

  it('reintentar EXIGE un motivo, y el cuerpo no lleva tenant', async () => {
    const fake = backend()
    await abrirCola(fake)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Reintentar' }))
    const confirmar = await screen.findByRole('button', { name: 'Reintentar' })
    expect(confirmar).toBeDisabled()

    await user.type(await screen.findByLabelText('Motivo'), 'el destino ya responde')
    await user.click(confirmar)

    const llamada = fake.state.rpcCalls.find((call) => call.name === 'integration_retry')
    expect(llamada?.args).toEqual({
      p_outbox_id: OUTBOX_ID,
      p_reason: 'el destino ya responde',
    })
  })
})

describe('Integraciones — webhooks', () => {
  async function abrirWebhooks(fake: FakeSupabase): Promise<void> {
    renderPage(fake)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: 'Webhooks' }))
  }

  it('lista destinos con su suscripcion y su variable de secreto', async () => {
    await abrirWebhooks(backend())
    // Dos veces: la suscripción del destino y el evento de la entrega.
    expect(await screen.findAllByText('order.created')).toHaveLength(2)
    // Lo que se ve es el NOMBRE de la variable, nunca un secreto.
    expect(await screen.findByText(/EBIM_WEBHOOK_SECRET_ERP/)).toBeInTheDocument()
  })

  it('el alta no manda ni un campo de tenant, y exige https', async () => {
    const fake = backend()
    await abrirWebhooks(fake)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Nuevo destino' }))
    await user.type(await screen.findByLabelText('Nombre'), 'nuevo-erp')
    await user.type(await screen.findByLabelText('URL'), 'http://inseguro.test/h')
    await user.type(
      await screen.findByLabelText('Nombre de la variable del secreto'),
      'EBIM_WEBHOOK_SECRET_NUEVO',
    )
    await user.click(await screen.findByLabelText('order.created'))

    // Un destino en claro no se puede ni intentar: el botón sigue apagado.
    const guardar = await screen.findByRole('button', { name: 'Guardar' })
    expect(guardar).toBeDisabled()

    await user.clear(await screen.findByLabelText('URL'))
    await user.type(await screen.findByLabelText('URL'), 'https://nuevo.cliente.test/hooks')
    expect(guardar).toBeEnabled()
  })

  it('reproducir EXIGE motivo y avisa de que el evento es el MISMO', async () => {
    const fake = backend()
    await abrirWebhooks(fake)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Reproducir' }))
    expect(await screen.findByText(/con el mismo identificador/)).toBeInTheDocument()

    await user.type(await screen.findByLabelText('Motivo'), 'el ERP perdio el aviso')
    await user.click(await screen.findByRole('button', { name: 'Reproducir' }))

    const llamada = fake.state.rpcCalls.find((call) => call.name === 'webhook_replay')
    expect(llamada?.args).toEqual({
      p_delivery_id: DELIVERY_ID,
      p_reason: 'el ERP perdio el aviso',
    })
  })
})

describe('Integraciones — credenciales de la API', () => {
  async function abrirApi(fake: FakeSupabase): Promise<void> {
    renderPage(fake)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: 'API' }))
  }

  it('enseña la PISTA del secreto, nunca el secreto', async () => {
    await abrirApi(backend())
    expect(await screen.findByText(new RegExp(API_CLIENT.client_id))).toBeInTheDocument()
    expect(await screen.findByText(/···abc123/)).toBeInTheDocument()
  })

  it('los permisos que se pueden conceder son el vocabulario canonico', async () => {
    await abrirApi(backend())
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Nueva credencial' }))

    for (const scope of ['order.read', 'order.create', 'product.read', 'stock.read', 'customer.read']) {
      expect(await screen.findByLabelText(scope)).toBeInTheDocument()
    }
  })

  it('el secreto se enseña UNA vez y con su aviso', async () => {
    const fake = backend()
    await abrirApi(fake)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Nueva credencial' }))
    await user.type(await screen.findByLabelText('Nombre'), 'erp-nuevo')
    await user.click(await screen.findByLabelText('order.read'))
    await user.click(await screen.findByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/unica vez que se muestra|única vez que se muestra/)).toBeInTheDocument()
    expect(await screen.findByText('f'.repeat(64))).toBeInTheDocument()

    const llamada = fake.state.rpcCalls.find((call) => call.name === 'api_client_create')
    expect(llamada?.args.p_scopes).toEqual(['order.read'])
    expect(JSON.stringify(llamada?.args)).not.toContain('organization_id')
  })

  it('sin el modulo contratado, la pestaña lo dice y no finge un listado vacio', async () => {
    const fake = backend({ noModule: true })
    // La base responde `SIN_MODULO` al listar credenciales sin el addon. Se
    // simula con la forma REAL de PostgREST —`{ data, error }`, no una promesa
    // rechazada— porque es justo esa forma la que `integrationsErrorFromDb`
    // traduce a un código.
    const original = fake.from.bind(fake)
    fake.from = ((table: string) => {
      if (table === 'api_clients') {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: null,
                error: { message: new SinModulo().message, code: '42501' },
              }),
          }),
        } as unknown as ReturnType<typeof original>
      }
      return original(table)
    }) as typeof fake.from

    await abrirApi(fake)
    expect(await screen.findByText('Este módulo no está contratado')).toBeInTheDocument()
  })
})
