import type { Page } from '@playwright/test'
import { test, expect, TIENDA } from '../consola'
import { entrar } from './support'

/**
 * H12 · Las pantallas nuevas a 1440, 1024 y 390 px.
 *
 * Lo que se afirma es lo que un navegador de verdad puede medir y jsdom no: que
 * nada empuja la página en horizontal, que cada pantalla tiene un solo `h1`, que
 * las pestañas se alcanzan en móvil y que la barra de contexto se recorre con el
 * teclado. Nombres largos y precios largos ya se prueban en unidad.
 */

const ANCHOS = [1440, 1024, 390] as const

async function desbordamiento(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

for (const ancho of ANCHOS) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 900 } })

    test('consumidor: Mi cuenta sin desbordar, un h1 y todas las pestañas alcanzables', async ({ page }) => {
      await entrar(page, 'CONSUMER')
      await page.getByRole('link', { name: 'Tu cuenta' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible({ timeout: 20_000 })

      expect(await desbordamiento(page)).toBeLessThanOrEqual(1)
      await expect(page.locator('h1')).toHaveCount(1)

      // La última pestaña se puede pulsar aunque no quepa: se desplaza.
      await page.getByRole('tab', { name: 'Avisos' }).click()
      await expect(page.getByRole('tab', { name: 'Avisos' })).toHaveAttribute('aria-selected', 'true')
    })

    test('empresa: la barra de contexto no desborda y se recorre con el teclado', async ({ page }) => {
      await entrar(page, 'ENTERPRISE')
      const barra = page.getByRole('complementary', { name: 'Contexto de compra' })
      await expect(barra).toBeVisible({ timeout: 20_000 })
      expect(await desbordamiento(page)).toBeLessThanOrEqual(1)

      const verCuenta = barra.getByRole('link', { name: 'Ver cuenta' })
      await verCuenta.focus()
      await expect(verCuenta).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(new RegExp(`${TIENDA}/account`))

      // El portal B2B, en cualquier ancho: la pestaña del final también se alcanza.
      await page.getByRole('tab', { name: 'Mi cuenta' }).click()
      await expect(page.getByRole('tab', { name: 'Mi cuenta' })).toHaveAttribute('aria-selected', 'true')
      expect(await desbordamiento(page)).toBeLessThanOrEqual(1)
    })
  })
}
