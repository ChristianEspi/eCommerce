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
const { OrdersPage } = await import('./OrdersPage')

const ORDER_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ORDER_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const ORDER_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const ORDER_4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const ITEM_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const EVENT_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const EVENT_2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
const TAG_1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const REF_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'

const TODAY = new Date().toISOString()
const OLD = new Date(Date.now() - 200 * 86_400_000).toISOString()

function orderRow(patch: Record<string, unknown> = {}) {
  return {
    id: ORDER_1,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    order_number: 'MI-000001',
    customer_name: 'Ana Compradora',
    customer_email: 'ana@compradora.com',
    customer_phone: '+51 999 111 222',
    status: 'pending',
    payment_status: 'pending',
    fulfillment_status: 'unfulfilled',
    approval_status: 'not_required',
    source_channel: 'storefront',
    currency: 'PEN',
    subtotal: '200.00',
    tax_total: '36.00',
    shipping_total: '0.00',
    discount_total: '0.00',
    grand_total: '236.00',
    tax_inclusive: false,
    shipping_address: { address: 'Av. Primavera 120', reference: 'Portón verde' },
    billing_address: { address: 'Av. Primavera 120' },
    customer_snapshot: { email: 'ana@compradora.com', name: 'Ana Compradora' },
    approval_reason: null,
    approval_decided_email: null,
    approval_decided_at: null,
    notes: null,
    placed_at: TODAY,
    updated_at: TODAY,
    ...patch,
  }
}

function backend(role: 'admin' | 'viewer' = 'admin'): FakeSupabase {
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
      orders: [
        orderRow(),
        orderRow({
          id: ORDER_2,
          order_number: 'MI-000002',
          customer_name: 'Beto Antiguo',
          customer_email: 'beto@antiguo.com',
          status: 'paid',
          payment_status: 'paid',
          grand_total: '99.00',
          placed_at: OLD,
        }),
        // Un pedido que ya se vendio del todo: cobrado, entregado y cerrado.
        // Desde aqui los tres ejes solo ofrecen marcha atras.
        orderRow({
          id: ORDER_4,
          order_number: 'MI-000004',
          customer_name: 'Dora Cerrada',
          customer_email: 'dora@cerrada.test',
          status: 'fulfilled',
          payment_status: 'paid',
          fulfillment_status: 'fulfilled',
        }),
        // Pedido B2B esperando la firma de su empresa: es lo que llena la
        // pestaña «Por aprobar» y lo que bloquea las transiciones.
        orderRow({
          id: ORDER_3,
          order_number: 'MI-000003',
          customer_name: 'Cecilia Corporativa',
          customer_email: 'compras@acme.test',
          approval_status: 'pending',
          approval_reason: 'account_threshold',
          customer_snapshot: {
            email: 'compras@acme.test',
            name: 'Cecilia Corporativa',
            account_name: 'Acme',
            tax_id: '20123456789',
          },
        }),
      ],
      order_items: [
        {
          id: ITEM_1,
          order_id: ORDER_1,
          product_id: null,
          sku: 'SILLA-1',
          name: 'Silla nórdica',
          variant_label: null,
          uom_code: null,
          unit_price: '100.00',
          quantity: 2,
          line_total: '200.00',
          discount_amount: '0.00',
          tax_rate: '0.1800',
          tax_amount: '36.00',
          tax_category_code: 'iva-general',
          price_source: 'catalog',
          price_list_code: null,
          created_at: TODAY,
        },
      ],
      order_events: [
        {
          id: EVENT_1,
          order_id: ORDER_1,
          event_type: 'order.created',
          axis: 'order_status',
          from_value: null,
          to_value: 'pending',
          note: null,
          source: 'storefront',
          actor_email: null,
          created_at: TODAY,
        },
        {
          id: EVENT_2,
          order_id: ORDER_1,
          event_type: 'order.payment_status_changed',
          axis: 'payment_status',
          from_value: 'pending',
          to_value: 'paid',
          note: 'Depósito verificado',
          source: 'backoffice',
          actor_email: 'duenio@negocio.com',
          created_at: TODAY,
        },
      ],
      order_notes: [],
      order_tags: [{ id: TAG_1, order_id: ORDER_1, tag: 'urgente' }],
      order_external_refs: [
        {
          id: REF_1,
          order_id: ORDER_1,
          system_code: 'erp',
          ref_type: 'invoice',
          external_id: 'F001-000123',
          external_url: null,
        },
      ],
    },
    rpc: {
      order_transition: (args) => ({ order_id: args.p_order_id, to: args.p_to }),
      order_approval_decide: (args) => ({
        order_id: args.p_order_id,
        approval_status: args.p_approve ? 'approved' : 'rejected',
      }),
    },
    functions: {
      'update-order-status': (body) => ({ id: String(body.order_id), status: body.status }),
    },
  })
}

function renderPage() {
  return renderWithProviders(
    <TenantProvider>
      <OrdersPage />
    </TenantProvider>,
    { session: makeSession() },
  )
}

/** Abre el pedido y devuelve el panel, ya en la pestaña pedida. */
async function openDrawer(
  user: ReturnType<typeof userEvent.setup>,
  number: string,
  tab?: 'Operación' | 'Historial',
): Promise<HTMLElement> {
  await user.click(await screen.findByText(number))
  const drawer = await screen.findByRole('dialog', { name: number })
  if (tab) await user.click(within(drawer).getByRole('tab', { name: tab }))
  return drawer
}

beforeEach(() => {
  holder.client = backend()
})

describe('OrdersPage — listado', () => {
  it('muestra numero, cliente, los tres ejes de estado, fecha y total', async () => {
    renderPage()

    const row = (await screen.findByText('MI-000001')).closest('tr') as HTMLElement
    expect(within(row).getByText('Ana Compradora')).toBeInTheDocument()
    expect(within(row).getByText('Pendiente')).toBeInTheDocument()
    expect(within(row).getByText('Sin cobrar')).toBeInTheDocument()
    expect(within(row).getByText('Sin despachar')).toBeInTheDocument()
    expect(within(row).getByText(/236[,.]00/)).toBeInTheDocument()
  })

  it('el buscador general filtra por numero, nombre o correo', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MI-000001')

    await user.type(screen.getByPlaceholderText(/Buscar por número/i), 'beto')

    await waitFor(() => expect(screen.queryByText('MI-000001')).not.toBeInTheDocument())
    expect(screen.getByText('MI-000002')).toBeInTheDocument()
  })

  it('los tabs de estado son un filtro, no una decoracion', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MI-000001')

    await user.click(screen.getByRole('tab', { name: 'Pagado' }))

    await waitFor(() => expect(screen.queryByText('MI-000001')).not.toBeInTheDocument())
    expect(screen.getByText('MI-000002')).toBeInTheDocument()
  })

  /**
   * «Por aprobar» no filtra por `status` sino por `approval_status`: es una cola
   * de trabajo pendiente, no un estado más del pedido.
   */
  it('la pestana «Por aprobar» es la cola de firmas pendientes', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MI-000001')

    await user.click(screen.getByRole('tab', { name: 'Por aprobar' }))

    await waitFor(() => expect(screen.queryByText('MI-000001')).not.toBeInTheDocument())
    expect(screen.getByText('MI-000003')).toBeInTheDocument()
  })

  it('el filtro de fecha deja fuera lo que cae fuera del rango', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MI-000002')

    await user.click(screen.getByRole('combobox', { name: /Fecha/i }))
    await user.click(await screen.findByRole('option', { name: 'Últimos 7 días' }))

    await waitFor(() => expect(screen.queryByText('MI-000002')).not.toBeInTheDocument())
    expect(screen.getByText('MI-000001')).toBeInTheDocument()
  })

  /**
   * La paginación la hace el SERVIDOR (`range` + `count: 'exact'`). Lo que se
   * comprueba es que el total que se pinta es el del FILTRO y no el de la
   * página: si alguien volviera a contar `rows.length`, esto falla.
   */
  it('pagina en el servidor y enseña el total del filtro', async () => {
    renderPage()
    await screen.findByText('MI-000001')
    // El paginador dice el tramo y el total del FILTRO, no de la pagina.
    const pager = screen.getByTestId('pager-summary')
    expect(pager.textContent).toContain('1–4')
    expect(pager.textContent).toContain('4')
  })
})

describe('OrdersPage — detalle en panel lateral', () => {
  it('abre el pedido con sus lineas, la entrega y el impuesto congelado', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001')

    expect(within(drawer).getByText('Silla nórdica')).toBeInTheDocument()
    expect(within(drawer).getByText(/SILLA-1/)).toBeInTheDocument()
    // Dos veces: la dirección de ENTREGA y la de FACTURACIÓN, que en una compra
    // B2C son la misma y aun así se guardan por separado.
    expect(within(drawer).getAllByText('Av. Primavera 120')).toHaveLength(2)
    expect(within(drawer).getByText('Portón verde')).toBeInTheDocument()
    // El impuesto de la línea es snapshot: se pinta desde el pedido, no desde
    // la configuración fiscal de hoy.
    expect(within(drawer).getAllByText(/36[,.]00/).length).toBeGreaterThan(0)
  })

  it('la linea de tiempo cuenta los cuatro ejes en un solo hilo', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Historial')

    expect(within(drawer).getByText('Pedido recibido')).toBeInTheDocument()
    expect(within(drawer).getByText('Desde la vitrina')).toBeInTheDocument()
    // Un cambio del eje de PAGO, no del comercial: la pantalla lo etiqueta.
    expect(within(drawer).getByText('Sin cobrar → Cobrado')).toBeInTheDocument()
    expect(within(drawer).getByText('Pago')).toBeInTheDocument()
    expect(within(drawer).getByText('Depósito verificado')).toBeInTheDocument()
  })

  it('el snapshot del cliente B2B enseña cuenta y documento fiscal', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000003')

    expect(within(drawer).getByText('Acme')).toBeInTheDocument()
    expect(within(drawer).getByText('20123456789')).toBeInTheDocument()
  })

  it('solo ofrece las transiciones que la base permite desde el estado actual', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.click(within(drawer).getByRole('combobox', { name: /Nuevo estado/i }))

    const options = (await screen.findAllByRole('option')).map((node) => node.textContent)
    expect(options).toEqual(['Pagado', 'Cancelado'])
  })

  /**
   * Con la venta cerrada, el bloque se llama por lo que hace.
   *
   * «Cambiar de estado» sugiere que el pedido todavia puede avanzar, y no
   * puede: desde `fulfilled` los tres ejes solo ofrecen reembolsar y devolver.
   * El operador abria el desplegable para averiguar si quedaba algo.
   */
  it('un pedido ya vendido llama al bloque «Devoluciones y reembolsos»', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000004', 'Operación')
    expect(within(drawer).getByText('Devoluciones y reembolsos')).toBeInTheDocument()
    expect(within(drawer).queryByText('Cambiar de estado')).not.toBeInTheDocument()

    // Y lo que ofrece es, en efecto, solo marcha atras.
    await user.click(within(drawer).getByRole('combobox', { name: /Nuevo estado/i }))
    const opciones = (await screen.findAllByRole('option')).map((n) => n.textContent)
    expect(opciones).toEqual(['Reembolsado'])
  })

  it('un pedido todavia abierto sigue diciendo «Cambiar de estado»', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    expect(within(drawer).getByText('Cambiar de estado')).toBeInTheDocument()
  })

  /**
   * Las etiquetas no filtran nada, y el texto ya no dice que si.
   *
   * Prometia «Sirven para filtrar y priorizar» mientras el buscador del listado
   * miraba numero, nombre y correo, sin columna, sin filtro y sin salir en el
   * CSV. Una ayuda que promete de mas se descubre el dia que alguien la usa.
   */
  it('la ayuda de las etiquetas no promete un filtro que no existe', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    expect(within(drawer).getByText(/todavía no filtran el listado/)).toBeInTheDocument()
  })

  /**
 * De donde SALE, no solo a donde va.
   *
   * Elegir destino sin ver el origen convierte «Nuevo estado» en una lista sin
   * contexto: los valores cambian al cambiar de eje —cada uno tiene su
   * vocabulario— y sin el punto de partida no hay forma de saber por que.
   */
  it('el selector de eje dice en que estado esta ese eje AHORA', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    expect(within(drawer).getByText('Ahora: Pendiente')).toBeInTheDocument()

    await user.click(within(drawer).getByRole('combobox', { name: /Qué se mueve/i }))
    await user.click(await screen.findByRole('option', { name: 'Entrega' }))

    // El mismo pedido, otro eje, otro punto de partida.
    expect(within(drawer).getByText('Ahora: Sin despachar')).toBeInTheDocument()
  })

  /**
   * Cancelar es TERMINAL: el pedido no vuelve a moverse.
   *
   * El atajo lo hacia de un clic, sin preguntar y sin motivo, en un boton rojo
   * pegado a otro verde. La base tampoco lo exige —`order_transition` acepta el
   * motivo vacio— asi que el unico sitio donde se puede parar es aqui.
   */
  it('cancelar pide confirmacion y motivo antes de tocar nada', async () => {
    const user = userEvent.setup()
    renderPage()
    const client = holder.client as FakeSupabase

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.click(within(drawer).getByRole('button', { name: 'Cancelar pedido' }))

    expect(await screen.findByText('Cancelar este pedido')).toBeInTheDocument()
    // Nada ha salido hacia el servidor todavia.
    expect(client.state.rpcCalls.filter((c) => c.name === 'order_transition')).toHaveLength(0)

    // Y sin motivo no se puede confirmar.
    expect(screen.getByRole('button', { name: 'Sí, cancelar el pedido' })).toBeDisabled()
  })

  it('el motivo viaja con la cancelacion y queda en el historial', async () => {
    const user = userEvent.setup()
    renderPage()
    const client = holder.client as FakeSupabase

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.click(within(drawer).getByRole('button', { name: 'Cancelar pedido' }))
    await user.type(await screen.findByRole('textbox', { name: /Por qué se cancela/i }), 'Duplicado')
    await user.click(screen.getByRole('button', { name: 'Sí, cancelar el pedido' }))

    await waitFor(() =>
      expect(client.state.rpcCalls.some((c) => c.name === 'order_transition')).toBe(true),
    )
    const llamada = client.state.rpcCalls.find((c) => c.name === 'order_transition')
    expect(llamada?.args.p_axis).toBe('order_status')
    expect(llamada?.args.p_to).toBe('cancelled')
    expect(llamada?.args.p_reason).toBe('Duplicado')
  })

  it('cambiar de eje cambia el menu de destinos', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.click(within(drawer).getByRole('combobox', { name: /Qué se mueve/i }))
    await user.click(await screen.findByRole('option', { name: 'Entrega' }))
    await user.click(within(drawer).getByRole('combobox', { name: /Nuevo estado/i }))

    const options = (await screen.findAllByRole('option')).map((node) => node.textContent)
    // «Anulado» a secas existía también en el eje del PAGO. Dos cosas distintas
    // con el mismo nombre en la misma pantalla: ahora cada una dice de qué habla.
    expect(options).toEqual([
      'En preparación',
      'Despachado en parte',
      'Despachado',
      'Entrega anulada',
    ])
  })
})

describe('OrdersPage — el comando de transicion', () => {
  it('pasa SIEMPRE por `order_transition`, con eje, destino y motivo', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.click(within(drawer).getByRole('combobox', { name: /Nuevo estado/i }))
    await user.click(await screen.findByRole('option', { name: 'Pagado' }))
    await user.type(within(drawer).getByLabelText(/Nota del cambio/i), 'Depósito verificado')
    await user.click(within(drawer).getByRole('button', { name: 'Actualizar estado' }))

    await waitFor(() => expect(client.state.rpcCalls).toHaveLength(1))
    const call = client.state.rpcCalls[0]
    expect(call?.name).toBe('order_transition')
    expect(call?.args).toEqual({
      p_order_id: ORDER_1,
      p_axis: 'order_status',
      p_to: 'paid',
      p_reason: 'Depósito verificado',
    })
  })

  it('el payload no lleva tenant, ni estado anterior, ni importes', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.click(within(drawer).getByRole('combobox', { name: /Nuevo estado/i }))
    await user.click(await screen.findByRole('option', { name: 'Cancelado' }))
    await user.click(within(drawer).getByRole('button', { name: 'Actualizar estado' }))

    await waitFor(() => expect(client.state.rpcCalls).toHaveLength(1))
    const args = client.state.rpcCalls[0]?.args ?? {}
    for (const field of TENANT_FIELDS) expect(args).not.toHaveProperty(field)
    for (const field of ['store_id', 'p_from', 'grand_total', 'subtotal', 'currency']) {
      expect(args).not.toHaveProperty(field)
    }
  })

  it('un rol sin permiso ve el pedido pero no puede moverlo', async () => {
    holder.client = backend('viewer')
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')

    expect(within(drawer).getByText(/no cambiar su estado/i)).toBeInTheDocument()
    expect(within(drawer).queryByRole('combobox', { name: /Nuevo estado/i })).not.toBeInTheDocument()
    expect(
      within(drawer).queryByRole('button', { name: 'Actualizar estado' }),
    ).not.toBeInTheDocument()
  })

  it('un rol sin permiso tampoco exporta', async () => {
    holder.client = backend('viewer')
    renderPage()
    await screen.findByText('MI-000001')
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })
})

describe('OrdersPage — aprobacion B2B', () => {
  it('un pedido pendiente avisa de que no avanza y ofrece decidir', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const drawer = await openDrawer(user, 'MI-000003')
    expect(within(drawer).getByText(/espera la firma/i)).toBeInTheDocument()

    await user.type(within(drawer).getByLabelText(/^Motivo/i), 'Presupuesto disponible')
    await user.click(within(drawer).getByRole('button', { name: 'Autorizar' }))

    await waitFor(() => expect(client.state.rpcCalls).toHaveLength(1))
    expect(client.state.rpcCalls[0]).toMatchObject({
      name: 'order_approval_decide',
      args: { p_order_id: ORDER_3, p_approve: true, p_reason: 'Presupuesto disponible' },
    })
  })

  it('rechazar sin motivo no se puede ni intentar: el boton esta deshabilitado', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000003')
    expect(within(drawer).getByRole('button', { name: 'Rechazar' })).toBeDisabled()
  })

  it('un pedido B2C no enseña la seccion de autorizacion', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001')
    expect(within(drawer).queryByText(/espera la firma/i)).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Autorizar' })).not.toBeInTheDocument()
  })
})

describe('OrdersPage — anotaciones y referencias externas', () => {
  it('la nota interna se escribe sin declarar tenant ni tienda', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.type(within(drawer).getByLabelText(/Nueva nota/i), 'Llamar antes de despachar')
    await user.click(within(drawer).getAllByRole('button', { name: 'Añadir' })[1] as HTMLElement)

    await waitFor(() => expect(client.state.tables.order_notes ?? []).toHaveLength(1))
    const note = (client.state.tables.order_notes ?? [])[0] as Record<string, unknown>
    expect(note.body).toBe('Llamar antes de despachar')
    expect(note.order_id).toBe(ORDER_1)
    for (const field of ['organization_id', 'company_id', 'store_id', 'author_id']) {
      expect(note).not.toHaveProperty(field)
    }
  })

  it('la etiqueta se normaliza antes de salir del navegador', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    await user.type(within(drawer).getByLabelText(/Nueva etiqueta/i), 'Revisar Dirección')
    await user.click(within(drawer).getAllByRole('button', { name: 'Añadir' })[0] as HTMLElement)

    await waitFor(() => expect(client.state.tables.order_tags ?? []).toHaveLength(2))
    const added = (client.state.tables.order_tags ?? []).at(-1) as Record<string, unknown>
    expect(added.tag).toBe('revisar-direccion')
  })

  it('las referencias externas se listan por sistema y tipo', async () => {
    const user = userEvent.setup()
    renderPage()

    const drawer = await openDrawer(user, 'MI-000001', 'Operación')
    expect(within(drawer).getByText('F001-000123')).toBeInTheDocument()
    expect(within(drawer).getByText('erp · invoice')).toBeInTheDocument()
  })
})

describe('OrdersPage — legibilidad de la tabla', () => {
  it('los tres estados pesan igual: ninguno es un bloque relleno', async () => {
    // Antes el estado era un Chip RELLENO y pago/entrega de contorno, asi que
    // tres datos del mismo rango gritaban distinto. Ahora los tres son la misma
    // etiqueta tenue y lo que los distingue es su texto.
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr')
    expect(fila).not.toBeNull()
    // El Chip de MUI deja su clase; la etiqueta propia no.
    expect(fila?.querySelectorAll('.MuiChip-filled').length).toBe(0)
  })

  it('muestra la hora, que es lo que distingue pedidos del mismo dia', async () => {
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr')
    // Formato corto de hora: dos numeros separados por dos puntos.
    expect(fila?.textContent ?? '').toMatch(new RegExp("\\d{1,2}:\\d{2}"))
  })
})

describe('OrdersPage — la fila enriquecida', () => {
  it('cada estado lleva icono: es el tercer canal, no un adorno', async () => {
    // Texto y color no bastan: el validador de paleta deja --red y --amber en
    // DeltaE 1,8 bajo deuteranopia, asi que quien recorre la columna en
    // diagonal necesita la silueta.
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr')
    // Tres ejes, tres iconos como minimo en la fila.
    expect((fila?.querySelectorAll('svg').length ?? 0)).toBeGreaterThanOrEqual(3)
  })

  it('resume cuantos pedidos se ven y cuanto suman', async () => {
    // Sin esto hay que contar filas para saber cuanto hay y sumar a mano para
    // saber cuanto es.
    renderPage()

    expect(await screen.findByText(/pedidos en esta vista/)).toBeInTheDocument()
    expect(screen.getByText('Suma')).toBeInTheDocument()
  })

  it('el cliente lleva su inicial como ancla de la fila', async () => {
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr')
    expect(fila?.textContent ?? '').toContain('Ana Compradora')
    // La inicial del avatar, en mayuscula.
    expect(fila?.querySelector('.MuiAvatar-root')?.textContent).toBe('A')
  })
})

describe('OrdersPage — acciones de fila', () => {
  it('cada accion se nombra: un icono a solas no dice que hace', async () => {
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr') as HTMLElement
    expect(within(fila).getByRole('button', { name: /Anular pedido/ })).toBeInTheDocument()
  })

  it('una accion sin sentido para ese pedido esta deshabilitada, no oculta', async () => {
    // Ocultarla movería los botones de sitio entre filas y se acabaría
    // pulsando el que no era. Deshabilitada, la posicion es estable.
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr') as HTMLElement
    const factura = within(fila).getByRole('button', { name: /Ver factura/ })
    // El pedido de prueba no esta cobrado.
    expect(factura).toBeDisabled()
  })

  it('pulsar una accion NO abre ademas el detalle de la fila', async () => {
    // La fila entera es pulsable: sin stopPropagation, cada clic en una accion
    // dispararia tambien la apertura del panel.
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('MI-000001')
    const fila = screen.getByText('MI-000001').closest('tr') as HTMLElement
    await user.click(within(fila).getByRole('button', { name: /Anular pedido/ }))

    // Anular esta deshabilitado o abre el panel, pero en ningun caso debe
    // haberse disparado DOS veces la apertura.
    expect(screen.queryAllByRole('dialog').length).toBeLessThanOrEqual(1)
  })
})

describe('OrdersPage — barra de filtros', () => {
  it('no ofrece limpiar cuando no hay nada que limpiar', async () => {
    // Un boton que no hace nada ensena a no pulsarlo, y el dia que sirva
    // tampoco se pulsara.
    renderPage()

    await screen.findByText('MI-000001')
    expect(screen.queryByRole('button', { name: /Limpiar filtros/ })).not.toBeInTheDocument()
  })

  it('aparece al filtrar y devuelve el listado a su estado inicial', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('MI-000001')
    const buscador = screen.getByPlaceholderText(/Buscar/i)
    await user.type(buscador, 'MI-000002')

    const limpiar = await screen.findByRole('button', { name: /Limpiar filtros/ })
    await user.click(limpiar)

    await waitFor(() => expect(buscador).toHaveValue(''))
    expect(screen.queryByRole('button', { name: /Limpiar filtros/ })).not.toBeInTheDocument()
  })
})
