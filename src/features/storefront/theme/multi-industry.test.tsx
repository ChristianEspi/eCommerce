import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Cuatro negocios distintos, el MISMO código.
 *
 * ## Qué demuestra este archivo
 *
 * Que el rubro del comercio no aparece en ninguna parte del programa. Lo que
 * cambia entre una tienda de ropa y una droguería mayorista son **sus datos y
 * su configuración**: el catálogo que subieron y el tema que eligieron. No hay
 * un `if (esFarmacia)`, no hay un `StoreHomeRetail`, y no existe un campo donde
 * el comercio declare a qué se dedica — porque en cuanto existiera, alguien
 * ramificaría por él y la quinta industria pediría la quinta copia.
 *
 * Los cuatro escenarios son los del plan: moda con `premium`, calzado y retail
 * general con `universal`, farmacia con `retail`, y distribuidor de catálogo
 * grande con `catalog`. Cada uno se monta con su propio catálogo y se comprueba
 * que la tienda funciona entera: identidad, búsqueda, productos, precio,
 * descuento, guardar, comprar y pie.
 *
 * ## Y lo que NO demuestra
 *
 * Que cada tema sea bonito para su rubro. Eso es una opinión de diseño y no se
 * puede afirmar con una prueba. Lo que sí se afirma es que ninguno de los
 * cuatro pierde una capacidad comercial por el camino, que es lo que
 * convertiría un tema en una tienda peor.
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
const { StoreHomePage } = await import('../StoreHomePage')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'

interface Escenario {
  rubro: string
  tema: string
  tienda: string
  lema: string
  categoria: string
  producto: string
  precio: string
  antes: string | null
}

/**
 * Los cuatro, como DATOS.
 *
 * Es la forma del archivo lo que prueba la tesis: si hiciera falta una rama por
 * rubro, esto no podría ser una tabla.
 */
const ESCENARIOS: readonly Escenario[] = [
  {
    rubro: 'moda y ropa',
    tema: 'premium',
    tienda: 'Atelier Norte',
    lema: 'Prendas hechas para durar',
    categoria: 'Abrigos',
    producto: 'Abrigo de lana',
    precio: '459.00',
    antes: '599.00',
  },
  {
    rubro: 'zapatería y retail general',
    tema: 'universal',
    tienda: 'Calzados Pepe',
    lema: 'Tu talla, siempre',
    categoria: 'Zapatillas',
    producto: 'Zapatilla urbana',
    precio: '189.00',
    antes: null,
  },
  {
    rubro: 'farmacia y droguería',
    tema: 'retail',
    tienda: 'Botica del Centro',
    lema: 'Salud cerca de casa',
    categoria: 'Cuidado personal',
    producto: 'Jarabe natural',
    precio: '19.90',
    antes: '29.90',
  },
  {
    rubro: 'abarrotes y distribución',
    tema: 'catalog',
    tienda: 'Distribuidora Sur',
    lema: 'Todo el surtido, en un sitio',
    categoria: 'Limpieza',
    producto: 'Detergente 5 kg',
    precio: '34.50',
    antes: null,
  },
]

function backend(
  e: Escenario,
  extra: {
    store?: Record<string, unknown>
    categorias?: Array<{ slug: string; name: string; image_url?: string; image_alt?: string }>
  } = {},
): FakeSupabase {
  const producto = {
    product_id: 'cccc1111-1111-4111-8111-111111111111',
    store_id: STORE,
    category_id: 'bbbb1111-1111-4111-8111-111111111111',
    slug: 'articulo',
    name: e.producto,
    description: null,
    price: e.precio,
    compare_at_price: e.antes,
    currency: 'PEN',
    published_at: '2026-08-01T00:00:00.000Z',
    in_stock: true,
    category_slug: 'familia',
    category_name: e.categoria,
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'simple',
  }

  return createFakeSupabase({
    tables: {
      public_stores: [
        {
          store_id: STORE,
          slug: 'tienda',
          name: e.tienda,
          currency: 'PEN',
          accent_color: '#056769',
          logo_url: null,
          white_label: false,
          default_locale: 'es',
          support_email: 'hola@tienda.demo',
          banner_url: null,
          hero_title: e.lema,
          hero_subtitle: null,
          contact_phone: null,
          contact_address: null,
          theme_preset: e.tema,
          ...extra.store,
        },
      ],
      public_categories: extra.categorias
        ? extra.categorias.map((c, i) => ({
            category_id: `bbbb${String(i + 2).padStart(4, '0')}-1111-4111-8111-111111111111`,
            store_id: STORE,
            parent_id: null,
            slug: c.slug,
            name: c.name,
            position: i + 1,
            // P03 · La foto es OPCIONAL: solo la trae quien la declara en el
            // escenario. El resto pinta tinte e icono, como antes de la fase.
            image_url: c.image_url ?? null,
            image_alt: c.image_alt ?? null,
          }))
        : [
            {
              category_id: producto.category_id,
              store_id: STORE,
              slug: 'familia',
              name: e.categoria,
              position: 1,
            },
          ],
      public_products: [producto],
      public_product_images: [],
    },
    rpc: {
      catalog_search_for_slug: () => ({
        items: [{ ...producto, id: producto.product_id }],
        total: 1,
        limit: 24,
        offset: 0,
        sort: 'relevance',
        mode: 'browse',
        query: null,
        facets: {
          categories: [],
          brands: [],
          attributes: [],
          price: { min: null, max: null },
          availability: { in_stock: 1, total: 1 },
        },
      }),
      catalog_suggest_for_slug: () => [],
      store_navigation_for_slug: () => [
        { slug: 'terminos', title: 'Términos y condiciones' },
      ],
      store_page_for_slug: () => ({
        cms: false,
        store_id: STORE,
        page: null,
        blocks: [],
        resolved_at: '2026-09-10T00:00:00.000Z',
      }),
    },
  })
}

async function abrir(e: Escenario, ruta = '/s/tienda', extra: Parameters<typeof backend>[1] = {}) {
  holder.client = backend(e, extra)
  renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
      </Route>
    </Routes>,
    { route: ruta },
  )
  await screen.findByRole('banner')
}

beforeEach(() => {
  holder.client = null
})

describe.each(ESCENARIOS)('$rubro con el tema $tema', (e) => {
  it('la tienda se presenta con su identidad, no con la de la suite', async () => {
    await abrir(e)

    expect(within(screen.getByRole('banner')).getByText(e.tienda)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('se puede buscar y navegar por familias', async () => {
    await abrir(e)

    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(await screen.findAllByText(e.categoria)).not.toHaveLength(0)
  })

  it('el producto se ve con su precio', async () => {
    await abrir(e, '/s/tienda?ver=todo')

    expect((await screen.findAllByText(e.producto)).length).toBeGreaterThan(0)
    const [entero, decimales] = e.precio.split('.')
    expect(
      screen.getAllByText(new RegExp(`${entero}[.,]${decimales}`)).length,
    ).toBeGreaterThan(0)
  })

  it('el descuento se anuncia solo si el producto lo tiene', async () => {
    await abrir(e, '/s/tienda?ver=todo')
    await screen.findAllByText(e.producto)

    const tachados = screen.queryAllByText(/^S\/.*$/).filter((n) => n.tagName === 'S')
    expect(tachados.length > 0).toBe(e.antes !== null)
  })

  it('se puede comprar', async () => {
    const user = userEvent.setup()
    await abrir(e, '/s/tienda?ver=todo')

    const comprar = (await screen.findAllByRole('button', { name: 'Agregar al carrito' }))[0]
    expect(comprar).toBeEnabled()
    if (comprar) await user.click(comprar)
  })

  it('el pie da con las condiciones de venta', async () => {
    await abrir(e)

    const pie = screen.getByRole('contentinfo')
    expect(
      await within(pie).findByRole('link', { name: 'Términos y condiciones' }),
    ).toBeInTheDocument()
  })

  it('y lo que el comercio no configuró no se inventa', async () => {
    await abrir(e)

    const pie = screen.getByRole('contentinfo')
    // Sin teléfono ni dirección en la configuración, no aparecen. El correo sí,
    // porque ese lo pusieron.
    expect(within(pie).getByRole('link', { name: 'hola@tienda.demo' })).toBeInTheDocument()
    expect(within(pie).queryByText(/av\.|calle|jr\./i)).not.toBeInTheDocument()
  })
})

describe('el rubro no existe para el programa', () => {
  it('los cuatro montan el mismo árbol, con distinta presentación', async () => {
    const huellas = new Set<string>()
    const estructuras = new Set<string>()

    for (const e of ESCENARIOS) {
      cleanup()
      await abrir(e)
      const frontera = document.querySelector('.sf-scope')
      huellas.add(frontera?.getAttribute('data-store-theme') ?? '')
      // La estructura: los mismos puntos de referencia del documento en los
      // cuatro. Si un tema quitara uno, aquí habría dos estructuras.
      estructuras.add(
        [
          Boolean(screen.queryByRole('banner')),
          Boolean(screen.queryByRole('main')),
          Boolean(screen.queryByRole('contentinfo')),
          Boolean(screen.queryByRole('search')),
        ].join('|'),
      )
    }

    expect(huellas.size).toBe(4)
    expect(estructuras.size).toBe(1)
  })
})

/**
 * H07 · La sección `categories` de la portada, en ocho rubros y los cuatro temas.
 *
 * Es una tabla por la misma razón que el resto del archivo: si pintar las
 * familias de una ferretería necesitara una rama distinta que las de una tienda
 * de tecnología, esto no podría escribirse como datos. El comercio enciende la
 * sección en su `home_layout`; lo que aparece son SUS familias, con enlace al
 * catálogo filtrado por cada una.
 */
const RUBROS: ReadonlyArray<{ rubro: string; tema: string; familias: string[] }> = [
  { rubro: 'moda', tema: 'premium', familias: ['Vestidos', 'Abrigos', 'Accesorios'] },
  { rubro: 'calzado', tema: 'universal', familias: ['Zapatillas', 'Botas', 'Sandalias'] },
  { rubro: 'farmacia', tema: 'retail', familias: ['Medicamentos', 'Dermocosmética', 'Bebé y mamá'] },
  { rubro: 'abarrotes', tema: 'catalog', familias: ['Abarrotes', 'Bebidas', 'Limpieza'] },
  { rubro: 'tecnología', tema: 'universal', familias: ['Celulares', 'Computadoras', 'Audio'] },
  { rubro: 'ferretería', tema: 'catalog', familias: ['Herramientas', 'Pinturas', 'Electricidad'] },
  { rubro: 'belleza', tema: 'premium', familias: ['Maquillaje', 'Cuidado capilar', 'Fragancias'] },
  {
    rubro: 'retail general',
    tema: 'retail',
    familias: ['Hogar', 'Juguetes', 'Deportes', 'Mascotas', 'Oficina y papelería con un nombre muy largo'],
  },
]

describe.each(RUBROS)('portada de $rubro con la sección de familias ($tema)', ({ tema, familias }) => {
  it('pinta SUS familias como puertas al catálogo filtrado', async () => {
    const base = ESCENARIOS[0] as Escenario
    const slugs = familias.map((nombre, i) => ({ slug: `familia-${i + 1}`, name: nombre }))
    await abrir({ ...base, tema }, '/s/tienda', {
      store: { home_layout: { version: 1, sections: [{ id: 'categories', enabled: true }] } },
      categorias: slugs,
    })

    const seccion = await screen.findByRole('region', { name: 'Compra por categoría' })
    for (const { slug, name } of slugs) {
      const puertas = within(seccion).getAllByRole('link', { name: new RegExp(name) })
      expect(puertas.length).toBeGreaterThan(0)
      expect(puertas[0]).toHaveAttribute('href', `/s/tienda?c=${slug}`)
    }
  })
})

/**
 * Storefront V2 · P01 · La franja de la portada no habla de un rubro.
 *
 * ## Qué defiende este bloque
 *
 * Antes de P01 la franja bajo la portada anunciaba «Atención farmacéutica» y
 * «Retiro en tienda» en TODAS las tiendas. Eran dos afirmaciones que el código
 * no puede sostener: una sobre la plantilla del comercio y otra sobre su local.
 * Una zapatería abría su tienda ofreciendo asesoría farmacéutica.
 *
 * La prueba no comprueba que el texto sea bonito: comprueba la LÍNEA. Lo que la
 * plataforma afirma sola es lo que hace el código; todo lo demás lo escribe el
 * comercio y sale solo en su tienda.
 */
const VOCABULARIO_DE_RUBRO = [
  /farmac/i,
  /laboratorio/i,
  /registro sanitario/i,
  /pharmacist/i,
  /health registry/i,
  /catalogue labs/i,
]

describe('la franja de propuestas de valor', () => {
  it('sin nada configurado enseña SOLO lo que hace el código', async () => {
    // La zapatería, que es la tienda que el fallo original contaminaba.
    await abrir(ESCENARIOS[1] as Escenario)

    const franja = await screen.findByRole('region', { name: 'Cómo compras aquí' })
    expect(within(franja).getByText('Envío a domicilio')).toBeInTheDocument()
    expect(within(franja).getByText('Compra segura')).toBeInTheDocument()
    // Hay correo de contacto en el escenario, así que la atención sí se anuncia.
    expect(within(franja).getByText('Atención al cliente')).toBeInTheDocument()
    // Y lo que el código no sabe, no se anuncia: el local y la plantilla.
    expect(within(franja).queryByText('Retiro en tienda')).not.toBeInTheDocument()
    expect(within(franja).queryByText('Asesoría especializada')).not.toBeInTheDocument()
  })

  it('la atención solo se ofrece si hay a dónde escribir', async () => {
    await abrir(ESCENARIOS[1] as Escenario, '/s/tienda', {
      store: { support_email: null, contact_phone: null },
    })

    const franja = await screen.findByRole('region', { name: 'Cómo compras aquí' })
    expect(within(franja).queryByText('Atención al cliente')).not.toBeInTheDocument()
    expect(within(franja).getByText('Compra segura')).toBeInTheDocument()
  })

  it.each(ESCENARIOS)('en $rubro no aparece vocabulario de otro rubro', async (e) => {
    cleanup()
    await abrir(e)

    const franja = await screen.findByRole('region', { name: 'Cómo compras aquí' })
    const texto = franja.textContent ?? ''
    for (const patron of VOCABULARIO_DE_RUBRO) expect(texto).not.toMatch(patron)
  })

  it('el claim especializado sale SOLO en la tienda que lo escribió', async () => {
    // La botica configura lo suyo. Es contenido de su fila, no una rama del
    // código: no hay ningún sitio donde el programa sepa que es una botica.
    await abrir(ESCENARIOS[2] as Escenario, '/s/tienda', {
      store: {
        value_props: [
          { iconKey: 'expertise', title: 'Atención farmacéutica', body: 'Pregunta al químico', enabled: true },
          { iconKey: 'certification', title: 'Registro sanitario', enabled: true },
        ],
      },
    })

    const suya = await screen.findByRole('region', { name: 'Cómo compras aquí' })
    expect(within(suya).getByText('Atención farmacéutica')).toBeInTheDocument()
    expect(within(suya).getByText('Pregunta al químico')).toBeInTheDocument()
    expect(within(suya).getByText('Registro sanitario')).toBeInTheDocument()
    // Configurar SUSTITUYE: no se completa con las de plataforma.
    expect(within(suya).queryByText('Compra segura')).not.toBeInTheDocument()

    cleanup()

    // La zapatería, MISMA versión del código y sin configurar nada.
    await abrir(ESCENARIOS[1] as Escenario)
    const ajena = await screen.findByRole('region', { name: 'Cómo compras aquí' })
    expect(within(ajena).queryByText('Atención farmacéutica')).not.toBeInTheDocument()
    expect(within(ajena).queryByText('Registro sanitario')).not.toBeInTheDocument()
  })

  it('una entrada mal formada no tumba la portada', async () => {
    await abrir(ESCENARIOS[1] as Escenario, '/s/tienda', {
      store: { value_props: 'esto no es una lista' },
    })

    // La tienda sigue en pie y la franja cae a las de plataforma.
    const franja = await screen.findByRole('region', { name: 'Cómo compras aquí' })
    expect(within(franja).getByText('Compra segura')).toBeInTheDocument()
  })

  it('la tienda que apagó sus propuestas no deja una caja vacía', async () => {
    await abrir(ESCENARIOS[1] as Escenario, '/s/tienda', {
      store: {
        value_props: [{ iconKey: 'delivery', title: 'Envíos 24 h', enabled: false }],
      },
    })

    await screen.findByRole('banner')
    expect(screen.queryByRole('region', { name: 'Cómo compras aquí' })).not.toBeInTheDocument()
  })
})

describe('el cierre de la portada tampoco afirma nada que no sepa', () => {
  /**
   * La banda de marcas tenía una pastilla fija con «Productos originales» y un
   * subtítulo que hablaba de distribución autorizada, registro sanitario y
   * trazabilidad. Tres afirmaciones sobre la cadena de suministro de otro,
   * escritas por la plataforma y puestas en todas las tiendas por igual.
   */
  it('las marcas se presentan por lo que son: las del catálogo', async () => {
    await abrir(ESCENARIOS[1] as Escenario, '/s/tienda', {
      store: { home_layout: { version: 1, sections: [{ id: 'trust', enabled: true }] } },
    })

    await screen.findByRole('banner')
    expect(screen.queryByText('Productos originales')).not.toBeInTheDocument()
    expect(screen.queryByText(/registro sanitario/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Distribuidor autorizado/i)).not.toBeInTheDocument()
  })
})

/**
 * Storefront V2 · P03 · La foto de una categoría llega a la portada.
 *
 * Es la prueba de que la mejora es de DATOS y no de rubro: el mismo código pinta
 * una puerta con fotografía cuando la categoría la tiene y una puerta de tinte
 * con icono cuando no, en cualquiera de los cuatro temas.
 */
describe('las puertas de categoría con fotografía', () => {
  const CON_FOTO = [
    { slug: 'abrigos', name: 'Abrigos', image_url: 'https://cdn.ejemplo.com/abrigos.webp' },
    { slug: 'camisas', name: 'Camisas' },
  ]

  async function portadaConCategorias(tema: string) {
    const base = ESCENARIOS[0] as Escenario
    await abrir({ ...base, tema }, '/s/tienda', {
      store: { home_layout: { version: 1, sections: [{ id: 'categories', enabled: true }] } },
      categorias: CON_FOTO,
    })
    return screen.findByRole('region', { name: 'Compra por categoría' })
  }

  /**
   * Los tres temas que piden AZULEJOS. `catalog` no está aquí y no es un olvido:
   * desde P04 pide píldoras, y ahí la foto no cabe. Ver la prueba siguiente.
   */
  it.each(['universal', 'retail', 'premium'])(
    'en el tema %s la que tiene foto la enseña y la que no cae al tinte',
    async (tema) => {
      cleanup()
      const seccion = await portadaConCategorias(tema)

      const conFoto = within(seccion).getAllByRole('link', { name: /Abrigos/ })[0]
      const sinFoto = within(seccion).getAllByRole('link', { name: /Camisas/ })[0]

      expect(conFoto).toHaveAttribute('data-category-door', 'photo')
      expect(sinFoto).toHaveAttribute('data-category-door', 'tint')
      expect(conFoto?.querySelector('img')?.getAttribute('src')).toBe(
        'https://cdn.ejemplo.com/abrigos.webp',
      )
    },
  )

  /**
   * La otra mitad del contrato `categoryVariant`, cerrado en P04.
   *
   * `catalog` es el tema de quien tiene miles de referencias: sus familias son
   * NAVEGACIÓN densa, no puertas. Una píldora de 36 px de alto no puede enseñar
   * una fotografía —saldría una franja de tres píxeles— y forzarla sería el
   * clásico «la opción existe pero no se nota». Aquí se fija que el tema cambia
   * la COMPOSICIÓN y que, aun así, las dos familias siguen llegando a su
   * catálogo filtrado.
   */
  it('en el tema catalog las familias son píldoras, y siguen llevando a su catálogo', async () => {
    cleanup()
    const seccion = await portadaConCategorias('catalog')

    expect(seccion.querySelectorAll('[data-category-pill]').length).toBe(2)
    expect(seccion.querySelector('[data-category-door]')).toBeNull()
    expect(within(seccion).getByRole('link', { name: /Abrigos/ })).toHaveAttribute(
      'href',
      '/s/tienda?c=abrigos',
    )
    expect(within(seccion).getByRole('link', { name: /Camisas/ })).toHaveAttribute(
      'href',
      '/s/tienda?c=camisas',
    )
  })

  it('las dos siguen llevando al catálogo filtrado por su familia', async () => {
    const seccion = await portadaConCategorias('universal')

    expect(within(seccion).getAllByRole('link', { name: /Abrigos/ })[0]).toHaveAttribute(
      'href',
      '/s/tienda?c=abrigos',
    )
    expect(within(seccion).getAllByRole('link', { name: /Camisas/ })[0]).toHaveAttribute(
      'href',
      '/s/tienda?c=camisas',
    )
  })

  it('una tienda sin ninguna foto pinta la sección igual que antes de P03', async () => {
    const base = ESCENARIOS[1] as Escenario
    await abrir(base, '/s/tienda', {
      store: { home_layout: { version: 1, sections: [{ id: 'categories', enabled: true }] } },
      categorias: [
        { slug: 'zapatillas', name: 'Zapatillas' },
        { slug: 'botas', name: 'Botas' },
      ],
    })

    const seccion = await screen.findByRole('region', { name: 'Compra por categoría' })
    expect(seccion.querySelector('img')).toBeNull()
    expect(within(seccion).getAllByRole('link', { name: /Zapatillas/ })[0]).toHaveAttribute(
      'data-category-door',
      'tint',
    )
  })
})
