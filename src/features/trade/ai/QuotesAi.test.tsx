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
  ESTADOS_CLIENTE,
  ESTADOS_LINEA,
  MAX_INSTRUCCION,
  PRIORIDADES,
  TIPOS_SUGERENCIA,
} from '../../../../supabase/functions/_shared/aiQuotes'
import {
  CUSTOMER_RESOLUTION,
  LINE_RESOLUTION,
  MAX_INSTRUCTION,
  SUGGESTION_KINDS,
  SUGGESTION_PRIORITIES,
  draftInterpretationSchema,
  draftResolutionSchema,
  linesFromResolution,
  pendingLines,
  readyLines,
  type DraftResolution,
} from './quotesAi'

/**
 * IA de cotizaciones y surtidos en el CLIENTE (fase 07).
 *
 *  · Abrir el cajón NO gasta cuota; interpretar es un clic explícito.
 *  · Con duda hay CANDIDATOS y elige la persona: nada se preselecciona a ciegas.
 *  · El precio lo pide la pantalla al SISTEMA (`quote_draft_preview`) y el
 *    navegador no manda ni un importe; guardar exige confirmar y re-precia.
 *  · Estados: rol sin permiso (sin botón), no contratado, error de red.
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
const { QuoteAiDraftDrawer } = await import('./QuoteAiDraftDrawer')
const { QuotesPage } = await import('../QuotesPage')

const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '11111111-1111-4111-8111-111111111112'
const P1 = '22222222-2222-4222-8222-222222222221'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '22222222-2222-4222-8222-222222222223'
const V1 = '33333333-3333-4333-8333-333333333331'
const QUOTE = '44444444-4444-4444-8444-444444444441'
const INTERACTION = '88888888-8888-4888-8888-888888888888'

const candidate = (id: string, name: string, sku: string, over: Record<string, unknown> = {}) => ({
  product_id: id,
  sku,
  name,
  kind: 'simple',
  match: 'partial',
  matched_variant_id: null,
  in_assortment: null,
  variants: [],
  ...over,
})

const RESOLUTION: DraftResolution = draftResolutionSchema.parse({
  generated_at: '2026-09-21T12:00:00Z',
  customer: {
    status: 'ambiguous',
    query: 'San Juan',
    selected_customer_id: null,
    candidates: [
      { customer_id: C1, code: 'BSJ-01', name: 'Bodega San Juan', kind: 'company', segment: null, match: 'partial' },
      { customer_id: C2, code: 'BSJ-02', name: 'Bodega San Juan Norte', kind: 'company', segment: null, match: 'partial' },
    ],
  },
  assortment: null,
  lines: [
    { index: 1, query: 'paracetamol 500', quantity: 20, status: 'resolved', selected_product_id: P1, candidates: [candidate(P1, 'Paracetamol 500 mg', 'PARA-500', { match: 'name' })] },
    {
      index: 2,
      query: 'ibuprofeno',
      quantity: null,
      status: 'ambiguous',
      selected_product_id: null,
      candidates: [candidate(P2, 'Ibuprofeno 400 mg', 'IBU-400'), candidate(P3, 'Ibuprofeno 600 mg', 'IBU-600', { in_assortment: false })],
    },
  ],
})

const INTERPRETATION = {
  customer_query: 'San Juan',
  lines: [
    { query: 'paracetamol 500', quantity: 20 },
    { query: 'ibuprofeno', quantity: null },
  ],
  validity_days: 30,
  notes: 'Entregar en almacén',
  summary: 'Cotización para San Juan con dos productos.',
  unresolved: [],
  price_requested: true,
  discarded: 0,
  draft: true,
}

function previewFor(lines: { product_id: string; variant_id: string | null; quantity: number }[]) {
  const priced = lines.map((l, i) => ({
    index: i + 1,
    product_id: l.product_id,
    variant_id: l.variant_id,
    quantity: l.quantity,
    sku: l.product_id === P1 ? 'PARA-500' : 'IBU-400',
    name: l.product_id === P1 ? 'Paracetamol 500 mg' : 'Ibuprofeno 400 mg',
    variant_name: null,
    in_assortment: true,
    blocked: null,
    unit_price: '2.50',
    compare_at_price: null,
    tax_rate: '0.18',
    tax_amount: (l.quantity * 2.5 * 0.18).toFixed(2),
    line_total: (l.quantity * 2.5).toFixed(2),
    price_source: 'catalog',
    price_list_code: null,
    availability: { available: 100, unknown: false, backorder: false, in_stock: true },
  }))
  const subtotal = priced.reduce((s, l) => s + Number(l.line_total), 0)
  const tax = priced.reduce((s, l) => s + Number(l.tax_amount), 0)
  return {
    generated_at: '2026-09-21T12:00:00Z',
    customer: { customer_id: C1, code: 'BSJ-01', name: 'Bodega San Juan' },
    currency: 'PEN',
    tax_inclusive: false,
    lines: priced,
    blocked: 0,
    pricing_error: null,
    subtotal: subtotal.toFixed(2),
    tax_total: tax.toFixed(2),
    grand_total: (subtotal + tax).toFixed(2),
    ready: true,
  }
}

function backend(options: { role?: string; features?: Record<string, boolean>; quotes?: (body: Record<string, unknown>) => unknown } = {}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      ai_entitlement: () => ({
        enabled: true, status: 'active', plan: 'active', period: '202609', used: 1, quota: 500, remaining: 499,
        features: options.features ?? { quotes: true },
      }),
      quote_draft_preview: (args) => previewFor(args.p_lines as never),
      quote_create_from_draft: (args) => ({
        quote_id: QUOTE,
        quote_number: args.p_quote_number,
        status: 'draft',
        currency: 'PEN',
        grand_total: '0.00',
        already_created: false,
      }),
    },
    functions: {
      'quotes-assistant':
        options.quotes ??
        ((body) =>
          body.mode === 'draft'
            ? { data: INTERPRETATION, motivo: null, interaction_id: INTERACTION, system: RESOLUTION }
            : { data: null, motivo: null, interaction_id: null, system: null }),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'orders', status: 'active' },
      ],
      stores: [
        { id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa-nordica', name: 'Casa Nórdica', status: 'active', currency: 'PEN' },
      ],
      customers: [],
      quotes: [],
    },
  })
}

function renderDrawer(options: Parameters<typeof backend>[0] = {}) {
  const client = backend(options)
  holder.client = client
  const onCreated = vi.fn()
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <QuoteAiDraftDrawer open storeId={STORE_A} onClose={() => {}} onCreated={onCreated} />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client, onCreated }
}

const invocations = (client: FakeSupabase) => client.state.invocations.filter((i) => i.name === 'quotes-assistant').map((i) => i.body)
const rpcs = (client: FakeSupabase, name: string) => client.state.rpcCalls.filter((c) => c.name === name).map((c) => c.args)

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('tipos, prioridades y estados son los del servidor', () => {
    expect([...SUGGESTION_KINDS]).toEqual([...TIPOS_SUGERENCIA])
    expect([...SUGGESTION_PRIORITIES]).toEqual([...PRIORIDADES])
    expect([...CUSTOMER_RESOLUTION]).toEqual([...ESTADOS_CLIENTE])
    expect([...LINE_RESOLUTION]).toEqual([...ESTADOS_LINEA])
    expect(MAX_INSTRUCTION).toBe(MAX_INSTRUCCION)
  })
})

describe('contrato y estado del borrador (puro)', () => {
  it('una interpretación que no se declara borrador ⇒ esquema', () => {
    expect(parseAiResult(draftInterpretationSchema, { data: INTERPRETATION, motivo: null }).data).not.toBeNull()
    expect(parseAiResult(draftInterpretationSchema, { data: { ...INTERPRETATION, draft: false }, motivo: null })).toMatchObject({
      data: null,
      motivo: 'esquema',
    })
    // Un precio colado en la interpretación no tiene forma válida… pero zod
    // ignora claves extra: lo que importa es que la pantalla nunca las lee.
    expect(draftResolutionSchema.safeParse({ ...RESOLUTION, lines: [{ ...RESOLUTION.lines[0], selected_product_id: 'x' }] }).success).toBe(false)
  })

  it('con duda no se elige por la persona; la variante solo si el sistema la identificó', () => {
    const lines = linesFromResolution(RESOLUTION)
    expect(lines.map((l) => [l.productId, l.quantity])).toEqual([
      [P1, '20'],
      [null, ''],
    ])
    const variante = linesFromResolution({
      ...RESOLUTION,
      lines: [
        {
          index: 1, query: 'CAM-R', quantity: 2, status: 'resolved', selected_product_id: P1,
          candidates: [
            {
              ...draftResolutionSchema.shape.lines.element.shape.candidates.element.parse(candidate(P1, 'Camiseta', 'CAM', { kind: 'variant' })),
              matched_variant_id: V1,
              variants: [
                { variant_id: V1, sku: 'CAM-R', name: 'Roja' },
                { variant_id: '33333333-3333-4333-8333-333333333332', sku: 'CAM-A', name: 'Azul' },
              ],
            },
          ],
        },
      ],
    })
    expect(variante[0]!.variantId).toBe(V1)
  })

  it('solo se precian líneas completas; lo pendiente se cuenta', () => {
    const lines = linesFromResolution(RESOLUTION)
    expect(readyLines(lines)).toEqual([{ product_id: P1, variant_id: null, quantity: 20 }])
    expect(pendingLines(lines)).toBe(1)
    const completa = lines.map((l) => (l.key === 'r2' ? { ...l, productId: P2, quantity: '0' } : l))
    expect(readyLines(completa)).toHaveLength(1)
    const ok = lines.map((l) => (l.key === 'r2' ? { ...l, productId: P2, quantity: '10' } : l))
    expect(readyLines(ok)).toEqual([
      { product_id: P1, variant_id: null, quantity: 20 },
      { product_id: P2, variant_id: null, quantity: 10 },
    ])
    expect(pendingLines(ok)).toBe(0)
  })
})

describe('Borrador de cotización con IA', () => {
  it('abrir no gasta; interpretar es explícito; con duda se eligen candidatos; el precio lo da el sistema; guardar exige confirmar', async () => {
    const user = userEvent.setup()
    const { client, onCreated } = renderDrawer()

    const run = await screen.findByRole('button', { name: 'Interpretar con IA' })
    expect(invocations(client)).toHaveLength(0)

    await user.type(screen.getByRole('textbox', { name: 'Qué quieres cotizar' }), 'Cotiza a San Juan 20 paracetamol 500 e ibuprofeno')
    await user.click(run)

    await waitFor(() => expect(invocations(client)).toHaveLength(1))
    expect(invocations(client)[0]).toMatchObject({ mode: 'draft', store_id: STORE_A, locale: 'es' })
    expect(invocations(client)[0]).not.toHaveProperty('customer_id')

    // Interpretación + aviso de precio ignorado (lo decide el motor).
    expect(await screen.findByText('Cotización para San Juan con dos productos.')).toBeInTheDocument()
    expect(screen.getByText(/no se aplican\. Los precios los calcula el motor/)).toBeInTheDocument()

    // Cliente ambiguo: candidatos, ninguno elegido.
    expect(screen.getByText(/Hay varios clientes que coinciden con «San Juan»/)).toBeInTheDocument()
    const radioC1 = screen.getByRole('radio', { name: /^Bodega San Juan BSJ-01/ })
    expect(radioC1).not.toBeChecked()
    expect(rpcs(client, 'quote_draft_preview')).toHaveLength(0)
    await user.click(radioC1)

    // Línea ambigua: el candidato fuera de surtido no se puede elegir.
    const linea = screen.getByRole('group', { name: 'ibuprofeno' })
    expect(within(linea).getByRole('radio', { name: /Ibuprofeno 600 mg/ })).toBeDisabled()
    await user.click(within(linea).getByRole('radio', { name: /Ibuprofeno 400 mg/ }))
    await user.type(within(linea).getByRole('textbox', { name: 'Cantidad' }), '10')

    // Precio del SISTEMA, pedido sin importes.
    await waitFor(() => {
      const last = rpcs(client, 'quote_draft_preview').at(-1)
      expect(last?.p_lines).toEqual([
        { product_id: P1, variant_id: null, quantity: 20 },
        { product_id: P2, variant_id: null, quantity: 10 },
      ])
    })
    for (const args of rpcs(client, 'quote_draft_preview')) {
      expect(JSON.stringify(args)).not.toMatch(/price|total|tax/)
      expect(args.p_customer_id).toBe(C1)
    }
    expect(await screen.findByText(/88[.,]50/)).toBeInTheDocument()

    // Sin confirmación no se guarda.
    const crear = screen.getByRole('button', { name: 'Crear borrador de cotización' })
    expect(crear).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Revisé el cliente/ }))
    expect(crear).toBeEnabled()
    await user.click(crear)

    await waitFor(() => expect(rpcs(client, 'quote_create_from_draft')).toHaveLength(1))
    const saved = rpcs(client, 'quote_create_from_draft')[0]!
    expect(saved).toMatchObject({ p_store_id: STORE_A, p_customer_id: C1, p_notes: 'Entregar en almacén' })
    expect(saved.p_lines).toEqual([
      { product_id: P1, variant_id: null, quantity: 20 },
      { product_id: P2, variant_id: null, quantity: 10 },
    ])
    expect(String(saved.p_request_key)).toMatch(/^ai-quote:/)
    expect(JSON.stringify(saved.p_lines)).not.toMatch(/price|total|tax/)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(QUOTE))
  })

  it('no contratado: aviso y ningún botón que gaste', async () => {
    const { client } = renderDrawer({ features: { quotes: false } })
    expect(await screen.findByText(/no tiene contratado este uso de IA/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Interpretar con IA' })).not.toBeInTheDocument()
    expect(invocations(client)).toHaveLength(0)
  })

  it('error de red: se dice y se puede reintentar; nada se guarda', async () => {
    const user = userEvent.setup()
    const { client } = renderDrawer({
      quotes: () => {
        throw new Error('red caída')
      },
    })
    await user.type(await screen.findByRole('textbox', { name: 'Qué quieres cotizar' }), 'Cotiza 5 ibuprofeno')
    await user.click(screen.getByRole('button', { name: 'Interpretar con IA' }))
    expect(await screen.findByText(/No se pudo contactar con el asistente/)).toBeInTheDocument()
    expect(rpcs(client, 'quote_create_from_draft')).toHaveLength(0)
  })
})

describe('Cotizaciones: acceso al borrador con IA', () => {
  function renderPage(role: string) {
    const client = backend({ role })
    holder.client = client
    renderWithProviders(
      <TenantProvider>
        <CapabilitiesProvider>
          <QuotesPage />
        </CapabilitiesProvider>
      </TenantProvider>,
      { session: makeSession() },
    )
    return client
  }

  it('el vendedor (rol de quotes) ve el botón; viewer no', async () => {
    renderPage('sales_rep')
    expect(await screen.findByRole('button', { name: 'Borrador con IA' })).toBeInTheDocument()
  })

  it('viewer: sin botón ni llamadas', async () => {
    const client = renderPage('viewer')
    expect(await screen.findByRole('button', { name: 'Nueva cotización' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Borrador con IA' })).not.toBeInTheDocument()
    expect(invocations(client)).toHaveLength(0)
  })
})
