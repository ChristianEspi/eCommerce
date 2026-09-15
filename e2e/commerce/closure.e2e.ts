import { test, expect, TIENDA } from '../consola'
import {
  anadirDesdeFicha,
  comprar,
  entrar,
  escrituraLocalDeServicio,
  lecturaLocalDeServicio,
  productoDe,
  vaciarCarritoDe,
} from './support'

/**
 * Cierre del plan eCommerce · los flujos nuevos, en el navegador.
 *
 * Crédito bloqueado, pedido rápido, solicitar cotización y programar un pedido,
 * con las cuentas del fixture local. Cada prueba deja el estado como lo
 * encontró —cuenta al día, carrito vacío, programación eliminada— porque las
 * demás especificaciones comparten los mismos usuarios.
 *
 * Lo que NO se afirma aquí, y dónde está: la aprobación de pedidos, la
 * conversión cotización → pedido con precio cotizado, el trabajo de pedidos
 * programados y la recuperación de carrito dependen de datos que el vendedor
 * o un planificador producen; están en `supabase/tests/{approval-inbox,
 * quote-to-order,scheduled-orders,cart-recovery}.test.ts` contra Postgres.
 */
test.describe('Cierre · flujos B2B nuevos', () => {
  test('crédito bloqueado: el checkout se niega antes de cobrar y lo explica', async ({ page, request, vigilante }) => {
    const [cuenta] = (await lecturaLocalDeServicio(
      request,
      '/rest/v1/business_accounts?code=eq.E2E-CORP&select=id,credit_status',
    )) as Array<{ id: string; credit_status: string }>
    expect(cuenta, 'falta la cuenta E2E-CORP del fixture').toBeTruthy()

    await escrituraLocalDeServicio(request, 'PATCH', `/rest/v1/business_accounts?id=eq.${cuenta!.id}`, {
      credit_status: 'blocked',
    })
    try {
      const { slug } = productoDe('ENTERPRISE')
      await entrar(page, 'ENTERPRISE')
      await anadirDesdeFicha(page, slug, 1)

      const { respuesta } = await comprar(page, { ordenDeCompra: `OC-BLOQ-${Date.now()}` })
      expect(respuesta.status()).toBe(403)
      expect(((await respuesta.json()) as { error: { code: string } }).error.code).toBe('CREDITO_BLOQUEADO')
      await expect(page.getByText(/crédito bloqueado/i).first()).toBeVisible({ timeout: 20_000 })
      await expect(page).not.toHaveURL(/\/order\//)
    } finally {
      await escrituraLocalDeServicio(request, 'PATCH', `/rest/v1/business_accounts?id=eq.${cuenta!.id}`, {
        credit_status: cuenta!.credit_status,
      })
      await vaciarCarritoDe(request, 'ENTERPRISE')
    }

    // La consola del navegador registra el 403 como recurso fallido; lo que no
    // puede haber es una excepción de la aplicación.
    expect(vigilante.errores.filter((e) => !e.includes('status of 403'))).toEqual([])
    vigilante.errores.length = 0
  })

  test('pedido rápido: SKU y cantidad, validar, y al carrito', async ({ page, request, vigilante }) => {
    const { slug } = productoDe('TRADE')
    const [producto] = (await lecturaLocalDeServicio(
      request,
      `/rest/v1/products?slug=eq.${slug}&select=sku`,
    )) as Array<{ sku: string }>
    expect(producto?.sku).toBeTruthy()

    try {
      await entrar(page, 'TRADE')
      await page.goto(`${TIENDA}/pedido-rapido`)
      await page.getByLabel('SKU · fila 1').fill(producto!.sku)
      await page.getByLabel('Cantidad · fila 1').fill('3')
      await page.getByRole('button', { name: 'Validar' }).click()

      await expect(page.getByText('1 aceptadas · 0 rechazadas')).toBeVisible({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Añadir 1 al carrito' }).click()
      await expect(page.getByText(/Carrito actualizado/)).toBeVisible({ timeout: 20_000 })

      await page.getByRole('link', { name: 'Ir al carrito' }).click()
      await expect(page).toHaveURL(new RegExp(`${TIENDA}/cart`))
      await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({ timeout: 20_000 })

      // Un SKU que no existe se rechaza por fila, con su motivo, sin romper la carga.
      await page.goto(`${TIENDA}/pedido-rapido`)
      await page.getByLabel('SKU · fila 1').fill('NO-EXISTE-E2E-123')
      await page.getByLabel('Cantidad · fila 1').fill('1')
      await page.getByRole('button', { name: 'Validar' }).click()
      await expect(page.getByText('No encontramos ese SKU en esta tienda')).toBeVisible({ timeout: 20_000 })
    } finally {
      await vaciarCarritoDe(request, 'TRADE')
    }

    expect(vigilante.errores).toEqual([])
  })

  test('solicitar cotización desde el carrito: número y aparece en «Cotizaciones»', async ({ page, request, vigilante }) => {
    const { slug } = productoDe('ENTERPRISE')
    try {
      await entrar(page, 'ENTERPRISE')
      await anadirDesdeFicha(page, slug, 2)
      await page.goto(`${TIENDA}/cart`)

      await page.getByRole('button', { name: 'Solicitar cotización' }).click()
      const dialogo = page.getByRole('dialog')
      await dialogo.getByRole('button', { name: 'Enviar solicitud' }).click()
      await expect(dialogo.getByText(/Solicitud enviada con el número/)).toBeVisible({ timeout: 20_000 })

      await dialogo.getByRole('link', { name: 'Ver mis cotizaciones' }).click()
      await expect(page).toHaveURL(/#cotizaciones/)
      await expect(page.getByText('Solicitada').first()).toBeVisible({ timeout: 20_000 })
    } finally {
      await vaciarCarritoDe(request, 'ENTERPRISE')
    }

    expect(vigilante.errores).toEqual([])
  })

  test('programar el pedido del carrito: queda activo en «Programados» y se puede eliminar', async ({
    page,
    request,
    vigilante,
  }) => {
    const { slug } = productoDe('ENTERPRISE')
    const nombre = `Reposición E2E ${Date.now()}`
    try {
      await entrar(page, 'ENTERPRISE')
      await anadirDesdeFicha(page, slug, 2)
      await page.goto(`${TIENDA}/cart`)

      await page.getByRole('button', { name: 'Programar este pedido' }).click()
      const dialogo = page.getByRole('dialog')
      // Sin nombre no se envía.
      await dialogo.getByRole('button', { name: 'Programar' }).click()
      await expect(dialogo.getByText('Escribe un nombre de hasta 120 caracteres.')).toBeVisible()
      await dialogo.getByLabel(/Nombre/).fill(nombre)
      await dialogo.getByRole('button', { name: 'Programar' }).click()

      await expect(page).toHaveURL(/#programados/, { timeout: 20_000 })
      const tarjeta = page.locator('.MuiCard-root').filter({ hasText: nombre })
      await expect(tarjeta).toBeVisible({ timeout: 20_000 })
      await expect(tarjeta.getByText('Activa')).toBeVisible()

      await tarjeta.getByRole('button', { name: 'Pausar' }).click()
      await expect(tarjeta.getByText('En pausa')).toBeVisible({ timeout: 20_000 })

      await tarjeta.getByRole('button', { name: 'Eliminar' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click()
      await expect(page.locator('.MuiCard-root').filter({ hasText: nombre })).toHaveCount(0, { timeout: 20_000 })
    } finally {
      await vaciarCarritoDe(request, 'ENTERPRISE')
    }

    expect(vigilante.errores).toEqual([])
  })
})
