import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Vitrina pública de punta a punta contra un PostgREST falso.
 *
 * Lo que estos tests defienden no es la maquetación, es la regla del encargo:
 * la tienda se resuelve por el slug de la URL, la identidad sale de
 * `store_settings`, y el comprador anónimo ve el catálogo publicado con sus
 * filtros — nada más.
 *
 * El aislamiento de verdad (que un tenant no vea al otro) se comprueba contra
 * Postgres real en `supabase/tests/storefront-public.test.ts`: aquí las vistas
 * son tablas en memoria y fingir RLS daría una falsa sensación de cobertura.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,

  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorefrontLayout } = await import('./StorefrontLayout')
const { StoreHomePage } = await import('./StoreHomePage')
const { StoreProductPage } = await import('./StoreProductPage')
const { ProductGridSkeleton } = await import('./components/ProductGrid')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const CAT_SILLAS = 'bbbb1111-1111-4111-8111-111111111111'
const CAT_MESAS = 'bbbb2222-1111-4111-8111-111111111111'
const P_SILLA = 'cccc1111-1111-4111-8111-111111111111'
const P_LINO = 'cccc2222-1111-4111-8111-111111111111'
const P_MESA = 'cccc3333-1111-4111-8111-111111111111'
const ORG_ID = 'dddd1111-1111-4111-8111-111111111111'

function store(overrides: Record<string, unknown> = {}) {
  return {
    store_id: STORE,
    slug: 'casa-nordica',
    name: 'Casa Nórdica',
    currency: 'PEN',
    accent_color: '#056769',
    logo_url: null,
    white_label: false,
    default_locale: 'es',
    support_email: 'hola@casanordica.demo',
    banner_url: null,
    hero_title: 'Muebles que duran',
    hero_subtitle: 'Fabricación propia',
    contact_phone: '+51 999 111 222',
    contact_address: 'Av. Primavera 120',
    ...overrides,
  }
}

/** Relleno: productos sin nada especial, para que la portada tenga qué repartir. */
function relleno(indice: number) {
  return {
    product_id: `cccc9${indice}99-1111-4111-8111-111111111111`,
    store_id: STORE,
    category_id: CAT_MESAS,
    slug: `mueble-${indice}`,
    name: `Mueble ${indice}`,
    description: null,
    price: `${100 + indice}.00`,
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-10T00:00:00.000Z',
    in_stock: true,
    category_slug: 'mesas',
    category_name: 'Mesas',
    primary_image_path: null,
    primary_image_alt: null,
  }
}

function catalogo() {
  return [
    {
      product_id: P_SILLA,
      store_id: STORE,
      category_id: CAT_SILLAS,
      slug: 'silla-roble',
      name: 'Silla de roble',
      description: 'Roble macizo con acabado al aceite.',
      price: '389.00',
      compare_at_price: '450.00',
      currency: 'PEN',
      published_at: '2026-08-20T00:00:00.000Z',
      in_stock: true,
      category_slug: 'sillas',
      category_name: 'Sillas',
      primary_image_path: `${STORE}/silla.jpg`,
      primary_image_alt: 'Silla de roble',
    },
    {
      product_id: P_LINO,
      store_id: STORE,
      category_id: CAT_SILLAS,
      slug: 'silla-lino',
      name: 'Silla de lino',
      description: null,
      price: '429.00',
      compare_at_price: null,
      currency: 'PEN',
      published_at: '2026-08-18T00:00:00.000Z',
      in_stock: false,
      category_slug: 'sillas',
      category_name: 'Sillas',
      primary_image_path: null,
      primary_image_alt: null,
    },
    {
      product_id: P_MESA,
      store_id: STORE,
      category_id: CAT_MESAS,
      slug: 'mesa-extensible',
      name: 'Mesa extensible',
      description: 'De cuatro a ocho comensales.',
      price: '1890.00',
      compare_at_price: null,
      currency: 'PEN',
      published_at: '2026-08-15T00:00:00.000Z',
      in_stock: true,
      category_slug: 'mesas',
      category_name: 'Mesas',
      primary_image_path: null,
      primary_image_alt: null,
    },
    relleno(1),
    relleno(2),
    relleno(3),
    relleno(4),
    relleno(5),
  ]
}

type ProductRow = Record<string, unknown>

/**
 * Motor de busqueda de mentira, con el CONTRATO de verdad.
 *
 * Desde P11-SaaS la portada no lee `public_products` y filtra en el navegador:
 * pregunta a `catalog_search_for_slug`, que devuelve una PAGINA, los contadores
 * de las facetas y el MODO de coincidencia. Este doble responde esa misma forma
 * sobre las tres filas del catalogo de prueba.
 *
 * Lo que sigue probandose con esto no cambia: que la vitrina pinta lo que el
 * servidor le da, que los filtros viven en la URL y que un termino sin
 * resultados ofrece quitarlos. Lo que YA NO se prueba aqui —y no debe— es que
 * el filtrado sea correcto: eso ocurre en Postgres y se comprueba contra
 * Postgres real en `supabase/tests/catalog-search.test.ts`. Duplicar la logica
 * del motor en el doble seria probar el doble.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function fakeSearch(rows: ProductRow[]) {
  return (args: Record<string, unknown>) => {
    const term = normalize(String(args.p_query ?? ''))
    const filters = (args.p_filters ?? {}) as Record<string, unknown>
    const sort = String(args.p_sort ?? 'relevance')
    const limit = Number(args.p_limit ?? 24)

    let items = rows.filter((row) => {
      if (filters.category && row.category_slug !== filters.category) return false
      if (filters.availability === 'in-stock' && row.in_stock !== true) return false
      if (
        filters.discounted &&
        !(row.compare_at_price && Number(row.compare_at_price) > Number(row.price))
      ) {
        return false
      }
      if (!term) return true
      const haystack = normalize(
        [row.name, row.description, row.category_name].filter(Boolean).join(' '),
      )
      return term.split(' ').every((token) => haystack.includes(token))
    })

    if (sort === 'name') items = [...items].sort((a, b) => String(a.name).localeCompare(String(b.name)))
    if (sort === 'price-asc') items = [...items].sort((a, b) => Number(a.price) - Number(b.price))
    if (sort === 'price-desc') items = [...items].sort((a, b) => Number(b.price) - Number(a.price))

    const total = items.length
    const page = items.slice(0, limit)

    return {
      items: page.map((row) => ({
        product_id: row.product_id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? null,
        kind: row.kind ?? 'simple',
        brand_name: row.brand_name ?? null,
        category_slug: row.category_slug ?? null,
        category_name: row.category_name ?? null,
        price: row.price,
        compare_at_price: row.compare_at_price ?? null,
        price_from: row.price_from ?? row.price,
        currency: row.currency,
        in_stock: row.in_stock === true,
        image_path: row.primary_image_path ?? null,
        image_alt: row.primary_image_alt ?? null,
        published: true,
        score: '1',
      })),
      total,
      limit,
      offset: 0,
      sort,
      mode: term ? (total > 0 ? 'fts' : 'empty') : 'browse',
      query: args.p_query ?? null,
      facets: {
        categories: [],
        brands: [],
        attributes: [],
        price: { min: null, max: null },
        availability: {
          in_stock: page.filter((row) => row.in_stock === true).length,
          total,
        },
      },
    }
  }
}

function backend(overrides: Record<string, unknown[]> = {}): FakeSupabase {
  const products = (overrides.public_products ?? catalogo()) as ProductRow[]
  return createFakeSupabase({
    rpc: {
      catalog_search_for_slug: fakeSearch(products),
      catalog_suggest_for_slug: () => [],
      // Sin `content.cms` contratado: la respuesta VALIDA es «no hay CMS», y la
      // portada cae al hero de `store_settings` y al catalogo — que es lo que
      // pintaba antes de P11. Se degrada, no se rompe.
      store_page_for_slug: () => ({
        cms: false,
        store_id: STORE,
        page: null,
        blocks: [],
        resolved_at: '2026-08-28T00:00:00.000Z',
      }),
      store_navigation_for_slug: () => [],
    },
    tables: {
      public_stores: [store()],
      public_categories: [
        { category_id: CAT_SILLAS, store_id: STORE, slug: 'sillas', name: 'Sillas', position: 1 },
        { category_id: CAT_MESAS, store_id: STORE, slug: 'mesas', name: 'Mesas', position: 2 },
      ],
      public_products: products,
      public_product_images: [
        {
          image_id: 'dddd1111-1111-4111-8111-111111111111',
          product_id: P_SILLA,
          storage_path: `${STORE}/silla.jpg`,
          alt: 'Silla de roble de frente',
          position: 0,
          is_primary: true,
        },
        {
          image_id: 'dddd2222-1111-4111-8111-111111111111',
          product_id: P_SILLA,
          storage_path: `${STORE}/silla-lateral.jpg`,
          alt: null,
          position: 1,
          is_primary: false,
        },
      ],
      ...overrides,
    },
  })
}

function renderStorefront(fake: FakeSupabase, route: string) {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
        <Route path="product/:productSlug" element={<StoreProductPage />} />
      </Route>
    </Routes>,
    { route },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('resolución del tenant por slug', () => {
  it('resuelve la tienda del slug y pinta su identidad, no la de casa', async () => {
    renderStorefront(backend(), '/s/casa-nordica')

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    // El nombre sale de la tienda y está en la cabecera, que es lo único que
    // se ve en TODAS las pantallas.
    expect(screen.getAllByText('Casa Nórdica').length).toBeGreaterThan(0)
  })

  it('sin nada rebajado, la portada cae al hero de `store_settings`', async () => {
    /**
     * El hero del comercio es la cabecera de RESERVA.
     *
     * La portada abre con una oferta concreta cuando el catálogo tiene alguna
     * —producto, precio antes, precio ahora—, porque un lema sobre un degradado
     * no dice qué se compra. Sin rebajas no hay oferta que enseñar, y entonces
     * el lema es lo que hay: se comprueba que ese camino sigue existiendo.
     */
    const sinRebajas = catalogo().map((row) => ({ ...row, compare_at_price: null }))
    renderStorefront(backend({ public_products: sinRebajas }), '/s/casa-nordica')

    expect(
      await screen.findByRole('heading', { name: 'Muebles que duran', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fabricación propia')).toBeInTheDocument()
  })

  it('un slug que no resuelve da 404 de tienda, no una pantalla en blanco', async () => {
    renderStorefront(backend(), '/s/no-existe')

    expect(await screen.findByText('No encontramos esa tienda')).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  /**
   * El modo claro/oscuro estaba solo en el backoffice, y quien mira la vitrina
   * de noche es justo quien más lo necesita.
   *
   * Se comprueba el `aria-label` y no un color: el botón dice a DÓNDE va —«Tema
   * oscuro» cuando estás en claro—, que es lo único útil de leer antes de
   * pulsarlo, y es lo que oye un lector de pantalla.
   */
  it('la cabecera deja cambiar de tema, y el botón dice a dónde va', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    const boton = within(header).getByRole('button', { name: 'Tema oscuro' })

    await user.click(boton)

    // Ya en oscuro, ahora ofrece volver: el mismo botón, el otro destino.
    expect(await within(header).findByRole('button', { name: 'Tema claro' })).toBeInTheDocument()
  })

  it('sin logo cae a iniciales neutras: no planta el isotipo EBIM como marca del tenant', async () => {
    renderStorefront(backend(), '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    expect(within(header).getByText('CN')).toBeInTheDocument()
    expect(within(header).queryByRole('img')).not.toBeInTheDocument()
  })

  /**
   * P07: lo que el tenant sube desde `/app/settings` se guarda como RUTA del
   * bucket privado `store-assets`. La vitrina la firma con el cliente ANÓNIMO
   * antes de pintarla — una URL guardada caducaría en una hora.
   */
  it('el logo que subio el tenant se firma y se pinta', async () => {
    const path = `${ORG_ID}/${STORE}/branding/logo-abc.png`
    const fake = backend({ public_stores: [store({ logo_url: path })] })
    renderStorefront(fake, '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('img', { name: 'Casa Nórdica' })).toHaveAttribute(
      'src',
      `https://firmado.test/${path}`,
    )
  })

  it('una referencia de marca que no es https ni ruta del bucket se descarta', async () => {
    const fake = backend({ public_stores: [store({ logo_url: 'javascript:alert(1)' })] })
    renderStorefront(fake, '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    expect(within(header).getByText('CN')).toBeInTheDocument()
    expect(within(header).queryByRole('img')).not.toBeInTheDocument()
  })

  it('con logo cargado, el logo manda', async () => {
    const fake = backend({ public_stores: [store({ logo_url: 'https://cdn.test/logo.png' })] })
    renderStorefront(fake, '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('img', { name: 'Casa Nórdica' })).toHaveAttribute(
      'src',
      'https://cdn.test/logo.png',
    )
  })

  it('el contacto del tenant sigue sin pintarse, aunque el pie haya vuelto', async () => {
    /**
     * Constancia de una pérdida, no de una mejora.
     *
     * El correo, el teléfono y la dirección solo vivían en el pie ANTIGUO, que
     * era un bloque entero con contacto y lockup. El pie que volvió es una
     * línea: la firma del comercio y sus páginas legales, que es lo que no
     * podía vivir en la cabecera.
     *
     * El contacto sigue en `store_settings` y sigue llegando en
     * `public_stores`: un bloque de contenido del CMS puede pintarlo donde el
     * comercio quiera, pero eso hay que hacerlo, no ocurre solo. El test se
     * queda invertido para que la ausencia sea deliberada.
     */
    renderStorefront(backend(), '/s/casa-nordica')
    await screen.findByRole('banner')

    expect(screen.queryByText('hola@casanordica.demo')).not.toBeInTheDocument()
    expect(screen.queryByText('+51 999 111 222')).not.toBeInTheDocument()
  })

  it('una tienda sin contacto ni hero se ve igual, con los fallbacks neutrales', async () => {
    // Sin rebajas TAMBIÉN: con alguna, la portada abre con la oferta y no con
    // el hero del comercio, que es justo lo que aquí se está comprobando.
    const fake = backend({
      public_products: catalogo().map((row) => ({ ...row, compare_at_price: null })),
      public_stores: [
        store({
          hero_title: null,
          hero_subtitle: null,
          support_email: null,
          contact_phone: null,
          contact_address: null,
        }),
      ],
    })
    renderStorefront(fake, '/s/casa-nordica')

    expect(
      await screen.findByRole('heading', { name: 'Casa Nórdica', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Explora el catálogo, revisa precios y disponibilidad al día.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Contacto')).not.toBeInTheDocument()
  })

  it('la vitrina consulta SIEMPRE el modelo público, nunca las tablas del backoffice', async () => {
    const fake = backend()
    const seen: string[] = []
    const original = fake.from.bind(fake)
    fake.from = (table: string) => {
      seen.push(table)
      return original(table)
    }

    renderStorefront(fake, '/s/casa-nordica')
    await screen.findByText('Silla de roble')

    expect(seen.every((table) => table.startsWith('public_'))).toBe(true)
    expect(seen).not.toContain('products')
    expect(seen).not.toContain('stores')

    // P11-SaaS: el catalogo llega por la funcion de busqueda, no por una
    // consulta a la vista. Es lo que impide que el navegador se traiga el
    // catalogo entero para filtrarlo, y por eso se comprueba que la portada
    // NO consulta `public_products` por PostgREST.
    expect(seen).not.toContain('public_products')
    expect(fake.state.rpcCalls.map((call) => call.name)).toContain('catalog_search_for_slug')
  })
})

describe('catálogo', () => {
  it('lista los productos publicados con precio, descuento y disponibilidad', async () => {
    // `?ver=todo`: la rejilla con su recuento y su panel ya no esta puesta de
    // entrada. La portada ensena filas cortas; esto es el catalogo.
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')

    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
    expect(screen.getByText('8 resultados')).toBeInTheDocument()
    expect(screen.getByText('-14%')).toBeInTheDocument()
    // Siete disponibles y uno agotado: lo que importa es que el estado se
    // pinte por producto, no cuántos hay en el catálogo de prueba.
    expect(screen.getAllByText('Disponible')).toHaveLength(7)
    expect(screen.getByText('Sin stock')).toBeInTheDocument()
  })

  it('cada tarjeta enlaza a su ficha', async () => {
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')

    const card = (await screen.findByText('Silla de roble')).closest('a')
    expect(card).toHaveAttribute('href', '/s/casa-nordica/product/silla-roble')
  })

  // La caja de busqueda es un `combobox`, no un `searchbox`. No es un detalle
  // de MUI: un campo con lista de sugerencias ES un combobox segun WAI-ARIA, y
  // anunciarlo como caja de busqueda a secas dejaria a un lector de pantalla
  // sin saber que hay opciones debajo. Se mantiene tras mudar el buscador a la
  // cabecera: cambio el sitio, no la semantica.
  it('el buscador de la cabecera filtra el catálogo al pulsar Enter', async () => {
    // Teclear ya NO filtra solo: el buscador vive en la cabecera y esta en
    // todas las pantallas de la tienda, asi que lo que hace es LLEVAR al
    // catalogo filtrado. Escribir y que la rejilla cambiara sola detras del
    // dialogo de sugerencias seria dos respuestas a la misma pulsacion.
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica')
    await screen.findByText('Silla de roble')

    const box = screen.getByRole('combobox', { name: 'Buscar en la tienda' })
    await user.type(box, 'mesa')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByText('Silla de roble')).not.toBeInTheDocument())
    expect(screen.getByText('Mesa extensible')).toBeInTheDocument()
  })

  it('una búsqueda sin resultados ofrece quitar los filtros y vuelve al catálogo entero', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica')
    await screen.findByText('Silla de roble')

    await user.type(screen.getByRole('combobox', { name: 'Buscar en la tienda' }), 'zzz')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
  })

  it('filtra por categoría desde las píldoras y marca cuál está activa', async () => {
    const user = userEvent.setup()
    // Las píldoras son la forma que toman las categorías DENTRO del catálogo:
    // ahí son un filtro que se enciende y se apaga. En la portada son azulejos
    // con icono, que son una puerta y no un interruptor.
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    await user.click(screen.getByRole('button', { name: 'Mesas' }))

    await waitFor(() => expect(screen.queryByText('Silla de roble')).not.toBeInTheDocument())
    expect(screen.getByText('Mesa extensible')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mesas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todo' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('volver a pulsar la categoría activa la quita', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?c=mesas')
    await screen.findByText('Mesa extensible')

    await user.click(screen.getByRole('button', { name: 'Mesas' }))

    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
  })

  /**
   * Portada y catálogo son dos pantallas.
   *
   * La rejilla con su panel de filtros es lo que se quiere cuando YA se sabe
   * qué se busca. Quien acaba de entrar necesita saber QUÉ HAY, y eso son filas
   * cortas con nombre. Poner las dos cosas a la vez obligaba a bajar media
   * pantalla de filtros para ver el primer producto.
   */
  it('la portada enseña filas; la rejilla con filtros llega al pedir «Ver todo»', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica')

    // Los productos SÍ están —en una fila, no en la rejilla—, y el panel no.
    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /solo disponibles/i })).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: 'Ver todo' })[0] as HTMLElement)

    expect(
      await screen.findByRole('checkbox', { name: /solo disponibles/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Todo el catálogo' })).toBeInTheDocument()
    // Y hay camino de vuelta: sin esto, la única salida es el botón de atrás.
    expect(screen.getByRole('link', { name: /Volver a la portada/ })).toHaveAttribute(
      'href',
      '/s/casa-nordica',
    )
  })

  it('al abrir el catálogo la página empieza por arriba, no por donde iba', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    try {
      renderStorefront(backend(), '/s/casa-nordica')
      await screen.findByText('Silla de roble')
      // El montaje no cuenta: solo los CAMBIOS de lista mueven el scroll.
      expect(scrollTo).not.toHaveBeenCalled()

      await user.click(screen.getAllByRole('link', { name: 'Ver todo' })[0] as HTMLElement)
      await screen.findByRole('heading', { name: 'Todo el catálogo' })

      // «Ver todo» no cambia de ruta, solo de parametro: sin esto el navegador
      // conserva el desplazamiento y el catalogo aparecia empezado por la
      // mitad, con su cabecera y sus filtros fuera de la vista.
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('el filtro de disponibilidad esconde lo agotado', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de lino')

    await user.click(screen.getByRole('checkbox', { name: /solo disponibles/i }))

    await waitFor(() => expect(screen.queryByText('Silla de lino')).not.toBeInTheDocument())
    expect(screen.getByText('Silla de roble')).toBeInTheDocument()
  })

  /**
   * Ver TODO lo rebajado, que es la pregunta que la vitrina no sabía responder.
   *
   * El enlace «Ofertas» llevaba al ancla del carrusel de campañas —que es otra
   * cosa— y el «Ver todo» de la banda soltaba al visitante en el catálogo
   * entero, justo perdiendo la oferta que acababa de mirar. El motor ya sabía
   * filtrar rebajados desde que la portada compone su banda; lo que faltaba era
   * poder pedirlo, y que se pudiera compartir el enlace.
   */
  it('`?oferta=1` deja solo lo rebajado, y el interruptor lo enciende y lo apaga', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?ver=todo&oferta=1')

    // Silla de roble es la única del catálogo de prueba con «antes» mayor.
    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
    expect(screen.queryByText('Silla de lino')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Solo en oferta' })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'Solo en oferta' }))

    expect(await screen.findByText('Silla de lino')).toBeInTheDocument()
  })

  it('una tienda sin catálogo publicado muestra estado vacío, no un error', async () => {
    renderStorefront(backend({ public_products: [] }), '/s/casa-nordica')

    expect(await screen.findByText('Esta tienda todavía no publicó productos')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('el esqueleto del catálogo repite la rejilla real, para que la página no salte', () => {
    renderWithProviders(<ProductGridSkeleton count={4} />)

    const skeleton = screen.getByTestId('catalog-skeleton')
    expect(skeleton).toBeInTheDocument()
    // Oculto al lector de pantalla: no es contenido, es la espera.
    expect(skeleton).toHaveAttribute('aria-hidden')
  })

  it('el esqueleto deja paso al catálogo en cuanto llegan los datos', async () => {
    renderStorefront(backend(), '/s/casa-nordica')

    await screen.findByText('Silla de roble')
    expect(screen.queryByTestId('catalog-skeleton')).not.toBeInTheDocument()
  })

  it('la URL con filtros ya puestos se abre filtrada (deep link)', async () => {
    renderStorefront(backend(), '/s/casa-nordica?c=mesas')

    expect(await screen.findByText('Mesa extensible')).toBeInTheDocument()
    expect(screen.queryByText('Silla de roble')).not.toBeInTheDocument()
  })
})

describe('recorrer el catálogo', () => {
  it('el botón de volver arriba no existe hasta que hace falta', async () => {
    renderStorefront(backend(), '/s/casa-nordica')
    await screen.findAllByRole('button', { name: 'Guardar en favoritos' })

    // Arriba del todo no aporta nada y taparía una esquina del catálogo: ni
    // siquiera está en el árbol, así que tampoco en el orden de tabulación.
    expect(screen.queryByRole('button', { name: 'Volver arriba' })).not.toBeInTheDocument()

    Object.defineProperty(window, 'scrollY', { value: 1200, writable: true })
    fireEvent.scroll(window)

    expect(await screen.findByRole('button', { name: 'Volver arriba' })).toBeInTheDocument()
  })
})

describe('favoritos', () => {
  it('el corazón guarda sin sesión y sobrevive a recargar la página', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')

    const guardar = await screen.findAllByRole('button', { name: 'Guardar en favoritos' })
    expect(guardar[0]).toHaveAttribute('aria-pressed', 'false')

    await user.click(guardar[0]!)

    // El mismo botón cambia de nombre: «guardar» y «quitar» son dos acciones
    // distintas, y quien no ve el relleno del icono necesita oírlo.
    const quitar = await screen.findByRole('button', { name: 'Quitar de favoritos' })
    expect(quitar).toHaveAttribute('aria-pressed', 'true')

    // Sin sesión el favorito vive en el navegador: es lo que hace que siga ahí
    // al volver, y lo que se sube al iniciar sesión.
    const guardados = Object.keys(globalThis.localStorage)
      .filter((key) => key.startsWith('ebim.favorites.'))
      .map((key) => globalThis.localStorage.getItem(key) ?? '')
      .join('')
    expect(guardados).toContain(P_SILLA)
  })
})

describe('ficha de producto', () => {
  it('muestra galería, precio, disponibilidad y descripción', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    expect(
      await screen.findByRole('heading', { name: 'Silla de roble', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Roble macizo con acabado al aceite.')).toBeInTheDocument()
    // La categoría sale en dos sitios y cada uno hace algo distinto: en las
    // migas es un ENLACE al catálogo ya filtrado —a donde se va tras descartar
    // este producto— y en la ficha de datos es un dato más. Se comprueba el
    // enlace, que es la parte que puede romperse sin que se note.
    // Se busca DENTRO del contenido: desde que las familias viven en la
    // cabecera, «Sillas» también es una entrada de la barra, y esa es otra cosa
    // —navegación de tienda, no la ruta de este producto—.
    const contenido = screen.getByRole('main')
    expect(within(contenido).getByRole('link', { name: 'Sillas' })).toHaveAttribute(
      'href',
      '/s/casa-nordica?c=sillas',
    )
    expect(within(contenido).getAllByText('Sillas')).toHaveLength(2)
    expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0)

    // Bucket privado: la imagen llega por URL firmada, no por URL pública.
    const image = await screen.findByRole('img', { name: 'Silla de roble de frente' })
    expect(image.getAttribute('src')).toContain('https://firmado.test/')
  })

  it('la galería deja elegir otra foto sin recargar la ficha', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    await screen.findByRole('img', { name: 'Silla de roble de frente' })
    await user.click(screen.getByRole('button', { name: 'Imagen 2' }))

    await waitFor(() =>
      expect(screen.getAllByRole('img').some((img) => img.getAttribute('src')?.includes('lateral'))).toBe(
        true,
      ),
    )
  })

  it('pulsar la foto la abre en grande, se pasa de una a otra y se cierra', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    await screen.findByRole('img', { name: 'Silla de roble de frente' })
    await user.click(screen.getByRole('button', { name: 'Ver la imagen en grande' }))

    // El contador es lo que dice si queda algo por ver o se está dando vueltas.
    const viewer = await screen.findByRole('dialog')
    expect(within(viewer).getByText('Imagen 1 de 2')).toBeInTheDocument()

    await user.click(within(viewer).getByRole('button', { name: 'Imagen siguiente' }))
    expect(within(viewer).getByText('Imagen 2 de 2')).toBeInTheDocument()

    await user.click(within(viewer).getByRole('button', { name: 'Cerrar la imagen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('la miniatura abre el visor: a 64 px no se mira una foto, se elige', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    await screen.findByRole('img', { name: 'Silla de roble de frente' })
    await user.click(screen.getByRole('button', { name: 'Imagen 2' }))

    const viewer = await screen.findByRole('dialog')
    expect(within(viewer).getByText('Imagen 2 de 2')).toBeInTheDocument()
  })

  it('sin descripción lo dice, en vez de dejar un hueco', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-lino')

    expect(
      await screen.findByText('Este producto todavía no tiene descripción.'),
    ).toBeInTheDocument()
  })

  /**
   * La vista rápida con una descripción de dos palabras y con una de dos folios.
   *
   * El panel repartía el ancho entre la descripción y una columna de marca,
   * categoría y disponibilidad —los tres datos que ya están arriba— dimensionada
   * a `max-content`: con una categoría larga se quedaba con la mitad del panel y
   * dejaba el texto en una tira de dos palabras por línea. Ahora la descripción
   * va sola y a todo el ancho, y la que se pasa de largo se pliega para no
   * empujar el precio y el botón de comprar fuera de la pantalla.
   */
  it('en la vista rápida una descripción corta se ve entera y sin botón', async () => {
    renderStorefront(backend(), '/s/casa-nordica?ver=todo&p=silla-roble')

    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Roble macizo con acabado al aceite.')).toBeInTheDocument()
    expect(
      within(dialogo).queryByRole('button', { name: 'Leer la descripción completa' }),
    ).not.toBeInTheDocument()
  })

  it('una descripción larga se pliega y se despliega sin salir de la vista rápida', async () => {
    const user = userEvent.setup()
    const largo = `${'Nutrición en polvo completa y balanceada, con HMB, vitaminas, minerales y antioxidantes. '.repeat(4)}`
    const fake = backend({
      public_products: catalogo().map((row) =>
        row.slug === 'silla-roble' ? { ...row, description: largo } : row,
      ),
    })
    renderStorefront(fake, '/s/casa-nordica?ver=todo&p=silla-roble')

    const dialogo = await screen.findByRole('dialog')
    const desplegar = await within(dialogo).findByRole('button', {
      name: 'Leer la descripción completa',
    })

    await user.click(desplegar)

    expect(within(dialogo).getByRole('button', { name: 'Ver menos' })).toBeInTheDocument()
  })

  it('propone relacionados de la misma categoría y nunca el producto abierto', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    const heading = await screen.findByRole('heading', { name: 'También te puede interesar' })
    const section = heading.closest('section') as HTMLElement
    expect(within(section).getByText('Silla de lino')).toBeInTheDocument()
    expect(within(section).queryByText('Silla de roble')).not.toBeInTheDocument()
  })

  it('un producto que no está publicado da 404 con salida al catálogo', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/no-existe')

    expect(await screen.findByText('No encontramos ese producto')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al catálogo' })).toHaveAttribute(
      'href',
      '/s/casa-nordica',
    )
  })

  it('la vitrina no depende de tener sesión de backoffice abierta', async () => {
    const fake = backend()
    fake.state.session = makeSession()
    renderStorefront(fake, '/s/casa-nordica/product/silla-roble')

    expect(
      await screen.findByRole('heading', { name: 'Silla de roble', level: 1 }),
    ).toBeInTheDocument()
  })
})

/**
 * Producto con variantes en la vitrina (P03-SaaS).
 *
 * Un maestro de variantes NO se vende: se vende una de sus filas. Lo que se
 * comprueba aquí es que la ficha lo refleja —precio "desde", selector, precio de
 * la elegida— y que lo que se manda al carrito lleva la variante. Que la base
 * rechace un pedido sin variante está probado contra Postgres en
 * `supabase/tests/pim-orders.test.ts`.
 */
const P_CAMISETA = 'cccc4444-1111-4111-8111-111111111111'
const V_ROJA = 'eeee1111-1111-4111-8111-111111111111'
const V_AZUL = 'eeee2222-1111-4111-8111-111111111111'

function camiseta() {
  return {
    product_id: P_CAMISETA,
    store_id: STORE,
    category_id: CAT_SILLAS,
    slug: 'camiseta',
    name: 'Camiseta',
    description: null,
    price: '60.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-21T00:00:00.000Z',
    in_stock: true,
    category_slug: 'sillas',
    category_name: 'Sillas',
    primary_image_path: null,
    primary_image_alt: null,
    kind: 'variant',
    brand_name: 'Aurora',
    variant_count: 2,
    price_from: '60.00',
  }
}

function variantes() {
  return [
    {
      variant_id: V_ROJA,
      product_id: P_CAMISETA,
      store_id: STORE,
      name: 'Roja',
      position: 0,
      is_default: true,
      in_stock: true,
      price: '60.00',
      compare_at_price: null,
      currency: 'PEN',
    },
    {
      variant_id: V_AZUL,
      product_id: P_CAMISETA,
      store_id: STORE,
      name: 'Azul',
      position: 1,
      is_default: false,
      in_stock: false,
      price: '69.90',
      compare_at_price: null,
      currency: 'PEN',
    },
  ]
}

function backendConVariantes() {
  return backend({
    public_products: [...catalogo(), camiseta()],
    public_product_variants: variantes(),
  })
}

describe('ficha de un producto con variantes', () => {
  it('anuncia el precio "desde" y ofrece elegir', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    expect(await screen.findByRole('heading', { name: 'Camiseta', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Desde')).toBeInTheDocument()
    expect(await screen.findByLabelText('Elige una opción')).toBeInTheDocument()
  })

  it('preselecciona la variante por defecto y enseña SU precio', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    const selector = await screen.findByLabelText('Elige una opción')
    await waitFor(() => expect(selector).toHaveTextContent('Roja'))
  })

  it('una variante sin stock no se puede elegir', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    await user.click(await screen.findByLabelText('Elige una opción'))
    const opciones = await screen.findAllByRole('option')
    const azul = opciones.find((option) => option.textContent?.includes('Azul'))
    expect(azul).toHaveAttribute('aria-disabled', 'true')
    expect(azul?.textContent).toContain('sin stock')
  })

  it('agregar al carrito manda la variante elegida, no el maestro', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    await screen.findByLabelText('Elige una opción')
    await user.click(await screen.findByRole('button', { name: /Agregar al carrito/ }))

    // El panel se abre solo al añadir. El nombre de la variante va en su propia
    // línea: es lo que distingue dos líneas del mismo producto en el carrito.
    expect(await screen.findByRole('heading', { name: /Carrito/ })).toBeInTheDocument()
    await waitFor(() => {
      const guardado = localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)
      expect(guardado).toContain(V_ROJA)
      expect(guardado).toContain('"variant_name":"Roja"')
    })
  })

  it('un producto simple no pide elegir nada: la vitrina de siempre', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/silla-roble')

    expect(
      await screen.findByRole('heading', { name: 'Silla de roble', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Elige una opción')).not.toBeInTheDocument()
    expect(screen.queryByText('Desde')).not.toBeInTheDocument()
  })
})
