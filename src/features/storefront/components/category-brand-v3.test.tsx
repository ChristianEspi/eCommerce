import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { BrandLogoWall } from './BrandLogoWall'
import { BrandRow, type BrandOption } from './BrandRow'
import { CategoryMosaic } from './CategoryMosaic'
import type { CategoryDoorItem } from './CategoryDoors'

/**
 * Mosaico de familias y muro de logotipos (Storefront V3 · P07).
 *
 * ## Qué defiende este archivo
 *
 * **Que el mosaico sea jerarquía y no adorno.** Una familia ocupa el doble de
 * área y las demás la acompañan; con una o dos familias no hay jerarquía
 * posible —una puerta «destacada» sobre nada no destaca— y se dejan iguales.
 * El ORDEN nunca se toca: la primera del mosaico es la primera que ordenó el
 * comercio, no la que tenga mejor foto.
 *
 * **Que el teléfono no reciba la composición de escritorio.** «El doble de
 * área» en 390 px es una puerta que ocupa media pantalla y dos que no se leen.
 * En el teléfono el mosaico vuelve a dos columnas iguales.
 *
 * **Que el muro reconozca en lugar de informar.** Sin caja, sin tinte y sin la
 * cuenta de productos al lado; el logotipo entero, sin estirar, y monograma
 * cuando la marca no tiene logotipo. Y pulsar una marca filtra la vitrina con
 * el mismo `?b=` que las tarjetas: la composición cambia, la promesa no.
 *
 * **Que ninguna de las dos nombre un rubro.** Lo que se lee en pantalla sale
 * del catálogo del comercio o del diccionario de la suite, nunca de una lista
 * de palabras de sector escondida en el componente.
 */

const FOTO = 'https://firmado.test/una-familia.webp'
const LOGO = 'https://firmado.test/marca.png'

function familia(nombre: string, extra: Partial<CategoryDoorItem> = {}): CategoryDoorItem {
  const slug = nombre.toLowerCase().replace(/\s+/g, '-')
  return { category_id: slug, name: nombre, slug, ...extra }
}

/** Nombres neutros: lo que se prueba es la composición, no el catálogo. */
function familias(cuantas: number): readonly CategoryDoorItem[] {
  return Array.from({ length: cuantas }, (_, indice) => familia(`Familia ${indice + 1}`))
}

function marca(nombre: string, extra: Partial<BrandOption> = {}): BrandOption {
  return { code: nombre.toLowerCase(), name: nombre, count: 12, ...extra }
}

function pintarMosaico(categories: readonly CategoryDoorItem[]) {
  return renderWithProviders(
    <CategoryMosaic categories={categories} storeSlug="tienda" ariaLabel="Categorías" />,
    { route: '/s/tienda' },
  )
}

function pintarMuro(
  brands: readonly BrandOption[],
  extra: { selected?: string | null; onSelect?: (code: string | null) => void } = {},
) {
  const onSelect = extra.onSelect ?? vi.fn()
  const resultado = renderWithProviders(
    <BrandLogoWall
      brands={brands}
      selected={extra.selected ?? null}
      onSelect={onSelect}
      seeAllHref="/s/tienda?ver=todo"
    />,
    { route: '/s/tienda' },
  )
  return { ...resultado, onSelect }
}

/** Las celdas del mosaico, en el orden en que están en el DOM. */
function celdas(): readonly HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-mosaic-cell]'))
}

/** Una celda concreta. Falla diciendo qué faltaba, no con «undefined». */
function celda(indice: number): HTMLElement {
  const encontrada = celdas()[indice]
  if (!encontrada) throw new Error(`el mosaico no tiene celda ${indice}`)
  return encontrada
}

/**
 * Las reglas CSS que le toca a un elemento, con sus `@media` intactos.
 *
 * `getComputedStyle` no sirve para esto: jsdom no evalúa media queries, así que
 * de un valor declarado por punto de ruptura devuelve la cadena vacía. Lo que sí
 * está es la hoja que el sistema de estilos inyecta, y ahí se lee literalmente
 * qué se aplica en el teléfono y qué a partir de escritorio — que es justo la
 * diferencia que este archivo tiene que defender.
 */
function reglasDe(elemento: HTMLElement): readonly string[] {
  const clase = elemento.className.split(/\s+/).find((nombre) => nombre.startsWith('css-'))
  if (!clase) return []

  const todas: string[] = []
  for (const hoja of Array.from(document.styleSheets)) {
    try {
      for (const regla of Array.from(hoja.cssRules)) todas.push(regla.cssText)
    } catch {
      // Una hoja de otro origen no se puede leer. En las pruebas no hay
      // ninguna, pero saltarla es más barato que confiar en que no la haya.
    }
  }
  return todas.filter((regla) => regla.includes(`.${clase}`))
}

/** La regla que se aplica a partir de un ancho, o la base si no se pide ancho. */
function reglaEn(elemento: HTMLElement, minWidth?: string): string {
  const reglas = reglasDe(elemento)
  if (minWidth) return reglas.find((regla) => regla.includes(`min-width:${minWidth}`)) ?? ''
  return reglas.find((regla) => !regla.includes('@media')) ?? ''
}

describe('el mosaico reparte área según cuántas familias hay', () => {
  it('con una familia no destaca nada: no hay jerarquía que enseñar', () => {
    pintarMosaico(familias(1))

    const cuadricula = screen.getByLabelText('Categorías')
    expect(cuadricula).toHaveAttribute('data-category-mosaic', '1')
    expect(celdas()).toHaveLength(1)
    expect(celda(0)).toHaveAttribute('data-mosaic-cell', 'follow')
  })

  it('con dos tampoco: una puerta doble y una sencilla es un hueco, no una portada', () => {
    pintarMosaico(familias(2))

    expect(celdas().map((celda) => celda.dataset.mosaicCell)).toEqual(['follow', 'follow'])
  })

  it('con tres aparece la pieza principal', () => {
    pintarMosaico(familias(3))

    expect(celdas().map((celda) => celda.dataset.mosaicCell)).toEqual([
      'lead',
      'follow',
      'follow',
    ])
  })

  it('con seis sigue habiendo una sola pieza principal', () => {
    pintarMosaico(familias(6))

    const reparto = celdas().map((celda) => celda.dataset.mosaicCell)
    expect(reparto).toHaveLength(6)
    expect(reparto.filter((sitio) => sitio === 'lead')).toHaveLength(1)
    expect(reparto[0]).toBe('lead')
  })

  it('con diez se queda en seis: un mosaico de diez piezas ya no tiene jerarquía', () => {
    pintarMosaico(familias(10))

    expect(celdas()).toHaveLength(6)
    expect(screen.getByLabelText('Categorías')).toHaveAttribute('data-category-mosaic', '6')
  })

  it('no reordena: la principal es la primera que ordenó el comercio', () => {
    /**
     * Es la tentación evidente —subir al frente la familia que tiene foto— y
     * sería decidir por el comercio cuál es su familia principal. Aquí la
     * primera no tiene foto y las otras sí, y sigue mandando.
     */
    pintarMosaico([
      familia('Primera'),
      familia('Segunda', { imageUrl: FOTO }),
      familia('Tercera', { imageUrl: FOTO }),
    ])

    const principal = celda(0)
    expect(principal).toHaveAttribute('data-mosaic-cell', 'lead')
    expect(within(principal).getByRole('link', { name: /Primera/ })).toBeInTheDocument()
  })
})

describe('el mosaico usa las mismas puertas, con foto y sin ella', () => {
  it('la familia con foto la pinta; la que no tiene cae a su tinte e icono', () => {
    pintarMosaico([
      familia('Con foto', { imageUrl: FOTO }),
      familia('Sin foto'),
      familia('Tercera'),
    ])

    expect(screen.getByRole('link', { name: /Con foto/ })).toHaveAttribute(
      'data-category-door',
      'photo',
    )
    const sinFoto = screen.getByRole('link', { name: /Sin foto/ })
    expect(sinFoto).toHaveAttribute('data-category-door', 'tint')
    // No se rellena con una imagen inventada: se pinta con tinte e icono.
    expect(sinFoto.querySelector('img')).toBeNull()
    expect(sinFoto.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('cada pieza sigue llevando al catálogo filtrado por su familia', () => {
    pintarMosaico([familia('Una familia'), familia('Otra'), familia('Y otra')])

    expect(screen.getByRole('link', { name: /Una familia/ })).toHaveAttribute(
      'href',
      '/s/tienda?c=una-familia',
    )
  })
})

describe('el mosaico en el teléfono', () => {
  it('es una rejilla de dos columnas iguales, no el mosaico de escritorio', () => {
    pintarMosaico(familias(6))

    // En el teléfono, dos columnas iguales. En escritorio, cuatro: es lo que
    // permite que una pieza ocupe dos sin dejar huecos.
    const cuadricula = screen.getByLabelText('Categorías')
    expect(reglaEn(cuadricula, '0px')).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    )
    expect(reglaEn(cuadricula, '900px')).toContain(
      'grid-template-columns: repeat(4, minmax(0, 1fr))',
    )
  })

  it('el doble de área de la pieza principal solo existe en escritorio', () => {
    /**
     * Este es el error clásico del mosaico: copiar la composición de escritorio
     * a 390 px, donde «el doble de área» es una puerta que ocupa media pantalla
     * y dos que no se leen.
     *
     * Así que el `span` tiene que vivir DENTRO del media query de escritorio y
     * no en la base. Si algún día alguien lo saca del `md`, esto se pone rojo.
     */
    pintarMosaico(familias(6))
    const principal = celda(0)

    expect(reglaEn(principal, '900px')).toContain('span 2')
    expect(reglaEn(principal)).not.toContain('span 2')
    expect(reglaEn(principal, '0px')).not.toContain('span 2')
  })
})

describe('el muro de logotipos', () => {
  it('pinta el logotipo entero y sin estirar cuando la marca lo tiene', () => {
    pintarMuro([marca('Con logo', { logoUrl: LOGO })])

    const imagen = screen
      .getByRole('button', { name: /Con logo/ })
      .querySelector('img') as HTMLImageElement
    expect(imagen).not.toBeNull()
    expect(imagen.src).toBe(LOGO)
    // `contain` es lo que impide la deformación; `cover` recortaría un logotipo
    // apaisado y dejaría un trozo de letra.
    expect(imagen.style.objectFit).toBe('contain')
    // Y el hueco lo reserva el navegador antes de descargar: sin esto el muro
    // salta al cargar.
    expect(imagen.getAttribute('width')).toBe('44')
    expect(imagen.getAttribute('height')).toBe('44')
  })

  it('la marca sin logotipo cae a su monograma, no se esconde ni se inventa una imagen', () => {
    pintarMuro([marca('Sin logo')])

    const azulejo = screen.getByRole('button', { name: /Sin logo/ })
    expect(azulejo.querySelector('img')).toBeNull()
    // El monograma son las iniciales del nombre, siempre las mismas.
    expect(azulejo.textContent).toContain('SL')
  })

  it('deja el logotipo sin caja: un muro con doce recuadros es una tabla', () => {
    const { unmount } = pintarMuro([marca('Con logo', { logoUrl: LOGO })])
    const enMuro = screen.getByRole('button', { name: /Con logo/ }).querySelector('img')
      ?.parentElement as HTMLElement
    const muro = reglaEn(enMuro)
    expect(muro).toContain('border: none')
    // Ni fondo propio: el logotipo se apoya en la superficie de la sección.
    expect(getComputedStyle(enMuro).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    unmount()

    // La misma marca dentro de una TARJETA sí lleva su línea: ahí el logotipo
    // es un dato más junto al nombre y la cuenta, y la línea lo separa.
    renderWithProviders(
      <BrandRow
        brands={[marca('Con logo', { logoUrl: LOGO })]}
        selected={null}
        onSelect={vi.fn()}
      />,
      { route: '/s/tienda' },
    )
    const [tarjeta] = screen.getAllByRole('button', { name: /Con logo/ })
    const enTarjeta = tarjeta?.querySelector('img')?.parentElement
    if (!enTarjeta) throw new Error('la tarjeta de marca no pintó su logotipo')

    expect(reglaEn(enTarjeta)).toContain('border: 1px solid var(--sf-line)')
    expect(getComputedStyle(enTarjeta).backgroundColor).toBe('var(--card)')
  })

  it('el logotipo sigue protegido del estirado y del salto de contenido sin la caja', () => {
    // Quitar la caja no puede quitar lo que la hacía segura: el hueco de tamaño
    // fijo —que es lo que evita que la fila cambie de alto al cargar— y el
    // `contain`.
    pintarMuro([marca('Con logo', { logoUrl: LOGO })])
    const caja = screen.getByRole('button', { name: /Con logo/ }).querySelector('img')
      ?.parentElement as HTMLElement

    const regla = reglaEn(caja)
    expect(regla).toContain('width: 44px')
    expect(regla).toContain('height: 44px')
  })

  it('no lleva la cuenta de productos, que en un muro de reconocimiento es ruido', () => {
    pintarMuro([marca('Una marca', { logoUrl: LOGO, count: 12 })])

    const muro = screen.getByRole('region', { name: /marca/i })
    expect(muro.textContent).not.toMatch(/12/)
  })

  it('sin marcas no pinta una sección vacía', () => {
    pintarMuro([])

    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('el muro conserva la navegación de las tarjetas', () => {
  it('cada marca es un botón que filtra y se suelta, no un enlace', () => {
    const onSelect = vi.fn()
    pintarMuro([marca('Una marca')], { onSelect })

    const azulejo = screen.getByRole('button', { name: /Una marca/ })
    expect(azulejo).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(azulejo)
    // El código de la marca, que es lo que el catálogo lee de `?b=`.
    expect(onSelect).toHaveBeenCalledWith('una marca')
  })

  it('pulsar la marca ya activa la suelta', () => {
    const onSelect = vi.fn()
    pintarMuro([marca('Una marca')], { selected: 'una marca', onSelect })

    const azulejo = screen.getByRole('button', { name: /Una marca/ })
    expect(azulejo).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(azulejo)
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('mantiene la salida al catálogo completo con su ruta de siempre', () => {
    pintarMuro([marca('Una marca')])

    expect(screen.getByRole('link')).toHaveAttribute('href', '/s/tienda?ver=todo')
  })
})

/**
 * Palabras de rubro, por principio de palabra y sobre el texto sin acentos.
 * La misma comparación que `multi-industry.test.ts`, y por el mismo motivo: en
 * una expresión regular «ó» no es carácter de palabra, así que `\bmoda`
 * encontraría «cómoda».
 */
const RUBROS = ['farmac', 'botica', 'medicament', 'calzado', 'zapat', 'moda', 'ferreter']

function nombraRubro(texto: string): boolean {
  const plano = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return RUBROS.some((rubro) => new RegExp(`\\b${rubro}`).test(plano))
}

describe('ninguna de las dos composiciones nombra un rubro', () => {
  it('el mosaico solo dice lo que el comercio tiene en su catálogo', () => {
    pintarMosaico(familias(6))

    expect(nombraRubro(screen.getByLabelText('Categorías').textContent ?? '')).toBe(false)
  })

  it('el muro solo dice los nombres de las marcas del comercio', () => {
    pintarMuro([marca('Una marca', { logoUrl: LOGO }), marca('Otra marca')])

    expect(nombraRubro(screen.getByRole('region', { name: /marca/i }).textContent ?? '')).toBe(
      false,
    )
  })
})
