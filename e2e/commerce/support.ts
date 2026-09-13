import type { APIRequestContext, Page, Response } from '@playwright/test'
import { expect, TIENDA } from '../consola'

/**
 * Lo común de los E2E multi-commerce (H09-H11).
 *
 * ## Fixtures por entorno, nunca en el código
 *
 * Las cuentas de prueba llegan por variables de entorno. En una pila local las
 * crea `scripts/e2e-local-fixtures.mjs`; contra otro entorno las pone quien lo
 * opera. Si falta una, la prueba FALLA diciendo cuál y cómo conseguirla: una
 * prueba que se salta en silencio cuando no hay datos es una prueba que un día
 * nadie ejecuta.
 *
 * Tampoco hay importes escritos: el precio público y el cotizado se piden al
 * servidor en el momento y se comparan entre sí.
 */

export type Rol = 'CONSUMER' | 'TRADE' | 'ENTERPRISE'

export function credenciales(rol: Rol): { email: string; password: string } {
  const email = process.env[`E2E_${rol}_EMAIL`]
  const password = process.env[`E2E_${rol}_PASSWORD`]
  if (!email || !password) {
    throw new Error(
      `Faltan E2E_${rol}_EMAIL / E2E_${rol}_PASSWORD. En local: node scripts/e2e-local-fixtures.mjs ` +
        '(ver docs/demo-hardening/FINAL_REPORT.md, «E2E»).',
    )
  }
  return { email, password }
}

/** La URL y la clave PUBLICABLE del proyecto: las mismas que lleva el bundle. */
function proyecto(): { url: string; key: string } {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY en el entorno de la prueba')
  return { url: url.replace(/\/$/, ''), key }
}

export const SLUG_TIENDA = TIENDA.replace(/^\/s\//, '')

/** Producto y cantidad de cada escenario. Configurables; los defectos son los del fixture local. */
export function productoDe(rol: 'TRADE' | 'ENTERPRISE'): { slug: string; cantidad: number } {
  const defecto = rol === 'TRADE' ? 4 : 10
  return {
    slug: process.env[`E2E_${rol}_PRODUCT_SLUG`] ?? 'alcohol-en-gel-70',
    cantidad: Number(process.env[`E2E_${rol}_QUANTITY`] ?? defecto),
  }
}

/** Precio unitario PÚBLICO que el servidor cotiza a un anónimo para esa cantidad. */
export async function precioPublico(request: APIRequestContext, slug: string, cantidad: number): Promise<number> {
  const { url, key } = proyecto()
  const cabeceras = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  const productos = await request.get(`${url}/rest/v1/public_products?slug=eq.${slug}&select=product_id`, {
    headers: cabeceras,
  })
  expect(productos.ok()).toBe(true)
  const [producto] = (await productos.json()) as Array<{ product_id: string }>
  expect(producto, `el producto ${slug} no está publicado en ${SLUG_TIENDA}`).toBeTruthy()

  const cotizacion = await request.post(`${url}/rest/v1/rpc/price_quote_for_slug`, {
    headers: cabeceras,
    data: { p_store_slug: SLUG_TIENDA, p_items: [{ product_id: producto!.product_id, quantity: cantidad }] },
  })
  expect(cotizacion.ok()).toBe(true)
  const cuerpo = (await cotizacion.json()) as { lines: Array<{ unit_price: string }> }
  return Number(cuerpo.lines[0]?.unit_price)
}

/** Entra por la puerta de la vitrina y vuelve a la tienda, como una persona. */
export async function entrar(page: Page, rol: Rol) {
  const { email, password } = credenciales(rol)
  await page.goto(TIENDA)
  await page.getByRole('link', { name: 'Entrar' }).first().click()
  await expect(page).toHaveURL(/\/login/)
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(new RegExp(`${TIENDA}$`), { timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Tu cuenta' })).toBeVisible({ timeout: 20_000 })
}

/** Añade `cantidad` unidades desde la ficha y espera a que la cabecera las cuente. */
export async function anadirDesdeFicha(page: Page, slug: string, cantidad: number) {
  await page.goto(`${TIENDA}/product/${slug}`)
  const sumar = page.getByRole('button', { name: 'Sumar una unidad' }).first()
  await expect(sumar).toBeVisible({ timeout: 20_000 })
  for (let i = 1; i < cantidad; i += 1) await sumar.click()
  await page.getByRole('button', { name: /agregar al carrito|añadir al carrito/i }).first().click()
  await expect(page.getByRole('button', { name: /carrito \(\d+\)/i })).toBeVisible({ timeout: 20_000 })
}

/**
 * El checkout completo, y devuelve la respuesta del servidor.
 *
 * Lo que se rellena solo se rellena si está vacío: con sesión el checkout ya
 * propone nombre y correo (H04), y el país lo trae la tienda (H08).
 */
export async function comprar(page: Page): Promise<{ respuesta: Response; cuerpoEnviado: Record<string, unknown> }> {
  await page.goto(`${TIENDA}/checkout`)

  const nombre = page.getByLabel(/nombre y apellido/i)
  await expect(nombre).toBeVisible({ timeout: 20_000 })
  if ((await nombre.inputValue()) === '') await nombre.fill('Ana Prueba E2E')
  const correo = page.getByLabel(/correo/i).first()
  if ((await correo.inputValue()) === '') await correo.fill('ana.e2e@hardening.test')
  const telefono = page.getByLabel(/teléfono/i)
  if ((await telefono.inputValue()) === '') await telefono.fill('+51 999 888 777')
  await page.getByRole('button', { name: 'Siguiente' }).click()

  await expect(page.getByRole('heading', { name: /^entrega$/i })).toBeVisible()
  await page.getByLabel(/dirección de entrega/i).fill('Av. Arequipa 100')
  await page.getByLabel(/^ciudad/i).fill('Lima')
  await page.getByLabel(/región|departamento/i).first().fill('Lima')

  const disponibles = page.getByRole('radio').and(page.locator(':not([disabled])'))
  await expect(disponibles.first()).toBeVisible({ timeout: 20_000 })
  await disponibles.first().click()
  const punto = page.getByRole('combobox').filter({ hasNotText: /buscar/i }).last()
  if (await punto.isVisible().catch(() => false)) {
    await punto.click()
    const opcion = page.getByRole('option').first()
    if (await opcion.isVisible().catch(() => false)) await opcion.click()
  }
  await page.getByRole('button', { name: 'Siguiente' }).click()

  await expect(page.getByRole('heading', { name: /^pago$/i })).toBeVisible()
  await page.getByRole('radio', { name: /transferencia bancaria/i }).click({ timeout: 20_000 })

  const [respuesta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/functions/v1/checkout') && r.request().method() === 'POST', {
      timeout: 45_000,
    }),
    page.getByRole('button', { name: 'Confirmar pedido' }).click(),
  ])
  const cuerpoEnviado = (respuesta.request().postDataJSON() ?? {}) as Record<string, unknown>
  return { respuesta, cuerpoEnviado }
}

/** Ninguna clave de dinero ni de identidad comercial en lo que sale del navegador. */
export const CLAVES_PROHIBIDAS = [
  'price',
  'unit_price',
  'subtotal',
  'total',
  'grand_total',
  'currency',
  'discount',
  'customer_id',
  'business_account_id',
  'segment_id',
  'price_list_id',
  'organization_id',
  'company_id',
  'user_id',
  'audience',
]

export function todasLasClaves(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) todasLasClaves(item, out)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out.push(key)
      todasLasClaves(item, out)
    }
  }
  return out
}

export interface PedidoRespuesta {
  order_number: string
  grand_total: string
  items: Array<{ quantity: number; unit_price: string }>
}

export async function pedidoDe(respuesta: Response): Promise<PedidoRespuesta> {
  expect([200, 201]).toContain(respuesta.status())
  const cuerpo = (await respuesta.json()) as { data: PedidoRespuesta }
  expect(cuerpo.data.order_number).toBeTruthy()
  return cuerpo.data
}
