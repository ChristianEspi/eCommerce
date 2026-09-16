import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
 * El motor de promociones en pantalla (P10-SaaS).
 *
 * Lo que se comprueba aquí no es el cálculo —eso vive en el servidor y se
 * prueba contra Postgres real— sino las cinco cosas que solo se ven montando el
 * árbol:
 *
 *  1. que es UNA pantalla con pestañas y un solo buscador por listado (§8);
 *  2. que está gateada por lo que la sociedad CONTRATÓ;
 *  3. que el listado responde las cuatro preguntas del encargo de un vistazo
 *     —estado efectivo, vigencia, alcance y prioridad— más la que casi nadie
 *     enseña: lo que la campaña ya ha costado;
 *  4. que el alta **no manda ninguno de los campos de tenant** ni el contador
 *     de usos, que es la regla que sostiene el aislamiento;
 *  5. y que el simulador enseña también lo que NO se aplicó y por qué, que es
 *     lo que resuelve el ticket de soporte de verdad.
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
const { PromotionsPage } = await import('./PromotionsPage')

const PROMO_ID = '88888888-8888-4888-8888-888888888801'
const COUPON_PROMO_ID = '88888888-8888-4888-8888-888888888802'
const COUPON_ID = '88888888-8888-4888-8888-888888888803'
const CARD_ID = '88888888-8888-4888-8888-888888888804'
const EVENT_ID = '88888888-8888-4888-8888-888888888805'
const PRODUCT_ID = '88888888-8888-4888-8888-888888888806'

const PROMOS = ['ecommerce.promotions']

const CAMPAIGN = {
  id: PROMO_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  store_id: STORE_A,
  code: 'verano',
  name: 'Rebajas de verano',
  description: null,
  kind: 'percentage',
  status: 'active',
  effective_status: 'live',
  priority: 300,
  stack_group: null,
  is_exclusive: false,
  requires_coupon: false,
  value_percent: '15.0000',
  value_amount: null,
  max_discount_amount: null,
  buy_quantity: null,
  free_quantity: null,
  min_subtotal: null,
  min_quantity: null,
  valid_from: '2026-06-01T00:00:00.000Z',
  valid_to: '2026-09-01T00:00:00.000Z',
  usage_limit: null,
  usage_limit_per_customer: null,
  usage_count: 12,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
  scope_count: 2,
  exclusion_count: 1,
  audience_count: 0,
  tier_count: 0,
  coupon_count: 0,
  redemption_count: 12,
  discount_granted: '340.50',
}

const COUPON_CAMPAIGN = {
  ...CAMPAIGN,
  id: COUPON_PROMO_ID,
  code: 'bienvenida',
  name: 'Bienvenida',
  effective_status: 'scheduled',
  priority: 100,
  requires_coupon: true,
  is_exclusive: true,
  usage_count: 0,
  redemption_count: 0,
  discount_granted: '0.00',
  coupon_count: 1,
}

function backend(options: { entitlements?: string[]; role?: string } = {}): FakeSupabase {
  const { entitlements = PROMOS, role = 'admin' } = options
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
      promotion_overview: [CAMPAIGN, COUPON_CAMPAIGN],
      promotions: [CAMPAIGN, COUPON_CAMPAIGN],
      products: [
        { id: PRODUCT_ID, name: 'Alitraq Polvo Oral', sku: 'QS-565341', kind: 'simple' },
      ],
      // ADR 018: el buscador del alcance lee las publicaciones de la tienda.
      admin_store_products: [
        { product_id: PRODUCT_ID, store_id: STORE_A, name: 'Alitraq Polvo Oral', sku: 'QS-565341', kind: 'simple' },
      ],
      promotion_scopes: [],
      promotion_tiers: [],
      promotion_audiences: [],
      coupons: [
        {
          id: COUPON_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          promotion_id: COUPON_PROMO_ID,
          code: 'Verano 25',
          code_normalized: 'VERANO25',
          is_active: true,
          valid_from: null,
          valid_to: null,
          usage_limit: 100,
          usage_limit_per_customer: 1,
          usage_count: 7,
          notes: null,
          created_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      gift_card_overview: [
        {
          id: CARD_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          code_last4: '9821',
          currency: 'PEN',
          initial_amount: '100.00',
          balance: '40.00',
          status: 'active',
          effective_status: 'active',
          issued_to_email: 'regalo@compradora.com',
          expires_at: '2027-01-01T00:00:00.000Z',
          notes: null,
          movement_count: 2,
          redeemed_amount: '60.00',
          last_redeemed_at: '2026-07-01T00:00:00.000Z',
          created_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      gift_card_transactions: [],
      promotion_events: [
        {
          id: EVENT_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          store_id: STORE_A,
          promotion_id: PROMO_ID,
          entity: 'promotion',
          entity_id: PROMO_ID,
          action: 'update',
          promotion_status: 'active',
          before_state: { value_percent: '10.0000' },
          after_state: { value_percent: '15.0000' },
          actor_email: 'duenio@negocio.com',
          occurred_at: '2026-06-05T10:00:00.000Z',
        },
      ],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      promotion_simulate: () => ({
        currency: 'PEN',
        subtotal: '100.00',
        discount_total: '15.00',
        tax_total: '15.30',
        grand_total: '100.30',
        lines: [
          {
            product_id: 'p1',
            name: 'Toalla',
            quantity: 4,
            unit_price: '25.00',
            net_amount: '100.00',
            discount: '15.00',
          },
        ],
        promotions: {
          entitled: true,
          applied: [
            {
              promotion_id: PROMO_ID,
              code: 'verano',
              label: 'Rebajas de verano',
              kind: 'percentage',
              amount: '15.00',
              coupon_code: null,
            },
          ],
          skipped: [{ code: 'bienvenida', reason: 'no_combina' }],
          coupons: [{ code: 'VERANO25', status: 'no_aplicable' }],
        },
      }),
    },
  })
}

function renderPromotions(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="promotions">
          <PromotionsPage />
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

describe('Promociones — la pantalla', () => {
  it('es UNA pantalla con cinco pestañas centradas, no cinco entradas de menú', async () => {
    renderPromotions(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Campañas',
      'Cupones',
      'Tarjetas regalo',
      'Simulador',
      'Bitácora',
    ])
  })

  it('sin el módulo contratado enseña «no está en tu plan» y no monta la pantalla', async () => {
    renderPromotions(backend({ entitlements: [] }))
    expect(await screen.findByText(/no está incluido|no está en/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Campañas' })).not.toBeInTheDocument()
  })

  it('un rol sin permiso ve la salida, no un listado vacío que parece un fallo', async () => {
    renderPromotions(backend({ role: 'viewer' }))
    expect(await screen.findByText('No puedes gestionar promociones')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva campaña' })).not.toBeInTheDocument()
  })
})

describe('Campañas — el listado responde las preguntas del encargo', () => {
  it('enseña estado efectivo, vigencia, alcance, prioridad y lo ya descontado', async () => {
    renderPromotions(backend())

    const fila = (await screen.findByText('Rebajas de verano')).closest('tr')
    expect(fila).not.toBeNull()
    const celdas = within(fila as HTMLElement)

    // El resumen del descuento, no el número crudo de la columna.
    expect(celdas.getByText('15 % de descuento')).toBeInTheDocument()
    // Alcance: dos positivos y una exclusión, que se ve aparte.
    expect(celdas.getByText('−1')).toBeInTheDocument()
    expect(celdas.getByText('300')).toBeInTheDocument()
    expect(celdas.getByText('Se suma')).toBeInTheDocument()
    expect(celdas.getByText('340.50 PEN')).toBeInTheDocument()
    expect(celdas.getByText('Descontando')).toBeInTheDocument()
  })

  it('el estado EFECTIVO distingue «programada» de «descontando»', async () => {
    renderPromotions(backend())
    // La misma pestaña `all` para ver las dos.
    await screen.findByText('Rebajas de verano')
    const usuario = userEvent.setup()
    await usuario.selectOptions(screen.getByLabelText('Estado'), 'all')

    const programada = (await screen.findByText('Bienvenida')).closest('tr')
    expect(within(programada as HTMLElement).getByText('Programada')).toBeInTheDocument()
    expect(within(programada as HTMLElement).getByText('Va sola')).toBeInTheDocument()
  })

  it('hay UN solo buscador general, no un panel de filtros multi-campo', async () => {
    renderPromotions(backend())
    await screen.findByText('Rebajas de verano')
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })
})

describe('Campañas — el alta', () => {
  it('el alta NO manda ni un campo de tenant declarado por el navegador', async () => {
    const fake = backend()
    renderPromotions(fake)
    await screen.findByText('Rebajas de verano')

    const usuario = userEvent.setup()
    await usuario.click(screen.getByRole('button', { name: 'Nueva campaña' }))

    const panel = within(screen.getByRole('dialog'))
    await usuario.type(panel.getByLabelText('Código'), 'navidad')
    await usuario.type(panel.getByLabelText('Campaña'), 'Navidad')
    await usuario.type(panel.getByLabelText('Porcentaje (%)'), '20')
    await usuario.click(panel.getByRole('button', { name: 'Guardar' }))

    const guardada = fake.state.tables.promotions?.find((row) => row.code === 'navidad')
    expect(guardada).toBeDefined()

    // El tenant SÍ va —lo resolvió el JWT, no un campo del formulario— y el
    // contador de usos NO: no tiene GRANT de escritura, así que enviarlo haría
    // fallar la consulta entera contra la base de verdad.
    expect(guardada?.organization_id).toBe(ORG)
    expect(guardada?.company_id).toBe(COMPANY_A)
    expect(guardada?.store_id).toBe(STORE_A)
    expect(guardada).not.toHaveProperty('usage_count')
    expect(guardada).not.toHaveProperty('tenant_id')
    expect(guardada).not.toHaveProperty('org_id')
    expect(guardada?.value_percent).toBe('20')
    // Nace en BORRADOR: encenderla es una decisión aparte.
    expect(guardada?.status).toBe('draft')
  })

  /**
   * El alcance se ELIGE de una lista, no se teclea.
   *
   * `promotion_scopes` guarda uuids —`product_id`, `category_id`, `brand_id`— y
   * el campo era un texto libre llamado «Identificador». Quien escribia el SKU,
   * que es el identificador que la gente conoce, recibia «No pudimos completar
   * la operacion»: Postgres rechazaba `QS-565341` como uuid antes de mirar nada.
   *
   * Un campo que solo acepta un valor que no esta a la vista en ninguna pantalla
   * no se puede rellenar bien, asi que lo que se defiende aqui es que el uuid
   * viaje por debajo mientras la persona busca por nombre.
   */
  it('el alcance se busca por nombre y lo que se guarda es el uuid', async () => {
    const fake = backend()
    renderPromotions(fake)
    await screen.findByText('Rebajas de verano')

    const usuario = userEvent.setup()
    await usuario.click(screen.getByText('Rebajas de verano'))
    const panel = within(await screen.findByRole('dialog'))

    await usuario.click(panel.getByRole('combobox', { name: 'Alcance' }))
    await usuario.click(await screen.findByRole('option', { name: 'Producto' }))

    // Se busca por NOMBRE, que es por donde se busca de verdad. Con
    // `fireEvent.change` y no `type`: el buscador espera 300 ms antes de
    // consultar, y siete pulsaciones son siete ciclos de temporizador que en una
    // maquina cargada se van del limite sin que falle nada de verdad.
    fireEvent.change(panel.getByRole('combobox', { name: /Busca y elige/ }), {
      target: { value: 'alitraq' },
    })
    // El clic se REINTENTA hasta que la elección prende, y el botón encendido es
    // la señal de que prendió. El panel tiene varias consultas en vuelo —los
    // alcances, sus nombres— y cada una que vuelve repinta el desplegable: el
    // nodo que se acababa de encontrar podía estar ya reemplazado, y el clic
    // caía sobre un elemento suelto sin llegar a MUI. Pasaba solo con la máquina
    // cargada, que es cuando esas respuestas llegan tarde y separadas.
    const anadir = panel.getByRole('button', { name: 'Añadir' })
    await waitFor(
      async () => {
        await usuario.click(await screen.findByRole('option', { name: /Alitraq/ }))
        expect(anadir).toBeEnabled()
      },
      { timeout: 10_000 },
    )
    await usuario.click(anadir)

    await waitFor(() => expect(fake.state.tables.promotion_scopes?.length).toBe(1))
    const guardado = fake.state.tables.promotion_scopes?.[0]
    expect(guardado?.product_id).toBe(PRODUCT_ID)
    // Y NO el SKU, que es lo que se tecleaba antes y lo que rompia la consulta.
    expect(guardado?.product_id).not.toBe('QS-565341')
    expect(guardado?.scope_kind).toBe('product')
    // Holgura explícita: el buscador va contra el servidor con 300 ms de espera
    // antes de consultar, y son dos idas y vueltas sobre la página entera. Con
    // los 5 s de por defecto pasa en una máquina despejada y falla en una
    // cargada, que es la peor forma de fallar: parece un fallo del código y es
    // del reloj.
  }, 20_000)

  it('un porcentaje inválido se detiene en el cliente y no llega a la base', async () => {
    const fake = backend()
    renderPromotions(fake)
    await screen.findByText('Rebajas de verano')

    const usuario = userEvent.setup()
    await usuario.click(screen.getByRole('button', { name: 'Nueva campaña' }))
    const panel = within(screen.getByRole('dialog'))
    await usuario.type(panel.getByLabelText('Código'), 'navidad')
    await usuario.type(panel.getByLabelText('Campaña'), 'Navidad')
    await usuario.type(panel.getByLabelText('Porcentaje (%)'), '150')
    await usuario.click(panel.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Un porcentaje mayor que 0 y hasta 100')).toBeInTheDocument()
    expect(fake.state.tables.promotions?.some((row) => row.code === 'navidad')).toBe(false)
  })

  it('el formulario cambia con el TIPO: un 3x2 no tiene porcentaje', async () => {
    renderPromotions(backend())
    await screen.findByText('Rebajas de verano')

    const usuario = userEvent.setup()
    await usuario.click(screen.getByRole('button', { name: 'Nueva campaña' }))
    const panel = within(screen.getByRole('dialog'))
    expect(panel.getByLabelText('Porcentaje (%)')).toBeInTheDocument()

    await usuario.click(panel.getByLabelText('Tipo'))
    await usuario.click(await screen.findByRole('option', { name: 'X por Y' }))

    expect(panel.queryByLabelText('Porcentaje (%)')).not.toBeInTheDocument()
    expect(panel.getByLabelText('Llevando')).toBeInTheDocument()
    expect(panel.getByLabelText('Salen gratis')).toBeInTheDocument()
  })
})

describe('Cupones', () => {
  it('enseña cómo se va a guardar el código, que es lo que decide el duplicado', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Cupones' }))

    // La forma normalizada es la que manda; la tecleada se ve aparte.
    expect(await screen.findByText('VERANO25')).toBeInTheDocument()
    expect(screen.getByText(/escrito Verano 25/)).toBeInTheDocument()
    expect(screen.getByText('7 / 100')).toBeInTheDocument()
  })

  it('avisa del duplicado ANTES de mandarlo, comparando la forma normalizada', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Cupones' }))
    await screen.findByText('VERANO25')

    await usuario.click(screen.getByRole('button', { name: 'Nuevo cupón' }))
    await usuario.type(screen.getByLabelText(/^Código/), 'verano-25')

    expect(
      await screen.findByText('Ya existe un cupón con ese código normalizado.'),
    ).toBeInTheDocument()
  })
})

describe('Tarjetas regalo', () => {
  it('enseña saldo y últimos dígitos, nunca el código', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Tarjetas regalo' }))

    expect(await screen.findByText('••••9821')).toBeInTheDocument()
    expect(screen.getByText('40.00 PEN')).toBeInTheDocument()
    expect(screen.getByText('regalo@compradora.com')).toBeInTheDocument()
  })

  it('el código entero no aparece en ninguna parte de la pantalla', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Tarjetas regalo' }))
    await screen.findByText('••••9821')

    // La vista `gift_card_overview` no tiene columna `code` y el GRANT de la
    // tabla tampoco la incluye (lo comprueba `supabase/tests/gift-cards.test.ts`
    // contra Postgres real). Aquí se cierra el círculo por el otro lado: nada
    // con forma de código al portador llega a pintarse.
    expect(document.body.textContent ?? '').not.toMatch(/[A-Z0-9]{12,}/)
  })
})

/**
 * Elige el producto como lo elige una persona: escribiendo parte del nombre y
 * pulsando el resultado.
 *
 * El campo era un cuadro de texto y lo tecleado se enviaba tal cual como
 * `product_id`. Escribir «p1» valía para la prueba y no valía para nadie más:
 * el uuid de un producto no se enseña en ninguna pantalla. Ahora hay que
 * ELEGIR, y la prueba tiene que hacer lo mismo que hará quien lo use.
 */
async function elegirProducto(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.type(screen.getByLabelText('Producto'), 'Alitraq')
  // Con margen: entre teclear y ver la opción hay un rebote de 300 ms y una
  // consulta. El segundo por defecto alcanza en una máquina tranquila y no
  // cuando la suite entera corre en paralelo — y una prueba que solo falla
  // cuando hay prisa es peor que una que falla siempre.
  await usuario.click(await screen.findByText('Alitraq Polvo Oral', {}, { timeout: 5000 }))
}

describe('Simulador', () => {
  it('el producto se busca por nombre, no se escribe su identificador', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Simulador' }))

    await usuario.type(screen.getByLabelText('Producto'), 'Alitraq')

    // El código se enseña junto al nombre: es lo que el comercio reconoce.
    expect(
      await screen.findByText('Alitraq Polvo Oral', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('QS-565341')).toBeInTheDocument()
  })

  it('sin elegir producto no simula: avisa en vez de mandar basura', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Simulador' }))

    await usuario.type(screen.getByLabelText('Producto'), 'Alitraq')
    await usuario.click(screen.getByRole('button', { name: 'Simular' }))

    // Escribir no es elegir. Antes, lo tecleado viajaba como `product_id`.
    expect(await screen.findByText('Añade al menos una línea con producto y cantidad.')).toBeInTheDocument()
  })

  it('enseña lo aplicado Y lo descartado con su motivo', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Simulador' }))

    await elegirProducto(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Simular' }))

    // Con el mismo margen que el buscador de arriba, y por lo mismo: simular es
    // una consulta más, y el segundo por defecto alcanza en una máquina
    // tranquila pero no cuando la suite entera corre en paralelo.
    expect(await screen.findByText('Se aplicaron', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Rebajas de verano')).toBeInTheDocument()
    // Aparece dos veces a proposito —en la linea y en el desglose de la campana
    // que lo hizo— y que coincidan ES la propiedad que se quiere.
    expect(screen.getAllByText('−15.00').length).toBeGreaterThanOrEqual(2)

    // La mitad que resuelve el ticket de soporte.
    expect(screen.getByText('No se aplicaron')).toBeInTheDocument()
    expect(screen.getByText('Es exclusiva y ya se aplicó otra')).toBeInTheDocument()
    expect(
      screen.getByText('Válido, pero no alcanza nada de este carrito'),
    ).toBeInTheDocument()
  })

  it('el navegador no calcula ningún total: los pinta como llegaron', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Simulador' }))
    await elegirProducto(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Simular' }))

    expect(await screen.findByText('100.00 PEN', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('−15.00 PEN')).toBeInTheDocument()
    expect(screen.getByText('15.30 PEN')).toBeInTheDocument()
    expect(screen.getByText('100.30 PEN')).toBeInTheDocument()
  })
})

describe('Bitácora', () => {
  it('dice qué cambió, con qué estado tenía la campaña y quién lo hizo', async () => {
    renderPromotions(backend())
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('tab', { name: 'Bitácora' }))

    // «Cambio» es a la vez la cabecera de la columna y la accion de la fila.
    expect((await screen.findAllByText('Cambio')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('En vivo')).toBeInTheDocument()
    expect(
      screen.getAllByText(/value_percent: 10\.0000 → 15\.0000/).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('duenio@negocio.com')).toBeInTheDocument()
  })
})
