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
 * El motor de precios en pantalla (P04-SaaS).
 *
 * Lo que se comprueba aquí no es el cálculo —eso vive en el servidor y se
 * prueba contra Postgres real— sino las tres cosas que solo se ven montando el
 * árbol: que la pantalla es una sola con pestañas y un buscador por listado
 * (§8), que el módulo está gateado por lo que la sociedad CONTRATÓ, y que el
 * diagnóstico distingue el empate ambiguo —que rompe el precio— de las cuatro
 * formas de que una lista simplemente no se aplique.
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
const { PricingPage } = await import('./PricingPage')

const LIST_ID = '77777777-7777-4777-8777-777777777701'
const OTHER_LIST_ID = '77777777-7777-4777-8777-777777777702'
const SEGMENT_ID = '77777777-7777-4777-8777-777777777703'
const EVENT_ID = '77777777-7777-4777-8777-777777777704'
const PRODUCT_A = '77777777-7777-4777-8777-7777777777a1'
const PRODUCT_B = '77777777-7777-4777-8777-7777777777a2'
const ITEM_A = '77777777-7777-4777-8777-7777777777b1'
const ITEM_B = '77777777-7777-4777-8777-7777777777b2'

const PRICING = ['ecommerce.pricing.lists']

function backend(options: { entitlements?: string[] } = {}): FakeSupabase {
  const { entitlements = PRICING } = options
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
      price_lists: [
        {
          id: LIST_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code: 'mayorista',
          name: 'Mayorista',
          currency: 'PEN',
          priority: 100,
          valid_from: '2026-01-01T00:00:00.000Z',
          valid_to: null,
          is_active: true,
          notes: null,
        },
        {
          id: OTHER_LIST_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code: 'temporada',
          name: 'Temporada',
          currency: 'PEN',
          priority: 100,
          valid_from: '2026-01-01T00:00:00.000Z',
          valid_to: '2026-02-01T00:00:00.000Z',
          is_active: true,
          notes: null,
        },
      ],
      price_list_items: [
        {
          id: ITEM_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          price_list_id: LIST_ID,
          product_id: PRODUCT_A,
          variant_id: null,
          uom_id: null,
          min_quantity: '1.000000',
          unit_price: '80.00',
          // Con «antes»: es el renglón que sale en la banda de ofertas.
          compare_at_price: '100.00',
        },
        {
          id: ITEM_B,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          price_list_id: LIST_ID,
          product_id: PRODUCT_B,
          variant_id: null,
          uom_id: null,
          min_quantity: '1.000000',
          unit_price: '25.00',
          compare_at_price: null,
        },
      ],
      price_list_assignments: [],
      customer_segments: [
        {
          id: SEGMENT_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'mayorista',
          name: 'Mayoristas',
          description: null,
          is_active: true,
        },
      ],
      price_change_events: [
        {
          id: EVENT_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          price_list_id: LIST_ID,
          product_id: null,
          action: 'update',
          old_unit_price: '10.00',
          new_unit_price: '8.00',
          actor_email: 'duenio@negocio.com',
          occurred_at: '2026-06-01T10:00:00.000Z',
        },
      ],
      channels: [],
      products: [
        {
          id: PRODUCT_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          sku: 'JAR-500',
          name: 'Jarabe para la tos 500 ml',
          kind: 'simple',
        },
        {
          id: PRODUCT_B,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          sku: 'VIT-C',
          name: 'Vitamina C 1 g',
          kind: 'simple',
        },
      ],
      product_variants: [],
      product_uoms: [],
      units_of_measure: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      price_list_conflicts: () => [
        {
          kind: 'ambiguous_priority',
          price_list_id: LIST_ID,
          price_list_code: 'mayorista',
          other_list_id: OTHER_LIST_ID,
          other_list_code: 'temporada',
          scope: 'store',
          detail: 'Misma prioridad (100) y vigencias solapadas en el mismo alcance',
        },
        {
          kind: 'currency_mismatch',
          price_list_id: OTHER_LIST_ID,
          price_list_code: 'temporada',
          other_list_id: null,
          other_list_code: null,
          scope: null,
          detail: 'La lista esta en USD y la tienda vende en PEN',
        },
      ],
    },
  })
}

function renderPricing(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="pricing.lists">
          <PricingPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
  // Las pestañas hacen deep-link con `#hash`: sin limpiarlo, el test anterior
  // decide qué pestaña abre el siguiente.
  window.history.replaceState(null, '', '/')
})

describe('Precios — la pantalla', () => {
  it('es una sola pantalla con cuatro pestañas centradas, no cuatro entradas de menú', async () => {
    renderPricing(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Listas',
      'Segmentos',
      'Simulador',
      'Diagnóstico',
    ])
  })

  it('lista los acuerdos con su vigencia y con un único buscador general', async () => {
    renderPricing(backend())
    expect(await screen.findByText('Mayorista')).toBeInTheDocument()
    expect(screen.getByText('mayorista')).toBeInTheDocument()
    // La prioridad se enseña: es el único dial del operador. Las dos listas la
    // tienen a 100 —de ahí el empate que denuncia el diagnóstico—, así que se
    // esperan dos celdas y no una.
    expect(screen.getAllByText('100')).toHaveLength(2)
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  it('marca como caducada la lista cuya ventana terminó', async () => {
    renderPricing(backend())
    expect(await screen.findByText('Temporada')).toBeInTheDocument()
    expect(screen.getByText('Caducada')).toBeInTheDocument()
    expect(screen.getByText('Vigente')).toBeInTheDocument()
  })

  it('el buscador filtra por nombre sin volver a consultar', async () => {
    const user = userEvent.setup()
    renderPricing(backend())
    expect(await screen.findByText('Temporada')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), 'mayor')
    expect(screen.queryByText('Temporada')).not.toBeInTheDocument()
    expect(screen.getByText('Mayorista')).toBeInTheDocument()
  })

  it('los segmentos son vocabulario de la sociedad y tienen su pestaña', async () => {
    const user = userEvent.setup()
    renderPricing(backend())
    await screen.findByText('Mayorista')

    await user.click(screen.getByRole('tab', { name: 'Segmentos' }))
    expect(await screen.findByText('Mayoristas')).toBeInTheDocument()
  })

  it('el diagnóstico separa el empate que rompe el precio de lo que solo lo deja sin efecto', async () => {
    const user = userEvent.setup()
    renderPricing(backend())
    await screen.findByText('Mayorista')

    await user.click(screen.getByRole('tab', { name: 'Diagnóstico' }))

    expect(await screen.findByText('Empate ambiguo')).toBeInTheDocument()
    expect(screen.getByText('Moneda distinta')).toBeInTheDocument()
    // El ambiguo levanta un aviso propio arriba: es el único que hace que el
    // precio dependa de un desempate interno.
    expect(
      screen.getByText(/el precio lo decide un desempate interno/i),
    ).toBeInTheDocument()
  })

  it('la bitácora enseña quién cambió el precio y desde qué valor', async () => {
    const user = userEvent.setup()
    renderPricing(backend())
    await screen.findByText('Mayorista')

    await user.click(screen.getByRole('tab', { name: 'Diagnóstico' }))
    expect(await screen.findByText('10.00 → 8.00')).toBeInTheDocument()
    expect(screen.getByText('duenio@negocio.com')).toBeInTheDocument()
  })
})

/**
 * Los renglones de una lista.
 *
 * Las tres cosas que esta tabla no podía hacer y que sí hacen falta para
 * gobernar la banda de ofertas de la vitrina: saber QUÉ producto es cada
 * renglón, encontrarlo entre cientos, y corregirlo sin borrarlo.
 */
describe('Precios — los renglones de una lista', () => {
  async function abrirPrecios(user: ReturnType<typeof userEvent.setup>) {
    renderPricing(backend())
    await user.click(await screen.findByRole('button', { name: 'Editar: Mayorista' }))
    await user.click(await screen.findByRole('tab', { name: 'Precios' }))
  }

  it('cada renglón dice qué producto es, no su identificador', async () => {
    const user = userEvent.setup()
    await abrirPrecios(user)

    // El nombre sale del catálogo de la tienda, no de los resultados del
    // buscador de arriba: sin eso la tabla era una lista de uuid recortados.
    expect(await screen.findByText('JAR-500 · Jarabe para la tos 500 ml')).toBeInTheDocument()
    expect(screen.getByText('VIT-C · Vitamina C 1 g')).toBeInTheDocument()
  })

  it('el buscador de la tabla encuentra un renglón sin pasar página por página', async () => {
    const user = userEvent.setup()
    await abrirPrecios(user)
    expect(await screen.findByText('JAR-500 · Jarabe para la tos 500 ml')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Buscar en la lista por SKU o nombre'), 'VIT-C')

    expect(screen.queryByText('JAR-500 · Jarabe para la tos 500 ml')).not.toBeInTheDocument()
    expect(screen.getByText('VIT-C · Vitamina C 1 g')).toBeInTheDocument()
  })

  it('el interruptor deja ver de una vez lo que está saliendo rebajado', async () => {
    const user = userEvent.setup()
    await abrirPrecios(user)
    expect(await screen.findByText('VIT-C · Vitamina C 1 g')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Solo con precio tachado' }))

    expect(screen.getByText('JAR-500 · Jarabe para la tos 500 ml')).toBeInTheDocument()
    expect(screen.queryByText('VIT-C · Vitamina C 1 g')).not.toBeInTheDocument()
  })

  it('quitar el precio tachado ACTUALIZA el renglón, no lo duplica', async () => {
    const user = userEvent.setup()
    const fake = backend()
    holder.client = fake
    renderWithProviders(
      <TenantProvider>
        <CapabilitiesProvider>
          <CapabilityGate capability="pricing.lists">
            <PricingPage />
          </CapabilityGate>
        </CapabilitiesProvider>
      </TenantProvider>,
      { session: fake.state.session },
    )
    await user.click(await screen.findByRole('button', { name: 'Editar: Mayorista' }))
    await user.click(await screen.findByRole('tab', { name: 'Precios' }))
    expect(await screen.findByText('JAR-500 · Jarabe para la tos 500 ml')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar 80.00' }))
    await user.clear(screen.getByLabelText('Precio tachado'))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    // Sigue habiendo DOS renglones: el camino viejo era borrar y volver a
    // crear, y ahí es donde se perdía el precio si algo fallaba en medio.
    const filas = fake.state.tables.price_list_items as { id: string; compare_at_price: unknown }[]
    expect(filas).toHaveLength(2)
    expect(filas.find((fila) => fila.id === ITEM_A)?.compare_at_price).toBeNull()
  })
})

describe('Precios — gating por lo contratado', () => {
  it('sin el addon, la pantalla no se monta y se explica por qué', async () => {
    renderPricing(backend({ entitlements: [] }))

    expect(await screen.findByText('Este módulo no está en tu plan')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Listas' })).not.toBeInTheDocument()
    // No es un error: nada falló.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('con el addon, las listas se abren sin más', async () => {
    renderPricing(backend())
    expect(await screen.findByRole('tab', { name: 'Listas' })).toBeInTheDocument()
  })
})
