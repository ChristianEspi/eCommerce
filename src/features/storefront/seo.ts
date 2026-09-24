import {
  breadcrumbJsonLd,
  canonicalPath,
  clampDescription,
  organizationJsonLd,
  productJsonLd,
  storeTitle,
  type PageMeta,
} from '@/shared/seo/meta'
import { resolveStoreDescription } from './identity'
import type { PublicProduct, PublicStore } from './types'

/**
 * Metadatos de las pantallas de la VITRINA (P15-SaaS).
 *
 * Un solo sitio donde se decide qué se indexa y con qué identidad, porque la
 * respuesta correcta depende del tenant y no del despliegue: el nombre, el
 * logo, el contacto y la moneda que salen aquí son los que `public_stores`
 * devolvió para el slug de la URL. Ni una cadena de casa.
 *
 * El origen (`https://…`) lo pone el hook a partir de `window.location`: la
 * misma tienda puede servirse desde el dominio del tenant o desde el del
 * proveedor, y cablear uno declararía canonicals de un sitio que no es.
 */

export interface StoreSeoContext {
  readonly store: PublicStore
  readonly storeSlug: string
  readonly locale: string
  readonly pathname: string
  readonly search?: string
}

function base(context: StoreSeoContext) {
  return {
    siteName: context.store.name,
    locale: context.locale === 'en' ? 'en_US' : 'es_PE',
  }
}

/** URL de la vitrina relativa al origen. La absoluta la compone el hook. */
export function storePath(storeSlug: string, rest = ''): string {
  return `/s/${storeSlug}${rest}`
}

/**
 * Portada. Es la única página de la vitrina que declara `Organization`: es la
 * que un buscador toma como raíz de la tienda.
 */
export function homeMeta(context: StoreSeoContext, catalogOf: string): PageMeta {
  const { store } = context
  const description =
    // P01 de V3 · La descripción ESTABLE del comercio antes que la bajada de
    // campaña: lo que un buscador indexa no debería cambiar cada temporada.
    // `resolveStoreDescription` ya cae a `hero_subtitle` para las tiendas que
    // todavía no la han escrito, así que ninguna pierde su meta descripción.
    clampDescription(resolveStoreDescription(store)) ??
    clampDescription(`${catalogOf} ${store.name}`)

  return {
    ...base(context),
    title: storeTitle(store.name, store.hero_title),
    description,
    canonicalPath: canonicalPath(context.pathname, context.search),
    robots: 'index',
    ogType: 'website',
    image: store.banner_url ? { url: store.banner_url, alt: store.name } : null,
    jsonLd: [
      organizationJsonLd({
        name: store.name,
        url: storePath(context.storeSlug),
        logoUrl: store.logo_url,
        email: store.support_email,
        phone: store.contact_phone,
      }),
    ],
  }
}

/**
 * Ficha de producto. Lleva `Product` con su oferta, y la migaja de pan que un
 * buscador usa para pintar «Tienda › Categoría › Producto» en vez de la URL.
 */
export function productMeta(
  context: StoreSeoContext,
  product: PublicProduct,
  imageUrl: string | null,
): PageMeta {
  const { store } = context
  const url = storePath(context.storeSlug, `/product/${product.slug}`)
  const description =
    clampDescription(product.description) ??
    clampDescription(
      [product.name, product.category_name, store.name].filter(Boolean).join(' · '),
    )

  // Con variantes el precio de la ficha es un «desde»: se declara ese, que es
  // el que se ve. Declarar el del maestro sería anunciar uno que no se cobra.
  const price =
    product.kind === 'variant' ? (product.price_from ?? product.price) : product.price

  const trail = [{ name: store.name, url: storePath(context.storeSlug) }]
  if (product.category_name && product.category_slug) {
    trail.push({
      name: product.category_name,
      url: `${storePath(context.storeSlug)}?c=${encodeURIComponent(product.category_slug)}`,
    })
  }
  trail.push({ name: product.name, url })

  return {
    ...base(context),
    title: storeTitle(store.name, product.name),
    description,
    canonicalPath: url,
    robots: 'index',
    ogType: 'product',
    image: imageUrl ? { url: imageUrl, alt: product.primary_image_alt ?? product.name } : null,
    jsonLd: [
      productJsonLd({
        name: product.name,
        description,
        url,
        imageUrl,
        sku: null,
        brand: product.brand_name,
        price,
        currency: product.currency,
        inStock: product.in_stock !== false,
      }),
      breadcrumbJsonLd(trail),
    ],
  }
}

/** Página administrable del CMS. El SEO lo escribe el comercio. */
export function contentMeta(
  context: StoreSeoContext,
  page: { title: string; seoTitle: string | null; seoDescription: string | null; slug: string },
  imageUrl: string | null,
): PageMeta {
  return {
    ...base(context),
    title: storeTitle(context.store.name, page.seoTitle ?? page.title),
    description: clampDescription(page.seoDescription),
    canonicalPath: storePath(context.storeSlug, `/p/${page.slug}`),
    robots: 'index',
    ogType: 'article',
    image: imageUrl ? { url: imageUrl, alt: page.title } : null,
    jsonLd: [
      breadcrumbJsonLd([
        { name: context.store.name, url: storePath(context.storeSlug) },
        { name: page.title, url: storePath(context.storeSlug, `/p/${page.slug}`) },
      ]),
    ],
  }
}

/**
 * Pantallas que NO se indexan: carrito, checkout, cuenta y seguimiento.
 *
 * No es una precaución cosmética. El seguimiento lleva el token del pedido en
 * la URL; la cuenta enseña datos de un comprador identificado; el carrito y el
 * checkout son estado de una sesión, no contenido. Cualquiera de las cuatro en
 * un índice público es una filtración o una página basura.
 */
export function privateMeta(
  context: StoreSeoContext,
  title: string,
  path: string,
): PageMeta {
  return {
    ...base(context),
    title: storeTitle(context.store.name, title),
    description: null,
    canonicalPath: storePath(context.storeSlug, path),
    robots: 'noindex',
    ogType: 'website',
    image: null,
    jsonLd: [],
  }
}

/**
 * Lo que no existe: slug de tienda que no resuelve, ficha despublicada, página
 * del CMS retirada.
 *
 * Una SPA responde 200 a todo, así que sin esto un buscador indexaría la
 * pantalla de «no encontramos eso» como si fuera contenido de la tienda —el
 * «soft 404» de siempre—. El `noindex` es la única señal que esta arquitectura
 * puede dar sin un servidor delante, y está documentada como tal en el ADR 015.
 */
export function notFoundMeta(input: {
  title: string
  pathname: string
  siteName: string
  locale: string
}): PageMeta {
  return {
    title: input.title,
    description: null,
    canonicalPath: canonicalPath(input.pathname),
    robots: 'noindex',
    ogType: 'website',
    image: null,
    siteName: input.siteName,
    locale: input.locale === 'en' ? 'en_US' : 'es_PE',
    jsonLd: [],
  }
}
