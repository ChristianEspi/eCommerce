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
import { PESTANA_DE_REVISION, REVISIONES, SENALES_INVENTARIO } from '../../../../supabase/functions/_shared/aiInventory'
import {
  INVENTORY_AI_REVIEWS,
  INVENTORY_AI_REVIEW_TAB,
  INVENTORY_AI_SIGNALS,
  inventoryInsightSchema,
  inventorySystemSchema,
} from './inventoryAi'

/**
 * IA de inventario en el CLIENTE (fase 05).
 *
 *  · Abrir la pestaña NO gasta cuota: solo se pide el CÁLCULO DEL SISTEMA.
 *  · La INTERPRETACIÓN IA va aparte, bajo demanda, con cifras de la base.
 *  · Ningún botón ajusta existencias ni propone cantidades: la revisión cambia
 *    de pestaña.
 *  · Estados: rol sin permiso (oculto), no contratado, sin cuota, error de red.
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
const { InventoryAiSection } = await import('./InventoryAiSection')

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const INTERACTION = '88888888-8888-4888-8888-888888888888'

const CONTEXT = {
  generated_at: '2026-09-21T12:00:00Z',
  metrics: {
    cover_risk_days: { kind: 'days', value: 14 },
    I1_available: { kind: 'quantity', value: '5.00' },
    I1_cover_days: { kind: 'days', value: 5 },
    I1_sold_30d: { kind: 'quantity', value: '30.00' },
    I2_available: { kind: 'quantity', value: '500.00' },
  },
  entities: {
    I1: { kind: 'product', label: 'Jabón de glicerina' },
    I2: { kind: 'product', label: 'Champú' },
  },
}

const SYSTEM = {
  ...CONTEXT,
  total_tracked: 12,
  items: [
    {
      ref: 'I1', product_id: P1, variant_id: null, name: 'Jabón de glicerina', sku: 'JAB-01', severity: 'high',
      signals: ['stockout_risk', 'below_reorder'], system_review: { kind: 'review_replenishment', tab: 'existencias' },
    },
    {
      ref: 'I2', product_id: P2, variant_id: null, name: 'Champú', sku: 'CHAMP', severity: 'low',
      signals: ['excess'], system_review: { kind: 'review_excess', tab: 'existencias' },
    },
  ],
}

function insightBody(over: Record<string, unknown> = {}) {
  return {
    data: {
      ...CONTEXT,
      overview: 'Hay que mirar primero {{I1}}.',
      answer: '',
      items: [
        {
          ref: 'I1', product_id: P1, variant_id: null, name: 'Jabón de glicerina', sku: 'JAB-01', severity: 'high',
          signals: ['stockout_risk', 'below_reorder'],
          explanation: 'Cubre {{I1_cover_days}}, menos que {{cover_risk_days}}.',
          suggested_review: { kind: 'review_movement', tab: 'movimientos' },
          overridden: false,
        },
      ],
      discarded: 0,
      ...over,
    },
    motivo: null,
    interaction_id: INTERACTION,
    system: SYSTEM,
  }
}

function entitlement(over: Record<string, unknown> = {}) {
  return {
    enabled: true, status: 'active', plan: 'active', period: '202609', used: 10, quota: 500, remaining: 490,
    features: { inventory: true },
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
      'inventory-assistant':
        options.assistant ??
        ((body) => (body.mode === 'signals' ? { data: null, motivo: null, interaction_id: null, system: SYSTEM } : insightBody())),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'viewer', status: 'active' },
      ],
      stores: [
        { id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa-nordica', name: 'Casa Nórdica', status: 'active', currency: 'PEN' },
      ],
    },
  })
}

function renderSection(options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <InventoryAiSection />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client }
}

const calls = (client: FakeSupabase) =>
  client.state.invocations.filter((i) => i.name === 'inventory-assistant').map((i) => i.body)

beforeEach(() => {
  holder.client = null
  window.location.hash = ''
})

describe('copias de las listas cerradas', () => {
  it('señales, revisiones y pestañas son las del servidor', () => {
    expect([...INVENTORY_AI_SIGNALS]).toEqual([...SENALES_INVENTARIO])
    expect([...INVENTORY_AI_REVIEWS]).toEqual([...REVISIONES])
    expect(INVENTORY_AI_REVIEW_TAB).toEqual(PESTANA_DE_REVISION)
  })
})

describe('contrato: lo que no cumple no se pinta', () => {
  it('una revisión que escribe (crear compra) ⇒ esquema', () => {
    const body = insightBody({
      items: [{ ...insightBody().data.items[0], suggested_review: { kind: 'create_purchase_order', tab: 'existencias' } }],
    })
    expect(parseAiResult(inventoryInsightSchema, body)).toMatchObject({ data: null, motivo: 'esquema' })
  })

  it('un bloque del sistema con una señal inventada no se acepta', () => {
    const roto = { ...SYSTEM, items: [{ ...SYSTEM.items[0], signals: ['comprar_ya'] }] }
    expect(inventorySystemSchema.safeParse(roto).success).toBe(false)
    expect(inventorySystemSchema.safeParse(SYSTEM).success).toBe(true)
  })
})

describe('Análisis IA de inventario', () => {
  it('al abrir solo pide el cálculo del sistema (sin cuota) y enseña señales y cifras de la base', async () => {
    const { client } = renderSection({})
    expect(await screen.findByText('Riesgo de quiebre')).toBeInTheDocument()
    expect(screen.getByText('Bajo punto de pedido')).toBeInTheDocument()
    expect(screen.getByText('Exceso de stock')).toBeInTheDocument()
    expect(screen.getByText('5 días')).toBeInTheDocument()
    expect(screen.getByText('Cálculo del sistema')).toBeInTheDocument()
    expect(screen.getByText('Interpretación IA')).toBeInTheDocument()
    expect(calls(client)).toEqual([{ mode: 'signals', store_id: STORE_A, locale: 'es' }])
  })

  it('«Analiza el inventario» pide la interpretación; cifras sustituidas; la revisión cambia de pestaña', async () => {
    const { client } = renderSection({})
    await screen.findByText('Riesgo de quiebre')
    await userEvent.click(screen.getByRole('button', { name: 'Analiza el inventario' }))

    expect(await screen.findByText('Panorama')).toBeInTheDocument()
    expect(calls(client)[1]).toEqual({ mode: 'analyze', store_id: STORE_A, locale: 'es' })
    const lista = screen.getByRole('list', { name: 'Productos a revisar' })
    expect(within(lista).getByText('5 días')).toBeInTheDocument()
    expect(within(lista).getByText('14 días')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()

    // Ningún botón que ajuste, reserve o compre.
    for (const b of screen.queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/ajustar|comprar|reponer ahora|guardar|transferir/i)
    }
    await userEvent.click(within(lista).getByRole('button', { name: 'Revisar movimientos' }))
    expect(window.location.hash).toBe('#movimientos')
  })

  it('una pregunta sugerida viaja como `question`', async () => {
    const { client } = renderSection({})
    await screen.findByText('Riesgo de quiebre')
    await userEvent.click(screen.getByRole('button', { name: '¿Qué productos corren riesgo de quiebre?' }))
    await screen.findByText('Panorama')
    expect(calls(client)[1]).toEqual({
      mode: 'analyze', store_id: STORE_A, locale: 'es', question: '¿Qué productos corren riesgo de quiebre?',
    })
  })

  it('rol sin la funcionalidad (sales_rep): no se pinta ni se pide nada', async () => {
    const { client } = renderSection({ role: 'sales_rep' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Análisis de inventario con IA')).not.toBeInTheDocument()
    expect(calls(client)).toEqual([])
  })

  it('no contratado: aviso y sin botones que gasten; el cálculo del sistema sigue', async () => {
    renderSection({ entitlement: { features: { inventory: false } } })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(await screen.findByText('Riesgo de quiebre')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Analiza el inventario' })).not.toBeInTheDocument()
  })

  it('sin cuota: aviso y sin botones que gasten', async () => {
    renderSection({ entitlement: { status: 'quota_exceeded', used: 500, remaining: 0 } })
    expect(await screen.findByText('Se acabaron las consultas de IA de este periodo.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Analiza el inventario' })).not.toBeInTheDocument()
  })

  it('error de red: aviso con reintento; el cálculo del sistema sigue a la vista', async () => {
    renderSection({
      assistant: (body) => {
        if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: SYSTEM }
        throw new Error('red')
      },
    })
    await screen.findByText('Riesgo de quiebre')
    await userEvent.click(screen.getByRole('button', { name: 'Analiza el inventario' }))
    const alerta = await screen.findByText('No se pudo contactar con el asistente. El cálculo del sistema sigue disponible.')
    expect(within(alerta.closest('[role="alert"]') as HTMLElement).getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('Riesgo de quiebre')).toBeInTheDocument()
  })

  it('sin señales del sistema no se ofrece gastar una consulta', async () => {
    renderSection({
      assistant: () => ({ data: null, motivo: null, interaction_id: null, system: { ...SYSTEM, items: [] } }),
    })
    expect(await screen.findByText('El sistema no detecta productos con riesgo, exceso ni movimientos atípicos.')).toBeInTheDocument()
    expect(screen.getByText('Sin señales del sistema no hay nada que interpretar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Analiza el inventario' })).not.toBeInTheDocument()
  })
})
