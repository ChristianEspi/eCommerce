/**
 * P15-SaaS · lo que la vitrina le cuenta a un buscador.
 *
 * Todo lo que se comprueba aquí son FUNCIONES puras: reciben la tienda que
 * `public_stores` devolvió para el slug de la URL y devuelven la lista de
 * etiquetas del `<head>`. Se prueban así, y no montando pantallas, porque lo
 * que puede salir mal no es cómo se pinta: es QUÉ se indexa, con QUÉ identidad
 * y con QUÉ dirección canónica. Tres decisiones que en una suite multitenant
 * son de aislamiento, no de estética:
 *
 *  1. La identidad que sale es la del TENANT. Ni una cadena de casa en el
 *     `og:site_name`, el `Organization` o el `<title>`.
 *  2. Carrito, checkout, cuenta y seguimiento NO se indexan. El último lleva
 *     además el token del pedido en la URL.
 *  3. Lo que no existe tampoco se indexa: una SPA responde 200 a todo y sin
 *     `noindex` un slug que no resuelve se indexaría como página vacía.
 */
import { describe, expect, it } from 'vitest'
import {
  absoluteUrl,
  breadcrumbJsonLd,
  canonicalPath,
  clampDescription,
  organizationJsonLd,
  productJsonLd,
  storeTitle,
} from '@/shared/seo/meta'
import { contentMeta, homeMeta, notFoundMeta, privateMeta, productMeta, storePath } from './seo'
import type { PublicProduct, PublicStore } from './types'

const store: PublicStore = {
  store_id: '11111111-1111-4111-8111-111111111111',
  slug: 'casa-verde',
  name: 'Casa Verde',
  currency: 'PEN',
  accent_color: '#5AA97F',
  logo_url: 'https://cdn.example.com/casa-verde/logo.png',
  white_label: true,
  default_locale: 'es',
  support_email: 'hola@casaverde.pe',
  banner_url: 'https://cdn.example.com/casa-verde/banner.jpg',
  hero_title: 'Muebles de roble',
  hero_subtitle: 'Hechos a mano en Lima',
  contact_phone: '+51 999 888 777',
  contact_address: 'Av. Siempre Viva 742',
  favicon_url: null,
  font_family: null,
  ui_radius: null,
  ui_density: null,
  business_display_name: 'Casa Verde S.A.C.',
  checkout_requires_account: false,
  default_country: null,
}

const product: PublicProduct = {
  product_id: '22222222-2222-4222-8222-222222222222',
  store_id: store.store_id,
  category_id: null,
  slug: 'silla-roble',
  name: 'Silla de roble',
  description: 'Silla maciza de roble con acabado natural.',
  price: '349.00',
  compare_at_price: null,
  currency: 'PEN',
  published_at: '2026-03-01T10:00:00.000Z',
  in_stock: true,
  category_slug: 'sillas',
  category_name: 'Sillas',
  primary_image_path: 'org/company/silla.jpg',
  primary_image_alt: 'Silla de roble vista de frente',
  kind: 'simple',
  brand_name: 'Roble Fino',
  variant_count: 0,
  price_from: null,
}

const context = { store, storeSlug: 'casa-verde', locale: 'es', pathname: '/s/casa-verde' }

// ---------------------------------------------------------------------------

describe('piezas puras del `<head>`', () => {
  it('el título pone lo específico PRIMERO: es lo que sobrevive al recorte', () => {
    expect(storeTitle('Casa Verde', 'Silla de roble')).toBe('Silla de roble · Casa Verde')
  })

  it('no repite el nombre de la tienda cuando el título ya es ese', () => {
    expect(storeTitle('Casa Verde', 'Casa Verde')).toBe('Casa Verde')
    expect(storeTitle('Casa Verde', null)).toBe('Casa Verde')
  })

  it('la descripción se corta por palabra y por debajo del límite del buscador', () => {
    const largo = `${'palabra '.repeat(40)}final`
    const corto = clampDescription(largo)
    expect(corto).not.toBeNull()
    expect((corto as string).length).toBeLessThanOrEqual(161)
    expect(corto).toMatch(/…$/)
    // Por palabra: no se corta a mitad de una.
    expect(corto).not.toMatch(/pal…$/)
  })

  it('una descripción vacía o en blanco es `null`, no una cadena vacía', () => {
    expect(clampDescription('   ')).toBeNull()
    expect(clampDescription(null)).toBeNull()
    expect(clampDescription(undefined)).toBeNull()
  })

  it('el canonical conserva SOLO categoría y marca; el término y el orden se caen', () => {
    expect(canonicalPath('/s/casa-verde', 'c=sillas&b=roble&q=silla&sort=price_asc')).toBe(
      '/s/casa-verde?c=sillas&b=roble',
    )
  })

  it('el canonical no depende de la barra final', () => {
    expect(canonicalPath('/s/casa-verde/')).toBe('/s/casa-verde')
  })

  it('la URL absoluta no duplica ni se come la barra', () => {
    expect(absoluteUrl('https://tienda.pe/', '/s/casa-verde')).toBe('https://tienda.pe/s/casa-verde')
    expect(absoluteUrl('https://tienda.pe', 's/casa-verde')).toBe('https://tienda.pe/s/casa-verde')
  })
})

describe('JSON-LD', () => {
  it('`Organization` omite lo que la tienda no declaró en vez de inventarlo', () => {
    const nodo = organizationJsonLd({
      name: 'Casa Verde',
      url: '/s/casa-verde',
      logoUrl: null,
      email: null,
      phone: null,
    })
    expect(nodo).not.toHaveProperty('logo')
    expect(nodo).not.toHaveProperty('contactPoint')
  })

  it('`Product` sin precio NO declara oferta: una oferta vacía es una promesa rota', () => {
    const nodo = productJsonLd({
      name: 'Silla',
      description: null,
      url: '/x',
      imageUrl: null,
      sku: null,
      brand: null,
      price: null,
      currency: null,
      inStock: true,
    })
    expect(nodo).not.toHaveProperty('offers')
  })

  it('`Product` agotado declara `OutOfStock`, no se calla', () => {
    const nodo = productJsonLd({
      name: 'Silla',
      description: null,
      url: '/x',
      imageUrl: null,
      sku: null,
      brand: null,
      price: '10.00',
      currency: 'PEN',
      inStock: false,
    }) as { offers: Record<string, unknown> }
    expect(nodo.offers.availability).toBe('https://schema.org/OutOfStock')
  })

  it('la migaja numera desde 1, que es lo que pide el vocabulario', () => {
    const nodo = breadcrumbJsonLd([
      { name: 'Casa Verde', url: '/s/casa-verde' },
      { name: 'Silla', url: '/s/casa-verde/product/silla-roble' },
    ]) as { itemListElement: Array<{ position: number }> }
    expect(nodo.itemListElement.map((item) => item.position)).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------

describe('portada', () => {
  const meta = homeMeta({ ...context, search: 'c=sillas&q=silla' }, 'Catálogo de')

  it('la identidad es la del TENANT, no la del proveedor', () => {
    expect(meta.siteName).toBe('Casa Verde')
    expect(meta.title).toBe('Muebles de roble · Casa Verde')
    expect(meta.image).toEqual({ url: store.banner_url, alt: 'Casa Verde' })
    const org = meta.jsonLd[0] as Record<string, unknown>
    expect(org['@type']).toBe('Organization')
    expect(org.name).toBe('Casa Verde')
    expect(org.logo).toBe(store.logo_url)
  })

  it('se indexa, y el canonical lleva el slug de la tienda y el filtro', () => {
    expect(meta.robots).toBe('index')
    expect(meta.canonicalPath).toBe('/s/casa-verde?c=sillas')
  })

  it('sin subtítulo cae a una descripción compuesta, nunca a `null`', () => {
    const sinSubtitulo = homeMeta(
      { ...context, store: { ...store, hero_subtitle: null } },
      'Catálogo de',
    )
    expect(sinSubtitulo.description).toBe('Catálogo de Casa Verde')
  })
})

describe('ficha de producto', () => {
  const meta = productMeta(
    { ...context, pathname: '/s/casa-verde/product/silla-roble' },
    product,
    'https://cdn.example.com/silla.jpg',
  )

  it('el canonical es el de la FICHA, no el de la ruta por la que se llegó', () => {
    expect(meta.canonicalPath).toBe('/s/casa-verde/product/silla-roble')
    expect(meta.robots).toBe('index')
    expect(meta.ogType).toBe('product')
  })

  it('declara el precio de escaparate y la marca del tenant', () => {
    const nodo = meta.jsonLd[0] as { offers: Record<string, unknown>; brand: { name: string } }
    expect(nodo.offers.price).toBe('349.00')
    expect(nodo.offers.priceCurrency).toBe('PEN')
    expect(nodo.brand.name).toBe('Roble Fino')
    // Una vigencia que nadie garantiza no se inventa.
    expect(nodo.offers).not.toHaveProperty('priceValidUntil')
  })

  it('con variantes el precio declarado es el «desde», que es el que se ve', () => {
    const conVariantes = productMeta(
      context,
      { ...product, kind: 'variant', variant_count: 3, price: '499.00', price_from: '349.00' },
      null,
    )
    const nodo = conVariantes.jsonLd[0] as { offers: Record<string, unknown> }
    expect(nodo.offers.price).toBe('349.00')
  })

  it('la migaja lleva la categoría cuando existe, y la salta cuando no', () => {
    const con = meta.jsonLd[1] as { itemListElement: Array<{ name: string }> }
    expect(con.itemListElement.map((item) => item.name)).toEqual([
      'Casa Verde',
      'Sillas',
      'Silla de roble',
    ])

    const sin = productMeta(context, { ...product, category_name: null, category_slug: null }, null)
    const nodo = sin.jsonLd[1] as { itemListElement: Array<{ name: string }> }
    expect(nodo.itemListElement.map((item) => item.name)).toEqual(['Casa Verde', 'Silla de roble'])
  })
})

describe('página administrable', () => {
  it('el SEO lo escribe el comercio, y cae al título de la página si no lo escribió', () => {
    const conSeo = contentMeta(
      context,
      {
        title: 'Envíos',
        seoTitle: 'Envíos a todo el Perú',
        seoDescription: 'Llegamos a 24 regiones.',
        slug: 'envios',
      },
      null,
    )
    expect(conSeo.title).toBe('Envíos a todo el Perú · Casa Verde')
    expect(conSeo.description).toBe('Llegamos a 24 regiones.')
    expect(conSeo.canonicalPath).toBe('/s/casa-verde/p/envios')
    expect(conSeo.ogType).toBe('article')

    const sinSeo = contentMeta(
      context,
      { title: 'Envíos', seoTitle: null, seoDescription: null, slug: 'envios' },
      null,
    )
    expect(sinSeo.title).toBe('Envíos · Casa Verde')
    expect(sinSeo.description).toBeNull()
  })
})

describe('lo que NO se indexa', () => {
  it.each([
    ['/cart', 'Carrito'],
    ['/checkout', 'Pagar'],
    ['/account', 'Mi cuenta'],
    ['/order/A-1001', 'Pedido A-1001'],
  ])('%s lleva `noindex` y no filtra nada por og:image ni JSON-LD', (path, title) => {
    const meta = privateMeta(context, title, path)
    expect(meta.robots).toBe('noindex')
    expect(meta.description).toBeNull()
    expect(meta.image).toBeNull()
    expect(meta.jsonLd).toEqual([])
    expect(meta.canonicalPath).toBe(`/s/casa-verde${path}`)
  })

  it('lo que no existe tampoco: un slug que no resuelve es un «soft 404»', () => {
    const meta = notFoundMeta({
      title: 'No encontramos esa tienda',
      pathname: '/s/no-existe',
      siteName: 'eCommerce by EBIM',
      locale: 'es',
    })
    expect(meta.robots).toBe('noindex')
    expect(meta.jsonLd).toEqual([])
  })
})

describe('el idioma sale del contexto, no del despliegue', () => {
  it('en inglés se declara `en_US`; en español, `es_PE`', () => {
    expect(homeMeta(context, 'Catálogo de').locale).toBe('es_PE')
    expect(homeMeta({ ...context, locale: 'en' }, 'Catalog of').locale).toBe('en_US')
  })
})

describe('la ruta de la vitrina siempre lleva el slug', () => {
  it('es lo que impide que dos tiendas del mismo despliegue compitan por la misma URL', () => {
    expect(storePath('casa-verde')).toBe('/s/casa-verde')
    expect(storePath('casa-verde', '/product/silla-roble')).toBe(
      '/s/casa-verde/product/silla-roble',
    )
    for (const meta of [
      homeMeta(context, 'Catálogo de'),
      productMeta(context, product, null),
      contentMeta(context, { title: 'x', seoTitle: null, seoDescription: null, slug: 'x' }, null),
      privateMeta(context, 'x', '/cart'),
    ]) {
      expect(meta.canonicalPath.startsWith('/s/casa-verde')).toBe(true)
    }
  })
})
