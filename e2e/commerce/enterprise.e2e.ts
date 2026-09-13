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
 * H11 · Enterprise B2B: la empresa con convenio, crédito y portal.
 *
 * Solo se valida lo que el fixture mantiene estable: el contexto de empresa, el
 * precio negociado que cobra el servidor, el pedido y que ese pedido aparece en
 * el portal de la empresa. Crédito, sugeridos y avisos dependen de procesos que
 * cambian con el tiempo (vencimientos, planificador) y no se afirman aquí.
 */
test.describe('Enterprise · comprador corporativo', () => {
  test('contexto de empresa → convenio → carrito → checkout → pedido → portal', async ({
    page,
    request,
    vigilante,
  }) => {
    const { slug, cantidad } = productoDe('ENTERPRISE')
    const publico = await precioPublico(request, slug, cantidad)

    await entrar(page, 'ENTERPRISE')

    const barra = page.getByRole('complementary', { name: 'Contexto de compra' })
    await expect(barra).toBeVisible({ timeout: 20_000 })
    await expect(barra).toHaveAttribute('data-commerce-audience', 'enterprise')
    await expect(barra.getByText('Comprando para')).toBeVisible()
    await expect(barra.getByText('Precio convenio activo')).toBeVisible()

    await anadirDesdeFicha(page, slug, cantidad)
    await page.goto(`${TIENDA}/cart`)
    await expect(page.getByText('Precio especial').first()).toBeVisible({ timeout: 20_000 })

    const { respuesta, cuerpoEnviado } = await comprar(page)
    const pedido = await pedidoDe(respuesta)

    const claves = todasLasClaves(cuerpoEnviado)
    for (const prohibida of CLAVES_PROHIBIDAS) expect(claves, prohibida).not.toContain(prohibida)
    expect(Number(pedido.items[0]!.unit_price)).toBeLessThan(publico)

    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })

    // El portal de la empresa, intacto: el pedido está en SUS pedidos.
    await page.getByRole('link', { name: 'Tu cuenta' }).click()
    await expect(page.getByRole('tab', { name: 'Estado de cuenta' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: 'Mis pedidos' }).click()
    await expect(page.getByRole('button', { name: new RegExp(pedido.order_number) })).toBeVisible({
      timeout: 20_000,
    })

    expect(vigilante.errores).toEqual([])
  })
})
