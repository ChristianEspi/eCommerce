/**
 * 2026-11-22 · Asistente de compra conversacional en la vitrina.
 *
 * Lo que se fija:
 *  · la conversación viaja completa (turnos del comprador y del asistente);
 *  · el crédito se pinta con las cifras de los DATOS, no de la frase;
 *  · un carrito propuesto no entra solo: se revisa, se elige la presentación en
 *    la fila y «Añadir» lo valida con el verificador del pedido rápido.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import type { ChatReply } from './chat'

const holder = vi.hoisted(() => ({
  replies: [] as unknown[],
  sent: [] as unknown[],
  resolve: vi.fn(),
  importCart: vi.fn(),
}))

vi.mock('./chat', async (importOriginal) => {
  const real = await importOriginal<typeof import('./chat')>()
  return {
    ...real,
    sendChat: vi.fn(async (input: unknown) => {
      holder.sent.push(input)
      return holder.replies.shift()
    }),
  }
})
vi.mock('../quick-order/api', () => ({ resolveOrderLines: holder.resolve }))
vi.mock('../quick-order/importToCart', () => ({ importIntoCart: holder.importCart }))
vi.mock('../aiAttribution', () => ({ markAiAttribution: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), fetchPublicProductsByIds: vi.fn(async () => []) }))

const { ChatPanel } = await import('./ChatPanel')
const { CartContext } = await import('../cart/cart-context')

const STORE = '99999999-9999-4999-8999-999999999999'
const CONSIV = '11111111-1111-4111-8111-111111111111'

function pintar() {
  const cart = { cart: { lines: [] }, setQuantity: vi.fn(), add: vi.fn(), openCart: vi.fn() }
  renderWithProviders(
    <CartContext.Provider value={cart as never}>
      <ChatPanel storeSlug="botica" storeId={STORE} />
    </CartContext.Provider>,
  )
  return cart
}

async function escribir(texto: string) {
  await userEvent.type(screen.getByRole('textbox', { name: /mensaje para el asistente/i }), texto)
  await userEvent.click(screen.getByRole('button', { name: /preguntar/i }))
}

beforeEach(() => {
  holder.replies = []
  holder.sent = []
  holder.resolve.mockReset()
  holder.importCart.mockReset()
})

describe('ChatPanel', () => {
  it('el crédito se pinta desde los datos y la conversación viaja completa', async () => {
    holder.replies.push(
      {
        herramienta: 'mi_credito',
        datos: {
          tipo: 'credito',
          credito: { cuenta: 'Distribuidora Prueba SAC', limite: '10000.00', disponible: '7500.00', saldo: '2500.00', vencido: '0', moneda: 'PEN', proximo: null },
        },
        respuesta: 'Tienes crédito disponible en tu cuenta.',
        product_ids: [],
        motivo: null,
      } satisfies ChatReply,
      { herramienta: 'responder', datos: { tipo: 'ninguno' }, respuesta: 'De nada.', product_ids: [], motivo: null } satisfies ChatReply,
    )
    pintar()
    await escribir('cuanto credito me queda')

    expect(await screen.findByText('Tienes crédito disponible en tu cuenta.')).toBeInTheDocument()
    const tarjeta = document.querySelector('[data-chat-credit]') as HTMLElement
    expect(within(tarjeta).getByText(/7[.,]?500[.,]00/)).toBeInTheDocument()
    expect(within(tarjeta).getByText('Distribuidora Prueba SAC')).toBeInTheDocument()

    await escribir('gracias')
    expect(await screen.findByText('De nada.')).toBeInTheDocument()
    expect(holder.sent[1]).toMatchObject({
      storeSlug: 'botica',
      turns: [
        { role: 'user', text: 'cuanto credito me queda' },
        { role: 'assistant', text: 'Tienes crédito disponible en tu cuenta.' },
        { role: 'user', text: 'gracias' },
      ],
    })
  })

  it('un carrito propuesto se revisa, se elige la presentación y se añade validado', async () => {
    holder.replies.push({
      herramienta: 'armar_pedido',
      datos: {
        tipo: 'carrito',
        origen: null,
        avisos: [],
        lineas: [
          {
            indice: 0,
            texto: 'Consiv',
            cantidad: 3,
            cantidad_supuesta: false,
            unidad: null,
            sku_leido: null,
            legible: true,
            confianza: 'variante',
            sku_propuesto: null,
            coincidencia: { product_id: CONSIV, slug: 'consiv', name: 'Consiv Tableta Recubierta Caja 30 un', sku: null, kind: 'variant', brand_name: null, in_stock: true },
            alternativas: [],
            presentaciones: [
              { variant_id: 'a1111111-1111-4111-8111-111111111111', sku: 'QS-282484', name: 'Consiv Tableta Recubierta Caja 30 un · 18 mg' },
              { variant_id: 'a2222222-1111-4111-8111-111111111111', sku: 'QS-282485', name: 'Consiv Tableta Recubierta Caja 30 un · 27 mg' },
            ],
          },
          {
            indice: 1,
            texto: 'Amoxidal Duo',
            cantidad: 1,
            cantidad_supuesta: false,
            unidad: null,
            sku_leido: null,
            legible: true,
            confianza: 'ninguna',
            sku_propuesto: null,
            coincidencia: null,
            alternativas: [],
            presentaciones: [],
          },
        ],
      },
      respuesta: 'Te armé el pedido; elige la concentración de Consiv y confírmalo.',
      product_ids: [],
      motivo: null,
    } satisfies ChatReply)
    holder.resolve.mockResolvedValue([
      { row: 1, sku: 'QS-282485', status: 'ok', product_id: CONSIV, variant_id: 'a2222222-1111-4111-8111-111111111111', name: 'Consiv', variant_name: '27 mg', quantity: 3 },
    ])
    holder.importCart.mockResolvedValue({ added: 1, updated: 0, unchanged: 0, skipped: 0 })
    pintar()
    await escribir('quiero 3 consiv y 1 amoxidal duo')

    const anadir = await screen.findByRole('button', { name: /añadir 0 al carrito/i })
    expect(anadir).toBeDisabled()
    expect(screen.getByText(/no encontramos «amoxidal duo»/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: /presentación de consiv/i }))
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /27 mg · QS-282485/ }))
    await userEvent.click(screen.getByRole('button', { name: /añadir 1 al carrito/i }))

    expect(holder.resolve).toHaveBeenCalledWith({ storeSlug: 'botica', lines: [{ row: 1, sku: 'QS-282485', quantity: 3 }] })
    expect(holder.importCart).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/listo: 1 en el carrito · 0 no disponibles/i)).toBeInTheDocument()
  })

  it('reposición: cada línea dice cada cuánto lo pide y cuándo le toca; se añade validado', async () => {
    holder.replies.push({
      herramienta: 'reponer',
      datos: {
        tipo: 'reposicion',
        items: [{ sku: 'QS-514574', nombre: 'Bloqueador Solar FPS 50', cantidad: 4, compras: 3, cada_dias: 15, dias_restantes: -2 }],
        lineas: [
          {
            indice: 0,
            texto: 'Bloqueador Solar FPS 50',
            cantidad: 4,
            cantidad_supuesta: false,
            unidad: null,
            sku_leido: 'QS-514574',
            legible: true,
            confianza: 'codigo',
            sku_propuesto: 'QS-514574',
            coincidencia: { product_id: CONSIV, slug: 'bloqueador', name: 'Bloqueador Solar FPS 50', sku: 'QS-514574', kind: 'simple', brand_name: null, in_stock: true },
            alternativas: [],
            presentaciones: [],
          },
        ],
      },
      respuesta: 'Según cada cuánto lo pides, ya te tocaba el bloqueador. Revisa la cantidad.',
      product_ids: [],
      motivo: null,
    } satisfies ChatReply)
    holder.resolve.mockResolvedValue([
      { row: 1, sku: 'QS-514574', status: 'ok', product_id: CONSIV, variant_id: null, name: 'Bloqueador', variant_name: null, quantity: 4 },
    ])
    holder.importCart.mockResolvedValue({ added: 1, updated: 0, unchanged: 0, skipped: 0 })
    pintar()
    await escribir('que me toca reponer')

    expect(await screen.findByText('Para reponer')).toBeInTheDocument()
    expect(screen.getByText('Sueles pedirlo cada 15 días · te tocaba hace 2 días')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /añadir 1 al carrito/i }))
    expect(holder.resolve).toHaveBeenCalledWith({ storeSlug: 'botica', lines: [{ row: 1, sku: 'QS-514574', quantity: 4 }] })
  })

  it('ficha: compara presentaciones con las cifras del servidor y marca la más conveniente', async () => {
    holder.replies.push({
      herramienta: 'sobre_producto',
      datos: {
        tipo: 'ficha',
        product_id: CONSIV,
        comparacion: [
          { variant_id: 'v30', nombre: 'Caja 30 un', en_stock: true, precio: '90.00', moneda: 'PEN', contenido: { cantidad: 30, unidad: 'un' }, por_unidad: '3.00', mejor: false },
          { variant_id: 'v100', nombre: 'Caja x100', en_stock: false, precio: '250.00', moneda: 'PEN', contenido: { cantidad: 100, unidad: 'un' }, por_unidad: '2.50', mejor: true },
        ],
      },
      respuesta: 'La caja x100 sale más conveniente por unidad, aunque ahora no tiene stock.',
      product_ids: [CONSIV],
      motivo: null,
    } satisfies ChatReply)
    pintar()
    await escribir('me conviene la caja x100 o la de 30')

    expect(await screen.findByText('Comparar presentaciones')).toBeInTheDocument()
    const mejor = document.querySelector('[data-chat-compare-row="v100"]') as HTMLElement
    expect(within(mejor).getByText('Más conveniente')).toBeInTheDocument()
    expect(within(mejor).getByText('Sin stock')).toBeInTheDocument()
    expect(within(mejor).getByText(/Por unidad: .*2[.,]50/)).toBeInTheDocument()
    const otra = document.querySelector('[data-chat-compare-row="v30"]') as HTMLElement
    expect(within(otra).queryByText('Más conveniente')).toBeNull()
    expect(within(otra).getByText(/90[.,]00/)).toBeInTheDocument()
  })
})
