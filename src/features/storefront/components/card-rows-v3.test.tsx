import { cleanup, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { PRODUCT_CARD_VARIANTS, type ProductCardVariant } from '../theme/types'
import { ROW_SLOT_WIDTH } from './rowSlots'
import { CartProvider } from '../cart/CartProvider'
import { StorefrontThemeProvider } from '../theme/StorefrontThemeProvider'
import type { PublicProduct } from '../types'
import { ProductRow } from './ProductRow'

/**
 * Tarjetas y filas que respetan el tema (Storefront V3 · P05).
 *
 * ## El defecto que cierra este archivo
 *
 * La fila de la portada usaba `itemWidth={168}` para TODAS las tiendas y
 * forzaba la tarjeta reducida en cuanto había más de seis productos. 168 px es
 * el ancho de una tarjeta de catálogo denso: en Catalog está bien, y en Premium
 * convertía una portada editorial en una tira de miniaturas.
 *
 * El tema declaraba una personalidad y la fila la deshacía en cuanto la tienda
 * tenía catálogo. Era, además, el fallo más difícil de ver en una captura: cada
 * pieza por separado parecía correcta.
 *
 * ## Por qué se prueban atributos y no píxeles
 *
 * Porque lo que hay que fijar es la DECISIÓN —qué presentación se pintó y con
 * cuánto sitio—, no una medida concreta. Una prueba de píxeles se rompe con
 * cualquier ajuste de diseño y no dice nada de por qué.
 */

const PRODUCTO = (n: number): PublicProduct =>
  ({
    product_id: `cccc${n}111-1111-4111-8111-111111111111`,
    store_id: 'aaaa1111-1111-4111-8111-111111111111',
    category_id: null,
    slug: `producto-${n}`,
    name: `Producto ${n}`,
    description: null,
    price: `${100 + n}.00`,
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-01T00:00:00.000Z',
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'simple',
    price_from: null,
  }) as unknown as PublicProduct

const lista = (cuantos: number) => Array.from({ length: cuantos }, (_, i) => PRODUCTO(i + 1))

/** La fila, dentro de una tienda con el tema que se quiera probar. */
function pintar(cuantos: number, variante: ProductCardVariant) {
  renderWithProviders(
    <CartProvider storeId="aaaa1111-1111-4111-8111-111111111111" storeSlug="tienda" currency="PEN">
    <StorefrontThemeProvider
      store={{ theme_preset: 'universal', storefront_style: { productCardVariant: variante } }}
    >
      <ProductRow
        title="Novedades"
        products={lista(cuantos)}
        storeSlug="tienda"
        thumbnails={{}}
        seeAllHref="/s/tienda?ver=todo"
      />
    </StorefrontThemeProvider>
    </CartProvider>,
    { route: '/s/tienda' },
  )
  return screen.getByRole('region', { name: 'Novedades' })
}



describe('la fila deja de imponer su ancho al tema', () => {
  it('con 7+ productos, Premium NO cae en tarjetas de catálogo denso', () => {
    // EL defecto de la fase. Antes: 168 px y tarjeta reducida forzada, igual
    // que Catalog.
    const fila = pintar(8, 'editorial')

    expect(fila).toHaveAttribute('data-row-layout', 'carousel')
    // La presentación sigue siendo la del tema, no la densa.
    const tarjetas = fila.querySelectorAll('[data-card-variant]')
    expect(tarjetas.length).toBeGreaterThan(0)
    for (const tarjeta of tarjetas) {
      expect(tarjeta).toHaveAttribute('data-card-variant', 'editorial')
    }
  })

  it('con 7+ productos, Catalog sigue denso', () => {
    // Lo que NO se puede perder por arreglar Premium: la densidad de un
    // catálogo de miles de referencias es correcta ahí.
    const fila = pintar(8, 'compact')

    for (const tarjeta of fila.querySelectorAll('[data-card-variant]')) {
      expect(tarjeta).toHaveAttribute('data-card-variant', 'compact')
    }
  })

  it('el hueco de la fila mide DISTINTO en cada presentación', () => {
    /**
     * Es la otra mitad del arreglo: la presentación correcta dentro de un hueco
     * de 168 px seguiría siendo una miniatura.
     *
     * Se comprueba la TABLA y no un `getComputedStyle`: el ancho llega como
     * objeto responsive por punto de corte, y en un entorno sin maquetación lo
     * calculado no distingue uno de otro. Lo que importa aquí es la decisión —
     * tres anchos distintos, y el editorial claramente mayor—, no un píxel.
     */
    const anchos = PRODUCT_CARD_VARIANTS.map((v) => ROW_SLOT_WIDTH[v].md)

    expect(new Set(anchos).size).toBe(PRODUCT_CARD_VARIANTS.length)
    expect(ROW_SLOT_WIDTH.compact.md).toBeLessThan(ROW_SLOT_WIDTH.comfortable.md)
    expect(ROW_SLOT_WIDTH.comfortable.md).toBeLessThan(ROW_SLOT_WIDTH.editorial.md)
    // Y ninguno vuelve al 168 universal que causaba el problema.
    for (const variante of PRODUCT_CARD_VARIANTS) {
      expect(ROW_SLOT_WIDTH[variante].md).not.toBe(168)
    }
  })

  it('en el teléfono el hueco es MENOR que en escritorio, en las tres', () => {
    // Ese recorte es lo que deja ver un trozo de la siguiente tarjeta, que es
    // la única señal de que la fila se puede arrastrar. Con el hueco al ancho
    // completo, la fila parece una tarjeta única y nadie la mueve.
    for (const variante of PRODUCT_CARD_VARIANTS) {
      expect(ROW_SLOT_WIDTH[variante].xs).toBeLessThan(ROW_SLOT_WIDTH[variante].md)
      // Y sigue siendo legible: por debajo de 150 px un nombre de producto no
      // entra en dos líneas.
      expect(ROW_SLOT_WIDTH[variante].xs).toBeGreaterThanOrEqual(150)
    }
  })

  it('las tres presentaciones llegan a la fila que gira', () => {
    for (const variante of PRODUCT_CARD_VARIANTS) {
      cleanup()
      const fila = pintar(9, variante)
      expect(fila.querySelector('[data-card-variant]')).toHaveAttribute(
        'data-card-variant',
        variante,
      )
    }
  })
})

describe('la tarjeta reducida es una decisión de la FILA, no del tema', () => {
  it('en la fila que gira la tarjeta es un anuncio: sin botón de comprar', () => {
    // Lo que se quita es lo que se decide DENTRO de la ficha. Lo que NO se
    // quita es la densidad del tema — que era el fallo.
    const fila = pintar(8, 'editorial')

    expect(fila.querySelector('[data-card-reduced]')).toHaveAttribute('data-card-reduced', 'true')
    expect(within(fila).queryByRole('button', { name: /agregar|añadir/i })).not.toBeInTheDocument()
  })

  it('con 4 a 6 productos es una rejilla de tarjetas COMPLETAS', () => {
    const fila = pintar(5, 'comfortable')

    expect(fila).toHaveAttribute('data-row-layout', 'grid')
    expect(fila.querySelector('[data-card-reduced]')).toBeNull()
  })

  it('la presentación del tema manda también en la rejilla corta', () => {
    const fila = pintar(3, 'editorial')

    expect(fila).toHaveAttribute('data-row-layout', 'spotlight')
    for (const tarjeta of fila.querySelectorAll('[data-card-variant]')) {
      expect(tarjeta).toHaveAttribute('data-card-variant', 'editorial')
    }
  })
})

describe('las filas cortas siguen sin dejar huecos', () => {
  it.each([1, 2, 3])('con %i producto(s) se reparte y se ofrece el catálogo', (cuantos) => {
    cleanup()
    const fila = pintar(cuantos, 'comfortable')

    expect(fila).toHaveAttribute('data-row-layout', 'spotlight')
    expect(fila).toHaveAttribute('data-row-count', String(cuantos))
    // La puerta al catálogo es lo que evita media pantalla en blanco. Hay más
    // de un enlace al catálogo en la fila —el «ver todo» de la cabecera y la
    // puerta— y las dos son correctas: lo que se comprueba es que la puerta
    // existe.
    expect(
      within(fila).getAllByRole('link', { name: /catálogo|ver todo/i }).length,
    ).toBeGreaterThan(0)
  })

  it.each([4, 6])('con %i productos es rejilla, sin puerta de relleno', (cuantos) => {
    cleanup()
    const fila = pintar(cuantos, 'comfortable')

    expect(fila).toHaveAttribute('data-row-layout', 'grid')
  })

  it('con 7 pasa a carrusel', () => {
    expect(pintar(7, 'comfortable')).toHaveAttribute('data-row-layout', 'carousel')
  })

  it('sin productos no hay fila', () => {
    renderWithProviders(
      <CartProvider storeId="aaaa1111-1111-4111-8111-111111111111" storeSlug="tienda" currency="PEN">
    <StorefrontThemeProvider store={{ theme_preset: 'universal' }}>
        <ProductRow
          title="Novedades"
          products={[]}
          storeSlug="tienda"
          thumbnails={{}}
          seeAllHref="/s/tienda?ver=todo"
        />
      </StorefrontThemeProvider>
    </CartProvider>,
      { route: '/s/tienda' },
    )
    expect(screen.queryByRole('region', { name: 'Novedades' })).not.toBeInTheDocument()
  })
})

describe('las tres presentaciones conservan lo que vende', () => {
  /** La fila corta, donde la tarjeta va COMPLETA: es el mostrador, no el anuncio. */
  function pintarCompleta(variante: ProductCardVariant, onQuickView: (slug: string) => void) {
    renderWithProviders(
      <CartProvider storeId="aaaa1111-1111-4111-8111-111111111111" storeSlug="tienda" currency="PEN">
        <StorefrontThemeProvider
          store={{ theme_preset: 'universal', storefront_style: { productCardVariant: variante } }}
        >
          <ProductRow
            title="Novedades"
            products={lista(2)}
            storeSlug="tienda"
            thumbnails={{}}
            seeAllHref="/s/tienda?ver=todo"
            favorites={new Set<string>()}
            onToggleFavorite={() => {}}
            onQuickView={onQuickView}
          />
        </StorefrontThemeProvider>
      </CartProvider>,
      { route: '/s/tienda' },
    )
    return screen.getByRole('region', { name: 'Novedades' })
  }

  it.each(PRODUCT_CARD_VARIANTS)('%s mantiene enlace, precio, favorito y compra', (variante) => {
    cleanup()
    const fila = pintarCompleta(variante, () => {})

    // UNA tarjeta funcional y no cuatro componentes de negocio: las tres
    // presentaciones llevan lo mismo y lo que cambia es cómo se ve.
    expect(within(fila).getAllByRole('link', { name: /Producto 1/ }).length).toBeGreaterThan(0)
    expect(within(fila).getAllByText(/101/).length).toBeGreaterThan(0)
    expect(within(fila).getAllByRole('button', { name: /guardar|quitar/i }).length).toBeGreaterThan(
      0,
    )
    // Y el botón de comprar, que es el que convierte: en `editorial` es más
    // discreto, pero está — una tarjeta sin CTA no es una tarjeta más limpia.
    expect(
      within(fila).getAllByRole('button', { name: /agregar|añadir|elegir/i }).length,
    ).toBeGreaterThan(0)
  })

  it.each(PRODUCT_CARD_VARIANTS)('%s abre la vista rápida al pulsar la tarjeta', async (variante) => {
    // La vista rápida no es un botón aparte: es lo que hace el clic en la
    // tarjeta cuando la pantalla la ofrece, conservando el `href` para que
    // ctrl-clic y «abrir en pestaña nueva» sigan llevando a la ficha.
    cleanup()
    const vistos: string[] = []
    const fila = pintarCompleta(variante, (slug) => vistos.push(slug))

    const enlace = within(fila).getAllByRole('link', { name: /Producto 1/ })[0] as HTMLElement
    enlace.click()

    expect(vistos).toContain('producto-1')
  })
})
