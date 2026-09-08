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
 * La operación en pantalla (P13-SaaS).
 *
 * Lo que se comprueba aquí no es la salud —eso vive en el servidor y se prueba
 * contra Postgres real en `supabase/tests/observability.test.ts`— sino las seis
 * cosas que solo se ven montando el árbol:
 *
 *  1. que es UNA pantalla con cuatro pestañas centradas (§8);
 *  2. que **no está gateada por capacidad**: quien no puede ver por qué le
 *     fallan los cobros acaba llamando por teléfono;
 *  3. que un 403 se lee «no tienes permiso» y no «no hay datos», que es lo que
 *     le haría creer a un `viewer` que su tienda está sana;
 *  4. que la edad y las repeticiones vienen ya calculadas del servidor;
 *  5. que atender un incidente EXIGE un motivo antes de llegar al servidor;
 *  6. y que del incidente se salta al RASTRO con su hilo, que es el camino que
 *     la Definition of Done describe.
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
const { OperationsPage } = await import('./OperationsPage')

const INCIDENT_ID = '88888888-8888-4888-8888-888888888801'
const HILO = 'ec-incidente-0001'

const HEALTH = {
  organization_id: ORG,
  company_id: COMPANY_A,
  generated_at: '2026-08-28T12:00:00.000Z',
  queues: {
    domain_events: { pending: 3, in_flight: 0, dead: 1, oldest_pending_seconds: 900 },
    integration_outbox: { pending: 0, in_flight: 0, failed: 2, dead: 1, oldest_pending_seconds: null },
    integration_inbox: { unprocessed: 0, oldest_pending_seconds: null },
  },
  last_24h: {
    checkouts_failed: 2,
    checkouts_total: 8,
    payments_failed: 1,
    integrations_failed: 3,
  },
  stuck_checkouts: 1,
  open_incidents: { critical: 1, error: 2 },
  slow_operations: { count: 4, max_ms: 2400 },
  platform_context: { source: 'hub', app_active: true, synced_at: '2026-08-28T09:00:00.000Z' },
}

const INCIDENT = {
  id: INCIDENT_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  store_id: STORE_A,
  kind: 'checkout_failed',
  severity: 'error',
  code: 'STOCK_INSUFICIENTE',
  message: 'no quedaban unidades',
  source: 'db',
  operation: 'checkout',
  duration_ms: null,
  entity_type: 'checkout_intent',
  entity_id: '88888888-8888-4888-8888-888888888802',
  correlation_id: HILO,
  request_id: null,
  context: { stage: 'reserve_inventory' },
  occurred_at: '2026-08-28T11:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
  resolution_note: null,
  is_open: true,
  age_seconds: 3600,
  repeats: 3,
}

const AUDIT = {
  id: '88888888-8888-4888-8888-888888888803',
  organization_id: ORG,
  company_id: COMPANY_A,
  occurred_at: '2026-08-28T10:00:00.000Z',
  actor_email: 'ana@negocio.com',
  actor_kind: 'user',
  actor_role: 'admin',
  action: 'feature_flag.updated',
  entity_type: 'feature_flag',
  entity_id: '88888888-8888-4888-8888-888888888804',
  entity_label: 'payments',
  correlation_id: HILO,
  cross_tenant: false,
}

const TRAZA = [
  {
    occurred_at: '2026-08-28T10:59:00.000Z',
    domain: 'checkout',
    entity_type: 'checkout_intent',
    entity_id: '88888888-8888-4888-8888-888888888802',
    summary: 'etapa reserve_inventory',
    status: 'failed',
    severity: 'error',
  },
  {
    occurred_at: '2026-08-28T11:00:00.000Z',
    domain: 'ops',
    entity_type: 'ops_event',
    entity_id: INCIDENT_ID,
    summary: 'checkout_failed · STOCK_INSUFICIENTE',
    status: 'open',
    severity: 'error',
  },
]

class SinPermiso extends Error {
  readonly code = '42501'
  constructor() {
    super('SIN_PERMISO: la salud operativa la ve owner o admin')
  }
}

function backend(options: { forbidden?: boolean; role?: string } = {}): FakeSupabase {
  const { forbidden = false, role = 'admin' } = options
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
      // La RLS es la que decide de verdad; el listado vacío del `viewer` se
      // simula devolviendo el 403 de `ops_health` y filas para el admin.
      ops_incident_overview: forbidden ? [] : [INCIDENT],
      audit_log: forbidden ? [] : [AUDIT],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements: [], source: 'hub' }),
      ops_health: forbidden ? negado : () => HEALTH,
      ops_resolve_event: () => ({ id: INCIDENT_ID, resolved_at: '2026-08-28T12:30:00.000Z' }),
      trace_by_correlation: () => TRAZA,
    },
  })
}

function renderOps(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <OperationsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
  window.history.replaceState(null, '', '/')
})

describe('Operación — la pantalla', () => {
  it('es UNA pantalla con cuatro pestañas centradas', async () => {
    renderOps(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.slice(0, 4).map((tab) => tab.textContent)).toEqual([
      'Salud',
      'Incidentes',
      'Rastro',
      'Auditoría',
    ])
  })

  it('NO está gateada por capacidad: un tenant sin nada contratado entra igual', async () => {
    // `effective_capabilities` devuelve la lista vacía y aun así la pantalla se
    // monta. Es la misma decisión que Ajustes y Diagnóstico llevan desde P02.
    renderOps(backend())
    expect(await screen.findByRole('tab', { name: 'Salud' })).toBeInTheDocument()
    expect(screen.queryByText(/no está incluido|no está en tu plan/i)).not.toBeInTheDocument()
  })
})

describe('Salud', () => {
  it('enseña la profundidad de cola y la EDAD de lo más viejo', async () => {
    renderOps(backend())
    expect(await screen.findByText('Hechos por publicar')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('más antiguo: 15 min')).toBeInTheDocument()
  })

  it('una cola sin nada esperando dice «sin datos», no «hace 0 segundos»', async () => {
    renderOps(backend())
    const tarjetas = await screen.findAllByText(/más antiguo: sin datos/)
    expect(tarjetas.length).toBeGreaterThanOrEqual(1)
  })

  it('el porcentaje de compras fallidas sale solo cuando hay denominador', async () => {
    renderOps(backend())
    expect(await screen.findByText('Compras fallidas: 2 (25 %)')).toBeInTheDocument()
  })

  it('un 403 se lee «no tienes permiso» y NO «no hay datos»', async () => {
    renderOps(backend({ forbidden: true, role: 'viewer' }))
    expect(await screen.findByText('No tienes permiso para ver esta información.')).toBeInTheDocument()
  })
})

describe('Incidentes', () => {
  it('un solo buscador general y pestañas de estado', async () => {
    window.history.replaceState(null, '', '#incidentes')
    renderOps(backend())
    const buscadores = await screen.findAllByPlaceholderText(
      'Busca por código, operación o identificador de rastro',
    )
    expect(buscadores).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Abiertos' })).toBeInTheDocument()
  })

  it('enseña el código, el mensaje ya redactado y las repeticiones', async () => {
    window.history.replaceState(null, '', '#incidentes')
    renderOps(backend())
    const fila = (await screen.findByText('STOCK_INSUFICIENTE')).closest('tr')
    const celdas = within(fila as HTMLElement)
    expect(celdas.getByText('no quedaban unidades')).toBeInTheDocument()
    expect(celdas.getByText('×3')).toBeInTheDocument()
  })

  it('atender EXIGE un motivo antes de llegar al servidor', async () => {
    window.history.replaceState(null, '', '#incidentes')
    const fake = backend()
    renderOps(fake)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Atender' }))
    const dialogo = await screen.findByRole('dialog')
    const confirmar = within(dialogo).getByRole('button', { name: 'Atender' })
    expect(confirmar).toBeDisabled()

    await user.type(within(dialogo).getByLabelText('Qué se hizo'), 'reintentado a mano')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const llamada = fake.state.rpcCalls.find((c) => c.name === 'ops_resolve_event')
    expect(llamada?.args).toEqual({ p_event_id: INCIDENT_ID, p_note: 'reintentado a mano' })
  })

  it('del incidente se salta al RASTRO con su hilo ya puesto', async () => {
    window.history.replaceState(null, '', '#incidentes')
    renderOps(backend())
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Rastrear' }))

    // La pestaña cambia y la caja llega con el identificador dentro: es el
    // camino que describe la Definition of Done —se ve que algo falló y se
    // reconstruye qué pasó antes y después—.
    const caja = await screen.findByPlaceholderText('Pega un identificador de rastro')
    expect(caja).toHaveValue(HILO)
  })
})

describe('Rastro', () => {
  it('sin identificador no consulta nada', async () => {
    window.history.replaceState(null, '', '#rastro')
    const fake = backend()
    renderOps(fake)
    expect(await screen.findByText('Escribe un identificador de rastro')).toBeInTheDocument()
    expect(fake.state.rpcCalls.some((c) => c.name === 'trace_by_correlation')).toBe(false)
  })

  it('con un identificador enseña la línea de tiempo con su dominio', async () => {
    window.history.replaceState(null, '', '#rastro')
    renderOps(backend())
    const user = userEvent.setup()

    await user.type(
      await screen.findByPlaceholderText('Pega un identificador de rastro'),
      HILO,
    )
    expect(await screen.findByText('checkout')).toBeInTheDocument()
    expect(screen.getByText('etapa reserve_inventory')).toBeInTheDocument()
    expect(screen.getByText('checkout_failed · STOCK_INSUFICIENTE')).toBeInTheDocument()
  })
})

describe('Auditoría', () => {
  it('enseña actor, acción y entidad, y no ofrece editar nada', async () => {
    window.history.replaceState(null, '', '#auditoria')
    renderOps(backend())
    const fila = (await screen.findByText('feature_flag.updated')).closest('tr')
    const celdas = within(fila as HTMLElement)
    expect(celdas.getByText('ana@negocio.com')).toBeInTheDocument()
    expect(celdas.getByText('payments')).toBeInTheDocument()
    // No hay botón de editar ni de borrar: no existe la operación que
    // invocarían. `audit_log` rechaza UPDATE y DELETE con un trigger.
    expect(screen.queryByRole('button', { name: /editar|borrar|eliminar/i })).not.toBeInTheDocument()
  })
})
