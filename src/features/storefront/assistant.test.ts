import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * El asistente de compra, por su contrato de datos.
 *
 * Lo que se prueba aquí no es que recomiende bien —eso depende de un modelo y
 * no es comprobable con un test— sino las dos garantías que hacen que un modelo
 * de lenguaje pueda participar en una tienda:
 *
 *  1. **Los productos salen del catálogo, no de la respuesta.** El servidor
 *     devuelve identificadores; la vitrina los resuelve. Si el asistente
 *     inventa un uuid, no hay producto que pintar.
 *  2. **Sin IA sigue habiendo respuesta.** `mode: 'search'` no es un error.
 */

const invoke = vi.fn()
const fetchPorIds = vi.fn()

vi.mock('@/shared/lib/supabase', () => ({
  tryGetStorefrontClient: () => ({ functions: { invoke } }),
  tryGetSupabaseClient: () => null,
}))

vi.mock('./api', () => ({
  fetchPublicProductsByIds: (...args: unknown[]) => fetchPorIds(...args),
}))

const { askAssistant, AssistantError } = await import('./assistant')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const P1 = 'bbbb1111-1111-4111-8111-111111111111'
const P2 = 'bbbb2222-2222-4222-8222-222222222222'

function producto(id: string, name: string) {
  return { product_id: id, slug: name.toLowerCase(), name, price: '10.00', currency: 'PEN' }
}

beforeEach(() => {
  invoke.mockReset()
  fetchPorIds.mockReset()
})

describe('el asistente de compra', () => {
  it('pide al catálogo los productos que el servidor nombró, en ese orden', async () => {
    invoke.mockResolvedValue({
      data: { data: { mode: 'ai', reply: 'Estos te sirven.', product_ids: [P2, P1] } },
      error: null,
    })
    fetchPorIds.mockResolvedValue([producto(P2, 'Bloqueador'), producto(P1, 'Vitamina')])

    const resultado = await askAssistant({ storeSlug: 'miquimica', storeId: STORE, message: 'algo' })

    // El orden es la recomendación: reordenarlo la tira.
    expect(fetchPorIds).toHaveBeenCalledWith(STORE, [P2, P1])
    expect(resultado.products.map((p) => p.product_id)).toEqual([P2, P1])
    expect(resultado.mode).toBe('ai')
  })

  it('lo que llega del servidor NO trae precio que pintar', async () => {
    invoke.mockResolvedValue({
      data: { data: { mode: 'ai', reply: 'Mira este.', product_ids: [P1] } },
      error: null,
    })
    fetchPorIds.mockResolvedValue([producto(P1, 'Vitamina')])

    const resultado = await askAssistant({ storeSlug: 'miquimica', storeId: STORE, message: 'algo' })

    // La respuesta del asistente se queda en texto e identificadores. El precio
    // de la tarjeta sale del catálogo, que es quien puede cobrarlo.
    expect(Object.keys(resultado)).toEqual(
      expect.arrayContaining(['mode', 'reply', 'product_ids', 'products']),
    )
    expect(resultado.product_ids).toEqual([P1])
    expect(resultado.products[0]?.price).toBe('10.00')
  })

  it('sin proveedor de IA responde igual, en modo búsqueda', async () => {
    invoke.mockResolvedValue({
      data: { data: { mode: 'search', reply: null, product_ids: [P1, P2] } },
      error: null,
    })
    fetchPorIds.mockResolvedValue([producto(P1, 'Vitamina'), producto(P2, 'Bloqueador')])

    const resultado = await askAssistant({ storeSlug: 'miquimica', storeId: STORE, message: 'algo' })

    // `search` no es un error: es el modo en que esto funciona sin clave.
    expect(resultado.mode).toBe('search')
    expect(resultado.reply).toBeNull()
    expect(resultado.products).toHaveLength(2)
  })

  it('un fallo del asistente no devuelve datos a medias', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(
      askAssistant({ storeSlug: 'miquimica', storeId: STORE, message: 'algo' }),
    ).rejects.toBeInstanceOf(AssistantError)
    // Y sobre todo: no se llega a preguntar al catálogo por identificadores que
    // no existen.
    expect(fetchPorIds).not.toHaveBeenCalled()
  })

  it('una respuesta con forma inesperada se rechaza, no se pinta', async () => {
    invoke.mockResolvedValue({
      data: { data: { mode: 'inventado', product_ids: 'no-es-una-lista' } },
      error: null,
    })

    await expect(
      askAssistant({ storeSlug: 'miquimica', storeId: STORE, message: 'algo' }),
    ).rejects.toBeTruthy()
    expect(fetchPorIds).not.toHaveBeenCalled()
  })
})
