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
  ACCIONES,
  FALTANTES,
  PESTANA_DE_ACCION,
  RUTA_DE_ACCION,
  SENALES,
} from '../../../../supabase/functions/_shared/aiOrders'
import {
  ORDER_AI_ACTIONS,
  ORDER_AI_ACTION_ROUTE,
  ORDER_AI_ACTION_TAB,
  ORDER_AI_MISSING,
  ORDER_AI_SIGNALS,
  describeFilters,
  orderInsightSchema,
  searchSchema,
  type OrderAiFilters,
} from './ordersAi'

/**
 * IA de pedidos en el CLIENTE (fase 04).
 *
 *  · Abrir el pedido o el listado NO gasta cuota: solo se piden las señales
 *    del sistema (sin modelo); la interpretación, al pulsar.
 *  · Las cifras salen de `metrics` (la base), nunca del texto del modelo.
 *  · La acción sugerida lleva al flujo normal (pestaña/ruta); no hay ningún
 *    botón que apruebe, cobre, despache o cancele.
 *  · Estados: rol sin permiso (oculto), no contratado, sin cuota, error de red,
 *    motivo tipado, cola del sistema como respaldo.
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
const { OrderAiPanel } = await import('./OrderAiPanel')
const { OrdersAiBar } = await import('./OrdersAiBar')

const ORDER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_ID = '77777777-7777-4777-8777-777777777777'
const INTERACTION = '88888888-8888-4888-8888-888888888888'

const CONTEXT = {
  generated_at: '2026-09-21T12:00:00Z',
  metrics: {
    grand_total: { kind: 'money', value: '250.00', currency: 'PEN' },
    age_days: { kind: 'days', value: 5 },
  },
  entities: {
    O1: { kind: 'order', label: 'PED-000123' },
    C1: { kind: 'customer', label: 'Bodega Norte' },
  },
}

const SYSTEM = {
  ...CONTEXT,
  order_id: ORDER_ID,
  diagnosis: {
    signals: [{ code: 'payment_stale', severity: 'high' }],
    missing: ['shipping_address'],
    next_action: 'follow_up_payment',
    allowed_actions: ['follow_up_payment', 'contact_customer', 'add_note', 'open_order', 'none'],
    closed: false,
  },
}

function insightBody(over: Record<string, unknown> = {}) {
  return {
    data: {
      ...CONTEXT,
      summary: 'Pedido {{O1}} de {{C1}} por {{grand_total}}.',
      status_explanation: 'Sigue pendiente porque el pago no llega desde hace {{age_days}}.',
      blockers: [{ signal: 'payment_stale', severity: 'high', explanation: 'El cobro no se ha confirmado.' }],
      missing_info: [{ field: 'shipping_address', explanation: 'No hay dirección de entrega.' }],
      next_step: { action: 'follow_up_payment', explanation: 'Revisa el cobro.', overridden: false },
      history_summary: 'Se creó desde la tienda.',
      answer: '',
      suggested_action: { kind: 'follow_up_payment', order_id: ORDER_ID, tab: 'operation', route: null },
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
    enabled: true,
    status: 'active',
    plan: 'active',
    period: '202609',
    used: 10,
    quota: 500,
    remaining: 490,
    features: { orders: true },
    ...over,
  }
}

/** Fila de `ai_orders_search` (la búsqueda determinista de los indicadores). */
const SEARCH_ROW = {
  id: OTHER_ID, order_number: 'A-APR', customer_label: 'Cliente', status: 'pending', payment_status: 'pending',
  fulfillment_status: 'unfulfilled', approval_status: 'pending', currency: 'PEN', grand_total: '10.00',
  placed_at: '2026-09-18T10:00:00Z',
}

/** Conteos por indicador, deducidos de los argumentos (como haría el SQL). */
function fakeSearch(args: Record<string, unknown>) {
  const total = args.p_attention_only
    ? 20
    : args.p_approval_status === 'pending'
      ? 1
      : args.p_fulfillment_status === 'unfulfilled'
        ? 10
        : args.p_older_than_days === 7
          ? 0
          : 0
  const limit = Number(args.p_limit ?? 25)
  return { generated_at: '2026-09-23T12:00:00Z', total, limit, rows: total > 0 ? [SEARCH_ROW].slice(0, limit) : [] }
}

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  assistant?: (body: Record<string, unknown>) => unknown
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement), ai_orders_search: fakeSearch },
    functions: {
      'orders-assistant':
        options.assistant ??
        ((body) =>
          body.mode === 'signals'
            ? { data: null, motivo: null, interaction_id: null, system: SYSTEM }
            : insightBody()),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'orders', status: 'active' },
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

function renderPanel(options: Parameters<typeof backend>[0], onNavigate = vi.fn()) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <OrderAiPanel orderId={ORDER_ID} onNavigate={onNavigate} />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client, onNavigate }
}

function renderBar(options: Parameters<typeof backend>[0], onOpenOrder = vi.fn()) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <OrdersAiBar storeId={STORE_A} onOpenOrder={onOpenOrder} />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client, onOpenOrder }
}

const assistantCalls = (client: FakeSupabase) =>
  client.state.invocations.filter((i) => i.name === 'orders-assistant').map((i) => i.body)

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('señales, faltantes, acciones, pestañas y rutas son las del servidor', () => {
    expect([...ORDER_AI_SIGNALS]).toEqual([...SENALES])
    expect([...ORDER_AI_MISSING]).toEqual([...FALTANTES])
    expect([...ORDER_AI_ACTIONS]).toEqual([...ACCIONES])
    expect(ORDER_AI_ACTION_TAB).toEqual(PESTANA_DE_ACCION)
    expect(ORDER_AI_ACTION_ROUTE).toEqual(RUTA_DE_ACCION)
  })
})

describe('contrato: lo que no cumple no se pinta', () => {
  it('una acción fuera de la lista cerrada (cancelar) ⇒ esquema', () => {
    const body = insightBody({ suggested_action: { kind: 'cancel_order', order_id: ORDER_ID, tab: 'operation', route: null } })
    expect(parseAiResult(orderInsightSchema, body)).toMatchObject({ data: null, motivo: 'esquema' })
  })

  it('una ruta fuera de la lista cerrada ⇒ esquema', () => {
    const body = insightBody({ suggested_action: { kind: 'review_fulfillment', order_id: ORDER_ID, tab: null, route: '/app/settings' } })
    expect(parseAiResult(orderInsightSchema, body)).toMatchObject({ data: null, motivo: 'esquema' })
  })

  it('búsqueda con más de 25 filas o filtro fuera de enum ⇒ esquema', () => {
    const fila = {
      id: OTHER_ID, order_number: 'A-1', customer_label: null, status: 'pending', payment_status: 'pending',
      fulfillment_status: 'unfulfilled', approval_status: 'not_required', currency: 'PEN', grand_total: '1.00', placed_at: null,
    }
    const filtros: OrderAiFilters = {
      status: null, payment_status: 'pending', fulfillment_status: null, approval_status: null, source_channel: null,
      placed_within_days: null, older_than_days: null, text: null, attention_only: false,
    }
    const ok = { data: { filters: filtros, discarded: 0, total: 1, limit: 25, rows: [fila] }, motivo: null }
    expect(parseAiResult(searchSchema, ok).data).not.toBeNull()
    const muchas = { ...ok, data: { ...ok.data, rows: Array.from({ length: 26 }, () => fila) } }
    expect(parseAiResult(searchSchema, muchas).motivo).toBe('esquema')
    const malo = { ...ok, data: { ...ok.data, filters: { ...filtros, status: 'shipped' } } }
    expect(parseAiResult(searchSchema, malo).motivo).toBe('esquema')
    expect(describeFilters(filtros)).toEqual([{ key: 'payment_status', value: 'pending' }])
  })
})

describe('Asistente IA del pedido (detalle)', () => {
  it('al abrir solo pide las señales del sistema (sin cuota) y las enseña', async () => {
    const { client } = renderPanel({})
    expect(await screen.findByText('Sin pago hace más de 3 días')).toBeInTheDocument()
    expect(screen.getByText('Dirección de entrega')).toBeInTheDocument()
    expect(assistantCalls(client)).toEqual([{ mode: 'signals', order_id: ORDER_ID, locale: 'es' }])
  })

  it('«Resume este pedido» pide la interpretación; cifras desde la base; acción = pestaña', async () => {
    const { client, onNavigate } = renderPanel({})
    await screen.findByText('Sin pago hace más de 3 días')
    await userEvent.click(screen.getByRole('button', { name: 'Resume este pedido' }))

    expect(await screen.findByText('Por qué está en este estado')).toBeInTheDocument()
    expect(assistantCalls(client)[1]).toEqual({ mode: 'order', order_id: ORDER_ID, locale: 'es' })
    // Marcadores sustituidos por el dato de la base.
    expect(screen.getByText('PED-000123')).toBeInTheDocument()
    expect(screen.getByText('Bodega Norte')).toBeInTheDocument()
    expect(screen.getByText('5 días')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()

    // Ningún botón que ejecute: solo navegar al flujo normal.
    for (const b of screen.queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/aprobar|cancelar|marcar|despachar|reembolsar/i)
    }
    const acciones = screen.getAllByRole('button', { name: 'Revisar el cobro' })
    await userEvent.click(acciones[acciones.length - 1]!)
    expect(onNavigate).toHaveBeenCalledWith('operation', ORDER_ID)
  })

  it('una pregunta sugerida viaja como `question`', async () => {
    const { client } = renderPanel({})
    await screen.findByText('Sin pago hace más de 3 días')
    await userEvent.click(screen.getByRole('button', { name: '¿Por qué este pedido aún no se entrega?' }))
    await screen.findByText('Por qué está en este estado')
    expect(assistantCalls(client)[1]).toEqual({
      mode: 'order',
      order_id: ORDER_ID,
      locale: 'es',
      question: '¿Por qué este pedido aún no se entrega?',
    })
  })

  it('rol sin la funcionalidad (sales_rep): no se pinta ni se pide nada', async () => {
    const { client } = renderPanel({ role: 'sales_rep' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Asistente IA del pedido')).not.toBeInTheDocument()
    expect(assistantCalls(client)).toEqual([])
  })

  it('no contratado: aviso, sin botones que gasten; las señales del sistema siguen', async () => {
    renderPanel({ entitlement: { features: { orders: false } } })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(await screen.findByText('Sin pago hace más de 3 días')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume este pedido' })).not.toBeInTheDocument()
  })

  it('motivo tipado del servidor (sin cuota) sin reintentar; la base sigue mandando', async () => {
    renderPanel({
      assistant: (body) =>
        body.mode === 'signals'
          ? { data: null, motivo: null, interaction_id: null, system: SYSTEM }
          : { data: null, motivo: 'sin_cuota', interaction_id: null, system: SYSTEM },
    })
    await screen.findByText('Sin pago hace más de 3 días')
    await userEvent.click(screen.getByRole('button', { name: 'Resume este pedido' }))
    expect(await screen.findByText('Se acabaron las consultas de IA de este periodo.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })

  it('error de red: aviso con reintento', async () => {
    renderPanel({
      assistant: (body) => {
        if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: SYSTEM }
        throw new Error('red')
      },
    })
    await screen.findByText('Sin pago hace más de 3 días')
    await userEvent.click(screen.getByRole('button', { name: 'Resume este pedido' }))
    const alerta = await screen.findByText('No se pudo contactar con el asistente. Los datos del pedido siguen disponibles.')
    expect(within(alerta.closest('[role="alert"]') as HTMLElement).getByRole('button')).toBeInTheDocument()
  })
})

const ATTENTION_SYSTEM = {
  ...CONTEXT,
  total_open: 20,
  items: [
    {
      ref: 'O1', order_id: OTHER_ID, order_number: 'A-APR', customer_label: 'Cliente', status: 'pending',
      payment_status: 'pending', fulfillment_status: 'unfulfilled', approval_status: 'pending', severity: 'high',
      signals: ['approval_pending'], next_action: 'review_approval',
    },
  ],
}

/** Abre «Requieren atención» y pulsa «Analizar con IA» (lo único que gasta cuota). */
async function analyzeAttention() {
  await userEvent.click(await screen.findByRole('button', { name: 'Requieren atención: 20' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Analizar con IA' }))
}

describe('Asistente IA del listado', () => {
  it('no gasta IA al cargar: los indicadores salen del SQL, sin modelo', async () => {
    const { client } = renderBar({})
    expect(await screen.findByText('Asistente IA de pedidos')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Requieren atención: 20' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagados sin despachar: 10' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sin pagar (+7 días): 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Esperando aprobación: 1' })).toBeInTheDocument()
    expect(assistantCalls(client)).toEqual([])
    // Los cuatro con el filtro de su regla, en la tienda activa y sin pedir filas.
    const busquedas = client.state.rpcCalls.filter((c) => c.name === 'ai_orders_search')
    expect(busquedas).toHaveLength(4)
    for (const b of busquedas) expect(b.args).toMatchObject({ p_store_id: STORE_A, p_limit: 1 })
  })

  it('pulsar un indicador lista esos pedidos sin llamar a la IA; abrir usa el id', async () => {
    const { client, onOpenOrder } = renderBar({})
    const card = await screen.findByRole('button', { name: 'Esperando aprobación: 1' })
    await userEvent.click(card)
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('1 de 1 pedidos')).toBeInTheDocument()
    expect(assistantCalls(client)).toEqual([])
    const lista = client.state.rpcCalls.filter((c) => c.name === 'ai_orders_search' && c.args.p_limit === 25)
    expect(lista[0]?.args).toMatchObject({ p_approval_status: 'pending', p_attention_only: false })
    await userEvent.click(screen.getByRole('button', { name: /A-APR/ }))
    expect(onOpenOrder).toHaveBeenCalledWith(OTHER_ID)
  })

  it('los indicadores siguen aunque no quede cuota (no la usan); sin botón que gaste', async () => {
    renderBar({ entitlement: { status: 'quota_exceeded', remaining: 0, used: 500 } })
    expect(await screen.findByRole('button', { name: 'Requieren atención: 20' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Requieren atención: 20' }))
    expect(await screen.findByText('1 de 20 pedidos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Analizar con IA' })).not.toBeInTheDocument()
  })

  it('«¿Qué pedidos requieren atención?»: lote del servidor; la acción abre el pedido en su pestaña', async () => {
    const { client, onOpenOrder } = renderBar({
      assistant: () => ({
        data: {
          ...CONTEXT,
          overview: 'Hay pedidos esperando firma.',
          items: [{ ...ATTENTION_SYSTEM.items[0], reason: 'Espera la firma del comprador.', suggested_action: { kind: 'review_approval', order_id: OTHER_ID, tab: 'summary', route: null } }],
          discarded: 0,
        },
        motivo: null,
        interaction_id: INTERACTION,
        system: ATTENTION_SYSTEM,
      }),
    })
    await analyzeAttention()
    expect(await screen.findByText('Espera la firma del comprador.')).toBeInTheDocument()
    expect(assistantCalls(client)).toEqual([{ mode: 'attention', store_id: STORE_A, locale: 'es' }])
    expect(screen.getByText('Se analizaron 1 de 20 pedidos abiertos.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Revisar la aprobación' }))
    expect(onOpenOrder).toHaveBeenCalledWith(OTHER_ID, 'summary')
  })

  it('sin interpretación (proveedor caído): la cola del SISTEMA sigue ahí', async () => {
    renderBar({ assistant: () => ({ data: null, motivo: 'proveedor', interaction_id: null, system: ATTENTION_SYSTEM }) })
    await analyzeAttention()
    expect(await screen.findByText('Cola del sistema')).toBeInTheDocument()
    expect(screen.getByText('A-APR')).toBeInTheDocument()
    expect(screen.getByText('La IA no respondió. Vuelve a intentarlo.')).toBeInTheDocument()
  })

  it('cola vacía: lo dice la base, sin aviso de error', async () => {
    renderBar({ assistant: () => ({ data: null, motivo: 'vacia', interaction_id: null, system: { ...ATTENTION_SYSTEM, total_open: 0, items: [] } }) })
    await analyzeAttention()
    expect(await screen.findByText('No hay pedidos abiertos que requieran atención.')).toBeInTheDocument()
  })

  it('búsqueda en lenguaje natural: enseña los filtros aplicados y las filas; abrir usa el id', async () => {
    const { client, onOpenOrder } = renderBar({
      assistant: () => ({
        data: {
          filters: {
            status: null, payment_status: 'paid', fulfillment_status: 'unfulfilled', approval_status: null,
            source_channel: null, placed_within_days: 7, older_than_days: null, text: null, attention_only: false,
          },
          discarded: 0,
          total: 1,
          limit: 25,
          rows: [
            {
              id: OTHER_ID, order_number: 'A-PAID', customer_label: 'Bodega Sur', status: 'paid', payment_status: 'paid',
              fulfillment_status: 'unfulfilled', approval_status: 'not_required', currency: 'PEN', grand_total: '99.00',
              placed_at: '2026-09-18T10:00:00Z',
            },
          ],
        },
        motivo: null,
        interaction_id: INTERACTION,
        system: null,
      }),
    })
    const campo = await screen.findByRole('textbox', { name: 'Buscar pedidos en lenguaje natural' })
    await userEvent.type(campo, 'pagados sin despachar esta semana')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar con IA' }))
    expect(await screen.findByText('Últimos 7 días')).toBeInTheDocument()
    expect(screen.getByText('1 de 1 pedidos')).toBeInTheDocument()
    expect(assistantCalls(client)).toEqual([
      { mode: 'search', store_id: STORE_A, locale: 'es', question: 'pagados sin despachar esta semana' },
    ])
    await userEvent.click(screen.getByRole('button', { name: /A-PAID/ }))
    expect(onOpenOrder).toHaveBeenCalledWith(OTHER_ID)
  })

  it('frase que no es una búsqueda: motivo y pista, sin filas', async () => {
    renderBar({ assistant: () => ({ data: null, motivo: 'vacia', interaction_id: null, system: null }) })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Buscar pedidos en lenguaje natural' }), 'hola')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar con IA' }))
    expect(await screen.findByText('Con estos datos la IA no tuvo nada fiable que decir.')).toBeInTheDocument()
    expect(screen.getByText(/Prueba con estados, fechas o un número de pedido/)).toBeInTheDocument()
  })
})
