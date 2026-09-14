import { test, expect, TIENDA } from '../consola'
import {
  CLAVES_PROHIBIDAS,
  anadirDesdeFicha,
  comprar,
  entrar,
  pedidoDe,
  precioPublico,
  productoDe,
  sesionApi,
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

    // N05 · Su cuenta exige orden de compra: la pantalla no deja confirmar sin
    // ella, y con ella el pedido nace firmado con esa referencia.
    const ordenDeCompra = `OC-E2E-${Date.now()}`
    const { respuesta, cuerpoEnviado } = await comprar(page, { ordenDeCompra })
    const pedido = await pedidoDe(respuesta)
    expect((await respuesta.json()).data.purchase_order_number).toBe(ordenDeCompra)
    expect(cuerpoEnviado.purchase_order_number).toBe(ordenDeCompra)

    const claves = todasLasClaves(cuerpoEnviado)
    for (const prohibida of CLAVES_PROHIBIDAS) expect(claves, prohibida).not.toContain(prohibida)
    expect(Number(pedido.items[0]!.unit_price)).toBeLessThan(publico)

    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 })
    // La confirmación dice con qué orden de compra quedó firmado.
    await expect(page.getByText(ordenDeCompra).first()).toBeVisible()

    // El portal de la empresa, intacto: el pedido está en SUS pedidos.
    await page.getByRole('link', { name: 'Tu cuenta' }).click()
    await expect(page.getByRole('tab', { name: 'Estado de cuenta' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: 'Mis pedidos' }).click()
    const fila = page.getByRole('button', { name: new RegExp(pedido.order_number) })
    await expect(fila).toBeVisible({ timeout: 20_000 })
    // Y el detalle del portal enseña la orden de compra.
    await fila.click()
    await expect(page.getByRole('presentation').getByText(ordenDeCompra)).toBeVisible({ timeout: 20_000 })

    expect(vigilante.errores).toEqual([])
  })

  test('la base exige la orden de compra aunque el navegador no la mande', async ({ request }) => {
    const api = await sesionApi(request, 'ENTERPRISE')
    const { slug } = productoDe('ENTERPRISE')
    const productos = await request.get(`${process.env.VITE_SUPABASE_URL}/rest/v1/public_products?slug=eq.${slug}&select=product_id`, {
      headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY! },
    })
    const [{ product_id }] = (await productos.json()) as Array<{ product_id: string }>

    const respuesta = await request.post(`${process.env.VITE_SUPABASE_URL}/functions/v1/checkout`, {
      headers: {
        apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${api.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        store_slug: 'miquimica',
        idempotency_key: `e2e-oc-${Date.now()}-${'x'.repeat(24)}`,
        customer_name: 'Compras Corporativo',
        customer_email: 'compras@corporativo.test',
        customer_phone: '+51 999 777 666',
        shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
        items: [{ product_id, quantity: 1 }],
      },
    })
    expect(respuesta.status()).toBeGreaterThanOrEqual(400)
    expect(respuesta.status()).toBeLessThan(500)
    const cuerpo = (await respuesta.json()) as { error: { code: string } }
    expect(cuerpo.error.code).toBe('ORDEN_COMPRA_REQUERIDA')
  })
})
