import { BrandRow } from '../components/BrandRow'
import { BrandTrustStrip } from '../components/BrandTrustStrip'
import { ContentBlocks } from '../components/ContentBlocks'
import { OffersFeaturedBand } from '../components/OffersFeaturedBand'
import { ProductRow } from '../components/ProductRow'
import { PromoCarousel } from '../components/PromoCarousel'
import { StoreFeaturedHero } from '../components/StoreFeaturedHero'
import { StoreHero } from '../components/StoreHero'
import { StoreServicesStrip } from '../components/StoreServicesStrip'
import type { HomeSectionData, HomeSectionRegistry } from './types'

/**
 * Qué pinta cada sección de la portada.
 *
 * ## Qué se movió aquí y qué NO
 *
 * Se movió el JSX de cada banda, tal cual estaba en `StoreHomePage`. No se
 * movió ni una decisión de negocio: el reparto de productos que impide que uno
 * salga en cuatro sitios, la regla de que el CMS sustituye al hero de reserva y
 * la de no repetir filas que el comercio ya compuso siguen calculándose en la
 * página, que es quien tiene los datos completos para decidirlas. Aquí llegan
 * ya resueltas, como banderas.
 *
 * ## Por qué un registro y no un `switch`
 *
 * Porque el registro es exhaustivo por TIPO: `HomeSectionRegistry` obliga a que
 * estén las trece. Añadir un identificador al contrato sin darle qué pintar deja
 * de compilar, en vez de producir una sección que existe en la configuración y
 * no aparece nunca en la pantalla.
 *
 * ## Las que devuelven `null`
 *
 * `business-info` y `newsletter` están declaradas en el contrato y no tienen
 * componente todavía. Devuelven `null` limpiamente en lugar de inventar
 * contenido: una sección de «síguenos» con enlaces que nadie configuró es peor
 * que no tenerla.
 */

/** Aplica el tope de la tienda, si lo hay. Sin tope, la lista entera. */
function conTope<T>(lista: readonly T[], maxItems: number | undefined): readonly T[] {
  return typeof maxItems === 'number' ? lista.slice(0, maxItems) : lista
}

export const HOME_SECTIONS: HomeSectionRegistry = {
  /**
   * La portada abre con una oferta CONCRETA si el catálogo tiene alguna; con el
   * lema del comercio si no. Un degradado con una frase se ve bonito y no
   * vende: no dice qué se compra ni a qué precio.
   *
   * Y si el CMS trae su propia cubierta, no se pinta ninguna de las dos: dos
   * portadas apiladas no son una portada más completa.
   */
  hero: (data: HomeSectionData, maxItems) => {
    const productos = conTope(data.hero, maxItems)
    if (productos.length > 0) {
      return (
        <StoreFeaturedHero
          products={productos}
          storeSlug={data.storeSlug}
          thumbnails={data.thumbsOfertas}
        />
      )
    }
    return data.cmsTraePortada ? null : <StoreHero store={data.store} />
  },

  /**
   * Las cuatro dudas que tiene alguien ANTES de mirar el primer precio: cuándo
   * llega, si es seguro pagar, quién le asesora y si puede recogerlo. En el pie
   * se leen después de decidir, o sea nunca.
   */
  services: () => <StoreServicesStrip />,

  offers: (data, maxItems) => (
    <OffersFeaturedBand
      offers={conTope(data.ofertas, maxItems)}
      // Si lo destacado se pintó como sección propia, la banda se queda solo
      // con las ofertas. Ver `destacadosAparte`.
      featured={data.destacadosAparte ? [] : data.destacados}
      storeSlug={data.storeSlug}
      offersThumbs={data.thumbsOfertas}
      featuredThumbs={data.thumbsCatalogo}
      favorites={data.favorites}
      onToggleFavorite={data.onToggleFavorite}
      onQuickView={data.onQuickView}
    />
  ),

  cms: (data) => (
    <ContentBlocks
      blocks={data.blocks}
      storeSlug={data.storeSlug}
      assets={data.assets}
      images={data.images}
      currency={data.store.currency}
      leadingHeading={data.hasCmsHero}
    />
  ),

  /**
   * Las promociones vigentes salen del motor, no de un cartel escrito a mano:
   * si está descontando, se anuncia; si caduca, desaparece sola.
   */
  promotions: (data, maxItems) => {
    const promos = conTope(data.promociones, maxItems)
    if (promos.length === 0) return null
    return (
      <PromoCarousel
        promotions={promos}
        storeSlug={data.storeSlug}
        currency={data.store.currency}
        assets={data.promoAssets}
      />
    )
  },

  /**
   * Las categorías de la PORTADA, que no son las del catálogo.
   *
   * En el catálogo son píldoras —un filtro que se enciende y se apaga— y las
   * pinta la propia vista de catálogo. En la portada serían puertas, con icono
   * y cuenta. Todavía no existen ahí, así que esto devuelve `null` en vez de
   * reaprovechar la barra de filtros: una barra de filtros en una portada sin
   * catálogo a la vista no filtra nada.
   */
  categories: () => null,

  /**
   * Las marcas, al lado de las categorías: en una botica se compra por marca
   * tanto como por familia.
   */
  brands: (data, maxItems) => (
    <BrandRow
      brands={conTope(data.brands, maxItems)}
      selected={data.brandSelected}
      onSelect={data.onSelectBrand}
      seeAllHref={`/s/${data.storeSlug}?ver=todo`}
    />
  ),

  'new-arrivals': (data, maxItems) => (
    <ProductRow
      title={data.t('store.row.new')}
      eyebrow={data.t('store.row.newEyebrow')}
      subtitle={data.t('store.row.newSubtitle')}
      products={conTope(data.novedades, maxItems)}
      loading={data.cargandoNovedades}
      storeSlug={data.storeSlug}
      thumbnails={data.thumbsNovedades}
      seeAllHref={`/s/${data.storeSlug}?ver=todo&sort=recent`}
      onPrefetch={data.onPrefetch}
      onQuickView={data.onQuickView}
      favorites={data.favorites}
      onToggleFavorite={data.onToggleFavorite}
    />
  ),

  /**
   * Solo si el comercio no compuso ya sus propias filas: repetir «Lo más
   * vendido» dos veces con productos distintos no es más tienda, es una portada
   * que se contradice.
   */
  'best-sellers': (data, maxItems) =>
    data.cmsTraeProductos ? null : (
      <ProductRow
        title={data.t('store.row.featured')}
        eyebrow={data.t('store.row.featuredEyebrow')}
        subtitle={data.t('store.row.featuredSubtitle')}
        products={conTope(data.masVendido, maxItems)}
        loading={data.cargandoCatalogo}
        storeSlug={data.storeSlug}
        thumbnails={data.thumbsCatalogo}
        seeAllHref={`/s/${data.storeSlug}?ver=todo`}
        onPrefetch={data.onPrefetch}
        onQuickView={data.onQuickView}
        favorites={data.favorites}
        onToggleFavorite={data.onToggleFavorite}
      />
    ),

  /**
   * Lo destacado, SEPARADO de las ofertas.
   *
   * Apagada por defecto porque hoy va dentro de `offers`, en la misma banda.
   * Encenderla la saca a su propia fila y deja la banda solo con lo rebajado:
   * son dos argumentos distintos —«está de oferta» y «esto es lo nuestro»— y
   * hay comercios que quieren contarlos por separado.
   */
  featured: (data, maxItems) => (
    <ProductRow
      title={data.t('store.row.featured')}
      eyebrow={data.t('store.row.featuredEyebrow')}
      subtitle={data.t('store.row.featuredSubtitle')}
      products={conTope(data.destacados, maxItems)}
      loading={data.cargandoCatalogo}
      storeSlug={data.storeSlug}
      thumbnails={data.thumbsCatalogo}
      seeAllHref={`/s/${data.storeSlug}?ver=todo`}
      onPrefetch={data.onPrefetch}
      onQuickView={data.onQuickView}
      favorites={data.favorites}
      onToggleFavorite={data.onToggleFavorite}
    />
  ),

  /**
   * Prueba social al cierre: quien duda de una botica en línea deja de dudar
   * cuando reconoce los nombres que ya compra en la farmacia de la esquina.
   */
  trust: (data) => <BrandTrustStrip brands={data.brands} storeSlug={data.storeSlug} />,

  // Declaradas en el contrato, sin componente todavía. Ver la cabecera.
  'business-info': () => null,
  newsletter: () => null,
}
