import { test, expect, TIENDA } from '../consola'
import { anadirDesdeFicha, comprar, entrar, importe, pedidoDe, sesionApi } from './support'

/**
 * N04 · Una campaña dirigida a UNA cuenta (Boreal): el carrito la enseña y el
 * pedido cobra exactamente eso. Con la otra cuenta (Andina) no aparece.
 *
 * Los importes no se escriben aquí: la cotización con promociones se le pide
 * al servidor con la sesión de la persona, y se compara con lo que la pantalla
 * enseña y con lo que el pedido cobra.
 */
const PRODUCTO = process.env.E2E_MULTI_PRODUCT_SLUG ?? 'alcohol-en-gel-70'

interface Cuenta {
  account_id: string
  name: string
}

test.describe('Promoción dirigida · carrito = pedido', () => {
  test('Boreal ve el descuento en el carrito y el pedido lo cobra; Andina no lo ve', async ({ page, request, vigilante }) => {
    const api = await sesionApi(request, 'MULTI')
    const cuentas = await api.rpc<Cuenta[]>('my_store_business_accounts', { p_store_slug: 'miquimica' })
    const andina = cuentas.find((c) => c.name.includes('Andina'))!
    const boreal = cuentas.find((c) => c.name.includes('Boreal'))!
    const productos = await request.get(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/public_products?slug=eq.${PRODUCTO}&select=product_id`,
      { headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY! } },
    )
    const [{ product_id }] = (await productos.json()) as Array<{ product_id: string }>
    const cotizar = () =>
      api.rpc<{ discount_total: string; grand_total: string }>('promotion_quote_for_slug', {
        p_store_slug: 'miquimica',
        p_items: [{ product_id, quantity: 1 }],
      })

    // Andina: sin campaña, en el servidor y en la pantalla.
    await api.rpc('select_store_business_account', { p_store_slug: 'miquimica', p_account_id: andina.account_id })
    expect(Number((await cotizar()).discount_total)).toBe(0)

    await entrar(page, 'MULTI')
    await anadirDesdeFicha(page, PRODUCTO, 1)
    await page.goto(`${TIENDA}/cart`)
    await expect(page.getByText('Precio confirmado por la tienda').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Descuento')).toHaveCount(0)

    // Boreal: el mismo carrito, ahora con la campaña a la vista ANTES de confirmar.
    await api.rpc('select_store_business_account', { p_store_slug: 'miquimica', p_account_id: boreal.account_id })
    const visto = await cotizar()
    expect(Number(visto.discount_total)).toBeGreaterThan(0)
    await page.reload()
    await expect(page.getByText('Descuento').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(importe(Number(visto.discount_total))).first()).toBeVisible()

    const { respuesta } = await comprar(page)
    const pedido = await pedidoDe(respuesta)
    expect(pedido.discount_total).toBe(visto.discount_total)
    expect((Number(pedido.grand_total) - Number(pedido.shipping_total)).toFixed(2)).toBe(Number(visto.grand_total).toFixed(2))

    expect(vigilante.errores).toEqual([])
  })
})
