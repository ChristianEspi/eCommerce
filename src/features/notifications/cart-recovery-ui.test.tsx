import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession } from '@/test/supabaseMock'

/**
 * Recuperación de carritos en pantalla (cierre, ítem 8).
 *
 * Quién recibe qué y cuándo no se prueba contra Postgres en
 * `supabase/tests/cart-recovery.test.ts`. Aquí se fija lo que puede salir mal en
 * la pantalla: que abrir el enlace de baja dé de baja sin confirmar, que un
 * enlace roto llame a la base, que la preferencia no mande lo que la persona
 * eligió, y que Configuración no deje guardar una ventana imposible.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StoreUnsubscribePage } = await import('./StoreUnsubscribePage')
const { StoreNotificationsSection } = await import('./StoreNotificationsSection')
const { CartRecoverySection } = await import('./CartRecoverySection')

const TOKEN = 'cd'.repeat(32)

beforeEach(() => {
  holder.client = null
})

describe('la baja de un clic', () => {
  function pintar(route: string, respuesta: () => unknown = () => ({ unsubscribed: true })) {
    const fake = createFakeSupabase({ session: null, rpc: { cart_recovery_unsubscribe: respuesta } })
    holder.client = fake
    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug/unsubscribe" element={<StoreUnsubscribePage />} />
      </Routes>,
      { route },
    )
    return fake
  }

  it('abrir el enlace NO da de baja: hay que confirmar', async () => {
    const user = userEvent.setup()
    const fake = pintar(`/s/tienda/unsubscribe?token=${TOKEN}`)

    const boton = await screen.findByRole('button', { name: 'Darme de baja' })
    expect(fake.state.rpcCalls.filter((c) => c.name === 'cart_recovery_unsubscribe')).toEqual([])

    await user.click(boton)
    expect(
      await screen.findByText('Listo: no te enviaremos más recordatorios de carrito de esta tienda.'),
    ).toBeInTheDocument()
    expect(fake.state.rpcCalls.filter((c) => c.name === 'cart_recovery_unsubscribe')).toEqual([
      { name: 'cart_recovery_unsubscribe', args: { p_token: TOKEN } },
    ])
  })

  it('un enlace mal formado ni siquiera llama a la base', async () => {
    const fake = pintar('/s/tienda/unsubscribe?token=no-vale')
    expect(await screen.findByText(/Este enlace de baja no es válido/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Darme de baja' })).not.toBeInTheDocument()
    expect(fake.state.rpcCalls.filter((c) => c.name === 'cart_recovery_unsubscribe')).toEqual([])
  })

  it('un secreto que la base no reconoce se explica, sin decir de quién era', async () => {
    const user = userEvent.setup()
    pintar(`/s/tienda/unsubscribe?token=${TOKEN}`, () => ({ unsubscribed: false }))
    await user.click(await screen.findByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByText(/Este enlace de baja no es válido/)).toBeInTheDocument()
  })
})

describe('la preferencia en «Tu cuenta»', () => {
  function pintar(preferencia: { store_enabled: boolean; receive: boolean }) {
    const fake = createFakeSupabase({
      session: makeSession(),
      tables: { notifications: [] },
      rpc: {
        my_cart_reminders: () => preferencia,
        set_my_cart_reminders: (args) => ({ store_enabled: true, receive: Boolean(args.p_receive) }),
      },
    })
    holder.client = fake
    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug/account" element={<StoreNotificationsSection />} />
      </Routes>,
      { route: '/s/tienda/account', session: fake.state.session },
    )
    return fake
  }

  it('apagarla manda la tienda de la URL y lo elegido, nada más', async () => {
    const user = userEvent.setup()
    const fake = pintar({ store_enabled: true, receive: true })

    const interruptor = await screen.findByRole('checkbox', {
      name: 'Recordarme por correo si dejo productos en el carrito',
    })
    expect(interruptor).toBeChecked()
    await user.click(interruptor)

    await waitFor(() =>
      expect(fake.state.rpcCalls.filter((c) => c.name === 'set_my_cart_reminders')).toEqual([
        { name: 'set_my_cart_reminders', args: { p_store_slug: 'tienda', p_receive: false } },
      ]),
    )
    await waitFor(() => expect(interruptor).not.toBeChecked())
  })

  it('si la tienda no los tiene encendidos, no se ofrece', async () => {
    pintar({ store_enabled: false, receive: true })
    expect(await screen.findByText('No tienes avisos')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('Configuración → Recordatorio de carrito', () => {
  const resumen = {
    enabled: false,
    delay_hours: 4,
    max_age_days: 7,
    window_days: 30,
    counts: { queued: 2, sent: 5, failed: 1, expired: 0, suppressed: 3 },
    opted_out: 4,
  }

  function pintar() {
    const fake = createFakeSupabase({
      session: makeSession(),
      rpc: {
        cart_recovery_overview: () => resumen,
        cart_recovery_configure: (args) => ({
          ...resumen,
          enabled: args.p_enabled,
          delay_hours: args.p_delay_hours,
          max_age_days: args.p_max_age_days,
        }),
      },
    })
    holder.client = fake
    renderWithProviders(<CartRecoverySection storeId="00000000-0000-4000-8000-000000000001" />, {
      session: fake.state.session,
    })
    return fake
  }

  it('nace apagado, avisa del consentimiento y enseña los números', async () => {
    pintar()
    const interruptor = await screen.findByRole('checkbox', { name: 'Enviar recordatorios de carrito' })
    expect(interruptor).not.toBeChecked()
    expect(screen.getByText(/base legal/)).toBeInTheDocument()
    expect(screen.getByText('Últimos 30 días')).toBeInTheDocument()
    expect(screen.getByText('Enviados').nextSibling).toHaveTextContent('5')
    expect(screen.getByText('Bajas').nextSibling).toHaveTextContent('4')
  })

  it('una ventana imposible no se puede guardar', async () => {
    const user = userEvent.setup()
    const fake = pintar()
    const espera = await screen.findByLabelText('Esperar (horas sin actividad)')
    await user.clear(espera)
    await user.type(espera, '200')

    expect(screen.getByText(/Revisa la ventana/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar recordatorios' })).toBeDisabled()
    expect(fake.state.rpcCalls.filter((c) => c.name === 'cart_recovery_configure')).toEqual([])
  })

  it('encender y guardar manda la tienda, el interruptor y la ventana', async () => {
    const user = userEvent.setup()
    const fake = pintar()
    await user.click(await screen.findByRole('checkbox', { name: 'Enviar recordatorios de carrito' }))
    const espera = screen.getByLabelText('Esperar (horas sin actividad)')
    await user.clear(espera)
    await user.type(espera, '6')
    await user.click(screen.getByRole('button', { name: 'Guardar recordatorios' }))

    await waitFor(() =>
      expect(fake.state.rpcCalls.filter((c) => c.name === 'cart_recovery_configure')).toEqual([
        {
          name: 'cart_recovery_configure',
          args: {
            p_store_id: '00000000-0000-4000-8000-000000000001',
            p_enabled: true,
            p_delay_hours: 6,
            p_max_age_days: 7,
          },
        },
      ]),
    )
    expect(await screen.findByText('Recordatorios de carrito guardados.')).toBeInTheDocument()
  })
})