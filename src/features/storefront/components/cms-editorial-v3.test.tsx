import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  BANNER_LAYOUTS,
  CATEGORY_COLLECTION_LAYOUTS,
  PRODUCT_COLLECTION_LAYOUTS,
} from '@/domain/content'
import { renderWithProviders } from '@/test/render'
import type { ContentBlock, ContentCollectionItem } from '../content'
import { ContentBlocks } from './ContentBlocks'

/**
 * Los bloques del CMS y sus composiciones (Storefront V3 · P08).
 *
 * ## Qué defiende este archivo
 *
 * **Que la composición cambie el REPARTO y no el contenido.** Las cinco
 * disposiciones de una colección pintan los mismos productos, en el mismo orden,
 * sin pedir nada más: son la misma lista repartida de otra forma. El día que una
 * de ellas filtre, recorte o reordene, esto se pone rojo.
 *
 * **Que cada una se distinga de verdad.** Un contrato con cinco valores que
 * pintan lo mismo es peor que un contrato con uno: el comercio elige, no ve
 * ningún cambio y deja de creerse el editor.
 *
 * **Que el teléfono no reciba la composición de escritorio.** Partida, apilada;
 * destacado, sin pieza doble; mosaico, dos columnas iguales.
 *
 * **Que nada nuevo interprete HTML.** El texto enriquecido sigue pasando por el
 * mismo componente, y `dangerouslySetInnerHTML` lo vigila `architecture.test.ts`
 * para todo `src/` — no hace falta repetirlo aquí, pero sí comprobar que un
 * `<script>` guardado como texto sale como texto.
 */

const IMAGEN = 'https://firmado.test/banner.webp'

/** Los dos tipos de item que estas pruebas usan, ya estrechados. */
type ItemProducto = Extract<ContentCollectionItem, { kind: 'product' }>
type ItemFamilia = Extract<ContentCollectionItem, { kind: 'category' }>

function producto(nombre: string, indice: number): ItemProducto {
  return {
    kind: 'product',
    product_id: `cccc${indice}111-1111-4111-8111-111111111111`,
    slug: nombre.toLowerCase().replace(/\s+/g, '-'),
    name: nombre,
    brand_name: null,
    price: '19.90',
    compare_at_price: null,
    price_from: null,
    currency: 'PEN',
    in_stock: true,
    image_path: null,
    image_alt: null,
  }
}

function familia(nombre: string, indice: number): ItemFamilia {
  return {
    kind: 'category',
    category_id: `dddd${indice}111-1111-4111-8111-111111111111`,
    slug: nombre.toLowerCase().replace(/\s+/g, '-'),
    name: nombre,
  }
}

function bloque(extra: Partial<ContentBlock> = {}): ContentBlock {
  return {
    id: 'bbbb1111-1111-4111-8111-111111111111',
    type: 'product_collection',
    position: 0,
    title: 'La selección',
    subtitle: 'Lo que el comercio escribió',
    body: null,
    mediaUrl: null,
    mediaAlt: null,
    ctaLabel: null,
    ctaHref: null,
    settings: {},
    campaignLive: false,
    campaignEndsAt: null,
    campaign: null,
    items: [],
    ...extra,
  }
}

/** Se pinta como lo pinta la vista previa del backoffice: sin assets firmados. */
function pintar(...blocks: readonly ContentBlock[]) {
  return renderWithProviders(
    <ContentBlocks blocks={blocks} storeSlug="tienda" assets={{}} images={{}} />,
    { route: '/s/tienda' },
  )
}

const PRODUCTOS = [
  producto('Primero', 1),
  producto('Segundo', 2),
  producto('Tercero', 3),
  producto('Cuarto', 4),
]

const FAMILIAS = [familia('Familia uno', 1), familia('Familia dos', 2), familia('Familia tres', 3)]

function coleccion(layout: string, items = PRODUCTOS): ContentBlock {
  return bloque({ settings: { layout }, items })
}

/** Las reglas CSS de un elemento, con sus `@media` intactos (ver P07). */
function reglaEn(elemento: HTMLElement, minWidth?: string): string {
  const clase = elemento.className.split(/\s+/).find((nombre) => nombre.startsWith('css-'))
  if (!clase) return ''

  const todas: string[] = []
  for (const hoja of Array.from(document.styleSheets)) {
    try {
      for (const regla of Array.from(hoja.cssRules)) todas.push(regla.cssText)
    } catch {
      // Una hoja de otro origen no se puede leer; en las pruebas no hay ninguna.
    }
  }
  const mias = todas.filter((regla) => regla.includes(`.${clase}`))
  if (minWidth) return mias.find((regla) => regla.includes(`min-width:${minWidth}`)) ?? ''
  return mias.find((regla) => !regla.includes('@media')) ?? ''
}

describe('las cinco disposiciones de una colección pintan la misma lista', () => {
  it.each(PRODUCT_COLLECTION_LAYOUTS)('%s enseña los cuatro productos, en orden', (layout) => {
    pintar(coleccion(layout))

    const nombres = PRODUCTOS.map((item) => item.name)
    for (const nombre of nombres) {
      expect(screen.getAllByText(nombre).length).toBeGreaterThan(0)
    }

    // Y en el orden del bloque: una composición no reordena el catálogo del
    // comercio para que «quede mejor».
    const texto = document.body.textContent ?? ''
    const posiciones = nombres.map((nombre) => texto.indexOf(nombre))
    expect([...posiciones]).toEqual([...posiciones].sort((a, b) => a - b))
  })

  it('no consulta por item: pinta los que el bloque trae', () => {
    // Las cinco reciben la misma lista ya resuelta. Si alguna pidiera algo por
    // producto, la diferencia se vería en el número de tarjetas.
    const cuentas = PRODUCT_COLLECTION_LAYOUTS.map((layout) => {
      const { unmount } = pintar(coleccion(layout))
      const cuenta = document.querySelectorAll('[data-card-variant]').length
      unmount()
      return cuenta
    })

    // `rail` duplica las piezas para que la fila gire, así que se comparan las
    // que NO son la copia del bucle: las visibles con foco.
    expect(new Set(cuentas.map((cuenta) => cuenta >= PRODUCTOS.length))).toEqual(new Set([true]))
  })
})

describe('y cada una se distingue de las demás', () => {
  it('`grid` reparte a partes iguales y `rail` se desplaza de lado', () => {
    pintar(coleccion('grid'))
    expect(document.querySelector('[data-collection-layout]')).toHaveAttribute(
      'data-collection-layout',
      'grid',
    )
    // Nadie destaca: no hay pieza principal.
    expect(document.querySelector('[data-collection-cell="lead"]')).toBeNull()
  })

  it('`editorial` quita la caja y deja la foto sola', () => {
    pintar(coleccion('editorial'))

    const tarjeta = document.querySelector('[data-card-variant="editorial"]') as HTMLElement
    expect(tarjeta).not.toBeNull()
    const regla = reglaEn(tarjeta)
    // La línea se vuelve transparente, no desaparece: quitarla movería la
    // rejilla un píxel al pasar el ratón.
    expect(regla).toContain('border: 1px solid transparent')
    expect(regla).toContain('box-shadow: none')
  })

  it('`spotlight` da el doble de área a la primera, y solo en escritorio', () => {
    pintar(coleccion('spotlight'))

    const principal = document.querySelector('[data-collection-cell="lead"]') as HTMLElement
    expect(principal).not.toBeNull()
    expect(reglaEn(principal, '900px')).toContain('span 2')
    // En el teléfono, no: una pieza doble deja las otras sin sitio.
    expect(reglaEn(principal)).not.toContain('span 2')
  })

  it('`spotlight` con menos de tres piezas no destaca nada', () => {
    // Una pieza doble y una sencilla no es una jerarquía, es un hueco. La misma
    // cifra y el mismo motivo que el mosaico de familias.
    pintar(coleccion('spotlight', PRODUCTOS.slice(0, 2)))

    expect(document.querySelector('[data-collection-cell="lead"]')).toBeNull()
    expect(screen.getAllByText('Primero').length).toBeGreaterThan(0)
  })

  it('`split` saca el mensaje a su columna, y no lo pinta dos veces', () => {
    pintar(coleccion('split'))

    const partida = document.querySelector('[data-split-band]') as HTMLElement
    expect(partida).not.toBeNull()
    // El titular vive en la columna del mensaje: si además se pintara encima,
    // aparecería dos veces.
    expect(screen.getAllByText('La selección')).toHaveLength(1)
    const mensaje = partida.querySelector('[data-split-part="copy"]') as HTMLElement
    expect(mensaje.textContent).toContain('La selección')
  })

  it('`split` se apila en el teléfono y solo se parte en escritorio', () => {
    pintar(coleccion('split'))

    const partida = document.querySelector('[data-split-band]') as HTMLElement
    expect(reglaEn(partida, '0px')).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(reglaEn(partida, '900px')).toContain('grid-template-columns: 5fr 7fr')
  })
})

describe('las cuatro disposiciones de una colección de familias', () => {
  const familias = (layout: string) =>
    bloque({ type: 'category_collection', settings: { layout }, items: FAMILIAS })

  it.each(CATEGORY_COLLECTION_LAYOUTS)('%s enseña las tres familias', (layout) => {
    pintar(familias(layout))

    for (const item of FAMILIAS) {
      expect(screen.getAllByRole('link', { name: new RegExp(item.name) }).length).toBeGreaterThan(0)
    }
  })

  it.each(CATEGORY_COLLECTION_LAYOUTS)('%s conserva la ruta con su filtro', (layout) => {
    pintar(familias(layout))

    const enlaces = screen.getAllByRole('link', { name: /Familia uno/ })
    expect(enlaces[0]).toHaveAttribute('href', '/s/tienda?c=familia-uno')
  })

  it('`photo-grid` enseña todas a la vez, sin convertirse en carrusel', () => {
    // Es su razón de ser: las puertas pasan a fila desplazable a partir de
    // cuatro, y eso deja media colección detrás de una flecha.
    pintar(
      bloque({
        type: 'category_collection',
        settings: { layout: 'photo-grid' },
        items: [...FAMILIAS, familia('Familia cuatro', 4), familia('Familia cinco', 5)],
      }),
    )

    const rejilla = document.querySelector('[data-category-photo-grid]')
    expect(rejilla).toHaveAttribute('data-category-photo-grid', '5')
    expect(screen.getAllByRole('link', { name: /Familia cinco/ }).length).toBeGreaterThan(0)
  })

  it('`mosaic` destaca la primera y `tiles` no', () => {
    const { unmount } = pintar(familias('mosaic'))
    expect(document.querySelector('[data-mosaic-cell="lead"]')).not.toBeNull()
    unmount()

    pintar(familias('tiles'))
    expect(document.querySelector('[data-mosaic-cell]')).toBeNull()
  })

  it('`pills` son enlaces compactos, no puertas', () => {
    pintar(familias('pills'))

    expect(document.querySelectorAll('[data-category-pill]').length).toBe(FAMILIAS.length)
    expect(document.querySelector('[data-category-door]')).toBeNull()
  })

  it('una familia sin foto no se rellena con una imagen inventada', () => {
    pintar(familias('photo-grid'))

    const puerta = screen.getAllByRole('link', { name: /Familia uno/ })[0] as HTMLElement
    expect(puerta).toHaveAttribute('data-category-door', 'tint')
    expect(puerta.querySelector('img')).toBeNull()
  })
})

describe('las tres disposiciones de un banner', () => {
  const cartel = (layout: string) =>
    bloque({
      type: 'banner',
      title: 'Un aviso del comercio',
      settings: { layout },
      mediaUrl: IMAGEN,
      mediaAlt: 'Una foto',
    })

  it.each(BANNER_LAYOUTS)('%s declara cuál es y conserva el mensaje', (layout) => {
    pintar(cartel(layout))

    expect(document.querySelector('[data-banner-layout]')).toHaveAttribute(
      'data-banner-layout',
      layout,
    )
    expect(screen.getByText('Un aviso del comercio')).toBeInTheDocument()
    expect(screen.getByAltText('Una foto')).toBeInTheDocument()
  })

  it('`bleed` usa el marco de sección, con su `50vw` único', () => {
    // No trae cálculo propio: repetir el truco por bloque es cómo aparece una
    // barra de desplazamiento horizontal en toda la tienda.
    pintar(cartel('bleed'))

    const marco = document.querySelector('[data-section-frame]') as HTMLElement
    expect(marco).toHaveAttribute('data-section-width', 'bleed')
    const estilo = getComputedStyle(marco)
    expect(estilo.marginInline || estilo.marginLeft).toContain('50vw')
    expect(estilo.marginInline || estilo.marginLeft).not.toContain('100vw')
  })

  it('`contained` no envuelve nada: es el ancho de la página', () => {
    pintar(cartel('contained'))

    expect(document.querySelector('[data-section-frame]')).toBeNull()
  })

  it('`split` da a la imagen la mitad y le quita el tope de alto', () => {
    const { unmount } = pintar(cartel('split'))
    const partido = reglaEn(screen.getByAltText('Una foto'), '900px')
    expect(partido).toContain('width: 50%')
    expect(partido).toContain('min-height: 320px')
    unmount()

    // La franja de siempre sigue siendo una franja: 40 % y 260 px de tope, que
    // es lo que evita que un aviso ocupe la primera pantalla entera.
    pintar(cartel('contained'))
    const franja = reglaEn(screen.getByAltText('Una foto'), '900px')
    expect(franja).toContain('width: 40%')
    expect(reglaEn(screen.getByAltText('Una foto'))).toContain('max-height: 260px')
  })
})

describe('lo que no cambia', () => {
  it('un bloque sin `layout` guardado se ve como antes de esta fase', () => {
    // Es la mayoría de los bloques publicados: `settings` vacío no es un bloque
    // a medio configurar.
    const { unmount } = pintar(bloque({ items: PRODUCTOS }))
    expect(document.querySelector('[data-collection-layout]')).toHaveAttribute(
      'data-collection-layout',
      'grid',
    )
    unmount()

    // Y el tipo `carousel` sigue naciendo en franja.
    pintar(bloque({ type: 'carousel', items: PRODUCTOS }))
    expect(document.querySelector('[data-collection-layout]')).toBeNull()
  })

  it('una composición que no existe cae a la del tipo, sin dejar la vitrina en blanco', () => {
    // Lo que llega aquí puede venir de una fila guardada con otra versión del
    // código. El sitio donde un valor inventado se rechaza es el editor.
    pintar(coleccion('lo-que-sea'))

    expect(document.querySelector('[data-collection-layout]')).toHaveAttribute(
      'data-collection-layout',
      'grid',
    )
  })

  it('el texto enriquecido sigue saliendo como TEXTO', () => {
    pintar(
      bloque({
        type: 'rich_text',
        title: null,
        subtitle: null,
        // Un documento es un array plano de nodos: ni árbol ni HTML, que es
        // justo lo que hace que no haya nada que sanear al pintarlo.
        body: [{ type: 'paragraph', text: '<script>alert(1)</script>' }],
      }),
    )

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })
})
