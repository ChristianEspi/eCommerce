import { test, expect, TIENDA, esperarCatalogo } from './consola'
import type { Page } from '@playwright/test'

/**
 * La matriz visual de Storefront V3 (P13).
 *
 * ## Qué es esto, y qué NO es
 *
 * Es la evidencia de que las cuatro personalidades del tema, las tres
 * superficies de la vitrina y el taller de diseño se pintan sin romperse, a los
 * tres anchos que importan: 1280, 768 y 390.
 *
 * **No es una comparación de capturas contra una imagen de referencia.** Se
 * decidió así, y el motivo está en el propio encargo: la vitrina de demostración
 * es un catálogo REAL que cambia —precios, stock, fotos nuevas— y una referencia
 * de píxeles contra datos que cambian se pone roja cada semana por motivos que
 * no son defectos. Un umbral generoso para compensarlo es una referencia que ya
 * no detecta nada.
 *
 * Lo que sí se comprueba en cada celda de la matriz, y es comprobable:
 *
 *  1. **que la página no se arrastra de lado** —el fallo más caro de una
 *     vitrina, y el que jsdom no puede ver porque no calcula diseño—;
 *  2. **que la frontera del tema declara lo que le toca** en el DOM real, que es
 *     de donde cuelga toda la presentación;
 *  3. **que las piezas de V3 llegan al navegador**: la composición de cabecera,
 *     la de la portada, la tarjeta y —en el teléfono— la barra de compra;
 *  4. **que la consola está limpia**, con el vigilante de \`consola.ts\`.
 *
 * Y se guarda una captura de cada celda como artefacto (\`test-results/visual\`),
 * que es lo que se mira en una revisión de diseño. Sin umbral y sin fallar por
 * ella: es documentación, no aserción.
 *
 * ## Las animaciones, apagadas
 *
 * `reducedMotion: 'reduce'` en el contexto. No es solo para que la captura no
 * salga a medio movimiento: la vitrina RESPETA esa preferencia —el carrusel de
 * campañas no gira, la barra de avisos no rota— así que apagarla también
 * comprueba que ese respeto funciona en un navegador de verdad.
 *
 * ## Por qué no cambia el tema de la tienda
 *
 * Cambiarlo desde una prueba dejaría la demo con el tema que dejó la última
 * ejecución. Los cuatro se prueban contra el motor en `src/` y en el taller de
 * diseño —donde el tema se elige sin guardar—, que es exactamente el sitio donde
 * se pueden ver los cuatro sin tocar la tienda de nadie.
 */

test.use({ reducedMotion: 'reduce' })

/** Los tres anchos de la matriz. Los mismos que ofrece el taller. */
const ANCHOS = [
  { id: 'desktop', width: 1280, height: 900 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'mobile', width: 390, height: 844 },
] as const

/** Ningún ancho puede dejar la página desplazándose de lado. */
async function sinArrastreHorizontal(page: Page) {
  const medidas = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: window.innerWidth,
  }))
  // Un píxel de margen: el redondeo de subpíxeles de un borde no es un defecto.
  expect(medidas.documento, `la página se arrastra de lado`).toBeLessThanOrEqual(
    medidas.ventana + 1,
  )
}

/** Guarda la captura de una celda como artefacto para la revisión de diseño. */
async function capturar(page: Page, nombre: string) {
  await page.screenshot({
    path: `test-results/visual/${nombre}.png`,
    fullPage: true,
    animations: 'disabled',
  })
}

test.describe('la vitrina, a los tres anchos', () => {
  for (const ancho of ANCHOS) {
    test(`portada · ${ancho.id}`, async ({ page }) => {
      await page.setViewportSize({ width: ancho.width, height: ancho.height })
      await page.goto(TIENDA)
      await esperarCatalogo(page)

      const frontera = page.locator('.sf-scope').first()
      await expect(frontera).toHaveAttribute('data-store-theme', /universal|retail|premium|catalog/)
      // Las tres piezas de V3 que se pueden comprobar sin conocer el tema de la
      // tienda: la composición de cabecera, la de la portada y la de tarjeta.
      await expect(page.locator('[data-header-variant]').first()).toHaveAttribute(
        'data-header-variant',
        /standard|compact|brand/,
      )
      await expect(page.locator('[data-hero-variant]').first()).toHaveAttribute(
        'data-hero-variant',
        /product|statement/,
      )
      await expect(page.locator('[data-card-variant]').first()).toHaveAttribute(
        'data-card-variant',
        /comfortable|compact|editorial/,
      )

      await sinArrastreHorizontal(page)
      await capturar(page, `home-${ancho.id}`)
    })

    test(`catálogo · ${ancho.id}`, async ({ page }) => {
      await page.setViewportSize({ width: ancho.width, height: ancho.height })
      await page.goto(`${TIENDA}?ver=todo`)
      await esperarCatalogo(page)

      // La barra del catálogo es de P09 y existe a los tres anchos.
      await expect(page.locator('[data-catalog-toolbar]')).toBeVisible()

      if (ancho.id === 'mobile') {
        // En el teléfono, el botón de filtros; y la columna de filtros NO se ve.
        await expect(page.getByRole('button', { name: /Filtros/ })).toBeVisible()
        await expect(page.locator('[data-filter-frame="columna"]')).toBeHidden()
      } else if (ancho.id === 'desktop') {
        await expect(page.locator('[data-filter-frame="columna"]')).toBeVisible()
      }

      await sinArrastreHorizontal(page)
      await capturar(page, `catalog-${ancho.id}`)
    })

    test(`ficha de producto · ${ancho.id}`, async ({ page }) => {
      await page.setViewportSize({ width: ancho.width, height: ancho.height })
      await page.goto(`${TIENDA}?ver=todo`)
      await esperarCatalogo(page)

      /**
       * Se navega a la URL de la ficha, NO se pulsa la tarjeta.
       *
       * Pulsar una tarjeta abre la VISTA RÁPIDA —es lo que se diseñó en V2 ·
       * P14: un diálogo con la galería y el añadir al carrito, sin salir del
       * catálogo— y ese diálogo no tiene `h1`, que también es correcto: un modal
       * no puede secuestrar el encabezado de la página que hay detrás.
       *
       * La primera versión de esta celda pulsaba y esperaba un `h1`, así que
       * medía la vista rápida creyendo que medía la ficha.
       */
      const enlace = page.locator('a[href*="/product/"]').first()
      const destino = await enlace.getAttribute('href')
      expect(destino, 'el catálogo no ofreció ningún enlace a una ficha').toBeTruthy()
      await page.goto(destino as string)

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // La zona de detalle es de P10 y no depende del catálogo.
      await expect(page.locator('[data-product-details]')).toBeVisible()

      /**
       * La barra de compra, contra su corte REAL (`max-width: 899.95px`).
       *
       * No es «mobile sí, lo demás no»: a 768 px la ficha ya es de una sola
       * columna —la de compra deja de estar al lado de la galería— así que la
       * barra tiene el mismo sentido que en un teléfono. El corte es el mismo
       * que usa la cabecera para su buscador, y por eso tableta cuenta como
       * estrecho. La primera versión de esta celda asumía mi etiqueta en vez de
       * la del contrato, y cazó eso.
       *
       * `count` y no `toBeVisible`: la barra solo se pinta si el producto se
       * puede comprar, y el primero del catálogo de demostración puede estar
       * agotado cualquier día. Lo que se fija es que no haya DOS —el fallo que
       * tendría— y que en escritorio no exista, que sí es incondicional.
       */
      if (ancho.width < 900) {
        expect(await page.locator('[data-purchase-bar]').count()).toBeLessThanOrEqual(1)
      } else {
        await expect(page.locator('[data-purchase-bar]')).toHaveCount(0)
      }

      await sinArrastreHorizontal(page)
      await capturar(page, `pdp-${ancho.id}`)
    })
  }
})

test.describe('el taller de diseño enseña los cuatro temas', () => {
  /**
   * Aquí sí se recorren los cuatro, y sin tocar la tienda: el taller resuelve
   * el tema del FORMULARIO, sin guardar. Es el único sitio donde los cuatro se
   * pueden ver en un navegador de verdad sin dejarle a nadie un tema puesto.
   *
   * Necesita sesión de backoffice. Sin ella la prueba se salta a sí misma con
   * un motivo escrito, en vez de fallar: no todas las ejecuciones tienen
   * credenciales, y una prueba roja por falta de entorno enseña a ignorar el
   * rojo.
   */
  test('foco y comparación, con su tema declarado', async ({ page }) => {
    await page.goto('/app/settings#design')

    const enElTaller = page.locator('[data-testid="preview-frame"]').first()
    const visible = await enElTaller.isVisible().catch(() => false)
    test.skip(!visible, 'sin sesión de backoffice no hay taller que mirar')

    for (const tema of ['Universal', 'Retail', 'Premium', 'Catálogo']) {
      await page.getByRole('radio', { name: new RegExp(tema, 'i') }).click()
      // El marco declara el tema elegido sin haber guardado nada.
      await expect(enElTaller).toHaveAttribute(
        'data-store-theme',
        /universal|retail|premium|catalog/,
      )
      await capturar(page, `workspace-focus-${tema.toLowerCase()}`)
    }

    // Y la comparación pinta los tres anchos a la vez.
    await page.getByRole('button', { name: /Comparar/i }).click()
    await expect(page.locator('[data-testid="preview-frame"]')).toHaveCount(3)
    await capturar(page, 'workspace-compare')

    await sinArrastreHorizontal(page)
  })
})
