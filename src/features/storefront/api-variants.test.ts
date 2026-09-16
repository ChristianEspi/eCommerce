import { beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

import { fetchPublicVariants } from './api'

const PRODUCTO = 'cccc4444-1111-4111-8111-111111111111'

const fila = {
  variant_id: 'eeee1111-1111-4111-8111-111111111111',
  product_id: PRODUCTO,
  store_id: 'aaaa1111-1111-4111-8111-111111111111',
  name: 'Roja',
  position: 0,
  is_default: true,
  in_stock: true,
  price: '60.00',
  compare_at_price: null,
  currency: 'PEN',
}

/**
 * Un cliente mínimo que responde según las columnas pedidas. `respuesta` decide
 * qué devuelve la base para cada `select`.
 */
function clienteQue(respuesta: (columnas: string) => { data: unknown; error: unknown }) {
  const pedidas: string[] = []
  const client = {
    from: () => {
      let columnas = ''
      const cadena = {
        select(c: string) {
          columnas = c
          pedidas.push(c)
          return cadena
        },
        eq: () => cadena,
        order: () => cadena,
        then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
          return Promise.resolve(respuesta(columnas)).then(resolve, reject)
        },
      }
      return cadena
    },
  }
  return { client, pedidas }
}

beforeEach(() => {
  holder.client = null
})

describe('variantes públicas y la columna de ejes', () => {
  it('con la migración aplicada, los ejes llegan en la misma consulta', async () => {
    const { client, pedidas } = clienteQue(() => ({
      data: [
        {
          ...fila,
          options: [
            { code: 'color', name: 'Color', position: 1, value_code: 'rojo', label: 'Roja', value_position: 0 },
          ],
        },
      ],
      error: null,
    }))
    holder.client = client

    const variantes = await fetchPublicVariants(PRODUCTO)

    expect(pedidas).toHaveLength(1)
    expect(pedidas[0]).toContain('options')
    expect(variantes[0]?.options.map((o) => o.label)).toEqual(['Roja'])
  })

  it('una base SIN la migración no deja la ficha sin variantes: repite sin `options`', async () => {
    // Es el error real de PostgREST contra un proyecto sin actualizar:
    // `column public_product_variants.options does not exist`.
    const { client, pedidas } = clienteQue((columnas) =>
      columnas.includes('options')
        ? {
            data: null,
            error: { code: '42703', message: 'column public_product_variants.options does not exist' },
          }
        : { data: [fila], error: null },
    )
    holder.client = client

    const variantes = await fetchPublicVariants(PRODUCTO)

    expect(pedidas).toHaveLength(2)
    expect(pedidas[1]).not.toContain('options')
    expect(variantes.map((v) => v.name)).toEqual(['Roja'])
    expect(variantes[0]?.options).toEqual([])
  })

  it('cualquier otro error NO se disfraza de «sin ejes»', async () => {
    const { client, pedidas } = clienteQue(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }))
    holder.client = client

    await expect(fetchPublicVariants(PRODUCTO)).rejects.toThrow()
    expect(pedidas).toHaveLength(1)
  })
})
