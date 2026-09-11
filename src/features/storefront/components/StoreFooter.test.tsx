import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

/**
 * El pie de la tienda.
 *
 * ## Lo que estas pruebas protegen de verdad
 *
 * No la maquetación: la **regla anti-invención**. Un pie de comercio es donde
 * más tienta rellenar con logotipos de tarjetas, un icono de WhatsApp, un
 * horario y una promesa de envío gratis. Todo eso son afirmaciones sobre el
 * negocio de otro, y este código no tiene ese dato.
 *
 * Así que aquí se comprueba lo que NO sale cuando el comercio no lo ha
 * escrito, con la misma insistencia que lo que sí sale cuando lo ha escrito. Un
 * bloque vacío tampoco vale: dice «esto existe y está sin rellenar».
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorefrontLayout } = await import('../StorefrontLayout')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

function backend(
  tienda: Record<string, unknown> = {},
  paginas: Array<{ slug: string; title: string }> = [],
): FakeSupabase {
  return createFakeSupabase({
    tables: {
      public_stores: [
        {
          store_id: STORE,
          slug: 'botica',
          name: 'Botica del Centro',
          currency: 'PEN',
          accent_color: '#056769',
          logo_url: null,
          white_label: false,
          default_locale: 'es',
          support_email: null,
          banner_url: null,
          hero_title: null,
          hero_subtitle: null,
          contact_phone: null,
          contact_address: null,
          business_display_name: null,
          ...tienda,
        },
      ],
      public_categories: [],
      public_products: [],
      public_product_images: [],
    },
    rpc: { store_navigation_for_slug: () => paginas },
  })
}

async function pintar(
  tienda: Record<string, unknown> = {},
  paginas: Array<{ slug: string; title: string }> = [],
) {
  holder.client = backend(tienda, paginas)
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<div>catálogo</div>} />
      </Route>
    </Routes>,
    { route: '/s/botica' },
  )
  await screen.findByRole('banner')
  return screen.getByRole('contentinfo')
}

beforeEach(() => {
  holder.client = null
})

describe('lo que el comercio escribió, sale', () => {
  it('el correo es pulsable y se anuncia por lo que es', async () => {
    const pie = await pintar({ support_email: 'hola@botica.pe' })

    // El nombre accesible es la dirección misma, no «Correo: …»: el bloque ya
    // se llama «Contacto» y la palabra suelta choca con el campo del checkout.
    const enlace = within(pie).getByRole('link', { name: 'hola@botica.pe' })
    expect(enlace).toHaveAttribute('href', 'mailto:hola@botica.pe')
  })

  it('el teléfono se puede marcar', async () => {
    const pie = await pintar({ contact_phone: '+51 999 111 222' })

    expect(within(pie).getByRole('link', { name: '+51 999 111 222' })).toHaveAttribute(
      'href',
      'tel:+51999111222',
    )
  })

  it('la dirección se lee, y no finge ser un enlace', async () => {
    const pie = await pintar({ contact_address: 'Av. Primavera 120, Lima' })

    expect(within(pie).getByText('Av. Primavera 120, Lima')).toBeInTheDocument()
    expect(within(pie).queryByRole('link', { name: /Av\. Primavera/ })).not.toBeInTheDocument()
  })

  it('el nombre comercial manda sobre el de la vitrina en el aviso legal', async () => {
    // Son dos cosas distintas: «Botica del Centro» en la portada y «Boticas
    // Rodríguez S.A.C.» en la factura y en el copyright.
    const pie = await pintar({ business_display_name: 'Boticas Rodríguez S.A.C.' })

    expect(within(pie).getByText(/Boticas Rodríguez S\.A\.C\./)).toBeInTheDocument()
  })

  it('las condiciones de venta se alcanzan desde el pie', async () => {
    const pie = await pintar({}, [{ slug: 'terminos', title: 'Términos y condiciones' }])

    const nav = await within(pie).findByRole('navigation')
    expect(within(nav).getByRole('link', { name: 'Términos y condiciones' })).toHaveAttribute(
      'href',
      '/s/botica/p/terminos',
    )
  })
})

describe('lo que el comercio NO escribió, no se inventa', () => {
  it('una tienda sin datos de contacto no deja bloques vacíos', async () => {
    const pie = await pintar()

    expect(within(pie).queryByText(/contacto/i)).not.toBeInTheDocument()
    expect(within(pie).queryByRole('navigation')).not.toBeInTheDocument()
    // Y sigue habiendo pie: el aviso de copyright no depende de nada.
    expect(within(pie).getByText(/Botica del Centro/)).toBeInTheDocument()
  })

  it('no aparece ni un método de pago, ni una red social, ni un horario', async () => {
    const pie = await pintar({
      support_email: 'hola@botica.pe',
      contact_phone: '+51 999 111 222',
    })

    const texto = pie.textContent ?? ''
    for (const invento of [
      'Visa',
      'Mastercard',
      'WhatsApp',
      'Facebook',
      'Instagram',
      'Envío gratis',
      'Garantía',
      'Lunes',
      'Horario',
    ]) {
      expect(texto).not.toContain(invento)
    }
  })

  it('sin páginas publicadas no hay una navegación vacía', async () => {
    const pie = await pintar({ support_email: 'hola@botica.pe' }, [])

    expect(within(pie).queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('un campo con solo espacios cuenta como vacío', async () => {
    const pie = await pintar({ contact_phone: '   ' })

    expect(within(pie).queryByText(/contacto/i)).not.toBeInTheDocument()
    expect(
      within(pie).queryByRole('link', { name: (nombre) => nombre.startsWith('+') }),
    ).not.toBeInTheDocument()
  })
})

describe('el pie se puede recorrer con el teclado', () => {
  it('los enlaces reciben el foco en orden', async () => {
    const user = userEvent.setup()
    const pie = await pintar({ support_email: 'hola@botica.pe' }, [
      { slug: 'terminos', title: 'Términos y condiciones' },
    ])

    await within(pie).findByRole('navigation')
    const enlaces = within(pie).getAllByRole('link')
    enlaces[0]?.focus()
    expect(enlaces[0]).toHaveFocus()

    await user.tab()
    expect(enlaces[1]).toHaveFocus()
  })
})
