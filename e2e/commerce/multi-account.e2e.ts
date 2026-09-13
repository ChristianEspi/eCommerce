import { test, expect, TIENDA } from '../consola'
import {
  CLAVES_PROHIBIDAS,
  anadirDesdeFicha,
  comprar,
  entrar,
  importe,
  pedidoDe,
  sesionApi,
  todasLasClaves,
} from './support'

/**
 * N01 · Una persona con DOS cuentas en la misma tienda.
 *
 * Lo que se demuestra es la coherencia de punta a punta: la cuenta elegida en
 * el selector es la que nombra la barra, la que fija el precio de la ficha y del
 * carrito, la que firma el pedido y la que aparece en el portal. Los precios no
 * se escriben aquí: se le preguntan al servidor con la sesión de la persona.
 *
 * Cada pasada arranca en la cuenta más antigua pidiéndolo por la MISMA puerta
 * que usa la vitrina (`select_store_business_account`, con su JWT), porque la
 * elección se guarda en el servidor y el proyecto anterior la dejó en la otra.
 */
const PRODUCTO = process.env.E2E_MULTI_PRODUCT_SLUG ?? 'alcohol-en-gel-70'

interface Cuenta {
  account_id: string
  name: string
  is_effective: boolean
}

test.describe('Multi-cuenta · Comprando para', () => {
  test('elegir B → barra = B → ficha y carrito con precio de B → pedido de B → portal', async ({
    page,
    request,
    vigilante,
  }) => {
    const api = await sesionApi(request, 'MULTI')
    const cuentas = await api.rpc<Cuenta[]>('my_store_business_accounts', { p_store_slug: 'miquimica' })
    expect(cuentas).toHaveLength(2)
    const andina = cuentas.find((c) => c.name.includes('Andina'))!
    const boreal = cuentas.find((c) => c.name.includes('Boreal'))!

    await api.rpc('select_store_business_account', { p_store_slug: 'miquimica', p_account_id: andina.account_id })
    const precioAndina = await api.precio(PRODUCTO, 1)

    await entrar(page, 'MULTI')
    const barra = page.getByRole('complementary', { name: 'Contexto de compra' })
    await expect(barra).toBeVisible({ timeout: 20_000 })
    const selector = barra.getByRole('button', { name: /Cambiar cuenta/ })
    await expect(selector).toHaveAccessibleName(new RegExp(andina.name))

    await selector.click()
    await page.getByRole('menuitem', { name: new RegExp(boreal.name) }).click()
    await expect(barra.getByRole('status')).toContainText(`Ahora compras para ${boreal.name}`)
    await expect(barra.getByRole('button', { name: /Cambiar cuenta/ })).toHaveAccessibleName(new RegExp(boreal.name))

    // El servidor ya cotiza con B, y B no cuesta lo mismo que A.
    const precioBoreal = await api.precio(PRODUCTO, 1)
    expect(precioBoreal).toBeLessThan(precioAndina)

    await page.goto(`${TIENDA}/product/${PRODUCTO}`)
    await expect(page.getByText('Precio acordado con tu empresa').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(importe(precioBoreal)).first()).toBeVisible()

    await anadirDesdeFicha(page, PRODUCTO, 1)
    await page.goto(`${TIENDA}/cart`)
    await expect(page.getByText('Precio especial').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(importe(precioBoreal)).first()).toBeVisible()

    const { respuesta, cuerpoEnviado } = await comprar(page)
    const pedido = await pedidoDe(respuesta)
    const claves = todasLasClaves(cuerpoEnviado)
    for (const prohibida of CLAVES_PROHIBIDAS) expect(claves, prohibida).not.toContain(prohibida)
    expect(Number(pedido.items[0]!.unit_price)).toBe(precioBoreal)
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })

    // El portal: el pedido está, y dice que es de B.
    await page.getByRole('link', { name: 'Tu cuenta' }).click()
    await page.getByRole('tab', { name: 'Mis pedidos' }).click()
    const fila = page.getByRole('button', { name: new RegExp(pedido.order_number) })
    await expect(fila).toBeVisible({ timeout: 20_000 })
    await expect(fila).toContainText(boreal.name)

    expect(vigilante.errores).toEqual([])
  })
})
