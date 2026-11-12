import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

import { fetchBundleComponents } from './api'
import { BundleContents } from './cart/CartLineList'

const KIT = 'aaaa1111-1111-4111-8111-111111111111'
const OTRO_KIT = 'bbbb2222-2222-4222-8222-222222222222'

function clienteQue(respuesta: { data: unknown; error: unknown }) {
  const llamadas: Array<{ fn: string; args: unknown }> = []
  holder.client = {
    rpc: (fn: string, args: unknown) => {
      llamadas.push({ fn, args })
      return Promise.resolve(respuesta)
    },
  }
  return llamadas
}

describe('fetchBundleComponents', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('agrupa los componentes por kit y convierte la cantidad', async () => {
    const llamadas = clienteQue({
      data: [
        { bundle_product_id: KIT, name: 'Mochila', variant_name: 'Negro', quantity: '1.000000', unit: null },
        { bundle_product_id: KIT, name: 'Candado', variant_name: null, quantity: '2.000000', unit: null },
        { bundle_product_id: OTRO_KIT, name: 'Botella', variant_name: null, quantity: '1.5', unit: 'L' },
      ],
      error: null,
    })

    const result = await fetchBundleComponents('porta', [KIT, OTRO_KIT])

    expect(llamadas).toEqual([
      { fn: 'bundle_components_for_slug', args: { p_store_slug: 'porta', p_product_ids: [KIT, OTRO_KIT] } },
    ])
    expect(result[KIT]).toEqual([
      { name: 'Mochila', variantName: 'Negro', quantity: 1, unit: null },
      { name: 'Candado', variantName: null, quantity: 2, unit: null },
    ])
    expect(result[OTRO_KIT]).toEqual([{ name: 'Botella', variantName: null, quantity: 1.5, unit: 'L' }])
  })

  it('sin tienda o sin productos no consulta', async () => {
    const llamadas = clienteQue({ data: [], error: null })
    expect(await fetchBundleComponents(undefined, [KIT])).toEqual({})
    expect(await fetchBundleComponents('porta', [])).toEqual({})
    expect(llamadas).toHaveLength(0)
  })

  it('un error o una respuesta malformada deja el carrito sin desglose, sin romperlo', async () => {
    clienteQue({ data: null, error: { message: 'boom', code: '22023' } })
    expect(await fetchBundleComponents('porta', [KIT])).toEqual({})

    clienteQue({ data: [{ bundle_product_id: 'no-uuid', name: 1 }], error: null })
    expect(await fetchBundleComponents('porta', [KIT])).toEqual({})
  })
})

describe('BundleContents', () => {
  const components = [
    { name: 'Mochila de trekking', variantName: 'Negro', quantity: 1, unit: null },
    { name: 'Candado', variantName: null, quantity: 2, unit: null },
  ]

  it('cerrado por defecto; al abrir muestra las cantidades TOTALES de la línea', async () => {
    renderWithProviders(<BundleContents components={components} kits={3} />)

    const toggle = screen.getByRole('button', { name: /Ver qué incluye \(2\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)

    expect(screen.getByRole('button', { name: /Ocultar lo que incluye/ })).toHaveAttribute('aria-expanded', 'true')
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('3 × Mochila de trekking · Negro')
    expect(items[1]).toHaveTextContent('6 × Candado')
  })
})
