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
import { can } from '@/shared/lib/roles'
import { TENANT_FIELDS } from '../../../supabase/functions/_shared/auth'

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
const { ProductsPage } = await import('./ProductsPage')

/**
 * Listado de productos MAESTROS y administración de su publicación por tienda
 * (Stores + Product Master, fase 04).
 *
 * El doble sirve la vista `admin_product_masters` (una fila por maestro) y un
 * pequeño estado en memoria detrás de los RPC de publicación, para que publicar,
 * editar y quitar se vean reflejados como en la base. Quién puede hacer qué y el
 * aislamiento entre sociedades lo prueba Postgres de verdad en
 * `supabase/tests/product-master-commands.test.ts`.
 */

const PRODUCT_ID = '88888888-8888-4888-8888-888888888888'
const CATEGORY_ID = '77777777-7777-4777-8777-777777777777'
const CATEGORY_B_ID = '77777777-7777-4777-8777-7777777777bb'
const TAX_DEFAULT_ID = '66666666-6666-4666-8666-666666666661'
const TAX_EXEMPT_ID = '66666666-6666-4666-8666-666666666662'
const BRAND_ID = '77777777-7777-4777-8777-777777777771'
/** Una categoria HIJA: es la que demuestra que elegir la madre la incluye. */
const SUBCATEGORY_ID = '88888888-8888-4888-8888-888888888801'
const WAREHOUSE_ID = '66666666-6666-4666-8666-666666666666'
const STORE_B = '55555555-5555-4555-8555-5555555555bb'
const PUBLICATION_A = '44444444-4444-4444-8444-4444444444aa'

type Fila = Record<string, unknown>

function master(over: Fila = {}): Fila {
  return {
    id: PRODUCT_ID,
    organization_id: ORG,
    company_id: COMPANY_A,
    origin_store_id: STORE_A,
    sku: 'A-1',
    name: 'Silla A',
    description: null,
    kind: 'simple',
    brand_id: BRAND_ID,
    brand_name: 'Nordica',
    family_id: null,
    family_name: null,
    tax_category_id: null,
    stock: 4,
    legacy_sku_conflict: false,
    updated_at: '2026-08-27T00:00:00.000Z',
    publication_count: 1,
    published_count: 0,
    store_ids: [STORE_A],
    published_store_names: [],
    category_ids: [CATEGORY_ID],
    publication_state: 'draft',
    ...over,
  }
}

function defaultMasters(): Fila[] {
  return [master()]
}

/**
 * Tres maestros, para poder comprobar que un filtro DEJA FUERA algo. El segundo
 * no tiene marca ni categoría; el tercero cuelga de la HIJA de «Sillas».
 */
function catalogoAmplio(): Fila[] {
  return [
    ...defaultMasters(),
    master({
      id: '99999999-9999-4999-8999-999999999999',
      sku: 'Z-9',
      name: 'Mesa Z',
      brand_id: null,
      brand_name: null,
      stock: 40,
      category_ids: [],
      updated_at: '2026-08-28T00:00:00.000Z',
    }),
    master({
      id: '11111111-2222-4333-8444-555555555555',
      sku: 'O-1',
      name: 'Banqueta O',
      brand_id: null,
      brand_name: null,
      stock: 12,
      category_ids: [SUBCATEGORY_ID],
      updated_at: '2026-08-29T00:00:00.000Z',
    }),
  ]
}

interface Publicacion {
  store_id: string
  store_name: string
  store_slug: string
  store_currency: string
  is_origin: boolean
  publication_id: string | null
  category_id: string | null
  slug: string | null
  status: string | null
  price: string | null
}

/** Las dos tiendas de la sociedad: el producto está en A y todavía no en B. */
function tiendasIniciales(): Publicacion[] {
  return [
    {
      store_id: STORE_A,
      store_name: 'Mi Negocio',
      store_slug: 'mi-negocio',
      store_currency: 'PEN',
      is_origin: true,
      publication_id: PUBLICATION_A,
      category_id: CATEGORY_ID,
      slug: 'silla-a',
      status: 'published',
      price: '199.90',
    },
    {
      store_id: STORE_B,
      store_name: 'Outlet',
      store_slug: 'outlet',
      store_currency: 'PEN',
      is_origin: false,
      publication_id: null,
      category_id: null,
      slug: null,
      status: null,
      price: null,
    },
  ]
}

/**
 * Las tiendas de la SOCIEDAD, tal y como las devuelve `stores` al resolver el
 * espacio de trabajo. Por defecto hay una; con dos aparece el filtro de tienda.
 */
function unaTienda(): Fila[] {
  return [
    {
      id: STORE_A,
      organization_id: ORG,
      company_id: COMPANY_A,
      slug: 'mi-negocio',
      name: 'Mi Negocio',
      status: 'active',
      currency: 'PEN',
    },
  ]
}

function conDosTiendas(): Fila[] {
  return [
    ...unaTienda(),
    {
      id: STORE_B,
      organization_id: ORG,
      company_id: COMPANY_A,
      slug: 'outlet',
      name: 'Outlet',
      status: 'active',
      currency: 'PEN',
    },
  ]
}

function backend(
  role: 'admin' | 'viewer' | 'catalog' = 'admin',
  masters = defaultMasters(),
  tiendasDeLaSociedad = unaTienda(),
  tiendas = tiendasIniciales(),
): FakeSupabase {
  const nombreCategoria = new Map([
    [CATEGORY_ID, 'Sillas'],
    [CATEGORY_B_ID, 'Liquidación'],
  ])
  const filas = () =>
    tiendas.map((tienda) => ({
      ...tienda,
      store_status: 'active',
      category_name: tienda.category_id ? (nombreCategoria.get(tienda.category_id) ?? null) : null,
      published_at: tienda.status === 'published' ? '2026-09-01T00:00:00.000Z' : null,
      compare_at_price: null,
      currency: tienda.publication_id ? tienda.store_currency : null,
      updated_at: tienda.publication_id ? '2026-09-01T00:00:00.000Z' : null,
    }))

  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
      ],
      stores: tiendasDeLaSociedad,
      tax_categories: [
        { id: TAX_DEFAULT_ID, code: 'igv18', name: 'IGV general (18%)', is_default: true },
        { id: TAX_EXEMPT_ID, code: 'exonerado', name: 'Exonerado', is_default: false },
      ],
      brands: [
        {
          id: BRAND_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'nordica',
          name: 'Nordica',
          description: null,
          is_active: true,
        },
      ],
      // Las categorías son de CADA tienda: A tiene su árbol y B el suyo.
      categories: [
        { id: CATEGORY_ID, store_id: STORE_A, parent_id: null, slug: 'sillas', name: 'Sillas', position: 0, is_active: true },
        {
          id: SUBCATEGORY_ID,
          store_id: STORE_A,
          parent_id: CATEGORY_ID,
          slug: 'sillas-de-oficina',
          name: 'Sillas de oficina',
          position: 0,
          is_active: true,
        },
        { id: CATEGORY_B_ID, store_id: STORE_B, parent_id: null, slug: 'liquidacion', name: 'Liquidación', position: 0, is_active: true },
      ],
      products: masters,
      admin_product_masters: masters,
      product_images: [],
    },
    rpc: {
      product_deletion_usage: () => ({
        name: 'Silla A',
        order_lines: 2,
        images: 3,
        variants: 0,
        bundles: 0,
        publications: 1,
      }),
      delete_product_master: () => {
        throw { message: 'PRODUCTO_PUBLICADO: quitalo de todas las tiendas antes de borrarlo' }
      },
      product_store_publications: () => filas(),
      publish_product: (args) => {
        const tienda = tiendas.find((row) => row.store_id === args.p_store_id)
        if (!tienda) throw { message: 'TIENDA_NO_ENCONTRADA: no' }
        Object.assign(tienda, {
          publication_id: '44444444-4444-4444-8444-4444444444bb',
          slug: args.p_slug,
          price: args.p_price,
          status: args.p_status,
          category_id: args.p_category_id,
        })
        return {}
      },
      update_product_publication: (args) => {
        const tienda = tiendas.find((row) => row.store_id === args.p_store_id)
        if (!tienda) throw { message: 'PUBLICACION_NO_ENCONTRADA: no' }
        if (args.p_slug) tienda.slug = String(args.p_slug)
        if (args.p_price) tienda.price = String(args.p_price)
        if (args.p_status) tienda.status = String(args.p_status)
        if (args.p_category_id) tienda.category_id = String(args.p_category_id)
        if (args.p_clear_category) tienda.category_id = null
        return {}
      },
      unpublish_product: (args) => {
        const tienda = tiendas.find((row) => row.store_id === args.p_store_id)
        if (tienda) Object.assign(tienda, { publication_id: null, slug: null, price: null, status: null, category_id: null })
        return null
      },
    },
    functions: {
      'catalog-product': (body) => ({ id: String(body.product_id ?? PRODUCT_ID) }),
    },
  })
}

/**
 * El mismo tenant, con un almacén sirviendo a la tienda y el addon de
 * multialmacén contratado.
 */
function conAlmacenes(): FakeSupabase {
  const fake = backend()
  fake.state.tables.warehouses = [
    {
      id: WAREHOUSE_ID,
      organization_id: ORG,
      company_id: COMPANY_A,
      code: 'ALM-1',
      name: 'Almacen central',
      kind: 'warehouse',
      source: 'local',
      stale_after: null,
      stale_policy: 'unknown',
      allows_backorder: false,
      priority: 1,
      is_active: true,
      is_default: true,
      city: null,
      country: null,
    },
  ]
  fake.state.tables.store_warehouses = [
    {
      id: '66666666-6666-4666-8666-666666666667',
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      warehouse_id: WAREHOUSE_ID,
      priority: 1,
      is_active: true,
    },
  ]
  fake.state.rpc.effective_capabilities = () =>
    makePlatformContext({ entitlements: ['ecommerce.inventory.multiwarehouse'], source: 'hub' })
  fake.state.rpc.adjust_inventory = () => ({ ok: true })
  return fake
}

function renderPage(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <ProductsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

async function rowActions(name = 'Silla A') {
  const row = (await screen.findByText(name)).closest('tr')
  return within(row as HTMLElement)
}

/** Abre el cajón del producto en la pestaña «Tiendas». */
async function abrirTiendas(user: ReturnType<typeof userEvent.setup>) {
  const row = await rowActions()
  await user.click(row.getByRole('button', { name: /Editar: Silla A/ }))
  const drawer = await screen.findByRole('dialog')
  await user.click(within(drawer).getByRole('tab', { name: 'Tiendas' }))
  await within(drawer).findByText('Outlet')
  return drawer
}

beforeEach(() => {
  holder.client = null
})

describe('ProductsPage — listado de maestros', () => {
  it('lista el maestro UNA vez aunque esté en dos tiendas, con cuántas y cuáles', async () => {
    renderPage(
      backend('admin', [
        master({
          publication_count: 2,
          published_count: 2,
          store_ids: [STORE_A, STORE_B],
          published_store_names: ['Mi Negocio', 'Outlet'],
          publication_state: 'published',
        }),
      ]),
    )

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    const table = within(screen.getByRole('table'))
    expect(table.getAllByText('Silla A')).toHaveLength(1)
    expect(table.getAllByRole('row')).toHaveLength(2) // cabecera + un maestro
    expect(table.getByText('2 tiendas activas')).toBeInTheDocument()
    expect(table.getByText('Mi Negocio · Outlet')).toBeInTheDocument()
    expect(table.getByText('Publicado')).toBeInTheDocument()
  })

  it('no muestra un precio global: ni columna de precio ni importes', async () => {
    renderPage(backend())
    await screen.findByText('Silla A')
    const table = within(screen.getByRole('table'))
    expect(table.queryByRole('button', { name: 'Precio' })).not.toBeInTheDocument()
    expect(table.queryByText(/S\/|PEN/)).not.toBeInTheDocument()
    expect(table.getByText('A-1')).toBeInTheDocument()
    expect(table.getByText('Nordica')).toBeInTheDocument()
    expect(table.getByText('4')).toBeInTheDocument()
  })

  it('un maestro que no está en ninguna tienda lo dice', async () => {
    renderPage(backend('admin', [master({ publication_count: 0, store_ids: [], category_ids: [] })]))
    expect(await screen.findByText('Sin publicar')).toBeInTheDocument()
  })

  it('mientras se resuelve el espacio muestra esqueleto, no "no tienes tiendas"', () => {
    renderPage(backend())
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.queryByText('Todavía no tienes tiendas')).not.toBeInTheDocument()
  })

  it('sin productos muestra el estado vacio, no una tabla vacia', async () => {
    renderPage(backend('admin', []))
    expect(await screen.findByText('Aún no publicaste productos')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('un rol sin permiso de catalogo no ve el boton de alta', async () => {
    renderPage(backend('viewer'))
    await screen.findByText('Silla A')
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).not.toBeInTheDocument()
  })

  it('el rol catalog edita productos y publicaciones, pero no administra tiendas', async () => {
    expect(can('catalog', 'catalog.write')).toBe(true)
    expect(can('catalog', 'store.manage')).toBe(false)

    const user = userEvent.setup()
    renderPage(backend('catalog'))
    expect(await screen.findByRole('button', { name: 'Nuevo producto' })).toBeInTheDocument()
    const drawer = await abrirTiendas(user)
    expect(within(drawer).getByRole('button', { name: 'Publicar en esta tienda: Outlet' })).toBeInTheDocument()
  })

  it('ofrece un unico buscador general, sin panel de filtros multi-campo', async () => {
    renderPage(backend())
    await screen.findByText('Silla A')
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  it('busca tambien por marca, no solo por nombre', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Silla A')

    await user.type(screen.getByRole('searchbox'), 'Nordica')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Mesa Z')).not.toBeInTheDocument())
  })

  it('escribir no consulta: la tabla no cambia hasta pulsar Filtrar', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Mesa Z')

    await user.type(screen.getByRole('searchbox'), 'Silla')
    expect(screen.getByText('Mesa Z')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    await waitFor(() => expect(screen.queryByText('Mesa Z')).not.toBeInTheDocument())
  })

  it('el desplegable de marca acota a esa marca', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Mesa Z')

    await user.click(screen.getByRole('combobox', { name: 'Marca' }))
    await user.click(await screen.findByRole('option', { name: 'Nordica' }))
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Mesa Z')).not.toBeInTheDocument())
  })

  it('el stock minimo deja fuera lo que no llega', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Silla A')

    await user.type(screen.getByLabelText('Stock mínimo'), '10')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    expect(await screen.findByText('Mesa Z')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Silla A')).not.toBeInTheDocument())
  })

  it('elegir una categoria madre de la tienda activa incluye a sus hijas', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Banqueta O')

    await user.click(screen.getByRole('combobox', { name: 'Categoría' }))
    // Solo las categorías de la tienda activa: la de la otra tienda no se ofrece.
    expect(screen.queryByRole('option', { name: 'Liquidación' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Sillas' }))
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    expect(screen.getByText('Banqueta O')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Mesa Z')).not.toBeInTheDocument())
  })

  it('Limpiar devuelve la tabla entera y vacia los controles', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Silla A')

    await user.type(screen.getByLabelText('Stock mínimo'), '10')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    await waitFor(() => expect(screen.queryByText('Silla A')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Limpiar' }))

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    expect(screen.getByText('Mesa Z')).toBeInTheDocument()
    expect(screen.getByLabelText('Stock mínimo')).toHaveValue(null)
  })

  it('pulsar una columna ordena, y volver a pulsarla invierte', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Silla A')

    const tiendas = screen.getByRole('button', { name: 'Tiendas' })
    await user.click(tiendas)
    await waitFor(() => expect(tiendas.closest('th')).toHaveAttribute('aria-sort', 'ascending'))

    await user.click(tiendas)
    await waitFor(() => expect(tiendas.closest('th')).toHaveAttribute('aria-sort', 'descending'))
  })

  /**
   * La pantalla es el maestro de la SOCIEDAD y no se acota por la tienda
   * activa (ADR 018). Lo que sí hay es un filtro para preguntar «de todo esto,
   * qué se vende aquí», y el encabezado dice de quién es el catálogo para que
   * la lista no se lea como «los productos de la tienda en la que estoy».
   */
  it('el encabezado no atribuye el catalogo a la tienda activa', async () => {
    renderPage(backend('admin', catalogoAmplio(), conDosTiendas()))
    await screen.findByText('Silla A')
    expect(
      screen.getByText('Mi Negocio · Catálogo de la sociedad; cada producto se publica por tienda'),
    ).toBeInTheDocument()
  })

  it('el filtro de tienda deja solo lo que se vende en ella, sin cambiar de sociedad', async () => {
    const user = userEvent.setup()
    renderPage(
      backend(
        'admin',
        [
          master({ store_ids: [STORE_A] }),
          master({
            id: '99999999-9999-4999-8999-999999999999',
            sku: 'Z-9',
            name: 'Mesa Z',
            store_ids: [STORE_B],
            published_store_names: ['Outlet'],
          }),
        ],
        conDosTiendas(),
      ),
    )
    await screen.findByText('Mesa Z')

    await user.click(screen.getByRole('combobox', { name: 'Tienda' }))
    await user.click(await screen.findByRole('option', { name: 'Outlet' }))
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    expect(await screen.findByText('Mesa Z')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Silla A')).not.toBeInTheDocument())
  })

  it('con una sola tienda no se ofrece el filtro de tienda', async () => {
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Silla A')
    expect(screen.queryByRole('combobox', { name: 'Tienda' })).not.toBeInTheDocument()
  })

  it('las pestanas de estado son las tres del enum mas "Todos"', async () => {
    renderPage(backend())
    await screen.findByText('Silla A')
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Todos', 'Borrador', 'Publicado', 'Archivado'])
  })
})

describe('ProductsPage — alta y edicion del maestro', () => {
  it('el alta publicando en la tienda activa manda `create` con la tienda y SIN tenant', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    expect(within(drawer).getByRole('checkbox', { name: 'Publicar ya en Mi Negocio' })).toBeChecked()
    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa nueva')
    await user.type(within(drawer).getByLabelText('SKU'), 'MES-001')
    await user.type(within(drawer).getByLabelText('Precio'), '349.50')
    await user.clear(within(drawer).getByLabelText('Stock'))
    await user.type(within(drawer).getByLabelText('Stock'), '7')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const invocation = fake.state.invocations[0]
    expect(invocation?.name).toBe('catalog-product')
    expect(invocation?.body).toMatchObject({
      action: 'create',
      store_id: STORE_A,
      sku: 'MES-001',
      name: 'Mesa nueva',
      slug: 'mesa-nueva',
      price: '349.50',
      stock: 7,
      status: 'draft',
    })
    for (const field of TENANT_FIELDS) {
      expect(invocation?.body).not.toHaveProperty(field)
    }
  })

  it('el alta sin publicar crea solo el maestro: sin tienda, precio ni dirección', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')
    await user.click(within(drawer).getByRole('checkbox', { name: 'Publicar ya en Mi Negocio' }))
    expect(within(drawer).queryByLabelText('Precio')).not.toBeInTheDocument()

    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa maestra')
    await user.type(within(drawer).getByLabelText('SKU'), 'MES-010')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const body = fake.state.invocations[0]?.body as Record<string, unknown>
    expect(body).toMatchObject({ action: 'create', sku: 'MES-010', name: 'Mesa maestra' })
    for (const field of ['store_id', 'price', 'slug', 'status', 'category_id']) {
      expect(body).not.toHaveProperty(field)
    }
  })

  it('el impuesto elegido viaja con el producto', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Arroz')
    await user.type(within(drawer).getByLabelText('SKU'), 'ARR-001')
    await user.type(within(drawer).getByLabelText('Precio'), '4.50')

    await user.click(within(drawer).getByRole('combobox', { name: 'Impuesto' }))
    await user.click(await screen.findByRole('option', { name: 'Exonerado' }))
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]?.body).toMatchObject({ tax_category_id: TAX_EXEMPT_ID })
  })

  it('sin elegir impuesto viaja null, no se omite', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa')
    await user.type(within(drawer).getByLabelText('SKU'), 'MES-002')
    await user.type(within(drawer).getByLabelText('Precio'), '99.00')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const body = fake.state.invocations[0]?.body as Record<string, unknown>
    expect(body).toHaveProperty('tax_category_id')
    expect(body.tax_category_id).toBeNull()
  })

  it('con almacenes, el alta carga la existencia inicial en el almacen elegido', async () => {
    const user = userEvent.setup()
    const fake = conAlmacenes()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa nueva')
    await user.type(within(drawer).getByLabelText('SKU'), 'MES-002')
    await user.type(within(drawer).getByLabelText('Precio'), '349.50')
    await user.clear(within(drawer).getByLabelText('Stock'))
    await user.type(within(drawer).getByLabelText('Stock'), '12')

    expect(within(drawer).getByLabelText('Almacén de entrada')).toHaveTextContent('ALM-1')

    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(fake.state.rpcCalls.some((call) => call.name === 'adjust_inventory')).toBe(true),
    )
    const entrada = fake.state.rpcCalls.find((call) => call.name === 'adjust_inventory')
    expect(entrada?.args).toMatchObject({
      p_warehouse_id: WAREHOUSE_ID,
      p_product_id: PRODUCT_ID,
      p_quantity: 12,
      p_kind: 'receipt',
    })
  })

  it('sin almacenes NO se toca inventario: manda `products.stock`, como antes', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa nueva')
    await user.type(within(drawer).getByLabelText('SKU'), 'MES-003')
    await user.type(within(drawer).getByLabelText('Precio'), '349.50')
    expect(within(drawer).queryByLabelText('Almacén de entrada')).not.toBeInTheDocument()

    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.rpcCalls.some((call) => call.name === 'adjust_inventory')).toBe(false)
  })

  it('el slug se sugiere desde el nombre y viaja en minusculas con guiones', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')
    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa de Comedor')

    expect(within(drawer).getByLabelText('Dirección del producto')).toHaveValue('mesa-de-comedor')
  })

  it('un precio invalido se detiene en el cliente: no se llama a la funcion', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    await user.type(within(drawer).getByLabelText('Nombre'), 'Mesa nueva')
    await user.type(within(drawer).getByLabelText('SKU'), 'MES-001')
    await user.type(within(drawer).getByLabelText('Precio'), '19,90')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    expect(await within(drawer).findByText(/importe con hasta 2 decimales/i)).toBeInTheDocument()
    expect(fake.state.invocations).toHaveLength(0)
  })

  it('al editar, «Datos del producto» es del maestro: sin precio, dirección ni estado de tienda', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Editar: Silla A/ }))

    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByLabelText('Nombre')).toHaveValue('Silla A')
    expect(within(drawer).getByLabelText('SKU')).toHaveValue('A-1')
    expect(within(drawer).queryByLabelText('Precio')).not.toBeInTheDocument()
    expect(within(drawer).queryByLabelText('Dirección del producto')).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('checkbox', { name: /Publicar ya/ })).not.toBeInTheDocument()
  })

  it('editar el nombre del maestro manda solo campos del maestro, sin tienda', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Editar: Silla A/ }))
    const drawer = await screen.findByRole('dialog')
    await user.clear(within(drawer).getByLabelText('Nombre'))
    await user.type(within(drawer).getByLabelText('Nombre'), 'Silla Pro')
    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const body = fake.state.invocations[0]?.body as Record<string, unknown>
    expect(body).toMatchObject({ action: 'update', product_id: PRODUCT_ID, name: 'Silla Pro' })
    for (const field of ['store_id', 'price', 'slug', 'status', 'category_id', ...TENANT_FIELDS]) {
      expect(body).not.toHaveProperty(field)
    }
  })

  it('el producto sin guardar todavia no ofrece subir imagenes ni tiendas', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')
    await user.click(within(drawer).getByRole('tab', { name: 'Imágenes' }))
    expect(await within(drawer).findByText(/Guarda el producto y podrás subir sus imágenes/)).toBeInTheDocument()
    await user.click(within(drawer).getByRole('tab', { name: 'Tiendas' }))
    expect(await within(drawer).findByText(/Guarda el producto y podrás elegir en qué tiendas/)).toBeInTheDocument()
  })

  it('el cajon se organiza en pestanas: datos, tiendas e imagenes', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    expect(within(drawer).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Tiendas',
      'Imágenes',
    ])
  })
})

describe('ProductsPage — publicación por tienda', () => {
  it('muestra cada tienda de la sociedad con el estado del producto en ella', async () => {
    const user = userEvent.setup()
    renderPage(backend())
    const drawer = await abrirTiendas(user)

    const a = within(within(drawer).getByRole('region', { name: 'Mi Negocio' }))
    expect(a.getByText('Publicado')).toBeInTheDocument()
    expect(a.getByText('/silla-a')).toBeInTheDocument()
    expect(a.getByText('Sillas')).toBeInTheDocument()
    expect(a.getByText('S/ 199.90')).toBeInTheDocument()
    expect(a.getByRole('link', { name: 'Ver en la vitrina: Mi Negocio' })).toHaveAttribute(
      'href',
      '/s/mi-negocio/product/silla-a',
    )

    const b = within(within(drawer).getByRole('region', { name: 'Outlet' }))
    expect(b.getByText('No publicado')).toBeInTheDocument()
  })

  it('agregar la tienda B publica el MISMO producto, sin crear otro', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)
    const drawer = await abrirTiendas(user)

    await user.click(within(drawer).getByRole('button', { name: 'Publicar en esta tienda: Outlet' }))
    const form = await within(drawer).findByRole('form', { name: 'Publicar en esta tienda: Outlet' })
    // La dirección se sugiere desde el nombre del maestro.
    expect(within(form).getByLabelText('Dirección del producto')).toHaveValue('silla-a')
    await user.type(within(form).getByLabelText('Precio'), '149.90')
    await user.click(within(form).getByRole('button', { name: 'Publicar' }))

    await waitFor(() => expect(fake.state.rpcCalls.some((call) => call.name === 'publish_product')).toBe(true))
    const call = fake.state.rpcCalls.find((entry) => entry.name === 'publish_product')
    expect(call?.args).toMatchObject({
      p_product_id: PRODUCT_ID,
      p_store_id: STORE_B,
      p_slug: 'silla-a',
      p_price: '149.90',
      p_status: 'draft',
    })
    for (const field of TENANT_FIELDS) expect(call?.args).not.toHaveProperty(field)
    // Ninguna alta de producto: el maestro es el mismo.
    expect(fake.state.invocations).toHaveLength(0)
    expect(await within(within(drawer).getByRole('region', { name: 'Outlet' })).findByText('/silla-a')).toBeInTheDocument()
  })

  it('las categorías del formulario son solo las de ESA tienda', async () => {
    const user = userEvent.setup()
    renderPage(backend())
    const drawer = await abrirTiendas(user)

    await user.click(within(drawer).getByRole('button', { name: 'Publicar en esta tienda: Outlet' }))
    const form = await within(drawer).findByRole('form', { name: 'Publicar en esta tienda: Outlet' })
    await user.click(within(form).getByRole('combobox', { name: 'Categoría' }))

    expect(await screen.findByRole('option', { name: 'Liquidación' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Sillas' })).not.toBeInTheDocument()
  })

  it('cambiar la dirección y la categoría de A manda solo A y solo lo que cambió', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)
    const drawer = await abrirTiendas(user)

    await user.click(within(drawer).getByRole('button', { name: 'Editar publicación: Mi Negocio' }))
    const form = await within(drawer).findByRole('form', { name: 'Editar publicación: Mi Negocio' })
    const slug = within(form).getByLabelText('Dirección del producto')
    await user.clear(slug)
    await user.type(slug, 'silla-a-2026')
    await user.click(within(form).getByRole('combobox', { name: 'Categoría' }))
    await user.click(await screen.findByRole('option', { name: 'Sillas de oficina' }))
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(fake.state.rpcCalls.some((call) => call.name === 'update_product_publication')).toBe(true),
    )
    const call = fake.state.rpcCalls.find((entry) => entry.name === 'update_product_publication')
    expect(call?.args).toMatchObject({
      p_product_id: PRODUCT_ID,
      p_store_id: STORE_A,
      p_slug: 'silla-a-2026',
      p_category_id: SUBCATEGORY_ID,
      p_clear_category: false,
      p_status: null,
      p_price: null,
    })
  })

  it('quitar de A pide confirmación, llama solo para A y B sigue igual', async () => {
    const user = userEvent.setup()
    const tiendas = tiendasIniciales()
    // B ya publicada también: quitar A no puede tocarla.
    Object.assign(tiendas[1]!, {
      publication_id: '44444444-4444-4444-8444-4444444444bb',
      slug: 'silla-outlet',
      status: 'published',
      price: '149.90',
    })
    const fake = backend('admin', defaultMasters(), unaTienda(), tiendas)
    renderPage(fake)
    const drawer = await abrirTiendas(user)

    await user.click(within(drawer).getByRole('button', { name: 'Quitar de esta tienda: Mi Negocio' }))
    const confirm = await screen.findByRole('dialog', { name: '¿Quitar de Mi Negocio?' })
    await user.click(within(confirm).getByRole('button', { name: 'Quitar de esta tienda' }))

    await waitFor(() => expect(fake.state.rpcCalls.some((call) => call.name === 'unpublish_product')).toBe(true))
    const calls = fake.state.rpcCalls.filter((entry) => entry.name === 'unpublish_product')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual({ p_product_id: PRODUCT_ID, p_store_id: STORE_A })

    await waitFor(() =>
      expect(within(within(drawer).getByRole('region', { name: 'Mi Negocio' })).getByText('No publicado')).toBeInTheDocument(),
    )
    const b = within(within(drawer).getByRole('region', { name: 'Outlet' }))
    expect(b.getByText('Publicado')).toBeInTheDocument()
    expect(b.getByText('/silla-outlet')).toBeInTheDocument()
  })

  it('un error del servidor se muestra traducido y el formulario sigue abierto', async () => {
    const user = userEvent.setup()
    const fake = backend()
    fake.state.rpc.publish_product = () => {
      throw { message: 'SLUG_DUPLICADO: la tienda ya tiene un producto con ese slug' }
    }
    renderPage(fake)
    const drawer = await abrirTiendas(user)

    await user.click(within(drawer).getByRole('button', { name: 'Publicar en esta tienda: Outlet' }))
    const form = await within(drawer).findByRole('form', { name: 'Publicar en esta tienda: Outlet' })
    await user.type(within(form).getByLabelText('Precio'), '10.00')
    await user.click(within(form).getByRole('button', { name: 'Publicar' }))

    expect(await within(form).findByText('Esa dirección ya la usa otro producto en esta tienda.')).toBeInTheDocument()
  })

  it('un rol de solo lectura ve las tiendas pero no puede publicar, editar ni quitar', async () => {
    const user = userEvent.setup()
    renderPage(backend('viewer'))
    const drawer = await abrirTiendas(user)

    expect(within(drawer).queryByRole('button', { name: /Publicar en esta tienda/ })).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: /Editar publicación/ })).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: /Quitar de esta tienda/ })).not.toBeInTheDocument()
  })
})

describe('ProductsPage — eliminacion segura (contrato §4.2)', () => {
  it('antes de borrar enseña el conteo REAL de uso, incluidas las tiendas', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Eliminar: Silla A/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Uso real de este registro')).toBeInTheDocument()
    await within(dialog).findByText('2') // líneas de pedido
    expect(within(dialog).getByText('3')).toBeInTheDocument() // imágenes
    expect(within(dialog).getByText('Tiendas donde está publicado')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Gestionar tiendas' })).toBeInTheDocument()
  })

  it('borrar pasa por el comando del servidor, que lo niega si sigue publicado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Eliminar: Silla A/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar de todas formas' }))

    await waitFor(() => expect(fake.state.rpcCalls.some((call) => call.name === 'delete_product_master')).toBe(true))
    expect(
      await screen.findByText('Sigue publicado en alguna tienda. Quítalo de todas antes de borrarlo.'),
    ).toBeInTheDocument()
  })

  it('sin publicaciones ni historia, eliminar confirma el borrado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    fake.state.rpc.delete_product_master = () => null
    renderPage(fake)

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Eliminar: Silla A/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar de todas formas' }))

    expect(await screen.findByText('Producto eliminado')).toBeInTheDocument()
  })
})
