import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, USER, createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import { parseAiResult } from '@/features/ai/result'
import { ACCIONES_OPS, CONFIG_OPS, SENALES_OPS } from '../../../../supabase/functions/_shared/aiOperations'
import {
  ACCIONES_INTEGRACION,
  CONFIG_INTEGRACIONES,
  SENALES_INTEGRACION,
} from '../../../../supabase/functions/_shared/aiIntegrations'
import { CLASES_ERROR } from '../../../../supabase/functions/_shared/aiTechnical'
import { OPS_AI_ACTIONS, OPS_AI_SIGNALS, OPS_AI_TABS, opsAi } from '@/features/ops/ai/opsAi'
import {
  INTEGRATION_AI_ACTIONS,
  INTEGRATION_AI_SIGNALS,
  INTEGRATION_AI_TABS,
  INTEGRATION_ERROR_CLASSES,
  integrationsAi,
} from '@/features/integrations/ai/integrationsAi'

/**
 * Asistente técnico de Operaciones e Integraciones en el CLIENTE (fase 10).
 *
 *  · Abrir la pestaña NO gasta cuota: solo el CÁLCULO DEL SISTEMA (salud,
 *    incidentes y errores agrupados por regla).
 *  · La INTERPRETACIÓN IA va aparte, bajo demanda, con cifras de la base.
 *  · Las acciones solo navegan: ningún botón reintenta, reproduce, cierra un
 *    disyuntor, resuelve un incidente ni ejecuta nada.
 *  · Rol sin la funcionalidad (viewer/orders): nada se pinta ni se pide.
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
const { OpsAiSection } = await import('@/features/ops/ai/OpsAiSection')
const { IntegrationsAiSection } = await import('@/features/integrations/ai/IntegrationsAiSection')

const EV = '22222222-2222-4222-8222-222222222221'
const M1 = '33333333-3333-4333-8333-333333333331'
const INTERACTION = '88888888-8888-4888-8888-888888888888'
const GEN = '2026-09-22T10:00:00Z'

const OPS_COMPANY = {
  generated_at: GEN,
  scope: 'company',
  metrics: {
    open_critical: { kind: 'count', value: 2 },
    new_24h: { kind: 'count', value: 8 },
    G1_open: { kind: 'count', value: 2 },
    G1_new_24h: { kind: 'count', value: 6 },
  },
  entities: { G1: { kind: 'incident_group', label: 'integration_failed · ERP_RECHAZO' } },
  signals: [
    { code: 'spike', severity: 'high', ref: 'G1' },
    { code: 'dead_letter', severity: 'high', ref: null },
  ],
  highlights: ['open_critical', 'new_24h'],
  items: [{ ref: 'G1', id: EV, label: 'integration_failed · ERP_RECHAZO', severity: 'high', signals: ['spike'] }],
  rows: [
    {
      ref: 'G1',
      group: 'groups',
      label: 'integration_failed · ERP_RECHAZO',
      status: 'critical',
      metrics: ['G1_open', 'G1_new_24h'],
      note: 'SAP 401 Authorization: [redactado:credencial]',
    },
  ],
}

const OPS_INCIDENT = {
  generated_at: GEN,
  scope: 'incident',
  metrics: { I1_age_minutes: { kind: 'count', value: 90 }, T1_minutes_from_incident: { kind: 'count', value: 4 } },
  entities: { I1: { kind: 'incident', label: 'integration_failed · ERP_RECHAZO' }, T1: { kind: 'trace_step', label: 'integrations · integration_outbox' } },
  signals: [{ code: 'critical_open', severity: 'high', ref: 'I1' }],
  highlights: ['I1_age_minutes'],
  items: [],
  rows: [{ ref: 'T1', group: 'trace', label: 'integrations · integration_outbox', status: 'dead', metrics: ['T1_minutes_from_incident'], note: 'sap · order.create' }],
}

const INT_COMPANY = {
  generated_at: GEN,
  scope: 'company',
  metrics: { dead: { kind: 'count', value: 2 }, G1_messages: { kind: 'count', value: 2 } },
  entities: {
    G1: { kind: 'error_group', label: 'SAP S/4HANA · order.create' },
    H1: { kind: 'http_status', label: 'HTTP 401' },
  },
  signals: [
    { code: 'auth_failure', severity: 'high', ref: 'G1' },
    { code: 'dead_messages', severity: 'high', ref: 'G1' },
  ],
  highlights: ['dead'],
  items: [{ ref: 'G1', id: M1, label: 'SAP S/4HANA · order.create', severity: 'high', signals: ['auth_failure', 'dead_messages'] }],
  rows: [{ ref: 'G1', group: 'errors', label: 'SAP S/4HANA · order.create', status: 'auth', metrics: ['G1_messages'], note: 'HTTP 401 · 401 Unauthorized' }],
}

function explainBody(system: Record<string, unknown>, data: Record<string, unknown>) {
  return {
    data: { generated_at: GEN, metrics: system.metrics, entities: system.entities, overview: '', findings: [], actions: [], answer: '', discarded: 0, ...data },
    motivo: null,
    interaction_id: INTERACTION,
    system,
  }
}

function entitlement(over: Record<string, unknown> = {}) {
  return {
    enabled: true, status: 'active', plan: 'active', period: '202609', used: 10, quota: 500, remaining: 490,
    features: { operations: true, integrations: true },
    ...over,
  }
}

type Handler = (body: Record<string, unknown>) => unknown

function backend(options: { role?: string; entitlement?: Record<string, unknown>; ops?: Handler; integrations?: Handler }): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement) },
    functions: {
      'operations-assistant':
        options.ops ??
        ((body) => {
          const system = body.event_id ? OPS_INCIDENT : OPS_COMPANY
          if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system }
          return explainBody(system, {
            overview: 'El grupo {{G1}} concentra {{G1_new_24h}} incidentes nuevos.',
            findings: [{ signal: 'spike', severity: 'high', ref: 'G1', text: 'Pico en {{G1}}.' }],
            actions: [{ kind: 'trace_incident', ref: 'G1', target_id: EV, tab: 'rastro', text: 'Rastrear el hilo del incidente más reciente.' }],
          })
        }),
      'integrations-assistant':
        options.integrations ??
        ((body) => {
          if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: INT_COMPANY }
          return explainBody(INT_COMPANY, {
            overview: 'El conector {{G1}} recibe {{H1}}: el destino rechaza la credencial.',
            actions: [{ kind: 'check_endpoint', ref: null, target_id: null, tab: 'webhooks', text: 'Verificar la configuración del endpoint.' }],
          })
        }),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [{ organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'admin', status: 'active' }],
      stores: [{ id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa-nordica', name: 'Casa Nórdica', status: 'active', currency: 'PEN' }],
    },
  })
}

function render(ui: React.ReactNode, options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>{ui}</CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client }
}

const calls = (client: FakeSupabase, name: string) => client.state.invocations.filter((i) => i.name === name).map((i) => i.body)

/** Ningún control que toque una integración o un incidente. */
const WRITE_WORDS = /reintentar$|reproducir|cerrar (el )?disyuntor|resolver|atender|desactivar|rotar|ejecutar|reiniciar/i

beforeEach(() => {
  holder.client = null
  window.location.hash = ''
})

describe('copias de las listas cerradas', () => {
  it('señales, acciones, pestañas y clases son las del servidor', () => {
    expect([...OPS_AI_SIGNALS]).toEqual([...SENALES_OPS])
    expect([...OPS_AI_ACTIONS]).toEqual([...ACCIONES_OPS])
    expect([...INTEGRATION_AI_SIGNALS]).toEqual([...SENALES_INTEGRACION])
    expect([...INTEGRATION_AI_ACTIONS]).toEqual([...ACCIONES_INTEGRACION])
    expect([...INTEGRATION_ERROR_CLASSES]).toEqual([...CLASES_ERROR])
    const tabs = (config: { pestanaDeAccion: Record<string, string | null> }) =>
      [...new Set(Object.values(config.pestanaDeAccion).filter((x): x is string => x !== null))].sort()
    expect(tabs(CONFIG_OPS)).toEqual([...OPS_AI_TABS].sort())
    expect(tabs(CONFIG_INTEGRACIONES)).toEqual([...INTEGRATION_AI_TABS].sort())
  })

  it('una acción que reintenta o cierra un disyuntor no existe: ⇒ esquema', () => {
    for (const [client, system] of [
      [opsAi, OPS_COMPANY],
      [integrationsAi, INT_COMPANY],
    ] as const) {
      expect(parseAiResult(client.schemas.insight, explainBody(system, { overview: 'x' })).data).not.toBeNull()
      for (const kind of ['retry_message', 'reset_circuit', 'resolve_incident', 'run_command']) {
        const body = explainBody(system, { actions: [{ kind, ref: null, target_id: null, tab: null, text: 'x' }] })
        expect(parseAiResult(client.schemas.insight, body)).toMatchObject({ data: null, motivo: 'esquema' })
      }
    }
  })
})

describe('Operaciones — pestaña «Análisis IA»', () => {
  it('al abrir solo pide el cálculo del sistema; el error llega saneado', async () => {
    const { client } = render(<OpsAiSection />, {})
    expect(await screen.findByText('Pico de incidentes')).toBeInTheDocument()
    expect(screen.getByText('Cola muerta')).toBeInTheDocument()
    expect(screen.getAllByText('integration_failed · ERP_RECHAZO').length).toBeGreaterThan(0)
    expect(screen.getByText(/\[redactado:credencial\]/)).toBeInTheDocument()
    expect(calls(client, 'operations-assistant')).toEqual([{ mode: 'signals' }])
  })

  it('interpretar: cifras de la base, acción que solo cambia de pestaña, ningún botón que intervenga', async () => {
    const user = userEvent.setup()
    const { client } = render(<OpsAiSection />, {})
    await user.click(await screen.findByRole('button', { name: 'Resume las incidencias' }))
    expect(
      await screen.findByText((_, el) => el?.tagName === 'P' && /^El grupo integration_failed · ERP_RECHAZO concentra 6 incidentes nuevos\.$/.test(el.textContent ?? '')),
    ).toBeInTheDocument()
    expect(calls(client, 'operations-assistant').at(-1)).toEqual({ mode: 'explain' })
    for (const button of screen.getAllByRole('button')) expect(button.textContent ?? '').not.toMatch(WRITE_WORDS)
    // Con fila del sistema, la acción abre ESA fila (id del servidor), no escribe nada.
    await user.click(screen.getByRole('button', { name: 'Rastrear el hilo · integration_failed · ERP_RECHAZO' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(calls(client, 'operations-assistant')).toContainEqual({ mode: 'signals', event_id: EV })
  })

  it('«Analizar» un grupo abre el incidente más reciente con su hilo', async () => {
    const user = userEvent.setup()
    const { client } = render(<OpsAiSection />, {})
    await user.click(await screen.findByRole('button', { name: 'Analizar' }))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('Hilo del incidente')).toBeInTheDocument()
    expect(calls(client, 'operations-assistant')).toContainEqual({ mode: 'signals', event_id: EV })
  })

  it('viewer y orders: nada se pinta ni se pide', async () => {
    for (const role of ['viewer', 'orders']) {
      const { client } = render(<OpsAiSection />, { role })
      await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
      expect(screen.queryByText('Asistente técnico de operaciones')).toBeNull()
      expect(calls(client, 'operations-assistant')).toEqual([])
    }
  })

  it('no contratado: aviso sin botones que gasten; el cálculo del sistema sigue', async () => {
    const { client } = render(<OpsAiSection />, { entitlement: { features: { operations: false } } })
    expect(await screen.findByText('Pico de incidentes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume las incidencias' })).toBeNull()
    expect(calls(client, 'operations-assistant').every((b) => b.mode === 'signals')).toBe(true)
  })
})

describe('Integraciones — pestaña «Análisis IA»', () => {
  it('errores agrupados con su código HTTP; interpretar sin tocar la integración', async () => {
    const user = userEvent.setup()
    const { client } = render(<IntegrationsAiSection />, {})
    expect(await screen.findByText('Credencial o firma rechazada')).toBeInTheDocument()
    expect(screen.getByText('HTTP 401 · 401 Unauthorized')).toBeInTheDocument()
    expect(calls(client, 'integrations-assistant')).toEqual([{ mode: 'signals' }])

    await user.click(screen.getByRole('button', { name: 'Explica los errores agrupados' }))
    expect(
      await screen.findByText((_, el) => el?.tagName === 'P' && /^El conector SAP S\/4HANA · order\.create recibe HTTP 401/.test(el.textContent ?? '')),
    ).toBeInTheDocument()
    expect(calls(client, 'integrations-assistant').at(-1)).toEqual({ mode: 'explain', question: expect.any(String) })
    await user.click(screen.getByRole('button', { name: 'Verificar el endpoint' }))
    expect(window.location.hash).toBe('#webhooks')
    for (const button of screen.getAllByRole('button')) expect(button.textContent ?? '').not.toMatch(WRITE_WORDS)
  })

  it('error de red al interpretar: aviso con reintento del análisis (no del mensaje)', async () => {
    const user = userEvent.setup()
    render(<IntegrationsAiSection />, {
      integrations: (body) => {
        if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: INT_COMPANY }
        throw new Error('red')
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Resume el estado de las integraciones' }))
    expect(await screen.findByText(/No se pudo contactar con el asistente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('viewer: nada se pinta ni se pide', async () => {
    const { client } = render(<IntegrationsAiSection />, { role: 'viewer' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Asistente técnico de integraciones')).toBeNull()
    expect(calls(client, 'integrations-assistant')).toEqual([])
  })
})
