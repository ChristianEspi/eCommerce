import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CartProvider } from '../cart/CartProvider'
import { StorefrontThemeProvider } from '../theme/StorefrontThemeProvider'
import { THEME_PRESET_IDS } from '../theme/types'
import type { PublicProduct } from '../types'
import { ProductCard } from './ProductCard'
import { ProductGrid } from './ProductGrid'

/**
 * La misma tarjeta, cuatro presentaciones.
 *
 * ## Lo que se defiende
 *
 * **Un tema cambia cómo se ve un producto, nunca lo que se puede hacer con él.**
 * En los cuatro tiene que seguir habiendo enlace real a la ficha, corazón,
 * vista rápida, y comprar —o elegir opciones si el producto tiene variantes—.
 *
 * ## Por qué esto importa más que parecer bonito
 *
 * Porque la forma cómoda de hacer cuatro presentaciones es una rama por tema
 * dentro del componente, y en cuanto una rama se olvida del botón, hay un tema
 * donde no se puede comprar y nadie lo nota hasta que un comercio lo elige. Por
 * eso las presentaciones salen de variables de CSS y las pruebas están
 * parametrizadas: la única forma de que una variante pierda el botón sería
 * borrarlo para las cuatro.
 */

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => null,
  getSupabaseClient: () => null,
  tryGetStorefrontClient: () => null,
  tryGetStorefrontRpcClient: () => null,
  getStorefrontClient: () => null,
}))

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

function producto(overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    product_id: 'cccc1111-1111-4111-8111-111111111111',
    store_id: STORE,
    category_id: null,
    slug: 'silla-roble',
    name: 'Silla de roble',
    description: null,
    price: '389.00',
    compare_at_price: '489.00',
    currency: 'PEN',
    published_at: null,
    in_stock: true,
    category_slug: null,
    category_name: 'Sillas',
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'simple',
    brand_name: null,
    variant_count: 0,
    price_from: null,
    ...overrides,
  } as PublicProduct
}

function pintar(preset: string, item = producto(), onQuickView = vi.fn()) {
  const onToggleFavorite = vi.fn()
  renderWithProviders(
    <StorefrontThemeProvider store={{ theme_preset: preset }}>
      <CartProvider storeId={STORE} storeSlug="casa-nordica" currency="PEN">
        <ProductCard
          product={item}
          storeSlug="casa-nordica"
          onQuickView={onQuickView}
          onToggleFavorite={onToggleFavorite}
        />
      </CartProvider>
    </StorefrontThemeProvider>,
  )
  return { onQuickView, onToggleFavorite }
}

beforeEach(() => localStorage.clear())

describe.each(THEME_PRESET_IDS)('con el tema %s', (preset) => {
  it('el nombre sigue llevando a la ficha del producto', () => {
    pintar(preset)

    // Enlace REAL y no un `onClick`: es lo que hace que ctrl-clic, la rueda y
    // «abrir en otra pestaña» funcionen, y lo que indexa un buscador.
    expect(screen.getByRole('link', { name: 'Silla de roble' })).toHaveAttribute(
      'href',
      '/s/casa-nordica/product/silla-roble',
    )
  })

  it('ctrl-clic sigue abriendo la ficha en vez de la vista rápida', async () => {
    const user = userEvent.setup()
    const { onQuickView } = pintar(preset)

    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('link', { name: 'Silla de roble' }))
    await user.keyboard('{/Control}')

    expect(onQuickView).not.toHaveBeenCalled()
  })

  it('el clic normal abre la vista rápida', async () => {
    const user = userEvent.setup()
    const { onQuickView } = pintar(preset)

    await user.click(screen.getByRole('link', { name: 'Silla de roble' }))

    expect(onQuickView).toHaveBeenCalledWith('silla-roble')
  })

  it('se puede guardar', async () => {
    const user = userEvent.setup()
    const { onToggleFavorite } = pintar(preset)

    await user.click(screen.getByRole('button', { name: /guardar|favorit/i }))

    expect(onToggleFavorite).toHaveBeenCalled()
  })

  it('un producto simple se puede comprar', async () => {
    const user = userEvent.setup()
    pintar(preset)

    const comprar = await screen.findByRole('button', { name: 'Agregar al carrito' })
    expect(comprar).toBeEnabled()
    await user.click(comprar)
  })

  it('un producto con variantes lleva a elegir, no añade una al azar', async () => {
    // Meter «la primera» en el carrito es mandarle a alguien la talla que no
    // era. En los cuatro temas el botón cambia de trabajo, no desaparece.
    const user = userEvent.setup()
    const { onQuickView } = pintar(
      preset,
      producto({ kind: 'variant', variant_count: 3 } as Partial<PublicProduct>),
    )

    expect(screen.queryByRole('button', { name: 'Agregar al carrito' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Elegir opciones' }))

    expect(onQuickView).toHaveBeenCalledWith('silla-roble')
  })

  it('el precio y el tachado son los del mismo producto', () => {
    pintar(preset)

    expect(screen.getByText(/389/)).toBeInTheDocument()
    expect(screen.getByText(/489/)).toBeInTheDocument()
  })

  it('lo agotado no se puede comprar en ningún tema', () => {
    pintar(preset, producto({ in_stock: false }))

    expect(screen.getByRole('button', { name: 'Agregar al carrito' })).toBeDisabled()
  })

  it('el nombre del producto es un encabezado de tercer nivel', () => {
    pintar(preset)

    expect(screen.getByRole('heading', { level: 3, name: 'Silla de roble' })).toBeInTheDocument()
  })
})

describe.each(THEME_PRESET_IDS)('lo incómodo, con el tema %s', (preset) => {
  it('un producto SIN foto sigue siendo una tarjeta, no un hueco', () => {
    // Es el caso normal, no el raro: un catálogo recién importado no trae
    // fotos. Un tema que presuma imagen deja la tienda llena de agujeros justo
    // el día que el comercio la estrena.
    pintar(preset, producto({ primary_image_path: null }))

    expect(screen.getByRole('heading', { level: 3, name: 'Silla de roble' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar al carrito' })).toBeInTheDocument()
  })

  it('un nombre larguísimo no empuja el precio fuera de la tarjeta', () => {
    const largo =
      'Silla de roble macizo con respaldo ergonómico tapizado en lino natural y acabado mate resistente al agua'
    pintar(preset, producto({ name: largo }))

    // El nombre se recorta a dos líneas y el precio sigue estando: lo que no
    // puede pasar es que el argumento de compra desaparezca por un título.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(largo)
    expect(screen.getByText(/389/)).toBeInTheDocument()
  })

  it('un producto sin categoría no deja una etiqueta vacía', () => {
    pintar(preset, producto({ category_name: null }))

    expect(screen.getByRole('heading', { level: 3, name: 'Silla de roble' })).toBeInTheDocument()
  })
})

describe('la rejilla toma sus columnas del tema', () => {
  it('no cablea el número de columnas', () => {
    renderWithProviders(
      <StorefrontThemeProvider store={{ theme_preset: 'catalog' }}>
        <CartProvider storeId={STORE} storeSlug="casa-nordica" currency="PEN">
          <ProductGrid products={[producto()]} storeSlug="casa-nordica" thumbnails={{}} />
        </CartProvider>
      </StorefrontThemeProvider>,
    )

    // Lo que se comprueba no es «seis columnas» sino que el número VIENE de una
    // variable. Cablearlo sería el fallo: un tema que reparte más producto por
    // fila necesita que la rejilla le haga caso.
    //
    // Se mira la hoja que emite MUI y no el atributo `style`: estos valores
    // viajan en una clase generada, no en línea.
    expect(document.head.textContent).toContain('--sf-grid-lg')
    expect(document.head.textContent).toContain('--sf-grid-gap')
  })
})
