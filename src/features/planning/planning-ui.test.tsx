import { screen, within } from '@testing-library/react'
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
 * Sugerido y previsión en pantalla.
 *
 * Lo que se comprueba montando el árbol:
 *
 *  · que calcular **no crea nada**: la propuesta se ve antes de existir, y hace
 *    falta un segundo clic de una persona para guardarla;
 *  · que cada línea sale con **su motivo** al lado de la cifra: es lo que
 *    permite discutirla, y una cifra que no se discute no se corrige;
 *  · que una sugerencia ACEPTADA no ofrece avanzar a ningún sitio;
 *  · que sin `planning.demand` se lee qué falta en vez de una tabla vacía.
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
const { PlanningPage } = await import('./PlanningPage')

const CLIENTE = '55555555-5555-4555-5555-555555555501'
const SUGERENCIA_BORRADOR = '55555555-5555-4555-5555-555555555511'
const SUGERENCIA_ACEPTADA = '55555555-5555-4555-5555-555555555512'
const PRODUCTO = '55555555-5555-4555-5555-555555555521'

const PLANIFICACION = ['ecommerce.planning.demand']

beforeEach(() => {
  window.location.hash = ''
})

/** Una línea como la devuelve `suggest_order_v2` cuando SÍ tiene datos. */
function lineaV2(extra: Record<string, unknown> = {}) {
  return {
    product_id: PRODUCTO,
    variant_id: null,
    suggested_quantity: 12,
    last_period_quantity: 12,
    on_hand_quantity: 40,
    reason: 'Compro 12 en los ultimos 30 dias',
    model_code: 'history_seasonal_v2',
    inputs: {
      model: 'history_seasonal_v2',
      fallback: false,
      windows: { recent_days: 30, long_days: 90 },
      rates: { recent: 0.4, long: 0.4, base: 0.4 },
      blend: { recent: 1, long: 0 },
      seasonal: { applied: false, factor: 1, reason: 'menos_de_un_anio' },
      demand: 12,
      atp: { state: 'known', available: 40, source: 'catalog' },
      capped: false,
      shortage: false,
    },
    ...extra,
  }
}

function backend(
  options: { entitlements?: string[]; lineas?: Array<Record<string, unknown>> } = {},
): FakeSupabase {
  const { entitlements = PLANIFICACION, lineas = [lineaV2()] } = options
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
      customers: [
        {
          id: CLIENTE,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'C-001',
          name: 'Bodega Central',
          is_active: true,
          kind: 'company',
        },
      ],
      order_suggestions: [
        {
          id: SUGERENCIA_BORRADOR,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          customer_id: CLIENTE,
          sales_rep_id: null,
          status: 'draft',
          model_code: 'historic_v1',
          generated_at: '2026-09-01T10:00:00.000Z',
          order_id: null,
          customers: { code: 'C-001', name: 'Bodega Central' },
        },
        {
          id: SUGERENCIA_ACEPTADA,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          customer_id: CLIENTE,
          sales_rep_id: null,
          status: 'accepted',
          model_code: 'historic_v1',
          generated_at: '2026-08-01T10:00:00.000Z',
          order_id: null,
          customers: { code: 'C-002', name: 'Bodega Aceptada' },
        },
      ],
      order_suggestion_items: [],
      demand_forecasts: [],
      products: [
        { id: PRODUCTO, organization_id: ORG, company_id: COMPANY_A, store_id: STORE_A, name: 'Arroz Extra 5 kg', sku: 'ARZ-5' },
      ],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      // `suggest_order_v2` devuelve FILAS: no escribe nada, y el falso hace
      // exactamente lo mismo. Desde el cierre (item 11) la pantalla llama a v2,
      // que explica cada línea y cae él solo a `historic_v1`.
      suggest_order_v2: () => lineas,
    },
  })
}

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="planning.demand">
          <PlanningPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

/** Los nombres accesibles de las acciones de una fila, en orden. */
function nombresDe(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('button')).map(
    (boton) => boton.getAttribute('aria-label') ?? '',
  )
}

function filaCon(texto: string): HTMLElement {
  const fila = screen.getAllByRole('row').find((row) => row.textContent?.includes(texto))
  if (!fila) throw new Error(`No hay una fila con «${texto}»`)
  return fila
}

describe('el listado de sugerencias', () => {
  it('enseña el MODELO con el que se calculó', async () => {
    pintar(backend())
    await screen.findByText('Bodega Central')

    // Sin modelo a la vista, la cifra no tiene procedencia y no se puede
    // retirar un modelo que sugiere mal sin borrar lo que ya sugirió.
    expect(screen.getAllByText('historic_v1')).toHaveLength(2)
  })

  it('una sugerencia ACEPTADA no ofrece avanzar a ningún sitio', async () => {
    pintar(backend())
    await screen.findByText('Bodega Aceptada')

    // Las acciones son ICONOS: lo que hay que mirar es su nombre accesible, no
    // el texto de la fila. A una aceptada solo le queda abrirla.
    expect(nombresDe(filaCon('Bodega Aceptada'))).toEqual(['Abrir: Bodega Aceptada'])
    expect(nombresDe(filaCon('Bodega Central'))).toContain('Enviar: Bodega Central')
  })

  it('sin el módulo contratado dice qué falta, no enseña una tabla vacía', async () => {
    pintar(backend({ entitlements: [] }))

    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByText('Bodega Central')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('generar un sugerido', () => {
  it('calcular NO crea nada: hace falta un segundo clic de una persona', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Bodega Central')

    await user.click(screen.getByRole('button', { name: 'Generar sugerido' }))
    await screen.findByText('Primero se ve, después se guarda.')

    // El buscador es un autocompletado: se escribe y se elige del desplegable,
    // que es un `option`. Antes volcaba los 28 clientes dentro del cajón.
    await user.type(screen.getByRole('combobox', { name: /Cliente/ }), 'Bodega')
    await user.click(await screen.findByRole('option', { name: /Bodega Central/ }))
    await user.click(screen.getByRole('button', { name: 'Calcular' }))

    // La propuesta está a la vista con su motivo…
    expect(await screen.findByText('Compro 12 en los ultimos 30 dias')).toBeInTheDocument()
    // …y todavía no existe. Un sistema que pide por ti se equivoca por ti.
    expect(fake.state.tables.order_suggestions).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Guardar sugerido' }))

    // Ahora sí, y con su línea y su motivo guardados.
    await vi.waitFor(() => expect(fake.state.tables.order_suggestions).toHaveLength(3))
    const lineas = (fake.state.tables.order_suggestion_items ?? []) as Array<{
      reason: string
      suggested_quantity: string
    }>
    expect(lineas).toHaveLength(1)
    expect(lineas[0]?.reason).toBe('Compro 12 en los ultimos 30 dias')
  })

  it('el botón de guardar está apagado hasta que hay algo calculado', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('Bodega Central')

    await user.click(screen.getByRole('button', { name: 'Generar sugerido' }))
    await screen.findByText('Primero se ve, después se guarda.')

    expect(screen.getByRole('button', { name: 'Guardar sugerido' })).toBeDisabled()
  })
})

/**
 * Sugerido v2 en pantalla (cierre · item 11).
 *
 *  · la línea enseña su producto, su motivo y las PIEZAS con que se calculó;
 *  · lo que se guarda dice con qué modelo se calculó y cuánto había disponible
 *    — antes toda sugerencia nacía `historic_v1` por el default de la columna;
 *  · si el servidor cayó al modelo simple, la pantalla lo dice;
 *  · una línea sin disponibilidad se ve, pero no se guarda.
 */
const OTRO_PRODUCTO = '55555555-5555-4555-5555-555555555522'

async function calcularPara(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Bodega Central')
  await user.click(screen.getByRole('button', { name: 'Generar sugerido' }))
  await screen.findByText('Primero se ve, después se guarda.')
  await user.type(screen.getByRole('combobox', { name: /Cliente/ }), 'Bodega')
  await user.click(await screen.findByRole('option', { name: /Bodega Central/ }))
  await user.click(screen.getByRole('button', { name: 'Calcular' }))
}

describe('sugerido v2', () => {
  it('enseña producto, motivo y cómo se calculó, y guarda modelo y disponible', async () => {
    const user = userEvent.setup()
    const fake = backend({
      lineas: [
        lineaV2({
          suggested_quantity: 8,
          on_hand_quantity: 8,
          reason: 'Compró 12 en los últimos 30 días. Limitado a 8 disponibles',
          inputs: {
            ...lineaV2().inputs,
            seasonal: { applied: true, factor: 1.5, reason: 'historial_anual' },
            blend: { recent: 0.6, long: 0.4 },
            capped: true,
          },
        }),
      ],
    })
    pintar(fake)
    await calcularPara(user)

    expect(await screen.findByText('Compró 12 en los últimos 30 días. Limitado a 8 disponibles')).toBeInTheDocument()
    expect(await screen.findByText('Arroz Extra 5 kg')).toBeInTheDocument()
    expect(screen.getByText('Historial con temporada')).toBeInTheDocument()
    const piezas = screen.getByRole('group', { name: 'Cómo se calculó' })
    expect(within(piezas).getByText('Ritmo 0.4/día')).toBeInTheDocument()
    expect(within(piezas).getByText('Mezcla 60 % reciente · 40 % 90 días')).toBeInTheDocument()
    expect(within(piezas).getByText('Temporada ×1.5')).toBeInTheDocument()
    expect(within(piezas).getByText('Recortado a lo disponible')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar sugerido' }))

    await vi.waitFor(() => expect(fake.state.tables.order_suggestions).toHaveLength(3))
    const cabecera = fake.state.tables.order_suggestions?.at(-1)
    expect(cabecera?.model_code).toBe('history_seasonal_v2')
    const lineas = fake.state.tables.order_suggestion_items ?? []
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatchObject({ suggested_quantity: '8', on_hand_quantity: '8' })
  })

  it('si el servidor cayó al modelo simple, lo dice y lo guarda como historic_v1', async () => {
    const user = userEvent.setup()
    const fake = backend({
      lineas: [
        lineaV2({
          model_code: 'historic_v1',
          on_hand_quantity: null,
          inputs: { model: 'historic_v1', fallback: true, fallback_reason: 'v2_sin_lineas' },
        }),
      ],
    })
    pintar(fake)
    await calcularPara(user)

    expect(
      await screen.findByText(
        'No había datos suficientes para el sugerido con temporada: se muestra el modelo simple, con las mismas reglas de publicación, surtido y canal.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar sugerido' }))
    await vi.waitFor(() => expect(fake.state.tables.order_suggestions).toHaveLength(3))
    expect(fake.state.tables.order_suggestions?.at(-1)?.model_code).toBe('historic_v1')
  })

  it('una línea sin disponibilidad se ve pero no se guarda', async () => {
    const user = userEvent.setup()
    const fake = backend({
      lineas: [
        lineaV2(),
        lineaV2({
          product_id: OTRO_PRODUCTO,
          suggested_quantity: 0,
          on_hand_quantity: 0,
          reason: 'Compró 4 en los últimos 30 días. Sin disponibilidad ahora: no se propone cantidad',
          inputs: { ...lineaV2().inputs, capped: true, shortage: true },
        }),
      ],
    })
    pintar(fake)
    await calcularPara(user)

    expect(await screen.findByText('Sin disponibilidad: no se guarda')).toBeInTheDocument()
    expect(screen.getByText('1 líneas sin disponibilidad se muestran pero no se guardarán.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar sugerido' }))
    await vi.waitFor(() => expect(fake.state.tables.order_suggestion_items ?? []).toHaveLength(1))
    expect(fake.state.tables.order_suggestion_items?.[0]?.product_id).toBe(PRODUCTO)
  })

  it('si ninguna línea tiene disponibilidad, no hay nada que guardar', async () => {
    const user = userEvent.setup()
    pintar(
      backend({
        lineas: [
          lineaV2({
            suggested_quantity: 0,
            inputs: { ...lineaV2().inputs, capped: true, shortage: true },
          }),
        ],
      }),
    )
    await calcularPara(user)

    expect(
      await screen.findByText('Ninguna línea tiene disponibilidad ahora: no hay nada que guardar.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar sugerido' })).toBeDisabled()
  })
})