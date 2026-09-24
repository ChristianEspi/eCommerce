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
  it('son siete señales, cada una con su cuenta', () => {
    const todas = readinessSignals(TIENDA, CUENTAS)

    expect(todas).toHaveLength(7)
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
    // Al día: logotipo, contacto, fotos de producto (4 de 4) y las dos que no
    // tienen nada que medir —familias y marcas—. Por mejorar: la imagen de
    // portada y las páginas, que son cero.
    expect(alDia).toBe(5)
    expect(todas.filter((s) => s.state === 'todo').map((s) => s.id)).toEqual([
      'hero',
      'pages',
    ])
  })
})
