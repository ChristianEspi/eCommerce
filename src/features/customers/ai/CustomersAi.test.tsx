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
import { SENALES_CLIENTE, TONOS } from '../../../../supabase/functions/_shared/aiCustomers'
import { CUSTOMER_AI_SIGNALS, customerInsightSchema, customerSystemSchema } from './customersAi'
import { FOLLOW_UP_TONES, followUpDraftSchema } from '@/features/sales/ai/salesAi'

/**
 * IA de Clientes y Visitas en el CLIENTE (fase 06).
 *
 *  · Abrir la pestaña / el cajón NO gasta cuota: solo el CÁLCULO DEL SISTEMA.
 *  · La INTERPRETACIÓN IA va aparte, bajo demanda, con cifras de la base.
 *  · El crédito que el rol no ve no se pinta como cero: se dice que no se muestra.
 *  · El seguimiento es un BORRADOR editable: no hay botón de enviar.
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
const { CustomerAiPanel } = await import('./CustomerAiPanel')
const { VisitAiDrawer } = await import('@/features/sales/ai/VisitAiDrawer')

const C = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222221'
const P2 = '22222222-2222-4222-8222-222222222222'
const O1 = '33333333-3333-4333-8333-333333333331'
const VISIT = '44444444-4444-4444-8444-444444444441'
const INTERACTION = '88888888-8888-4888-8888-888888888888'

const CONTEXT = {
  generated_at: '2026-09-21T12:00:00Z',
  metrics: {
    orders_365d: { kind: 'count', value: 6 },
    amount_365d: { kind: 'money', value: '980.50', currency: 'PEN' },
    days_since_last_order: { kind: 'days', value: 50 },
    P1_orders: { kind: 'count', value: 5 },
    P2_orders: { kind: 'count', value: 3 },
    P2_days_since_last: { kind: 'days', value: 90 },
    O1_total: { kind: 'money', value: '120.00', currency: 'PEN' },
  },
  entities: {
    C1: { kind: 'customer', label: 'Bodega San Martín' },
    P1: { kind: 'product', label: 'Arroz 5 kg' },
    P2: { kind: 'product', label: 'Aceite 1 L' },
    O1: { kind: 'order', label: 'PED-0042' },
    T1: { kind: 'task', label: 'Enviar catálogo' },
  },
}

function system(over: Record<string, unknown> = {}) {
  return {
    ...CONTEXT,
    customer: {
      customer_id: C, kind: 'company', code: 'CLI-1', name: 'Bodega San Martín', tier: 'a', visit_frequency: 'weekly',
      segment: 'Mayorista', business_type: null, is_active: true, has_email: true, has_phone: false, has_tax_id: true,
    },
    account: null,
    link: 'email',
    sections: { credit: false, visits: true, promotions: false, returns: false, quotes: false },
    credit_status: null,
    signals: [
      { code: 'payment_failed', severity: 'high' },
      { code: 'lapsed_products', severity: 'low' },
    ],
    recent_orders: [
      { ref: 'O1', order_id: O1, order_number: 'PED-0042', status: 'pending', payment_status: 'failed', fulfillment_status: 'unfulfilled', approval_status: 'not_required' },
    ],
    products: [
      { ref: 'P1', product_id: P1, name: 'Arroz 5 kg', lapsed: false },
      { ref: 'P2', product_id: P2, name: 'Aceite 1 L', lapsed: true },
    ],
    promotions: [],
    tasks: [{ ref: 'T1', label: 'Enviar catálogo' }],
    visits: { recent: [], in_portfolio: true },
    visit: null,
    ...over,
  }
}

const SYSTEM = system()
const VISIT_SYSTEM = system({
  visit: {
    visit_id: VISIT, outcome: 'planned', checked_in: false, checked_out: false, has_order: false, route: 'Ruta Norte',
    notes: null, tasks: [{ label: 'Enviar catálogo', done: false }],
  },
})

function insightBody(over: Record<string, unknown> = {}) {
  return {
    data: {
      ...CONTEXT,
      overview: '{{C1}} lleva {{orders_365d}} pedidos en el año.',
      highlights: ['Compra sobre todo {{P1}}.'],
      pending: [{ signal: 'payment_failed', severity: 'high', text: 'El cobro de {{O1}} fue rechazado.' }],
      opportunities: [{ ref: 'P2', product_id: P2, name: 'Aceite 1 L', lapsed: true, text: 'No pide {{P2}} desde hace {{P2_days_since_last}}.' }],
      answer: '',
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
    features: { customers: true, sales: true },
    ...over,
  }
}

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  customers?: (body: Record<string, unknown>) => unknown
  sales?: (body: Record<string, unknown>) => unknown
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement) },
    functions: {
      'customers-assistant':
        options.customers ??
        ((body) => (body.mode === 'signals' ? { data: null, motivo: null, interaction_id: null, system: SYSTEM } : insightBody())),
      'sales-assistant':
        options.sales ??
        ((body) => {
          if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: VISIT_SYSTEM }
          if (body.mode === 'prepare') {
            return {
              data: {
                ...CONTEXT,
                summary: '{{C1}} es cliente semanal.',
                recent_activity: 'Último pedido hace {{days_since_last_order}}.',
                pending: [{ signal: 'payment_failed', severity: 'high', text: 'Revisar el cobro de {{O1}}.' }],
                products: [{ ref: 'P2', product_id: P2, name: 'Aceite 1 L', lapsed: true, text: 'Dejó de pedirlo.' }],
                questions: ['¿Sigue necesitando {{P2}}?'],
                discarded: 0,
              },
              motivo: null,
              interaction_id: INTERACTION,
              system: VISIT_SYSTEM,
            }
          }
          return {
            data: {
              generated_at: CONTEXT.generated_at,
              metrics: {},
              entities: { C1: CONTEXT.entities.C1, P1: CONTEXT.entities.P1 },
              subject: 'Gracias por su tiempo, {{C1}}',
              body: 'Estimados {{C1}}: les enviaremos el catálogo de {{P1}}.',
              points: ['Envío del catálogo'],
              discarded: 0,
              draft: true,
            },
            motivo: null,
            interaction_id: INTERACTION,
            system: VISIT_SYSTEM,
          }
        }),
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

function renderPanel(options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CustomerAiPanel customerId={C} />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client }
}

function renderVisit(options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <VisitAiDrawer open visitId={VISIT} customerName="Bodega San Martín" onClose={() => {}} />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client }
}

const calls = (client: FakeSupabase, name: string) =>
  client.state.invocations.filter((i) => i.name === name).map((i) => i.body)

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('señales y tonos son los del servidor', () => {
    expect([...CUSTOMER_AI_SIGNALS]).toEqual([...SENALES_CLIENTE])
    expect([...FOLLOW_UP_TONES]).toEqual([...TONOS])
  })
})

describe('contrato: lo que no cumple no se pinta', () => {
  it('una señal inventada en el sistema o en un pendiente ⇒ no se acepta', () => {
    expect(customerSystemSchema.safeParse(SYSTEM).success).toBe(true)
    expect(customerSystemSchema.safeParse({ ...SYSTEM, signals: [{ code: 'vip', severity: 'high' }] }).success).toBe(false)
    const body = insightBody({ pending: [{ signal: 'enviar_correo', severity: 'high', text: 'x' }] })
    expect(parseAiResult(customerInsightSchema, body)).toMatchObject({ data: null, motivo: 'esquema' })
  })

  it('un «borrador» que no se declara borrador ⇒ esquema', () => {
    const draft = { ...CONTEXT, subject: 'a', body: 'b', points: [], discarded: 0 }
    expect(parseAiResult(followUpDraftSchema, { data: { ...draft, draft: true }, motivo: null }).data).not.toBeNull()
    expect(parseAiResult(followUpDraftSchema, { data: { ...draft, draft: false }, motivo: null })).toMatchObject({
      data: null,
      motivo: 'esquema',
    })
  })
})

describe('Resumen 360 del cliente', () => {
  it('al abrir solo pide el cálculo del sistema; el crédito oculto no se pinta como cero', async () => {
    const { client } = renderPanel({})
    expect(await screen.findByText('Cobro rechazado en un pedido abierto')).toBeInTheDocument()
    expect(screen.getByText('Productos que dejó de pedir')).toBeInTheDocument()
    expect(screen.getByText(/heurística/)).toBeInTheDocument()
    expect(screen.getByText(/No se muestra: tu rol no tiene acceso al crédito/)).toBeInTheDocument()
    expect(screen.getByText('Enviar catálogo')).toBeInTheDocument()
    expect(calls(client, 'customers-assistant')).toEqual([{ mode: 'signals', customer_id: C, locale: 'es' }])
  })

  it('«Resume este cliente» pide la interpretación; cifras y nombres desde la base; nada escribe', async () => {
    const { client } = renderPanel({})
    await screen.findByText('Cobro rechazado en un pedido abierto')
    await userEvent.click(screen.getByRole('button', { name: 'Resume este cliente' }))
    expect(await screen.findByText('Resumen 360')).toBeInTheDocument()
    expect(calls(client, 'customers-assistant')[1]).toEqual({ mode: 'summary', customer_id: C, locale: 'es' })
    expect(screen.getByText('Oportunidades observables')).toBeInTheDocument()
    expect(screen.getAllByText('90 días').length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()
    for (const b of screen.queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/enviar|guardar|crear pedido|bloquear/i)
    }
  })

  it('una pregunta sugerida viaja como `question`', async () => {
    const { client } = renderPanel({})
    await screen.findByText('Cobro rechazado en un pedido abierto')
    await userEvent.click(screen.getByRole('button', { name: '¿Qué pendientes tiene este cliente?' }))
    await screen.findByText('Resumen 360')
    expect(calls(client, 'customers-assistant')[1]).toEqual({
      mode: 'summary', customer_id: C, locale: 'es', question: '¿Qué pendientes tiene este cliente?',
    })
  })

  it('rol sin la funcionalidad (catalog): no se pinta ni se pide nada', async () => {
    const { client } = renderPanel({ role: 'catalog' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Resumen 360 con IA')).not.toBeInTheDocument()
    expect(calls(client, 'customers-assistant')).toEqual([])
  })

  it('no contratado / sin cuota: aviso y sin botones que gasten; el sistema sigue', async () => {
    renderPanel({ entitlement: { features: { customers: false } } })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(await screen.findByText('Cobro rechazado en un pedido abierto')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume este cliente' })).not.toBeInTheDocument()
  })

  it('sin cuota: aviso y sin botones que gasten', async () => {
    renderPanel({ entitlement: { status: 'quota_exceeded', used: 500, remaining: 0 } })
    expect(await screen.findByText('Se acabaron las consultas de IA de este periodo.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume este cliente' })).not.toBeInTheDocument()
  })

  it('error de red: aviso con reintento; el cálculo del sistema sigue', async () => {
    renderPanel({
      customers: (body) => {
        if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: SYSTEM }
        throw new Error('red')
      },
    })
    await screen.findByText('Cobro rechazado en un pedido abierto')
    await userEvent.click(screen.getByRole('button', { name: 'Resume este cliente' }))
    const alerta = await screen.findByText('No se pudo contactar con el asistente. El cálculo del sistema sigue disponible.')
    expect(within(alerta.closest('[role="alert"]') as HTMLElement).getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('Cobro rechazado en un pedido abierto')).toBeInTheDocument()
  })
})

describe('Asistente de visita', () => {
  it('al abrir solo pide el cálculo del sistema de la visita', async () => {
    const { client } = renderVisit({ role: 'sales_rep' })
    expect(await screen.findByText('Ruta Norte')).toBeInTheDocument()
    expect(calls(client, 'sales-assistant')).toEqual([{ mode: 'signals', visit_id: VISIT, locale: 'es' }])
  })

  it('Preparar visita: resumen, pendientes, productos y preguntas sugeridas', async () => {
    const { client } = renderVisit({ role: 'sales_rep' })
    await screen.findByText('Ruta Norte')
    await userEvent.click(screen.getByRole('button', { name: 'Preparar visita' }))
    expect(await screen.findByText('Preguntas sugeridas')).toBeInTheDocument()
    expect(screen.getByText('Aceite 1 L', { selector: 'strong' })).toBeInTheDocument()
    expect(calls(client, 'sales-assistant')[1]).toEqual({ mode: 'prepare', visit_id: VISIT, locale: 'es' })
  })

  it('Generar seguimiento: BORRADOR editable con marcadores resueltos; sin botón de enviar', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { client } = renderVisit({ role: 'sales_rep' })
    await screen.findByText('Ruta Norte')
    await userEvent.type(screen.getByLabelText('Notas de la visita (opcional)'), 'Acordamos enviar catálogo')
    await userEvent.click(screen.getByRole('button', { name: 'Generar borrador' }))

    const asunto = await screen.findByLabelText('Asunto')
    expect(asunto).toHaveValue('Gracias por su tiempo, Bodega San Martín')
    expect(screen.getByLabelText('Mensaje')).toHaveValue('Estimados Bodega San Martín: les enviaremos el catálogo de Arroz 5 kg.')
    expect(screen.getByText(/No se ha enviado nada/)).toBeInTheDocument()
    expect(calls(client, 'sales-assistant')[1]).toEqual({
      mode: 'follow_up', visit_id: VISIT, locale: 'es', tone: 'formal', notes: 'Acordamos enviar catálogo',
    })
    for (const b of screen.queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/^enviar|send/i)
    }

    await userEvent.clear(asunto)
    await userEvent.type(asunto, 'Seguimiento')
    await userEvent.click(screen.getByRole('button', { name: 'Copiar borrador' }))
    expect(writeText).toHaveBeenCalledWith(
      'Seguimiento\n\nEstimados Bodega San Martín: les enviaremos el catálogo de Arroz 5 kg.',
    )
  })

  it('borrador bloqueado por el candado: motivo tipado, sin texto', async () => {
    renderVisit({
      role: 'sales_rep',
      sales: (body) =>
        body.mode === 'signals'
          ? { data: null, motivo: null, interaction_id: null, system: VISIT_SYSTEM }
          : { data: null, motivo: 'bloqueada', interaction_id: INTERACTION, system: VISIT_SYSTEM },
    })
    await screen.findByText('Ruta Norte')
    await userEvent.click(screen.getByRole('button', { name: 'Generar borrador' }))
    await waitFor(() => expect(screen.queryByLabelText('Asunto')).not.toBeInTheDocument())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('rol sin la funcionalidad (viewer): no se pide nada', async () => {
    const { client } = renderVisit({ role: 'viewer' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Preparar visita')).not.toBeInTheDocument()
    expect(calls(client, 'sales-assistant')).toEqual([])
  })
})
