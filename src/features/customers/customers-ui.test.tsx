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
 * Clientes en pantalla (P05-SaaS).
 *
 * Lo que se comprueba montando el árbol es lo que no se ve en la base:
 *
 *  · que la ficha de cliente es BASELINE y la cuenta B2B se gatea por lo
 *    contratado, dentro de la misma pantalla;
 *  · que el área de cuenta del comprador distingue **tres** estados —sin
 *    sesión, con sesión y sin vínculo, y con cuenta—, porque juntarlos manda a
 *    alguien a reintentar el login para arreglar algo que no es del login;
 *  · y que el contexto de esa área llega de UNA llamada sin argumentos: no hay
 *    id de cuenta viajando desde el navegador.
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
const { CustomersPage } = await import('./CustomersPage')
const { StoreAccountPage } = await import('@/features/storefront/StoreAccountPage')

const ACME = '77777777-7777-4777-8777-777777777701'
const ANA = '77777777-7777-4777-8777-777777777702'
const SEGMENT = '77777777-7777-4777-8777-777777777703'
const ACCOUNT = '77777777-7777-4777-8777-777777777704'
const ADDRESS = '77777777-7777-4777-8777-777777777705'
const LOCATION = '77777777-7777-4777-8777-777777777706'

const B2B = ['ecommerce.customers.b2b']

function backend(options: { entitlements?: string[]; rpc?: Record<string, () => unknown> } = {}): FakeSupabase {
  const { entitlements = B2B } = options
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'admin', status: 'active' },
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
      customer_segments: [
        {
          id: SEGMENT,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'mayorista',
          name: 'Mayoristas',
          description: null,
          is_active: true,
        },
      ],
      customers: [
        {
          id: ACME,
          organization_id: ORG,
          company_id: COMPANY_A,
          kind: 'company',
          code: 'CLI-ACME',
          name: 'Acme',
          legal_name: null,
          tax_id: '20123456789',
          email: 'compras@acme.test',
          phone: null,
          segment_id: SEGMENT,
          is_active: true,
          notes: null,
        },
        {
          id: ANA,
          organization_id: ORG,
          company_id: COMPANY_A,
          kind: 'person',
          code: 'CLI-ANA',
          name: 'Ana Torres',
          legal_name: null,
          tax_id: null,
          email: 'ana@correo.test',
          phone: null,
          segment_id: null,
          is_active: true,
          notes: null,
        },
      ],
      customer_addresses: [],
      customer_contacts: [],
      customer_external_ids: [],
      business_accounts: [
        {
          id: ACCOUNT,
          organization_id: ORG,
          company_id: COMPANY_A,
          customer_id: ACME,
          code: 'ACME',
          name: 'Acme',
          is_active: true,
          requires_approval: true,
          approval_threshold: '5000.00',
          purchase_order_required: false,
          notes: null,
        },
      ],
      business_locations: [],
      business_account_users: [],
      approval_rules: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      ...(options.rpc ?? {}),
    },
  })
}

function renderCustomers(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="customers">
          <CustomersPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
  window.history.replaceState(null, '', '/')
})

describe('Clientes — la pantalla', () => {
  it('es una sola pantalla con dos pestañas: la ficha y la cuenta B2B', async () => {
    renderCustomers(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Clientes', 'Cuentas B2B'])
  })

  it('lista la cartera con su tipo y su segmento, y un único buscador', async () => {
    renderCustomers(backend())
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Ana Torres')).toBeInTheDocument()
    expect(screen.getByText('Mayoristas')).toBeInTheDocument()
    expect(screen.getByText('Empresa')).toBeInTheDocument()
    expect(screen.getByText('Persona')).toBeInTheDocument()
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  it('la ficha se abre por pestañas: general, contactos, direcciones, identificadores y pedidos', async () => {
    const user = userEvent.setup()
    renderCustomers(backend())
    await screen.findByText('Acme')

    await user.click(screen.getByRole('button', { name: 'Editar: Acme' }))

    const dialog = await screen.findByRole('dialog', { name: 'Acme' })
    // Con el cajón abierto, las pestañas de la pantalla quedan fuera del árbol
    // de accesibilidad (el panel es modal), así que estas cinco son las suyas.
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'General',
      'Contactos',
      'Direcciones',
      'Identificadores',
      'Pedidos',
    ])
    expect(dialog).toBeInTheDocument()
  })

  it('la ficha dice si el cliente ya tiene cuenta B2B, para no mentir por omisión', async () => {
    const user = userEvent.setup()
    renderCustomers(backend())
    await screen.findByText('Acme')

    await user.click(screen.getByRole('button', { name: 'Editar: Acme' }))
    expect(await screen.findByText('Con cuenta B2B')).toBeInTheDocument()
  })
})

describe('Clientes — la ficha es baseline y la cuenta B2B se vende', () => {
  it('sin el addon la cartera se sigue viendo: cobrar por anotar a quién le vendes sería un peaje', async () => {
    renderCustomers(backend({ entitlements: [] }))
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.queryByText('Este módulo no está en tu plan')).not.toBeInTheDocument()
  })

  it('sin el addon la pestaña de cuentas explica qué falta, y no enseña una tabla vacía', async () => {
    const user = userEvent.setup()
    renderCustomers(backend({ entitlements: [] }))
    await screen.findByText('Acme')

    await user.click(screen.getByRole('tab', { name: 'Cuentas B2B' }))
    expect(await screen.findByText('Este módulo no está en tu plan')).toBeInTheDocument()
    // No es un error: nada falló.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('con el addon, las cuentas se abren y dicen desde qué importe hace falta aprobar', async () => {
    const user = userEvent.setup()
    renderCustomers(backend())
    await screen.findByText('Acme')

    await user.click(screen.getByRole('tab', { name: 'Cuentas B2B' }))
    expect(await screen.findByText('ACME')).toBeInTheDocument()
    expect(screen.getByText('5000.00')).toBeInTheDocument()
  })
})

describe('Área de cuenta del comprador', () => {
  function renderAccount(fake: FakeSupabase, session = fake.state.session) {
    holder.client = fake
    return renderWithProviders(<StoreAccountPage />, { session })
  }

  it('sin sesión invita a entrar, y no dice que no tienes empresa', async () => {
    const fake = backend()
    fake.state.session = null
    renderAccount(fake, null)

    expect(await screen.findByText('Inicia sesión para ver tu cuenta')).toBeInTheDocument()
    expect(screen.queryByText('Tu usuario no está vinculado a ninguna empresa')).not.toBeInTheDocument()
  })

  /**
   * Con sesión y sin cuenta de empresa: la cuenta del CONSUMIDOR (hardening H02).
   *
   * Antes esta persona leía «tu usuario no está vinculado a ninguna empresa».
   * Cierto, e inútil para quien compra para sí: le decía que su cuenta estaba
   * rota. Lo que se exige ahora es más, no menos: que vea SU cuenta, que no se
   * le hable de empresas, y que el contexto B2B siga saliendo de UNA llamada sin
   * argumentos.
   */
  it('con sesión y sin vínculo ve su cuenta de consumidor, no un aviso de empresa', async () => {
    const fake = backend({ rpc: { my_business_accounts: () => [], my_pending_business_accounts: () => [] } })
    renderAccount(fake)

    expect(await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Mis datos' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Avisos' })).toBeInTheDocument()
    expect(screen.queryByText('Tu usuario no está vinculado a ninguna empresa')).not.toBeInTheDocument()
    // Ni una pestaña del portal B2B.
    expect(screen.queryByRole('tab', { name: 'Estado de cuenta' })).not.toBeInTheDocument()
    expect(fake.state.rpcCalls.find((c) => c.name === 'my_business_accounts')?.args ?? {}).toEqual({})
  })

  /**
   * Vinculado como invitado, todavía sin activar.
   *
   * Antes esta persona leía «no estás vinculado a ninguna empresa», que era
   * falso, y no sabía que solo le faltaba pedir la activación. Pasó de verdad
   * probando la demo.
   */
  it('vinculado pero sin activar, nombra la empresa y dice qué falta', async () => {
    renderAccount(
      backend({
        rpc: {
          my_business_accounts: () => [],
          my_pending_business_accounts: () => [
            { name: 'Policlinico Andino SAC', invited_at: '2026-09-12T04:38:42.000Z' },
          ],
        },
      }),
    )

    expect(
      await screen.findByText('Tu acceso a Policlinico Andino SAC está pendiente de activación'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Tu usuario no está vinculado a ninguna empresa')).not.toBeInTheDocument()
  })

  it('con vínculo enseña rol, sucursales y direcciones — todo de UNA llamada sin argumentos', async () => {
    const calls: Array<Record<string, unknown>> = []
    const fake = backend({
      rpc: {
        my_business_accounts: (...args: unknown[]) => {
          calls.push((args[0] ?? {}) as Record<string, unknown>)
          return [
            {
              account_id: ACCOUNT,
              code: 'ACME',
              name: 'Acme',
              customer_name: 'Acme S.A.C.',
              customer_kind: 'company',
              role: 'buyer',
              status: 'active',
              spending_limit: '1000.00',
              requires_approval: true,
              approval_threshold: '5000.00',
              purchase_order_required: false,
              default_location_id: null,
              locations: [
                { id: LOCATION, code: 'LIM', name: 'Planta Lima', is_default: true, address_id: ADDRESS },
              ],
              addresses: [
                {
                  id: ADDRESS,
                  label: 'Almacén Lima',
                  recipient: null,
                  line1: 'Av. Siempre Viva 742',
                  line2: null,
                  city: 'Lima',
                  region: null,
                  postal_code: null,
                  country: 'PE',
                  is_shipping: true,
                  is_billing: false,
                  is_default_shipping: true,
                  is_default_billing: false,
                  verification: 'verified',
                },
              ],
            },
          ]
        },
      },
    })

    renderAccount(fake)

    // El área de cuenta pasó a tener secciones (pedidos, estado de cuenta,
    // cupones y datos): los datos de la empresa viven en su pestaña. Lo que
    // esta prueba vigila —que el vínculo lo resuelva el servidor sin recibir
    // ningún identificador— no cambia por eso.
    await userEvent.click(await screen.findByRole('tab', { name: 'Mi cuenta' }))

    expect(await screen.findByText('Acme S.A.C. · ACME')).toBeInTheDocument()
    expect(screen.getByText('Comprador')).toBeInTheDocument()
    expect(screen.getByText('LIM · Planta Lima')).toBeInTheDocument()
    expect(screen.getByText('Av. Siempre Viva 742, Lima, PE')).toBeInTheDocument()

    // La regla 8 de la fase, comprobada sobre lo que se envía: el cuerpo de la
    // llamada no lleva NI UN identificador. El vínculo lo pone el servidor.
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls[0])).toBe('{}')
  })
})
