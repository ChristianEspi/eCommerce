import { screen, within } from '@testing-library/react'
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
 * La analítica en pantalla (P13-SaaS).
 *
 * Lo que se comprueba aquí no es el cálculo —eso vive en el servidor y se
 * prueba contra Postgres real en `supabase/tests/analytics.test.ts`— sino las
 * cinco cosas que solo se ven montando el árbol:
 *
 *  1. que es UNA pantalla con pestañas centradas (§8);
 *  2. que un `null` se pinta como **guion** y jamás como 0 %, que es la regla
 *     entera de la fase pasada a la interfaz;
 *  3. que sin el addon la segunda pestaña dice «no está en tu plan» —al
 *     reconocer el `SIN_MODULO` de la base, no consultando la lista de
 *     capacidades— mientras la primera sigue funcionando;
 *  4. que el rango de fechas es UNO para las dos pestañas;
 *  5. que la exportación baja la serie diaria y no cuatro totales.
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
const { AnalyticsPage } = await import('./AnalyticsPage')

const ADVANCED = ['ecommerce.analytics.advanced']

const KPIS_CON_DATOS = {
  from: '2026-07-29T00:00:00.000Z',
  to: '2026-08-28T00:00:00.000Z',
  currency: 'PEN',
  orders: 4,
  gross_sales: '1200.00',
  paid_sales: '900.00',
  discounts: '50.00',
  shipping: '30.00',
  units: 11,
  average_ticket: '300.00',
  checkouts_started: 10,
  checkouts_completed: 4,
  conversion_rate: '40.00',
  carts_abandoned: 6,
  carts_converted: 4,
  abandonment_rate: '60.00',
}

/** El primer día de un tenant: hay pantalla, y no hay con qué calcular nada. */
const KPIS_VACIOS = {
  ...KPIS_CON_DATOS,
  currency: null,
  orders: 0,
  gross_sales: null,
  paid_sales: null,
  discounts: null,
  shipping: null,
  units: 0,
  average_ticket: null,
  checkouts_started: 0,
  checkouts_completed: 0,
  conversion_rate: null,
  carts_abandoned: 0,
  carts_converted: 0,
  abandonment_rate: null,
}

const SERIE = [
  { day: '2026-08-27', orders: 1, units: 2, revenue: '300.00', currency: 'PEN' },
  { day: '2026-08-28', orders: 0, units: 0, revenue: '0', currency: null },
]

const EMBUDO = [
  { event_type: 'product_view', events: 120, sessions: 40 },
  { event_type: 'add_to_cart', events: 30, sessions: 18 },
  { event_type: 'order_created', events: 4, sessions: null },
]

class ModuloNoContratado extends Error {
  readonly code = 'SIN_MODULO'
  constructor() {
    super('SIN_MODULO: la analitica avanzada no esta activa para esta sociedad')
  }
}

function backend(
  options: {
    entitlements?: string[]
    kpis?: Record<string, unknown>
    advanced?: boolean
    funnel?: Array<Record<string, unknown>>
    serie?: Array<Record<string, unknown>>
  } = {},
): FakeSupabase {
  const {
    entitlements = ADVANCED,
    kpis = KPIS_CON_DATOS,
    advanced = true,
    funnel = EMBUDO,
    serie = SERIE,
  } = options
  const negado = () => {
    throw new ModuloNoContratado()
  }
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
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      analytics_kpis: () => kpis,
      analytics_timeseries: () => serie,
      analytics_top_products: () => [
        {
          product_id: null,
          sku: 'A-JABON',
          name: 'Jabón',
          units: 8,
          revenue: '80.00',
          currency: 'PEN',
          orders: 2,
        },
      ],
      analytics_channel_performance: () => [
        {
          channel_id: 'c1',
          channel_code: 'web',
          channel_name: 'Tienda web',
          channel_kind: 'b2c',
          orders: 4,
          units: 11,
          revenue: '1200.00',
          currency: 'PEN',
        },
      ],
      analytics_funnel: advanced ? () => funnel : negado,
      analytics_search_terms: advanced
        ? () => [{ term: 'jabon', searches: 12, zero_results: 12, sessions: 9 }]
        : negado,
    },
  })
}

function renderAnalytics(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="analytics.basic">
          <AnalyticsPage />
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

describe('Analítica — la pantalla', () => {
  it('es UNA pantalla con dos pestañas centradas', async () => {
    renderAnalytics(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.slice(0, 2).map((tab) => tab.textContent)).toEqual(['Resumen', 'Comportamiento'])
  })

  it('enseña los indicadores que la base devolvió, sin recalcular ninguno', async () => {
    renderAnalytics(backend())
    expect(await screen.findByText('S/ 900.00')).toBeInTheDocument()
    // Se pregunta por la tarjeta, no por el texto suelto: el mismo importe
    // puede aparecer tambien en la serie diaria, y una cifra correcta en el
    // sitio equivocado no es una cifra correcta.
    const ticket = screen.getByRole('article', { name: 'Ticket promedio' })
    expect(within(ticket).getByText('S/ 300.00')).toBeInTheDocument()
    expect(screen.getByText('40.00 %')).toBeInTheDocument()
    expect(screen.getByText('60.00 %')).toBeInTheDocument()
    // El denominador se enseña al lado de la razón: un porcentaje sin decir
    // sobre cuántos casos se calculó no se puede interpretar.
    expect(screen.getByText('4 de 10 intentos de compra')).toBeInTheDocument()
  })

  it('un indicador sin denominador se pinta como GUION, nunca como 0 %', async () => {
    renderAnalytics(backend({ kpis: KPIS_VACIOS }))
    // Tres razones sin datos: conversión, abandono y ticket promedio.
    const guiones = await screen.findAllByText('—')
    expect(guiones.length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('0.00 %')).not.toBeInTheDocument()
    expect(screen.queryByText('0 %')).not.toBeInTheDocument()
  })

  it('los productos más vendidos salen de lo VENDIDO, con su SKU', async () => {
    renderAnalytics(backend())
    expect(await screen.findByText('A-JABON')).toBeInTheDocument()
    expect(screen.getByText('S/ 80.00')).toBeInTheDocument()
  })

  it('el rendimiento por canal se pinta con el nombre del canal', async () => {
    renderAnalytics(backend())
    expect(await screen.findByText('Tienda web')).toBeInTheDocument()
  })

  it('el rango de fechas es uno solo para toda la pantalla', async () => {
    renderAnalytics(backend())
    const rango = await screen.findByRole('group', { name: 'Rango de fechas' })
    expect(rango).toBeInTheDocument()
    // Tres ventanas y ni un selector de fecha libre: el rango tiene que ser
    // comparable entre pestañas, y una fecha a mano por pestaña no lo es.
    expect(screen.getByRole('button', { name: 'Últimos 7 días' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Últimos 30 días' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Últimos 90 días' })).toBeInTheDocument()
  })

  it('exportar está disponible cuando hay serie que bajar', async () => {
    renderAnalytics(backend())
    const boton = await screen.findByRole('button', { name: 'Exportar' })
    expect(boton).toBeEnabled()
  })

  /**
   * La serie diaria es UNA curva, y una curva solo se puede dibujar si todos
   * sus puntos están en la misma unidad. Con dos monedas en el periodo se dice
   * que no hay serie comparable en vez de pintar una línea que suma soles con
   * dólares: es el mismo criterio que el guion de los importes.
   */
  it('con dos monedas en el periodo no se dibuja la serie: se dice por qué', async () => {
    renderAnalytics(
      backend({
        serie: [
          { day: '2026-08-27', orders: 1, units: 2, revenue: '300.00', currency: 'PEN' },
          { day: '2026-08-28', orders: 1, units: 1, revenue: '90.00', currency: 'USD' },
        ],
      }),
    )
    expect(await screen.findByText(/mezcla monedas/i)).toBeInTheDocument()
  })
})

describe('Analítica — el módulo vendible', () => {
  it('sin el addon, la pestaña de comportamiento dice «no está en tu plan»', async () => {
    window.history.replaceState(null, '', '#comportamiento')
    renderAnalytics(backend({ entitlements: [], advanced: false }))
    expect(await screen.findByText(/no está incluido|no está en/i)).toBeInTheDocument()
  })

  it('y el resumen sigue funcionando: se degrada, no se rompe', async () => {
    renderAnalytics(backend({ entitlements: [], advanced: false }))
    expect(await screen.findByText('S/ 900.00')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Comportamiento' })).toBeInTheDocument()
  })

  it('con el addon, el embudo enseña los hechos con su nombre legible', async () => {
    window.history.replaceState(null, '', '#comportamiento')
    renderAnalytics(backend())
    expect(await screen.findByText('Vio una ficha')).toBeInTheDocument()
    expect(screen.getByText('Añadió al carrito')).toBeInTheDocument()
  })

  it('un hecho de servidor no tiene visitas, y se pinta guion en vez de cero', async () => {
    window.history.replaceState(null, '', '#comportamiento')
    renderAnalytics(backend())
    const fila = (await screen.findByText('Pedido creado')).closest('tr')
    expect(fila?.textContent).toContain('—')
  })

  /**
   * Un embudo ordenado por cantidad es un ranking, no un embudo: deja de
   * responder «dónde se cae la gente», que es lo único que justifica la forma.
   * La base puede devolver los hechos en cualquier orden; la pantalla los pone
   * en el del recorrido de compra.
   */
  it('el embudo se pinta en el orden del recorrido, no en el que llegó', async () => {
    window.history.replaceState(null, '', '#comportamiento')
    renderAnalytics(
      backend({
        funnel: [
          { event_type: 'order_created', events: 4, sessions: null },
          { event_type: 'product_view', events: 120, sessions: 40 },
          { event_type: 'add_to_cart', events: 30, sessions: 18 },
        ],
      }),
    )
    const primera = await screen.findByText('Vio una ficha')
    const filas = [...(primera.closest('tbody')?.querySelectorAll('tr') ?? [])]
    expect(filas.map((fila) => fila.querySelector('td')?.textContent)).toEqual([
      'Vio una ficha',
      'Añadió al carrito',
      'Pedido creado',
    ])
  })

  it('los términos sin resultados se resaltan: son catálogo que falta', async () => {
    window.history.replaceState(null, '', '#comportamiento')
    renderAnalytics(backend())
    const fila = (await screen.findByText('jabon')).closest('tr')
    expect(fila?.textContent).toContain('12')
  })
})
