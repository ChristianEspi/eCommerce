import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makePlatformContext,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * El editor de contenido en pantalla (P11-SaaS).
 *
 * Lo que se comprueba aquí no es la resolución —eso vive en el servidor y se
 * prueba contra Postgres real en `supabase/tests/cms-content.test.ts`— sino las
 * cinco cosas que solo se ven montando el árbol:
 *
 *  1. que es UNA pantalla con pestañas y un solo buscador por listado (§8);
 *  2. que está gateada por lo que la sociedad CONTRATÓ;
 *  3. que el listado enseña el estado EFECTIVO y los bloques VIVOS, que son las
 *     dos cifras que evitan publicar una portada en blanco;
 *  4. que el alta **no manda ningún campo de tenant**, que es la regla que
 *     sostiene el aislamiento;
 *  5. y que la vista previa pinta con los MISMOS componentes que la vitrina.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CapabilitiesProvider } = await import('@/features/capabilities/CapabilitiesProvider')
const { CapabilityGate } = await import('@/features/capabilities/CapabilityGate')
const { ContentPage } = await import('./ContentPage')

const PAGE_ID = '99999999-9999-4999-8999-999999999901'
const BLOCK_ID = '99999999-9999-4999-8999-999999999902'
const SYNONYM_ID = '99999999-9999-4999-8999-999999999903'
const PRODUCT_ID = '99999999-9999-4999-8999-999999999904'
const PROMO_ID = '99999999-9999-4999-8999-999999999905'
const BLOCK_2_ID = '99999999-9999-4999-8999-999999999906'

const CMS = ['ecommerce.content.cms']

const PAGE = {
  id: PAGE_ID,
  organization_id: ORG,
  company_id: COMPANY_A,
  store_id: STORE_A,
  slug: 'inicio',
  title: 'Portada de verano',
  kind: 'home',
  status: 'published',
  effective_status: 'live',
  channel_id: null,
  channel_code: null,
  channel_name: null,
  priority: 10,
  publish_from: '2026-06-01T00:00:00.000Z',
  publish_to: null,
  show_in_nav: false,
  nav_position: 0,
  seo_title: null,
  seo_description: null,
  og_image_url: null,
  block_count: 3,
  active_block_count: 2,
  live_block_count: 1,
  updated_at: '2026-08-20T10:00:00.000Z',
}

const BLOCK = {
  id: BLOCK_ID,
  page_id: PAGE_ID,
  store_id: STORE_A,
  block_type: 'hero',
  position: 0,
  title: 'Rebajas de verano',
  subtitle: 'Hasta el 30 %',
  body: null,
  media_url: null,
  media_alt: null,
  cta_label: null,
  cta_href: null,
  promotion_id: null,
  category_id: null,
  item_limit: 8,
  is_active: true,
  publish_from: '2026-06-01T00:00:00.000Z',
  publish_to: null,
  channel_id: null,
  segment_id: null,
  settings: { columns: 4 },
}

/**
 * Un segundo bloque, y con la posición ESPACIADA a proposito.
 *
 * Las posiciones reales van de cinco en cinco (5, 10, 15…) porque asi se puede
 * intercalar sin renumerar la portada entera. Con dos bloques pegados —0 y 1—
 * el fallo que se arregla aqui no se veria: era justo el salto lo que obligaba
 * a pulsar la flecha cinco veces para moverse un sitio.
 */
const BLOCK_2 = {
  ...BLOCK,
  id: BLOCK_2_ID,
  block_type: 'rich_text',
  position: 10,
  title: 'Quiénes somos',
  body: [{ type: 'paragraph', text: 'Una botica de barrio.' }],
}

const SYNONYM = {
  id: SYNONYM_ID,
  store_id: STORE_A,
  term: 'tenis',
  term_normalized: 'tenis',
  expansions: ['zapatilla', 'championes'],
  is_active: true,
  updated_at: '2026-08-20T10:00:00.000Z',
}

function backend(options: { entitlements?: string[]; role?: string } = {}): FakeSupabase {
  const entitlements = options.entitlements ?? CMS
  const role = options.role ?? 'admin'
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'mi-negocio',
          name: 'Mi Negocio',
          status: 'active',
          currency: 'PEN',
        },
      ],
      content_page_overview: [PAGE],
      promotion_overview: [
        {
          id: PROMO_ID,
          store_id: STORE_A,
          name: 'Rebajas de verano',
          code: 'verano',
          effective_status: 'expired',
        },
      ],
      content_pages: [PAGE],
      // Copias: el falso actualiza la fila EN SITIO, así que compartir el
      // objeto del módulo dejaría que un test arrastrara la posición al
      // siguiente.
      content_blocks: [{ ...BLOCK }, { ...BLOCK_2 }],
      content_block_items: [],
      search_synonyms: [SYNONYM],
    },
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements, source: 'hub' }),
      content_preview: () => ({
        cms: true,
        preview: true,
        store_id: STORE_A,
        page: {
          id: PAGE_ID,
          slug: 'inicio',
          title: 'Portada de verano',
          kind: 'home',
          status: 'published',
          seo_title: null,
          seo_description: null,
          og_image_url: null,
        },
        draft: false,
        blocks: [
          {
            id: BLOCK_ID,
            type: 'hero',
            position: 0,
            title: 'Rebajas de verano',
            subtitle: 'Hasta el 30 %',
            body: null,
            media_url: null,
            media_alt: null,
            cta_label: null,
            cta_href: null,
            settings: {},
            is_active: true,
            category_id: null,
            campaign: null,
            items: [],
          },
        ],
      }),
      catalog_search: () => ({
        items: [
          {
            product_id: PRODUCT_ID,
            slug: 'toalla',
            name: 'Toalla de playa',
            description: null,
            kind: 'simple',
            brand_name: null,
            category_slug: null,
            category_name: null,
            price: '25.00',
            compare_at_price: null,
            price_from: '25.00',
            currency: 'PEN',
            in_stock: true,
            image_path: null,
            image_alt: null,
            published: false,
            score: '1',
          },
        ],
        total: 1,
        limit: 12,
        offset: 0,
        sort: 'relevance',
        mode: 'fts',
        query: 'toalla',
        facets: {
          categories: [],
          brands: [],
          attributes: [],
          price: { min: null, max: null },
          availability: { in_stock: 1, total: 1 },
        },
      }),
    },
  })
}

function renderContent(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CapabilityGate capability="content.cms">
          <ContentPage />
        </CapabilityGate>
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
  // Las pestañas hacen deep-link con `#hash`: sin limpiarlo, el test anterior
  // decide qué pestaña abre el siguiente.
  window.history.replaceState(null, '', '/')
})

describe('Contenido — la pantalla', () => {
  it('es UNA pantalla con cuatro pestañas centradas, no cuatro entradas de menú', async () => {
    renderContent(backend())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Páginas',
      'Bloques',
      'Vista previa',
      'Sinónimos',
    ])
  })

  it('sin el addon `content.cms` no se monta: enseña que no está en el plan', async () => {
    renderContent(backend({ entitlements: [] }))
    expect(await screen.findByText(/no está en tu plan|no incluye/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Páginas' })).not.toBeInTheDocument()
  })

  it('un miembro sin rol de administración ve un estado de permiso, no el editor', async () => {
    renderContent(backend({ role: 'catalog' }))
    expect(await screen.findByText('No puedes editar el contenido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva página' })).not.toBeInTheDocument()
  })
})

describe('el listado de páginas', () => {
  it('enseña el estado EFECTIVO y los bloques VIVOS sobre el total', async () => {
    renderContent(backend())

    const row = (await screen.findByText('Portada de verano')).closest('tr') as HTMLElement
    expect(within(row).getByText('/inicio')).toBeInTheDocument()
    expect(within(row).getByText('Publicada')).toBeInTheDocument()
    // La cifra que evita publicar una portada en blanco: un bloque vivo de tres.
    expect(within(row).getByText('1 / 3')).toBeInTheDocument()
  })

  it('tiene UN buscador general, no un panel de filtros multi-campo', async () => {
    renderContent(backend())
    await screen.findByText('Portada de verano')

    const boxes = screen.getAllByRole('searchbox')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toHaveAttribute('aria-label', 'Buscar por título o dirección')
  })

  it('el alta NO manda ningún campo de tenant, ni el estado del dominio', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)
    await screen.findByText('Portada de verano')

    await user.click(screen.getByRole('button', { name: 'Nueva página' }))
    // El campo es obligatorio, así que MUI le añade un asterisco a la etiqueta.
    // Se busca por ROL y nombre accesible, que ignora ese asterisco decorativo.
    await user.type(screen.getByRole('textbox', { name: 'Título' }), 'Rebajas')
    await user.type(screen.getByRole('textbox', { name: 'Dirección' }), 'rebajas')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    const inserted = fake.state.tables.content_pages?.find(
      (row) => (row as Record<string, unknown>).slug === 'rebajas',
    ) as Record<string, unknown> | undefined
    expect(inserted).toBeDefined()

    // El navegador SÍ manda el alcance —organización, sociedad y tienda— porque
    // la fila los necesita; lo que la RLS garantiza es que solo puede mandar los
    // SUYOS. Lo que no puede mandar es nada que decida por su cuenta, y en esta
    // tabla eso es el estado de publicación efectivo, que no existe como
    // columna: se deriva del reloj.
    expect(Object.keys(inserted ?? {})).not.toContain('effective_status')
    expect(Object.keys(inserted ?? {})).not.toContain('live_block_count')
    expect(inserted?.organization_id).toBe(ORG)
    expect(inserted?.company_id).toBe(COMPANY_A)
  })
})

describe('los bloques', () => {
  it('sin página elegida invita a elegirla, en vez de enseñar una tabla vacía', async () => {
    const user = userEvent.setup()
    renderContent(backend())
    await screen.findByText('Portada de verano')

    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    expect(await screen.findByText('Elige una página')).toBeInTheDocument()
  })

  it('con la página elegida lista sus bloques en orden', async () => {
    const user = userEvent.setup()
    renderContent(backend())

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))

    expect(await screen.findByText('Rebajas de verano')).toBeInTheDocument()
    expect(screen.getByText('Hero')).toBeInTheDocument()
  })

  /**
   * Ordenar la portada.
   *
   * Lo que lo destapó: las flechas sumaban y restaban UNO a la posición, y las
   * posiciones vienen espaciadas de cinco en cinco para poder intercalar sin
   * renumerar. Resultado: bajar un bloque un sitio pedía cinco clics, y llevar
   * el último al principio, veinticinco.
   */
  async function abrirBloques(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await screen.findByText('Rebajas de verano')
  }

  function posiciones(fake: FakeSupabase): Record<string, number> {
    const rows = (fake.state.tables.content_blocks ?? []) as Array<{
      title: string
      position: number
    }>
    return Object.fromEntries(rows.map((row) => [row.title, row.position]))
  }

  it('la flecha INTERCAMBIA con la vecina: un clic, un sitio', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)
    await abrirBloques(user)

    await user.click(screen.getByRole('button', { name: /Bajar Rebajas de verano/ }))

    // Y no 0 → 1, que con la vecina en 10 dejaba el bloque donde estaba.
    await waitFor(() =>
      expect(posiciones(fake)).toEqual({ 'Rebajas de verano': 10, 'Quiénes somos': 0 }),
    )
  })

  it('la posición se escribe: el número va directo, sin pasar por las flechas', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)
    await abrirBloques(user)

    const campo = screen.getByRole('spinbutton', { name: /Posición de Rebajas de verano/ })
    await user.clear(campo)
    await user.type(campo, '99')
    await user.tab()

    await waitFor(() => expect(posiciones(fake)['Rebajas de verano']).toBe(99))
  })

  it('un número que ya tiene otro bloque se rechaza, y el campo vuelve al suyo', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)
    await abrirBloques(user)

    const campo = screen.getByRole('spinbutton', { name: /Posición de Rebajas de verano/ })
    await user.clear(campo)
    await user.type(campo, '10')
    await user.tab()

    // La base admite dos bloques con el mismo número —no hay índice único— y
    // entonces el orden entre ellos deja de estar definido: la portada se pinta
    // hoy de una forma y mañana de otra sin que nadie haya tocado nada.
    expect(
      await screen.findByText('Ese número ya lo tiene otro bloque. Elige uno libre.'),
    ).toBeInTheDocument()
    expect(posiciones(fake)['Rebajas de verano']).toBe(0)
    // Y no se queda escrito el número que no se guardó: dejarlo ahí es la forma
    // más rápida de cerrar la pantalla creyendo haber ordenado la portada.
    expect(campo).toHaveValue(0)
  })

  it('un número fuera del rango del CHECK no se envía', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)
    await abrirBloques(user)

    const campo = screen.getByRole('spinbutton', { name: /Posición de Rebajas de verano/ })
    await user.clear(campo)
    await user.type(campo, '1500')
    await user.tab()

    // `content_blocks_position_range` es 0..999. Pararlo aquí convierte un 400
    // genérico en un campo que vuelve solo.
    expect(posiciones(fake)['Rebajas de verano']).toBe(0)
  })

  it('el editor de texto explica la sintaxis y NO admite etiquetas', async () => {
    const user = userEvent.setup()
    renderContent(backend())

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await screen.findByText('Rebajas de verano')
    await user.click(screen.getByRole('button', { name: 'Nuevo bloque' }))

    // El editor viaja en su propio chunk (`lazy`): hasta que resuelve hay un
    // esqueleto, asi que se espera en vez de mirar el primer pintado. Con la
    // suite entera en paralelo, resolver ese import pasa de los 5 s globales.
    expect(
      await screen.findByText(/No se admiten etiquetas HTML/, {}, { timeout: 15_000 }),
    ).toBeInTheDocument()
  })

  it('un botón sin destino no deja guardar, y lo dice antes de enviar', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await screen.findByText('Rebajas de verano')
    await user.click(screen.getByRole('button', { name: 'Nuevo bloque' }))

    // El título primero: sin él, la incidencia que se enseña es la de FORMA
    // («un hero necesita título o imagen»), que es la correcta pero no la que
    // este test persigue.
    await user.type(screen.getByLabelText('Título'), 'Rebajas')
    await user.type(screen.getByLabelText('Texto del botón'), 'Ver ofertas')

    expect(
      await screen.findByText('Un botón necesita texto y destino, o ninguno de los dos.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('un destino ejecutable tampoco: la mitad de cliente del CHECK', async () => {
    const user = userEvent.setup()
    renderContent(backend())

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await screen.findByText('Rebajas de verano')
    await user.click(screen.getByRole('button', { name: 'Nuevo bloque' }))

    await user.type(screen.getByLabelText('Título'), 'Rebajas')
    await user.type(screen.getByLabelText('Texto del botón'), 'Ver')
    await user.type(screen.getByLabelText('Destino del botón'), 'javascript:alert(1)')

    expect(
      await screen.findByText('Solo https, rutas internas, mailto o tel.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})

describe('el bloque de campaña', () => {
  it('deja elegir la campaña y enseña su estado EFECTIVO al lado', async () => {
    const user = userEvent.setup()
    renderContent(backend())

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await screen.findByText('Rebajas de verano')
    await user.click(screen.getByRole('button', { name: 'Nuevo bloque' }))

    // El desplegable de campañas solo existe para el bloque que las anuncia.
    expect(screen.queryByLabelText('Campaña que anuncia')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Tipo'))
    await user.click(await screen.findByRole('option', { name: 'Campaña' }))

    await user.click(await screen.findByLabelText('Campaña que anuncia'))
    // Anunciar una campaña caducada es un error caro y silencioso: el estado va
    // pegado al nombre, que es donde se elige.
    expect(await screen.findByRole('option', { name: /Rebajas de verano · Caducada/ })).toBeInTheDocument()
  })
})

describe('el selector de productos: el SearchPort del backoffice', () => {
  it('busca en el catálogo y marca lo que todavía no está publicado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    fake.state.tables.content_blocks = [
      { ...BLOCK, id: BLOCK_ID, block_type: 'product_collection', title: 'Destacados' },
    ]
    renderContent(fake)

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await user.click(await screen.findByRole('button', { name: 'Productos' }))

    await user.type(screen.getByLabelText('Buscar en el catálogo'), 'toalla')

    expect(await screen.findByText('Toalla de playa')).toBeInTheDocument()
    // Poder añadir a la portada algo todavía en borrador es deliberado: se
    // prepara la campaña antes de publicar el catálogo. Por eso se MARCA.
    expect(screen.getByText('Sin publicar')).toBeInTheDocument()

    expect(fake.state.rpcCalls.map((call) => call.name)).toContain('catalog_search')
  })
})

describe('la vista previa', () => {
  it('pide la MISMA resolución que la vitrina y pinta el bloque', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Vista previa' }))

    expect(await screen.findByRole('heading', { name: 'Rebajas de verano' })).toBeInTheDocument()
    expect(fake.state.rpcCalls.map((call) => call.name)).toContain('content_preview')
  })

  it('el interruptor cambia entre «como lo edito» y «como se verá»', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderContent(fake)

    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Vista previa' }))
    await screen.findByRole('heading', { name: 'Rebajas de verano' })

    await user.click(screen.getByRole('checkbox', { name: /como lo verá el comprador/i }))

    const previews = fake.state.rpcCalls.filter((call) => call.name === 'content_preview')
    expect(previews.at(-1)?.args.p_include_drafts).toBe(false)
  })
})

describe('los sinónimos', () => {
  it('enseñan la forma normalizada del término, que es la que indexa la base', async () => {
    const user = userEvent.setup()
    renderContent(backend())
    await screen.findByText('Portada de verano')

    await user.click(screen.getByRole('tab', { name: 'Sinónimos' }))

    // «tenis» sale dos veces en la fila: el término tal y como se escribió y su
    // forma NORMALIZADA debajo, que es la que el índice único usa. Que se vean
    // las dos es justo lo que evita el error de clave duplicada que nadie
    // entiende (lección de los cupones de P10).
    const cells = await screen.findAllByText('tenis')
    expect(cells).toHaveLength(2)
    const row = cells[0]?.closest('tr') as HTMLElement
    expect(within(row).getByText('zapatilla')).toBeInTheDocument()
    expect(within(row).getByText('championes')).toBeInTheDocument()
  })

  it('sin equivalencias no deja guardar: un sinónimo de nada no es un sinónimo', async () => {
    const user = userEvent.setup()
    renderContent(backend())
    await screen.findByText('Portada de verano')

    await user.click(screen.getByRole('tab', { name: 'Sinónimos' }))
    await user.click(await screen.findByRole('button', { name: 'Nuevo sinónimo' }))
    await user.type(screen.getByLabelText(/^Término/), 'botin')

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByText('Escribe al menos una equivalencia.')).toBeInTheDocument()
  })
})

/**
 * Storefront V3 · P08 · El desplegable de composición.
 *
 * Lo que se defiende aquí no es el widget: es que el comercio pueda elegir la
 * composición **de su tipo de bloque** y que lea nombres, no valores técnicos.
 * `photo-grid` en un desplegable es una fuga de la implementación.
 */
describe('cómo se enseña un bloque', () => {
  async function abrirNuevoBloque(user: ReturnType<typeof userEvent.setup>) {
    renderContent(backend())
    await user.click(await screen.findByText('Portada de verano'))
    await user.click(screen.getByRole('tab', { name: 'Bloques' }))
    await screen.findByText('Rebajas de verano')
    await user.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
  }

  it('un hero no lo pregunta: no elige composición', async () => {
    const user = userEvent.setup()
    await abrirNuevoBloque(user)

    // El formulario se abre en «Portada», que no tiene disposición que elegir.
    expect(screen.queryByLabelText('Disposición')).toBeNull()
  })

  it('una colección de productos ofrece las cinco, con nombres y no con valores', async () => {
    const user = userEvent.setup()
    await abrirNuevoBloque(user)

    await user.click(screen.getByLabelText('Tipo'))
    await user.click(await screen.findByRole('option', { name: 'Colección de productos' }))

    await user.click(screen.getByLabelText('Disposición'))
    const opciones = (await screen.findAllByRole('option')).map((opcion) => opcion.textContent)
    expect(opciones).toEqual([
      'Rejilla — todos del mismo tamaño',
      'Fila — se desplaza de lado',
      'Editorial — foto grande, sin caja',
      'Destacado — el primero manda',
      'Mensaje al lado — texto y productos',
    ])
  })

  it('una colección de familias ofrece las suyas, no las de los productos', async () => {
    const user = userEvent.setup()
    await abrirNuevoBloque(user)

    await user.click(screen.getByLabelText('Tipo'))
    await user.click(await screen.findByRole('option', { name: 'Colección de categorías' }))

    await user.click(screen.getByLabelText('Disposición'))
    const opciones = (await screen.findAllByRole('option')).map((opcion) => opcion.textContent)
    // Y «Rejilla de fotos», que es lo que el comercio entiende de `photo-grid`.
    expect(opciones).toContain('Rejilla de fotos — todas a la vez')
    expect(opciones).not.toContain('Fila — se desplaza de lado')
    expect(opciones.join(' ')).not.toMatch(/photo-grid/)
  })
})
