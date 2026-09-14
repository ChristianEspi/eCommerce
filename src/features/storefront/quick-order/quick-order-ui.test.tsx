import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outlet, Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import type { PublicProduct, PublicVariant } from '../types'

/**
 * Pedido rápido, en pantalla.
 *
 * Lo que se fija:
 *  · al servidor solo viajan las filas que el navegador ya dio por buenas, y
 *    solo con `sku` y `quantity`;
 *  · cada rechazo se pinta con su motivo TRADUCIDO, nunca con el código;
 *  · al carrito van SOLO las filas aceptadas, y pulsar otra vez no duplica;
 *  · el CSV pasa por el mismo camino;
 *  · sin sesión se invita a entrar y no se pregunta nada.
 */

const holder = vi.hoisted(() => ({ client: null as unknown, catalogo: [] as unknown[] }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

vi.mock('../api', () => ({
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    (holder.catalogo as PublicProduct[]).filter((p) => ids.includes(p.product_id)),
  ),
  fetchPublicVariants: vi.fn(async () => [] as PublicVariant[]),
}))

vi.mock('@/features/inventory/api', () => ({
  fetchPublicAvailability: vi.fn(async (input: { items: Array<{ product_id: string; quantity?: number }> }) =>
    input.items.map((item) => ({
      product_id: item.product_id,
      variant_id: null,
      quantity: String(item.quantity ?? 1),
      unknown: false,
      source: 'catalog',
      in_stock: true,
    })),
  ),
}))

const { QuickOrderPage, QuickOrderView } = await import('./QuickOrderPage')
const { CartContext } = await import('../cart/cart-context')
const { addToCart, emptyCart, setLineQuantity } = await import('../cart/cart')

const STORE_ID = 'aaaa1111-1111-4111-8111-111111111111'
const JABON = 'bbbb1111-1111-4111-8111-111111111111'

const STORE = {
  store_id: STORE_ID,
  slug: 'botica',
  name: 'Botica Central',
  currency: 'PEN',
  accent_color: '#056769',
  logo_url: null,
  white_label: false,
  default_locale: 'es',
}

function jabon(): PublicProduct {
  return {
    product_id: JABON,
    store_id: STORE_ID,
    slug: 'jabon',
    name: 'Jabón',
    price: '10.00',
    currency: 'PEN',
    kind: 'simple',
    in_stock: true,
    primary_image_path: null,
  } as unknown as PublicProduct
}

/** El servidor de mentira: responde según el SKU, como la función real. */
function servidor(): FakeSupabase {
  return createFakeSupabase({
    session: makeSession({ withTenantClaims: false }),
    rpc: {
      resolve_order_lines_for_slug: (args) => {
        const lines = args.p_lines as Array<{ sku: string; quantity: number }>
        return {
          lines: lines.map((line, index) =>
            line.sku === 'QO-JABON'
              ? {
                  row: index + 1,
                  sku: line.sku,
                  status: 'ok',
                  product_id: JABON,
                  variant_id: null,
                  slug: 'jabon',
                  name: 'Jabón',
                  variant_name: null,
                  quantity: line.quantity,
                }
              : line.sku === 'QO-VETADO'
                ? { row: index + 1, sku: line.sku, status: 'rejected', reason: 'FUERA_DE_SURTIDO' }
                : { row: index + 1, sku: line.sku, status: 'rejected', reason: 'SKU_NO_ENCONTRADO' },
          ),
          accepted: 0,
          rejected: 0,
        }
      },
    },
  })
}

function carrito() {
  let state = emptyCart(STORE_ID)
  const api = {
    get cart() {
      return state
    },
    add: vi.fn(async (product: PublicProduct, quantity = 1, variant: PublicVariant | null = null) => {
      state = addToCart(state, product, quantity, variant)
      return true
    }),
    setQuantity: vi.fn((productId: string, quantity: number, variantId: string | null = null) => {
      state = setLineQuantity(state, productId, quantity, variantId)
    }),
  }
  return api
}

function pintar(options: { locale?: 'es' | 'en' } = {}) {
  const fake = servidor()
  holder.client = fake
  const cart = carrito()
  renderWithProviders(
    <CartContext.Provider value={cart as never}>
      <QuickOrderView storeId={STORE_ID} storeSlug="botica" />
    </CartContext.Provider>,
    { locale: options.locale ?? 'es', session: fake.state.session },
  )
  return { fake, cart }
}

async function escribirFila(user: ReturnType<typeof userEvent.setup>, fila: number, sku: string, cantidad: string) {
  await user.type(screen.getByLabelText(`SKU · fila ${fila}`), sku)
  await user.type(screen.getByLabelText(`Cantidad · fila ${fila}`), cantidad)
}

beforeEach(() => {
  holder.catalogo = [jabon()]
  localStorage.clear()
})

describe('escribir, validar y pasar al carrito', () => {
  it('manda solo lo válido, traduce cada rechazo y añade SOLO lo aceptado, sin duplicar al repetir', async () => {
    const user = userEvent.setup({ delay: null })
    const { fake, cart } = pintar()

    await escribirFila(user, 1, 'QO-JABON', '2')
    // El resto, pegado: es el mismo camino hacia las filas y no alarga la prueba.
    await user.click(screen.getByLabelText('Pegar líneas'))
    await user.paste('NO-EXISTE;1\nQO-VETADO;1\nQO-GRANDE;150')
    await user.click(screen.getByRole('button', { name: 'Pasar a las filas' }))
    expect(screen.getByLabelText('SKU · fila 4')).toHaveValue('QO-GRANDE')

    await user.click(screen.getByRole('button', { name: 'Validar' }))

    expect(await screen.findByText('1 aceptadas · 3 rechazadas')).toBeInTheDocument()
    // Al servidor no viajó la fila de 150 (la corta el navegador) ni otra
    // clave que `sku` y `quantity`.
    const llamada = fake.state.rpcCalls.find((c) => c.name === 'resolve_order_lines_for_slug')
    expect(llamada?.args).toEqual({
      p_store_slug: 'botica',
      p_lines: [
        { sku: 'QO-JABON', quantity: 2 },
        { sku: 'NO-EXISTE', quantity: 1 },
        { sku: 'QO-VETADO', quantity: 1 },
      ],
    })

    const tabla = screen.getByRole('table')
    expect(within(tabla).getByText('No encontramos ese SKU en esta tienda')).toBeInTheDocument()
    expect(within(tabla).getByText('No está en el surtido de tu cuenta')).toBeInTheDocument()
    expect(within(tabla).getByText('Como máximo 99 unidades por producto')).toBeInTheDocument()
    // Nunca el código crudo.
    expect(within(tabla).queryByText(/SKU_NO_ENCONTRADO|FUERA_DE_SURTIDO|CANTIDAD_MAXIMA/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Añadir 1 al carrito' }))
    expect(await screen.findByText(/Carrito actualizado: 1 nuevos, 0 con la cantidad cambiada y 0 sin cambios/)).toBeInTheDocument()
    expect(cart.cart.lines.map((l) => [l.product_id, l.quantity])).toEqual([[JABON, 2]])

    // Reintento: la misma lista otra vez no suma.
    await user.click(screen.getByRole('button', { name: 'Añadir 1 al carrito' }))
    await waitFor(() => expect(screen.getByText(/0 nuevos, 0 con la cantidad cambiada y 1 sin cambios/)).toBeInTheDocument())
    expect(cart.cart.lines.map((l) => [l.product_id, l.quantity])).toEqual([[JABON, 2]])
    expect(cart.add).toHaveBeenCalledTimes(1)
  })

  it('cambiar una fila invalida el informe: no se añade un resultado viejo', async () => {
    const user = userEvent.setup({ delay: null })
    pintar()
    await escribirFila(user, 1, 'QO-JABON', '2')
    await user.click(screen.getByRole('button', { name: 'Validar' }))
    await screen.findByRole('button', { name: 'Añadir 1 al carrito' })

    await user.type(screen.getByLabelText('Cantidad · fila 1'), '0')
    expect(screen.queryByRole('button', { name: /al carrito/ })).not.toBeInTheDocument()
  })

  it('pegar líneas las pasa a las filas; la de columnas de más se marca como formato inválido', async () => {
    const user = userEvent.setup({ delay: null })
    const { fake } = pintar()

    await user.click(screen.getByLabelText('Pegar líneas'))
    await user.paste('QO-JABON;3\nOTRO,1,5')
    await user.click(screen.getByRole('button', { name: 'Pasar a las filas' }))

    expect(screen.getByLabelText('SKU · fila 1')).toHaveValue('QO-JABON')
    expect(screen.getByLabelText('Cantidad · fila 1')).toHaveValue('3')

    await user.click(screen.getByRole('button', { name: 'Validar' }))
    expect(await screen.findByText('Formato no válido: escribe solo el SKU y la cantidad')).toBeInTheDocument()
    const llamada = fake.state.rpcCalls.find((c) => c.name === 'resolve_order_lines_for_slug')
    expect(llamada?.args.p_lines).toEqual([{ sku: 'QO-JABON', quantity: 3 }])
  })

  it('sin filas no pregunta nada y lo dice', async () => {
    const user = userEvent.setup({ delay: null })
    const { fake } = pintar()
    await user.click(screen.getByRole('button', { name: 'Validar' }))
    expect(await screen.findByText(/No hay filas con datos/)).toBeInTheDocument()
    expect(fake.state.rpcCalls.filter((c) => c.name === 'resolve_order_lines_for_slug')).toEqual([])
  })

  it('en inglés el motivo sale en inglés', async () => {
    const user = userEvent.setup({ delay: null })
    pintar({ locale: 'en' })
    await user.type(await screen.findByLabelText('SKU · row 1'), 'NO-EXISTE')
    await user.type(screen.getByLabelText('Quantity · row 1'), '1')
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    expect(await screen.findByText('We could not find that SKU in this store')).toBeInTheDocument()
  })

  it('el techo de sondeo se cuenta como «espera», no como un fallo mudo', async () => {
    const user = userEvent.setup({ delay: null })
    const { fake } = pintar()
    fake.state.rpc.resolve_order_lines_for_slug = () => {
      throw { message: 'LIMITE_DE_TASA: demasiadas referencias', code: '22023' }
    }
    await escribirFila(user, 1, 'QO-JABON', '1')
    await user.click(screen.getByRole('button', { name: 'Validar' }))
    expect(await screen.findByText(/Espera unos minutos/)).toBeInTheDocument()
  })
})

describe('CSV', () => {
  it('subir DOS veces el mismo archivo deja la cantidad del archivo, no el doble', async () => {
    const user = userEvent.setup({ delay: null })
    const { cart } = pintar()
    await user.click(screen.getByRole('tab', { name: 'Subir CSV' }))

    for (const vuelta of [1, 2]) {
      // Con el BOM que escribe Excel, construido para que se vea en el fuente.
      const csv = new File([`${String.fromCharCode(0xfeff)}sku,cantidad\r\nQO-JABON,4\r\n`], 'pedido.csv', {
        type: 'text/csv',
      })
      await user.upload(screen.getByLabelText('Elegir archivo CSV', { selector: 'input' }), csv)
      await user.click(await screen.findByRole('button', { name: 'Añadir 1 al carrito' }))
      await screen.findByText(vuelta === 1 ? /1 nuevos/ : /1 sin cambios/)
    }

    expect(cart.cart.lines.map((l) => [l.product_id, l.quantity])).toEqual([[JABON, 4]])
  })

  it('un SKU repetido en el archivo se rechaza en sus dos filas y no se pregunta por él', async () => {
    const user = userEvent.setup({ delay: null })
    const { fake, cart } = pintar()

    await user.click(screen.getByRole('tab', { name: 'Subir CSV' }))
    const csv = new File(['sku;cantidad\r\nQO-JABON;4\r\nNO-EXISTE;1\r\nQO-JABON;2\r\n'], 'pedido.csv', {
      type: 'text/csv',
    })
    await user.upload(screen.getByLabelText('Elegir archivo CSV', { selector: 'input' }), csv)

    // Duplicado: el navegador lo rechaza en las dos filas y ni pregunta por él.
    expect(await screen.findByText('0 aceptadas · 3 rechazadas')).toBeInTheDocument()
    expect(screen.getAllByText('SKU repetido en otra fila: deja una sola con la cantidad total')).toHaveLength(2)
    const llamada = fake.state.rpcCalls.find((c) => c.name === 'resolve_order_lines_for_slug')
    expect(llamada?.args.p_lines).toEqual([{ sku: 'NO-EXISTE', quantity: 1 }])
    expect(cart.add).not.toHaveBeenCalled()
  })

  it('una cabecera que no es la plantilla rechaza el archivo entero', async () => {
    const user = userEvent.setup({ delay: null })
    const { fake } = pintar()
    await user.click(screen.getByRole('tab', { name: 'Subir CSV' }))
    const csv = new File(['codigo,unidades\nQO-JABON,1\n'], 'otro.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Elegir archivo CSV', { selector: 'input' }), csv)

    expect(await screen.findByText(/tiene que tener las columnas sku y cantidad/)).toBeInTheDocument()
    expect(fake.state.rpcCalls.filter((c) => c.name === 'resolve_order_lines_for_slug')).toEqual([])
  })
})

describe('sin sesión', () => {
  it('invita a entrar y no pinta el formulario', async () => {
    holder.client = createFakeSupabase({})
    renderWithProviders(
      <Routes>
        <Route path="/s/:storeSlug" element={<Outlet context={{ store: STORE, storeSlug: 'botica' }} />}>
          <Route path="pedido-rapido" element={<QuickOrderPage />} />
        </Route>
      </Routes>,
      { route: '/s/botica/pedido-rapido', session: null },
    )

    expect(await screen.findByText('Inicia sesión para usar el pedido rápido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument()
  })
})
