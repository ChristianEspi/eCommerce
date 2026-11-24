import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { translate } from '@/shared/i18n/i18n-context'
import {
  COMPANY_A,
  COMPANY_B,
  FunctionsHttpErrorLike,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * Los avisos en pantalla: la campanita, «Tu cuenta» y el botón «Probar».
 *
 * Lo que la base decide —quién recibe qué— se prueba contra Postgres en
 * `supabase/tests/notifications.test.ts`. Aquí se fija lo que puede salir mal en
 * la pantalla: que se lea una clave técnica en vez de una frase, que la
 * campanita mezcle sociedades, que marcar leído no se note, y que el botón de
 * prueba diga qué falta en vez de «no configurado».
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
const { NotificationBell } = await import('./NotificationBell')
const { StoreNotificationBell } = await import('./StoreNotificationBell')
const { MailSettingsSection } = await import('./MailSettingsSection')
const { KNOWN_KINDS, notificationHref, notificationText } = await import('./text')

const aviso = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  organization_id: ORG,
  company_id: COMPANY_A,
  recipient_user_id: USER,
  audience: 'backoffice',
  kind: 'order.received',
  params: { order_number: 'EC-00042', grand_total: '120.00', currency: 'PEN' },
  link: '/app/orders?order=1',
  read_at: null,
  archived_at: null,
  created_at: new Date().toISOString(),
  ...over,
})

const STORE_B = '55555555-5555-4555-8555-5555555555bb'

const tienda = (id: string, slug: string, name: string) => ({
  id,
  organization_id: ORG,
  company_id: COMPANY_A,
  slug,
  name,
  status: 'active',
  currency: 'PEN',
})

function backend(
  notifications: Array<Record<string, unknown>>,
  stores: Array<Record<string, unknown>> = [],
): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'admin', status: 'active' },
      ],
      stores,
      notifications,
    },
  })
}

beforeEach(() => {
  holder.client = null
})

describe('textos de los avisos', () => {
  /**
   * Cada tipo que genera la base tiene su frase. Un tipo sin texto no rompería
   * nada visible en las pruebas de la base, y en pantalla se leería «Tienes un
   * aviso nuevo» sin decir de qué.
   */
  it('hay texto para cada tipo de aviso en pantalla que genera la base', () => {
    const DE_LA_BASE = [
      'order.received', 'order.approval_requested', 'order.payment_failed', 'return.requested',
      'integration.circuit_opened', 'member.access_granted', 'member.role_changed',
      'suggestion.generated', 'order.confirmed', 'order.approval_pending', 'order.approved',
      'order.rejected', 'order.shipped', 'order.delivered', 'business_account.invited',
      'business_account.activated', 'suggestion.sent', 'order_schedule.run_ready',
      // 2026-11-22 · `ebim.notify_quote_requested`.
      'quote.requested',
    ]
    expect([...KNOWN_KINDS].sort()).toEqual(DE_LA_BASE.sort())
  })

  it('rellena los datos del aviso, y el rol se lee en palabras', () => {
    const t = (key: Parameters<typeof translate>[1]) => translate('es', key)
    expect(notificationText({ kind: 'order.received', params: { order_number: 'EC-1', grand_total: '10.00', currency: 'PEN' } }, t))
      .toBe('Nuevo pedido EC-1 por 10.00 PEN')
    expect(notificationText({ kind: 'member.role_changed', params: { role: 'orders' } }, t))
      .toBe('Tu rol ahora es Pedidos')
    expect(notificationText({ kind: 'quote.requested', params: { quote_number: 'SOL-1', account_name: 'Botica Sol' } }, t))
      .toBe('Botica Sol pide cotización SOL-1')
  })

  it('todo aviso conocido lleva a algún sitio, aunque se guardara sin enlace (2026-11-24)', () => {
    const params = {
      store_slug: 'miquimica', order_number: 'EC-1', order_id: 'o-1', quote_number: 'SOL-1',
    }
    for (const kind of KNOWN_KINDS) {
      const href = notificationHref({ kind, params, link: null })
      expect(href, kind).toMatch(/^\/(app|s\/miquimica)/)
    }
    expect(notificationHref({ kind: 'order.delivered', params, link: null }))
      .toBe('/s/miquimica/account?pedido=EC-1#pedidos')
    expect(notificationHref({ kind: 'business_account.activated', params, link: null })).toBe('/s/miquimica/account')
    // El enlace guardado manda; uno que saldría de la aplicación no se sigue.
    expect(notificationHref({ kind: 'order.received', params, link: '/app/orders?order=x' })).toBe('/app/orders?order=x')
    expect(notificationHref({ kind: 'algo.nuevo', params: {}, link: '//evil.example' })).toBeNull()
  })

  it('un tipo desconocido no enseña su clave técnica', () => {
    const t = (key: Parameters<typeof translate>[1]) => translate('es', key)
    expect(notificationText({ kind: 'algo.nuevo', params: {} }, t)).toBe('Tienes un aviso nuevo')
  })
})

describe('la campanita', () => {
  function pintar(fake: FakeSupabase) {
    holder.client = fake
    return renderWithProviders(
      <TenantProvider>
        <NotificationBell />
      </TenantProvider>,
      { session: fake.state.session },
    )
  }

  it('cuenta solo los no leídos de la sociedad activa', async () => {
    pintar(backend([
      aviso({}),
      aviso({ read_at: new Date().toISOString() }),
      aviso({ company_id: COMPANY_B }),
    ]))

    expect(await screen.findByRole('button', { name: 'Abrir avisos: 1 sin leer' })).toBeInTheDocument()
  })

  /**
   * Con dos tiendas en la misma sociedad, la campana enseñaba pedidos de la
   * otra estando en una que no había vendido nada, y el listado de al lado
   * decía «todavía no recibiste pedidos». Lo que no es de ninguna tienda —una
   * integración caída— se sigue viendo siempre.
   */
  it('no mezcla tiendas: solo la activa y lo que no es de ninguna', async () => {
    pintar(
      backend(
        [
          aviso({ store_id: STORE_A }),
          aviso({ store_id: STORE_B }),
          aviso({ store_id: null, kind: 'integration.failed', params: {} }),
        ],
        [tienda(STORE_A, 'primera', 'Primera'), tienda(STORE_B, 'segunda', 'Segunda')],
      ),
    )

    expect(await screen.findByRole('button', { name: 'Abrir avisos: 2 sin leer' })).toBeInTheDocument()
  })

  it('abre la lista con frases, no con claves', async () => {
    const user = userEvent.setup()
    pintar(backend([aviso({})]))

    await user.click(await screen.findByRole('button', { name: /Abrir avisos/ }))
    expect(await screen.findByText('Nuevo pedido EC-00042 por 120.00 PEN')).toBeInTheDocument()
  })

  it('marcar todo como leído apaga el contador', async () => {
    const user = userEvent.setup()
    const fake = backend([aviso({}), aviso({ params: { order_number: 'EC-00043', grand_total: '5', currency: 'PEN' } })])
    pintar(fake)

    await user.click(await screen.findByRole('button', { name: 'Abrir avisos: 2 sin leer' }))
    await user.click(await screen.findByRole('button', { name: 'Marcar todo como leído' }))

    await waitFor(() => {
      const filas = fake.state.tables.notifications as Array<Record<string, unknown>>
      expect(filas.every((fila) => fila.read_at !== null)).toBe(true)
    })
  })

  it('sin avisos lo dice, en vez de abrir una caja vacía', async () => {
    const user = userEvent.setup()
    pintar(backend([]))
    await user.click(await screen.findByRole('button', { name: 'Abrir avisos' }))
    expect(await screen.findByText('No tienes avisos')).toBeInTheDocument()
  })
})

describe('la campanita del comprador (2026-11-20)', () => {
  function pintarCampana(fake: FakeSupabase) {
    holder.client = fake
    renderWithProviders(
      <StoreNotificationBell
        renderTrigger={({ onClick, unread, label }) => (
          <button type="button" onClick={onClick} aria-label={label}>
            {unread}
          </button>
        )}
      />,
      { session: fake.state.session },
    )
  }

  it('cuenta y enseña sus avisos de tienda, no los del backoffice', async () => {
    const user = userEvent.setup()
    pintarCampana(
      backend([
        aviso({ audience: 'storefront', kind: 'business_account.invited', params: { account_name: 'Policlinico Andino SAC' } }),
        aviso({ audience: 'backoffice' }),
      ]),
    )
    await user.click(await screen.findByRole('button', { name: 'Abrir avisos: 1 sin leer' }))
    expect(
      await screen.findByText('Te vincularon a Policlinico Andino SAC; falta que activen tu acceso'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Nuevo pedido/)).not.toBeInTheDocument()
  })

  it('marcar todo como leído apaga el contador', async () => {
    const user = userEvent.setup()
    pintarCampana(backend([aviso({ audience: 'storefront', kind: 'business_account.invited', params: { account_name: 'X SAC' } })]))
    await user.click(await screen.findByRole('button', { name: 'Abrir avisos: 1 sin leer' }))
    await user.click(await screen.findByRole('button', { name: 'Marcar todo como leído' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir avisos', hidden: true })).toBeInTheDocument())
  })
})

describe('Configuración → Correo', () => {
  function pintarCorreo(respuesta: () => unknown) {
    const fake = createFakeSupabase({ session: makeSession(), functions: { 'notifications-test': respuesta } })
    holder.client = fake
    renderWithProviders(<MailSettingsSection />, { session: fake.state.session })
    return fake
  }

  it('sin configurar, dice exactamente qué secretos faltan y no deja probar', async () => {
    pintarCorreo(() => ({
      configured: false, missing: ['MS_CLIENT_SECRET', 'MS_SENDER_EMAIL'],
      sender_email: null, sender_name: null, sent: false, code: null,
    }))

    expect(await screen.findByText('El correo todavía no está configurado.')).toBeInTheDocument()
    expect(screen.getByText('MS_CLIENT_SECRET')).toBeInTheDocument()
    expect(screen.getByText('MS_SENDER_EMAIL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviarme un correo de prueba' })).toBeDisabled()
  })

  it('configurado, dice desde qué buzón sale y la prueba no lleva destinatario', async () => {
    const user = userEvent.setup()
    const fake = pintarCorreo(() => ({
      configured: true, missing: [], sender_email: 'ecommerce@grupoebim.com',
      sender_name: 'eCommerce by EBIM', sent: true, code: null,
    }))

    expect(
      await screen.findByText('El correo está configurado. Sale como eCommerce by EBIM desde ecommerce@grupoebim.com.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviarme un correo de prueba' }))

    expect(await screen.findByText('Correo de prueba enviado. Revisa tu bandeja de entrada.')).toBeInTheDocument()
    // Solo `send`: la función envía a quien pulsa, y ni acepta una dirección.
    expect(fake.state.invocations.at(-1)?.body).toEqual({ send: true })
  })

  it('configurado sin buzón propio, no nombra el servicio por el que sale', async () => {
    pintarCorreo(() => ({
      configured: true, missing: [], sender_email: null, sender_name: null, sent: false, code: null,
    }))
    expect(await screen.findByText('El correo está configurado y listo para enviar avisos.')).toBeInTheDocument()
    expect(screen.queryByText(/MailHub/i)).not.toBeInTheDocument()
  })

  it('si Microsoft rechaza el buzón, lo dice con la causa probable', async () => {
    const user = userEvent.setup()
    let llamadas = 0
    pintarCorreo(() => {
      llamadas += 1
      return {
        configured: true, missing: [], sender_email: 'ecommerce@grupoebim.com', sender_name: 'eCommerce by EBIM',
        sent: false, code: llamadas > 1 ? 'GRAPH_NO_AUTORIZADO' : null,
      }
    })

    await user.click(await screen.findByRole('button', { name: 'Enviarme un correo de prueba' }))
    expect(
      await screen.findByText('Microsoft no deja enviar desde ese buzón. Revisa la política de acceso de la aplicación.'),
    ).toBeInTheDocument()
  })

  it('si la función falla, no se queda cargando', async () => {
    pintarCorreo(() => {
      throw new FunctionsHttpErrorLike(403, 'SIN_PERMISO')
    })
    expect(await screen.findByText('No se pudo consultar el estado del correo.')).toBeInTheDocument()
  })
})
