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
 * El inventario en pantalla (P06-SaaS).
 *
 * Lo que se comprueba aquí no es el reparto —eso vive en el servidor y se
 * prueba contra Postgres real— sino las cuatro cosas que solo se ven montando
 * el árbol: que es UNA pantalla con pestañas y un buscador por listado (§8),
 * que el módulo está gateado por lo que la sociedad CONTRATÓ, que las tres
 * cifras del almacén se distinguen (física, comprometida y disponible) y que
 * la regla «sin almacenes declarados, todos abastecen» está escrita donde se
 * configura y no solo en el SQL.
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
const { InventoryPage } = await import('./InventoryPage')

const LIMA = '88888888-8888-4888-8888-888888888801'
const AQP = '88888888-8888-4888-8888-888888888802'
const LEVEL = '88888888-8888-4888-8888-888888888803'
const PRODUCT = '88888888-8888-4888-8888-888888888804'
const MOVEMENT = '88888888-8888-4888-8888-888888888805'

const MULTIWAREHOUSE = ['ecommerce.inventory.multiwarehouse']

function backend(options: { entitlements?: string[]; links?: boolean } = {}): FakeSupabase {
  const { entitlements = MULTIWAREHOUSE, links = false } = options
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
      warehouses: [
        {
          id: LIMA,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'LIMA',
          name: 'CD Lima',
          kind: 'warehouse',
          source: 'local',
          stale_after: null,
          stale_policy: 'unknown',
          allows_backorder: false,
          priority: 10,
          is_active: true,
          is_default: true,
          city: 'Lima',
          country: 'PE',
        },
        {
          id: AQP,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'ERP-AQP',
          name: 'Arequipa (ERP)',
          kind: 'virtual',
          source: 'erp',
          stale_after: '01:00:00',
          stale_policy: 'unknown',
          allows_backorder: true,
          priority: 20,
          is_active: true,
          is_default: false,
          city: null,
          country: null,
        },
      ],
      store_warehouses: links
        ? [
            {
              id: '88888888-8888-4888-8888-888888888806',
              organization_id: ORG,
              company_id: COMPANY_A,
              store_id: STORE_A,
              warehouse_id: LIMA,
              priority: 10,
              is_active: true,
            },
          ]
        : [],
      inventory_levels: [
        {
          id: LEVEL,
          organization_id: ORG,
          company_id: COMPANY_A,
          warehouse_id: LIMA,
          store_id: STORE_A,
          product_id: PRODUCT,
          variant_id: null,
          on_hand_qty: '10.000000',
          reserved_qty: '4.000000',
          available_qty: '6.000000',
          safety_stock: '1.000000',
          reorder_point: '8.000000',
          synced_at: '2026-08-27T10:00:00.000Z',
          allow_backorder: false,
        },
      ],
      inventory_movements: [
        {
          id: MOVEMENT,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          warehouse_id: LIMA,
          product_id: PRODUCT,
          variant_id: null,
          kind: 'receipt',
          quantity: '10.000000',
          on_hand_after: '10.000000',
          reason: 'compra a proveedor',
          reference_kind: 'manual',
          reference_id: null,
          external_ref: null,
          source: 'local',
          occurred_at: '2026-08-27T10:00:00.000Z',
        },
      ],
      inventory_reservations: [],
      inventory_alerts: [
        {
          store_id: STORE_A,
          warehouse_id: LIMA,
          warehouse_code: 'LIMA',
          product_id: PRODUCT,
          variant_id: null,
          sku: 'A-JABON',
          name: 'Jabón',
          kind: 'below_reorder',
          available_qty: '6.000000',
          reorder_point: '8.000000',
          synced_at: '2026-08-27T10:00:00.000Z',
        },
        {
          store_id: STORE_A,
          warehouse_id: null,
          warehouse_code: null,
          product_id: PRODUCT,
          variant_id: null,
          sku: 'A-CAMISETA',
          name: 'Camiseta',
          kind: 'unmapped',
          available_qty: null,
          reorder_point: null,
          synced_at: null,
        },
      ],
      products: [
        { id: PRODUCT, store_id: STORE_A, sku: 'A-JABON', name: 'Jabón', kind: 'simple' },
      ],
      product_variants: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
    },
  })
}

function renderInventory(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="inventory.multiwarehouse">
          <InventoryPage />
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

describe('Inventario — la pantalla', () => {
  it('es una sola pantalla con cuatro pestañas centradas, no cuatro entradas de menú', async () => {
    renderInventory(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Almacenes',
      'Existencias',
      'Movimientos',
      'Alertas',
    ])
  })

  it('lista los almacenes con su origen y un único buscador general', async () => {
    renderInventory(backend())
    expect(await screen.findByText('CD Lima')).toBeInTheDocument()
    expect(screen.getByText('Arequipa (ERP)')).toBeInTheDocument()
    expect(screen.getByText('Sistema de gestión')).toBeInTheDocument()
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  it('dice, donde se configura, que sin almacenes declarados abastecen todos', async () => {
    renderInventory(backend({ links: false }))
    expect(
      await screen.findByText(/se sirve de todos los activos/i),
    ).toBeInTheDocument()
  })

  it('y deja de decirlo en cuanto la tienda declara uno', async () => {
    renderInventory(backend({ links: true }))
    await screen.findByText('CD Lima')
    expect(screen.queryByText(/se sirve de todos los activos/i)).not.toBeInTheDocument()
  })

  it('marca el almacén que admite venta bajo pedido', async () => {
    renderInventory(backend())
    expect(await screen.findByText('Bajo pedido')).toBeInTheDocument()
  })

  it('el buscador filtra sin volver a consultar', async () => {
    const user = userEvent.setup()
    renderInventory(backend())
    expect(await screen.findByText('Arequipa (ERP)')).toBeInTheDocument()

    await user.type(screen.getAllByRole('searchbox')[0] as HTMLElement, 'lima')
    expect(screen.queryByText('Arequipa (ERP)')).not.toBeInTheDocument()
    expect(screen.getByText('CD Lima')).toBeInTheDocument()
  })

  it('las existencias distinguen físico, comprometido y disponible', async () => {
    const user = userEvent.setup()
    renderInventory(backend())
    await screen.findByText('CD Lima')

    await user.click(screen.getByRole('tab', { name: 'Existencias' }))

    expect(await screen.findByText('A-JABON')).toBeInTheDocument()
    // 10 físico − 4 comprometido = 6 disponible. Las tres cifras están, porque
    // con una sola no se puede explicar por qué la tienda dice «agotado».
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('el libro mayor enseña el motivo y el saldo que dejó cada asiento', async () => {
    const user = userEvent.setup()
    renderInventory(backend())
    await screen.findByText('CD Lima')

    await user.click(screen.getByRole('tab', { name: 'Movimientos' }))

    expect(await screen.findByText('Entrada')).toBeInTheDocument()
    expect(screen.getByText('+10')).toBeInTheDocument()
    expect(screen.getByText('compra a proveedor')).toBeInTheDocument()
  })

  it('las alertas ponen delante lo que no se puede vender', async () => {
    const user = userEvent.setup()
    renderInventory(backend())
    await screen.findByText('CD Lima')

    await user.click(screen.getByRole('tab', { name: 'Alertas' }))

    const rows = await screen.findAllByRole('row')
    // Fila 0 es la cabecera. «Publicado sin existencia» pesa más que «bajo el
    // umbral», así que va primero aunque llegue después de la base.
    expect(rows[1]?.textContent).toContain('Publicado sin existencia')
    expect(rows[2]?.textContent).toContain('Bajo el umbral')
  })
})

describe('Inventario — gating por lo contratado', () => {
  it('sin el addon, la pantalla no se monta y se explica por qué', async () => {
    renderInventory(backend({ entitlements: [] }))

    expect(await screen.findByText('Este módulo no está en tu plan')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Almacenes' })).not.toBeInTheDocument()
    // No es un error: nada falló.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('con el addon, los almacenes se abren sin más', async () => {
    renderInventory(backend())
    expect(await screen.findByRole('tab', { name: 'Almacenes' })).toBeInTheDocument()
  })
})
