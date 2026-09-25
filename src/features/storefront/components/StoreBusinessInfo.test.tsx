import { screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { StoreBusinessInfo } from './StoreBusinessInfo'

/**
 * La sección «Sobre la tienda» de la portada (Storefront V2 · P09).
 *
 * ## Qué protegen estas pruebas
 *
 * Lo mismo que las del pie, y por el mismo motivo: la **regla anti-invención**.
 * Una sección «sobre nosotros» a media tienda tienta todavía más que el pie —un
 * párrafo de confianza, un horario, un mapa, tres redes sociales—, y todo eso
 * son afirmaciones sobre el negocio de otro.
 *
 * Y una segunda regla que es propia de esta sección: **callarse cuando no hay
 * nada cierto que decir**. Sin una forma de contacto, esto sería la cabecera
 * repetida con otra tipografía, así que no se pinta. Un hueco con el nombre de
 * la tienda dentro no es «casi» la sección: es peor que no tenerla, porque
 * ocupa el sitio de algo que sí vende.
 */

/** El tipo real de la prop, para que la tienda de prueba no infiera `null`. */
type TiendaDePrueba = ComponentProps<typeof StoreBusinessInfo>['store']

const TIENDA: TiendaDePrueba = {
  name: 'Botica del Centro',
  business_display_name: null,
  hero_subtitle: null,
  support_email: null,
  contact_phone: null,
  contact_address: null,
}

function pintar(
  tienda: Partial<TiendaDePrueba> = {},
  paginas: Array<{ slug: string; title: string }> = [],
) {
  renderWithProviders(
    <StoreBusinessInfo store={{ ...TIENDA, ...tienda }} storeSlug="botica" pages={paginas} />,
    { route: '/s/botica' },
  )
  return screen.queryByRole('region', { name: 'Sobre la tienda' })
}

describe('lo que el comercio escribió, sale', () => {
  it('el correo se puede pulsar y lleva a escribirle', () => {
    pintar({ support_email: 'hola@botica.pe' })

    const enlace = screen.getByRole('link', { name: 'hola@botica.pe' })
    expect(enlace).toHaveAttribute('href', 'mailto:hola@botica.pe')
  })

  it('el teléfono se puede marcar, y el número va sin espacios', () => {
    // Un `tel:` con espacios no lo marca la mitad de los teléfonos. El texto
    // se lee como lo escribió el comercio; el destino, saneado.
    pintar({ contact_phone: '+51 987 654 321' })

    expect(screen.getByRole('link', { name: '+51 987 654 321' })).toHaveAttribute(
      'href',
      'tel:+51987654321',
    )
  })

  it('la dirección se lee, y no finge ser un enlace', () => {
    // Un enlace que no lleva a ninguna parte se pulsa igual. Y esta sección no
    // sabe en qué mapa está ese local, así que no inventa uno.
    pintar({ contact_address: 'Av. Arequipa 1234, Lima' })

    expect(screen.getByText('Av. Arequipa 1234, Lima')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Arequipa/ })).not.toBeInTheDocument()
  })

  it('cada canal dice lo que es', () => {
    pintar({
      support_email: 'hola@botica.pe',
      contact_phone: '987654321',
      contact_address: 'Av. Arequipa 1234',
    })

    expect(screen.getByText('Correo')).toBeInTheDocument()
    expect(screen.getByText('Teléfono')).toBeInTheDocument()
    expect(screen.getByText('Dirección')).toBeInTheDocument()
  })

  it('el nombre comercial manda sobre el de la vitrina', () => {
    // El de la vitrina es el que el comercio eligió para su URL; el comercial
    // es con el que factura. Donde se habla del negocio, manda el segundo.
    pintar({
      support_email: 'hola@botica.pe',
      business_display_name: 'Farmacéutica del Centro S.A.C.',
    })

    expect(screen.getByText('Farmacéutica del Centro S.A.C.')).toBeInTheDocument()
    expect(screen.queryByText('Botica del Centro')).not.toBeInTheDocument()
  })

  it('la descripción de la tienda acompaña al nombre', () => {
    pintar({ support_email: 'hola@botica.pe', hero_subtitle: 'Atendemos desde 1998.' })

    expect(screen.getByText('Atendemos desde 1998.')).toBeInTheDocument()
  })
})

describe('las páginas son las que el comercio publicó', () => {
  it('enlazan a la página real de la tienda', () => {
    pintar({ support_email: 'hola@botica.pe' }, [
      { slug: 'terminos', title: 'Términos y condiciones' },
      { slug: 'envios', title: 'Envíos' },
    ])

    expect(screen.getByRole('link', { name: /Términos y condiciones/ })).toHaveAttribute(
      'href',
      '/s/botica/p/terminos',
    )
    expect(screen.getByRole('link', { name: /Envíos/ })).toHaveAttribute(
      'href',
      '/s/botica/p/envios',
    )
  })

  it('no se cablea ninguna que no exista', () => {
    // «Quiénes somos» y «Devoluciones» quedan muy bien y son gratis de maquetar.
    // Enlazar a una página que nadie escribió lleva a un «no encontramos esta
    // página» con la marca del comercio encima.
    pintar({ support_email: 'hola@botica.pe' }, [{ slug: 'terminos', title: 'Términos' }])

    const region = screen.getByRole('region', { name: 'Sobre la tienda' })
    const enlaces = within(region)
      .getAllByRole('link')
      .map((enlace) => enlace.getAttribute('href'))

    expect(enlaces).toEqual(['/s/botica/p/terminos', 'mailto:hola@botica.pe'])
  })

  it('sin páginas publicadas no queda una navegación vacía', () => {
    pintar({ support_email: 'hola@botica.pe' })

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('una página sin título no se enlaza: sería un destino invisible', () => {
    pintar({ support_email: 'hola@botica.pe' }, [
      { slug: 'vacia', title: '   ' },
      { slug: 'terminos', title: 'Términos' },
    ])

    const nav = screen.getByRole('navigation', { name: 'Más información' })
    expect(within(nav).getAllByRole('link')).toHaveLength(1)
  })

  it('como mucho cuatro: esto orienta, y el pie tiene la lista entera', () => {
    pintar(
      { support_email: 'hola@botica.pe' },
      Array.from({ length: 7 }, (_, i) => ({ slug: `p${i}`, title: `Página ${i}` })),
    )

    const nav = screen.getByRole('navigation', { name: 'Más información' })
    expect(within(nav).getAllByRole('link')).toHaveLength(4)
  })
})

describe('lo que el comercio NO escribió, no se inventa', () => {
  it('sin ninguna forma de contacto, la sección no se pinta', () => {
    // No es un fallo: es la respuesta correcta. Sin contacto, esto sería el
    // nombre y la descripción que ya están en la cabecera y en el pie.
    expect(pintar()).toBeNull()
  })

  it('tampoco con descripción y páginas, si no hay a dónde escribir', () => {
    // Las páginas acompañan, no sostienen: el pie ya las lista, y media portada
    // repitiendo el pie no informa de nada nuevo.
    expect(
      pintar({ hero_subtitle: 'Atendemos desde 1998.' }, [{ slug: 'terminos', title: 'Términos' }]),
    ).toBeNull()
  })

  it('un campo con solo espacios cuenta como vacío', () => {
    expect(pintar({ support_email: '   ', contact_phone: '\t' })).toBeNull()
  })

  it('con un solo canal se pinta, y no deja los otros dos en blanco', () => {
    const region = pintar({ contact_phone: '987654321' })

    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('data-business-info', '1')
    expect(screen.queryByText('Correo')).not.toBeInTheDocument()
    expect(screen.queryByText('Dirección')).not.toBeInTheDocument()
  })

  it('ni un horario, ni una red social, ni un método de pago', () => {
    const region = pintar(
      {
        support_email: 'hola@botica.pe',
        contact_phone: '987654321',
        contact_address: 'Av. Arequipa 1234',
        hero_subtitle: 'Atendemos desde 1998.',
      },
      [{ slug: 'terminos', title: 'Términos' }],
    )

    const texto = region?.textContent ?? ''
    for (const invento of [
      'Lunes',
      'horario',
      'Horario',
      'WhatsApp',
      'Facebook',
      'Instagram',
      'Visa',
      'Mastercard',
      'Yape',
      'gratis',
      'Síguenos',
    ]) {
      expect(texto).not.toContain(invento)
    }

    // Y ni un enlace fuera del dominio de la tienda, salvo los `mailto:`/`tel:`
    // que el propio comercio escribió.
    for (const enlace of within(region as HTMLElement).getAllByRole('link')) {
      expect(enlace.getAttribute('href')).toMatch(/^(\/s\/botica\/|mailto:|tel:)/)
    }
  })
})

describe('se puede recorrer con un lector de pantalla', () => {
  it('es una región con nombre y un encabezado de segundo nivel', () => {
    // La portada lleva el `<h1>` —el hero de la tienda—, así que las secciones
    // cuelgan de él en nivel dos. Un `<h1>` aquí partiría el documento en dos.
    const region = pintar({ support_email: 'hola@botica.pe' })

    expect(region).toBeInTheDocument()
    expect(
      within(region as HTMLElement).getByRole('heading', { level: 2, name: 'Sobre la tienda' }),
    ).toBeInTheDocument()
  })

  it('los iconos no se anuncian: no dicen nada que el texto no diga', () => {
    const region = pintar({ support_email: 'hola@botica.pe' })

    expect((region as HTMLElement).querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0)
  })
})
