import { Suspense, lazy } from 'react'
/**
 * El muro de logotipos viene ESTÁTICO, y es a propósito (V3 · P07).
 *
 * Sacarlo a su propio trozo parecía gratis —lo ve una minoría de las tiendas—
 * y sale al revés: comparte `BrandRow`, `BrandLogo` y `SectionHeading` con la
 * fila de marcas, que sí es el defecto de tres temas y ya viaja en la portada.
 * El empaquetador acaba con un trozo aparte que depende ESTÁTICAMENTE del de la
 * portada: mismos bytes en el primer pintado, una petición más, y la portada
 * deja de ser un punto de entrada con nombre propio —con lo que el informe de
 * bundle ya no la encuentra—. Medido en P07: 403.0 kB en los dos casos.
 */
import { BrandLogoWall } from '../components/BrandLogoWall'
import { BrandRow } from '../components/BrandRow'
import { BrandTrustStrip } from '../components/BrandTrustStrip'
import { Stack } from '@mui/material'
import { OffersFeaturedBand } from '../components/OffersFeaturedBand'
import { ProductRow } from '../components/ProductRow'
import { PromoCarousel } from '../components/PromoCarousel'
import { SectionHeading } from '../components/SectionHeading'
import { StoreFeaturedHero } from '../components/StoreFeaturedHero'
import { StoreHero } from '../components/StoreHero'
import { StoreBusinessInfo } from '../components/StoreBusinessInfo'
import { StoreValueProps } from '../components/StoreValueProps'
import type { ResolvedPresentation } from '../theme/presentation'
import type { HomeSectionData, HomeSectionRegistry } from './types'

/**
 * El contenido del CMS llega por `lazy` (Storefront V2 · P14).
 *
 * Son ocho kilobytes gzip —nueve tipos de bloque, su carrusel y su mural de
 * campañas— que hasta P14 descargaba **toda** tienda, tuviera contenido o no.
 * La mayoría no lo tiene: el módulo de contenido es un addon, y una tienda sin
 * él recibe cero bloques.
 *
 * Y cuando sí lo tiene, tampoco se pierde nada: los bloques llegan por consulta
 * y el módulo se descarga mientras esa consulta viaja. Lo que se evita es pagar
 * el peso en el primer pintado de quien no va a ver ni un bloque.
 *
 * Es lo que devolvió el recorrido de la portada por debajo de su techo
 * (`docs/performance-budget.md`): el rediseño lo había dejado en 417 kB.
 */
/**
 * Las puertas de las familias, también por `lazy` (Storefront V2 · P14).
 *
 * La sección `categories` viene **apagada en los cuatro temas**: encenderla es
 * una decisión del comercio, y hasta P14 su módulo —las puertas, sus tintes y
 * sus fotos— lo descargaba toda tienda, la tuviera encendida o no.
 *
 * Cuando sí está encendida se monta igual, y lo que cuesta es una petición de
 * cuatro kilobytes que empieza con el primer pintado. La alternativa era
 * cobrársela a las tiendas que no la usan, que hoy son todas las que no la
 * tocaron.
 */
const CategoryDoorGrid = lazy(() =>
  import('../components/CategoryDoors').then((modulo) => ({ default: modulo.CategoryDoorGrid })),
)
const CategoryPills = lazy(() =>
  import('../components/CategoryDoors').then((modulo) => ({ default: modulo.CategoryPills })),
)
/**
 * El mosaico también por `lazy` (Storefront V3 · P07), por lo mismo que las
 * otras dos: la sección viene apagada en los cuatro temas, y su módulo no tiene
 * por qué pesar en la portada de quien no la enciende.
 */
const CategoryMosaic = lazy(() =>
  import('../components/CategoryMosaic').then((modulo) => ({ default: modulo.CategoryMosaic })),
)

const ContentBlocks = lazy(() =>
  import('../components/ContentBlocks').then((modulo) => ({ default: modulo.ContentBlocks })),
)

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

/**
 * Las fotos del collage del hero (Storefront V3 · P04).
 *
 * ## De dónde salen, y por qué de ahí
 *
 * De los productos que la portada YA tiene cargados y de las miniaturas que YA
 * firmó para sus filas. Cero consultas nuevas: decorar una portada no puede
 * costar una petición por visita, y menos una por foto — con tres fotos serían
 * tres firmas de URL antes del primer pintado.
 *
 * El orden importa: primero lo rebajado —que es lo que la tienda quiere enseñar
 * y ya viene ordenado por descuento— y después el catálogo. Si lo rebajado no
 * tiene fotos, el catálogo completa; si nadie tiene fotos, el hero cae a su
 * siguiente respaldo, que es lo correcto.
 */
function fotosParaElCollage(data: HomeSectionData): string[] {
  const candidatos = [...data.ofertas, ...data.destacados, ...data.novedades]
  const firmadas = { ...data.thumbsOfertas, ...data.thumbsCatalogo, ...data.thumbsNovedades }

  const urls: string[] = []
  for (const producto of candidatos) {
    if (urls.length >= 3) break
    const ruta = producto.primary_image_path
    if (!ruta) continue
    const url = firmadas[ruta]
    // Sin firmar todavía no vale: un `src` con la ruta cruda del bucket da 403
    // y el hero se quedaría con un hueco en vez de caer a su respaldo.
    if (!url || urls.includes(url)) continue
    urls.push(url)
  }
  return urls
}

/**
 * La foto de una familia, para el respaldo siguiente al collage.
 *
 * Misma regla: sale de las familias que la portada ya cargó, y solo si alguna
 * tiene foto de verdad. La plataforma no pone una imagen de archivo en la
 * portada de nadie.
 */
function primeraFotoDeFamilia(data: HomeSectionData): string | null {
  for (const familia of data.categorias) {
    const url = familia.imageUrl
    if (url && url.trim() !== '') return url
  }
  return null
}

/**
 * El reparto que pide la portada, en el vocabulario de la fila (V3 · P06).
 *
 * La presentación llega ya resuelta, así que aquí no hay `auto`: lo único que se
 * comprueba es que el valor sea uno de los tres que la fila entiende. Si llegara
 * otro —una fila configurada con la variante de otra familia de sección—, la
 * fila decide por cantidad, que es su comportamiento de siempre.
 *
 * Está en una función y no repetido tres veces porque es el único punto donde se
 * cruzan los dos vocabularios, y tres copias del mismo cruce es tres sitios
 * donde se puede olvidar uno.
 */
function repartoDeFila(
  presentation: ResolvedPresentation | undefined,
): 'rail' | 'grid' | 'spotlight' | undefined {
  const valor = presentation?.variant
  return valor === 'rail' || valor === 'grid' || valor === 'spotlight' ? valor : undefined
}

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
      <StoreHero
        store={data.store}
        storeSlug={data.storeSlug}
        hasOffers={data.hayOfertas}
        // Storefront V3 · P04 · Las fotos del collage, de datos YA cargados.
        media={fotosParaElCollage(data)}
        categoryImage={primeraFotoDeFamilia(data)}
      />
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

  cms: (data) => {
    // Sin bloques no se monta nada, y así una tienda sin contenido tampoco
    // descarga el módulo. Devolver `null` es lo que el compositor ya espera de
    // una sección sin nada que pintar.
    if (data.blocks.length === 0) return null

    return (
      <Suspense fallback={null}>
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
      </Suspense>
    )
  },

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
  categories: (data, maxItems, presentation) => {
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
    /**
     * Cómo se enseñan las familias: lo que pida la SECCIÓN, y si no dice nada,
     * lo que declare el tema (Storefront V3 · P06).
     *
     * La presentación llega ya resuelta, así que aquí no hay `auto` que decidir:
     * `resolveSectionPresentation` puso el valor del tema donde la sección no
     * dijo nada.
     */
    const comoSeEnsenan = presentation?.variant ?? data.theme.style.categoryVariant
    const pills = comoSeEnsenan === 'pills'
    const mosaico = comoSeEnsenan === 'mosaic'

    // Las puertas llegan por `lazy`, sin fallback: lo que hay debajo no se
    // mueve de sitio —la sección ya tiene su título— y un esqueleto de cuatro
    // azulejos para cuatro kilobytes parpadearía más de lo que informa.
    return (
      <Suspense fallback={null}>
        <Stack component="section" aria-label={data.t('store.categories.shopBy')} sx={{ gap: 1.5 }}>
          <SectionHeading title={data.t('store.categories.shopBy')} />
          {mosaico ? (
            /**
             * El MOSAICO (Storefront V3 · P07): la primera familia ocupa el doble.
             *
             * Los azulejos dicen que ninguna familia manda —y eso es correcto en
             * Universal—; el mosaico dice cuál manda, que es lo que convierte
             * una fila de puertas en una portada editorial.
             *
             * Las puertas son las MISMAS: misma foto, mismo tinte de reserva,
             * mismo icono y mismo enlace con su filtro. Un mosaico con otro tipo
             * de puerta serían dos componentes que hay que arreglar dos veces.
             */
            <CategoryMosaic
              categories={familias}
              storeSlug={data.storeSlug}
              ariaLabel={data.t('store.categories.shopBy')}
            />
          ) : pills ? (
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
      </Suspense>
    )
  },

  /**
   * Las marcas, al lado de las categorías: se compra por marca tanto como por
   * familia.
   */
  brands: (data, maxItems, presentation) => {
    const marcas = conTope(data.brands, maxItems)

    /**
     * Tarjetas o muro de logotipos (Storefront V3 · P07).
     *
     * Son dos preguntas distintas. Las tarjetas dan a cada marca su caja, su
     * nombre y su CUENTA de productos: es lo correcto cuando la marca es un
     * FILTRO y quien busca quiere saber cuántas referencias hay detrás.
     *
     * El muro no informa, RECONOCE — y para eso el logotipo tiene que estar
     * limpio: sin caja, sin tinte y sin la cuenta al lado. Quien duda de una
     * tienda en línea deja de dudar cuando ve nombres que ya conoce.
     */
    if (presentation?.variant === 'logos') {
      return (
        <BrandLogoWall
          brands={marcas}
          selected={data.brandSelected}
          onSelect={data.onSelectBrand}
          seeAllHref={`/s/${data.storeSlug}?ver=todo`}
        />
      )
    }

    return (
      <BrandRow
        brands={marcas}
        selected={data.brandSelected}
        onSelect={data.onSelectBrand}
        seeAllHref={`/s/${data.storeSlug}?ver=todo`}
      />
    )
  },

  /**
   * Novedades, sobre un tinte (P06).
   *
   * El tinte no es adorno: la portada encadenaba título-tarjetas,
   * título-tarjetas, título-tarjetas, y cuatro filas idénticas seguidas se
   * recorren como una lista sin fin. Alternar el fondo entre filas es lo que
   * deja ver dónde acaba una sección y empieza la siguiente, sin meter una
   * línea divisoria en cada hueco.
   */
  'new-arrivals': (data, maxItems, presentation) => (
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
      presentation={repartoDeFila(presentation)}
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
  'best-sellers': (data, maxItems, presentation) => {
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
        presentation={repartoDeFila(presentation)}
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
  featured: (data, maxItems, presentation) => (
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
      presentation={repartoDeFila(presentation)}
    />
  ),

  /**
   * Reconocimiento al cierre: quien duda de una tienda en línea deja de dudar
   * cuando ve nombres que ya conoce.
   */
  /**
   * Reconocimiento al cierre — y sin repetir la sección de marcas (V3 · P07).
   *
   * `brands` y `trust` salen de la misma lista, así que una portada con las dos
   * encendidas enseñaba dos veces lo mismo con dos maquetaciones distintas. Eso
   * se lee como un fallo de la tienda, no como una decisión.
   *
   * `trust` sigue en el contrato porque su trabajo es otro —cerrar la página con
   * nombres conocidos, no ofrecer un filtro— y sigue siendo la franja compacta
   * de siempre. Lo que se añade es que **se calla si `brands` ya lo dijo**.
   */
  trust: (data) =>
    data.marcasAparte ? null : (
      <BrandTrustStrip brands={data.brands} storeSlug={data.storeSlug} />
    ),

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
