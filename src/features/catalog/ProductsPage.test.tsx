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

const PRODUCT_ID = '88888888-8888-4888-8888-888888888888'
const CATEGORY_ID = '77777777-7777-4777-8777-777777777777'
const TAX_DEFAULT_ID = '66666666-6666-4666-8666-666666666661'
const TAX_EXEMPT_ID = '66666666-6666-4666-8666-666666666662'

function backend(role: 'admin' | 'viewer' = 'admin', products = defaultProducts()): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
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
      // Las tres del tenant, con la general marcada por defecto: es lo que la
      // ficha nombra cuando el producto no elige ninguna.
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
      categories: [
        {
          id: CATEGORY_ID,
          store_id: STORE_A,
          parent_id: null,
          slug: 'sillas',
          name: 'Sillas',
          position: 0,
          is_active: true,
        },
        {
          id: SUBCATEGORY_ID,
          store_id: STORE_A,
          parent_id: CATEGORY_ID,
          slug: 'sillas-de-oficina',
          name: 'Sillas de oficina',
          position: 0,
          is_active: true,
        },
      ],
      products,
      // La VISTA que lee el listado. Añade dos columnas a la tabla: el nombre
      // de la categoría y el de la marca, que es lo que permite buscar
      // «Sillas» o «Nordica» en la misma caja. Se deriva de las mismas filas
      // para que el doble no pueda contradecirse con la tabla.
      admin_products: products.map((row) => ({
        ...row,
        category_name: NOMBRE_DE_CATEGORIA.get(String(row.category_id ?? '')) ?? null,
        brand_name: row.brand_id === BRAND_ID ? 'Nordica' : null,
      })),
      product_images: [],
    },
    rpc: {
      product_deletion_usage: () => ({ name: 'Silla A', order_lines: 2, images: 3 }),
    },
    functions: {
      'catalog-product': (body) => ({ id: String(body.product_id ?? PRODUCT_ID), status: 'draft' }),
    },
  })
}

const BRAND_ID = '77777777-7777-4777-8777-777777777777'
/** Una categoria HIJA: es la que demuestra que elegir la madre la incluye. */
const SUBCATEGORY_ID = '88888888-8888-4888-8888-888888888888'
const WAREHOUSE_ID = '66666666-6666-4666-8666-666666666666'

/**
 * El mismo tenant, pero con un almacen sirviendo a la tienda y el addon de
 * multialmacen contratado: es el momento en que la vitrina deja de leer
 * `products.stock` y pasa a sumar `inventory_levels`.
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

const NOMBRE_DE_CATEGORIA = new Map([
  [CATEGORY_ID, 'Sillas'],
  [SUBCATEGORY_ID, 'Sillas de oficina'],
])

type FilaDeProducto = Record<string, unknown>

function defaultProducts(): FilaDeProducto[] {
  return [
    {
      id: PRODUCT_ID,
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      category_id: CATEGORY_ID,
      brand_id: BRAND_ID,
      sku: 'A-1',
      name: 'Silla A',
      slug: 'silla-a',
      description: null,
      status: 'draft',
      price: '199.90',
      compare_at_price: null,
      currency: 'PEN',
      stock: 4,
      published_at: null,
      updated_at: '2026-08-27T00:00:00.000Z',
    },
  ]
}

/**
 * Dos productos, para poder comprobar que un filtro DEJA FUERA algo.
 *
 * Va aparte del catálogo por defecto a propósito: los tests de borrado cuentan
 * las filas de la tabla y el del listado cuenta los chips de estado, así que
 * meter aquí un segundo producto los rompería sin que tenga nada que ver con
 * lo que ellos comprueban.
 *
 * El segundo no tiene categoría ni marca: es el que demuestra que el listado no
 * lo esconde y que ordenar por categoría lo manda al final en vez de llenar con
 * él la primera pantalla.
 */
function catalogoAmplio(): FilaDeProducto[] {
  return [
    ...defaultProducts(),
    {
      id: '99999999-9999-4999-8999-999999999999',
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      category_id: null,
      brand_id: null,
      sku: 'Z-9',
      name: 'Mesa Z',
      slug: 'mesa-z',
      description: null,
      status: 'draft',
      price: '850.00',
      compare_at_price: null,
      currency: 'PEN',
      stock: 40,
      published_at: null,
      updated_at: '2026-08-28T00:00:00.000Z',
    },
    // Cuelga de la HIJA de «Sillas»: elegir la madre tiene que traerlo.
    {
      id: '11111111-2222-4333-8444-555555555555',
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      category_id: SUBCATEGORY_ID,
      brand_id: null,
      sku: 'O-1',
      name: 'Banqueta O',
      slug: 'banqueta-o',
      description: null,
      status: 'draft',
      price: '120.00',
      compare_at_price: null,
      currency: 'PEN',
      stock: 12,
      published_at: null,
      updated_at: '2026-08-29T00:00:00.000Z',
    },
  ]
}

/**
 * El `CapabilitiesProvider` va aqui desde P03-SaaS: el cajon de producto
 * pregunta si la sociedad tiene `catalog.advanced` para decidir si ensena las
 * pestanas del PIM. El doble sirve por defecto un tenant con eCommerce activo y
 * SOLO lo baseline, que es exactamente el tenant de antes del PIM: estos tests
 * siguen comprobando el catalogo simple sin el modulo vendible.
 */
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

/**
 * Acciones de la fila de «Silla A».
 *
 * Antes vivian detras de un menu de tres puntos y habia que abrirlo; ahora
 * son botones con icono en la propia fila, asi que se consultan dentro de su
 * `<tr>`. Acotar al `<tr>` no es un detalle: «Archivar» tambien existe en el
 * dialogo de borrado, y sin acotar la consulta encontraria dos.
 */
async function rowActions() {
  const row = (await screen.findByText('Silla A')).closest('tr')
  return within(row as HTMLElement)
}

beforeEach(() => {
  holder.client = null
})

describe('ProductsPage — listado', () => {
  it('muestra los productos de la tienda activa con precio, stock y estado', async () => {
    renderPage(backend())

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    const table = within(screen.getByRole('table'))
    expect(table.getByText('A-1')).toBeInTheDocument()
    expect(table.getByText('Sillas')).toBeInTheDocument()
    expect(table.getByText('Borrador')).toBeInTheDocument()
    expect(table.getByText('4')).toBeInTheDocument()
    expect(table.getByText('S/ 199.90')).toBeInTheDocument()
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

  it('el rol de catalogo si lo ve', async () => {
    renderPage(backend())
    expect(await screen.findByRole('button', { name: 'Nuevo producto' })).toBeInTheDocument()
  })

  it('ofrece un unico buscador general, sin panel de filtros multi-campo', async () => {
    renderPage(backend())
    await screen.findByText('Silla A')
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  /**
   * El buscador alcanza lo que se VE en la tabla.
   *
   * Miraba nombre, SKU y slug —las tres columnas propias de `products`— y la
   * categoría y la marca viven en otras tablas. O sea que escribir en la caja
   * lo que uno está leyendo en la columna de al lado no devolvía nada, que es
   * la peor respuesta que puede dar un buscador.
   */
  it('busca tambien por categoria y por marca, no solo por nombre', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Silla A')

    await user.type(screen.getByRole('searchbox'), 'Sillas')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Mesa Z')).not.toBeInTheDocument())
  })

  /**
   * Escribir no consulta.
   *
   * El listado pagina en el servidor, así que mientras el término entraba
   * directo en la consulta cada tecla era una petición. Con el botón de por
   * medio, teclear no cuesta ni un viaje: la tabla sigue enseñando lo de antes
   * hasta que alguien pide el cambio.
   */
  it('escribir no consulta: la tabla no cambia hasta pulsar Filtrar', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Mesa Z')

    await user.type(screen.getByRole('searchbox'), 'Silla')

    // Sigue estando: nadie ha pedido filtrar todavía.
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

    // Mesa Z tiene 40; Silla A tiene 4.
    expect(await screen.findByText('Mesa Z')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Silla A')).not.toBeInTheDocument())
  })

  /**
   * Elegir una familia enseña lo que hay DENTRO.
   *
   * Los productos cuelgan de las hojas y casi nunca de la raíz, así que filtrar
   * por «Sillas» con una igualdad devolvía solo lo que alguien colgó
   * directamente de ella y dejaba fuera toda su descendencia. Quien abre una
   * familia quiere lo que hay dentro.
   */
  it('elegir una categoria madre incluye a sus hijas', async () => {
    const user = userEvent.setup()
    renderPage(backend('admin', catalogoAmplio()))
    await screen.findByText('Banqueta O')

    await user.click(screen.getByRole('combobox', { name: 'Categoría' }))
    await user.click(await screen.findByRole('option', { name: 'Sillas' }))
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    // La madre trae lo suyo y lo de su hija.
    expect(await screen.findByText('Silla A')).toBeInTheDocument()
    expect(screen.getByText('Banqueta O')).toBeInTheDocument()
    // Y deja fuera lo que no cuelga de ella.
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

    const precio = screen.getByRole('button', { name: 'Precio' })
    await user.click(precio)

    // La celda de la cabecera anuncia el orden: sin `aria-sort`, quien no ve la
    // flecha no tiene forma de saber por donde esta ordenada la tabla.
    await waitFor(() =>
      expect(precio.closest('th')).toHaveAttribute('aria-sort', 'ascending'),
    )

    await user.click(precio)
    await waitFor(() =>
      expect(precio.closest('th')).toHaveAttribute('aria-sort', 'descending'),
    )
  })

  it('las pestanas de estado son las tres del enum mas "Todos"', async () => {
    renderPage(backend())
    await screen.findByText('Silla A')
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Todos', 'Borrador', 'Publicado', 'Archivado'])
  })
})

describe('ProductsPage — alta y edicion', () => {
  it('el alta manda `create` con la tienda y SIN tenant en el cuerpo', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

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
      price: '349.50',
      stock: 7,
      status: 'draft',
    })
    // La regla bloqueante del contrato §3: el tenant NO viaja en el cuerpo.
    for (const field of TENANT_FIELDS) {
      expect(invocation?.body).not.toHaveProperty(field)
    }
  })

  /**
   * La categoria fiscal, que hasta ahora no se podia elegir.
   *
   * `products.tax_category_id` es el PRIMER escalon de
   * `ebim.effective_tax_rate`, y sin pantalla el catalogo entero caia en la
   * categoria que la sociedad marco por defecto: no habia forma de vender un
   * exonerado y un gravado en el mismo catalogo, que es justo lo que la pantalla
   * de Impuestos promete.
   */
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

  /**
   * Y vacio NO es «sin impuesto»: es «la de siempre».
   *
   * Viaja `null` para que la base baje al siguiente escalon de la cascada. Si se
   * omitiera el campo, un producto exonerado no podria volver nunca a la tasa
   * general — el `patch` solo toca lo que llega.
   */
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

  /**
   * El fallo que esto fija: con almacenes, `ebim.atp` deja de mirar
   * `products.stock` y suma `inventory_levels`. Un producto recien creado no
   * tenia ninguna fila ahi, asi que nacia con cero disponible y la vitrina lo
   * pintaba «Sin stock» aunque el campo dijera cuarenta. Quien lo daba de alta
   * rellenaba el unico campo que el formulario ofrecia y se encontraba un
   * producto que no se podia comprar, sin nada que se lo explicara.
   */
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

    // El de MAYOR prioridad viene ya elegido: en una tienda con uno solo,
    // preguntar seria un tramite.
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
      // `receipt` y no `adjustment`: es una entrada de mercaderia, y el
      // movimiento tiene que decir por que subio la existencia.
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

    // Ni siquiera se pregunta: sin almacenes la pregunta no tiene sentido.
    expect(within(drawer).queryByLabelText('Almacén de entrada')).not.toBeInTheDocument()

    await user.click(within(drawer).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.rpcCalls.some((call) => call.name === 'adjust_inventory')).toBe(false)
  })

  it('el slug se sugiere desde el nombre y viaja en minusculas con guiones', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

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

    expect(
      await within(drawer).findByText(/importe con hasta 2 decimales/i),
    ).toBeInTheDocument()
    expect(fake.state.invocations).toHaveLength(0)
  })

  it('al editar se abre el panel con los datos del producto', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Editar: Silla A/ }))

    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByLabelText('Nombre')).toHaveValue('Silla A')
    expect(within(drawer).getByLabelText('SKU')).toHaveValue('A-1')
    expect(within(drawer).getByLabelText('Precio')).toHaveValue('199.90')
  })

  it('el producto sin guardar todavia no ofrece subir imagenes', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')
    // Desde P03-SaaS el cajon va por pestanas: las imagenes viven en la suya.
    await user.click(within(drawer).getByRole('tab', { name: 'Imágenes' }))
    expect(
      await within(drawer).findByText(/Guarda el producto y podrás subir sus imágenes/),
    ).toBeInTheDocument()
  })

  it('el cajon se organiza en pestanas y no en un formulario monolitico', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const drawer = await screen.findByRole('dialog')

    // Sin `catalog.advanced` contratado solo hay dos: General e Imagenes. Las
    // del PIM aparecen con el modulo, y eso lo comprueba `pim.test.tsx`.
    expect(within(drawer).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'Imágenes',
    ])
  })
})

describe('ProductsPage — publicar y despublicar', () => {
  it('publicar manda solo el estado, sin fecha inventada ni tenant', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: 'Publicar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]?.body).toEqual({
      action: 'update',
      product_id: PRODUCT_ID,
      status: 'published',
    })
  })

  it('un producto publicado ofrece despublicar en vez de publicar', async () => {
    // Sin `userEvent`: esta prueba ya no pulsa nada. Antes hacia falta para
    // abrir el menu; ahora las dos acciones se ven sin abrir nada, que es
    // justo lo que se comprueba.
    const published = defaultProducts()
    published[0]!.status = 'published'
    const fake = backend('admin', published)
    renderPage(fake)

    const row = await rowActions()
    expect(row.getByRole('button', { name: 'Despublicar' })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument()
  })

  it('confirma con un aviso al usuario', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: 'Publicar' }))

    expect(await screen.findByText('Producto publicado')).toBeInTheDocument()
  })
})

describe('ProductsPage — eliminacion segura (contrato §4.2)', () => {
  it('antes de borrar enseña el conteo REAL de uso y ofrece archivar', async () => {
    const user = userEvent.setup()
    renderPage(backend())

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Eliminar: Silla A/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Uso real de este registro')).toBeInTheDocument()
    await within(dialog).findByText('2') // líneas de pedido
    expect(within(dialog).getByText('3')).toBeInTheDocument() // imágenes
    expect(within(dialog).getByRole('button', { name: 'Archivar' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Eliminar de todas formas' })).toBeInTheDocument()
  })

  it('archivar en vez de borrar conserva la fila y solo cambia el estado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Eliminar: Silla A/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archivar' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]?.body).toMatchObject({ status: 'archived' })
    expect(fake.state.tables.products).toHaveLength(1)
  })

  it('eliminar borra la fila de verdad', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPage(fake)

    const row = await rowActions()
    await user.click(row.getByRole('button', { name: /Eliminar: Silla A/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar de todas formas' }))

    await waitFor(() => expect(fake.state.tables.products).toHaveLength(0))
    expect(await screen.findByText('Producto eliminado')).toBeInTheDocument()
  })
})
