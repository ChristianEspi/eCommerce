import { test, expect, TIENDA } from '../consola'
import { comprar, irATuCuenta, lecturaLocalDeServicio, pedidoDe } from './support'

/**
 * N02 · Una persona que llega a la tienda y se crea una cuenta.
 *
 *   tienda → Entrar → «¿Primera vez en la tienda? Crea tu cuenta» → registro
 *   → vuelve a la tienda con sesión → Mi cuenta (consumidor)
 *   → sale → /account → Entrar → vuelve a /account
 *
 * Y lo que no se ve: que registrarse no creó ni membresía de backoffice ni
 * vínculo con ninguna empresa (se lee con la clave de servicio, solo en local).
 *
 * La pila local no exige confirmar el correo; con confirmación, la pantalla lo
 * dice (cubierto en `store-register.test.tsx`).
 */
test.describe('B2C · registro de consumidor', () => {
  test('crear cuenta desde la tienda, volver a la tienda y a Mi cuenta tras entrar', async ({
    page,
    request,
    vigilante,
  }, testInfo) => {
    const email = `alta+${Date.now()}-${testInfo.project.name}@hardening.test`
    const password = `Clave-${Date.now()}`

    await page.goto(TIENDA)
    await page.getByRole('link', { name: 'Entrar' }).first().click()
    await expect(page).toHaveURL(/\/login/)
    await page.getByRole('link', { name: '¿Primera vez en la tienda? Crea tu cuenta' }).click()
    await expect(page).toHaveURL(new RegExp(`${TIENDA}/register$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Crea tu cuenta' })).toBeVisible()

    await page.getByLabel(/Nombre y apellido/).fill('Carla Registro E2E')
    await page.getByLabel(/^Correo/).fill(email)
    await page.getByLabel(/^Teléfono/).fill('+51 988 777 666')
    await page.getByLabel(/^Contraseña/).fill(password)
    await page.getByLabel(/^Repite la contraseña/).fill(password)
    await page.getByRole('button', { name: 'Crear cuenta' }).click()

    // Vuelve a la tienda de la que vino, con sesión, y nunca al backoffice.
    await expect(page).toHaveURL(new RegExp(`${TIENDA}$`), { timeout: 20_000 })
    await irATuCuenta(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Hola, Carla')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Estado de cuenta' })).toHaveCount(0)
    await expect(page.locator('[data-commerce-audience]')).toHaveCount(0)

    // Lo que no se ve: ni membresía de backoffice ni vínculo de empresa.
    const [usuario] = (await lecturaLocalDeServicio(request, '/auth/v1/admin/users?per_page=1000').then(
      (r) => ((r as unknown as { users: Array<{ id: string; email: string; user_metadata: Record<string, unknown> }> }).users ?? []),
    )).filter((u) => u.email === email)
    expect(usuario).toBeTruthy()
    for (const prohibida of ['organization_id', 'org_id', 'company_id', 'companies', 'active_company', 'role', 'apps']) {
      expect(Object.keys(usuario!.user_metadata), prohibida).not.toContain(prohibida)
    }
    expect(usuario!.user_metadata).toMatchObject({ full_name: 'Carla Registro E2E', phone: '+51 988 777 666' })
    expect(await lecturaLocalDeServicio(request, `/rest/v1/tenant_members?user_id=eq.${usuario!.id}&select=user_id`)).toEqual([])
    expect(
      await lecturaLocalDeServicio(request, `/rest/v1/business_account_users?user_id=eq.${usuario!.id}&select=user_id`),
    ).toEqual([])

    // Sale y vuelve a entrar DESDE su cuenta: el login lo devuelve ahí, no a /app.
    await page.context().clearCookies()
    await page.evaluate(() => window.localStorage.clear())
    await page.goto(`${TIENDA}/account`)
    await expect(page.getByRole('heading', { name: 'Inicia sesión para ver tu cuenta' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('main').getByRole('link', { name: 'Entrar' }).click()
    await page.locator('#login-email').fill(email)
    await page.locator('#login-password').fill(password)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(new RegExp(`${TIENDA}/account$`), { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible({ timeout: 20_000 })

    // El defecto de N00, con una cuenta RECIÉN creada: la primera compra tiene que
    // aparecer en «Mis direcciones» sin esperar a que caduque la caché.
    await page.goto(`${TIENDA}?ver=todo`)
    const ficha = page.locator('a[href*="/product/"]').first()
    await expect(ficha).toBeVisible({ timeout: 20_000 })
    await page.goto((await ficha.getAttribute('href'))!)
    await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()
    await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({ timeout: 20_000 })
    await pedidoDe((await comprar(page)).respuesta)
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })
    await irATuCuenta(page)
    await page.getByRole('tab', { name: 'Mis direcciones' }).click()
    await expect(page.getByText('Usadas en tus pedidos')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Av. Arequipa 100').first()).toBeVisible()

    expect(vigilante.errores).toEqual([])
  })

  test('cuenta nueva → libreta → checkout con su dirección → pedido → Mis pedidos', async ({ page, vigilante }, testInfo) => {
    const email = `libreta+${Date.now()}-${testInfo.project.name}@hardening.test`
    const password = `Clave-${Date.now()}`

    await page.goto(`${TIENDA}/register`)
    await page.getByLabel(/Nombre y apellido/).fill('Diego Libreta')
    await page.getByLabel(/^Correo/).fill(email)
    await page.getByLabel(/^Teléfono/).fill('+51 977 666 555')
    await page.getByLabel(/^Contraseña/).fill(password)
    await page.getByLabel(/^Repite la contraseña/).fill(password)
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page).toHaveURL(new RegExp(`${TIENDA}/account$`), { timeout: 20_000 })

    // Libreta: guardar «Casa» antes de comprar.
    await page.getByRole('tab', { name: 'Mis direcciones' }).click()
    await page.getByRole('button', { name: 'Agregar dirección' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/Nombre \(Casa/).fill('Casa')
    await dialogo.getByLabel(/Dirección de entrega/).fill('Calle Las Flores 321')
    await dialogo.getByLabel(/^Ciudad/).fill('Lima')
    await dialogo.getByLabel(/Región o departamento/).fill('Lima')
    await dialogo.getByLabel(/^País/).fill('PE')
    await dialogo.getByRole('button', { name: 'Guardar dirección' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Casa' })).toBeVisible()
    await expect(page.getByText('Predeterminada')).toBeVisible()

    // Comprar con esa dirección.
    await page.goto(`${TIENDA}?ver=todo`)
    const ficha = page.locator('a[href*="/product/"]').first()
    await expect(ficha).toBeVisible({ timeout: 20_000 })
    await page.goto((await ficha.getAttribute('href'))!)
    await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()
    await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({ timeout: 20_000 })

    const { respuesta, cuerpoEnviado } = await comprar(page, { direccionGuardada: /^Casa · Calle Las Flores 321/ })
    const pedido = await pedidoDe(respuesta)
    expect(cuerpoEnviado.shipping_address).toMatchObject({ address: 'Calle Las Flores 321', city: 'Lima', country: 'PE' })
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })

    // Mis pedidos: el pedido. Mis direcciones: la libreta intacta, sin duplicar la usada.
    await irATuCuenta(page)
    await expect(page.getByRole('button', { name: new RegExp(pedido.order_number) })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: 'Mis direcciones' }).click()
    await expect(page.getByRole('heading', { name: 'Casa' })).toBeVisible()
    await expect(page.getByText('Usadas en tus pedidos')).toHaveCount(0)

    expect(vigilante.errores).toEqual([])
  })
})
