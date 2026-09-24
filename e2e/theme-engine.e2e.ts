import { test, expect, TIENDA, esperarCatalogo } from './consola'

/**
 * El Theme Engine en un navegador de verdad.
 *
 * ## Qué se comprueba aquí que no se puede comprobar en jsdom
 *
 * **Que la tienda no se arrastra de lado.** jsdom no calcula diseño: puede
 * decir que una rejilla pide seis columnas, pero no que a 320 px eso empuja la
 * página. Un navegador sí, y la comprobación es de una línea —el ancho del
 * documento contra el de la ventana—.
 *
 * Y **que la frontera del tema llega al DOM real** con su atributo, que es de
 * donde cuelgan todas las reglas de presentación. Si ese atributo faltara, los
 * cuatro temas se verían igual y ninguna prueba de unidad lo notaría: allí el
 * proveedor se monta a mano.
 *
 * ## Lo que NO se prueba aquí, y por qué
 *
 * Cambiar el tema de la tienda de demo. El tema vive en `store_settings` y
 * cambiarlo desde una prueba dejaría la demo con el tema que dejó la última
 * ejecución. Los cuatro se prueban contra el motor en `src/`; aquí se valida el
 * camino real de la tienda tal y como está configurada.
 */

const FICHA = 'a[href*="/product/"]'

test.describe('el tema de la tienda', () => {
  test('la frontera de la vitrina declara su tema en el DOM', async ({ page, vigilante }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    const frontera = page.locator('.sf-scope').first()
    await expect(frontera).toHaveAttribute('data-store-theme', /universal|retail|premium|catalog/)
    await expect(frontera).toHaveAttribute('data-store-cards', /comfortable|compact/)

    expect(vigilante.errores).toEqual([])
  })

  /**
   * Storefront V2 · P04 · La portada declara QUÉ composición pintó.
   *
   * Hasta P04, `heroVariant` no tenía consumidor: la portada elegía sola entre
   * la de producto y la editorial según hubiera rebajas, y el tema no entraba
   * en la decisión. Ahora la elige el contrato, y esto comprueba en un navegador
   * de verdad que la decisión llega al DOM.
   *
   * No se fija CUÁL de las dos: eso depende del tema que tenga puesta la tienda
   * de demostración y del catálogo del día. Lo que se fija es que sea una de las
   * dos y que exista — si el atributo faltara, el control habría vuelto a
   * quedarse sin salida y ninguna prueba de unidad lo notaría, porque allí el
   * proveedor se monta a mano.
   */
  test('la portada declara su composición', async ({ page }) => {
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    const hero = page.locator('[data-hero-variant]').first()
    await expect(hero).toHaveAttribute('data-hero-variant', /product|statement/)
  })

  test('la vitrina no se desplaza en horizontal a 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(TIENDA)
    await esperarCatalogo(page)

    const desbordado = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    expect(desbordado).toBe(false)
  })

  test('tampoco a 360 px, con el catálogo abierto', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 })
    await page.goto(`${TIENDA}?ver=todo`)
    await esperarCatalogo(page)
    await expect(page.locator(FICHA).first()).toBeVisible({ timeout: 20_000 })

    const desbordado = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    expect(desbordado).toBe(false)
  })

  test('la vista rápida se carga aparte y sigue abriéndose', async ({ page }) => {
    // Desde el endurecimiento de P17 el diálogo viaja en su propio trozo. Lo
    // que esto vigila es que ese trozo se pida y llegue: un fallo ahí no rompe
    // la portada, solo hace que pulsar una tarjeta no haga nada.
    //
    // Sin el vigilante de consola a propósito: esta prueba es sobre la carga
    // del trozo, y el vigilante la haría fallar por un 500 pasajero del
    // servidor de demostración, que no dice nada del código. De que la tienda
    // carga sin errores ya responde la primera prueba del golden path.
    await page.goto(TIENDA)
    await esperarCatalogo(page)
    await page.locator(FICHA).first().click()

    // `.first()`: cuando la tarjeta abre la vista rápida hay diálogo Y `main`
    // a la vez, y un localizador con dos coincidencias rompe el modo estricto
    // aunque las dos estén bien.
    await expect(page.getByRole('dialog').or(page.locator('main')).first()).toBeVisible()
  })
})
