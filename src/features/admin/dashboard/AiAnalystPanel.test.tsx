import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import {
  ANALYST_MODULES,
  ANALYST_ROUTES,
  SUGGESTED_ACTIONS,
  SUGGESTED_QUESTIONS,
  formatMetric,
  plainAnalystText,
  summarySchema,
  type AnalystContext,
} from './aiAnalyst'
import {
  ACCIONES_SUGERIDAS,
  MODULOS_ANALISTA,
  PREGUNTAS_SUGERIDAS,
  RUTA_DE_MODULO,
} from '../../../../supabase/functions/_shared/aiInsights'

/**
 * Analista IA del dashboard en el CLIENTE (fase 02).
 *
 *  · Las cifras se pintan desde `metrics` (la base), nunca del texto del modelo.
 *  · Nada se pide al abrir la pantalla: cada análisis gasta cuota.
 *  · Estados: deshabilitada, sin cuota, cargando, error de red, motivo tipado.
 *  · Los KPIs deterministas no dependen del analista.
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
const { DashboardPage } = await import('../DashboardPage')

const INTERACTION = '22222222-2222-4222-8222-222222222222'

const CONTEXT: AnalystContext = {
  generated_at: '2026-09-21T12:00:00Z',
  metrics: {
    'sales.gross_delta_pct': { kind: 'percent', value: '55.0' },
    'sales.gross_current': { kind: 'money', value: '310.00', currency: 'PEN' },
    'orders.unpaid_over_3d': { kind: 'count', value: 7 },
    'O1.age_days': { kind: 'days', value: 25 },
  },
  entities: {
    O1: { kind: 'order', label: 'A-OLD-5', detail: 'unpaid', module: 'orders', route: '/app/orders' },
  },
}

function summaryBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ...CONTEXT,
      insights: [
        {
          title: 'Pedidos sin pagar acumulados',
          explanation: 'Hay {{orders.unpaid_over_3d}} pedidos sin pago; el más antiguo es {{O1}}.',
          severity: 'high',
          module: 'orders',
          route: '/app/orders',
          entity_ref: 'O1',
          suggested_action: 'follow_up_payment',
          action_label: 'Revisar pedidos pendientes de pago',
          evidence: ['orders.unpaid_over_3d'],
        },
        {
          title: 'Ventas en alza',
          explanation: 'Las ventas variaron {{sales.gross_delta_pct}} frente a la semana anterior.',
          severity: 'low',
          module: 'sales',
          route: '/app/analytics',
          entity_ref: null,
          suggested_action: 'review_sales',
          action_label: 'Mirar la analítica',
          evidence: ['sales.gross_delta_pct'],
        },
      ],
      ...overrides,
    },
    motivo: null,
    interaction_id: INTERACTION,
  }
}

function kpis() {
  return {
    products: 11,
    published: 9,
    orders: 8,
    sales: '6334.24',
    currency: 'PEN',
    avg_ticket: '791.78',
    by_status: [{ status: 'pending', count: 5 }],
    top_products: [],
  }
}

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    status: 'active',
    plan: 'active',
    period: '202609',
    used: 10,
    quota: 500,
    remaining: 490,
    features: { insights: true },
    ...overrides,
  }
}

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  insights?: (body: Record<string, unknown>) => unknown
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      dashboard_kpis: () => kpis(),
      dashboard_recent_orders: () => [],
      ai_entitlement: () => entitlement(options.entitlement),
    },
    functions: options.insights ? { 'dashboard-insights': options.insights } : {},
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        {
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: USER,
          role: options.role ?? 'owner',
          status: 'active',
        },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'casa-nordica',
          name: 'Casa Nórdica',
          status: 'active',
          currency: 'PEN',
        },
      ],
    },
  })
}

function render(options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <DashboardPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return client
}

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('módulos, rutas, acciones y preguntas son las del servidor', () => {
    expect([...ANALYST_MODULES]).toEqual([...MODULOS_ANALISTA])
    expect(ANALYST_ROUTES).toEqual(RUTA_DE_MODULO)
    expect([...SUGGESTED_ACTIONS]).toEqual([...ACCIONES_SUGERIDAS])
    expect([...SUGGESTED_QUESTIONS]).toEqual([...PREGUNTAS_SUGERIDAS])
  })
})

describe('las cifras salen de la base', () => {
  const labels = { days: '{n} días' }

  it('sustituye marcadores por el valor formateado y la entidad por su etiqueta', () => {
    const text = plainAnalystText(
      'Ventas {{sales.gross_delta_pct}} ({{sales.gross_current}}); {{O1}} lleva {{O1.age_days}}.',
      CONTEXT,
      'es',
      labels,
    )
    expect(text).toMatch(/^Ventas \+55 % \(.*310[.,]00.*\); A-OLD-5 lleva 25 días\.$/)
  })

  it('un marcador desconocido se pinta como guion, nunca como cifra', () => {
    expect(plainAnalystText('Margen {{sales.margin}}', CONTEXT, 'es', labels)).toBe('Margen —')
  })

  it('porcentaje negativo con signo y dinero sin moneda como guion', () => {
    expect(formatMetric({ kind: 'percent', value: '-12.5' }, 'en', labels)).toBe('−12.5 %')
    expect(formatMetric({ kind: 'money', value: '10.00' }, 'es', labels)).toBe('—')
  })

  it('una respuesta con ruta fuera de la lista cerrada no se pinta', () => {
    const body = summaryBody()
    const insights = body.data.insights as Array<Record<string, unknown>>
    insights[0]!.route = '/app/settings'
    expect(parseAiResult(summarySchema, body)).toMatchObject({ data: null, motivo: 'esquema' })
  })
})

describe('Resumen inteligente', () => {
  it('no gasta cuota al abrir: pide el resumen solo al pulsar', async () => {
    const insights = vi.fn(() => summaryBody())
    render({ insights })

    const boton = await screen.findByRole('button', { name: 'Generar resumen' })
    expect(insights).not.toHaveBeenCalled()

    await userEvent.click(boton)
    expect(await screen.findByText('Pedidos sin pagar acumulados')).toBeInTheDocument()
    expect(insights).toHaveBeenCalledTimes(1)
    expect(insights.mock.calls[0]).toEqual([{ mode: 'summary', store_id: STORE_A, locale: 'es' }])

    // Cifras de la base, entidad, severidad descrita con texto y pulgar.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('+55 %')).toBeInTheDocument()
    expect(screen.getByText('Pedido: A-OLD-5')).toBeInTheDocument()
    expect(screen.getByText('Prioridad alta')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()
  })

  it('la acción sugerida es un enlace al módulo, no una ejecución', async () => {
    render({ insights: () => summaryBody() })
    await userEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }))
    const card = (await screen.findByText('Pedidos sin pagar acumulados')).closest('article')!
    expect(within(card as HTMLElement).getByText(/Revisar pedidos pendientes de pago/)).toBeInTheDocument()
    // Sin botones de aprobar/cancelar/cobrar: solo navegación (si el módulo está contratado).
    for (const b of within(card as HTMLElement).queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/aprobar|cancelar|cobrar/i)
    }
  })

  it('sin cuota: motivo tipado y sin botón de reintentar', async () => {
    render({ insights: () => ({ data: null, motivo: 'sin_cuota', interaction_id: null }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }))
    expect(await screen.findByText('Se acabaron las consultas de IA de este periodo.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })

  it('tiempo agotado: ofrece reintentar y reintenta', async () => {
    const insights = vi
      .fn()
      .mockReturnValueOnce({ data: null, motivo: 'timeout', interaction_id: null })
      .mockReturnValueOnce(summaryBody())
    render({ insights })
    await userEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Pedidos sin pagar acumulados')).toBeInTheDocument()
    expect(insights).toHaveBeenCalledTimes(2)
  })

  it('error de red: aviso con reintento y los KPIs siguen en pantalla', async () => {
    render({
      insights: () => {
        throw new Error('red caída')
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }))
    expect(await screen.findByText(/No pudimos contactar con el Analista IA/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(screen.getByText(/6[.,]334[.,]24/)).toBeInTheDocument()
  })

  it('IA no configurada en el servidor: aviso informativo', async () => {
    render({ insights: () => ({ data: null, motivo: 'sin_proveedor', interaction_id: null }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }))
    expect(await screen.findByText('La IA no está configurada en esta instalación.')).toBeInTheDocument()
  })

  it('no contratada: aviso y ningún botón que gaste', async () => {
    const insights = vi.fn(() => summaryBody())
    render({ entitlement: { features: { insights: false } }, insights })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generar resumen' })).not.toBeInTheDocument()
    expect(insights).not.toHaveBeenCalled()
  })

  it('cuota agotada antes de pedir: aviso y sin botón', async () => {
    render({ entitlement: { status: 'quota_exceeded', remaining: 0, used: 500 }, insights: () => summaryBody() })
    expect(await screen.findByText('Se acabaron las consultas de IA de este periodo.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generar resumen' })).not.toBeInTheDocument()
  })

  it('un rol sin la funcionalidad (viewer) no ve el panel', async () => {
    render({ role: 'viewer', insights: () => summaryBody() })
    expect(await screen.findByText(/6[.,]334[.,]24/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Resumen inteligente')).not.toBeInTheDocument())
  })
})

describe('Preguntar sobre estos datos', () => {
  it('una pregunta sugerida se envía y la respuesta pinta cifras de la base', async () => {
    const insights = vi.fn((body: Record<string, unknown>) =>
      body.mode === 'ask'
        ? {
            data: {
              ...CONTEXT,
              answerable: true,
              answer: 'Las ventas variaron {{sales.gross_delta_pct}}.',
              module: 'sales',
              route: '/app/analytics',
              evidence: ['sales.gross_delta_pct'],
            },
            motivo: null,
            interaction_id: INTERACTION,
          }
        : summaryBody(),
    )
    render({ insights })
    await userEvent.click(await screen.findByRole('button', { name: '¿Por qué cambiaron las ventas?' }))
    expect(await screen.findByText('+55 %')).toBeInTheDocument()
    expect(insights).toHaveBeenCalledWith({
      mode: 'ask',
      store_id: STORE_A,
      locale: 'es',
      question: '¿Por qué cambiaron las ventas?',
    })
  })

  it('una pregunta escrita demasiado larga no se envía', async () => {
    const insights = vi.fn(() => summaryBody())
    render({ insights })
    const campo = await screen.findByLabelText('Tu pregunta')
    await userEvent.click(campo)
    await userEvent.paste('x'.repeat(301))
    expect(screen.getByText('Máximo 300 caracteres.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preguntar' })).toBeDisabled()
    expect(insights).not.toHaveBeenCalled()
  })

  it('respuesta bloqueada por cifras sin respaldo: motivo y reintento', async () => {
    render({ insights: () => ({ data: null, motivo: 'bloqueada', interaction_id: null }) })
    await userEvent.click(await screen.findByRole('button', { name: '¿Qué debería revisar hoy?' }))
    expect(
      await screen.findByText('La respuesta no pasó las reglas de seguridad y se descartó.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
