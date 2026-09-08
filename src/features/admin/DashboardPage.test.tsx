import { screen, within } from '@testing-library/react'
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
const { DashboardPage } = await import('./DashboardPage')

/** KPIs con los desgloses que la función devuelve desde P18. */
function kpis(overrides: Record<string, unknown> = {}) {
  return {
    products: 11,
    published: 9,
    orders: 8,
    sales: '6334.24',
    currency: 'PEN',
    avg_ticket: '791.78',
    by_status: [
      { status: 'pending', count: 5 },
      { status: 'paid', count: 2 },
      { status: 'cancelled', count: 1 },
    ],
    top_products: [
      { sku: 'SIL-PLE-03', name: 'Silla plegable de abedul', units: 4, revenue: '1036.00' },
      { sku: 'LAM-ARC-01', name: 'Lámpara de pie de arco', units: 1, revenue: '760.00' },
    ],
    ...overrides,
  }
}

function backend(rpc: () => unknown): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      dashboard_kpis: rpc,
      dashboard_recent_orders: () => [
        {
          order_number: 'EC-20260827-00008',
          status: 'paid',
          customer: 'Ana Compradora',
          total: '2230.20',
          currency: 'PEN',
          placed_at: '2026-08-27T13:29:56Z',
        },
      ],
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'owner', status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'casa-nordica',
          name: 'Casa Nórdica',
          status: 'active',
          currency: 'PEN',
        },
      ],
    },
  })
}

function render(rpc: () => unknown) {
  holder.client = backend(rpc)
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <DashboardPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('cifras del resumen', () => {
  it('muestra ventas y ticket medio con la moneda de la tienda', async () => {
    render(() => kpis())

    expect(await screen.findByText(/6[.,]334[.,]24/)).toBeInTheDocument()
    expect(screen.getByText(/791[.,]78/)).toBeInTheDocument()
  })

  it('publicados acompaña al total de productos en vez de ser una cifra suelta', async () => {
    render(() => kpis())

    expect(await screen.findByText('11')).toBeInTheDocument()
    expect(screen.getByText(/9 publicados/)).toBeInTheDocument()
  })

  it('sin moneda única no inventa cifra: ni ventas ni ticket medio', async () => {
    // Es la regla que más importa de esta pantalla: un cero inventado en un
    // panel se lee como un dato, y aquí hay dos cifras de dinero.
    render(() => kpis({ sales: null, currency: null, avg_ticket: null }))

    expect(await screen.findAllByText('—')).toHaveLength(2)
  })

  it('cada tarjeta lleva su icono', async () => {
    // El icono se declaraba en los datos y en el componente, pero no se pasaba
    // en el JSX: se veia bien en el codigo y no salia en pantalla. Los tests
    // miraban cifras y textos, asi que no lo cazaron.
    render(() => kpis())

    await screen.findByText('Rendimiento')
    // El icono se comprueba DENTRO de su tarjeta, no en toda la pantalla.
    // Desde que los pedidos recientes llevan icono de estado, `PaidRoundedIcon`
    // sale dos veces y el `getByTestId` global fallaba. Buscarlo suelto tampoco
    // serviria: pasaria aunque la tarjeta se quedase sin icono, que es justo el
    // fallo que este test existe para cazar.
    for (const [label, testId] of [
      ['Ventas', 'PaidRoundedIcon'],
      ['Ticket medio', 'TrendingUpRoundedIcon'],
      ['Pedidos', 'ReceiptLongRoundedIcon'],
      ['Productos', 'LocalMallRoundedIcon'],
    ] as const) {
      const carries = screen
        .getAllByText(label)
        .map((node) => node.closest('.MuiCard-root'))
        .some((card) => card !== null && within(card as HTMLElement).queryByTestId(testId) !== null)
      expect(carries, `${label} sin ${testId}`).toBe(true)
    }
  })
})

describe('estructura operativa', () => {
  it('agrupa el panel en secciones con encabezado real', async () => {
    // Encabezados de verdad, no texto gris pequeno: quien navega por lector de
    // pantalla salta por encabezados, y una seccion que solo se distingue por
    // el color no existe para esa persona.
    render(() => kpis())

    expect(await screen.findByRole('heading', { name: 'Rendimiento', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Desglose', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Actividad', level: 2 })).toBeInTheDocument()
  })

  it('las cifras llevan a su pantalla: una cifra sin salida obliga a buscarla', async () => {
    render(() => kpis())

    const verPedidos = await screen.findByRole('link', { name: /Ver pedidos/ })
    expect(verPedidos).toHaveAttribute('href', '/app/orders')
    expect(screen.getByRole('link', { name: /Ver productos/ })).toHaveAttribute('href', '/app/products')
  })

  it('avisa de lo que hay que mirar hoy, calculado de los datos', async () => {
    render(() => kpis())

    // 5 pendientes en los datos del mock, y 11-9 = 2 sin publicar.
    expect(await screen.findByText('Pedidos esperando cobro')).toBeInTheDocument()
    expect(screen.getByText(/5 pedido/)).toBeInTheDocument()
    expect(screen.getByText('Catálogo sin publicar')).toBeInTheDocument()
  })

  it('sin nada que decir no pinta banner: uno permanente ensena a ignorarlo', async () => {
    render(() => kpis({ products: 9, published: 9, by_status: [{ status: 'paid', count: 8 }] }))

    await screen.findByText('Actividad')
    expect(screen.queryByText('Pedidos esperando cobro')).not.toBeInTheDocument()
    expect(screen.queryByText('Catálogo sin publicar')).not.toBeInTheDocument()
  })

  it('lista los ultimos pedidos con enlace a la pantalla completa', async () => {
    render(() => kpis())

    expect(await screen.findByText('EC-20260827-00008')).toBeInTheDocument()
    expect(screen.getByText('Ana Compradora')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver todo/ })).toHaveAttribute('href', '/app/orders')
  })
})

describe('medidores', () => {
  it('muestra la razon como porcentaje Y como fraccion', async () => {
    // Un medidor sin cifra obliga a estimar, y estimar es lo que no debe hacer
    // quien mira un panel.
    render(() => kpis())

    expect(await screen.findByText('Salud de la tienda')).toBeInTheDocument()
    // 9 de 11 publicados = 82 %; 2 pagados de 8 pedidos = 25 %.
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('9 / 11')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('es un meter accesible, con su rango declarado', async () => {
    render(() => kpis())

    const medidores = await screen.findAllByRole('meter')
    expect(medidores).toHaveLength(2)
    expect(medidores[0]).toHaveAttribute('aria-valuenow', '9')
    expect(medidores[0]).toHaveAttribute('aria-valuemax', '11')
  })

  it('sin total no inventa un 0 %', async () => {
    render(() => kpis({ products: 0, published: 0, orders: 8 }))

    await screen.findByText('Salud de la tienda')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('desgloses', () => {
  it('reparte los pedidos por estado, traducidos y ordenados', async () => {
    render(() => kpis())

    expect(await screen.findByText('Pedidos por estado')).toBeInTheDocument()
    // El estado llega como código del enum; quien traduce es la pantalla.
    // «Pagado» sale tambien como chip en la tabla de ultimos pedidos: se
    // comprueba que estan, no que sean unicos.
    expect(screen.getAllByText('Pendiente').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pagado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cancelado').length).toBeGreaterThan(0)
  })

  it('lista los productos que más venden con su ingreso', async () => {
    render(() => kpis())

    expect(await screen.findByText('Productos que más venden')).toBeInTheDocument()
    expect(screen.getByText('Silla plegable de abedul')).toBeInTheDocument()
    expect(screen.getByText(/1[.,]036[.,]00/)).toBeInTheDocument()
  })

  it('cada barra lleva su cifra escrita, no solo su largo', async () => {
    // Una barra sin número obliga a estimar contra un eje que aquí no existe.
    render(() => kpis())

    await screen.findByText('Pedidos por estado')
    for (const valor of ['5', '2', '1']) {
      expect(screen.getAllByText(valor).length).toBeGreaterThan(0)
    }
  })

  it('con la tienda recién creada no enseña desgloses vacíos, sino el arranque', async () => {
    render(() =>
      kpis({ products: 0, published: 0, orders: 0, sales: null, currency: null, avg_ticket: null, by_status: [], top_products: [] }),
    )

    expect(await screen.findByText(/Empieza por tu catálogo|catálogo/i)).toBeInTheDocument()
    expect(screen.queryByText('Pedidos por estado')).not.toBeInTheDocument()
  })
})
