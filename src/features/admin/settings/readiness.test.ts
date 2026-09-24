import { describe, expect, it } from 'vitest'
import { readinessSignals, type ReadinessCounts, type ReadinessStoreFields } from './readiness'

/**
 * Las señales de «cómo se ve tu tienda» (Storefront V2 · P13).
 *
 * ## Lo que estas pruebas protegen
 *
 * Que el panel no se convierta en un examen. Es la deriva natural de cualquier
 * lista de comprobación: empieza informando y acaba exigiendo cosas que el
 * negocio de otro no tiene por qué tener.
 *
 * Así que aquí se fija lo contrario de lo habitual: que una tienda **sin nada
 * que medir aprueba**, que con un solo canal de contacto basta, y que no hay
 * ninguna nota opaca de 0 a 100 escondida en el cálculo — solo cuentas.
 */

const TIENDA: ReadinessStoreFields = {
  logo_url: null,
  banner_url: null,
  support_email: null,
  contact_phone: null,
  contact_address: null,
}

const CUENTAS: ReadinessCounts = {
  products: 0,
  productsWithImage: 0,
  rootCategories: 0,
  rootCategoriesWithImage: 0,
  brands: 0,
  brandsWithLogo: 0,
  pages: 0,
}

const señal = (
  id: string,
  store: Partial<ReadinessStoreFields> = {},
  counts: Partial<ReadinessCounts> = {},
) =>
  readinessSignals({ ...TIENDA, ...store }, { ...CUENTAS, ...counts }).find((s) => s.id === id)

describe('lo que el formulario ya sabe', () => {
  it('el logotipo es sí o no', () => {
    expect(señal('logo')?.state).toBe('todo')
    expect(señal('logo', { logo_url: 'org/tienda/logo.png' })?.state).toBe('ok')
  })

  it('un campo con solo espacios no cuenta como puesto', () => {
    expect(señal('logo', { logo_url: '   ' })?.state).toBe('todo')
  })

  it('con UN canal de contacto basta, y se dice cuántos hay', () => {
    // Exigir los tres sería inventar una obligación: con un teléfono ya se
    // puede llegar al comercio.
    const uno = señal('contact', { contact_phone: '987654321' })
    expect(uno?.state).toBe('ok')
    expect(uno?.done).toBe(1)
    expect(uno?.total).toBe(3)

    expect(señal('contact')?.state).toBe('todo')
  })
})

describe('lo que se cuenta contra la tienda publicada', () => {
  it('todos los productos con foto está completo', () => {
    const s = señal('product-images', {}, { products: 24, productsWithImage: 24 })
    expect(s?.state).toBe('ok')
    expect(s?.done).toBe(24)
  })

  it('faltando uno, es por mejorar, y se ve cuántos faltan', () => {
    const s = señal('product-images', {}, { products: 24, productsWithImage: 18 })
    expect(s?.state).toBe('todo')
    expect(s?.done).toBe(18)
    expect(s?.total).toBe(24)
  })

  it('una tienda SIN nada que medir está al día, no en rojo', () => {
    // La regla que impide que el panel sea un examen: una tienda sin marcas no
    // tiene marcas sin logotipo, y pedirle que invente marcas para aprobar
    // sería pedirle que trabaje para el panel.
    expect(señal('brand-logos', {}, { brands: 0, brandsWithLogo: 0 })?.state).toBe('ok')
    expect(señal('category-images', {}, { rootCategories: 0 })?.state).toBe('ok')
    expect(señal('product-images', {}, { products: 0 })?.state).toBe('ok')
  })

  it('las páginas no tienen número mínimo: basta que haya alguna', () => {
    // Cuántas necesita una tienda lo decide el comercio y su país, no esta
    // pantalla.
    expect(señal('pages', {}, { pages: 0 })?.state).toBe('todo')
    expect(señal('pages', {}, { pages: 1 })?.state).toBe('ok')
  })
})

describe('el panel no esconde una nota', () => {
  it('son ocho señales, cada una con su cuenta', () => {
    // Ocho desde V3 · P11: la descripción de la tienda entra en la lista, que
    // es lo que se lee en el pie y lo que ve un buscador al compartir el enlace.
    const todas = readinessSignals(TIENDA, CUENTAS)

    expect(todas).toHaveLength(8)
    for (const s of todas) {
      expect(['ok', 'todo']).toContain(s.state)
      expect(Number.isInteger(s.done)).toBe(true)
      expect(Number.isInteger(s.total)).toBe(true)
      expect(s.done).toBeLessThanOrEqual(s.total)
    }
  })

  it('el resumen se puede recalcular contando: no hay pesos ocultos', () => {
    // Si algún día alguien mete una ponderación, esta prueba deja de cuadrar.
    const todas = readinessSignals(
      { ...TIENDA, logo_url: 'a.png', support_email: 'hola@botica.pe' },
      { ...CUENTAS, products: 4, productsWithImage: 4 },
    )

    const alDia = todas.filter((s) => s.state === 'ok').length
    /**
     * Al día: logotipo, contacto, fotos de producto (4 de 4) y las dos que no
     * tienen nada que medir —familias y marcas—.
     *
     * Y desde V3 · P11 también la PORTADA: sin banner, el hero abre con la foto
     * de un producto, y aquí los cuatro productos tienen foto. Antes esta señal
     * pedía el banner como si no hubiera respaldo.
     *
     * Por mejorar: la descripción y las páginas, que están vacías.
     */
    expect(alDia).toBe(6)
    expect(todas.filter((s) => s.state === 'todo').map((s) => s.id)).toEqual([
      'description',
      'pages',
    ])
  })
})

/**
 * Storefront V3 · P11 · Readiness V2: las señales saben lo que V3 añadió.
 *
 * Dos de las siete señales de V2 preguntaban mal después de V3, y eso es peor
 * que no preguntar: una señal en rojo por algo que no es un hueco enseña a
 * ignorar el panel entero.
 */
describe('las señales conocen la identidad V3', () => {
  it('quien eligió su NOMBRE como marca no tiene un hueco de logotipo', () => {
    // `brand_lockup: 'name'` es una decisión de marca —el nombre escrito, como
    // media tienda de moda— y no un descuido. Pedirle un logotipo era pedirle
    // rellenar un hueco que él mismo cerró.
    expect(señal('logo', { logo_url: null, brand_lockup: 'name' })?.state).toBe('ok')
  })

  it('pero con logotipo en el lockup, sigue siendo lo que se espera ver', () => {
    expect(señal('logo', { logo_url: null, brand_lockup: 'logo' })?.state).toBe('todo')
    expect(señal('logo', { logo_url: null, brand_lockup: 'logo_name' })?.state).toBe('todo')
    // Y sin lockup guardado manda el defecto de la suite, que lleva logotipo.
    expect(señal('logo', { logo_url: null })?.state).toBe('todo')
    expect(señal('logo', { logo_url: 'logo.png', brand_lockup: 'logo' })?.state).toBe('ok')
  })

  it('la portada sin banner NO es un hueco si hay fotos de producto', () => {
    // Desde P04 el hero cae a la foto de un producto rebajado. Marcar esto en
    // rojo era pedir un banner para tapar algo que ya se ve bien.
    expect(
      señal('hero', { banner_url: null }, { products: 8, productsWithImage: 8 })?.state,
    ).toBe('ok')
  })

  it('y sí lo es cuando no hay ninguna imagen de la que tirar', () => {
    expect(
      señal('hero', { banner_url: null }, { products: 8, productsWithImage: 0 })?.state,
    ).toBe('todo')
    expect(señal('hero', { banner_url: null }, { products: 0 })?.state).toBe('todo')
    // Con banner, siempre al día.
    expect(señal('hero', { banner_url: 'portada.jpg' }, { products: 0 })?.state).toBe('ok')
  })

  it('la descripción de la tienda es una señal, con respaldo para las de V2', () => {
    expect(señal('description', { store_description: 'Muebles de roble.' })?.state).toBe('ok')
    // La bajada del hero ERA la descripción publicable antes de V3: a una
    // tienda que ya la tenía escrita no se le pide escribirla otra vez.
    expect(señal('description', { hero_subtitle: 'Fabricación propia' })?.state).toBe('ok')
    expect(señal('description', {})?.state).toBe('todo')
  })
})

describe('readiness sigue sin bloquear y sin puntuar', () => {
  it('con todo vacío, ninguna señal es un error y ninguna pide nada imposible', () => {
    const todas = readinessSignals(TIENDA, CUENTAS)

    for (const s of todas) {
      expect(['ok', 'todo']).toContain(s.state)
      expect(s.total).toBeGreaterThanOrEqual(s.done)
    }
  })

  it('con todo lleno, las ocho están al día', () => {
    const todas = readinessSignals(
      {
        logo_url: 'logo.png',
        banner_url: 'portada.jpg',
        support_email: 'hola@botica.pe',
        contact_phone: '+51 999 111 222',
        contact_address: 'Av. Primavera 120',
        brand_lockup: 'logo_name',
        store_description: 'Muebles de roble, fabricación propia.',
        hero_subtitle: 'Desde 1998',
      },
      {
        products: 12,
        productsWithImage: 12,
        rootCategories: 4,
        rootCategoriesWithImage: 4,
        brands: 3,
        brandsWithLogo: 3,
        pages: 2,
      },
    )

    expect(todas).toHaveLength(8)
    expect(todas.filter((s) => s.state === 'todo')).toEqual([])
  })
})
