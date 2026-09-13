import { test, expect, TIENDA } from '../consola'
import {
  CLAVES_PROHIBIDAS,
  anadirDesdeFicha,
  comprar,
  entrar,
  pedidoDe,
  precioPublico,
  productoDe,
  todasLasClaves,
} from './support'

/**
 * H10 · Trade / Reseller: un comercio que compra para revender.
 *
 * Lo que se demuestra no es un importe concreto —el dataset puede cambiar— sino
 * la relación: el precio que el SERVIDOR le cobra a esta cuenta, para esa
 * cantidad, es menor que el que cotiza a un anónimo; y el navegador no mandó ni
 * un céntimo ni una identidad comercial para conseguirlo.
 */
test.describe('Trade · comercio minorista', () => {
  test('contexto comercial → cantidad → carrito → checkout → pedido con precio del servidor', async ({
    page,
    request,
    vigilante,
  }) => {
    const { slug, cantidad } = productoDe('TRADE')
    const publico = await precioPublico(request, slug, cantidad)
    expect(publico).toBeGreaterThan(0)

    await entrar(page, 'TRADE')

    // La barra lo dice sin llamarlo «enterprise».
    const barra = page.getByRole('complementary', { name: 'Contexto de compra' })
    await expect(barra).toBeVisible({ timeout: 20_000 })
    await expect(barra).toHaveAttribute('data-commerce-audience', 'trade')
    await expect(barra.getByText('Cuenta comercial')).toBeVisible()
    await expect(barra.getByText('Condiciones comerciales activas')).toBeVisible()
    await expect(barra.getByText('Comprando para')).toHaveCount(0)

    await anadirDesdeFicha(page, slug, cantidad)

    await page.goto(`${TIENDA}/cart`)
    await expect(page.getByText('Precio especial').first()).toBeVisible({ timeout: 20_000 })

    const { respuesta, cuerpoEnviado } = await comprar(page)
    const pedido = await pedidoDe(respuesta)

    const claves = todasLasClaves(cuerpoEnviado)
    for (const prohibida of CLAVES_PROHIBIDAS) expect(claves, prohibida).not.toContain(prohibida)

    const linea = pedido.items[0]!
    expect(linea.quantity).toBe(cantidad)
    // El precio cobrado es el del servidor para ESTA cuenta, y mejora el público.
    expect(Number(linea.unit_price)).toBeLessThan(publico)

    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })
    await expect(page.getByText(pedido.order_number).first()).toBeVisible()

    expect(vigilante.errores).toEqual([])
  })
})
