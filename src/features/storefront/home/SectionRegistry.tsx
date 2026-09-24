import { BrandRow } from '../components/BrandRow'
import { BrandTrustStrip } from '../components/BrandTrustStrip'
import { Stack } from '@mui/material'
import { CategoryDoorGrid, CategoryPills } from '../components/CategoryDoors'
import { ContentBlocks } from '../components/ContentBlocks'
import { OffersFeaturedBand } from '../components/OffersFeaturedBand'
import { ProductRow } from '../components/ProductRow'
import { PromoCarousel } from '../components/PromoCarousel'
import { SectionHeading } from '../components/SectionHeading'
import { StoreFeaturedHero } from '../components/StoreFeaturedHero'
import { StoreHero } from '../components/StoreHero'
import { StoreBusinessInfo } from '../components/StoreBusinessInfo'
import { StoreValueProps } from '../components/StoreValueProps'
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
 * `newsletter` está declarada en el contrato y no tiene componente (`categories`
 * lo tiene desde H07 y `business-info` desde P09). Devuelve `null` limpiamente
 * en lugar de inventar contenido: un formulario de suscripción que no persiste
 * nada ni recoge un consentimiento es peor que no tenerlo — pide un correo y lo
 * tira.
 *
 * Y `business-info` devuelve `null` **también**, pero por otro motivo: cuando el
 * comercio no escribió ni una forma de contacto. Las dos cosas se ven igual
 * desde fuera y no son lo mismo: una es una sección sin construir y la otra es
 * una sección que se calla porque no tiene nada cierto que decir.
 */

/** Aplica el tope de la tienda, si lo hay. Sin tope, la lista entera. */
function conTope<T>(lista: readonly T[], maxItems: number | undefined): readonly T[] {
  return typeof maxItems === 'number' ? lista.slice(0, maxItems) : lista
}

export const HOME_SECTIONS: HomeSectionRegistry = {
  /**
   * La portada, en la composición que el comercio eligió (P04).
   *
   * ## Las dos salidas, y por qué el tema decide
   *
   * `heroVariant` es el control del contrato que elige entre dos portadas
   * distintas de verdad:
   *
   *  · **`product`** abre con una oferta CONCRETA —foto, precio antes, precio
   *    ahora—. Un degradado con una frase se ve bonito y no vende: no dice qué
   *    se compra ni a qué precio.
   *  · **`statement`** abre con la MARCA: imagen a sangre o el degradado del
   *    acento, el lema a cuerpo grande y dos puertas. Es lo que quiere quien
   *    vende por contemplación y no por rebaja — el caso de `premium`.
   *
   * Hasta P04 esto no se leía: la portada pintaba la de producto si había algo
   * rebajado y el lema si no, así que `premium` declaraba `statement` y no lo
   * usaba nunca. Ese era el control huérfano que esta fase cierra.
   *
   * ## `product` es una PREFERENCIA, no una orden
   *
   * Sin nada rebajado no hay portada de producto que pintar, así que cae a la
   * editorial. La regla al revés no hace falta: la editorial se pinta siempre —
   * el lema y el nombre de la tienda existen desde que la tienda existe.
   *
   * ## Y si el CMS trae su propia cubierta, no se pinta ninguna
   *
   * Dos portadas apiladas no son una portada más completa.
   */
  hero: (data: HomeSectionData, maxItems) => {
    const editorial = data.cmsTraePortada ? null : (
      <StoreHero store={data.store} storeSlug={data.storeSlug} hasOffers={data.hayOfertas} />
    )

    if (data.theme.style.heroVariant === 'statement') return editorial

    const productos = conTope(data.hero, maxItems)
    if (productos.length === 0) return editorial

    return (
      <StoreFeaturedHero
        products={productos}
        storeSlug={data.storeSlug}
        thumbnails={data.thumbsOfertas}
      />
    )
  },

  /**
   * Las dudas que tiene alguien ANTES de mirar el primer precio. En el pie se
   * leen después de decidir, o sea nunca.
   *
   * Lo que la franja DICE no lo decide este registro: lo decide
   * `resolveValueProps` con lo que el comercio configuró o, si no configuró
   * nada, con lo que la plataforma puede afirmar de cualquier tienda. El
   * identificador sigue siendo `services` porque cambiarlo rompería el orden
   * ya guardado de cada portada.
   */
  services: (data) => <StoreValueProps store={data.store} />,

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
      // P03 · Las mismas fotos que las puertas de la portada: un bloque de
      // categorías del CMS no se puede ver peor que la sección equivalente.
      categoryMedia={data.categoryMedia}
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
   * Las categorías de la PORTADA, que no son las del catálogo (H07).
   *
   * En el catálogo son píldoras —un filtro que se enciende y se apaga— y las
   * pinta la propia vista de catálogo. En la portada son PUERTAS: las familias
   * reales del tenant (las que no cuelgan de nadie), con el mismo tinte e icono
   * que el bloque de categorías del CMS, porque es el mismo componente.
   *
   * Vale igual para cualquier rubro: lo que cambia es el catálogo del
   * comercio, no el código. Sin familias, no se pinta.
   */
  categories: (data, maxItems) => {
    const familias = conTope(data.categorias, maxItems)
    if (familias.length === 0) return null

    /**
     * P04 · `categoryVariant` elige entre dos composiciones, no entre dos
     * rellenos:
     *
     *  · `tiles` son PUERTAS —azulejos altos con foto o tinte, icono y flecha—.
     *    Ocupan pantalla a cambio de decir a dónde llevan.
     *  · `pills` son NAVEGACIÓN densa: una línea que aguanta treinta familias
     *    sin empujar el catálogo fuera de la primera pantalla. Es lo que pide
     *    `catalog`, que hasta P04 lo declaraba y no lo conseguía.
     */
    const pills = data.theme.style.categoryVariant === 'pills'

    return (
      <Stack component="section" aria-label={data.t('store.categories.shopBy')} sx={{ gap: 1.5 }}>
        <SectionHeading title={data.t('store.categories.shopBy')} />
        {pills ? (
          <CategoryPills
            categories={familias}
            storeSlug={data.storeSlug}
            ariaLabel={data.t('store.categories.shopBy')}
          />
        ) : (
          <CategoryDoorGrid
            categories={familias}
            storeSlug={data.storeSlug}
            ariaLabel={data.t('store.categories.shopBy')}
          />
        )}
      </Stack>
    )
  },

  /**
   * Las marcas, al lado de las categorías: se compra por marca tanto como por
   * familia.
   */
  brands: (data, maxItems) => (
    <BrandRow
      brands={conTope(data.brands, maxItems)}
      selected={data.brandSelected}
      onSelect={data.onSelectBrand}
      seeAllHref={`/s/${data.storeSlug}?ver=todo`}
    />
  ),

  /**
   * Novedades, sobre un tinte (P06).
   *
   * El tinte no es adorno: la portada encadenaba título-tarjetas,
   * título-tarjetas, título-tarjetas, y cuatro filas idénticas seguidas se
   * recorren como una lista sin fin. Alternar el fondo entre filas es lo que
   * deja ver dónde acaba una sección y empieza la siguiente, sin meter una
   * línea divisoria en cada hueco.
   */
  'new-arrivals': (data, maxItems) => (
    <ProductRow
      tone="tinted"
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
   * Los más vendidos — o «Recomendados», según lo que los datos sostengan.
   *
   * ## La decisión que da nombre a P08
   *
   * Esta sección decía «Lo más vendido», con el antetítulo «Lo que más sale» y
   * la bajada «Los productos que más repiten nuestros clientes», sobre una lista
   * que salía del orden por RELEVANCIA del buscador. Tres afirmaciones sobre el
   * comportamiento de los compradores sostenidas por un índice de texto.
   *
   * Ahora el título depende del dato: con ranking real de pedidos dice lo que es
   * y de dónde sale; sin ventas dice «Recomendados», que es exactamente lo que
   * está enseñando. **No se cambia la lista para salvar el título: se cambia el
   * título para que diga la verdad sobre la lista.**
   *
   * El IDENTIFICADOR de la sección sigue siendo `best-sellers`. Cambiarlo
   * rompería el orden ya guardado de cada portada, y lo que tenía que cambiar
   * era el texto visible, no el contrato.
   *
   * Y sigue sin pintarse si el comercio ya compuso sus propias filas: la misma
   * sección dos veces con productos distintos no es más tienda, es una portada
   * que se contradice.
   */
  'best-sellers': (data, maxItems) => {
    if (data.cmsTraeProductos) return null
    const real = data.masVendidoEsReal

    return (
      <ProductRow
        title={data.t(real ? 'store.row.bestSellers' : 'store.row.recommended')}
        eyebrow={data.t(real ? 'store.row.bestSellersEyebrow' : 'store.row.recommendedEyebrow')}
        subtitle={data.t(real ? 'store.row.bestSellersSubtitle' : 'store.row.recommendedSubtitle')}
        products={conTope(data.masVendido, maxItems)}
        loading={data.cargandoCatalogo}
        storeSlug={data.storeSlug}
        // El ranking puede traer productos que no están en la primera página del
        // catálogo, así que sus miniaturas van en su propio lote.
        thumbnails={real ? data.thumbsMasVendido : data.thumbsCatalogo}
        seeAllHref={`/s/${data.storeSlug}?ver=todo`}
        onPrefetch={data.onPrefetch}
        onQuickView={data.onQuickView}
        favorites={data.favorites}
        onToggleFavorite={data.onToggleFavorite}
      />
    )
  },

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
      // «Productos destacados» y no «Lo más vendido»: esta fila es una muestra
      // del catálogo publicado y nunca fue otra cosa. Compartía los textos con
      // la de más vendidos, así que una tienda que encendiera las dos veía dos
      // veces el mismo título sobre dos listas distintas.
      title={data.t('store.row.highlighted')}
      eyebrow={data.t('store.row.highlightedEyebrow')}
      subtitle={data.t('store.row.highlightedSubtitle')}
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
   * Reconocimiento al cierre: quien duda de una tienda en línea deja de dudar
   * cuando ve nombres que ya conoce.
   */
  trust: (data) => <BrandTrustStrip brands={data.brands} storeSlug={data.storeSlug} />,

  /**
   * Quién es este comercio y cómo se le encuentra (Storefront V2 · P09).
   *
   * Devuelve `null` sin una sola forma de contacto: ver el componente, que es
   * donde vive esa decisión y su porqué.
   */
  'business-info': (data) => (
    <StoreBusinessInfo store={data.store} storeSlug={data.storeSlug} pages={data.paginas} />
  ),

  // Declarada en el contrato, sin componente. Ver la cabecera.
  newsletter: () => null,
}
