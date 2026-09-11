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

/**
 * Deja el carrito con una línea, recorriendo la tienda como se recorre.
 *
 * ## Por qué espera a la cuenta de la cabecera
 *
 * Añadir NO es instantáneo: antes de guardar nada, la tienda le pregunta al
 * servidor si esa cantidad se puede llevar (`availability_for_slug`), y solo
 * cuando contesta escribe la línea. Entre el clic y la respuesta hay un viaje
 * de ida y vuelta.
 *
 * Mientras esta función no esperaba, quien la usaba para después navegar con
 * `page.goto` recargaba la página en mitad de esa pregunta: la petición se
 * cancelaba, la línea no llegaba a escribirse y el checkout se encontraba un
 * carrito vacío. Tres pruebas fallaban por eso, y la culpa no era del carrito.
 *
 * Se espera a la CUENTA de la cabecera y no a un tiempo fijo: es la señal que
 * el propio comprador mira para saber que su producto entró, y no se rompe el
 * día que la red vaya más lenta.
 */
async function comprarAlgo(page: Page) {
  await page.goto(TIENDA)
  await esperarCatalogo(page)
  await page.locator(FICHA).first().click()
  await expect(page).toHaveURL(/\/product\//)

  await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()

  await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({
    timeout: 20_000,
  })
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

    // Se afirma lo que SÍ tiene que haber, no solo lo que no.
    //
    // Antes se comprobaba únicamente que el cartel de «carrito vacío» no
    // estuviera, y eso pasaba también con la página a medio cargar: mientras
    // llega la cotización no hay ni líneas ni cartel, así que la prueba daba
    // verde sin haber mirado nada. Un botón de quitar solo existe si hay una
    // línea que quitar.
    await expect(page.getByRole('button', { name: /quitar|eliminar/i }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText(/Tu carrito está vacío/i)).toHaveCount(0)
  })

  /**
   * Rellenar el paso 2 como lo rellena una persona.
   *
   * La entrega depende de la dirección y del tenant: puede haber envío, puede
   * haber solo recojo, y el recojo pide además dónde. Por eso no se codifica una
   * opción concreta —se elegiría una que mañana no está—: se toma la primera que
   * el servidor deja habilitada, que es exactamente lo que hace quien compra.
   */
  async function elegirEntrega(page: Page) {
    await page.getByLabel(/dirección de entrega/i).fill('Av. Arequipa 100')

    const disponibles = page.getByRole('radio').and(page.locator(':not([disabled])'))
    await expect(disponibles.first()).toBeVisible({ timeout: 20_000 })
    await disponibles.first().click()

    // El recojo pide punto; el envío no. Se atiende si aparece y no si no.
    const punto = page.getByRole('combobox').filter({ hasNotText: /buscar/i }).last()
    if (await punto.isVisible().catch(() => false)) {
      await punto.click()
      const opcion = page.getByRole('option').first()
      if (await opcion.isVisible().catch(() => false)) await opcion.click()
    }
  }

  /** Contacto y entrega hechos: deja la pantalla en el paso de pago. */
  async function llegarAlPago(page: Page) {
    await comprarAlgo(page)
    await page.goto(`${TIENDA}/checkout`)

    await page.getByLabel(/nombre y apellido/i).fill('Ana Perez', { timeout: 20_000 })
    await page.getByLabel(/correo/i).fill('ana@compradora.com')
    await page.getByLabel(/teléfono/i).fill('+51 999 888 777')
    await page.getByRole('button', { name: 'Siguiente' }).click()

    await expect(page.getByRole('heading', { name: /^entrega$/i })).toBeVisible()
    await elegirEntrega(page)
    await page.getByRole('button', { name: 'Siguiente' }).click()

    await expect(page.getByRole('heading', { name: /^pago$/i })).toBeVisible()
  }

  test('el checkout avanza por tres pasos y no deja saltarse ninguno', async ({
    page,
    vigilante,
  }) => {
    await comprarAlgo(page)
    await page.goto(`${TIENDA}/checkout`)

    // Se empieza en el paso 1, y los otros dos NO se pueden pulsar: llegar al
    // pago se gana rellenando, no haciendo clic en la barra.
    await expect(page.getByRole('heading', { name: /datos de contacto/i })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('button', { name: /^entrega$/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^pago$/i })).toBeDisabled()

    await page.getByLabel(/nombre y apellido/i).fill('Ana Perez')
    await page.getByLabel(/correo/i).fill('ana@compradora.com')
    await page.getByLabel(/teléfono/i).fill('+51 999 888 777')
    await page.getByRole('button', { name: 'Siguiente' }).click()

    await expect(page.getByRole('heading', { name: /^entrega$/i })).toBeVisible()
    // Y el resumen sigue delante en cada paso: el total es la cifra por la que
    // se decide seguir.
    await expect(page.getByRole('heading', { name: /^resumen$/i })).toBeVisible()

    await elegirEntrega(page)
    await page.getByRole('button', { name: 'Siguiente' }).click()

    await expect(page.getByRole('heading', { name: /^pago$/i })).toBeVisible()
    await expect(page.getByRole('radio', { name: /transferencia bancaria/i })).toBeVisible({
      timeout: 20_000,
    })
    // Llegar al paso de pago no es comprar: el pedido lo confirma quien compra.
    await expect(page.getByRole('button', { name: 'Confirmar pedido' })).toBeVisible()

    expect(vigilante.errores).toEqual([])
  })

  test('se puede volver atrás sin perder lo escrito', async ({ page }) => {
    await llegarAlPago(page)

    // El gesto más frecuente de cualquier compra: corregir el correo desde el
    // final, de un solo clic en la barra.
    await page.getByRole('button', { name: /^contacto/i }).click()
    await expect(page.getByLabel(/correo/i)).toHaveValue('ana@compradora.com')
  })

  test('elegir transferencia enseña sus instrucciones antes de pedir', async ({ page }) => {
    await llegarAlPago(page)

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
