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
  makePlatformContext,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'
import type { Product } from '../types'

/**
 * El PIM en pantalla (P03-SaaS).
 *
 * Tres cosas que no se ven mirando el SQL y que aquí se comprueban sobre el
 * árbol real: que el vocabulario del catálogo tiene su pantalla y se escribe
 * SIN que el tenant salga de un campo, que las pestañas del producto aparecen
 * y desaparecen con el módulo contratado, y que la variante se edita desde su
 * propia pestaña en vez de un formulario monolítico.
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
const { PimPage } = await import('./PimPage')
const { ProductDrawer } = await import('../ProductDrawer')

const PRODUCT_ID = '88888888-8888-4888-8888-888888888888'
const VARIANT_ID = '99999999-9999-4999-8999-999999999911'
const BRAND_ID = '99999999-9999-4999-8999-999999999922'
const ATTRIBUTE_ID = '99999999-9999-4999-8999-999999999933'
const VALUE_ID = '99999999-9999-4999-8999-999999999944'
const UNIT_ID = '99999999-9999-4999-8999-999999999955'

const ADVANCED = ['ecommerce.catalog.advanced']

function variantProduct() {
  return {
    id: PRODUCT_ID,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    category_id: null,
    sku: 'A-CAMISETA',
    name: 'Camiseta',
    slug: 'camiseta',
    description: null,
    status: 'draft' as const,
    price: '60.00',
    compare_at_price: null,
    currency: 'PEN',
    stock: 0,
    published_at: null,
    updated_at: '2026-08-27T00:00:00.000Z',
    kind: 'variant',
    brand_id: null,
    family_id: null,
  } satisfies Product
}

function backend(options: { entitlements?: string[] } = {}): FakeSupabase {
  const { entitlements = ADVANCED } = options
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
      brands: [
        {
          id: BRAND_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'aurora',
          name: 'Aurora',
          description: null,
          is_active: true,
        },
      ],
      product_families: [],
      attributes: [
        {
          id: ATTRIBUTE_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'color',
          name: 'Color',
          data_type: 'option',
          unit: null,
          is_variant_axis: true,
          is_filterable: true,
          position: 0,
          is_active: true,
        },
      ],
      attribute_values: [
        {
          id: VALUE_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          attribute_id: ATTRIBUTE_ID,
          code: 'rojo',
          label: 'Rojo',
          position: 0,
          is_active: true,
        },
      ],
      units_of_measure: [
        {
          id: UNIT_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'CAJA',
          name: 'Caja x 12',
          symbol: null,
          is_active: true,
        },
      ],
      product_variants: [
        {
          id: VARIANT_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          product_id: PRODUCT_ID,
          sku: 'A-CAMISETA-ROJO',
          name: 'Rojo',
          price: null,
          compare_at_price: null,
          stock: 7,
          barcode: null,
          position: 0,
          is_active: true,
          is_default: true,
        },
      ],
      variant_attribute_values: [
        {
          id: '99999999-9999-4999-8999-999999999966',
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          variant_id: VARIANT_ID,
          attribute_id: ATTRIBUTE_ID,
          value_id: VALUE_ID,
        },
      ],
      product_uoms: [],
      bundle_items: [],
      product_relations: [],
      product_images: [],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
    },
  })
}

function renderPim(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <PimPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

function renderDrawer(fake: FakeSupabase, product: Product | null) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <ProductDrawer
          open
          product={product}
          categories={[]}
          products={product ? [product] : []}
          organizationId={ORG}
          companyId={COMPANY_A}
          storeId={STORE_A}
          currency="PEN"
          canWrite
          onClose={() => {}}
        />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('Catálogo avanzado — vocabulario de la sociedad', () => {
  it('se organiza en pestañas centradas, no en cuatro entradas de menú', async () => {
    renderPim(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Marcas',
      'Familias',
      'Atributos',
      'Unidades',
    ])
  })

  it('lista las marcas de la sociedad con un único buscador general', async () => {
    renderPim(backend())
    expect(await screen.findByText('Aurora')).toBeInTheDocument()
    // Un buscador, y solo uno: nada de panel de filtros multi-campo (§8).
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  it('el buscador filtra por nombre y por código', async () => {
    const user = userEvent.setup()
    renderPim(backend())
    await screen.findByText('Aurora')

    await user.type(screen.getByRole('searchbox'), 'boreal')
    await waitFor(() => expect(screen.queryByText('Aurora')).not.toBeInTheDocument())
    expect(screen.getByText('Nada coincide con tu búsqueda')).toBeInTheDocument()
  })

  it('crear una marca escribe el tenant del JWT, no un campo del formulario', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPim(fake)
    await screen.findByText('Aurora')

    await user.click(screen.getByRole('button', { name: 'Nueva marca' }))
    const drawer = await screen.findByRole('dialog')
    await user.type(within(drawer).getByLabelText('Nombre'), 'Boreal')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.tables.brands).toHaveLength(2))
    const created = fake.state.tables.brands?.[1] as Record<string, unknown>
    expect(created.name).toBe('Boreal')
    // El código se sugiere desde el nombre, como el slug del producto.
    expect(created.code).toBe('boreal')
    expect(created.organization_id).toBe(ORG)
    expect(created.company_id).toBe(COMPANY_A)

    // Y el formulario NO tiene un campo de tenant que alguien pueda teclear.
    expect(within(drawer).queryByLabelText(/organization/i)).not.toBeInTheDocument()
    expect(within(drawer).queryByLabelText(/sociedad/i)).not.toBeInTheDocument()
  })

  it('el atributo enseña sus valores admitidos y deja añadir uno', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPim(fake)

    await user.click(await screen.findByRole('tab', { name: 'Atributos' }))
    await user.click(await screen.findByRole('button', { name: /Editar: Color/ }))

    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Rojo')).toBeInTheDocument()

    // El formulario de valores tiene nombre accesible propio: sin el, sus
    // campos "Codigo" y los del atributo serian indistinguibles.
    const nuevoValor = within(drawer).getByRole('form', { name: 'Nuevo valor' })
    await user.type(within(nuevoValor).getByLabelText('Etiqueta'), 'Azul')
    await user.type(within(nuevoValor).getByLabelText('Código'), 'azul')
    await user.click(within(nuevoValor).getByRole('button', { name: 'Añadir' }))

    await waitFor(() => expect(fake.state.tables.attribute_values).toHaveLength(2))
    const created = fake.state.tables.attribute_values?.[1] as Record<string, unknown>
    expect(created.attribute_id).toBe(ATTRIBUTE_ID)
    expect(created.label).toBe('Azul')
  })
})

describe('El cajón del producto se gatea por `catalog.advanced`', () => {
  it('con el módulo contratado aparecen las pestañas del PIM', async () => {
    renderDrawer(backend(), variantProduct())
    const drawer = await screen.findByRole('dialog')

    await waitFor(() =>
      expect(within(drawer).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'General',
        'Imágenes',
        'Variantes',
        'Unidades',
        'Ficha técnica',
        'Relacionados',
      ]),
    )
  })

  it('sin el módulo, el catálogo simple sigue funcionando y las pestañas no salen', async () => {
    renderDrawer(backend({ entitlements: [] }), variantProduct())
    const drawer = await screen.findByRole('dialog')

    await waitFor(() =>
      expect(within(drawer).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'General',
        'Imágenes',
      ]),
    )
    // El campo de tipo tampoco: sin el módulo no hay nada que elegir.
    expect(within(drawer).queryByLabelText('Tipo de producto')).not.toBeInTheDocument()
  })

  it('la pestaña de variantes lista la variante con su precio heredado', async () => {
    const user = userEvent.setup()
    renderDrawer(backend(), variantProduct())
    const drawer = await screen.findByRole('dialog')

    await user.click(await within(drawer).findByRole('tab', { name: 'Variantes' }))

    expect(await within(drawer).findByText('A-CAMISETA-ROJO')).toBeInTheDocument()
    // Hereda 60.00 del maestro y se dice que lo hereda, en vez de repetir la
    // cifra como si fuera suya.
    expect(within(drawer).getByText(/60,00|60\.00/)).toBeInTheDocument()
    expect(within(drawer).getByText('Hereda del producto')).toBeInTheDocument()
    // El eje resuelto: la variante ES "Rojo".
    expect(within(drawer).getAllByText('Rojo').length).toBeGreaterThan(0)
  })

  it('una variante nueva se guarda con su tenant y sus ejes', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderDrawer(fake, variantProduct())
    const drawer = await screen.findByRole('dialog')

    await user.click(await within(drawer).findByRole('tab', { name: 'Variantes' }))
    await user.click(await within(drawer).findByRole('button', { name: 'Nueva variante' }))

    // Cadenas cortas a proposito: cada pulsacion repinta el cajon entero y
    // `user.type` es la parte lenta de este test.
    const form = await within(drawer).findByRole('form', { name: 'Nueva variante' })
    await user.type(within(form).getByLabelText('SKU'), 'V-AZUL')
    await user.type(within(form).getByLabelText('Nombre'), 'Azul')

    await user.click(within(form).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.tables.product_variants).toHaveLength(2))
    const created = fake.state.tables.product_variants?.[1] as Record<string, unknown>
    expect(created.sku).toBe('V-AZUL')
    expect(created.product_id).toBe(PRODUCT_ID)
    expect(created.organization_id).toBe(ORG)
    expect(created.company_id).toBe(COMPANY_A)
    // Precio vacío = hereda. Guardar 0 aquí sería regalar el producto.
    expect(created.price).toBeNull()
  })

  it('un producto simple no ofrece la pestaña de componentes de kit', async () => {
    renderDrawer(backend(), { ...variantProduct(), kind: 'simple' })
    const drawer = await screen.findByRole('dialog')

    await waitFor(() => {
      const labels = within(drawer).getAllByRole('tab').map((tab) => tab.textContent)
      expect(labels).not.toContain('Componentes')
      expect(labels).not.toContain('Variantes')
    })
  })
})
