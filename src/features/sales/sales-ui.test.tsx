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
 * Fuerza de ventas en pantalla.
 *
 * Lo que se comprueba montando el árbol es lo que no se ve en la base:
 *
 *  · que la página está **gateada por `sales.force`**, y sin la capacidad se lee
 *    qué falta en vez de una tabla vacía que parece un fallo;
 *  · que el desplegable de jefe **no ofrece lo que la base va a rechazar** —ni
 *    el propio vendedor ni su descendencia—, porque un desplegable que ofrece
 *    una opción que falla al guardar es un desplegable que miente;
 *  · que la baja **desactiva** y no borra: de un vendedor cuelgan sus
 *    liquidaciones, y `commission_statements` lo referencia con `restrict`.
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
const { SalesPage } = await import('./SalesPage')

const JEFE = '88888888-8888-4888-8888-888888888801'
const MEDIO = '88888888-8888-4888-8888-888888888802'
const ABAJO = '88888888-8888-4888-8888-888888888803'
const SUELTO = '88888888-8888-4888-8888-888888888804'

const TERRITORIO_A = '88888888-8888-4888-8888-888888888811'
const TERRITORIO_B = '88888888-8888-4888-8888-888888888812'
const VISITA_SIN_ENTRADA = '88888888-8888-4888-8888-888888888821'
const VISITA_CON_ENTRADA = '88888888-8888-4888-8888-888888888822'
const LIQUIDACION_PAGADA = '88888888-8888-4888-8888-888888888831'
const LIQUIDACION_BORRADOR = '88888888-8888-4888-8888-888888888832'

const FUERZA = ['ecommerce.sales.force']
/** Las tres capacidades: la ruta y las dos que gatean pestañas. */
const TODO = [
  'ecommerce.sales.force',
  'ecommerce.sales.territory',
  'ecommerce.sales.performance',
]

function rep(id: string, code: string, name: string, manager: string | null, extras = {}) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    user_id: null,
    employee_code: code,
    full_name: name,
    email: null,
    phone: null,
    manager_id: manager,
    status: 'active',
    hired_at: null,
    notes: null,
    ...extras,
  }
}

function backend(options: { entitlements?: string[] } = {}): FakeSupabase {
  const { entitlements = FUERZA } = options
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
      sales_reps: [
        rep(JEFE, 'V-001', 'Marta Jefa', null),
        rep(MEDIO, 'V-002', 'Luis Medio', JEFE),
        rep(ABAJO, 'V-003', 'Pia Abajo', MEDIO),
        rep(SUELTO, 'V-004', 'Sin Jefe', null, { user_id: USER }),
      ],
      sales_rep_customers: [],
      customers: [],
      sales_territories: [
        {
          id: TERRITORIO_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          parent_id: null,
          code: 'NORTE',
          name: 'Norte',
          is_active: true,
        },
        {
          id: TERRITORIO_B,
          organization_id: ORG,
          company_id: COMPANY_A,
          parent_id: TERRITORIO_A,
          code: 'NORTE-1',
          name: 'Norte Alto',
          is_active: true,
        },
      ],
      sales_routes: [],
      sales_route_stops: [],
      sales_visits: [
        {
          id: VISITA_SIN_ENTRADA,
          organization_id: ORG,
          company_id: COMPANY_A,
          sales_rep_id: JEFE,
          customer_id: TERRITORIO_A,
          route_id: null,
          planned_at: '2026-09-02T09:00:00.000Z',
          checked_in_at: null,
          checked_out_at: null,
          outcome: 'planned',
          order_id: null,
          notes: null,
          customers: { name: 'Bodega Sin Entrada' },
          sales_reps: { full_name: 'Marta Jefa' },
        },
        {
          id: VISITA_CON_ENTRADA,
          organization_id: ORG,
          company_id: COMPANY_A,
          sales_rep_id: JEFE,
          customer_id: TERRITORIO_B,
          route_id: null,
          planned_at: '2026-09-02T11:00:00.000Z',
          checked_in_at: '2026-09-02T11:12:00.000Z',
          checked_out_at: null,
          outcome: 'planned',
          order_id: null,
          notes: null,
          customers: { name: 'Bodega Con Entrada' },
          sales_reps: { full_name: 'Marta Jefa' },
        },
      ],
      sales_goals: [],
      commission_statements: [
        {
          id: LIQUIDACION_BORRADOR,
          organization_id: ORG,
          company_id: COMPANY_A,
          sales_rep_id: JEFE,
          rule_id: null,
          period_start: '2026-08-01',
          period_end: '2026-08-31',
          currency: 'PEN',
          base_amount: '10000.00',
          rate: '0.0300',
          amount: '300.00',
          status: 'draft',
          approved_at: null,
          paid_at: null,
          sales_reps: { full_name: 'Marta Jefa' },
        },
        {
          id: LIQUIDACION_PAGADA,
          organization_id: ORG,
          company_id: COMPANY_A,
          sales_rep_id: MEDIO,
          rule_id: null,
          period_start: '2026-07-01',
          period_end: '2026-07-31',
          currency: 'PEN',
          base_amount: '8000.00',
          rate: '0.0250',
          amount: '200.00',
          status: 'paid',
          approved_at: '2026-08-01T00:00:00.000Z',
          paid_at: '2026-08-05T00:00:00.000Z',
          sales_reps: { full_name: 'Luis Medio' },
        },
      ],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
    },
  })
}

/**
 * El `#hash` de `SectionTabs` sobrevive entre tests: jsdom comparte una sola
 * `window`. Sin limpiarlo, un test que abre «Territorios» deja al siguiente
 * arrancando en esa pestaña, y el siguiente falla buscando algo que está en
 * otra — un fallo que no dice nada de la aplicación.
 */
beforeEach(() => {
  window.location.hash = ''
})

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="sales.force">
          <SalesPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    // La sesion va al render, no solo al falso: sin ella el `TenantProvider`
    // se queda resolviendo y la pagina nunca pasa del esqueleto.
    { session: fake.state.session },
  )
}

describe('la página de fuerza de ventas', () => {
  it('lista los vendedores con su jefe', async () => {
    pintar(backend())

    // Aparece DOS veces: como su propia fila y como jefa de Luis. El jefe se
    // resuelve a nombre y no a un uuid — la tabla se lee, no se descifra.
    expect(await screen.findAllByText('Marta Jefa')).toHaveLength(2)
    expect(screen.getAllByText('Luis Medio')).toHaveLength(2)
  })

  it('distingue quién ENTRA a la aplicación de quién solo existe en el maestro', async () => {
    pintar(backend())
    await screen.findAllByText('Marta Jefa')

    // Muchos preventistas nunca entran: dar de alta a uno no es crear un usuario.
    expect(screen.getAllByText('Solo maestro').length).toBe(3)
    expect(screen.getAllByText('Entra').length).toBe(1)
  })

  it('sin el módulo contratado dice qué falta, no enseña una tabla vacía', async () => {
    pintar(backend({ entitlements: [] }))

    // El gate pinta su propio aviso; lo que importa es que la tabla NO esté.
    // Una tabla vacía se lee como un fallo del sistema; esto se lee como lo que
    // es: algo que no está en el plan.
    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByText('Marta Jefa')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('el desplegable de jefe', () => {
  it('no ofrece al propio vendedor ni a quien le reporta', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findAllByText('Marta Jefa')

    await user.click(screen.getByRole('button', { name: /Editar: Marta Jefa/ }))
    await screen.findByRole('heading', { name: 'Marta Jefa' })

    await user.click(screen.getByRole('combobox', { name: 'Jefe' }))

    // Marta es la raíz: Luis y Pía cuelgan de ella, así que ofrecer cualquiera
    // de los tres cerraría un círculo y la base respondería VENDEDOR_CICLO.
    const opciones = screen.getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toEqual(['Sin jefe', 'V-004 · Sin Jefe'])
  })

  it('a un vendedor sin descendencia sí le ofrece a los demás', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('Sin Jefe')

    await user.click(screen.getByRole('button', { name: /Editar: Pia Abajo/ }))
    await screen.findByRole('heading', { name: 'Pia Abajo' })
    await user.click(screen.getByRole('combobox', { name: 'Jefe' }))

    const opciones = screen.getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toContain('V-001 · Marta Jefa')
    expect(opciones).toContain('V-002 · Luis Medio')
    // Pero nunca a sí misma.
    expect(opciones).not.toContain('V-003 · Pia Abajo')
  })
})

describe('la baja', () => {
  it('DESACTIVA, no borra: de un vendedor cuelgan sus liquidaciones', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findAllByText('Marta Jefa')

    await user.click(screen.getByRole('button', { name: /Dar de baja: Sin Jefe/ }))

    const filas = (fake.state.tables.sales_reps ?? []) as Array<{ id: string; status: string }>
    // La fila sigue ahí. `commission_statements` la referencia con `restrict`
    // justo para que un borrado no se lleve por delante un pago ya hecho.
    expect(filas).toHaveLength(4)
    expect(filas.find((f) => f.id === SUELTO)?.status).toBe('disabled')
  })
})

/** Abre una pestaña de la página por su nombre. */
async function irA(user: ReturnType<typeof userEvent.setup>, nombre: string) {
  await user.click(await screen.findByRole('tab', { name: nombre }))
}

describe('las pestañas del recorrido B2B', () => {
  it('van gateadas por SU capacidad, que no es la de la ruta', async () => {
    const user = userEvent.setup()
    // Con `sales.force` a secas se entra a la página pero no a territorios.
    pintar(backend({ entitlements: FUERZA }))
    await screen.findAllByText('Marta Jefa')

    await irA(user, 'Territorios')

    // Se lee qué addon falta, no una tabla vacía que parecería un fallo.
    expect(await screen.findByText('sales.territory')).toBeInTheDocument()
    expect(screen.queryByText('Norte Alto')).not.toBeInTheDocument()
  })

  it('con la capacidad contratada, los territorios se listan', async () => {
    const user = userEvent.setup()
    pintar(backend({ entitlements: TODO }))
    await screen.findAllByText('Marta Jefa')

    await irA(user, 'Territorios')

    expect(await screen.findByText('Norte')).toBeInTheDocument()
    expect(screen.getByText('Norte Alto')).toBeInTheDocument()
  })
})

describe('las visitas', () => {
  it('no dejan dar por visitada una visita SIN entrada registrada', async () => {
    const user = userEvent.setup()
    pintar(backend({ entitlements: TODO }))
    await screen.findAllByText('Marta Jefa')

    await irA(user, 'Visitas')
    await screen.findByText('Bodega Sin Entrada')

    const filas = screen.getAllByRole('row')
    const sinEntrada = filas.find((row) => row.textContent?.includes('Bodega Sin Entrada'))!
    const conEntrada = filas.find((row) => row.textContent?.includes('Bodega Con Entrada'))!

    // `sales_visits_completed_needs_checkin` lo rechazaría; el botón lo dice
    // antes. Sin marca de entrada, «visitado» no lo respalda nada.
    expect(botonDe(sinEntrada, 'Dar por visitada')).toBeDisabled()
    expect(botonDe(conEntrada, 'Dar por visitada')).toBeEnabled()
  })

  it('registrar la entrada NO machaca la hora prevista', async () => {
    const user = userEvent.setup()
    const fake = backend({ entitlements: TODO })
    pintar(fake)
    await screen.findAllByText('Marta Jefa')

    await irA(user, 'Visitas')
    await screen.findByText('Bodega Sin Entrada')

    const filas = screen.getAllByRole('row')
    const sinEntrada = filas.find((row) => row.textContent?.includes('Bodega Sin Entrada'))!
    await user.click(botonDe(sinEntrada, 'Registrar entrada'))

    const visitas = (fake.state.tables.sales_visits ?? []) as Array<{
      id: string
      planned_at: string
      checked_in_at: string | null
    }>
    const tocada = visitas.find((v) => v.id === VISITA_SIN_ENTRADA)!
    expect(tocada.checked_in_at).not.toBeNull()
    // La agenda intacta: es la única prueba de si la visita se hizo a su hora.
    expect(tocada.planned_at).toBe('2026-09-02T09:00:00.000Z')
  })
})

describe('las comisiones', () => {
  it('una liquidación PAGADA no ofrece ningún avance', async () => {
    const user = userEvent.setup()
    pintar(backend({ entitlements: TODO }))
    await screen.findAllByText('Marta Jefa')

    await irA(user, 'Metas y comisiones')
    await screen.findByText('Pagada')

    const filas = screen.getAllByRole('row')
    const pagada = filas.find((row) => row.textContent?.includes('Luis Medio'))!
    const borrador = filas.find((row) => row.textContent?.includes('Marta Jefa'))!

    // `commission_statement_guard` cierra `paid`: reabrirla sería dinero que ya
    // salió y una cifra que dice que no.
    expect(pagada.querySelectorAll('button')).toHaveLength(0)
    expect(botonDe(borrador, 'Aprobar')).toBeEnabled()
  })
})

/**
 * El botón de una fila, por el comienzo de su nombre accesible.
 *
 * Las acciones de tabla son ICONOS, así que no tienen texto: el nombre vive en
 * `aria-label` y arrastra además el identificador de la fila —«Dar por
 * visitada: Bodega Sin Entrada»— para que un lector de pantalla no oiga
 * «Abrir» veinte veces sin saber de cuál. Se busca por prefijo por eso.
 */
function botonDe(row: HTMLElement, name: string): HTMLElement {
  const encontrado = accionesDe(row).find(([etiqueta]) => etiqueta.startsWith(name))
  if (!encontrado) throw new Error(`No hay un botón «${name}» en esa fila`)
  return encontrado[1]
}

/** Las acciones de una fila como pares [nombre accesible, botón]. */
function accionesDe(row: HTMLElement): Array<[string, HTMLElement]> {
  return Array.from(row.querySelectorAll('button')).map((boton) => [
    boton.getAttribute('aria-label') ?? '',
    boton,
  ])
}
