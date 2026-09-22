import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'
import { parseAiResult } from '@/features/ai/result'
import { MOTIVOS_TEMPORADA, SENALES_PLANIFICACION, FASES_PERIODO } from '../../../../supabase/functions/_shared/aiPlanning'
import {
  PLANNING_AI_SIGNALS,
  PLANNING_PERIOD_PHASES,
  PLANNING_SEASONAL_REASONS,
  suggestionInsightSchema,
} from './planningAi'

/**
 * IA de planificación en el CLIENTE (fase 05).
 *
 *  · La pestaña pide al abrir solo el CÁLCULO DEL SISTEMA (previsión frente a
 *    venta), sin cuota; la INTERPRETACIÓN IA, al pulsar.
 *  · En el sugerido, la cantidad que se pinta es la del MOTOR (`system`), y la
 *    IA solo pone el porqué al lado; no hay nada que guardar aquí.
 *  · `viewer` no está en la funcionalidad `planning`: no ve nada.
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
const { PlanningAiSection } = await import('./PlanningAiSection')
const { SuggestionAiExplain } = await import('./SuggestionAiExplain')

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'
const INTERACTION = '88888888-8888-4888-8888-888888888888'

const CONTEXT = {
  generated_at: '2026-09-21T12:00:00Z',
  metrics: {
    anomaly_error_pct: { kind: 'percent', value: '50' },
    P1_sold_30d: { kind: 'quantity', value: '3.00' },
    P1F1_forecast: { kind: 'quantity', value: '100.00' },
    P1F1_actual: { kind: 'quantity', value: '3.00' },
    P1F1_error_pct: { kind: 'percent', value: '-97.0' },
  },
  entities: {
    P1: { kind: 'product', label: 'Champú' },
    P1F1: { kind: 'period', label: '2026-08-12 → 2026-09-12' },
  },
}

const FORECAST_SYSTEM = {
  ...CONTEXT,
  models: ['naive_v1'],
  items: [
    {
      ref: 'P1', product_id: P1, variant_id: null, name: 'Champú', sku: 'CHAMP', has_forecast: true, severity: 'high',
      signals: ['forecast_over', 'low_confidence'], seasonal: { applied: false, reason: 'menos_de_un_anio' },
      forecasts: [{ ref: 'P1F1', model_code: 'naive_v1', phase: 'closed', anomaly: 'forecast_over' }],
    },
  ],
}

const FORECAST_INSIGHT = {
  data: {
    ...CONTEXT,
    overview: 'La previsión de {{P1}} en {{P1F1}} quedó muy por encima.',
    trend: '',
    seasonality: 'Sin un año de historia no se puede afirmar temporada.',
    forecast_vs_sales: 'Se previó {{P1F1_forecast}} y se vendió {{P1F1_actual}}.',
    anomalies: [
      { ref: 'P1', product_id: P1, name: 'Champú', signal: 'forecast_over', severity: 'high', explanation: 'Desvío de {{P1F1_error_pct}}.' },
    ],
    factors: ['La confianza declarada era baja.'],
    limitations: 'Menos de un año de ventas.',
    answer: '',
    discarded: 0,
  },
  motivo: null,
  interaction_id: INTERACTION,
  system: FORECAST_SYSTEM,
}

const SUGGESTION_CONTEXT = {
  generated_at: '2026-09-21T12:00:00Z',
  metrics: {
    L1_suggested: { kind: 'quantity', value: '8' },
    L1_recent_qty: { kind: 'quantity', value: '10' },
    L1_available: { kind: 'quantity', value: '8' },
  },
  entities: { L1: { kind: 'product', label: 'Jabón' }, L2: { kind: 'product', label: 'Vela' } },
}

const FLAGS = {
  fallback: false, blended: true, seasonal_applied: false, seasonal_reason: 'menos_de_un_anio',
  capped: true, shortage: false, atp_state: 'known',
}

const SUGGESTION_BODY = {
  data: {
    ...SUGGESTION_CONTEXT,
    overview: 'El motor propone reponer lo comprado en la ventana.',
    // El modelo NO puede cambiar la cantidad: aunque lo intentara, el front pinta la del sistema.
    lines: [{ ref: 'L1', product_id: P1, explanation: 'Compró {{L1_recent_qty}}; limitado a {{L1_available}} disponibles.' }],
    caveats: 'Revisa la disponibilidad antes de guardar.',
    discarded: 1,
  },
  motivo: null,
  interaction_id: INTERACTION,
  system: {
    ...SUGGESTION_CONTEXT,
    model_code: 'history_seasonal_v2',
    total: 2,
    lines: [
      { ref: 'L1', product_id: P1, variant_id: null, name: 'Jabón', sku: 'JAB', suggested_quantity: '8', on_hand_quantity: '8', model_code: 'history_seasonal_v2', flags: FLAGS },
      { ref: 'L2', product_id: P2, variant_id: null, name: 'Vela', sku: 'VEL', suggested_quantity: '3', on_hand_quantity: null, model_code: 'history_seasonal_v2', flags: { ...FLAGS, capped: false, atp_state: 'unknown' } },
    ],
  },
}

function entitlement(over: Record<string, unknown> = {}) {
  return {
    enabled: true, status: 'active', plan: 'active', period: '202609', used: 10, quota: 500, remaining: 490,
    features: { planning: true },
    ...over,
  }
}

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  assistant?: (body: Record<string, unknown>) => unknown
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement) },
    functions: {
      'planning-assistant':
        options.assistant ??
        ((body) => {
          if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: FORECAST_SYSTEM }
          if (body.mode === 'suggestion') return SUGGESTION_BODY
          return FORECAST_INSIGHT
        }),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'orders', status: 'active' },
      ],
      stores: [
        { id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa-nordica', name: 'Casa Nórdica', status: 'active', currency: 'PEN' },
      ],
    },
  })
}

function renderIn(node: ReactNode, options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>{node}</CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client }
}

const calls = (client: FakeSupabase) =>
  client.state.invocations.filter((i) => i.name === 'planning-assistant').map((i) => i.body)

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('señales, fases y motivos de temporada son los del servidor', () => {
    expect([...PLANNING_AI_SIGNALS]).toEqual([...SENALES_PLANIFICACION])
    expect([...PLANNING_PERIOD_PHASES]).toEqual([...FASES_PERIODO])
    expect([...PLANNING_SEASONAL_REASONS]).toEqual([...MOTIVOS_TEMPORADA])
  })

  it('un sugerido con más de veinte líneas o sin cantidad del motor no se pinta', () => {
    const muchas = { ...SUGGESTION_BODY, data: { ...SUGGESTION_BODY.data, lines: Array.from({ length: 21 }, () => SUGGESTION_BODY.data.lines[0]) } }
    expect(parseAiResult(suggestionInsightSchema, muchas).motivo).toBe('esquema')
  })
})

describe('Análisis IA de planificación', () => {
  it('al abrir solo pide el cálculo del sistema y enseña la previsión frente a la venta', async () => {
    const { client } = renderIn(<PlanningAiSection />, {})
    expect(await screen.findAllByText('Previsión por encima de la venta')).not.toHaveLength(0)
    expect(screen.getByText('Confianza baja')).toBeInTheDocument()
    expect(screen.getByText('2026-08-12 → 2026-09-12')).toBeInTheDocument()
    expect(screen.getByText('−97 %')).toBeInTheDocument()
    expect(calls(client)).toEqual([{ mode: 'signals', store_id: STORE_A, locale: 'es' }])
  })

  it('«Explica la previsión» pide la interpretación y pinta cifras de la base', async () => {
    const { client } = renderIn(<PlanningAiSection />, {})
    await screen.findByText('Confianza baja')
    await userEvent.click(screen.getByRole('button', { name: 'Explica la previsión' }))
    expect(await screen.findByText('Previsión frente a ventas')).toBeInTheDocument()
    expect(calls(client)[1]).toEqual({ mode: 'forecast', store_id: STORE_A, locale: 'es' })
    expect(screen.getByText('Factores observables en los datos')).toBeInTheDocument()
    expect(screen.getByText('Límites de estos datos')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()
  })

  it('viewer no está en la funcionalidad planning: no se pinta ni se pide nada', async () => {
    const { client } = renderIn(<PlanningAiSection />, { role: 'viewer' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Análisis de planificación con IA')).not.toBeInTheDocument()
    expect(calls(client)).toEqual([])
  })

  it('no contratado: aviso, el cálculo del sistema sigue y no hay botones que gasten', async () => {
    renderIn(<PlanningAiSection />, { entitlement: { features: { planning: false } } })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(await screen.findByText('Confianza baja')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explica la previsión' })).not.toBeInTheDocument()
  })
})

describe('Explicar el sugerido v2', () => {
  it('no pide nada al montar; al pulsar pide el modo `suggestion` y la cantidad es la del motor', async () => {
    const { client } = renderIn(<SuggestionAiExplain storeId={STORE_A} customerId={CUSTOMER} days={30} />, {})
    const boton = await screen.findByRole('button', { name: 'Explicar con IA' })
    expect(calls(client)).toEqual([])
    await userEvent.click(boton)

    expect(await screen.findByText('Cantidad del sistema')).toBeInTheDocument()
    expect(calls(client)).toEqual([{ mode: 'suggestion', store_id: STORE_A, customer_id: CUSTOMER, days: 30, locale: 'es' }])
    // Las cantidades salen del bloque del sistema, fila a fila.
    const filas = screen.getAllByRole('row')
    expect(filas[1]!.textContent).toContain('Jabón')
    expect(filas[1]!.textContent).toContain('8')
    expect(filas[1]!.textContent).toContain('Compró 10; limitado a 8 disponibles.')
    // Una línea sin explicación válida conserva su cifra del motor.
    expect(filas[2]!.textContent).toContain('Vela')
    expect(filas[2]!.textContent).toContain('3')
    expect(screen.getByText('Revisa la disponibilidad antes de guardar.')).toBeInTheDocument()
    // Nada que guarde desde aquí.
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()
  })

  it('sin la funcionalidad contratada no ofrece gastar una consulta', async () => {
    renderIn(<SuggestionAiExplain storeId={STORE_A} customerId={CUSTOMER} days={30} />, {
      entitlement: { features: { planning: false } },
    })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explicar con IA' })).not.toBeInTheDocument()
  })

  it('motivo vacía del servidor (sugerido sin líneas): aviso tipado', async () => {
    renderIn(<SuggestionAiExplain storeId={STORE_A} customerId={CUSTOMER} days={30} />, {
      assistant: () => ({ data: null, motivo: 'vacia', interaction_id: null, system: { ...SUGGESTION_BODY.system, lines: [], total: 0 } }),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Explicar con IA' }))
    expect(await screen.findByText('Con estos datos la IA no tuvo nada fiable que decir.')).toBeInTheDocument()
  })
})
