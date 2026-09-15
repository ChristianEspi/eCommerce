import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'
import type { PublicProduct } from './types'

/**
 * Relaciones curadas en la ficha (cierre).
 *
 * Lo que se defiende aquí, sobre el árbol real:
 *
 *  1. lo que el comercio relacionó se pinta en su fila —«Completa tu compra»,
 *     «Mejora tu elección», «También te puede interesar»— y en su orden;
 *  2. con relacionados curados, el relleno por categoría NO se mezcla;
 *  3. sin relaciones, o si la función falla, la ficha vuelve al relleno por
 *     categoría de siempre;
 *  4. el reparto es una función pura: sin repetidos y sin el producto abierto.
 *
 * Que la función solo devuelva lo publicado, de la tienda y en su canal se
 * comprueba contra Postgres real en
 * `supabase/tests/storefront-product-relations.test.ts`.
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
const { StoreProductPage } = await import('./StoreProductPage')
const { groupRelatedProducts } = await import('./relations')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const CAT_SILLAS = 'bbbb1111-1111-4111-8111-111111111111'
const P_SILLA = 'cccc1111-1111-4111-8111-111111111111'
const P_LINO = 'cccc2222-1111-4111-8111-111111111111'
const P_COJIN = 'cccc3333-1111-4111-8111-111111111111'
const P_MESA = 'cccc4444-1111-4111-8111-111111111111'
const P_BUTACA = 'cccc5555-1111-4111-8111-111111111111'

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

function producto(id: string, slug: string, name: string, categoryId: string | null = null) {
  return {
    product_id: id,
    store_id: STORE,
    category_id: categoryId,
    slug,
    name,
    description: null,
    price: '100.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-20T00:00:00.000Z',
    in_stock: true,
    category_slug: categoryId ? 'sillas' : null,
    category_name: categoryId ? 'Sillas' : null,
    primary_image_path: null,
    primary_image_alt: null,
  }
}

function catalogo() {
  return [
    producto(P_SILLA, 'silla-roble', 'Silla de roble', CAT_SILLAS),
    // Misma categoría: es lo que el relleno propondría.
    producto(P_LINO, 'silla-lino', 'Silla de lino', CAT_SILLAS),
    producto(P_COJIN, 'cojin-lana', 'Cojín de lana'),
    producto(P_MESA, 'mesa-roble', 'Mesa de roble'),
    producto(P_BUTACA, 'butaca-roble', 'Butaca de roble'),
  ]
}

function backend(relations: () => unknown): FakeSupabase {
  return createFakeSupabase({
    rpc: { product_relations_for_slug: relations },
    tables: {
      public_stores: [store()],
      public_categories: [
        { category_id: CAT_SILLAS, store_id: STORE, slug: 'sillas', name: 'Sillas', position: 1 },
      ],
      public_products: catalogo(),
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
    { route: '/s/casa-nordica/product/silla-roble' },
  )
}

async function seccion(nombre: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: nombre, level: 2 })
  return heading.closest('section') as HTMLElement
}

beforeEach(() => {
  holder.client = null
})

describe('relaciones curadas en la ficha', () => {
  it('pinta cada relación en su fila y no mezcla el relleno por categoría', async () => {
    const fake = backend(() => [
      { related_product_id: P_COJIN, relation_kind: 'accessory', position: 1 },
      { related_product_id: P_MESA, relation_kind: 'related', position: 2 },
      { related_product_id: P_BUTACA, relation_kind: 'up_sell', position: 3 },
    ])
    renderFicha(fake)

    expect(within(await seccion('Completa tu compra')).getByText('Cojín de lana')).toBeInTheDocument()
    expect(within(await seccion('Mejora tu elección')).getByText('Butaca de roble')).toBeInTheDocument()
    const relacionados = await seccion('También te puede interesar')
    expect(within(relacionados).getByText('Mesa de roble')).toBeInTheDocument()
    // Con relacionados curados, la silla de lino —misma categoría— no entra.
    expect(within(relacionados).queryByText('Silla de lino')).not.toBeInTheDocument()

    // La llamada lleva el slug de la URL y el producto: nada de tenant.
    const llamada = fake.state.rpcCalls.find((call) => call.name === 'product_relations_for_slug')
    expect(llamada?.args).toMatchObject({ p_store_slug: 'casa-nordica', p_product_id: P_SILLA })
    expect(Object.keys(llamada?.args ?? {}).sort()).toEqual(['p_kinds', 'p_limit', 'p_product_id', 'p_store_slug'])
  })

  it('sin relaciones curadas vuelve al relleno por categoría', async () => {
    renderFicha(backend(() => []))

    const relacionados = await seccion('También te puede interesar')
    expect(within(relacionados).getByText('Silla de lino')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Completa tu compra' })).not.toBeInTheDocument()
  })

  it('si la función falla, la ficha sigue vendiendo con el relleno', async () => {
    renderFicha(
      backend(() => {
        throw { message: 'TIENDA_NO_DISPONIBLE: x', code: '22023' }
      }),
    )

    const relacionados = await seccion('También te puede interesar')
    expect(within(relacionados).getByText('Silla de lino')).toBeInTheDocument()
  })

  it('solo accesorios curados: salen en su fila y el relleno no los repite', async () => {
    renderFicha(backend(() => [{ related_product_id: P_LINO, relation_kind: 'accessory', position: 0 }]))

    expect(within(await seccion('Completa tu compra')).getByText('Silla de lino')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'También te puede interesar' })).not.toBeInTheDocument())
  })
})

describe('groupRelatedProducts', () => {
  const p = (id: string) => ({ product_id: id }) as PublicProduct

  it('reparte por sección, respeta el orden y no repite ni incluye el abierto', () => {
    const sections = groupRelatedProducts(
      [
        { related_product_id: 'b', relation_kind: 'cross_sell', position: 1 },
        { related_product_id: 'a', relation_kind: 'related', position: 2 },
        { related_product_id: 'b', relation_kind: 'related', position: 3 },
        { related_product_id: 'x', relation_kind: 'substitute', position: 4 },
        { related_product_id: 'c', relation_kind: 'up_sell', position: 5 },
        { related_product_id: 'fantasma', relation_kind: 'related', position: 6 },
      ],
      [p('a'), p('b'), p('c'), p('x')],
      'x',
    )
    expect(sections.complete.map((item) => item.product_id)).toEqual(['b'])
    expect(sections.related.map((item) => item.product_id)).toEqual(['a'])
    expect(sections.upgrade.map((item) => item.product_id)).toEqual(['c'])
  })

  it('no pasa de cuatro por fila', () => {
    const ids = ['1', '2', '3', '4', '5']
    const sections = groupRelatedProducts(
      ids.map((id, position) => ({ related_product_id: id, relation_kind: 'accessory' as const, position })),
      ids.map(p),
      null,
    )
    expect(sections.complete).toHaveLength(4)
  })
})