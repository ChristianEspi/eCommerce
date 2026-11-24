import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, USER, createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * El centro de vigilancia en la PANTALLA.
 *
 *  · El contador dice cuántos avisos hay sin abrir el panel.
 *  · Cada tarjeta se lee en el idioma de la interfaz: la base manda `key` y
 *    cifras, nunca una frase.
 *  · Silenciar llama al comando con la CIFRA con la que se vio el aviso.
 *  · Lo silenciado se cuenta y se puede volver a mostrar: un panel en calma
 *    porque alguien tapó tres avisos mentiría.
 *  · Un aviso que esta versión no conoce se ignora en vez de romper el panel.
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
const { WatchButton, WatchDrawer } = await import('./WatchDrawer')
const { WatchSection } = await import('./WatchSection')
const { WatchModuleNote } = await import('./WatchModuleNote')

const impagos = {
  key: 'orders.unpaid',
  module: 'orders',
  severity: 'critica',
  count: 13,
  fingerprint: '13',
  metrics: { count: 13, oldest_days: 9 },
  samples: [{ label: 'EC-000012', days: 9 }],
  href: '/app/orders',
}

const bajoMinimo = {
  key: 'inventory.below_reorder',
  module: 'inventory',
  severity: 'advertencia',
  count: 3,
  fingerprint: '3',
  metrics: { count: 3 },
  samples: [],
  href: '/app/inventory',
}

function findings(overrides: Record<string, unknown> = {}) {
  const items = (overrides.items as unknown[]) ?? [impagos, bajoMinimo]
  return {
    generated_at: '2026-09-25T10:00:00.000Z',
    store_id: STORE_A,
    critical: items.filter((i) => (i as { severity?: string }).severity === 'critica').length,
    total: items.length,
    items,
    dismissed: (overrides.dismissed as unknown[]) ?? [],
  }
}

function backend(result = findings(), analysis?: unknown): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      watch_findings: () => result,
      watch_dismiss: () => ({ key: 'orders.unpaid', expires_at: '2026-10-02T10:00:00.000Z' }),
      watch_restore: () => null,
      ai_entitlement: () => ({
        enabled: true,
        status: 'active',
        plan: 'active',
        period: '202609',
        used: 1,
        quota: 500,
        remaining: 499,
        features: { insights: true },
      }),
    },
    functions: analysis ? { 'watch-assistant': () => analysis } : {},
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

/** El cajón vive en el layout; aquí basta con el botón y su estado. */
function Panel() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <WatchButton onOpen={() => setOpen(true)} />
      <WatchDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function render(result = findings()) {
  const client = backend(result)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <Panel />
    </TenantProvider>,
    { session: makeSession(), route: '/app' },
  )
  return client
}

function pintarNota(result = findings(), route = '/app/orders') {
  holder.client = backend(result)
  const onOpen = vi.fn()
  renderWithProviders(
    <TenantProvider>
      <WatchModuleNote onOpen={onOpen} />
    </TenantProvider>,
    { session: makeSession(), route },
  )
  return onOpen
}

async function abrir() {
  await userEvent.click(await screen.findByRole("button", { name: /centro de vigilancia/i }))
  return screen.findByRole('dialog', { name: 'Centro de vigilancia' })
}

beforeEach(() => {
  holder.client = null
})

describe('centro de vigilancia', () => {
  it('el contador dice cuántos avisos hay antes de abrir nada', async () => {
    render()
    expect(await screen.findByRole('button', { name: 'Centro de vigilancia: 2 avisos' })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('cada aviso se lee traducido, con su severidad, su módulo y sus cifras', async () => {
    render()
    const dialog = await abrir()

    expect(within(dialog).getByText('Pedidos sin cobrar')).toBeInTheDocument()
    // Cuerpo y ejemplos van en el mismo párrafo, como en el Crew de la suite.
    expect(
      within(dialog).getByText(/13 pedidos llevan más de 3 días sin pago. El más antiguo, 9 días./),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Crítica')).toBeInTheDocument()
    expect(within(dialog).getByText('Pedidos')).toBeInTheDocument()
    expect(within(dialog).getByText(/EC-000012/)).toBeInTheDocument()

    expect(within(dialog).getByText('Bajo punto de pedido')).toBeInTheDocument()
    expect(within(dialog).getByText('Advertencia')).toBeInTheDocument()
  })

  it('la flecha lleva a la pantalla donde se resuelve', async () => {
    render()
    const dialog = await abrir()
    const ir = within(dialog).getByRole('link', { name: 'Ir a resolverlo: Pedidos sin cobrar' })
    // 2026-11-23 · Abre Pedidos ya en la pestaña de pendientes, no la lista entera.
    expect(ir).toHaveAttribute('href', '/app/orders?estado=pending')
  })

  it('silenciar manda la clave y la CIFRA con la que se vio el aviso', async () => {
    const client = render()
    const dialog = await abrir()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Silenciar este aviso: Pedidos sin cobrar' }))

    await waitFor(() =>
      expect(client.state.rpcCalls.some((call) => call.name === 'watch_dismiss')).toBe(true),
    )
    const llamada = client.state.rpcCalls.find((call) => call.name === 'watch_dismiss')
    expect(llamada?.args).toMatchObject({ p_key: 'orders.unpaid', p_fingerprint: '13' })
    // El tenant no viaja NUNCA en el cuerpo: lo pone el token.
    expect(Object.keys(llamada?.args ?? {})).not.toContain('p_organization_id')
  })

  it('lo silenciado se cuenta y se puede volver a mostrar', async () => {
    const client = render(findings({ items: [bajoMinimo], dismissed: [impagos] }))
    const dialog = await abrir()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Ver 1 silenciados' }))
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Volver a mostrarlo: Pedidos sin cobrar' }),
    )

    await waitFor(() =>
      expect(client.state.rpcCalls.some((call) => call.name === 'watch_restore')).toBe(true),
    )
  })

  it('el bloque del Resumen enseña las MISMAS tarjetas que el cajón', async () => {
    holder.client = backend()
    renderWithProviders(
      <TenantProvider>
        <WatchSection />
      </TenantProvider>,
      { session: makeSession(), route: '/app' },
    )
    expect(await screen.findByText('Pedidos sin cobrar')).toBeInTheDocument()
    // El contador de la suite y la leyenda de que esto NO gasta IA.
    expect(screen.getByLabelText('Centro de vigilancia: 2 avisos')).toHaveTextContent('2')
    expect(
      screen.getByText(/Lo que está en rojo ahora mismo.*Calculado por el sistema · no consume IA/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ejecutar análisis/ })).toBeEnabled()
  })

  it('en el carril lateral caben cuatro avisos; el resto, tras «Ver N más»', async () => {
    const claves = [
      'orders.unpaid',
      'orders.paid_unshipped',
      'orders.awaiting_approval',
      'inventory.negative',
      'inventory.below_reorder',
      'fulfillment.overdue',
      'credit.overdue',
      'catalog.unpublished',
    ]
    const muchos = claves.map((key, i) => ({ ...bajoMinimo, key, fingerprint: String(i) }))
    holder.client = backend(findings({ items: muchos }))
    renderWithProviders(
      <TenantProvider>
        <WatchSection />
      </TenantProvider>,
      { session: makeSession(), route: '/app' },
    )
    expect(await screen.findByRole('button', { name: 'Ver 4 más' })).toBeInTheDocument()
    expect(screen.queryByText('Catálogo sin publicar')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ver 4 más' }))
    expect(screen.getByText('Catálogo sin publicar')).toBeInTheDocument()
  })

  /**
   * El análisis NO cambia los hechos: reordena las mismas tarjetas y añade una
   * línea de por qué. Las cifras siguen siendo las que calculó la base.
   */
  it('«Ejecutar análisis» reordena las tarjetas y explica cada una', async () => {
    holder.client = backend(findings(), {
      data: {
        headline: 'Primero el cobro parado; el inventario puede esperar a mañana.',
        order: ['inventory.below_reorder', 'orders.unpaid'],
        reasons: [
          { key: 'inventory.below_reorder', why: 'Se queda sin existencia antes del fin de semana.' },
          { key: 'orders.unpaid', why: 'Es dinero facturado que no ha entrado.' },
        ],
      },
      motivo: null,
      interaction_id: null,
    })
    renderWithProviders(
      <TenantProvider>
        <WatchSection />
      </TenantProvider>,
      { session: makeSession(), route: '/app' },
    )
    await screen.findByText('Pedidos sin cobrar')
    await userEvent.click(screen.getByRole('button', { name: /Ejecutar análisis/ }))

    expect(await screen.findByText('Es dinero facturado que no ha entrado.')).toBeInTheDocument()
    expect(
      screen.getByText('Primero el cobro parado; el inventario puede esperar a mañana.'),
    ).toBeInTheDocument()
    // El orden del modelo manda: el inventario pasa delante.
    const titulos = screen.getAllByText(/Pedidos sin cobrar|Bajo punto de pedido/).map((n) => n.textContent)
    expect(titulos).toEqual(['Bajo punto de pedido', 'Pedidos sin cobrar'])
  })

  it('si el análisis no se puede hacer, la lista determinista se queda igual', async () => {
    holder.client = backend(findings(), { data: null, motivo: 'sin_cuota', interaction_id: null })
    renderWithProviders(
      <TenantProvider>
        <WatchSection />
      </TenantProvider>,
      { session: makeSession(), route: '/app' },
    )
    await screen.findByText('Pedidos sin cobrar')
    await userEvent.click(screen.getByRole('button', { name: /Ejecutar análisis/ }))

    expect(await screen.findByText('Pedidos sin cobrar')).toBeInTheDocument()
    expect(screen.getByText('Bajo punto de pedido')).toBeInTheDocument()
  })

  /** Un bloque que casi siempre dice «todo bien» enseña a ignorarlo. */
  it('el bloque del Resumen no ocupa sitio cuando no hay nada que mirar', async () => {
    holder.client = backend(findings({ items: [] }))
    const { container } = renderWithProviders(
      <TenantProvider>
        <WatchSection />
      </TenantProvider>,
      { session: makeSession(), route: '/app' },
    )
    await waitFor(() => expect(container.querySelector('h2')).toBeNull())
  })

  /**
   * El panel sigue siendo la vista de TODA la tienda; lo que cambia es el
   * orden, para no tener que buscar el aviso del módulo donde ya estás.
   */
  it('abierto desde un módulo, sus avisos salen primero', async () => {
    holder.client = backend()
    renderWithProviders(
      <TenantProvider>
        <Panel />
      </TenantProvider>,
      { session: makeSession(), route: '/app/inventory' },
    )
    const dialog = await abrir()

    const titulos = within(dialog)
      .getAllByText(/Pedidos sin cobrar|Bajo punto de pedido/)
      .map((n) => n.textContent)
    expect(titulos).toEqual(['Bajo punto de pedido', 'Pedidos sin cobrar'])
  })

  it('la cabecera del módulo dice cuántos avisos hay y abre el panel', async () => {
    const onOpen = pintarNota()
    expect(await screen.findByText('Hay 1 aviso abierto en este módulo')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Ver en el centro de vigilancia/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('la cabecera no dice nada donde no hay avisos de ese módulo', async () => {
    pintarNota(findings(), '/app/settings')
    await waitFor(() => expect(screen.queryByText(/aviso abierto en este módulo/)).not.toBeInTheDocument())

    pintarNota(findings({ items: [] }), '/app/orders')
    await waitFor(() => expect(screen.queryByText(/aviso abierto en este módulo/)).not.toBeInTheDocument())
  })

  it('sin nada crítico lo dice, en vez de enseñar una lista vacía', async () => {
    render(findings({ items: [] }))
    const dialog = await abrir()
    expect(within(dialog).getByText('Nada crítico ahora mismo')).toBeInTheDocument()
  })

  it('un aviso que esta versión no conoce se ignora y el resto se pinta', async () => {
    render(
      findings({
        items: [
          { ...impagos },
          { ...bajoMinimo, key: 'modulo.futuro' },
        ],
      }),
    )
    const dialog = await abrir()
    expect(within(dialog).getByText('Pedidos sin cobrar')).toBeInTheDocument()
    expect(within(dialog).queryByText('Bajo punto de pedido')).not.toBeInTheDocument()
  })
})
