import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    // La descripción de la tienda sale en la portada Y en el pie, que también
    // la usa para presentar al comercio. Lo que aquí importa es que la portada
    // la tenga, así que se busca dentro de ella.
    const portada = screen.getByRole('main')
    expect(within(portada).getByText('Fabricación propia')).toBeInTheDocument()
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
  it('sin configurarlo, la cabecera NO ofrece selector de tema (V3 · P01/P03)', async () => {
    // Estaba en la cabecera de toda tienda sin que ningún comercio lo hubiera
    // pedido, compitiendo por atención con el carrito. Lo que NO desaparece es
    // el tema oscuro: la vitrina sigue respetando la preferencia del sistema.
    renderStorefront(backend(), '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    expect(within(header).queryByRole('button', { name: 'Tema oscuro' })).not.toBeInTheDocument()
    expect(within(header).queryByRole('button', { name: 'Tema claro' })).not.toBeInTheDocument()
  })

  it('si el comercio lo enciende, deja cambiar de tema y dice a dónde va', async () => {
    const user = userEvent.setup()
    renderStorefront(
      backend({ public_stores: [store({ show_theme_toggle: true })] }),
      '/s/casa-nordica',
    )

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
    /**
     * Se busca por `src`, no por nombre accesible (V3 · P03).
     *
     * Con el lockup `logo_name` —el defecto— el logotipo va DECORATIVO: el
     * nombre de la tienda está escrito al lado, y ponerle también `alt` hacía
     * que un lector de pantalla anunciara «Casa Nórdica Casa Nórdica». El
     * enlace de la marca sigue teniendo su nombre; lo que perdió es el duplicado.
     */
    const logo = within(header).getByAltText('')
    expect(logo).toHaveAttribute('src', `https://firmado.test/${path}`)
    expect(logo).toHaveAttribute('aria-hidden', 'true')
  })

  it('con el lockup «solo logotipo», el logotipo SÍ lleva el nombre', async () => {
    // Ahí el nombre no está escrito al lado, así que el logotipo es lo único
    // que identifica la tienda y tiene que anunciarse.
    const fake = backend({
      public_stores: [store({ logo_url: 'https://cdn.test/logo.png', brand_lockup: 'logo' })],
    })
    renderStorefront(fake, '/s/casa-nordica')

    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('img', { name: 'Casa Nórdica' })).toBeInTheDocument()
    // Y el nombre no se repite en texto.
    expect(within(header).queryByText('Casa Nórdica')).not.toBeInTheDocument()
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
    expect(within(header).getByAltText('')).toHaveAttribute('src', 'https://cdn.test/logo.png')
  })

  it('el contacto del tenant vuelve al pie, y sin inventar nada alrededor', async () => {
    /**
     * Este test estaba INVERTIDO, y dejarlo así habría sido un error.
     *
     * Dejó constancia de una pérdida: el correo, el teléfono y la dirección
     * vivían en el pie ANTIGUO —un bloque entero con contacto y lockup— y el
     * pie que volvió era una línea con la firma y las páginas legales. La nota
     * decía que un bloque del CMS podía pintarlos «donde el comercio quiera»,
     * pero eso había que hacerlo y no ocurría solo: en la práctica, una tienda
     * publicaba su correo en la configuración y no salía en ninguna parte.
     *
     * El pie de P13 los recupera, con la condición que los hacía peligrosos
     * resuelta: **solo lo que el comercio escribió**. Lo que no configuró no
     * aparece, ni como bloque vacío ni como marcador.
     */
    renderStorefront(backend(), '/s/casa-nordica')
    const pie = await screen.findByRole('contentinfo')

    expect(within(pie).getByRole('link', { name: 'hola@casanordica.demo' })).toHaveAttribute(
      'href',
      'mailto:hola@casanordica.demo',
    )
    expect(within(pie).getByText('+51 999 111 222')).toBeInTheDocument()
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
    /**
     * Sin bajada configurada, la portada NO escribe una (V3 · P04).
     *
     * Hasta V3 la plataforma rellenaba con «Explora el catálogo, revisa precios
     * y disponibilidad al día»: copy comercial en la tienda de alguien que no lo
     * había escrito. Lo que queda es su nombre, su titular y las puertas al
     * catálogo — que es lo que la plataforma sí puede afirmar.
     */
    expect(
      screen.queryByText('Explora el catálogo, revisa precios y disponibilidad al día.'),
    ).not.toBeInTheDocument()
    // Y el nombre no se escribe DOS veces DENTRO DE LA PORTADA: sin titular
    // propio, el antetítulo que lo repetía encima del `h1` desaparece. Fuera de
    // la portada sigue estando donde debe —cabecera y pie—, así que se mira
    // solo la portada.
    const portada = document.querySelector('[data-hero-variant]') as HTMLElement
    expect(within(portada).getAllByText('Casa Nórdica')).toHaveLength(1)
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
    // El recuento se ESPERA desde V3 · P09: la barra del catálogo viaja en su
    // propio trozo —no existe en la portada— así que llega un instante después
    // de la rejilla. Los productos no esperan a nada.
    expect(await screen.findByText('8 resultados')).toBeInTheDocument()
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
    await screen.findAllByRole('button', { name: /^Guardar en favoritos/ })

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

    const guardar = await screen.findAllByRole('button', { name: /^Guardar en favoritos/ })
    expect(guardar[0]).toHaveAttribute('aria-pressed', 'false')

    await user.click(guardar[0]!)

    // El mismo botón cambia de nombre: «guardar» y «quitar» son dos acciones
    // distintas, y quien no ve el relleno del icono necesita oírlo.
    const quitar = await screen.findByRole('button', { name: /^Quitar de favoritos/ })
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

  it('sin descripción no ofrece el apartado, y el detalle sigue teniendo qué decir', async () => {
    /**
     * Cambio deliberado en V3 · P10.
     *
     * Antes la descripción era una tarjeta a lo ancho que siempre estaba, así
     * que sin texto había que escribir «todavía no tiene descripción» para que
     * no quedara una caja vacía. Ahora el detalle es un acordeón: un apartado
     * que se abre para decir que no hay nada es peor que no ofrecerlo, y la
     * zona no queda hueca porque los datos del producto siguen ahí.
     *
     * La frase no desaparece del producto: la vista rápida —que sí tiene un
     * sitio fijo para el texto— la sigue usando.
     */
    renderStorefront(backend(), '/s/casa-nordica/product/silla-lino')

    const detalle = await waitFor(() => {
      const zona = document.querySelector('[data-product-details]')
      expect(zona).not.toBeNull()
      return zona as HTMLElement
    })
    expect(detalle.querySelector('[data-detail-panel="description"]')).toBeNull()
    expect(detalle.querySelector('[data-detail-panel="sheet"]')).not.toBeNull()
    expect(screen.queryByText('Este producto todavía no tiene descripción.')).not.toBeInTheDocument()
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
    // `findBy` y no `getBy`: la vista rápida se carga aparte desde P17, así que
    // el diálogo aparece un instante antes que la ficha del producto.
    expect(await within(dialogo).findByText('Roble macizo con acabado al aceite.')).toBeInTheDocument()
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
  it('anuncia el precio "desde" y ofrece elegir con botones, no con un desplegable', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    expect(await screen.findByRole('heading', { name: 'Camiseta', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Desde')).toBeInTheDocument()
    const grupo = await screen.findByRole('group', { name: 'Elige una opción' })
    expect(within(grupo).getAllByRole('radio')).toHaveLength(2)
    const compra = screen.getByRole('group', { name: 'Comprar' })
    expect(within(compra).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('preselecciona la variante por defecto y enseña SU precio', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    const roja = await screen.findByRole('radio', { name: /^Roja/ })
    await waitFor(() => expect(roja).toBeChecked())
  })

  it('una variante sin stock no se puede elegir, y se dice por qué', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    const azul = await screen.findByRole('radio', { name: /^Azul/ })
    expect(azul).toBeDisabled()
    // El tachado es visual; el lector de pantalla necesita oírlo.
    expect(azul).toHaveAccessibleName(expect.stringContaining('sin stock'))
  })

  it('con precios distintos, cada botón lleva el suyo', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    const azul = await screen.findByRole('radio', { name: /^Azul/ })
    expect(azul.closest('label')).toHaveTextContent('69.90')
  })

  it('agregar al carrito manda la variante elegida, no el maestro', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/camiseta')

    const roja = await screen.findByRole('radio', { name: /^Roja/ })
    await waitFor(() => expect(roja).toBeChecked())
    await user.click(botonComprarDeLaFicha())

    // El nombre de la variante va en su propia línea: es lo que distingue dos
    // líneas del mismo producto en el carrito. Se comprueba sobre lo GUARDADO y
    // no sobre el panel, que desde P19 ya no se abre al añadir.
    await waitFor(() => {
      const guardado = localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)
      expect(guardado).toContain(V_ROJA)
      expect(guardado).toContain('"variant_name":"Roja"')
    })
  })

  it('el nombre del producto repetido delante de la variante no sale en el botón', async () => {
    const importadas = variantes().map((row) => ({ ...row, name: `Camiseta · ${row.name}` }))
    renderStorefront(
      backend({ public_products: [...catalogo(), camiseta()], public_product_variants: importadas }),
      '/s/casa-nordica/product/camiseta',
    )

    expect(await screen.findByRole('radio', { name: /^Roja/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^Camiseta/ })).not.toBeInTheDocument()
  })

  it('un producto simple no pide elegir nada: la vitrina de siempre', async () => {
    renderStorefront(backendConVariantes(), '/s/casa-nordica/product/silla-roble')

    expect(
      await screen.findByRole('heading', { name: 'Silla de roble', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Elige una opción' })).not.toBeInTheDocument()
    expect(screen.queryByText('Desde')).not.toBeInTheDocument()
  })
})

/**
 * El «Agregar al carrito» de la ficha. Las tarjetas de «también te puede
 * interesar» tienen un botón con el mismo nombre; el de la ficha es el que vive
 * dentro del grupo «Comprar».
 */
function botonComprarDeLaFicha() {
  return within(screen.getByRole('group', { name: 'Comprar' })).getByRole('button', {
    name: /Agregar al carrito/,
  })
}

/** Cuatro variantes con ejes declarados: Color (Rojo, Azul) × Talla (S, M). */
const V_ROJO_S = 'eeee3333-1111-4111-8111-111111111111'
const V_ROJO_M = 'eeee4444-1111-4111-8111-111111111111'
const V_AZUL_S = 'eeee5555-1111-4111-8111-111111111111'
const V_AZUL_M = 'eeee6666-1111-4111-8111-111111111111'

function variantesConEjes() {
  const fila = (
    variant_id: string,
    color: string,
    talla: string,
    position: number,
    extra: { in_stock?: boolean; is_default?: boolean; price?: string } = {},
  ) => ({
    variant_id,
    product_id: P_CAMISETA,
    store_id: STORE,
    name: `${color} · ${talla}`,
    position,
    is_default: extra.is_default ?? false,
    in_stock: extra.in_stock ?? true,
    price: extra.price ?? '60.00',
    compare_at_price: null,
    currency: 'PEN',
    options: [
      { code: 'color', name: 'Color', position: 1, value_code: color.toLowerCase(), label: color, value_position: 0 },
      { code: 'talla', name: 'Talla', position: 2, value_code: talla.toLowerCase(), label: talla, value_position: 0 },
    ],
  })
  return [
    fila(V_ROJO_S, 'Rojo', 'S', 0, { is_default: true }),
    fila(V_ROJO_M, 'Rojo', 'M', 1, { in_stock: false }),
    fila(V_AZUL_S, 'Azul', 'S', 2, { price: '64.00' }),
    fila(V_AZUL_M, 'Azul', 'M', 3),
  ]
}

function backendConEjes() {
  return backend({
    public_products: [...catalogo(), { ...camiseta(), variant_count: 4 }],
    public_product_variants: variantesConEjes(),
  })
}

describe('ficha con ejes: un grupo de botones por atributo', () => {
  it('pinta «Color» y «Talla» por separado, con lo elegido en el título del grupo', async () => {
    renderStorefront(backendConEjes(), '/s/casa-nordica/product/camiseta')

    expect(await screen.findByRole('group', { name: 'Color: Rojo' })).toBeInTheDocument()
    const talla = screen.getByRole('group', { name: 'Talla: S' })
    expect(within(talla).getAllByRole('radio')).toHaveLength(2)
  })

  it('pulsar otro color conserva la talla y cambia el precio', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConEjes(), '/s/casa-nordica/product/camiseta')

    await user.click(await screen.findByRole('radio', { name: /^Azul/ }))

    expect(await screen.findByRole('group', { name: 'Color: Azul' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Talla: S' })).toBeInTheDocument()
    expect(screen.getAllByText(/64\.00/).length).toBeGreaterThan(0)
  })

  it('una talla agotada solo en este color se puede pulsar, y se avisa de la combinación', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConEjes(), '/s/casa-nordica/product/camiseta')

    await screen.findByRole('group', { name: 'Color: Rojo' })
    const m = screen.getByRole('radio', { name: /^M/ })
    // Rojo·M está agotado pero Azul·M no: «M» se vende.
    expect(m).toBeEnabled()
    expect(m).toHaveAccessibleName(expect.stringContaining('no disponible con lo elegido'))

    await user.click(m)
    // No se cambia el color a espaldas del comprador: queda Rojo·M, agotado.
    expect(await screen.findByRole('group', { name: 'Talla: M' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Color: Rojo' })).toBeInTheDocument()
    expect(
      screen.getByText('Esta combinación está agotada. Prueba con otra opción.'),
    ).toBeInTheDocument()
    expect(botonComprarDeLaFicha()).toBeDisabled()
  })

  it('al carrito va la combinación elegida', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConEjes(), '/s/casa-nordica/product/camiseta')

    await user.click(await screen.findByRole('radio', { name: /^Azul/ }))
    await user.click(await screen.findByRole('radio', { name: /^M/ }))
    const comprar = botonComprarDeLaFicha()
    await waitFor(() => expect(comprar).toBeEnabled())
    await user.click(comprar)

    await waitFor(() => {
      const guardado = localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)
      expect(guardado).toContain(V_AZUL_M)
    })
  })
})

describe('vista rápida de un producto con variantes', () => {
  it('se elige y se compra sin salir del catálogo', async () => {
    const user = userEvent.setup()
    renderStorefront(backendConEjes(), '/s/casa-nordica?p=camiseta')

    const dialogo = await screen.findByRole('dialog', {}, { timeout: 4000 })
    await user.click(await within(dialogo).findByRole('radio', { name: /^Azul/ }))
    await user.click(within(dialogo).getByRole('radio', { name: /^M/ }))
    const comprar = within(dialogo).getByRole('button', { name: /Agregar al carrito/ })
    await waitFor(() => expect(comprar).toBeEnabled())
    await user.click(comprar)

    await waitFor(() => {
      const guardado = localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)
      expect(guardado).toContain(V_AZUL_M)
    })
  })

  it('la ficha completa sigue a un clic, pero ya no es el único camino para elegir', async () => {
    renderStorefront(backendConEjes(), '/s/casa-nordica?p=camiseta')

    const dialogo = await screen.findByRole('dialog', {}, { timeout: 4000 })
    expect(await within(dialogo).findByRole('group', { name: 'Color: Rojo' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('link', { name: /Ver ficha completa/ })).toHaveAttribute(
      'href',
      '/s/casa-nordica/product/camiseta',
    )
    expect(within(dialogo).queryByRole('link', { name: /Elegir opciones/ })).not.toBeInTheDocument()
  })
})

/**
 * Storefront V3 · P09 · El catálogo en el teléfono, y el de escritorio intacto.
 *
 * ## Qué defiende este bloque
 *
 * **Que el teléfono no reciba una columna de filtros antes de los productos.**
 * Era el fallo concreto: quien buscaba algo veía primero marcas, familias e
 * interruptores, y los resultados empezaban pasada la primera pantalla.
 *
 * **Que no se recorte ninguna opción por caber en un cajón.** El panel que se
 * abre es el MISMO componente, con los mismos filtros y las mismas facetas.
 *
 * **Que el estado siga viviendo en la URL.** Es lo que hace que una búsqueda
 * filtrada se comparta, que atrás deshaga y que recargar no borre nada. Un
 * cajón con su propio estado interno rompería las tres cosas.
 *
 * **Que el conteo siga siendo el de los resultados.** Ni recomendados, ni
 * familias, ni marcas de la salida de abajo.
 */
describe('el catálogo en el teléfono', () => {
  /** Espera a que el cajón esté montado y lo devuelve. */
  async function abrirCajon(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Filtros/ }))
    return await waitFor(() => {
      const encontrado = document.querySelector('[data-filter-drawer]')
      expect(encontrado).not.toBeNull()
      return encontrado as HTMLElement
    })
  }

  it('la barra ofrece Filtros y Ordenar, y el panel largo no va antes de los productos', async () => {
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    expect(document.querySelector('[data-catalog-toolbar]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()

    // La columna de filtros no se pinta hasta escritorio: en el teléfono iba
    // ENCIMA de los productos, y eso era media pantalla de interruptores antes
    // del primer resultado.
    const columna = document.querySelector('[data-filter-frame="columna"]') as HTMLElement
    expect(columna).not.toBeNull()
    // Y la barra —con los productos justo debajo— va ANTES que la columna en
    // el documento, que es el orden que recorre un lector de pantalla y el que
    // sigue el tabulador. Con los filtros primero, llegar al primer producto
    // costaba treinta tabulaciones.
    const barra = document.querySelector('[data-catalog-toolbar]') as HTMLElement
    expect(barra.compareDocumentPosition(columna) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('el cajón se abre con el MISMO panel, sin recortar filtros', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    // Antes de abrirlo no está montado: su módulo llega con el primer clic.
    expect(document.querySelector('[data-filter-drawer]')).toBeNull()

    const cajon = await abrirCajon(user)

    // El panel entero: los dos interruptores de estado y las listas de facetas.
    expect(within(cajon).getByText('Solo en oferta')).toBeInTheDocument()
    expect(within(cajon).getByText('Solo disponibles')).toBeInTheDocument()
    expect(within(cajon).getByText('Mesas')).toBeInTheDocument()
    // Y su salida, que dice lo que hace.
    expect(within(cajon).getByRole('button', { name: /Ver resultados/ })).toBeInTheDocument()
  })

  it('se cierra con Escape: es un diálogo, no un panel pegado', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    await abrirCajon(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.querySelector('[data-filter-drawer]')).toBeNull())
  })

  it('filtrar desde el cajón escribe en la URL, como el panel de escritorio', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    const cajon = await abrirCajon(user)
    await user.click(within(cajon).getByText('Solo disponibles'))

    /**
     * El estado vive en la URL —se comparte, atrás lo deshace y recargar no lo
     * borra— y se comprueba por lo que la vitrina enseña: la píldora de lo
     * puesto solo existe si el parámetro llegó, porque sale de leer la URL.
     *
     * No se mira `window.location`: estas pruebas montan un `MemoryRouter`,
     * donde la barra del navegador no se mueve por diseño.
     */
    /**
     * Y se comprueba con el cajón CERRADO, que es la otra mitad de que esto
     * sea un diálogo: mientras está abierto, MUI marca el resto de la página
     * como `aria-hidden`, así que buscar por rol allí no encuentra nada — y eso
     * está bien, es lo que hace que un lector de pantalla no lea dos capas a la
     * vez.
     *
     * El estado vive en la URL —se comparte, atrás lo deshace y recargar no lo
     * borra— y aquí se ve por lo que la vitrina enseña: la píldora de lo puesto
     * solo existe si el parámetro llegó, porque sale de leer la URL. No se mira
     * `window.location`: estas pruebas montan un `MemoryRouter`, donde la barra
     * del navegador no se mueve por diseño.
     */
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.querySelector('[data-filter-drawer]')).toBeNull())
    expect(
      await screen.findByRole('button', { name: 'Quitar Solo disponibles' }),
    ).toBeInTheDocument()
  })

  it('«Quitar filtros» limpia y deja el catálogo, no la portada', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?c=mesas&d=1')
    await screen.findByText('Mesa extensible')

    const cajon = await abrirCajon(user)
    // El único «Quitar filtros» es el del pie del cajón: el panel esconde el
    // suyo ahí dentro, porque dos botones iguales no se distinguen.
    await user.click(within(cajon).getByRole('button', { name: 'Quitar filtros' }))

    // Sigue siendo el CATÁLOGO —quien pulsa «quitar» quiere verlo todo, no
    // volver a la portada— y no queda ninguna píldora puesta.
    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-active-filters]')).toBeNull())
  })

  it('lo puesto se ve en píldoras que se quitan de una, con nombre propio', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica?c=mesas')
    await screen.findByText('Mesa extensible')

    // «Quitar Mesas», no «Mesas»: la píldora de la barra de familias PONE el
    // filtro y esta lo quita, así que no pueden llamarse igual.
    const quitar = screen.getByRole('button', { name: 'Quitar Mesas' })
    expect(document.querySelector('[data-active-filters]')).toHaveAttribute(
      'data-active-filters',
      '1',
    )

    await user.click(quitar)
    // Quitar la familia devuelve el resto del catálogo.
    expect(await screen.findByText('Silla de roble')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-active-filters]')).toBeNull())
  })

  it('el botón de filtros dice cuántos hay puestos', async () => {
    renderStorefront(backend(), '/s/casa-nordica?c=mesas&d=1&oferta=1')
    await screen.findByRole('button', { name: /Filtros/ })

    // Tres: familia, disponibilidad y rebajado. El nombre accesible lo dice,
    // porque un globo con un número no lo lee nadie.
    expect(screen.getByRole('button', { name: 'Filtros (3 activos)' })).toBeInTheDocument()
    expect(document.querySelector('[data-catalog-toolbar]')).toHaveAttribute(
      'data-catalog-toolbar',
      '3',
    )
  })

  it('sin filtros no hay píldoras ni contador', async () => {
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    expect(document.querySelector('[data-active-filters]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
  })
})

describe('el catálogo de escritorio sigue haciendo lo mismo', () => {
  it('la columna de filtros ya no parece una tarjeta de backoffice', async () => {
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    const columna = document.querySelector('[data-filter-frame="columna"]') as HTMLElement
    const estilo = getComputedStyle(columna)
    expect(estilo.boxShadow).toBe('none')
    expect(estilo.borderStyle === '' || estilo.borderStyle === 'none').toBe(true)
  })

  it('el conteo de resultados no se contamina con la salida de abajo', async () => {
    // `ExploreMore` pinta familias y marcas cuando el resultado es escaso, y
    // NUNCA suma al número: son una salida, no resultados.
    renderStorefront(backend(), '/s/casa-nordica?q=extensible')
    await screen.findByText('Mesa extensible')

    const barra = document.querySelector('[data-catalog-toolbar]') as HTMLElement
    expect(barra.textContent).toContain('1 resultado')
    // Y el número coincide con las tarjetas pintadas, que es la comprobación
    // que se rompería el día que algo se sumara a la lista.
    expect(document.querySelectorAll('[data-card-variant]')).toHaveLength(1)

    // La salida existe —un resultado es poco— y no lleva ni un producto: solo
    // familias y marcas, que son navegación. Nadie puede confundir una puerta a
    // «Mesas» con un resultado de su búsqueda.
    const salida = await waitFor(() => {
      const encontrada = document.querySelector('[data-explore-more]')
      expect(encontrada).not.toBeNull()
      return encontrada as HTMLElement
    })
    expect(salida.querySelectorAll('[data-card-variant]')).toHaveLength(0)
  })
})

/**
 * Storefront V3 · P10 · La ficha comercial.
 *
 * ## Qué defiende este bloque
 *
 * **Que la barra de compra del teléfono diga lo MISMO que la columna.** No
 * calcula nada: recibe el precio ya resuelto —con acuerdo comercial si lo hay—
 * y usa el mismo camino al carrito. Dos caminos con dos reglas es cómo se acaba
 * cobrando otro precio del que se enseñó.
 *
 * **Que no exista donde no debe.** En escritorio no se renderiza —no se
 * esconde: no se renderiza, para que un lector de pantalla no anuncie dos
 * botones de «añadir» donde hay uno— y con el producto agotado tampoco.
 *
 * **Que el detalle no invente apartados.** Solo se ofrece lo que existe, y no
 * hay ni una palabra sobre envíos, plazos o devoluciones: la plataforma no
 * conoce esas políticas.
 *
 * **Que la ficha deje de ser una suma de tarjetas.** La galería y la columna de
 * compra ya no van en `Card` con borde y sombra.
 */
describe('la ficha en el teléfono', () => {
  /** Hace creer al navegador simulado que la pantalla es de teléfono. */
  function pantallaDeTelefono() {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        // Lo que pregunta la barra es `(max-width:899.95px)`; cualquier otra
        // consulta —«menos movimiento», por ejemplo— sigue diciendo que no.
        matches: query.includes('max-width'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('la barra de compra enseña el precio y lleva al carrito', async () => {
    pantallaDeTelefono()
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    const barra = await waitFor(() => {
      const encontrada = document.querySelector('[data-purchase-bar]')
      expect(encontrada).not.toBeNull()
      return encontrada as HTMLElement
    })

    /**
     * El mismo precio que la columna de arriba, no uno recalculado.
     *
     * Se normalizan los espacios: el formateador de moneda separa el símbolo
     * del número con un espacio duro (U+00A0), que no es el que se escribe en
     * una prueba.
     */
    const precioEnLaBarra = (barra.textContent ?? '').replace(/\u00a0/g, ' ')
    expect(precioEnLaBarra).toContain('S/ 389.00')

    await user.click(within(barra).getByRole('button', { name: /Agregar al carrito/ }))
    expect(await screen.findByText('Añadido al carrito')).toBeInTheDocument()
  })

  it('en escritorio la barra no se renderiza, no solo se esconde', async () => {
    // `display: none` quita el elemento de la pantalla, no del documento: un
    // lector de pantalla anunciaría dos botones de «añadir» donde hay uno.
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')
    await screen.findByRole('heading', { level: 1, name: 'Silla de roble' })

    expect(document.querySelector('[data-purchase-bar]')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Agregar al carrito/ })).toHaveLength(1)
  })

  it('con el producto agotado no hay barra: un botón apagado ahí no ofrece nada', async () => {
    pantallaDeTelefono()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-lino')
    await screen.findByRole('heading', { level: 1, name: 'Silla de lino' })

    // «Sin stock» sale dos veces —la etiqueta de la columna y la fila de la
    // ficha de datos— y las dos son correctas: una es el estado y la otra el
    // dato. Lo que se comprueba aquí es que NO haya barra.
    expect((await screen.findAllByText('Sin stock')).length).toBeGreaterThan(0)
    expect(document.querySelector('[data-purchase-bar]')).toBeNull()
  })
})

describe('el detalle de la ficha', () => {
  it('ofrece la descripción y los datos, y la primera viene abierta', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    const detalle = await waitFor(() => {
      const zona = document.querySelector('[data-product-details]')
      expect(zona).not.toBeNull()
      return zona as HTMLElement
    })

    // Dos apartados: descripción y datos.
    expect(detalle).toHaveAttribute('data-product-details', '2')
    // Y la descripción abierta: un acordeón todo cerrado esconde que hay algo
    // dentro.
    const cabeceras = within(detalle).getAllByRole('button')
    expect(cabeceras[0]).toHaveAttribute('aria-expanded', 'true')
    expect(within(detalle).getByText(/Roble macizo/)).toBeInTheDocument()
  })

  it('se abre y se cierra con el teclado, porque es un botón de verdad', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    const detalle = await waitFor(() => {
      const zona = document.querySelector('[data-product-details]')
      expect(zona).not.toBeNull()
      return zona as HTMLElement
    })

    const datos = within(detalle).getByRole('button', { name: 'Datos del producto' })
    expect(datos).toHaveAttribute('aria-expanded', 'false')

    datos.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(datos).toHaveAttribute('aria-expanded', 'true'))
  })

  it('no inventa envíos, plazos ni devoluciones', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    const detalle = await waitFor(() => {
      const zona = document.querySelector('[data-product-details]')
      expect(zona).not.toBeNull()
      return zona as HTMLElement
    })

    const texto = (detalle.textContent ?? '').toLowerCase()
    for (const inventado of ['devoluc', 'reembols', 'garantía de', 'días hábiles', 'envío gratis']) {
      expect(texto).not.toContain(inventado)
    }
  })
})

describe('la ficha ya no es una suma de tarjetas', () => {
  it('la galería y la columna de compra no llevan borde ni sombra de tarjeta', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')
    await screen.findByRole('heading', { level: 1, name: 'Silla de roble' })

    const galeria = document.querySelector('[data-pdp-gallery]') as HTMLElement
    const compra = document.querySelector('[data-pdp-purchase]') as HTMLElement
    expect(galeria).not.toBeNull()
    expect(compra).not.toBeNull()

    for (const caja of [galeria, compra]) {
      const estilo = getComputedStyle(caja)
      expect(estilo.boxShadow === '' || estilo.boxShadow === 'none').toBe(true)
    }
  })

  it('las sugerencias son filas de producto, no rejillas de catálogo', async () => {
    // Tres rejillas seguidas al pie de una ficha son doce tarjetas compitiendo
    // con el producto que se está mirando.
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')
    await screen.findByRole('heading', { level: 1, name: 'Silla de roble' })

    const fila = await waitFor(() => {
      const encontrada = document.querySelector('[data-row-layout]')
      expect(encontrada).not.toBeNull()
      return encontrada as HTMLElement
    })
    // Y su salida lleva al catálogo de la familia del producto, que es a donde
    // quiere ir quien descarta esto.
    const salida = within(fila).getAllByRole('link', { name: /Ver todo/ })[0]
    expect(salida).toHaveAttribute('href', '/s/casa-nordica?c=sillas')
  })
})

/**
 * Storefront V3 · P14 · Accesibilidad de lo que V3 añadió, junto.
 *
 * Seis piezas nuevas con superficie de interacción —el cajón de filtros, la
 * barra del catálogo, la barra de compra, la zona de detalle, la barra de avisos
 * y el muro de logotipos— y cada una podía haber traído su propio fallo: un
 * diálogo sin nombre, dos controles con el mismo nombre, un encabezado de más.
 *
 * Lo que se comprueba aquí es lo que no cubren las pruebas de cada fase por
 * separado: que **al juntarlas** la página sigue teniendo un solo `h1` y que
 * ningún par de controles tabulables comparte nombre accesible.
 */
describe('V3 no rompió el árbol de accesibilidad', () => {
  /** Los nombres accesibles de los botones que se pueden tabular. */
  function nombresDeBotones(): string[] {
    return screen
      .getAllByRole('button')
      .filter((control) => control.getAttribute('tabindex') !== '-1')
      .map((control) => (control.getAttribute('aria-label') ?? control.textContent ?? '').trim())
      .filter((nombre) => nombre !== '')
  }

  it('la portada tiene un solo `h1` con todo encendido', async () => {
    // El fallo clásico de una fase de UI: una sección nueva que se declara `h1`
    // «porque es importante» y deja la página con dos.
    renderStorefront(backend(), '/s/casa-nordica')
    await screen.findByText('Silla de roble')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('el catálogo también, y su columna de filtros es una región con nombre', async () => {
    renderStorefront(backend(), '/s/casa-nordica?ver=todo')
    await screen.findByText('Silla de roble')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // `aside` con nombre: es lo que permite saltársela con un lector de pantalla.
    expect(await screen.findByRole('complementary', { name: 'Filtros' })).toBeInTheDocument()
  })

  it('en el catálogo ningún par de controles tabulables se llama igual', async () => {
    /**
     * Es la comprobación que cazó dos fallos reales de V3: la píldora que quita
     * un filtro se llamaba igual que la que lo pone —efectos opuestos, mismo
     * nombre— y la barra de compra duplicaba «Agregar al carrito».
     *
     * Se excluyen los nombres que llevan dentro el nombre de un producto: un
     * botón de añadir por tarjeta es correcto y se distingue por ahí.
     */
    renderStorefront(backend(), '/s/casa-nordica?ver=todo&c=mesas')
    await screen.findByText('Mesa extensible')

    const cuenta = new Map<string, number>()
    for (const nombre of nombresDeBotones()) {
      cuenta.set(nombre, (cuenta.get(nombre) ?? 0) + 1)
    }

    const repetidos = [...cuenta.entries()]
      .filter(([nombre, veces]) => veces > 1 && !/Silla|Mesa/.test(nombre))
      .map(([nombre, veces]) => `${nombre} ×${veces}`)

    expect(repetidos).toEqual([])
  })

  it('la ficha tiene un solo `h1` y su detalle son botones con estado', async () => {
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')
    await screen.findByRole('heading', { level: 1, name: 'Silla de roble' })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    const detalle = await waitFor(() => {
      const zona = document.querySelector('[data-product-details]')
      expect(zona).not.toBeNull()
      return zona as HTMLElement
    })
    // Cada apartado es un botón con `aria-expanded`: es lo que un lector de
    // pantalla necesita para decir si está abierto.
    for (const cabecera of within(detalle).getAllByRole('button')) {
      expect(cabecera).toHaveAttribute('aria-expanded')
    }
  })
})

/**
 * Storefront V3 · P14 · Ningún comentario de código acaba pintado.
 *
 * ## El fallo, que ocurrió de verdad
 *
 * En JSX, `//` solo es un comentario donde hay JavaScript: en la lista de
 * atributos de una etiqueta, o justo después de un `return (`. En la posición de
 * los HIJOS es **texto**, y el navegador lo pinta.
 *
 * Pasó en la ficha de producto al cerrar P10. El comentario que explica el
 * `role="group"` del grupo de compra llevaba tiempo justo después del `return (`
 * de `AddToCart`, donde era código. Al envolver ese retorno en un fragmento
 * —para añadir la barra de compra del teléfono— quedó DENTRO del fragmento, y
 * cuatro líneas sobre lectores de pantalla se pintaron entre la disponibilidad
 * y la barra, en los tres anchos.
 *
 * Ninguna prueba de unidad lo vio: el texto de sobra no rompía una sola
 * aserción. Lo cazó la matriz visual de P13 al mirar la captura.
 *
 * ## Por qué esta prueba y no una regla de linter
 *
 * La regla de la comunidad es `react/jsx-no-comment-textnodes`, de
 * `eslint-plugin-react`, que este repo no tiene; añadir la dependencia por una
 * regla era más cambio que esto. Y escribirla a mano sobre el TEXTO del archivo
 * no funciona: `return <LoadingState />` seguido de un comentario a nivel de
 * sentencia es indistinguible, sin analizar el árbol, de un comentario en
 * posición de hijos. Se intentó y daba doce falsos positivos.
 *
 * Aquí se mira el RENDER, que es donde el fallo se manifiesta y donde no hay
 * ambigüedad posible.
 *
 * ## La firma que se busca
 *
 * El acento invertido. Los comentarios de este repo están llenos de ellos
 * —`` `role="group"` ``, `` `auto` ``, `` `50vw` ``— y **ningún** texto de
 * interfaz usa uno: las comillas de la copia son «angulares». Es un marcador
 * limpio, sin falsos positivos, y cubre la clase entera.
 */
describe('ningún comentario de código se pinta en la vitrina', () => {
  it.each([
    ['la portada', '/s/casa-nordica'],
    ['el catálogo', '/s/casa-nordica?ver=todo'],
    ['la ficha', '/s/casa-nordica/product/silla-roble'],
  ])('%s no enseña acentos invertidos ni rutas de comentario', async (_donde, ruta) => {
    renderStorefront(backend(), ruta)
    // Cualquiera de las dos, y puede salir varias veces: basta con que la
    // pantalla haya resuelto para poder leer su texto entero.
    await waitFor(() =>
      expect(screen.getAllByText(/Silla de roble|Mesa extensible/).length).toBeGreaterThan(0),
    )

    const visible = document.body.textContent ?? ''

    // El acento invertido: marcador de código, nunca de copia.
    expect(visible).not.toContain('`')

    /**
     * Y una barra doble que no venga de una URL. Se permiten `http://` y
     * `https://` porque un enlace legítimo del comercio los lleva; cualquier
     * otra `//` en texto visible es una línea de comentario que se escapó.
     */
    const sinUrls = visible.replace(/https?:\/\//g, '')
    expect(sinUrls).not.toContain('//')
  })
})
