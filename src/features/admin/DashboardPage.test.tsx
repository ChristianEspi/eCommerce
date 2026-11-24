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

/** KPIs acumulados, como los devuelve `dashboard_kpis`. */
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

/** Rendimiento del periodo, como lo devuelve `dashboard_sales_trend`. */
function trend(overrides: Record<string, unknown> = {}) {
  return {
    period: '30d',
    unit: 'day',
    currency: 'PEN',
    sales: '1200.00',
    previous_sales: '1000.00',
    orders: 3,
    avg_ticket: '400.00',
    series: [
      { date: '2026-09-24', sales: '200.00' },
      { date: '2026-09-25', sales: '0.00' },
      { date: '2026-09-26', sales: '1000.00' },
    ],
    best: { date: '2026-09-26', sales: '1000.00' },
    ...overrides,
  }
}

const impagos = {
  key: 'orders.unpaid',
  module: 'orders',
  severity: 'critica',
  count: 4,
  fingerprint: '4',
  metrics: { count: 4, oldest_days: 12 },
  samples: [],
  href: '/app/orders',
}

function watchOf(items: unknown[]) {
  return {
    generated_at: '2026-09-26T10:00:00.000Z',
    critical: items.filter((i) => (i as { severity?: string }).severity === 'critica').length,
    total: items.length,
    items,
    dismissed: [],
  }
}

type Rpc = (args: Record<string, unknown>) => unknown

function backend(options: { kpis?: Rpc; trend?: Rpc | null; watch?: unknown[] } = {}): FakeSupabase {
  const rpc: Record<string, Rpc> = {
    dashboard_kpis: options.kpis ?? (() => kpis()),
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
    watch_findings: () => watchOf(options.watch ?? []),
  }
  // `null` = la función aún no existe en la base (migración sin aplicar).
  if (options.trend !== null) rpc.dashboard_sales_trend = options.trend ?? (() => trend())
  return createFakeSupabase({
    session: makeSession(),
    rpc,
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

function render(options: Parameters<typeof backend>[0] = {}) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <DashboardPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return client
}

const section = async (name: string | RegExp) => screen.findByRole('region', { name })

beforeEach(() => {
  holder.client = null
})

describe('ventas del periodo', () => {
  it('muestra las ventas del periodo, su variación y contra qué se compara', async () => {
    render()

    const hero = await section(/Ventas · últimos 30 días/)
    expect(within(hero).getByText(/1[.,]200[.,]00/)).toBeInTheDocument()
    // (1200 - 1000) / 1000 = +20 %, con nombre accesible que dice contra qué.
    expect(within(hero).getByLabelText('+20.0 % frente al periodo anterior')).toBeInTheDocument()
    expect(within(hero).getByText(/vs\. .*1[.,]000[.,]00 en el periodo anterior/)).toBeInTheDocument()
    expect(within(hero).getByText(/400[.,]00/)).toBeInTheDocument()
  })

  it('el gráfico es una imagen con nombre: tipo de serie y mejor día', async () => {
    render()
    const hero = await section(/Ventas · últimos 30 días/)
    expect(within(hero).getByRole('img', { name: /^Ventas por día\. Mejor día: .*1[.,]000[.,]00/ })).toBeInTheDocument()
  })

  it('cambiar de periodo vuelve a preguntar a la base con ese periodo', async () => {
    const client = render()
    await section(/Ventas · últimos 30 días/)

    await userEvent.click(screen.getByRole('button', { name: '7 días' }))

    await waitFor(() =>
      expect(
        client.state.rpcCalls.some((c) => c.name === 'dashboard_sales_trend' && c.args.p_period === '7d'),
      ).toBe(true),
    )
    const llamada = client.state.rpcCalls.find((c) => c.name === 'dashboard_sales_trend')
    // Solo la tienda, el periodo y la zona de quien mira: el tenant lo pone el token.
    expect(Object.keys(llamada?.args ?? {}).sort()).toEqual(['p_period', 'p_store_id', 'p_tz'])
  })

  it('sin ventas en el periodo anterior no inventa una variación', async () => {
    render({ trend: () => trend({ previous_sales: '0.00' }) })
    const hero = await section(/Ventas · últimos 30 días/)
    expect(within(hero).getByText('Sin ventas en el periodo anterior para comparar')).toBeInTheDocument()
    expect(within(hero).queryByLabelText(/frente al periodo anterior/)).not.toBeInTheDocument()
  })

  it('si la tendencia no existe en la base, enseña las ventas acumuladas y lo dice', async () => {
    // Migración sin aplicar: la tarjeta no se cae, cae a `dashboard_kpis`.
    render({ trend: null })

    const hero = await section('Ventas acumuladas')
    expect(within(hero).getByText(/6[.,]334[.,]24/)).toBeInTheDocument()
    expect(within(hero).getByText(/791[.,]78/)).toBeInTheDocument()
    expect(within(hero).getByText('La tendencia por periodo aún no está disponible.')).toBeInTheDocument()
    expect(within(hero).queryByRole('group', { name: 'Periodo de ventas' })).not.toBeInTheDocument()
  })

  it('sin moneda única no inventa cifra: ni ventas, ni ticket, ni mejor día', async () => {
    // Es la regla que más importa de esta pantalla: un cero inventado en un
    // panel se lee como un dato.
    render({ trend: () => trend({ currency: null, sales: null, previous_sales: null, avg_ticket: null, series: [], best: null }) })

    const hero = await section(/Ventas · últimos 30 días/)
    expect(within(hero).getAllByText('—')).toHaveLength(3)
  })

  it('la tarjeta de ventas lleva su icono', async () => {
    render()
    const hero = await section(/Ventas · últimos 30 días/)
    expect(within(hero).getByTestId('PaidRoundedIcon')).toBeInTheDocument()
  })
})

describe('estructura operativa', () => {
  it('cada bloque es una región con su encabezado real', async () => {
    // Encabezados de verdad: quien navega por lector de pantalla salta por
    // encabezados, y un bloque que solo se distingue por el color no existe.
    render()

    for (const name of ['Flujo de pedidos', 'Salud de la tienda', 'Últimos pedidos', 'Productos que más venden']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument()
    }
  })

  it('las cifras llevan a su pantalla: una cifra sin salida obliga a buscarla', async () => {
    render()

    const flujo = await section('Flujo de pedidos')
    expect(within(flujo).getByRole('link', { name: /Ver pedidos/ })).toHaveAttribute('href', '/app/orders')
    const salud = await section('Salud de la tienda')
    expect(within(salud).getByRole('link', { name: /Ver productos/ })).toHaveAttribute('href', '/app/products')
  })

  it('lo que hay que hacer hoy sale de la vigilancia, con un botón por aviso', async () => {
    render({ watch: [impagos] })

    const vigilancia = await section('Centro de vigilancia')
    expect(within(vigilancia).getByText('Pedidos sin cobrar')).toBeInTheDocument()
    // El verbo de la tarea, y a la pantalla donde se hace (2026-11-23: ya en
    // la pestaña de pendientes, no la lista entera).
    expect(within(vigilancia).getByRole('link', { name: 'Cobrar: Pedidos sin cobrar' })).toHaveAttribute(
      'href',
      '/app/orders?estado=pending',
    )
    // El banner de antes decía lo mismo con otra cifra: ya no existe.
    expect(screen.queryByText('Pedidos esperando cobro')).not.toBeInTheDocument()
  })

  it('sin avisos no pinta el bloque de vigilancia: uno permanente enseña a ignorarlo', async () => {
    render({ watch: [] })

    await section('Flujo de pedidos')
    expect(screen.queryByRole('heading', { name: 'Centro de vigilancia' })).not.toBeInTheDocument()
  })

  it('con más de cuatro avisos, «Ver N más» abre el centro de vigilancia completo', async () => {
    const claves = [
      'orders.unpaid',
      'orders.paid_unshipped',
      'inventory.negative',
      'inventory.below_reorder',
      'fulfillment.overdue',
      'catalog.unpublished',
    ]
    render({ watch: claves.map((key, i) => ({ ...impagos, key, fingerprint: String(i) })) })

    const vigilancia = await section('Centro de vigilancia')
    expect(within(vigilancia).queryByText('Catálogo sin publicar')).not.toBeInTheDocument()

    await userEvent.click(within(vigilancia).getByRole('button', { name: 'Ver 2 más' }))

    const panel = await screen.findByRole('dialog', { name: 'Centro de vigilancia' })
    expect(within(panel).getByText('Catálogo sin publicar')).toBeInTheDocument()
    // Filtros por severidad, con su contador.
    expect(within(panel).getByRole('tab', { name: /Todos\s*6/ })).toBeInTheDocument()
  })

  it('lista los ultimos pedidos con enlace a la pantalla completa', async () => {
    render()

    expect(await screen.findByText('EC-20260827-00008')).toBeInTheDocument()
    expect(screen.getByText('Ana Compradora')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver todo/ })).toHaveAttribute('href', '/app/orders')
  })
})

describe('flujo de pedidos', () => {
  it('reparte los pedidos por etapa, traducidos, con la barra de proporciones con nombre', async () => {
    render()

    const flujo = await section('Flujo de pedidos')
    expect(within(flujo).getByText('Pendiente')).toBeInTheDocument()
    expect(within(flujo).getByText('Pagado')).toBeInTheDocument()
    expect(within(flujo).getByText('Entregado')).toBeInTheDocument()
    // El color acompaña: la barra dice qué es cada tramo.
    expect(within(flujo).getByRole('img', { name: 'Pendiente: 5, Pagado: 2, Cancelado: 1' })).toBeInTheDocument()
    // Anulados fuera del flujo, pero contados.
    expect(within(flujo).getByText(/Fuera del flujo: 1 cancelado/)).toBeInTheDocument()
  })

  it('cada etapa lleva su cifra escrita, también el cero', async () => {
    render()
    const flujo = await section('Flujo de pedidos')
    for (const valor of ['5', '2', '0']) {
      expect(within(flujo).getAllByText(valor).length).toBeGreaterThan(0)
    }
  })

  it('lo atascado sale de la vigilancia: una sola regla de «tarde» para toda la pantalla', async () => {
    render({ watch: [impagos] })

    const flujo = await section('Flujo de pedidos')
    expect(await within(flujo).findByText('4 con más de 3 días')).toBeInTheDocument()
    // Sin aviso de pagados sin despachar, esa etapa está al día.
    expect(within(flujo).getByText('Al día')).toBeInTheDocument()
  })

  it('sin pedidos no pinta una barra de proporciones vacía', async () => {
    render({ kpis: () => kpis({ orders: 0, by_status: [] }) })
    const flujo = await section('Flujo de pedidos')
    expect(within(flujo).queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('medidores', () => {
  it('muestra la razon como porcentaje Y como fraccion', async () => {
    // Un medidor sin cifra obliga a estimar, y estimar es lo que no debe hacer
    // quien mira un panel.
    render()

    expect(await screen.findByText('Salud de la tienda')).toBeInTheDocument()
    // 9 de 11 publicados = 82 %; 2 pagados de 8 pedidos = 25 %.
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('9 / 11')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('es un meter accesible, con su rango declarado', async () => {
    render()

    const medidores = await screen.findAllByRole('meter')
    expect(medidores).toHaveLength(2)
    expect(medidores[0]).toHaveAttribute('aria-valuenow', '9')
    expect(medidores[0]).toHaveAttribute('aria-valuemax', '11')
  })

  it('sin total no inventa un 0 %', async () => {
    render({ kpis: () => kpis({ products: 0, published: 0, orders: 8 }) })

    await screen.findByText('Salud de la tienda')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('lo que más vende', () => {
  it('lista los productos con su ingreso y su peso sobre las ventas', async () => {
    render()

    const top = await section('Productos que más venden')
    expect(within(top).getByText('Silla plegable de abedul')).toBeInTheDocument()
    expect(within(top).getByText(/1[.,]036[.,]00/)).toBeInTheDocument()
    // 1036 / 6334.24 = 16.4 %.
    expect(within(top).getByText('16.4 %')).toBeInTheDocument()
  })

  it('con monedas mezcladas no escribe un % sin base', async () => {
    render({ kpis: () => kpis({ sales: null, currency: null, avg_ticket: null }) })
    const top = await section('Productos que más venden')
    expect(within(top).queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('con la tienda recién creada no enseña desgloses vacíos, sino el arranque', async () => {
    render({
      kpis: () =>
        kpis({ products: 0, published: 0, orders: 0, sales: null, currency: null, avg_ticket: null, by_status: [], top_products: [] }),
    })

    expect(await screen.findByText(/Empieza por tu catálogo|catálogo/i)).toBeInTheDocument()
    expect(screen.queryByText('Flujo de pedidos')).not.toBeInTheDocument()
  })
})
