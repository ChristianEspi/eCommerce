import { Box, Breadcrumbs, Button, Card, Link as MuiLink, Stack, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { Suspense, lazy, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { lazyPage } from '@/app/lazyPage'
import type { SearchQuery, SearchSort } from '@/domain'
import type { PublicProduct } from './types'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { CONTENT_ANCHOR } from '@/shared/ui/SkipToContentLink'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { BackToTop } from './components/BackToTop'
import { CategoryBar } from './components/CategoryBar'
import { ProductGrid, ProductGridSkeleton } from './components/ProductGrid'
import { useFavorites } from './useFavorites'
import { StoreFilterPanel } from './components/StoreFilterPanel'
import { StoreLandingSkeleton } from './components/StoreLandingSkeleton'
import { HomeComposer } from './home/HomeComposer'
import type { HomeSectionData } from './home/types'
import { useStorefrontTheme } from './theme/useStorefrontTheme'
import { StoreSortMenu } from './components/StoreSortMenu'

/**
 * La salida del catálogo, por `lazy` (Storefront V2 · P14).
 *
 * Solo se pinta cuando una búsqueda devuelve cero resultados o muy pocos, que
 * es la minoría de las visitas. Cargarla siempre era pagar en el primer pintado
 * de la portada —donde ni siquiera puede aparecer— por una sección de rescate.
 */
const ExploreMore = lazy(() =>
  import('./components/ExploreMore').then((modulo) => ({ default: modulo.ExploreMore })),
)
import {
  OFERTAS_QUERY,
  useCatalogPages,
  useContentAssets,
  useSignedStoreAssets,
  useBestSellers,
  usePrefetchProduct,
  usePublicBrands,
  usePublicCategories,
  useSignedThumbnails,
  useStoreContent,
  useStorefront,
  useStoreNavigation,
  useStorePromotions,
} from './hooks'
import { categoryBarItems, categoryTrail, rollUpCategoryCounts } from './categoryTree'
import { hitToPublicProduct } from './search'
import { homeMeta } from './seo'

/**
 * La vista rápida se carga APARTE.
 *
 * Es un diálogo de cuatrocientas líneas —galería, variantes, cantidad, añadir
 * al carrito— que solo existe cuando alguien pulsa una tarjeta o llega con
 * `?p=` en la URL. Traerlo en la primera descarga de la portada es pagar por
 * adelantado algo que la mayoría de las visitas no abre nunca.
 *
 * `lazyPage` y no `lazy` a secas: si el trozo desaparece por un despliegue
 * mientras la pestaña está abierta, reintenta y recarga una vez en lugar de
 * enseñar «Failed to fetch dynamically imported module».
 */
const ProductQuickView = lazyPage(() =>
  import('./components/ProductQuickView').then((m) => ({ default: m.ProductQuickView })),
)

/** Cuántos resultados por página. El «ver más» suma otra tanda. */
const PAGE_SIZE = 24

/**
 * A partir de cuántos resultados la rejilla ya se sostiene sola (P07).
 *
 * El mismo número que usa la fila de la portada para crecer, y por el mismo
 * motivo: con tres tarjetas o menos queda media pantalla en blanco debajo, y
 * quien buscó algo y encontró poco necesita una salida.
 */
const POCOS_RESULTADOS = 3

const SORTS: readonly SearchSort[] = ['relevance', 'price-asc', 'price-desc', 'name', 'recent']

/**
 * Portada de la vitrina: contenido administrable + catálogo buscable.
 *
 * ## Lo que P11-SaaS cambia aquí, y por qué
 *
 * 1. **El catálogo ya no se descarga entero.** Hasta P10 la portada pedía
 *    `public_products` sin límite y filtraba en el navegador; el encargo de esta
 *    fase lo prohíbe con esas palabras («evita cargar catálogo completo al
 *    browser para buscar»). Ahora pregunta al `SearchPort`, que devuelve una
 *    PÁGINA y los contadores de las facetas.
 * 2. **La portada la escribe el comercio.** Si la sociedad tiene `content.cms`
 *    y hay una página `home` publicada, sus bloques se pintan encima del
 *    catálogo. Y si esos bloques traen un `hero`, el hero de `store_settings`
 *    NO se pinta: dos portadas apiladas no son una portada más completa.
 * 3. **Sin `content.cms` todo se ve igual que antes.** `cms: false` es una
 *    respuesta válida, no un error: hero de `store_settings` y catálogo. Se
 *    degrada, no se rompe.
 *
 * Los filtros siguen viviendo en la **URL** (`?q=&c=&d=&sort=&b=`): una
 * búsqueda se comparte, el botón de atrás hace lo que se espera y recargar no
 * borra lo que el comprador acababa de elegir.
 */
export function StoreHomePage() {
  const { t, locale } = useI18n()
  const { store, storeSlug } = useStorefront()
  // El tema trae el ORDEN de la portada. No trae los datos ni decide qué hay:
  // eso sigue resolviéndose aquí abajo, con las mismas consultas de siempre.
  const tema = useStorefrontTheme()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()

  const categorySlug = params.get('c')
  const brand = params.get('b')
  const availability = params.get('d') === '1' ? 'in-stock' : 'all'
  /**
   * Solo lo rebajado (`?oferta=1`).
   *
   * En la URL como el resto de filtros: una lista de ofertas se comparte por
   * WhatsApp, y si el filtro viviera en memoria el enlace llevaria al catalogo
   * entero. El buscador ya sabia filtrar rebajados —lo usa la portada para su
   * banda—; lo que faltaba era poder pedirlo desde la vitrina.
   */
  const soloOferta = params.get('oferta') === '1'
  const sortParam = params.get('sort')
  const sort: SearchSort = (SORTS as readonly string[]).includes(sortParam ?? '')
    ? (sortParam as SearchSort)
    : 'relevance'

  /**
   * El término ya no se teclea aquí: lo escribe el buscador de la cabecera y
   * llega por la URL. Antes esta pantalla tenía su propia caja, su rebote y un
   * efecto que sincronizaba `?q=`; con dos buscadores en pantalla —el de la
   * cabecera y el del cuerpo— cualquiera de los dos podía quedarse enseñando
   * algo distinto de lo que el catálogo estaba mostrando.
   */
  const search = params.get('q') ?? ''

  // Cambiar de término o de filtro vuelve a la primera página. Ya no hace
  // falta un `useEffect` que lo fuerce: el filtro entra en la clave de la
  // consulta paginada, así que otra combinación es otra consulta y empieza en
  // su primera página por construcción.

  function update(key: string, value: string | null) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  }

  const content = useStoreContent(storeSlug)
  const { assets, images } = useContentAssets(content.data)
  const categories = usePublicCategories(store.store_id)
  const promotions = useStorePromotions(storeSlug)

  const query: SearchQuery = useMemo(
    () => ({
      term: search,
      filters: {
        category: categorySlug,
        brands: brand ? [brand] : [],
        availability,
        ...(soloOferta ? { discounted: true } : {}),
      },
      sort,
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [search, categorySlug, brand, availability, soloOferta, sort],
  )

  const filtered = Boolean(
    search.trim() || categorySlug || brand || availability === 'in-stock' || soloOferta,
  )

  /**
   * Portada o catálogo.
   *
   * La rejilla de 400 productos con su panel de filtros es lo que se quiere
   * cuando YA se sabe qué se busca. Quien acaba de entrar necesita antes saber
   * QUÉ HAY, y eso son filas cortas con nombre: ofertas, categorías, marcas,
   * novedades. La rejilla aparece al pedirla —«Ver todo»— o en cuanto hay un
   * filtro, una búsqueda o una marca elegida, que es la misma intención dicha
   * de otra forma.
   *
   * Vive en la URL (`?ver=todo`) como el resto: se comparte, el botón de atrás
   * devuelve a la portada y recargar no cambia lo que se estaba mirando.
   */
  const catalogo = filtered || params.get('ver') === 'todo'

  const results = useCatalogPages(storeSlug, query)

  /**
   * Novedades, solo para la portada.
   *
   * `storeSlug` a `undefined` en el catálogo es lo que APAGA esta consulta: la
   * fila no se pinta ahí, y pedir doce productos que nadie va a ver es pagar
   * una llamada por cada filtro que alguien toca.
   */
  const novedadesQuery: SearchQuery = useMemo(
    () => ({ term: '', filters: {}, sort: 'recent', limit: 12, offset: 0 }),
    [],
  )
  const novedadesPages = useCatalogPages(catalogo ? undefined : storeSlug, novedadesQuery)
  const novedades = useMemo(
    () =>
      (novedadesPages.data?.pages[0]?.items ?? []).map((hit) =>
        hitToPublicProduct(hit, store.store_id),
      ),
    [novedadesPages.data, store.store_id],
  )
  const novedadesThumbs = useSignedThumbnails(novedades.map((p) => p.primary_image_path))

  const pages = useMemo(() => results.data?.pages ?? [], [results.data])
  const products = useMemo(
    () => pages.flatMap((page) => page.items.map((hit) => hitToPublicProduct(hit, store.store_id))),
    [pages, store.store_id],
  )
  const thumbnails = useSignedThumbnails(products.map((product) => product.primary_image_path))

  /**
   * Lo que abre la tienda: los productos REBAJADOS.
   *
   * Un lema sobre un degradado no dice qué se compra ni cuánto cuesta. Se piden
   * aparte —no se filtra la primera página del catálogo— porque con 568
   * productos y 60 rebajados, esperar a que la casualidad ponga uno entre los
   * primeros veinticuatro es dejar la portada al azar.
   *
   * Ocho como máximo: cuatro para el hero y el resto para la fila de ofertas.
   */
  /**
   * Lo rebajado, por la misma puerta que el resto del catálogo.
   *
   * Se pidió una vez leyendo `public_products` directamente y estaba mal: desde
   * P11 la vitrina no lee las tablas del catálogo, pregunta a la búsqueda —que
   * es quien resuelve precio de lista, disponibilidad y permisos—. Un test lo
   * vigila, y con razón.
   */
  const ofertasPages = useCatalogPages(catalogo ? undefined : storeSlug, OFERTAS_QUERY)
  const ofertas = useMemo(
    () =>
      (ofertasPages.data?.pages[0]?.items ?? []).map((hit) =>
        hitToPublicProduct(hit, store.store_id),
      ),
    [ofertasPages.data, store.store_id],
  )

  /**
   * Storefront V2 · P06 · Lo rebajado CON FOTO va primero.
   *
   * La portada de producto es media pantalla de imagen. Con un rebajado sin
   * foto abría con un marcador gris del tamaño de la cubierta —lo peor que
   * puede enseñar una tienda en su primera pantalla— mientras el siguiente
   * rebajado, que sí tenía foto, esperaba su turno en la banda de ofertas.
   *
   * No se DESCARTA nada ni se cambia qué está rebajado: solo se ordena. El
   * orden es estable —los que tienen foto conservan el suyo entre ellos, y los
   * que no, el suyo— así que una tienda sin ninguna foto ve exactamente lo que
   * veía, y la banda de ofertas sigue recibiendo a todos.
   */
  const ofertasPorMedia = useMemo(() => {
    const conFoto = ofertas.filter((producto) => Boolean(producto.primary_image_path))
    const sinFoto = ofertas.filter((producto) => !producto.primary_image_path)
    return [...conFoto, ...sinFoto]
  }, [ofertas])
  const rebajadosThumbs = useSignedThumbnails(ofertas.map((p) => p.primary_image_path))
  const prefetchProduct = usePrefetchProduct(store.store_id)

  /**
   * Storefront V2 · P08 · Los más vendidos, de los PEDIDOS.
   *
   * Hasta P08 la sección «Lo más vendido» se llenaba con `tomar(products, 12)`,
   * o sea con la primera página del catálogo ordenada por RELEVANCIA de
   * búsqueda. Tres afirmaciones sobre el comportamiento de los compradores
   * —«lo más vendido», «lo que más sale», «los que más repiten nuestros
   * clientes»— sostenidas por el orden de un índice de texto.
   *
   * Ahora sale de `store_best_sellers_for_slug`, que agrega unidades de pedidos
   * pagados o entregados de los últimos noventa días. Y cuando no hay ventas
   * devuelve la lista vacía: la sección NO cae a relevancia con el mismo
   * título, cambia de título. Ver `masVendidoEsReal` y el registro de secciones.
   *
   * Apagada en el catálogo, como el resto de consultas de portada: pedir un
   * agregado de pedidos para una fila que no se pinta es pagar por nada.
   */
  const masVendidos = useBestSellers(catalogo ? undefined : storeSlug, store.store_id)
  const masVendidoThumbs = useSignedThumbnails(
    (masVendidos.data ?? []).map((producto) => producto.primary_image_path),
  )

  const blocks = content.data?.cms ? (content.data.blocks ?? []) : []
  const hasCmsHero = blocks.some((block) => block.type === 'hero')
  /**
   * ¿Trae el CMS su propia cubierta?
   *
   * `StoreHero` es la cabecera de RESERVA: existe para que una tienda que
   * todavía no ha compuesto nada tenga portada. Un carrusel de imágenes arriba
   * YA es esa cubierta, y que apareciera el hero de reserva justo al apagar el
   * bloque del CMS es lo que hace pensar que el interruptor no funciona —se
   * apaga una cabecera y sale otra, con otro texto.
   *
   * El carrusel solo cuenta si tiene diapositivas: uno vacío no pinta nada, y
   * quitar la reserva por él dejaría la portada sin nada arriba.
   */
  const cmsTraePortada = blocks.some(
    (block) => block.type === 'hero' || (block.type === 'slider' && block.items.length > 0),
  )
  const cmsTraeProductos = blocks.some((block) => block.items.length > 0)

  /**
   * Ningún producto sale dos veces en la portada.
   *
   * Cinco secciones tiran de tres consultas —lo rebajado, lo reciente y la
   * primera página del catálogo—, y en una tienda pequeña las tres devuelven
   * casi lo mismo: el mismo frasco aparecía en el hero, en «Ofertas de la
   * semana», en «Productos destacados» y en «Novedades». Eso no se lee como
   * cuatro secciones, se lee como una tienda con cuatro productos.
   *
   * Se reparten por ORDEN DE PRIORIDAD, que es el orden en que se leen: el
   * hero coge primero, y cada sección siguiente se queda con lo que nadie ha
   * usado. Si a una no le queda nada, desaparece — mejor una sección menos que
   * una sección que repite.
   */
  /**
   * Cuántos productos se reserva la portada, y por qué puede ser CERO (P04).
   *
   * El reparto de abajo da por usado lo que el hero coge, para que el mismo
   * producto no salga en cuatro sitios. Eso era correcto mientras la portada
   * pintara siempre la de producto.
   *
   * Desde P04 hay dos composiciones: con `heroVariant: 'statement'` la portada
   * es editorial y NO pinta producto, y si el CMS trae su propia cubierta no se
   * pinta ninguna de las dos. En esos casos, reservar cuatro productos los
   * apartaba de la banda de ofertas sin enseñarlos en ninguna parte — el
   * producto rebajado desaparecía de la portada entera. Lo cazó la prueba de
   * paridad de temas, que exige que el precio y el descuento sean los mismos en
   * los cuatro.
   *
   * La decisión vive AQUÍ y no en el registro de secciones porque es la página
   * quien tiene las listas completas: el registro recibe el reparto ya hecho.
   */
  const heroReserva =
    tema.style.heroVariant === 'statement' || cmsTraePortada ? 0 : 4

  const secciones = useMemo(() => {
    const usados = new Set<string>()
    const tomar = (lista: readonly PublicProduct[], cuantos: number) => {
      const elegidos: PublicProduct[] = []
      for (const producto of lista) {
        if (elegidos.length >= cuantos) break
        if (usados.has(producto.product_id)) continue
        usados.add(producto.product_id)
        elegidos.push(producto)
      }
      return elegidos
    }

    const rebajados = ofertasPorMedia
    const ranking = masVendidos.data ?? []

    /**
     * El ranking se reparte ANTES que lo destacado (P08).
     *
     * El reparto va por orden de prioridad y cada lista se queda con lo que
     * nadie usó. Con `destacados` delante, un superventas que también estaba en
     * la primera página del catálogo se lo quedaba la banda de ofertas y
     * desaparecía de su propia sección — la fila que dice «lo más vendido»
     * enseñaba entonces el cuarto, el quinto y el sexto.
     *
     * Lo destacado es una muestra del catálogo y da igual cuál sea; el ranking
     * es una afirmación concreta sobre unos productos concretos. Manda el que
     * no se puede sustituir.
     */
    return {
      hero: tomar(rebajados, heroReserva),
      ofertas: tomar(rebajados, 3),
      masVendido: tomar(ranking.length > 0 ? ranking : products, 12),
      destacados: tomar(products, 12),
      novedades: tomar(novedades, 12),
    }
  }, [ofertasPorMedia, products, novedades, heroReserva, masVendidos.data])


  /**
   * El carrusel no repite lo que el comercio ya puso a mano.
   *
   * Una campaña puede salir por dos caminos: el bloque que el comercio escribió
   * para ella y la lista automática de campañas vigentes. Las dos a la vez, una
   * encima de otra, se leen como un fallo de la tienda — la misma oferta
   * anunciada dos veces.
   *
   * Gana el bloque escrito: lleva la foto, el texto y el botón que el comercio
   * eligió. El carrusel se queda con las que nadie ha anunciado, que son
   * justamente las que sin él no se verían en ninguna parte.
   */
  const anunciadas = new Set(
    blocks.map((block) => block.campaign?.id).filter((id): id is string => Boolean(id)),
  )
  const promosVigentes = (promotions.data ?? []).filter((promo) => !anunciadas.has(promo.id))

  // La foto de una campaña vive en el mismo bucket privado que el logo y el
  // hero, asi que necesita firma igual. Va en su propio lote porque las
  // promociones no cuelgan del contenido del CMS: son otra consulta.
  const assetsPromos = useSignedStoreAssets(promosVigentes.map((promo) => promo.imageUrl))
  const first = pages[0]
  const total = first?.total ?? 0
  const brandFacets = first?.facets.brands ?? []

  /**
   * Opciones del panel lateral.
   *
   * Las CATEGORIAS salen de la lista completa de la tienda, no de las facetas.
   * Comprobado contra la base: `catalog_search_for_slug` calcula las facetas
   * sobre el resultado YA filtrado, asi que al elegir «Sillas» vuelve una sola
   * categoria. Un panel alimentado solo por facetas se convertiria en un
   * callejon sin salida: eliges una y ya no puedes cambiar a otra.
   *
   * Por lo mismo el CONTADOR solo se ensena cuando no hay filtro de ese eje.
   * Con un filtro puesto, el resto sale a cero, y ese cero no significa «no hay
   * nada» sino «no te lo he contado». `null` es «no se sabe», y no se pinta.
   */
  /**
   * P18 · Las cifras SUMAN lo que cuelga.
   *
   * Las facetas cuentan por la categoría exacta del producto, que es lo único
   * que el producto declara. Con árbol eso deja a las madres a cero: «Nutrición»
   * reparte sus 81 productos entre sus hijas y no tiene ninguno propio. Un cero
   * al lado de una puerta que sí lleva a algún sitio dice «vacío» de algo lleno.
   */
  const categoryCounts = useMemo(() => {
    const propias = new Map<string, number | null>(
      (first?.facets.categories ?? []).map((facet) => [facet.code, facet.count]),
    )
    return rollUpCategoryCounts(categories.data ?? [], propias)
  }, [first, categories.data])
  /**
   * P18 · La barra enseña el nivel en el que se está: raíces en la portada,
   * hijas al entrar en una, hermanas dentro de una hoja. Con treinta categorías
   * planas la barra era un muro; con el árbol es una ruta.
   */
  const categoryOptions = categoryBarItems(categories.data ?? [], categorySlug).map(
    (category) => ({
      code: category.slug,
      name: category.name,
      count: categorySlug ? null : (categoryCounts.get(category.slug) ?? 0),
    }),
  )

  /** Por dónde ha llegado. Sin esto, entrar desde el buscador no dice dónde estás. */
  const trail = useMemo(
    () => categoryTrail(categories.data ?? [], categorySlug),
    [categories.data, categorySlug],
  )
  /**
   * Storefront V2 · P02 · Las marcas de la portada, con su logo.
   *
   * ## De dónde sale cada mitad, y por qué hacen falta las dos
   *
   * Las FACETAS de la búsqueda dicen qué marcas tienen producto AHORA y cuántos
   * — se calculan sobre el resultado ya filtrado, que es lo que hace que el
   * contador sea cierto. Lo que no traen es el logo, y no puede traerlo: al
   * elegir una marca las facetas devuelven una sola.
   *
   * `public_brands` trae las marcas de la tienda con su logo, en UNA consulta y
   * compartida por las dos secciones que las pintan. Cruzarlas por `code` es lo
   * que evita el N+1 —una petición por marca— que el rediseño prohíbe.
   *
   * El ORDEN manda el de las facetas (por tamaño): es el que ya tenía la fila,
   * y reordenar por nombre habría enterrado las marcas que de verdad se compran.
   */
  const brandsConLogo = usePublicBrands(catalogo ? null : store.store_id)
  const logosPorMarca = useMemo(() => {
    const mapa = new Map<string, string | null>()
    for (const marca of brandsConLogo.data ?? []) mapa.set(marca.code, marca.logo_url)
    return mapa
  }, [brandsConLogo.data])

  // Las firmas, en un lote para todas. Una por marca serían cuarenta viajes en
  // un catálogo real, y el bucket es privado: no hay URL pública que valga.
  const logosFirmados = useSignedStoreAssets(
    useMemo(() => [...logosPorMarca.values()], [logosPorMarca]),
  )

  const brandOptions = brandFacets.map((facet) => {
    const ref = logosPorMarca.get(facet.code) ?? null
    return {
      code: facet.code,
      name: facet.name,
      count: brand ? null : facet.count,
      // Una `https://` externa se pinta tal cual; una ruta, ya firmada. Si la
      // firma no ha llegado todavía, `null` y monograma: mejor el respaldo que
      // un hueco que se rellena a medio segundo.
      logoUrl: ref === null ? null : (logosFirmados[ref] ?? (/^https:\/\//i.test(ref) ? ref : null)),
    }
  })

  // Los favoritos se cargan UNA vez por tienda y se reparten a las tarjetas.
  const favorites = useFavorites(store.store_id)

  /**
   * Carga al bajar.
   *
   * Un centinela invisible bajo la rejilla: cuando entra en pantalla, se pide
   * la pagina siguiente. Se dispara 400 px ANTES de llegar (`rootMargin`) para
   * que la siguiente tanda ya este puesta cuando el ojo llega, en vez de
   * enseñar un hueco y luego rellenarlo.
   *
   * El boton «Ver mas» NO se quita: es lo que funciona con teclado, con lector
   * de pantalla y cuando el observador no existe. El desplazamiento infinito
   * sin boton es una trampa para quien no navega con rueda.
   */
  const sentinel = useRef<HTMLDivElement | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage || isFetchingNextPage) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length])

  /**
   * Cambiar de lista empieza por el principio.
   *
   * «Ver todo» no cambia de ruta —solo de parámetro—, así que el navegador
   * conserva el desplazamiento: se pulsaba desde media página y el catálogo
   * aparecía empezado por la mitad, con la cabecera y los filtros arriba, fuera
   * de la vista. Lo mismo al volver a la portada y al cambiar de categoría o de
   * marca: es OTRA lista, y una lista nueva que empieza por su fila 40 no se
   * entiende.
   *
   * No entra el ORDEN ni la disponibilidad a propósito: ahí se está mirando lo
   * mismo de otra forma, y devolver el scroll al principio haría perder el
   * sitio a quien solo quería reordenar.
   */
  const listaVista = `${catalogo}|${categorySlug ?? ''}|${brand ?? ''}|${search.trim()}`
  const listaPrevia = useRef(listaVista)
  useEffect(() => {
    if (listaPrevia.current === listaVista) return
    listaPrevia.current = listaVista
    try {
      window.scrollTo({ top: 0, behavior: 'auto' })
    } catch {
      // jsdom no implementa `scrollTo` y lo grita por consola en cada test que
      // monta la portada. Que un entorno sin scroll no pueda desplazarse no es
      // un error: es que no hay a dónde.
    }
  }, [listaVista])

  const resultCount = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE').format(total)

  /**
   * Qué se está mirando, dicho con sus palabras.
   *
   * «Todo el catálogo» solo cuando de verdad no hay filtro: si se llegó por una
   * marca o una categoría, el título es esa marca o esa categoría — es la
   * respuesta a «¿dónde estoy?», que en una lista de 400 filas es la primera
   * pregunta.
   */
  const tituloCatalogo = search.trim()
    ? `${t('store.catalog.resultsFor')} "${search.trim()}"`
    : (trail.at(-1)?.name ??
       brandOptions.find((b) => b.code === brand)?.name ??
       t('store.catalog.all'))

  // Metadatos de la portada. Cuelgan de la tienda YA RESUELTA, así que el
  // nombre, el banner y el contacto que se le enseñan a un buscador son los del
  // tenant. Se recalculan si cambia el filtro porque el canonical conserva la
  // categoría y la marca (ver `shared/seo/meta.ts`).
  useDocumentMeta(
    homeMeta(
      { store, storeSlug, locale, pathname, search: params.toString() },
      t('store.seo.catalogOf'),
    ),
  )

  /**
   * La portada no se pinta a medias.
   *
   * Al recargar se veía primero el hero de RESERVA —el lema del comercio, que
   * no necesita datos— y un segundo después el hero real con la oferta. Dos
   * portadas seguidas en la misma carga se leen como un fallo, y encima invitan
   * a pulsar algo que se va a mover.
   *
   * Con el esqueleto hay UNA carga que se ve y termina en la portada de verdad.
   * En el catálogo no aplica: allí la rejilla tiene su propio esqueleto y el
   * panel de filtros ya se puede usar mientras llegan los productos.
   */
  const cargandoPortada =
    !catalogo && (results.isPending || ofertasPages.isPending || content.isPending)

  /**
   * El orden de la portada, y qué queda de él en el catálogo.
   *
   * En el catálogo NO se pinta la portada: quien pidió «Ver todo» tendría que
   * volver a pasar por delante de todo lo que ya vio para llegar a la rejilla.
   * Sobrevive una sola sección, `promotions`, y sobrevive porque ya lo hacía:
   * una campaña vigente es igual de relevante mirando la rejilla que mirando la
   * portada, y su sitio es arriba en las dos.
   *
   * Se conserva la entrada TAL Y COMO la configuró el comercio —con su tope si
   * lo tiene— en vez de fabricar una: si alguien apagó las promociones, están
   * apagadas en los dos sitios.
   */
  const layoutAPintar = useMemo(() => {
    if (!catalogo && !cargandoPortada) return tema.layout
    const promociones = tema.layout.sections.find((seccion) => seccion.id === 'promotions')
    return { version: 1 as const, sections: promociones ? [promociones] : [] }
  }, [catalogo, cargandoPortada, tema.layout])

  /**
   * ¿Lo destacado se pinta como sección propia?
   *
   * Hoy va DENTRO de la banda de ofertas. Si el comercio lo saca a su propia
   * fila, la banda tiene que quedarse solo con lo rebajado — si no, saldría dos
   * veces en la misma pantalla.
   */
  const destacadosAparte = tema.layout.sections.some(
    (seccion) => seccion.id === 'featured' && seccion.enabled,
  )

  /**
   * ¿Están las MARCAS encendidas como sección propia? (Storefront V3 · P07)
   *
   * La misma coordinación, por el mismo motivo. `brands` y `trust` salen de la
   * misma lista de marcas: con las dos encendidas, la portada enseñaba dos veces
   * lo mismo con dos maquetaciones distintas, y eso se lee como un fallo de la
   * tienda y no como una decisión.
   *
   * Vive aquí y no en un `useContext` porque una sección que consulta a otra por
   * su cuenta es una dependencia que no se ve al leer el registro.
   */
  const marcasAparte = tema.layout.sections.some(
    (seccion) => seccion.id === 'brands' && seccion.enabled,
  )

  /**
   * H07 · Las familias para la sección `categories`: raíces, en el orden que el
   * comercio les dio. Salen de la MISMA consulta que la barra de la cabecera
   * (`usePublicCategories` comparte clave), así que no cuestan una petición.
   */
  /**
   * Storefront V2 · P03 · Las fotos de las categorías, firmadas en UN lote.
   *
   * Todas las de la tienda y no solo las raíces: las mismas fotos las necesitan
   * las puertas de la portada Y los bloques `category_collection` del CMS, que
   * pueden apuntar a cualquier nivel del árbol. Un solo lote sirve a los dos y
   * la clave de la consulta no cambia por el orden en que llegaron.
   */
  const fotosDeCategoria = useMemo(
    () => (categories.data ?? []).map((category) => category.image_url),
    [categories.data],
  )
  const fotosFirmadas = useSignedStoreAssets(fotosDeCategoria)

  /** La foto de cada categoría por id, para lo que pinta el CMS. */
  const categoryMedia = useMemo(() => {
    const mapa: Record<string, { imageUrl: string | null; imageAlt: string | null }> = {}
    for (const category of categories.data ?? []) {
      if (!category.image_url) continue
      mapa[category.category_id] = {
        // Una `https://` externa se pinta tal cual; una ruta, ya firmada. Si la
        // firma aún no ha llegado, `null` y la puerta cae a su tinte: mejor el
        // respaldo que un hueco que se rellena a medio segundo.
        imageUrl:
          fotosFirmadas[category.image_url] ??
          (/^https:\/\//i.test(category.image_url) ? category.image_url : null),
        imageAlt: category.image_alt,
      }
    }
    return mapa
  }, [categories.data, fotosFirmadas])

  const familias = useMemo(
    () =>
      (categories.data ?? [])
        .filter((category) => category.parent_id === null)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((category) => ({
          category_id: category.category_id,
          name: category.name,
          slug: category.slug,
          ...(categoryMedia[category.category_id] ?? {}),
        })),
    [categories.data, categoryMedia],
  )

  /**
   * Las páginas publicadas, para la sección `business-info` (P09).
   *
   * La MISMA consulta que hace el pie, con la misma clave: encender la sección
   * no añade una petición, la comparte. Y sale de una función de base que solo
   * devuelve páginas publicadas, dentro de su ventana y del canal público, así
   * que aquí no hay nada que filtrar.
   */
  const navegacion = useStoreNavigation(storeSlug)

  const datosPortada: HomeSectionData = {
    store,
    storeSlug,
    // P04 · El tema resuelto. Dos controles del contrato eligen COMPOSICIÓN
    // —`heroVariant` y `categoryVariant`— y eso no se puede resolver con una
    // variable de CSS: son árboles de React distintos y quien decide qué se
    // pinta es el registro de secciones.
    theme: tema,
    t,
    hero: secciones.hero,
    ofertas: secciones.ofertas,
    destacados: secciones.destacados,
    novedades: secciones.novedades,
    masVendido: secciones.masVendido,
    /**
     * ¿La fila de más vendidos está SOSTENIDA por ventas?
     *
     * Es lo que decide el título. Con ranking real dice «Lo más vendido» y
     * explica de dónde sale; sin él dice «Recomendados», que es exactamente lo
     * que está enseñando — una muestra del catálogo.
     */
    masVendidoEsReal: (masVendidos.data?.length ?? 0) > 0,
    thumbsOfertas: rebajadosThumbs,
    thumbsCatalogo: thumbnails,
    thumbsNovedades: novedadesThumbs,
    // Los más vendidos vienen del MISMO modelo de lectura que el catálogo, así
    // que sus miniaturas ya están en el lote del catálogo cuando coinciden; las
    // que no, se firman aquí.
    thumbsMasVendido: masVendidoThumbs,
    blocks,
    assets,
    images,
    hasCmsHero,
    cmsTraePortada,
    cmsTraeProductos,
    promociones: promosVigentes,
    promoAssets: assetsPromos,
    categorias: familias,
    categoryMedia,
    paginas: navegacion.data ?? [],
    brands: brandOptions,
    brandSelected: brand,
    // Lo mismo que ya sabe la banda de ofertas, sin preguntarlo dos veces.
    hayOfertas: ofertas.length > 0,
    favorites: favorites.ids,
    cargandoNovedades: novedadesPages.isPending,
    // El ranking cuenta como carga de esta fila: sin esto, la portada enseñaría
    // «Recomendados» medio segundo y lo cambiaría por «Lo más vendido» al
    // llegar el agregado, que se lee como un fallo.
    cargandoCatalogo: results.isPending || masVendidos.isPending,
    onToggleFavorite: (productId) => void favorites.toggle(productId),
    onQuickView: (slug) => update('p', slug),
    onPrefetch: prefetchProduct,
    onSelectBrand: (code) => update('b', code),
    destacadosAparte,
    marcasAparte,
  }

  return (
    <Stack sx={{ gap: { xs: 2, md: 3 } }}>
      {cargandoPortada ? <StoreLandingSkeleton /> : null}

      {/* El `<h1>` cuando la cubierta es un carrusel.
          Un carrusel son imágenes: no tiene texto que pueda ser el encabezado
          de nivel 1, y sin esto la portada se quedaría sin él en cuanto el
          comercio cambiara el hero por un banner rotatorio. Va oculto a la
          vista y no al lector: quien navega por encabezados necesita saber
          dónde empieza el documento, y el nombre de la tienda ya está escrito
          arriba en la cabecera.

          Va ANTES del compositor y no entre las secciones: es el encabezado del
          documento, y quien navega por encabezados espera encontrarlo antes de
          lo que titula, no después de la primera banda. */}
      {!catalogo && cmsTraePortada && !hasCmsHero && (
        <Typography component="h1" sx={visuallyHidden}>
          {store.name}
        </Typography>
      )}


      {/* Cabecera del catálogo: de dónde se viene, qué se está mirando y cómo
          se vuelve. Sin esto, «Ver todo» dejaba una rejilla sin título y sin
          camino de vuelta que no fuera el botón de atrás del navegador. */}
      {cargandoPortada ? null : catalogo ? (
        <Stack sx={{ gap: 0.5 }}>
          <MuiLink
            component={Link}
            to={`/s/${storeSlug}`}
            sx={{
              fontSize: TS.label,
              fontWeight: 700,
              color: 'var(--muted)',
              textDecoration: 'none',
              alignSelf: 'flex-start',
              '&:hover': { color: 'var(--accent-deep)' },
            }}
          >
            {`\u2190 ${t('store.catalog.back')}`}
          </MuiLink>
          <Typography
            component="h1"
            sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 800, letterSpacing: '-0.02em' }}
          >
            {tituloCatalogo}
          </Typography>
        </Stack>
      ) : null}

      {/* La portada, en el orden que el comercio configuró.
          El compositor no decide QUÉ hay —eso se resolvió arriba, con los datos
          completos— sino en qué orden se pinta y qué queda encendido.

          Va DESPUÉS de la cabecera del catálogo porque en esa vista sobrevive
          una sección, `promotions`, y su sitio es bajo el título, igual que
          antes. En la portada esa cabecera no existe, así que aquí empieza
          todo. */}
      <HomeComposer layout={layoutAPintar} data={datosPortada} />

      {/* Dos formas de la misma lista, y la diferencia no es de adorno.
          En el CATÁLOGO son píldoras: ahí son un filtro, se comparan de un
          vistazo y se encienden y apagan. En la PORTADA son puertas, y una
          puerta tiene que decir a dónde lleva —de ahí el icono, que separa una
          familia de otra antes de leerla— y cuánto hay detrás. */}
      {cargandoPortada ? null : catalogo ? (
        <Stack sx={{ gap: 1 }}>
          {/* Las migas: sin ellas, quien abre «Desodorantes» desde el buscador
              no sabe que esta dentro de «Cuidado personal» ni como subir. */}
          {trail.length > 0 && (
            <Breadcrumbs
              aria-label={t('store.categories.title')}
              separator="›"
              sx={{ fontSize: TS.label, color: 'var(--muted)' }}
            >
              <MuiLink
                component="button"
                type="button"
                underline="hover"
                onClick={() => update('c', null)}
                sx={{ fontSize: TS.label, color: 'var(--muted)' }}
              >
                {/* «Todo el catálogo» y no «Todo»: la píldora de la barra ya se
                    llama así, y dos controles con el mismo nombre en la misma
                    pantalla no se distinguen ni con el ratón ni con un lector. */}
                {t('store.catalog.all')}
              </MuiLink>
              {trail.map((node, index) =>
                index === trail.length - 1 ? (
                  <Box key={node.category_id} component="span" sx={{ fontWeight: 700, color: 'var(--text)' }}>
                    {node.name}
                  </Box>
                ) : (
                  <MuiLink
                    key={node.category_id}
                    component="button"
                    type="button"
                    underline="hover"
                    onClick={() => update('c', node.slug)}
                    sx={{ fontSize: TS.label, color: 'var(--muted)' }}
                  >
                    {node.name}
                  </MuiLink>
                ),
              )}
            </Breadcrumbs>
          )}
          <CategoryBar
            categories={categoryBarItems(categories.data ?? [], categorySlug)}
            selected={categorySlug}
            onSelect={(slug) => update('c', slug)}
          />
        </Stack>
      ) : null}

      {/* Una tienda sin catalogo publicado no puede quedarse en una portada
          muda: sin filas ni bloques, aqui no habria NADA, y una pantalla vacia
          sin explicacion parece rota. */}
      {!catalogo && results.isSuccess && total === 0 && blocks.length === 0 && (
        <Card>
          <EmptyState
            title={t('store.catalog.empty')}
            description={t('store.catalog.emptyBody')}
          />
        </Card>
      )}

      {cargandoPortada ? null : catalogo ? (
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: { xs: 2, md: 3 }, alignItems: 'flex-start' }}>
        <Box sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
          <StoreFilterPanel
            brands={brandOptions}
            categories={categoryOptions}
            selectedBrand={brand}
            selectedCategory={categorySlug}
            inStockOnly={availability === 'in-stock'}
            discountedOnly={soloOferta}
            onBrand={(code) => update('b', code)}
            onCategory={(slug) => update('c', slug)}
            onInStock={(only) => update('d', only ? '1' : null)}
            onDiscounted={(only) => update('oferta', only ? '1' : null)}
            // Quitar los filtros deja el CATALOGO, no la portada: quien pulsa
            // «limpiar» quiere verlo todo, no volver a la primera pantalla.
            onClear={() => setParams(new URLSearchParams({ ver: 'todo' }))}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {/* Cuántos resultados hay y en qué orden se miran, en la misma línea
              y encima de la rejilla: son las dos preguntas que se hacen antes
              de empezar a recorrerla. */}
          <Stack
            direction="row"
            sx={{ gap: 1.5, alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap' }}
          >
            <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography
                aria-live="polite"
                sx={{ fontSize: TS.label, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}
              >
                {`${resultCount} ${total === 1 ? t('store.catalog.result') : t('store.catalog.results')}`}
              </Typography>
              {/* Un resultado por tolerancia a erratas no es lo mismo que uno
                  exacto, y decirlo es la diferencia entre ayudar y fingir. */}
              {first?.mode === 'fuzzy' && (
                <Typography sx={{ fontSize: TS.label, color: 'var(--amber)', fontWeight: 700 }}>
                  {t('store.search.fuzzy')}
                </Typography>
              )}
            </Stack>
            <StoreSortMenu value={sort} onChange={(next) => update('sort', next)} />
          </Stack>

          {results.isPending && <ProductGridSkeleton />}

          {results.isError && (
            <Card>
              <ErrorState error={results.error} onRetry={() => void results.refetch()} />
            </Card>
          )}

          {results.isSuccess && total === 0 && (
            <Card>
              <EmptyState
                title={filtered ? t('store.catalog.noResults') : t('store.catalog.empty')}
                description={filtered ? t('store.catalog.noResultsBody') : t('store.catalog.emptyBody')}
                action={
                  filtered ? (
                    <Button variant="contained" onClick={() => setParams(new URLSearchParams())}>
                      {t('store.catalog.clear')}
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          )}

          {results.isSuccess && total > 0 && (
            <Box>
              <ProductGrid
                products={products}
                storeSlug={storeSlug}
                thumbnails={thumbnails}
                onPrefetch={prefetchProduct}
                onQuickView={(slug) => update('p', slug)}
                favorites={favorites.ids}
                onToggleFavorite={(productId) => void favorites.toggle(productId)}
              />

          {/* La siguiente página se PIDE al servidor: 24 filas, no las 48 o 72
              que costaba subir el techo y volver a pedir desde cero. */}
          {results.hasNextPage && (
            <Stack sx={{ alignItems: 'center', gap: 1, mt: 2 }}>
              {/* Invisible y sin alto: solo marca el punto a partir del cual
                  vale la pena pedir la siguiente pagina. */}
              <Box ref={sentinel} aria-hidden sx={{ height: 1, width: '100%' }} />

              {results.isFetchingNextPage ? (
                <BrandLoader label={t('store.catalog.loadingMore')} compact />
              ) : (
                <Button variant="outlined" onClick={() => void results.fetchNextPage()}>
                  {t('store.catalog.more')}
                </Button>
              )}
            </Stack>
          )}

          {!results.hasNextPage && products.length > PAGE_SIZE && (
            <Typography
              sx={{ fontSize: TS.label, color: 'var(--muted)', textAlign: 'center', mt: 2 }}
            >
              {t('store.catalog.endOfList')}
            </Typography>
          )}
            </Box>
          )}

          {/* P07 · Con pocos resultados, una salida que NO es un resultado.

              Va DEBAJO de la rejilla, en su propia sección y con su propio
              título, y no lleva ni un producto: solo familias y marcas. Meter
              productos «recomendados» dentro de la rejilla sería añadir a la
              lista cosas que el filtro no devolvió, y el contador de arriba
              pasaría a mentir — «2 resultados» sobre nueve tarjetas.

              El umbral es el mismo que usa la fila de la portada para crecer:
              hasta tres, la pantalla se queda corta. */}
          {results.isSuccess && total > 0 && total <= POCOS_RESULTADOS && (
            <Suspense fallback={null}>
              <ExploreMore
                storeSlug={storeSlug}
                categories={familias.map((f) => ({ code: f.slug, name: f.name }))}
                brands={brandOptions}
                selectedCategory={categorySlug}
                selectedBrand={brand}
              />
            </Suspense>
          )}

          {/* Y sin NINGÚN resultado, la misma salida bajo el estado vacío: el
              botón de quitar filtros arregla el caso de quien filtró de más,
              pero no el de quien buscó algo que esta tienda no vende. */}
          {results.isSuccess && total === 0 && (
            <Suspense fallback={null}>
              <ExploreMore
                storeSlug={storeSlug}
                categories={familias.map((f) => ({ code: f.slug, name: f.name }))}
                brands={brandOptions}
                selectedCategory={categorySlug}
                selectedBrand={brand}
              />
            </Suspense>
          )}
        </Box>
      </Stack>
      ) : null}

      {/* El producto abierto vive en `?p=`: el boton de atras cierra el
          dialogo y el enlace se puede pegar en un chat. */}
      <BackToTop anchorId={CONTENT_ANCHOR} />

      {/* Solo se monta —y solo se descarga— cuando hay un producto abierto. El
          `Suspense` no pinta nada mientras llega: un diálogo que aún no existe
          no deja hueco, y el catálogo de debajo se sigue usando igual. */}
      {params.get('p') && (
        <Suspense fallback={null}>
          <ProductQuickView
            storeId={store.store_id}
            storeSlug={storeSlug}
            slug={params.get('p')}
            onClose={() => update('p', null)}
          />
        </Suspense>
      )}
    </Stack>
  )
}
