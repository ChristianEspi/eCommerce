import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase } from '@/test/supabaseMock'

/**
 * El portal del comprador: de la lista al DETALLE.
 *
 * La lista responde «¿ya salió mi pedido?». La pregunta que no tenía respuesta
 * era la otra —«¿qué pedí y por qué suma eso?»— y el servidor ya la contestaba
 * (`my_business_order_detail`) sin que nadie la mirara.
 *
 * Lo que se prueba aquí es la frontera: que la fila abra el detalle, que el
 * desglose que se pinta sea EL DEL SERVIDOR —ni una suma rehecha en el
 * navegador— y que el detalle solo se pida cuando alguien lo abre, porque
 * pedirlo por adelantado para cincuenta pedidos son cincuenta consultas que
 * nadie va a leer.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { MyOrdersSection } = await import('./MyOrdersSection')

const PEDIDO = {
  order_id: 'aaaa1111-1111-4111-8111-111111111111',
  order_number: 'MQ-2026-0102',
  account_name: 'Policlinico Andino SAC',
  status: 'pending',
  payment_status: 'paid',
  fulfillment_status: 'unfulfilled',
  approval_status: 'not_required',
  placed_at: '2026-08-28T10:00:00.000Z',
  currency: 'PEN',
  grand_total: '1180.75',
}

const DETALLE = {
  ...PEDIDO,
  subtotal: '1000.00',
  discount_total: '20.00',
  tax_total: '180.75',
  shipping_total: '20.00',
  items: [
    {
      name: 'Paracetamol 500 mg',
      sku: 'MED-PAR-500',
      variant_label: 'Caja de 20',
      quantity: 2,
      unit_price: '8.90',
      total: '17.80',
    },
  ],
}

function backend(options: { onDetail?: () => void } = {}) {
  return createFakeSupabase({
    rpc: {
      my_business_orders: () => [PEDIDO],
      my_business_order_detail: () => {
        options.onDetail?.()
        return DETALLE
      },
    },
  })
}

function render(fake: ReturnType<typeof createFakeSupabase>) {
  holder.client = fake
  return renderWithProviders(<MyOrdersSection storeSlug="miquimica" />)
}

describe('Mis pedidos — el detalle', () => {
  it('la fila entera abre el pedido, no un enlace escondido en una columna', async () => {
    const user = userEvent.setup()
    render(backend())

    const fila = await screen.findByRole('button', { name: /MQ-2026-0102/ })
    await user.click(fila)

    const panel = await screen.findByRole('presentation')
    expect(within(panel).getByText('Paracetamol 500 mg')).toBeInTheDocument()
    // El SKU y la variante van juntos: es lo que se compara con lo que llegó.
    expect(within(panel).getByText(/MED-PAR-500 · Caja de 20/)).toBeInTheDocument()
  })

  /**
   * El panel se monta en un PORTAL colgado de `body`, fuera del `.sf-scope` que
   * define radios, lineas y sombras de la vitrina. Sin la clase en el papel,
   * cada `var(--sf-…)` de dentro resuelve a nada y el panel sale con el aspecto
   * por defecto de MUI en medio de una tienda que no lo usa. No se ve en una
   * captura de pantalla de la prueba, pero si en la del comprador.
   */
  it('el panel lleva la piel de la vitrina aunque se pinte en un portal', async () => {
    const user = userEvent.setup()
    render(backend())

    await user.click(await screen.findByRole('button', { name: /MQ-2026-0102/ }))
    const panel = await screen.findByRole('presentation')

    expect(panel.querySelector('.MuiDrawer-paper')).toHaveClass('sf-scope')
  })

  it('el desglose es el del SERVIDOR: no se recalcula ni una suma', async () => {
    const user = userEvent.setup()
    render(backend())

    await user.click(await screen.findByRole('button', { name: /MQ-2026-0102/ }))
    const panel = await screen.findByRole('presentation')

    // El total del pedido es el que se cobró; el subtotal y los impuestos, los
    // que devolvió la base. Un número recompuesto aquí sería una segunda verdad.
    expect(within(panel).getByText('S/ 1,000.00')).toBeInTheDocument()
    expect(within(panel).getByText('− S/ 20.00')).toBeInTheDocument()
    expect(within(panel).getByText('S/ 180.75')).toBeInTheDocument()
    expect(within(panel).getByText('S/ 1,180.75')).toBeInTheDocument()
  })

  it('el detalle NO se pide hasta que alguien lo abre', async () => {
    const user = userEvent.setup()
    let veces = 0
    render(backend({ onDetail: () => (veces += 1) }))

    await screen.findByRole('button', { name: /MQ-2026-0102/ })
    expect(veces).toBe(0)

    await user.click(screen.getByRole('button', { name: /MQ-2026-0102/ }))
    await waitFor(() => expect(veces).toBe(1))
  })
})
