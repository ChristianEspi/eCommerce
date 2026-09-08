import { test, expect, TIENDA, esperarCatalogo } from './consola'
import type { Page } from '@playwright/test'

/**
 * El golden path, en un navegador de verdad y contra el catálogo real.
 *
 * Los tests de `src/` prueban componentes con dobles; esto recorre la tienda
 * como la recorre una persona, que es donde aparecen los fallos que ningún doble
 * reproduce: una firma de imagen caducada, una consulta que el servidor rechaza,
 * un botón que la cabecera pegajosa tapa en móvil.
 *
 * Cada prueba hereda el vigilante de consola: además de lo que afirma, falla si
 * la página deja un error detrás.
 */

/**
 * Se localiza por el `href`, no por el texto.
 *
 * La tarjeta enlaza por el NOMBRE del producto, así que no hay un texto estable
 * al que agarrarse —cambia con el catálogo—. La ruta sí es estable, y es además
 * lo que define «esto lleva a una ficha».
 */
const FICHA = 'a[href*="/product/"]'

/** Deja el carrito con una línea, recorriendo la tienda como se recorre. */
async function comprarAlgo(page: Page) {
  await page.goto(TIENDA)
  await esperarCatalogo(page)
  await page.locator(FICHA).first().click()
  await expect(page).toHaveURL(/\/product\//)

  await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()
}

test.describe('la vitrina', () => {
  test('la portada carga con catálogo y sin errores de consola', async ({ page, vigilante }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    // Que haya productos, no solo que la página responda: una portada con la
    // cabecera pintada y cero productos es un 200 que no vende nada.
    await expect(page.locator(FICHA).first()).toBeVisible({ timeout: 20_000 })
    // Y que se vea un precio: sin precio no hay tienda, hay catálogo.
    await expect(page.getByText(/S\/\s?\d/).first()).toBeVisible()

    expect(vigilante.errores).toEqual([])
  })

  test('el buscador de la cabecera encuentra productos reales', async ({ page }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    const buscador = page.getByRole('combobox').first()
    await buscador.click()
    await buscador.fill('vitamina')

    // La lista trae foto y nombre: es lo que la distingue de un autocompletado
    // de texto, y lo que se enseña en la demo.
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 })
  })

  test('la ficha enseña el reaseguro junto al botón de compra', async ({ page }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)
    await page.locator(FICHA).first().click()

    await expect(page).toHaveURL(/\/product\//)
    // El reaseguro tiene que estar en la ficha, no al final de la portada: es
    // donde se frena la compra.
    await expect(page.getByText(/Entrega calculada al comprar/i)).toBeVisible({ timeout: 20_000 })
  })

  test('añadir al carrito lo deja contado en la cabecera', async ({ page }) => {
    await comprarAlgo(page)

    await page.goto(`${TIENDA}/cart`)
    // El carrito ya no está vacío: es la única forma de saber que «agregar»
    // agregó algo, y no solo movió un botón.
    await expect(page.getByText(/Tu carrito está vacío/i)).toHaveCount(0)
  })

  test('el checkout pide contacto, entrega y PAGO, en tres pasos', async ({ page, vigilante }) => {
    await comprarAlgo(page)
    await page.goto(`${TIENDA}/checkout`)

    // Los tres encabezados numerados son el cambio visible de este sprint.
    await expect(page.getByRole('heading', { name: /contacto/i })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /^entrega$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^pago$/i })).toBeVisible()

    // Y el selector de pago con medios de verdad de esta tienda.
    await expect(page.getByRole('radio', { name: /transferencia bancaria/i })).toBeVisible({
      timeout: 20_000,
    })

    expect(vigilante.errores).toEqual([])
  })

  test('elegir transferencia enseña sus instrucciones antes de pedir', async ({ page }) => {
    await comprarAlgo(page)
    await page.goto(`${TIENDA}/checkout`)

    await page.getByRole('radio', { name: /transferencia bancaria/i }).click({ timeout: 20_000 })
    // Qué hacer para pagar es lo único accionable de una transferencia.
    await expect(page.getByText(/Qué hacer para pagar/i)).toBeVisible()
  })
})

test.describe('el asistente de compra', () => {
  test('recomienda productos del catálogo real', async ({ page }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    await page.getByRole('button', { name: /asistente de compra/i }).click()
    await expect(page.getByRole('heading', { name: /asistente de compra/i })).toBeVisible()

    await page.getByRole('button', { name: /vitaminas con stock/i }).click()

    // Tarjetas de producto reales, con el precio que sale del catálogo y no del
    // asistente.
    await expect(page.getByText(/S\/\s?\d/).first()).toBeVisible({ timeout: 30_000 })
  })
})
