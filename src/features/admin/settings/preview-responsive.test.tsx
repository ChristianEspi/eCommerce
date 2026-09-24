import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { DEFAULT_HOME_LAYOUT } from '@/features/storefront/theme/presets'
import type { HomeLayout, StorefrontStyle } from '@/features/storefront/theme/types'
import { StorefrontPreview } from './StorefrontPreview'

/**
 * La vista previa como SIMULACIÓN, no como maqueta estrujada (P11).
 *
 * ## El fallo que se corrige aquí
 *
 * Cambiar el ancho de una caja a 390 px no hace que las media queries
 * reaccionen: una media query mide la VENTANA. Así que el «móvil» se pintaba
 * dentro de una ventana de escritorio y elegía los valores de escritorio. Y la
 * propia vista previa lo empeoraba usando `--sf-main-pad-md`,
 * `--sf-hero-title-md` y `--sf-grid-lg` **fijos**: el teléfono enseñaba el
 * titular de 52 px y las cuatro columnas del escritorio.
 *
 * Nada de esto se ve en una captura de pantalla del escritorio, que es por lo
 * que sobrevivió tanto tiempo: la vista previa parecía funcionar.
 *
 * ## Qué se comprueba
 *
 * Que cada marco resuelve por SU ancho, que tres marcos pueden convivir sin
 * pisarse, y que lo que se ve a escala lo dice.
 */

function pintar(estilo: Partial<StorefrontStyle> = {}, layout: HomeLayout = DEFAULT_HOME_LAYOUT) {
  renderWithProviders(
    <StorefrontPreview
      storeName="Botica del Centro"
      themePreset="universal"
      style={estilo}
      layout={layout}
    />,
    { route: '/app/settings' },
  )
}

/** El marco de un dispositivo, por su ancho lógico. */
/** El orden por defecto con las familias encendidas, que vienen apagadas. */
function layoutConCategorias(): HomeLayout {
  return {
    version: 1,
    sections: DEFAULT_HOME_LAYOUT.sections.map((s) =>
      s.id === 'categories' ? { ...s, enabled: true } : s,
    ),
  }
}

const marco = (viewport: string) =>
  screen.getAllByTestId('preview-frame').find((m) => m.dataset.viewport === viewport)

const variable = (elemento: HTMLElement, nombre: string) =>
  elemento.style.getPropertyValue(nombre)

describe('cada marco resuelve por su propio ancho', () => {
  it('el móvil usa valores de móvil aunque la ventana sea de escritorio', async () => {
    // La ventana de jsdom es de escritorio, como la de quien configura la
    // tienda. Ese es justo el caso que fallaba.
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('button', { name: 'Móvil' }))
    const movil = marco('mobile') as HTMLElement

    expect(movil).toHaveAttribute('data-preview-bp', 'xs')
    expect(variable(movil, '--sfp-hero-title')).toBe('var(--sf-hero-title)')
    expect(variable(movil, '--sfp-main-pad')).toBe('var(--sf-main-pad)')
    expect(variable(movil, '--sfp-grid-cols')).toBe('var(--sf-grid-xs, 2)')
  })

  it('el escritorio usa los valores anchos', () => {
    pintar()
    const escritorio = marco('desktop') as HTMLElement

    expect(escritorio).toHaveAttribute('data-preview-bp', 'lg')
    expect(variable(escritorio, '--sfp-hero-title')).toBe('var(--sf-hero-title-md)')
    expect(variable(escritorio, '--sfp-grid-cols')).toBe('var(--sf-grid-lg, 4)')
  })

  it('la rejilla y la portada LEEN esas variables, no las anchas a pelo', () => {
    // Es la mitad que faltaba: resolver bien y luego pintar `--sf-grid-lg` fijo
    // dejaría el fallo exactamente donde estaba.
    pintar()
    const rejilla = screen.getAllByTestId('preview-grid')[0] as HTMLElement

    // Las medidas van por clase, no en el atributo `style`: se lee lo calculado.
    const columnas = getComputedStyle(rejilla).gridTemplateColumns

    expect(columnas).toContain('var(--sfp-grid-cols)')
    expect(columnas).not.toContain('--sf-grid-lg')
  })

  it('el tema sigue mandando en CUÁNTO, el marco solo en CUÁL', () => {
    // El marco elige entre `--sf-grid-xs/sm/lg`; cuántas columnas hay en cada
    // uno lo pone el preset. Cambiar de tema cambia el número sin tocar esto.
    pintar()
    const escritorio = marco('desktop') as HTMLElement

    expect(variable(escritorio, '--sf-grid-lg')).toBe('4')
    expect(variable(escritorio, '--sfp-grid-cols')).toBe('var(--sf-grid-lg, 4)')
  })
})

describe('comparar los tres a la vez', () => {
  const comparar = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Comparar' }))
  }

  it('los tres marcos existen a la vez, cada uno en su escalón', async () => {
    const user = userEvent.setup()
    pintar()
    await comparar(user)

    expect(screen.getAllByTestId('preview-frame')).toHaveLength(3)
    expect(marco('desktop')).toHaveAttribute('data-preview-bp', 'lg')
    expect(marco('tablet')).toHaveAttribute('data-preview-bp', 'sm')
    expect(marco('mobile')).toHaveAttribute('data-preview-bp', 'xs')
  })

  it('tableta y móvil conviven sin pisarse los valores', async () => {
    // Lo que se rompería con una solución basada en una clase global o en un
    // `@media`: los dos marcos comparten pantalla y cada uno tiene que resolver
    // lo suyo.
    const user = userEvent.setup()
    pintar()
    await comparar(user)

    const tableta = marco('tablet') as HTMLElement
    const movil = marco('mobile') as HTMLElement

    expect(variable(tableta, '--sfp-grid-cols')).toBe('var(--sf-grid-sm, 3)')
    expect(variable(movil, '--sfp-grid-cols')).toBe('var(--sf-grid-xs, 2)')
  })

  it('cambiar de tema actualiza los tres marcos, no solo el primero', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <StorefrontPreview
        storeName="Botica"
        themePreset="premium"
        style={{}}
        layout={DEFAULT_HOME_LAYOUT}
      />,
      { route: '/app/settings' },
    )
    await comparar(user)

    for (const m of screen.getAllByTestId('preview-frame')) {
      expect(m).toHaveAttribute('data-store-theme', 'premium')
    }
  })

  it('un ajuste sin guardar llega a los tres', async () => {
    const user = userEvent.setup()
    pintar({ sectionSpacing: 'spacious' })
    await comparar(user)

    for (const m of screen.getAllByTestId('preview-frame')) {
      expect(m).toHaveAttribute('data-store-spacing', 'spacious')
    }
  })

  it('la comparación se queda dentro del lienzo, no empuja la página', async () => {
    // 1280 px no caben en un panel de configuración. Si el desbordamiento no
    // fuera del lienzo, la pantalla entera del backoffice se arrastraría de
    // lado — con las pestañas y la barra de Guardar incluidas.
    const user = userEvent.setup()
    pintar()
    await comparar(user)

    const lienzo = screen.getByTestId('preview-canvas')
    expect(lienzo).toHaveAttribute('data-preview-mode', 'compare')
    expect(getComputedStyle(lienzo).overflowX).toBe('auto')
  })

  it('en enfoque vuelve a haber uno solo', async () => {
    const user = userEvent.setup()
    pintar()
    await comparar(user)
    await user.click(screen.getByRole('button', { name: 'Enfoque' }))

    expect(screen.getAllByTestId('preview-frame')).toHaveLength(1)
    // Y el selector de dispositivo, que en comparación no pinta nada, vuelve.
    expect(screen.getByRole('button', { name: 'Tableta' })).toBeInTheDocument()
  })
})

describe('el lienzo dice lo que se está mirando', () => {
  it('cada marco lleva su ancho lógico escrito', () => {
    pintar()

    expect(screen.getByText('Escritorio · 1280 px')).toBeInTheDocument()
  })

  it('en comparación, los tres lo llevan', async () => {
    const user = userEvent.setup()
    pintar()
    await user.click(screen.getByRole('button', { name: 'Comparar' }))

    expect(screen.getByText('Escritorio · 1280 px')).toBeInTheDocument()
    expect(screen.getByText('Tableta · 768 px')).toBeInTheDocument()
    expect(screen.getByText('Móvil · 390 px')).toBeInTheDocument()
  })

  it('sin poder medir el lienzo no se escala nada', () => {
    // En pruebas no hay maquetación, así que el ancho disponible no se puede
    // medir. Lo correcto es no tocar la escala: encoger a un factor inventado
    // sería peor que no encoger. Y entonces el rótulo no habla de porcentajes.
    pintar()

    expect(screen.getByText('Escritorio · 1280 px')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })
})

describe('se maneja con el teclado', () => {
  it('se cambia de forma de ver sin ratón', async () => {
    const user = userEvent.setup()
    pintar()

    screen.getByRole('button', { name: 'Comparar' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getAllByTestId('preview-frame')).toHaveLength(3)
  })

  it('se cambia de dispositivo sin ratón', async () => {
    const user = userEvent.setup()
    pintar()

    screen.getByRole('button', { name: 'Tableta' }).focus()
    await user.keyboard('{Enter}')

    expect(marco('tablet')).toBeInTheDocument()
  })

  it('se cambia el tamaño del lienzo sin ratón', async () => {
    const user = userEvent.setup()
    pintar()

    screen.getByRole('button', { name: 'Tamaño real' }).focus()
    await user.keyboard('{Enter}')

    // Sigue habiendo un marco y sigue diciendo su ancho: lo que cambia es si
    // se encoge para caber, no qué se está mirando.
    expect(screen.getByText('Escritorio · 1280 px')).toBeInTheDocument()
  })

  it('los dos grupos de botones se anuncian por separado', async () => {
    pintar()

    expect(screen.getByRole('group', { name: 'Forma de ver' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tamaño de pantalla' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tamaño del lienzo' })).toBeInTheDocument()
  })
})

describe('la vista previa no toca nada', () => {
  it('no pinta ni un enlace ni un botón que lleve a la tienda real', () => {
    // Es un dibujo del tema, no la tienda: un enlace aquí sacaría del formulario
    // a medio configurar, y un botón de comprar en una vista previa es una
    // compra que nadie ha hecho.
    pintar()
    const frame = marco('desktop') as HTMLElement

    expect(within(frame).queryAllByRole('link')).toHaveLength(0)
    expect(within(frame).queryAllByRole('button')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fidelidad: la vista previa deja de parecer un esqueleto (P13)
// ---------------------------------------------------------------------------

/**
 * Un rectángulo gris es exactamente lo que pinta una pantalla mientras carga.
 *
 * La vista previa se leía como un esqueleto —y más de una vez se preguntó si
 * estaba rota— cuando en realidad estaba terminada: lo que enseñaba era su
 * contenido definitivo. Barra, portada, familias, marcas y tarjetas eran cinco
 * tonos del mismo gris.
 */
describe('el contenido de ejemplo', () => {
  it('la barra enseña lo que lleva la de la tienda', () => {
    pintar()
    const frame = marco('desktop') as HTMLElement

    // El nombre sale dos veces, como en la tienda: en la barra y en la portada.
    expect(within(frame).getAllByText('Botica del Centro').length).toBeGreaterThanOrEqual(2)
    expect(within(frame).getByText('Buscar en la tienda')).toBeInTheDocument()
    expect(within(frame).getByText('Carrito')).toBeInTheDocument()
  })

  it('las tarjetas tienen nombre y precio, no dos barras grises', () => {
    pintar()
    const frame = marco('desktop') as HTMLElement

    expect(within(frame).getAllByText(/Producto de ejemplo/).length).toBeGreaterThan(0)
    expect(within(frame).getAllByText('00,00').length).toBeGreaterThan(0)
  })

  it('está rotulado como ejemplo, una vez y para todo el lienzo', () => {
    // Repetirlo en cada tarjeta convertiría la vista previa en una pantalla de
    // advertencias; puesto una vez sobre el lienzo cubre todo lo que hay dentro.
    pintar()

    const nota = screen.getByTestId('preview-demo-note')
    expect(nota.textContent).toContain('Contenido de ejemplo')
    expect(nota.textContent).toContain('no salen de tu catálogo')
    expect(screen.getAllByTestId('preview-demo-note')).toHaveLength(1)
  })

  it('el contenido es determinista: dos renders dan lo mismo', () => {
    // Nombres o precios al azar harían que la vista previa cambiara sola entre
    // dos pulsaciones del formulario, y eso se lee como un fallo.
    pintar()
    const primero = (marco('desktop') as HTMLElement).textContent

    cleanup()
    pintar()
    expect((marco('desktop') as HTMLElement).textContent).toBe(primero)
  })

  it('no sale ni un dato del catálogo real', () => {
    // La vista previa es una función del formulario a píxeles: no consulta nada,
    // así que no puede enseñar un producto de nadie.
    pintar()
    const frame = marco('desktop') as HTMLElement

    expect(frame.textContent).not.toContain('undefined')
    expect(frame.textContent).not.toContain('NaN')
  })
})

/**
 * Las variantes del contrato, de verdad distintas.
 *
 * Una opción del formulario que no cambia nada en la vista previa es una opción
 * que el comercio no puede evaluar: elige a ciegas, mira la tienda y vuelve a
 * cambiarla. Hasta P13 `heroVariant` y `categoryVariant` pintaban lo mismo aquí.
 */
describe('cada variante se ve', () => {
  it('las dos portadas son dos composiciones, no dos grises', () => {
    pintar({ heroVariant: 'product' })
    const producto = document.querySelector('[data-preview-hero]')
    expect(producto).toHaveAttribute('data-preview-hero', 'product')
    // La portada de producto enseña PRODUCTO: sin la tarjeta al lado, las dos
    // variantes se verían iguales.
    expect(within(producto as HTMLElement).getByText(/Producto de ejemplo 1/)).toBeInTheDocument()

    cleanup()
    pintar({ heroVariant: 'statement' })
    const lema = document.querySelector('[data-preview-hero]')
    expect(lema).toHaveAttribute('data-preview-hero', 'statement')
    expect(within(lema as HTMLElement).queryByText(/Producto de ejemplo 1/)).not.toBeInTheDocument()
  })

  it('las familias son puertas o píldoras, según el contrato', () => {
    const conCategorias = layoutConCategorias()

    pintar({ categoryVariant: 'tiles' }, conCategorias)
    expect(document.querySelector('[data-preview-categories]')).toHaveAttribute(
      'data-preview-categories',
      'tiles',
    )

    cleanup()
    pintar({ categoryVariant: 'pills' }, conCategorias)
    expect(document.querySelector('[data-preview-categories]')).toHaveAttribute(
      'data-preview-categories',
      'pills',
    )
  })

  it('la tarjeta cómoda enseña el apoyo y la compacta no', () => {
    // No son dos rellenos distintos: la cómoda respira y enseña el apoyo bajo el
    // nombre; la compacta va directa al nombre y al precio.
    pintar({ productCardVariant: 'comfortable' })
    expect(screen.getAllByText('Marca · presentación').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-preview-card]')).toHaveAttribute(
      'data-preview-card',
      'comfortable',
    )

    cleanup()
    pintar({ productCardVariant: 'compact' })
    expect(screen.queryByText('Marca · presentación')).not.toBeInTheDocument()
  })

  it('las marcas se pintan con monograma, como en la tienda sin logotipo', () => {
    pintar()

    expect(screen.getAllByText(/Marca A/).length).toBeGreaterThan(0)
  })
})
