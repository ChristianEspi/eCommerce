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
 * Cobranza y comprobantes en pantalla.
 *
 * Lo que se comprueba montando el árbol es lo que la base no puede comprobar:
 *
 *  · que la antigüedad se calcula **al pintar** sobre la fecha de vencimiento, y
 *    no se lee de una columna que un proceso nocturno tendría que refrescar;
 *  · que el cobro **avisa antes de enviar** cuando supera la deuda marcada,
 *    porque el `COBRO_EXCEDE_DEUDA` de la base llega cuando el recibo YA existe;
 *  · que el reparto es de más antiguo a más nuevo, que es el orden del oficio;
 *  · que sin `credit.management` se lee qué falta en vez de una tabla vacía.
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
const { CapabilityGate } = await import('@/features/capabilities/CapabilityGate')
const { CreditPage } = await import('./CreditPage')

const CLIENTE = '99999999-9999-4999-9999-999999999901'
const DOC_VIEJO = '99999999-9999-4999-9999-999999999911'
const DOC_NUEVO = '99999999-9999-4999-9999-999999999912'
const DOC_PAGADO = '99999999-9999-4999-9999-999999999913'

const COBRANZA = ['ecommerce.credit.management']

/** Una fecha relativa a hoy, para que el vencimiento no caduque con el tiempo. */
function haceDias(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

function doc(id: string, numero: string, vence: string, importe: string, saldo: string) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    customer_id: CLIENTE,
    order_id: null,
    kind: 'invoice',
    document_number: numero,
    currency: 'PEN',
    issued_at: vence,
    due_at: vence,
    amount: importe,
    balance: saldo,
    customers: { code: 'C-001', name: 'Bodega Central' },
  }
}

function backend(
  options: {
    entitlements?: string[]
    invoices?: Record<string, unknown>[]
    issue?: Record<string, unknown>[]
    requestIssue?: (args: Record<string, unknown>) => unknown
  } = {},
): FakeSupabase {
  const { entitlements = COBRANZA } = options
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        {
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: USER,
          role: 'admin',
          status: 'active',
        },
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
      ar_documents: [
        doc(DOC_VIEJO, 'F001-100', haceDias(45), '1000.00', '1000.00'),
        doc(DOC_NUEVO, 'F001-200', haceDias(5), '500.00', '500.00'),
        doc(DOC_PAGADO, 'F001-050', haceDias(120), '300.00', '0.00'),
      ],
      ar_receipts: [],
      ar_applications: [],
      invoices: options.invoices ?? [],
      invoice_issue_status: options.issue ?? [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      ...(options.requestIssue ? { invoice_request_issue: options.requestIssue } : {}),
    },
  })
}

/**
 * El `#hash` de `SectionTabs` sobrevive entre tests: jsdom comparte una sola
 * `window`. Sin limpiarlo, un test que abre «Comprobantes» deja al siguiente
 * arrancando en esa pestaña.
 */
beforeEach(() => {
  window.location.hash = ''
})

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="credit.management">
          <CreditPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

describe('la pantalla de cobranza', () => {
  it('calcula la antigüedad sobre el vencimiento, no sobre una columna guardada', async () => {
    pintar(backend())

    // 45 días de mora: ni el documento ni la base lo dicen: sale de restar
    // fechas en el momento de pintar. Si dependiera de un proceso nocturno,
    // un fin de semana largo dejaría a todo el mundo mirando cifras viejas.
    expect(await screen.findByText('Vencido 45 d')).toBeInTheDocument()
    expect(screen.getByText('Vencido 5 d')).toBeInTheDocument()
  })

  it('arranca en «solo pendiente»: quien abre cobranza viene a cobrar', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('F001-100')

    // El documento saldado no está de entrada, pero el histórico está a un clic.
    expect(screen.queryByText('F001-050')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ver todo' }))
    expect(await screen.findByText('F001-050')).toBeInTheDocument()
  })

  it('sin el módulo contratado dice qué falta, no enseña una tabla vacía', async () => {
    pintar(backend({ entitlements: [] }))

    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByText('F001-100')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('el registro de un cobro', () => {
  async function abrirCobro(fake: FakeSupabase) {
    const user = userEvent.setup()
    pintar(fake)
    await screen.findByText('F001-100')
    // La acción es un ICONO: su nombre accesible lleva pegado el documento
    // —«Registrar cobro: F001-1001»— para que no suene igual en veinte filas.
    await user.click(screen.getAllByRole('button', { name: /^Registrar cobro:/ })[0]!)
    // El cajón está abierto cuando ya se puede marcar qué documento cancela.
    await screen.findByRole('checkbox', { name: 'F001-100' })
    return user
  }

  it('avisa ANTES de enviar cuando el cobro supera la deuda marcada', async () => {
    const fake = backend()
    const user = await abrirCobro(fake)

    await user.click(screen.getByRole('checkbox', { name: 'F001-200' }))
    await user.type(screen.getByLabelText(/N.º de recibo/), 'R-001')
    await user.type(screen.getByLabelText(/^Importe/), '900')

    // El aviso sale en la pantalla y el botón se apaga: si esto llegara a la
    // base, el recibo YA estaría creado cuando la aplicación falla, y habría
    // que explicar por qué quedó un cobro colgando.
    expect(screen.getAllByText('El cobro supera la deuda marcada.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled()
    expect(fake.state.tables.ar_receipts).toHaveLength(0)
  })

  it('reparte de más antiguo a más nuevo y deja el resto sin aplicar', async () => {
    const fake = backend()
    const user = await abrirCobro(fake)

    await user.click(screen.getByRole('checkbox', { name: 'F001-100' }))
    await user.click(screen.getByRole('checkbox', { name: 'F001-200' }))
    await user.type(screen.getByLabelText(/N.º de recibo/), 'R-001')
    await user.type(screen.getByLabelText(/^Importe/), '1200')
    await user.click(screen.getByRole('button', { name: 'Registrar' }))

    await vi.waitFor(() => expect(fake.state.tables.ar_receipts).toHaveLength(1))

    const aplicaciones = (fake.state.tables.ar_applications ?? []) as Array<{
      document_id: string
      amount: string
    }>
    // 1200 sobre una deuda de 1000 + 500: el más viejo se cancela entero y el
    // resto va al siguiente. Es el orden del oficio y el único que no obliga a
    // preguntar a quien está cobrando.
    expect(aplicaciones).toHaveLength(2)
    expect(aplicaciones[0]).toMatchObject({ document_id: DOC_VIEJO, amount: '1000.00' })
    expect(aplicaciones[1]).toMatchObject({ document_id: DOC_NUEVO, amount: '200.00' })
  })

  it('solo ofrece aplicar a los documentos ABIERTOS del cliente', async () => {
    await abrirCobro(backend())

    // El saldado no aparece: marcarlo no bajaría nada y la base lo rechazaría.
    const cajas = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))
    expect(cajas).toEqual(['F001-100', 'F001-200'])
  })
})

describe('la pestaña de comprobantes', () => {
  it('va gateada por `invoicing`, que es otro addon distinto de la cobranza', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('F001-100')

    await user.click(screen.getByRole('tab', { name: 'Comprobantes' }))

    // Se lleva la cuenta de lo que se debe sin emitir comprobante electrónico:
    // son dos cosas que se contratan por separado.
    const panel = await screen.findByRole('tabpanel')
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('la emisión de un comprobante', () => {
  const FACTURA = '99999999-9999-4999-9999-999999999931'
  const factura = {
    id: FACTURA,
    organization_id: ORG,
    company_id: COMPANY_A,
    order_id: '99999999-9999-4999-9999-999999999932',
    series: 'F001',
    number: null,
    status: 'pending',
    currency: 'PEN',
    issued_at: '2026-09-14T10:00:00Z',
    customer_name: 'Bodega Central',
    customer_tax_id: null,
    net_total: '100.00',
    tax_total: '18.00',
    gross_total: '118.00',
    reject_reason: null,
  }

  async function abrirComprobantes(fake: FakeSupabase) {
    const user = userEvent.setup()
    pintar(fake)
    await screen.findByText('F001-100')
    await user.click(screen.getByRole('tab', { name: 'Comprobantes' }))
    await screen.findByText('Bodega Central', { selector: 'td' })
    return user
  }

  it('sin proveedor fiscal lo dice en la fila, sin error', async () => {
    const fake = backend({
      entitlements: [...COBRANZA, 'ecommerce.invoicing'],
      invoices: [factura],
      issue: [
        {
          invoice_id: FACTURA,
          organization_id: ORG,
          company_id: COMPANY_A,
          issue_state: 'pending_configuration',
          blocked_code: 'FACTURADOR_NO_CONFIGURADO',
        },
      ],
    })
    await abrirComprobantes(fake)

    expect(await screen.findByText('Falta proveedor')).toBeInTheDocument()
    expect(screen.getByText('La sociedad no tiene un proveedor fiscal activo.')).toBeInTheDocument()
  })

  it('«Emitir» manda SOLO el id del comprobante: la sociedad la pone la base', async () => {
    const fake = backend({
      entitlements: [...COBRANZA, 'ecommerce.invoicing'],
      invoices: [factura],
      requestIssue: () => ({ state: 'enqueued', replay: false }),
    })
    const user = await abrirComprobantes(fake)

    expect(await screen.findByText('Sin solicitar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Emitir comprobante F001' }))

    const llamadas = fake.state.rpcCalls.filter((c) => c.name === 'invoice_request_issue')
    expect(llamadas).toEqual([{ name: 'invoice_request_issue', args: { p_invoice_id: FACTURA } }])
    expect(await screen.findByText('Emisión encolada')).toBeInTheDocument()
  })
})
