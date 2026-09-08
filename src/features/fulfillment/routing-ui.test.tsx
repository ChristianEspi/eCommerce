import { screen } from '@testing-library/react'
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
 * Reparto propio y evidencia de entrega, en pantalla.
 *
 * Lo que se comprueba montando el árbol:
 *
 *  · que la pestaña va gateada por `fulfillment.routing`, que es un addon
 *    distinto del despacho: quien manda por courier no necesita hojas de ruta;
 *  · que una parada YA firmada no vuelve a ofrecer el botón de firmar, porque
 *    `pod_is_immutable` rechaza el segundo intento y no debería llegar a
 *    intentarse;
 *  · que el motivo es obligatorio cuando NO se entregó, y se dice antes de
 *    enviar — una fila que no se puede editar tiene que entrar bien a la
 *    primera;
 *  · que una hoja cerrada no ofrece avanzar a ningún sitio.
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
const { RoutingSection } = await import('./RoutingSection')

const HOJA_ARMADO = '66666666-6666-4666-6666-666666666601'
const HOJA_CERRADA = '66666666-6666-4666-6666-666666666602'
const DESPACHO_FIRMADO = '66666666-6666-4666-6666-666666666611'
const DESPACHO_SIN_FIRMA = '66666666-6666-4666-6666-666666666612'
const PARADA_FIRMADA = '66666666-6666-4666-6666-666666666621'
const PARADA_SIN_FIRMA = '66666666-6666-4666-6666-666666666622'

const REPARTO = ['ecommerce.fulfillment', 'ecommerce.fulfillment.routing']

beforeEach(() => {
  window.location.hash = ''
})

function backend(options: { entitlements?: string[] } = {}): FakeSupabase {
  const { entitlements = REPARTO } = options
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
      delivery_vehicles: [
        {
          id: '66666666-6666-4666-6666-666666666631',
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'CAM-01',
          plate: 'ABC-123',
          description: null,
          capacity_kg: '3500.00',
          is_active: true,
        },
      ],
      delivery_plans: [
        {
          id: HOJA_ARMADO,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          vehicle_id: '66666666-6666-4666-6666-666666666631',
          code: 'HR-001',
          plan_date: '2026-09-02',
          status: 'draft',
          driver_name: 'Pedro Chofer',
          dispatched_at: null,
          closed_at: null,
          delivery_vehicles: { code: 'CAM-01' },
        },
        {
          id: HOJA_CERRADA,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          vehicle_id: null,
          code: 'HR-000',
          plan_date: '2026-09-01',
          status: 'closed',
          driver_name: null,
          dispatched_at: '2026-09-01T08:00:00.000Z',
          closed_at: '2026-09-01T18:00:00.000Z',
          delivery_vehicles: null,
        },
      ],
      delivery_plan_stops: [
        {
          id: PARADA_FIRMADA,
          organization_id: ORG,
          company_id: COMPANY_A,
          plan_id: HOJA_ARMADO,
          fulfillment_id: DESPACHO_FIRMADO,
          sequence: 1,
          eta: null,
        },
        {
          id: PARADA_SIN_FIRMA,
          organization_id: ORG,
          company_id: COMPANY_A,
          plan_id: HOJA_ARMADO,
          fulfillment_id: DESPACHO_SIN_FIRMA,
          sequence: 2,
          eta: null,
        },
      ],
      proof_of_delivery: [
        {
          id: '66666666-6666-4666-6666-666666666641',
          organization_id: ORG,
          company_id: COMPANY_A,
          fulfillment_id: DESPACHO_FIRMADO,
          stop_id: PARADA_FIRMADA,
          outcome: 'delivered',
          received_by: 'Ana Recibe',
          document_id: null,
          reason: null,
          created_at: '2026-09-02T15:00:00.000Z',
        },
      ],
      fulfillment_overview: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
    },
  })
}

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="fulfillment.routing">
          <RoutingSection />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

/**
 * El botón de una fila, por el comienzo de su nombre accesible.
 *
 * Las acciones de tabla son ICONOS y no tienen texto: el nombre vive en
 * `aria-label` con el identificador de la fila detrás —«Despachar: HR-0002»—
 * para que un lector de pantalla sepa sobre cuál actúa. De ahí el prefijo.
 */
function botonDe(row: HTMLElement, name: string): HTMLElement {
  const encontrado = accionesDe(row).find((boton) =>
    (boton.getAttribute('aria-label') ?? '').startsWith(name),
  )
  if (!encontrado) throw new Error(`No hay un botón «${name}» en esa fila`)
  return encontrado
}

/** Todos los botones de acción de una fila. */
function accionesDe(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll('button'))
}

/** Los nombres accesibles de las acciones de una fila. */
function nombresDe(row: HTMLElement): string[] {
  return accionesDe(row).map((boton) => boton.getAttribute('aria-label') ?? '')
}

function filaCon(texto: string): HTMLElement {
  const fila = screen.getAllByRole('row').find((row) => row.textContent?.includes(texto))
  if (!fila) throw new Error(`No hay una fila con «${texto}»`)
  return fila
}

describe('las hojas de ruta', () => {
  it('sin el addon de reparto dice qué falta, no enseña una tabla vacía', async () => {
    pintar(backend({ entitlements: ['ecommerce.fulfillment'] }))

    expect(await screen.findByText('fulfillment.routing')).toBeInTheDocument()
    expect(screen.queryByText('HR-001')).not.toBeInTheDocument()
  })

  it('una hoja CERRADA no ofrece avanzar a ningún sitio', async () => {
    pintar(backend())
    await screen.findByText('HR-000')

    const cerrada = filaCon('HR-000')
    const armado = filaCon('HR-001')

    // De `closed` no se sale: la hoja ya tiene evidencias colgando y esas son
    // inmutables. Lo único que le queda es abrirla.
    expect(nombresDe(cerrada)).toEqual(['Abrir: HR-000'])
    expect(botonDe(armado, 'Despachar')).toBeEnabled()
  })

  it('despachar sella la hora de salida', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('HR-001')

    await user.click(botonDe(filaCon('HR-001'), 'Despachar'))

    const hojas = (fake.state.tables.delivery_plans ?? []) as Array<{
      id: string
      status: string
      dispatched_at: string | null
    }>
    const tocada = hojas.find((h) => h.id === HOJA_ARMADO)!
    expect(tocada.status).toBe('dispatched')
    // Sin hora de salida no se puede responder a qué hora salió el camión, que
    // es media pregunta de cualquier reclamo.
    expect(tocada.dispatched_at).not.toBeNull()
  })
})

describe('la firma de una entrega', () => {
  async function abrirHoja() {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('HR-001')
    await user.click(botonDe(filaCon('HR-001'), 'Abrir'))
    await screen.findByText('Paradas')
    return user
  }

  it('una parada YA firmada no vuelve a ofrecer el botón', async () => {
    await abrirHoja()

    const firmada = filaCon('Firmada')
    const sinFirmar = filaCon('Sin firmar')

    // No es que el segundo intento falle: es que `pod_is_immutable` lo
    // rechazaría y no debería llegar a intentarse.
    expect(firmada.textContent).not.toContain('Firmar')
    expect(botonDe(sinFirmar, 'Firmar')).toBeEnabled()
  })

  it('exige el motivo cuando NO se entregó, antes de escribir la fila', async () => {
    const user = await abrirHoja()

    await user.click(botonDe(filaCon('Sin firmar'), 'Firmar'))
    await screen.findByText(/no se edita ni se borra/)

    // Con «Entregado» no hay campo de motivo: sería una casilla que invita a
    // rellenar ruido.
    expect(screen.queryByLabelText(/Motivo/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Resultado' }))
    await user.click(screen.getByRole('option', { name: 'Rechazado' }))

    // Aparece, y es obligatorio.
    expect(await screen.findByLabelText(/Motivo/)).toBeInTheDocument()
  })

  it('no escribe la prueba si falta el motivo de un rechazo', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('HR-001')
    await user.click(botonDe(filaCon('HR-001'), 'Abrir'))
    await screen.findByText('Paradas')
    await user.click(botonDe(filaCon('Sin firmar'), 'Firmar'))
    await screen.findByText(/no se edita ni se borra/)

    await user.click(screen.getByRole('combobox', { name: 'Resultado' }))
    await user.click(screen.getByRole('option', { name: 'Rechazado' }))
    await user.click(screen.getByRole('button', { name: 'Firmar' }))

    // La tabla sigue con la única prueba que traía. Una fila que no se puede
    // editar tiene que entrar bien a la primera.
    expect(await screen.findByText('Hace falta indicar el motivo.')).toBeInTheDocument()
    expect(fake.state.tables.proof_of_delivery).toHaveLength(1)
  })
})
