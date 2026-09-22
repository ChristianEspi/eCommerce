import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, USER, createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import { parseAiResult } from '@/features/ai/result'
import { AI_FEATURES } from '../../../../supabase/functions/_shared/aiCore'
import {
  COPILOT_ENTITY_KINDS as SERVER_ENTITY_KINDS,
  COPILOT_ENTITY_TYPES as SERVER_ENTITY_TYPES,
  COPILOT_LINK_MODULES as SERVER_LINK_MODULES,
  COPILOT_SCREENS as SERVER_SCREENS,
  COPILOT_TOOLS as SERVER_TOOLS,
  COPILOT_TOOL_IDS as SERVER_TOOL_IDS,
  ESTADOS_HERRAMIENTA,
  MAX_HISTORIAL,
  MAX_PREGUNTA,
} from '../../../../supabase/functions/_shared/aiCopilot'
import {
  COPILOT_ENTITY_KINDS,
  COPILOT_ENTITY_TYPES,
  COPILOT_LINK_MODULES,
  COPILOT_MAX_HISTORY,
  COPILOT_MAX_QUESTION,
  COPILOT_SCREENS,
  COPILOT_TOOL_CAPABILITY,
  COPILOT_TOOL_FEATURE,
  COPILOT_TOOL_IDS,
  COPILOT_TOOL_STATUSES,
  copilotAnswerSchema,
  historyForRequest,
  linkTarget,
  screenFromPath,
  suggestionsFor,
} from './copilot'
import { useCopilotEntity } from './copilot-context'

/**
 * EBIM Copilot en el CLIENTE (fase 11).
 *
 *  · Las listas son las del servidor (herramientas, pantallas, estados).
 *  · Nada se pide al abrir el panel; cada pregunta es una llamada.
 *  · Sugerencias solo de herramientas que el rol puede usar.
 *  · Contexto: pantalla y entidad abierta (tipo + id), nunca el tenant.
 *  · Cifras desde `metrics`, enlaces solo a pantallas de lista cerrada.
 *  · Estados: sin contratar, sin cuota, motivo tipado, error de red, sin datos.
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
const { CopilotProvider } = await import('./CopilotProvider')
const { CopilotButton, CopilotDrawer } = await import('./CopilotDrawer')

const ORDER_ID = '66666666-6666-4666-8666-666666666666'
const INTERACTION = '77777777-7777-4777-8777-777777777777'

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    status: 'active',
    plan: 'active',
    period: '202609',
    used: 10,
    quota: 500,
    remaining: 490,
    features: { copilot: true },
    ...overrides,
  }
}

function answerBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      kind: 'answer',
      answerable: true,
      answer: 'Hay {{T1.total}} pedidos sin pagar; el más reciente es {{T1.O1}}.',
      highlights: ['El total de {{T1.O1}} es {{T1.O1.total}}.'],
      links: [{ ref: 'T1.O1', kind: 'order', label: 'A-1', module: 'orders', order_id: ORDER_ID }],
      follow_ups: ['¿Cuáles llevan más de una semana?'],
      tools: [
        { tool: 'search_orders', status: 'ok' },
        { tool: 'sales_summary', status: 'denied' },
      ],
      discarded: 0,
      metrics: {
        'T1.total': { kind: 'count', value: 3 },
        'T1.O1.total': { kind: 'money', value: '100.00', currency: 'PEN' },
      },
      entities: { 'T1.O1': { kind: 'order', label: 'A-1', module: 'orders', order_id: ORDER_ID } },
      ...overrides,
    },
    motivo: null,
    interaction_id: INTERACTION,
  }
}

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  copilot?: (body: Record<string, unknown>) => unknown
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement) },
    functions: options.copilot ? { copilot: options.copilot } : {},
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'owner', status: 'active' },
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

function OpenOrder({ id }: { id: string }) {
  useCopilotEntity('order', id)
  return null
}

function render(options: Parameters<typeof backend>[0] & { route?: string; entity?: string }) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CopilotProvider>
          <CopilotButton />
          <CopilotDrawer />
          {options.entity && <OpenOrder id={options.entity} />}
        </CopilotProvider>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession(), route: options.route ?? '/app/orders' },
  )
  return client
}

async function abrir() {
  await userEvent.click(await screen.findByRole('button', { name: 'Abrir EBIM Copilot' }))
  return screen.findByRole('dialog', { name: /EBIM Copilot/ })
}

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('herramientas, pantallas, entidades, estados y módulos son los del servidor', () => {
    expect([...COPILOT_TOOL_IDS]).toEqual([...SERVER_TOOL_IDS])
    expect([...COPILOT_SCREENS]).toEqual([...SERVER_SCREENS])
    expect([...COPILOT_ENTITY_TYPES]).toEqual([...SERVER_ENTITY_TYPES])
    expect([...COPILOT_LINK_MODULES]).toEqual([...SERVER_LINK_MODULES])
    expect([...COPILOT_ENTITY_KINDS]).toEqual([...SERVER_ENTITY_KINDS])
    expect([...COPILOT_TOOL_STATUSES]).toEqual([...ESTADOS_HERRAMIENTA])
    expect(COPILOT_MAX_QUESTION).toBe(MAX_PREGUNTA)
    expect(COPILOT_MAX_HISTORY).toBe(MAX_HISTORIAL)
    for (const tool of COPILOT_TOOL_IDS) {
      const feature = SERVER_TOOLS[tool].feature
      expect(COPILOT_TOOL_FEATURE[tool], tool).toBe(feature)
      expect(COPILOT_TOOL_CAPABILITY[tool], tool).toBe(AI_FEATURES[feature].module)
    }
  })

  it('pantalla desde la ruta', () => {
    expect(screenFromPath('/app')).toBe('dashboard')
    expect(screenFromPath('/app/orders')).toBe('orders')
    expect(screenFromPath('/app/pim?x=1')).toBe('products')
    expect(screenFromPath('/app/desconocida')).toBe('other')
    expect(screenFromPath('/s/tienda')).toBe('other')
  })

  it('enlace a un pedido por id; el resto a su módulo', () => {
    expect(linkTarget({ ref: 'T1.O1', kind: 'order', label: 'A-1', module: 'orders', order_id: ORDER_ID })).toBe(
      `/app/orders?order=${ORDER_ID}`,
    )
    expect(linkTarget({ ref: 'T1.P1', kind: 'product', label: 'X', module: 'products', order_id: null })).toBe('/app/products')
  })

  it('una respuesta con destino fuera de lista no se pinta', () => {
    const body = answerBody()
    ;(body.data.links as Array<Record<string, unknown>>)[0]!.module = 'settings'
    expect(parseAiResult(copilotAnswerSchema, body)).toMatchObject({ data: null, motivo: 'esquema' })
  })

  it('historial: últimos turnos y recortados', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, text: `p${i} ${'x'.repeat(600)}` }))
    const h = historyForRequest(turns)
    expect(h).toHaveLength(COPILOT_MAX_HISTORY)
    expect(h[0]!.text.startsWith('p4')).toBe(true)
    expect(h.every((t) => t.text.length <= 400)).toBe(true)
  })
})

describe('sugerencias según rol y pantalla', () => {
  const has = () => true

  it('sales_rep: nada de ventas ni pedidos', () => {
    const ids = suggestionsFor('dashboard', null, { role: 'sales_rep', has }).map((s) => s.id)
    expect(ids).not.toContain('sales_week')
    expect(ids).not.toContain('orders_attention')
    expect(ids).not.toContain('today')
  })

  it('en pedidos con un pedido abierto se ofrece resumirlo', () => {
    const ids = suggestionsFor('orders', { type: 'order', id: ORDER_ID }, { role: 'orders', has }).map((s) => s.id)
    expect(ids[0]).toBe('order_summary')
    expect(ids).not.toContain('sales_week')
  })

  it('sin el módulo contratado no se sugiere su herramienta', () => {
    const ids = suggestionsFor('inventory', null, { role: 'owner', has: (c) => c !== 'inventory.multiwarehouse' }).map(
      (s) => s.id,
    )
    expect(ids).not.toContain('inventory_risk')
  })
})

describe('panel', () => {
  it('no gasta nada al abrir; pregunta con contexto de pantalla y entidad, nunca el tenant', async () => {
    const copilot = vi.fn((_body: Record<string, unknown>) => answerBody())
    const client = render({ copilot, entity: ORDER_ID })
    const dialog = await abrir()
    expect(copilot).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Resume este pedido' }))
    await waitFor(() => expect(copilot).toHaveBeenCalledTimes(1))
    const body = copilot.mock.calls[0]![0] as Record<string, unknown>
    expect(body).toEqual({
      question: 'Resume este pedido',
      locale: 'es',
      store_id: STORE_A,
      context: { screen: 'orders', entity: { type: 'order', id: ORDER_ID } },
      history: [],
    })
    expect(JSON.stringify(body)).not.toContain(ORG)
    expect(JSON.stringify(body)).not.toContain(COMPANY_A)
    expect(client.state.invocations.filter((i) => i.name === 'copilot')).toHaveLength(1)
  })

  it('pinta la respuesta con cifras de la base, enlace de navegación, herramientas y pulgar', async () => {
    render({ copilot: () => answerBody() })
    const dialog = await abrir()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tu pregunta' }), '¿Qué pedidos siguen sin pagar?{Enter}')

    expect(await within(dialog).findByText('3')).toBeInTheDocument()
    const link = within(dialog).getByRole('link', { name: /Abrir: A-1/ })
    expect(link).toHaveAttribute('href', `/app/orders?order=${ORDER_ID}`)
    expect(within(dialog).getByText('Búsqueda de pedidos · consultado')).toBeInTheDocument()
    expect(within(dialog).getByText('Ventas · sin permiso')).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()
    // Solo navegación: ningún botón que ejecute nada del negocio.
    for (const b of within(dialog).queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/aprobar|cancelar|cobrar|despachar|reembolsar/i)
    }
  })

  it('la segunda pregunta manda el historial con lo que la persona leyó', async () => {
    const copilot = vi.fn((_body: Record<string, unknown>) => answerBody())
    render({ copilot })
    const dialog = await abrir()
    const input = within(dialog).getByRole('textbox', { name: 'Tu pregunta' })
    await userEvent.type(input, 'Pedidos sin pagar{Enter}')
    await within(dialog).findByText('3')
    await userEvent.click(within(dialog).getByRole('button', { name: '¿Cuáles llevan más de una semana?' }))
    await waitFor(() => expect(copilot).toHaveBeenCalledTimes(2))
    const body = copilot.mock.calls[1]![0] as { history: Array<{ role: string; text: string }> }
    expect(body.history).toEqual([
      { role: 'user', text: 'Pedidos sin pagar' },
      { role: 'assistant', text: 'Hay 3 pedidos sin pagar; el más reciente es A-1.' },
    ])
  })

  it('sin datos por permisos: explica el estado de cada herramienta', async () => {
    render({
      copilot: () =>
        answerBody({
          kind: 'no_data',
          answerable: false,
          answer: '',
          highlights: [],
          links: [],
          follow_ups: [],
          tools: [{ tool: 'sales_summary', status: 'denied' }],
          metrics: {},
          entities: {},
        }),
    })
    const dialog = await abrir()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tu pregunta' }), '¿Cuánto vendimos?{Enter}')
    expect(await within(dialog).findByText(/No encontré datos/)).toBeInTheDocument()
    expect(within(dialog).getByText('Ventas · sin permiso')).toBeInTheDocument()
  })

  it('motivo tipado (sin cuota) sin reintentar; error de red con reintento', async () => {
    let n = 0
    render({
      copilot: () => {
        n += 1
        if (n === 1) return { data: null, motivo: 'sin_cuota', interaction_id: null }
        throw new Error('red')
      },
    })
    const dialog = await abrir()
    const input = within(dialog).getByRole('textbox', { name: 'Tu pregunta' })
    await userEvent.type(input, 'Hola{Enter}')
    expect(await within(dialog).findByText('Se acabaron las consultas de IA de este periodo.')).toBeInTheDocument()
    await userEvent.type(input, 'Otra{Enter}')
    expect(await within(dialog).findByText(/No se pudo contactar con EBIM Copilot/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('no contratado: aviso y sin poder preguntar', async () => {
    const copilot = vi.fn((_body: Record<string, unknown>) => answerBody())
    render({ copilot, entitlement: { features: { copilot: false } } })
    const dialog = await abrir()
    expect(within(dialog).getByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Tu pregunta' })).toBeDisabled()
    expect(copilot).not.toHaveBeenCalled()
  })

  it('viewer: el botón existe, pero no sugiere ventas ni productos', async () => {
    render({ role: 'viewer', copilot: () => answerBody(), route: '/app' })
    const dialog = await abrir()
    const sugerencias = within(dialog).getByRole('group', { name: 'Sugerencias' })
    expect(within(sugerencias).queryByText('¿Cómo van las ventas esta semana?')).not.toBeInTheDocument()
    expect(within(sugerencias).queryByText('¿Qué debería revisar hoy?')).not.toBeInTheDocument()
    expect(within(sugerencias).getByText('¿Qué pedidos requieren atención?')).toBeInTheDocument()
  })

  it('accesible: diálogo con nombre, registro vivo y cierre con botón', async () => {
    render({ copilot: () => answerBody() })
    const dialog = await abrir()
    expect(within(dialog).getByRole('log')).toHaveAttribute('aria-live', 'polite')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar EBIM Copilot' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /EBIM Copilot/ })).not.toBeInTheDocument())
  })
})
