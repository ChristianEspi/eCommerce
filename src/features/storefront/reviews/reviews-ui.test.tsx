import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Opiniones en la ficha (cierre), sobre el árbol real.
 *
 * Lo que se defiende:
 *
 *  1. resumen y lista salen de la función pública, con sus estados de carga,
 *     vacío y error, y la lista pagina;
 *  2. «Compra verificada» se pinta cuando el SERVIDOR lo dice, y el navegador
 *     nunca lo manda: el envío lleva cuatro campos y ninguno más;
 *  3. sin sesión se invita a entrar; con sesión el formulario valida antes de
 *     enviar y enseña el estado de la reseña propia (pendiente, rechazada);
 *  4. un rechazo del servidor se cuenta por su código, no por su texto.
 *
 * Que la compra verificada no se pueda falsificar, que lo pendiente no se vea y
 * quién modera se comprueba contra Postgres en
 * `supabase/tests/product-reviews.test.ts`.
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
const { StoreProductPage } = await import('../StoreProductPage')
const { validateReviewDraft } = await import('./api')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const P_SILLA = 'cccc1111-1111-4111-8111-111111111111'
const R1 = 'eeee1111-1111-4111-8111-111111111111'
const R2 = 'eeee2222-1111-4111-8111-111111111111'

function store() {
  return {
    store_id: STORE,
    slug: 'casa-nordica',
    name: 'Casa Nórdica',
    currency: 'PEN',
    accent_color: '#056769',
    logo_url: null,
    white_label: false,
    default_locale: 'es',
    support_email: null,
    banner_url: null,
    hero_title: null,
    hero_subtitle: null,
    contact_phone: null,
    contact_address: null,
  }
}

function silla() {
  return {
    product_id: P_SILLA,
    store_id: STORE,
    category_id: null,
    slug: 'silla-roble',
    name: 'Silla de roble',
    description: 'Roble macizo.',
    price: '100.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-20T00:00:00.000Z',
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
  }
}

function pagina(overrides: Record<string, unknown> = {}) {
  return {
    summary: { count: 2, average: '4.50', distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 } },
    reviews: [
      {
        review_id: R1,
        display_name: 'Ana C.',
        rating: 5,
        title: 'Excelente',
        body: 'Muy cómoda y bien terminada.',
        verified_purchase: true,
        published_at: '2026-09-10T00:00:00.000Z',
      },
      {
        review_id: R2,
        display_name: null,
        rating: 4,
        title: null,
        body: 'Llegó rápido, buena madera.',
        verified_purchase: false,
        published_at: '2026-09-09T00:00:00.000Z',
      },
    ],
    page: 1,
    page_size: 5,
    total: 2,
    ...overrides,
  }
}

function backend(rpc: Record<string, (args: Record<string, unknown>) => unknown>, session = false): FakeSupabase {
  return createFakeSupabase({
    ...(session ? { session: makeSession({ withTenantClaims: false }) } : {}),
    rpc: { product_relations_for_slug: () => [], ...rpc },
    tables: {
      public_stores: [store()],
      public_categories: [],
      public_products: [silla()],
      public_product_images: [],
    },
  })
}

function renderFicha(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route path="product/:productSlug" element={<StoreProductPage />} />
      </Route>
    </Routes>,
    { route: '/s/casa-nordica/product/silla-roble', session: fake.state.session },
  )
}

async function opiniones(): Promise<HTMLElement> {
  return (await screen.findByRole('region', { name: 'Opiniones' })) as HTMLElement
}

beforeEach(() => {
  holder.client = null
})

describe('lista y resumen', () => {
  it('pinta el resumen, las publicadas y la compra verificada que dice el servidor', async () => {
    renderFicha(backend({ product_reviews_for_slug: () => pagina() }))

    const seccion = await opiniones()
    expect(await within(seccion).findByText('Muy cómoda y bien terminada.')).toBeInTheDocument()
    expect(within(seccion).getByText('4,5')).toBeInTheDocument()
    expect(within(seccion).getByText('2 opiniones')).toBeInTheDocument()
    expect(within(seccion).getAllByText('Compra verificada')).toHaveLength(1)
    // Sin nombre para mostrar, «Cliente»: nunca un correo.
    expect(within(seccion).getByText('Cliente')).toBeInTheDocument()
  })

  it('sin opiniones lo dice', async () => {
    renderFicha(
      backend({
        product_reviews_for_slug: () =>
          pagina({
            summary: { count: 0, average: null, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } },
            reviews: [],
            total: 0,
          }),
      }),
    )
    expect(await within(await opiniones()).findByText('Todavía no hay opiniones de este producto.')).toBeInTheDocument()
  })

  it('si falla la lectura lo dice y deja reintentar, y la ficha sigue en pie', async () => {
    const user = userEvent.setup()
    let intentos = 0
    renderFicha(
      backend({
        product_reviews_for_slug: () => {
          intentos += 1
          if (intentos === 1) throw { message: 'TIENDA_NO_DISPONIBLE: x', code: '22023' }
          return pagina()
        },
      }),
    )

    const seccion = await opiniones()
    expect(await within(seccion).findByText('No pudimos cargar las opiniones.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Silla de roble', level: 1 })).toBeInTheDocument()
    await user.click(within(seccion).getByRole('button', { name: 'Reintentar' }))
    expect(await within(seccion).findByText('Muy cómoda y bien terminada.')).toBeInTheDocument()
  })

  it('pagina contra el servidor', async () => {
    const user = userEvent.setup()
    const fake = backend({
      product_reviews_for_slug: (args) => pagina({ total: 7, page: args.p_page }),
    })
    renderFicha(fake)

    const seccion = await opiniones()
    await user.click(await within(seccion).findByRole('button', { name: /página 2|page 2/i }))
    await waitFor(() =>
      expect(
        fake.state.rpcCalls.filter((call) => call.name === 'product_reviews_for_slug').map((call) => call.args.p_page),
      ).toContain(2),
    )
  })
})

describe('el formulario', () => {
  it('sin sesión invita a entrar y no pregunta por la reseña propia', async () => {
    const fake = backend({ product_reviews_for_slug: () => pagina() })
    renderFicha(fake)

    const seccion = await opiniones()
    expect(within(seccion).getByText('Inicia sesión para opinar sobre este producto.')).toBeInTheDocument()
    expect(fake.state.rpcCalls.map((call) => call.name)).not.toContain('my_product_review')
  })

  it('valida antes de enviar y manda solo los cuatro campos', async () => {
    const user = userEvent.setup()
    const enviados: Array<Record<string, unknown>> = []
    const fake = backend(
      {
        product_reviews_for_slug: () => pagina(),
        my_product_review: () => null,
        submit_product_review: (args) => {
          enviados.push(args)
          return {
            review_id: R1,
            rating: 4,
            title: null,
            body: 'Muy buena silla, recomendada.',
            display_name: null,
            status: 'pending',
            verified_purchase: true,
            rejection_reason: null,
          }
        },
      },
      true,
    )
    renderFicha(fake)

    const seccion = await opiniones()
    await user.click(await within(seccion).findByRole('button', { name: 'Enviar opinión' }))
    expect(within(seccion).getByText('Elige de 1 a 5 estrellas.')).toBeInTheDocument()
    expect(within(seccion).getByText('Escribe entre 10 y 2000 caracteres, sin etiquetas.')).toBeInTheDocument()
    expect(enviados).toHaveLength(0)

    fireEvent.click(within(seccion).getByRole('radio', { name: '4 de 5 estrellas' }))
    await user.type(within(seccion).getByLabelText(/¿Qué te pareció\?/), 'Muy buena silla, recomendada.')
    await user.click(within(seccion).getByRole('button', { name: 'Enviar opinión' }))

    expect(await within(seccion).findByText('Gracias. Tu opinión se publicará cuando la revisemos.')).toBeInTheDocument()
    expect(enviados).toHaveLength(1)
    expect(enviados[0]).toMatchObject({ p_store_slug: 'casa-nordica', p_product_id: P_SILLA })
    expect(Object.keys(enviados[0]?.p_review as object).sort()).toEqual(['body', 'display_name', 'rating', 'title'])
    expect(enviados[0]?.p_review).toMatchObject({ rating: 4, body: 'Muy buena silla, recomendada.' })
    // Tras enviar, la propia pasa a «pendiente» con su compra verificada.
    expect(within(seccion).getByText('Pendiente de revisión')).toBeInTheDocument()
  })

  it('enseña la propia rechazada con su motivo, y ofrece actualizarla', async () => {
    renderFicha(
      backend(
        {
          product_reviews_for_slug: () => pagina(),
          my_product_review: () => ({
            review_id: R2,
            rating: 2,
            title: null,
            body: 'Texto que no habla de la silla.',
            display_name: 'Beto P.',
            status: 'rejected',
            verified_purchase: false,
            rejection_reason: 'No habla de este producto.',
          }),
        },
        true,
      ),
    )

    const seccion = await opiniones()
    expect(await within(seccion).findByText('No publicada')).toBeInTheDocument()
    expect(within(seccion).getByText('Motivo: No habla de este producto.')).toBeInTheDocument()
    expect(within(seccion).getByRole('button', { name: 'Actualizar opinión' })).toBeInTheDocument()
  })

  it('un rechazo del servidor se cuenta por su código', async () => {
    const user = userEvent.setup()
    renderFicha(
      backend(
        {
          product_reviews_for_slug: () => pagina(),
          my_product_review: () => null,
          submit_product_review: () => {
            throw { message: 'RESENA_NO_PERMITIDA: el personal de la tienda no puede resenar', code: '42501' }
          },
        },
        true,
      ),
    )

    const seccion = await opiniones()
    fireEvent.click(await within(seccion).findByRole('radio', { name: '5 de 5 estrellas' }))
    await user.type(within(seccion).getByLabelText(/¿Qué te pareció\?/), 'La mejor silla que hay.')
    await user.click(within(seccion).getByRole('button', { name: 'Enviar opinión' }))

    expect(
      await within(seccion).findByText('El personal de la tienda no puede opinar sobre su propio catálogo.'),
    ).toBeInTheDocument()
  })
})

describe('validateReviewDraft', () => {
  const base = { rating: 4, title: '', body: 'Texto suficiente aquí.', displayName: '' }

  it('acepta lo válido', () => {
    expect(validateReviewDraft(base)).toEqual({})
  })

  it.each([
    [{ rating: null }, 'rating'],
    [{ body: '<b>hola</b> mundo mundo' }, 'body'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ displayName: 'ana@correo.com' }, 'displayName'],
    [{ displayName: 'Ana 999' }, 'displayName'],
  ])('rechaza %j', (patch, field) => {
    expect(Object.keys(validateReviewDraft({ ...base, ...patch }))).toContain(field)
  })
})
