import { test, expect, TIENDA, esperarCatalogo } from '../consola'
import { CLAVES_PROHIBIDAS, comprar, entrar, pedidoDe, todasLasClaves } from './support'

/**
 * H09 · B2C Consumer, de la portada a su historial.
 *
 * Dos recorridos: el invitado que compra sin cuenta —el flujo que no puede
 * cambiar— y el consumidor registrado que compra y encuentra su pedido en
 * «Mi cuenta». Los dos terminan en un pedido REAL de la tienda de prueba: por eso
 * viven en su propio proyecto y necesitan un entorno de fixtures.
 */

const FICHA = 'a[href*="/product/"]'

test.describe('B2C · invitado', () => {
  test('portada → búsqueda → ficha → carrito → checkout → confirmación', async ({ page, vigilante }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    // Búsqueda desde la cabecera, que es como se llega a un producto.
    const buscador = page.getByRole('combobox').first()
    await buscador.click()
    await buscador.fill('vitamina')
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 })

    // Y por el catálogo: la tarjeta del catálogo abre la vista rápida; la ficha
    // es su enlace, que es la dirección que se comparte.
    await page.goto(`${TIENDA}?ver=todo`)
    const tarjeta = page.locator(FICHA).first()
    await expect(tarjeta).toBeVisible({ timeout: 20_000 })
    const ficha = await tarjeta.getAttribute('href')
    expect(ficha).toMatch(/\/product\//)
    await page.goto(ficha!)
    await expect(page).toHaveURL(/\/product\//)

    await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()
    await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({ timeout: 20_000 })

    await page.goto(`${TIENDA}/cart`)
    await expect(page.getByRole('button', { name: /quitar|eliminar/i }).first()).toBeVisible({ timeout: 20_000 })
    // El invitado NO ve «Precio especial»: la lista general no es un acuerdo (A3).
    await expect(page.getByText('Precio especial')).toHaveCount(0)

    const { respuesta, cuerpoEnviado } = await comprar(page)
    const pedido = await pedidoDe(respuesta)

    // El país salió de la configuración de la tienda (H08), no del código.
    expect((cuerpoEnviado.shipping_address as Record<string, unknown>).country).toMatch(/^[A-Z]{2}$/)
    const claves = todasLasClaves(cuerpoEnviado)
    for (const prohibida of CLAVES_PROHIBIDAS) expect(claves, prohibida).not.toContain(prohibida)

    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })
    await expect(page.getByText('Pedido registrado')).toBeVisible()
    await expect(page.getByText(pedido.order_number).first()).toBeVisible()

    expect(vigilante.errores).toEqual([])
  })
})

test.describe('B2C · consumidor registrado', () => {
  test('entra, compra, y encuentra el pedido en Mi cuenta → Mis pedidos', async ({ page, vigilante }) => {
    await entrar(page, 'CONSUMER')

    // Un consumidor no ve barra de empresa.
    await expect(page.locator('[data-commerce-audience]')).toHaveCount(0)

    await page.goto(`${TIENDA}?ver=todo`)
    const tarjeta = page.locator(FICHA).first()
    await expect(tarjeta).toBeVisible({ timeout: 20_000 })
    await page.goto((await tarjeta.getAttribute('href'))!)
    await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()
    await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({ timeout: 20_000 })

    // Un consumidor con sesión tampoco tiene «precio especial» (A3), ni en el
    // carrito ni en el resumen del checkout.
    await page.goto(`${TIENDA}/checkout`)
    await expect(page.getByRole('heading', { name: /^resumen$/i })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Precio confirmado por la tienda')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Precio especial')).toHaveCount(0)

    const { respuesta } = await comprar(page)
    const pedido = await pedidoDe(respuesta)
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })

    await page.getByRole('link', { name: 'Tu cuenta' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/^Hola/)).toBeVisible()
    for (const pestana of ['Mis pedidos', 'Mis favoritos', 'Mis datos', 'Mis direcciones']) {
      await expect(page.getByRole('tab', { name: pestana })).toBeVisible()
    }

    const fila = page.getByRole('button', { name: new RegExp(pedido.order_number) })
    await expect(fila).toBeVisible({ timeout: 20_000 })
    await fila.click()
    const panel = page.getByRole('presentation')
    await expect(panel.getByText(pedido.order_number)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Volver a comprar' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    // Y su dirección ya aparece para la próxima compra.
    await page.getByRole('tab', { name: 'Mis direcciones' }).click()
    await expect(page.getByText('Av. Arequipa 100').first()).toBeVisible({ timeout: 20_000 })

    expect(vigilante.errores).toEqual([])
  })
})
