import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, USER, createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import { parseAiResult } from '@/features/ai/result'
import { ACCIONES_CREDITO, CONFIG_CREDITO, SENALES_CREDITO } from '../../../../supabase/functions/_shared/aiCredit'
import { ACCIONES_PAGO, CONFIG_PAGOS, SENALES_PAGO } from '../../../../supabase/functions/_shared/aiPayments'
import { ACCIONES_ENTREGA, CONFIG_ENTREGAS, SENALES_ENTREGA } from '../../../../supabase/functions/_shared/aiFulfillment'
import { TONOS } from '../../../../supabase/functions/_shared/aiExplain'
import { CREDIT_AI_ACTIONS, CREDIT_AI_SIGNALS, CREDIT_AI_TABS, creditAi } from '@/features/credit/ai/creditAi'
import { PAYMENT_AI_ACTIONS, PAYMENT_AI_SIGNALS, PAYMENT_AI_TABS } from '@/features/payments/ai/paymentsAi'
import { FULFILLMENT_AI_ACTIONS, FULFILLMENT_AI_SIGNALS, FULFILLMENT_AI_TABS } from '@/features/fulfillment/ai/fulfillmentAi'
import { DRAFT_TONES, explainDraftSchema, metricSuffix } from './explainAi'

/**
 * IA de Crédito, Pagos y Entregas en el CLIENTE (fase 08).
 *
 *  · Abrir la pestaña / el cajón NO gasta cuota: solo el CÁLCULO DEL SISTEMA.
 *  · La INTERPRETACIÓN IA va aparte, bajo demanda, con cifras de la base.
 *  · Las acciones solo navegan o preparan un borrador: no hay ningún botón que
 *    bloquee, cambie límites, marque pagos, despache o cancele.
 *  · Los borradores son editables y se copian: no hay botón de enviar.
 *  · Estados: rol sin permiso (nada se pinta ni se pide), no contratado, error.
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
const { CreditAiSection } = await import('@/features/credit/ai/CreditAiSection')
const { PaymentsAiSection } = await import('@/features/payments/ai/PaymentsAiSection')
const { FulfillmentAiPanel } = await import('@/features/fulfillment/ai/FulfillmentAiSection')

const C1 = '11111111-1111-4111-8111-111111111111'
const I1 = '33333333-3333-4333-8333-333333333331'
const F1 = '55555555-5555-4555-8555-555555555551'
const INTERACTION = '88888888-8888-4888-8888-888888888888'
const GEN = '2026-09-22T10:00:00Z'

const CREDIT_PORTFOLIO = {
  generated_at: GEN,
  scope: 'portfolio',
  metrics: {
    debt_total: { kind: 'money', value: '1500.00', currency: 'PEN' },
    debt_overdue: { kind: 'money', value: '1300.00', currency: 'PEN' },
    overdue_documents: { kind: 'count', value: 3 },
  },
  entities: { C1: { kind: 'customer', label: 'Bodega Norte' } },
  signals: [
    { code: 'overdue_debt', severity: 'high', ref: null },
    { code: 'over_limit', severity: 'high', ref: 'C1' },
  ],
  highlights: ['debt_total', 'debt_overdue', 'overdue_documents'],
  items: [{ ref: 'C1', id: C1, label: 'Bodega Norte', severity: 'high', signals: ['over_limit'] }],
  rows: [],
}

const CREDIT_CUSTOMER = {
  generated_at: GEN,
  scope: 'customer',
  metrics: {
    debt_overdue: { kind: 'money', value: '1300.00', currency: 'PEN' },
    D1_balance: { kind: 'money', value: '1000.00', currency: 'PEN' },
    D1_days_overdue: { kind: 'days', value: 120 },
  },
  entities: { C1: { kind: 'customer', label: 'Bodega Norte' }, D1: { kind: 'document', label: 'F001-9' } },
  signals: [{ code: 'debt_over_90', severity: 'high', ref: 'C1' }],
  highlights: ['debt_overdue'],
  items: [],
  rows: [{ ref: 'D1', group: 'documents', label: 'F001-9', status: 'overdue', metrics: ['D1_balance', 'D1_days_overdue'], note: null }],
}

function explainBody(system: Record<string, unknown>, data: Record<string, unknown>) {
  return {
    data: {
      generated_at: GEN,
      metrics: system.metrics,
      entities: system.entities,
      overview: '',
      findings: [],
      actions: [],
      answer: '',
      discarded: 0,
      ...data,
    },
    motivo: null,
    interaction_id: INTERACTION,
    system,
  }
}

function entitlement(over: Record<string, unknown> = {}) {
  return {
    enabled: true, status: 'active', plan: 'active', period: '202609', used: 10, quota: 500, remaining: 490,
    features: { credit: true, payments: true, fulfillment: true },
    ...over,
  }
}

type Handler = (body: Record<string, unknown>) => unknown

function backend(options: { role?: string; entitlement?: Record<string, unknown>; credit?: Handler; payments?: Handler; fulfillment?: Handler }): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement) },
    functions: {
      'credit-assistant':
        options.credit ??
        ((body) => {
          const system = body.customer_id ? CREDIT_CUSTOMER : CREDIT_PORTFOLIO
          if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system }
          if (body.mode === 'reminder') {
            return {
              data: {
                subject: 'Recordatorio de pago — {{C1}}',
                body: 'Estimados {{C1}}: {{D1}} tiene un saldo de {{D1_balance}}.',
                points: ['Saldo vencido: {{debt_overdue}}'],
                discarded: 0,
                draft: true,
                metrics: CREDIT_CUSTOMER.metrics,
                entities: CREDIT_CUSTOMER.entities,
              },
              motivo: null,
              interaction_id: INTERACTION,
              system,
            }
          }
          return explainBody(system, {
            overview: '{{C1}} debe {{debt_overdue}} vencidos.',
            findings: [{ signal: 'overdue_debt', severity: 'high', ref: null, text: 'Hay {{overdue_documents}} documentos vencidos.' }],
            actions: [
              { kind: 'review_documents', ref: null, target_id: null, tab: 'cobranza', text: 'Revisar los documentos vencidos.' },
              { kind: 'review_credit_terms', ref: 'C1', target_id: C1, tab: 'cobranza', text: 'Revisar las condiciones de {{C1}}.' },
            ],
          })
        }),
      'payments-assistant': options.payments ?? (() => ({ data: null, motivo: null, interaction_id: null, system: PAYMENTS_STORE })),
      'fulfillment-assistant': options.fulfillment ?? (() => ({ data: null, motivo: null, interaction_id: null, system: FULFILLMENT_ONE })),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'admin', status: 'active' },
      ],
      stores: [
        { id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa-nordica', name: 'Casa Nórdica', status: 'active', currency: 'PEN' },
      ],
    },
  })
}

const PAYMENTS_STORE = {
  generated_at: GEN,
  scope: 'store',
  metrics: {
    attempts_timeout_30d: { kind: 'count', value: 1 },
    reconciliation_discrepancy: { kind: 'count', value: 1 },
    E1_count: { kind: 'count', value: 3 },
  },
  entities: { I1: { kind: 'intent', label: 'T-1001' }, E1: { kind: 'error_code', label: 'insufficient_funds' } },
  signals: [
    { code: 'timeout_unknown', severity: 'high', ref: null },
    { code: 'failed', severity: 'medium', ref: 'I1' },
  ],
  highlights: ['attempts_timeout_30d', 'reconciliation_discrepancy'],
  items: [{ ref: 'I1', id: I1, label: 'T-1001', severity: 'medium', signals: ['failed'] }],
  rows: [{ ref: 'I1', group: 'intents', label: 'T-1001', status: 'failed', metrics: [], note: 'insufficient_funds' }],
}

const FULFILLMENT_ONE = {
  generated_at: GEN,
  scope: 'fulfillment',
  metrics: { F1_days_late: { kind: 'days', value: 4 } },
  entities: { F1: { kind: 'fulfillment', label: 'T-2001' }, M1: { kind: 'method', label: 'Envío estándar' } },
  signals: [{ code: 'late', severity: 'high', ref: 'F1' }],
  highlights: ['F1_days_late'],
  items: [],
  rows: [{ ref: null, group: 'tracking', label: 'NO_ONE_HOME', status: 'delivery_attempted', metrics: [], note: 'Nadie en casa' }],
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

const calls = (client: FakeSupabase, name: string) =>
  client.state.invocations.filter((i) => i.name === name).map((i) => i.body)

/** Ningún control que ESCRIBA estado de crédito, pagos o entregas. */
const WRITE_WORDS = /bloquear|desbloquear|aumentar límite|marcar como pagad|capturar|conciliar ahora|despachar|cancelar|enviar$/i

beforeEach(() => {
  holder.client = null
  window.location.hash = ''
})

describe('copias de las listas cerradas', () => {
  it('señales, acciones y pestañas son las del servidor', () => {
    expect([...CREDIT_AI_SIGNALS]).toEqual([...SENALES_CREDITO])
    expect([...CREDIT_AI_ACTIONS]).toEqual([...ACCIONES_CREDITO])
    expect([...PAYMENT_AI_SIGNALS]).toEqual([...SENALES_PAGO])
    expect([...PAYMENT_AI_ACTIONS]).toEqual([...ACCIONES_PAGO])
    expect([...FULFILLMENT_AI_SIGNALS]).toEqual([...SENALES_ENTREGA])
    expect([...FULFILLMENT_AI_ACTIONS]).toEqual([...ACCIONES_ENTREGA])
    expect([...DRAFT_TONES]).toEqual([...TONOS])
    const tabs = (config: { pestanaDeAccion: Record<string, string | null> }) =>
      [...new Set(Object.values(config.pestanaDeAccion).filter((x): x is string => x !== null))].sort()
    expect(tabs(CONFIG_CREDITO)).toEqual([...CREDIT_AI_TABS].sort())
    expect(tabs(CONFIG_PAGOS)).toEqual([...PAYMENT_AI_TABS].sort())
    expect(tabs(CONFIG_ENTREGAS)).toEqual([...FULFILLMENT_AI_TABS].sort())
  })

  it('la etiqueta de una métrica ignora la referencia de su fila', () => {
    expect(metricSuffix('D1_balance')).toBe('balance')
    expect(metricSuffix('C10_overdue')).toBe('overdue')
    expect(metricSuffix('debt_1_30')).toBe('debt_1_30')
  })
})

describe('contrato: lo que no cumple no se pinta', () => {
  it('señal, acción o pestaña inventadas ⇒ esquema', () => {
    const ok = explainBody(CREDIT_PORTFOLIO, { overview: 'x' })
    expect(parseAiResult(creditAi.schemas.insight, ok).data).not.toBeNull()
    for (const data of [
      { findings: [{ signal: 'vip', severity: 'high', ref: null, text: 'x' }] },
      { actions: [{ kind: 'block_account', ref: null, target_id: null, tab: null, text: 'x' }] },
      { actions: [{ kind: 'review_documents', ref: null, target_id: null, tab: 'config', text: 'x' }] },
    ]) {
      expect(parseAiResult(creditAi.schemas.insight, explainBody(CREDIT_PORTFOLIO, data))).toMatchObject({ data: null, motivo: 'esquema' })
    }
    expect(creditAi.schemas.system.safeParse({ ...CREDIT_PORTFOLIO, signals: [{ code: 'vip', severity: 'high', ref: null }] }).success).toBe(false)
  })

  it('un «borrador» que no se declara borrador ⇒ esquema', () => {
    const draft = { subject: 'a', body: 'b', points: [], discarded: 0, metrics: {}, entities: {} }
    expect(parseAiResult(explainDraftSchema, { data: { ...draft, draft: true }, motivo: null }).data).not.toBeNull()
    expect(parseAiResult(explainDraftSchema, { data: { ...draft, draft: false }, motivo: null })).toMatchObject({ data: null, motivo: 'esquema' })
  })
})

describe('Crédito — pestaña «Análisis IA» y asistente de cobranza', () => {
  it('al abrir solo pide el cálculo del sistema, con cifras de la base', async () => {
    const { client } = render(<CreditAiSection />, {})
    expect(await screen.findByText('Documentos vencidos por cobrar')).toBeInTheDocument()
    expect(screen.getByText(/1[.,]?300\.00/)).toBeInTheDocument()
    expect(screen.getByText('Bodega Norte')).toBeInTheDocument()
    expect(calls(client, 'credit-assistant')).toEqual([{ mode: 'signals' }])
  })

  it('explicar: marcadores resueltos, acciones que solo navegan, ningún botón que escriba', async () => {
    const user = userEvent.setup()
    const { client } = render(<CreditAiSection />, {})
    await user.click(await screen.findByRole('button', { name: /Resume la situación de cobranza/ }))
    // Los marcadores se pintan en <strong>: se mira el párrafo entero.
    expect(
      await screen.findByText((_, el) => el?.tagName === 'P' && /^Bodega Norte debe .*1[.,]?300\.00 vencidos\.$/.test(el.textContent ?? '')),
    ).toBeInTheDocument()
    expect(calls(client, 'credit-assistant').at(-1)).toEqual({ mode: 'explain' })
    const review = screen.getByRole('button', { name: 'Revisar documentos' })
    await user.click(review)
    expect(window.location.hash).toBe('#cobranza')
    for (const button of screen.getAllByRole('button')) expect(button.textContent ?? '').not.toMatch(WRITE_WORDS)
  })

  it('«Analizar» un cliente abre su cajón y el recordatorio es un borrador editable sin envío', async () => {
    const user = userEvent.setup()
    const { client } = render(<CreditAiSection />, {})
    await user.click(await screen.findByRole('button', { name: 'Analizar' }))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('F001-9')).toBeInTheDocument()
    expect(calls(client, 'credit-assistant')).toContainEqual({ mode: 'signals', customer_id: C1 })

    await user.click(within(drawer).getByRole('button', { name: 'Redactar recordatorio' }))
    const body = (await within(drawer).findByLabelText('Mensaje')) as HTMLTextAreaElement
    expect(body.value).toMatch(/Bodega Norte: F001-9 tiene un saldo de .*1[.,]?000\.00/)
    expect(calls(client, 'credit-assistant').at(-1)).toEqual({ mode: 'reminder', customer_id: C1, tone: 'formal' })
    expect(within(drawer).getByRole('button', { name: 'Copiar borrador' })).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: /^Enviar/ })).toBeNull()
  })

  it('rol sin la funcionalidad (orders): nada se pinta ni se pide', async () => {
    const { client } = render(<CreditAiSection />, { role: 'orders' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(screen.queryByText('Cobranza con IA')).toBeNull()
    expect(calls(client, 'credit-assistant')).toEqual([])
  })

  it('no contratado: aviso, sin botones que gasten; el cálculo del sistema sigue', async () => {
    const { client } = render(<CreditAiSection />, { entitlement: { features: { credit: false } } })
    expect(await screen.findByText('Documentos vencidos por cobrar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume la situación/ })).toBeNull()
    expect(calls(client, 'credit-assistant').every((b) => b.mode === 'signals')).toBe(true)
  })

  it('error de red al explicar: aviso con reintento', async () => {
    const user = userEvent.setup()
    render(<CreditAiSection />, {
      credit: (body) => {
        if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: CREDIT_PORTFOLIO }
        throw new Error('red')
      },
    })
    await user.click(await screen.findByRole('button', { name: /Resume la situación de cobranza/ }))
    expect(await screen.findByText(/No se pudo contactar con el asistente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('Pagos — pestaña «Análisis IA»', () => {
  it('cálculo del sistema con el código de error y el cobro a revisar; viewer no ve nada', async () => {
    const { client } = render(<PaymentsAiSection />, {})
    expect(await screen.findByText('Tiempo agotado: resultado desconocido')).toBeInTheDocument()
    expect(screen.getByText('insufficient_funds')).toBeInTheDocument()
    expect(calls(client, 'payments-assistant')).toEqual([{ store_id: STORE_A, mode: 'signals' }])
  })

  it('un rol sin la funcionalidad (viewer) no pide nada', async () => {
    const { client } = render(<PaymentsAiSection />, { role: 'viewer' })
    await waitFor(() => expect(client.state.rpcCalls.some((c) => c.name === 'ai_entitlement')).toBe(true))
    expect(calls(client, 'payments-assistant')).toEqual([])
  })
})

describe('Entregas — panel de una entrega', () => {
  it('seguimiento del operador visible; mensaje bloqueado por el candado ⇒ aviso, sin borrador', async () => {
    const user = userEvent.setup()
    const { client } = render(<FulfillmentAiPanel storeId={STORE_A} fulfillmentId={F1} />, {
      fulfillment: (body) =>
        body.mode === 'signals'
          ? { data: null, motivo: null, interaction_id: null, system: FULFILLMENT_ONE }
          : { data: null, motivo: 'bloqueada', interaction_id: INTERACTION, system: FULFILLMENT_ONE },
    })
    expect(await screen.findByText('Pasó la fecha prometida')).toBeInTheDocument()
    expect(screen.getByText('· T-2001', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Intento de entrega')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Redactar mensaje' }))
    await waitFor(() => expect(calls(client, 'fulfillment-assistant').at(-1)).toMatchObject({ mode: 'message', fulfillment_id: F1 }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mensaje')).toBeNull()
  })
})
