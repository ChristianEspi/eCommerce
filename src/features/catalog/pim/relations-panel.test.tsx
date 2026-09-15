import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import type { Product } from '../types'

/**
 * Relaciones en el cajón de producto: subir, bajar y quitar (cierre).
 *
 * Desde que la vitrina pinta las relaciones, su orden es el que ve el
 * comprador. Aquí se comprueba que la pantalla escribe ese orden —renumerando
 * la lista entera, porque las altas antiguas nacían todas en 0— y que quitar
 * borra la fila. Quién puede hacerlo lo decide la RLS (owner/admin/catalog), y
 * eso se prueba contra Postgres en
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

const { RelationsPanel } = await import('./RelationsPanel')
const { relationPositionsAfterMove } = await import('./api')

const SILLA = '88888888-8888-4888-8888-888888888801'
const COJIN = '88888888-8888-4888-8888-888888888802'
const MESA = '88888888-8888-4888-8888-888888888803'
const BUTACA = '88888888-8888-4888-8888-888888888804'

function producto(id: string, sku: string, name: string): Product {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    category_id: null,
    sku,
    name,
    slug: sku.toLowerCase(),
    description: null,
    status: 'published',
    price: '10.00',
    compare_at_price: null,
    currency: 'PEN',
    stock: 1,
    published_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
    kind: 'simple',
    brand_id: null,
    family_id: null,
    tax_category_id: null,
  }
}

const PRODUCTOS = [
  producto(SILLA, 'SILLA', 'Silla'),
  producto(COJIN, 'COJIN', 'Cojín'),
  producto(MESA, 'MESA', 'Mesa'),
  producto(BUTACA, 'BUTACA', 'Butaca'),
]

function relacion(id: string, related: string, kind: string) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    product_id: SILLA,
    related_product_id: related,
    relation_kind: kind,
    // Todas en 0, como las altas anteriores al cierre.
    position: 0,
  }
}

function backend(): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      product_relations: [
        relacion('77777777-7777-4777-8777-777777777701', COJIN, 'accessory'),
        relacion('77777777-7777-4777-8777-777777777702', MESA, 'related'),
        relacion('77777777-7777-4777-8777-777777777703', BUTACA, 'up_sell'),
      ],
    },
  })
}

function renderPanel(fake: FakeSupabase, canWrite = true) {
  holder.client = fake
  const [silla] = PRODUCTOS
  return renderWithProviders(
    <RelationsPanel
      product={silla ?? null}
      products={PRODUCTOS}
      organizationId={ORG}
      companyId={COMPANY_A}
      storeId={STORE_A}
      canWrite={canWrite}
    />,
    { session: fake.state.session },
  )
}

function nombresEnOrden(): string[] {
  const filas = screen.getAllByRole('row').slice(1)
  return filas.map((fila) => within(fila).getAllByRole('cell')[1]?.textContent ?? '')
}

beforeEach(() => {
  holder.client = null
})

describe('RelationsPanel', () => {
  it('bajar una relación renumera la lista entera y la escribe', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPanel(fake)

    await screen.findByText('Cojín')
    expect(screen.getByRole('button', { name: 'Subir Cojín' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar Butaca' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Bajar Cojín' }))

    await waitFor(() => {
      const posiciones = Object.fromEntries(
        (fake.state.tables.product_relations ?? []).map((row) => [row.related_product_id, row.position]),
      )
      expect(posiciones).toEqual({ [MESA]: 1, [COJIN]: 2, [BUTACA]: 3 })
    })
    await waitFor(() => expect(nombresEnOrden()).toEqual(['Mesa', 'Cojín', 'Butaca']))
  })

  it('quitar borra la fila', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPanel(fake)

    await user.click(await screen.findByRole('button', { name: 'Quitar la relación con Mesa' }))

    await waitFor(() => expect(fake.state.tables.product_relations).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText('Mesa')).not.toBeInTheDocument())
    expect(await screen.findByText('Relación quitada')).toBeInTheDocument()
  })

  it('sin permiso de escritura no hay botones de orden ni de quitar', async () => {
    renderPanel(backend(), false)

    await screen.findByText('Cojín')
    expect(screen.queryByRole('button', { name: /Subir|Bajar|Quitar/ })).not.toBeInTheDocument()
  })
})

describe('relationPositionsAfterMove', () => {
  it('devuelve solo lo que cambia', () => {
    const list = [
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
      { id: 'c', position: 3 },
    ]
    expect(relationPositionsAfterMove(list, 2, -1)).toEqual([
      { id: 'c', position: 2 },
      { id: 'b', position: 3 },
    ])
  })

  it('fuera de rango no hace nada', () => {
    expect(relationPositionsAfterMove([{ id: 'a', position: 0 }], 0, -1)).toEqual([])
    expect(relationPositionsAfterMove([{ id: 'a', position: 0 }], 0, 1)).toEqual([])
  })
})