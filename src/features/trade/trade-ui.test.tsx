import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
 * Cotizaciones y surtidos en pantalla.
 *
 * Lo que se comprueba montando el árbol:
 *
 *  · que la **caducidad se marca al pintar** aunque la fila siga diciendo
 *    `sent`: nadie ha pasado a poner `expired`, y honrar un precio vencido es
 *    exactamente el fallo que esto evita;
 *  · que una cotización cerrada **no ofrece** ni edición ni avance de estado,
 *    porque los triggers de la base los van a rechazar;
 *  · que el avance de estado ofrece SOLO las transiciones que el trigger admite;
 *  · que lista blanca y lista negra se distinguen en la lista y se explican en
 *    palabras: los mismos productos significan lo contrario según el signo.
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
const { QuotesPage } = await import('./QuotesPage')
const { AssortmentsPage } = await import('./AssortmentsPage')

const CLIENTE = '77777777-7777-4777-7777-777777777701'
const VIGENTE = '77777777-7777-4777-7777-777777777711'
const CADUCADA = '77777777-7777-4777-7777-777777777712'
const ACEPTADA = '77777777-7777-4777-7777-777777777713'
const SURTIDO_BLANCO = '77777777-7777-4777-7777-777777777721'
const SURTIDO_NEGRO = '77777777-7777-4777-7777-777777777722'

function enDias(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

function quote(id: string, numero: string, estado: string, vigencia: string) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    customer_id: CLIENTE,
    sales_rep_id: null,
    quote_number: numero,
    status: estado,
    currency: 'PEN',
    issued_at: enDias(-30),
    valid_until: vigencia,
    subtotal: '1000.00',
    tax_total: '180.00',
    grand_total: '1180.00',
    order_id: null,
    notes: null,
    customers: { code: 'C-001', name: 'Bodega Central' },
  }
}

function backend(options: { entitlements?: string[] } = {}): FakeSupabase {
  const { entitlements = ['ecommerce.trade.quotes', 'ecommerce.trade.assortments'] } = options
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
      quotes: [
        quote(VIGENTE, 'COT-001', 'sent', enDias(10)),
        // Sigue diciendo `sent` a propósito: nadie ha pasado a marcarla vencida.
        quote(CADUCADA, 'COT-002', 'sent', enDias(-2)),
        quote(ACEPTADA, 'COT-003', 'accepted', enDias(20)),
      ],
      quote_items: [],
      assortments: [
        {
          id: SURTIDO_BLANCO,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code: 'MODERNO',
          name: 'Canal moderno',
          is_allow_list: true,
          is_active: true,
        },
        {
          id: SURTIDO_NEGRO,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code: 'TRADICIONAL',
          name: 'Canal tradicional',
          is_allow_list: false,
          is_active: true,
        },
      ],
      assortment_items: [],
      customers: [],
      products: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
    },
  })
}

function pintar(fake: FakeSupabase, capability: 'trade.quotes' | 'trade.assortments') {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability={capability}>
          {capability === 'trade.quotes' ? <QuotesPage /> : <AssortmentsPage />}
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

describe('el listado de cotizaciones', () => {
  it('marca como caducada la que venció, aunque la fila siga diciendo «enviada»', async () => {
    pintar(backend(), 'trade.quotes')
    await screen.findByText('COT-001')

    // Solo UNA: la de vigencia pasada. `expired` es un estado que alguien tiene
    // que poner, y hasta que lo pone la fila miente sobre su vigencia.
    expect(screen.getAllByText('Caducada')).toHaveLength(1)
  })

  it('filtra por estado sin abrir un panel de filtros', async () => {
    const user = userEvent.setup()
    pintar(backend(), 'trade.quotes')
    await screen.findByText('COT-001')

    await user.click(screen.getByRole('button', { name: 'Aceptada' }))

    expect(screen.getByText('COT-003')).toBeInTheDocument()
    expect(screen.queryByText('COT-001')).not.toBeInTheDocument()
  })

  it('sin el módulo contratado dice qué falta, no enseña una tabla vacía', async () => {
    pintar(backend({ entitlements: [] }), 'trade.quotes')

    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByText('COT-001')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('el cajón de una cotización', () => {
  it('una ACEPTADA no ofrece avanzar ni editar: los triggers lo rechazarían', async () => {
    const user = userEvent.setup()
    pintar(backend(), 'trade.quotes')
    await screen.findByText('COT-003')

    const filas = screen.getAllByRole('row')
    const fila = filas.find((row) => row.textContent?.includes('COT-003'))!
    await user.click(within_(fila, 'Abrir'))

    await screen.findByText(/ya está cerrada/)
    // Ni un botón de avance: de `accepted` no se sale.
    expect(screen.queryByRole('button', { name: 'Rechazada' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Número/ })).toBeDisabled()
  })

  it('una ENVIADA ofrece solo las transiciones que el trigger admite', async () => {
    const user = userEvent.setup()
    pintar(backend(), 'trade.quotes')
    await screen.findByText('COT-001')

    const filas = screen.getAllByRole('row')
    const fila = filas.find((row) => row.textContent?.includes('COT-001'))!
    await user.click(within_(fila, 'Abrir'))

    await screen.findByText('Avanzar el estado')
    expect(screen.getByRole('button', { name: 'Aceptada' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rechazada' })).toBeInTheDocument()
    // De `sent` NO se vuelve a borrador: el cliente ya lo vio.
    expect(screen.queryByRole('button', { name: 'Borrador' })).not.toBeInTheDocument()
  })
})

describe('los surtidos', () => {
  it('distinguen lista blanca de lista negra en la propia lista', async () => {
    pintar(backend(), 'trade.assortments')
    await screen.findByText('Canal moderno')

    // Confundirlas invierte el catálogo del cliente, así que el signo se ve sin
    // abrir nada.
    expect(screen.getByText('Blanca')).toBeInTheDocument()
    expect(screen.getByText('Negra')).toBeInTheDocument()
  })

  it('explican en palabras qué significa el signo, no solo con la casilla', async () => {
    const user = userEvent.setup()
    pintar(backend(), 'trade.assortments')
    await screen.findByText('Canal tradicional')

    const filas = screen.getAllByRole('row')
    const fila = filas.find((row) => row.textContent?.includes('Canal tradicional'))!
    await user.click(within_(fila, 'Abrir'))

    expect(
      await screen.findByText('Se ofrece todo el catálogo MENOS lo que está en la lista.'),
    ).toBeInTheDocument()
  })
})

/**
 * El botón de una fila, por el comienzo de su nombre accesible.
 *
 * Las acciones de tabla son ICONOS y no tienen texto: el nombre vive en
 * `aria-label`, y lleva pegado el identificador de la fila —«Abrir:
 * COT-2026-001»— para que un lector de pantalla sepa de cuál. De ahí el
 * prefijo.
 */
function within_(row: HTMLElement, name: string): HTMLElement {
  const encontrado = Array.from(row.querySelectorAll('button')).find((boton) =>
    (boton.getAttribute('aria-label') ?? '').startsWith(name),
  )
  if (!encontrado) throw new Error(`No hay un botón «${name}» en esa fila`)
  return encontrado
}
