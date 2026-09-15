import { describe, expect, it } from 'vitest'
import type { RouteObject } from 'react-router-dom'
import { routes } from './routes'

function paths(list: RouteObject[], prefix = ''): string[] {
  return list.flatMap((route) => {
    const base = route.path
      ? `${prefix}/${route.path}`.replace(/\/+/g, '/')
      : prefix || '/'
    const self = route.index ? [prefix || '/'] : [base]
    return route.children ? [...self, ...paths(route.children, base)] : self
  })
}

/** La rama sin `path` es la que agrupa todo lo que exige sesión. */
function protectedArea(): RouteObject | undefined {
  return routes.find((route) => !route.path && Boolean(route.children))
}

describe('rutas base', () => {
  const all = paths(routes)

  it('expone las rutas del backoffice bajo /app', () => {
    expect(all).toEqual(
      expect.arrayContaining(['/app', '/app/products', '/app/orders', '/app/settings']),
    )
  })

  it('expone las rutas del storefront bajo /s/:storeSlug', () => {
    expect(all).toEqual(
      expect.arrayContaining([
        '/s/:storeSlug',
        '/s/:storeSlug/product/:productSlug',
        '/s/:storeSlug/cart',
        '/s/:storeSlug/checkout',
      ]),
    )
  })

  it('tiene raíz, login, recuperación de clave y catch-all', () => {
    expect(all).toEqual(
      expect.arrayContaining(['/', '/login', '/recuperar', '/nueva-clave', '/*']),
    )
  })

  it('el backoffice y el alta de espacio cuelgan del guard de sesión', () => {
    const area = protectedArea()
    const children = area?.children ?? []
    expect(children.map((child) => child.path).sort()).toEqual(['/app', '/onboarding'])
  })

  it('login y recuperación quedan FUERA del guard: si no, no habría forma de entrar', () => {
    const area = protectedArea()
    const guarded = paths(area?.children ?? [])
    expect(guarded).not.toContain('/login')
    expect(guarded).not.toContain('/recuperar')
    expect(guarded).not.toContain('/nueva-clave')
  })

  it('el storefront público no cuelga del guard de sesión', () => {
    const area = protectedArea()
    const guarded = paths(area?.children ?? [])
    expect(guarded.some((path) => path.startsWith('/s/'))).toBe(false)
  })

  it('separa las áreas: ninguna ruta del storefront cuelga del backoffice', () => {
    const admin = protectedArea()?.children?.find((route) => route.path === '/app')
    const storefront = routes.find((route) => route.path === '/s/:storeSlug')
    // P04 anade Categorias, P02-SaaS anade Diagnostico, P03-SaaS anade el
    // catalogo avanzado (PIM), P04-SaaS anade Precios, P05-SaaS anade Clientes,
    // P06-SaaS anade Inventario, P09-SaaS anade Pagos, P10-SaaS anade
    // Promociones, P11-SaaS anade Contenido, P12-SaaS anade Entregas y P13-SaaS
    // anade Analitica y Operacion, y P14-SaaS anade Integraciones: panel,
    // analitica, productos, categorias, clientes, contenido, entregas,
    // integraciones, inventario, operacion, PIM, pagos, precios, pedidos,
    // promociones, configuracion y diagnostico. El recorrido B2B anade
    // Fuerza de ventas y Cobranza.
    expect(paths(admin?.children ?? [], '/app').sort()).toEqual([
      '/app',
      '/app/analytics',
      '/app/assortments',
      '/app/categories',
      '/app/channels',
      '/app/content',
      '/app/credit',
      '/app/customers',
      '/app/diagnostics',
      '/app/fulfillment',
      '/app/integrations',
      '/app/inventory',
      '/app/operations',
      '/app/orders',
      '/app/payments',
      '/app/pim',
      '/app/planning',
      '/app/pricing',
      '/app/products',
      '/app/promotions',
      '/app/quotes',
      '/app/sales',
      '/app/settings',
    ])
    // P06 anade la confirmacion, P05-SaaS el area de cuenta del comprador B2B,
    // P11-SaaS la pagina administrable y los favoritos su lista: catalogo,
    // ficha, favoritos, carrito, checkout, pedido, cuenta y `/p/:pageSlug`.
    //
    // La lista de favoritos NO cuelga de `/account` a proposito: guardar no
    // exige sesion —sin ella los favoritos viven en el navegador— y meterla en
    // el area de cuenta la dejaria fuera del alcance de quien no ha entrado.
    //
    // N02 anade `/register`: el alta de CONSUMIDOR vive dentro de la tienda y
    // no en el backoffice (el alta de empresa sigue siendo `/onboarding`).
    //
    // El cierre anade `/pedido-rapido`: SKU + cantidad o CSV hacia el carrito.
    expect(paths(storefront?.children ?? [], '/s/:storeSlug').sort()).toEqual([
      '/s/:storeSlug',
      '/s/:storeSlug/account',
      '/s/:storeSlug/cart',
      '/s/:storeSlug/checkout',
      '/s/:storeSlug/favoritos',
      '/s/:storeSlug/order/:orderNumber',
      '/s/:storeSlug/p/:pageSlug',
      '/s/:storeSlug/pedido-rapido',
      '/s/:storeSlug/product/:productSlug',
      '/s/:storeSlug/register',
      '/s/:storeSlug/unsubscribe',
    ])
    expect(paths(admin?.children ?? [], '/app')).not.toContain('/app/cart')
  })
})
