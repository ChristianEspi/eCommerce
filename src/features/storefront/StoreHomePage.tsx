import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import { Box, Breadcrumbs, Button, Card, FormControlLabel, Link as MuiLink, Skeleton, Stack, Switch, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useCommerceContext } from './commerce/context'
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
import { CatalogOffersBand } from './components/CatalogOffersBand'
import { CatalogViewToggle } from './components/CatalogViewToggle'
import { ProductGrid, ProductGridSkeleton, type CatalogView } from './components/ProductGrid'
import { useFavorites } from './useFavorites'
import { StoreLandingSkeleton } from './components/StoreLandingSkeleton'
import { HomeComposer } from './home/HomeComposer'
import type { HomeSectionData } from './home/types'
import { campanaQueTerminaAntes } from './feria'
import { resolveSectionPresentation } from './theme/presentation'
import type { HomeSectionConfig, HomeSectionId } from './theme/types'
import { useStorefrontTheme } from './theme/useStorefrontTheme'

/**
 * La salida del catálogo, por `lazy` (Storefront V2 · P14).
 *
 * Solo se pinta cuando una búsqueda devuelve cero resultados o muy pocos, que
 * es la minoría de las visitas. Cargarla siempre era pagar en el primer pintado
 * de la portada —donde ni siquiera puede aparecer— por una sección de rescate.
 */
const ExploreMore = lazyPage(() =>
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
import { categoryBarAllSlug, categoryBarItems, categoryTrail, rollUpCategoryCounts } from './categoryTree'
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

/**
 * La vista de CATÁLOGO, aparte de la portada (Storefront V3 · P09).
 *
 * Estos tres —la barra, el panel de filtros y el menú de orden— solo existen
 * cuando alguien pide «Ver todo» o toca un filtro. En la portada no se pintan
 * nunca, así que viajaban en la primera descarga de TODAS las visitas para no
 * aparecer en la mayoría de ellas.
 *
 * Es la misma regla que la vista rápida y el cajón: lo que aparece por una
 * acción se descarga con la acción. El presupuesto de la portada se había
 * quedado a 0,1 kB del techo, y esto es lo que lo devuelve a un margen con el
 * que se puede seguir trabajando (396,0 kB de 405).
 */
const StoreCatalogToolbar = lazyPage(() =>
  import('./components/StoreCatalogToolbar').then((m) => ({ default: m.StoreCatalogToolbar })),
)
const StoreFilterPanel = lazyPage(() =>
  import('./components/StoreFilterPanel').then((m) => ({ default: m.StoreFilterPanel })),
)
const StoreSortMenu = lazyPage(() =>
  import('./components/StoreSortMenu').then((m) => ({ default: m.StoreSortMenu })),
)

/**
 * Y el cajón de filtros del teléfono, también aparte (Storefront V3 · P09).
 *
 * Solo se monta cuando alguien pulsa «Filtros», que en escritorio no existe y
 * en el teléfono es una minoría de las visitas. Traerlo en la primera descarga
 * del catálogo sería pagar un diálogo por adelantado por cada visita que no lo
 * abre.
 */
const StoreFilterDrawer = lazyPage(() =>
  import('./components/StoreFilterDrawer').then((m) => ({ default: m.StoreFilterDrawer })),
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

/**
 * Por debajo de esto «Todo el catálogo» no lleva fila de más vendidos ni de
 * novedades: el catálogo entero cabe en la primera pantalla de la rejilla y la
 * fila enseñaría los mismos productos dos veces.
 */
const FILA_CATALOGO_MIN = 12

const SORTS: readonly SearchSort[] =['relevance', 'price-asc', 'price-desc', 'name', 'recent', 'discount']

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
  /** Rediseño v3 · El catálogo retail con la composición de su lámina. */
  const plpRetail = tema.preset === 'retail'
  /**
   * Rediseño v3 · Migas desde «Inicio» y total junto al título: retail y
   * universal (sus dos láminas de catálogo lo piden igual).
   */
  const plpMigas = plpRetail || tema.preset === 'universal'
  /** Universal: las familias viven en el panel de filtros, sin píldoras. */
  const sinPildoras = tema.preset === 'universal'
  const { pathname, hash } = useLocation()
  const [params, setParams] = useSearchParams()

  const categorySlug = params.get('c')
  /**
   * Marcas elegidas (`?b=tecnofarma,quilab`): varias a la vez, sumadas con «o».
   * `brand` sigue siendo la primera, para quien solo necesita saber si hay una.
   */
  const brandsParam = params.get('b') ?? ''
  const brands = useMemo(
    () => brandsParam.split(',').map((code) => code.trim()).filter(Boolean),
    [brandsParam],
  )
  const brand = brands[0] ?? null
  /** Rango de precio (`?pmin=&pmax=`), como texto: es dinero. */
  const precioValido = (valor: string | null) =>
    valor !== null && valor.trim() !== '' && Number.isFinite(Number(valor)) && Number(valor) >= 0 ? valor : null
  const priceMin = precioValido(params.get('pmin'))
  const priceMax = precioValido(params.get('pmax'))
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

  /**
   * Pone o quita un parámetro de la URL, que es donde vive el estado.
   *
   * `useCallback` desde V3 · P09: la lista de filtros puestos la construye un
   * `useMemo` que lo llama, y con una función nueva en cada pintado ese memo no
   * podría declarar honestamente sus dependencias. `setParams` es estable, así
   * que esto también.
   */
  const update = useCallback(
    (key: string, value: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      })
    },
    [setParams],
  )

  /**
   * A una familia, o al catálogo ENTERO con `null` (2026-10-04). Quitar la
   * categoría a secas no basta: sin categoría ni `ver=todo` la página es la
   * portada, y «Todo» sacaba al comprador del catálogo.
   */
  const irAFamilia = useCallback(
    (slug: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (slug) {
          next.set('c', slug)
        } else {
          next.delete('c')
          next.set('ver', 'todo')
        }
        return next
      })
    },
    [setParams],
  )

  const content = useStoreContent(storeSlug)
  const { assets, images } = useContentAssets(content.data)
  const categories = usePublicCategories(store.store_id)
  const promotions = useStorePromotions(storeSlug)

  const query: SearchQuery = useMemo(
    () => ({
      term: search,
      filters: {
        category: categorySlug,
        brands,
        availability,
        ...(soloOferta ? { discounted: true } : {}),
        ...(priceMin ? { priceMin } : {}),
        ...(priceMax ? { priceMax } : {}),
      },
      sort,
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [search, categorySlug, brands, availability, soloOferta, sort, priceMin, priceMax],
  )

  const filtered = Boolean(
    search.trim() ||
      categorySlug ||
      brands.length > 0 ||
      availability === 'in-stock' ||
      soloOferta ||
      priceMin ||
      priceMax,
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
   * Las marcas SIN el filtro de marcas, para poder elegir varias.
   *
   * El buscador cuenta las facetas sobre el resultado ya filtrado: con
   * «Tecnofarma» marcada, la lista de marcas volvía con una sola y no había
   * forma de sumar «Quilab». Esta consulta pide lo mismo quitando las marcas y
   * solo UNA fila —lo que interesa son sus facetas—. Solo corre cuando hay
   * marcas marcadas; sin ellas, las facetas de la consulta principal ya valen.
   */
  const universoMarcasQuery: SearchQuery = useMemo(
    () => ({ ...query, filters: { ...query.filters, brands: [] }, limit: 1 }),
    [query],
  )
  const universoMarcas = useCatalogPages(
    catalogo && brands.length > 0 ? storeSlug : undefined,
    universoMarcasQuery,
  )

  /**
   * «Todo el catálogo» sin ningún filtro: la única vista de catálogo que lleva
   * una fila encima de la rejilla (lo más vendido o, si no hay ventas, las
   * novedades). Con un filtro puesto, quien mira ya dijo qué busca.
   */
  const vistaTodo = catalogo && !filtered

  /**
   * Novedades, para la portada y para «Todo el catálogo».
   *
   * `storeSlug` a `undefined` en el resto del catálogo es lo que APAGA esta
   * consulta: la fila no se pinta ahí, y pedir doce productos que nadie va a
   * ver es pagar una llamada por cada filtro que alguien toca.
   */
  const novedadesQuery: SearchQuery = useMemo(
    () => ({ term: '', filters: {}, sort: 'recent', limit: 12, offset: 0 }),
    [],
  )
  const novedadesPages = useCatalogPages(catalogo && !vistaTodo ? undefined : storeSlug, novedadesQuery)
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
  const masVendidos = useBestSellers(catalogo && !vistaTodo ? undefined : storeSlug, store.store_id)
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

  /**
   * Resumen v2 · Cuántas ofertas se reservan para la banda: tres para la de
   * siempre, seis para la relámpago (`flash`), que las pinta en una fila de
   * seis. Se resuelve con la MISMA regla que usa el compositor.
   */
  const ofertasEnBanda =
    resolveSectionPresentation({
      id: 'offers',
      presentation: tema.layout.sections.find((section) => section.id === 'offers')?.presentation,
      preset: tema.preset,
      categoryVariant: tema.style.categoryVariant,
      productCardVariant: tema.style.productCardVariant,
    }).variant === 'flash'
      ? 6
      : 3

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
      ofertas: tomar(rebajados, ofertasEnBanda),
      masVendido: tomar(ranking.length > 0 ? ranking : products, 12),
      destacados: tomar(products, 12),
      novedades: tomar(novedades, 12),
    }
  }, [ofertasPorMedia, products, novedades, heroReserva, ofertasEnBanda, masVendidos.data])


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
  /**
   * ¿Lo que hay en pantalla es la respuesta a lo que se está mirando AHORA?
   *
   * Con `keepPreviousData`, al cambiar de categoría o de filtro la consulta
   * sigue devolviendo la página anterior (`isPlaceholderData`) hasta que llega
   * la nueva. Esa página vieja no se pinta: se pinta el esqueleto.
   */
  const cargandoResultados = results.isPending || results.isPlaceholderData
  const resultadosListos = results.isSuccess && !results.isPlaceholderData
  const brandFacets =
    (brands.length > 0 ? universoMarcas.data?.pages[0]?.facets.brands : first?.facets.brands) ?? []
  const priceBounds = first?.facets.price ?? null

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
  /** ¿El buscador contó por familia? Sin cuentas, ni se enseñan ni se oculta nada. */
  const hayCuentasDeFamilia = (first?.facets.categories.length ?? 0) > 0
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
  const directorioMarcas = catalogo && hash === '#marcas'
  const brandsConLogo = usePublicBrands(catalogo && !directorioMarcas ? null : store.store_id)
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

  // Con `#marcas` el directorio llega después de la rejilla: se baja a él en
  // cuanto existe, sin animación si el comprador pidió menos movimiento.
  const hayMarcas = brandFacets.length > 0
  useEffect(() => {
    if (!directorioMarcas || !hayMarcas) return
    const marco = requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      document.getElementById('marcas')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(marco)
  }, [directorioMarcas, hayMarcas])

  const brandOptions = brandFacets.map((facet) => {
    const ref = logosPorMarca.get(facet.code) ?? null
    return {
      code: facet.code,
      name: facet.name,
      // Con marcas marcadas el recuento viene de la consulta SIN ellas: es
      // cierto para cada marca y se puede enseñar.
      count: facet.count,
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
  const listaVista = `${catalogo}|${categorySlug ?? ''}|${brands.join(',')}|${search.trim()}`
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

  // Resumen v2 · Quién compra: el comprador empresa ve «Pedido rápido por SKU».
  const { status: estadoSesion } = useSessionContext()
  const { audience: audiencia } = useCommerceContext(storeSlug, estadoSesion === 'authenticated')
  /** El símbolo de la moneda de la tienda, para las cajas de precio del panel. */
  const simboloMoneda = useMemo(() => {
    try {
      return (
        new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE', { style: 'currency', currency: store.currency })
          .formatToParts(0)
          .find((parte) => parte.type === 'currency')?.value ?? ''
      )
    } catch {
      return ''
    }
  }, [locale, store.currency])

  const resultCount = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE').format(total)
  const cuentaDeResultados = `${resultCount} ${
    total === 1 ? t('store.catalog.result') : t('store.catalog.results')
  }`

  /** ¿Está abierto el cajón de filtros? (V3 · P09) */
  const [cajonAbierto, setCajonAbierto] = useState(false)

  /**
   * Lo que hay puesto, con su nombre y con la forma de quitarlo (V3 · P09).
   *
   * Sale de la URL, que es donde vive el estado del catálogo, así que la lista
   * es correcta también al volver atrás o al abrir un enlace compartido. El
   * nombre es el que el comprador eligió —«Jarabes», «Genfar»— y no el slug: un
   * chip que dijera `cuidado-personal` sería la implementación asomando.
   *
   * El término buscado NO entra: se quita desde el buscador de la cabecera, que
   * es donde se escribió, y ponerlo aquí ofrecería dos sitios para deshacer lo
   * mismo.
   */
  const filtrosPuestos = useMemo(() => {
    const puestos: { id: string; label: string; onRemove: () => void }[] = []
    if (categorySlug) {
      puestos.push({
        id: `c:${categorySlug}`,
        label:
          trail.at(-1)?.name ??
          categoryOptions.find((opcion) => opcion.code === categorySlug)?.name ??
          categorySlug,
        onRemove: () => update('c', null),
      })
    }
    for (const code of brands) {
      puestos.push({
        id: `b:${code}`,
        label: brandOptions.find((opcion) => opcion.code === code)?.name ?? code,
        onRemove: () => update('b', brands.filter((otra) => otra !== code).join(',') || null),
      })
    }
    if (priceMin || priceMax) {
      puestos.push({
        id: 'precio',
        label: `${priceMin ?? '0'} – ${priceMax ?? '∞'}`,
        onRemove: () =>
          setParams((prev) => {
            const next = new URLSearchParams(prev)
            next.delete('pmin')
            next.delete('pmax')
            return next
          }),
      })
    }
    if (availability === 'in-stock') {
      puestos.push({ id: 'd', label: t('store.filter.inStock'), onRemove: () => update('d', null) })
    }
    if (soloOferta) {
      puestos.push({
        id: 'oferta',
        label: t('store.filter.discounted'),
        onRemove: () => update('oferta', null),
      })
    }
    return puestos
  }, [
    categorySlug,
    brands,
    priceMin,
    priceMax,
    setParams,
    availability,
    soloOferta,
    trail,
    categoryOptions,
    brandOptions,
    t,
    update,
  ])

  /** Quitar los filtros deja el CATÁLOGO, no la portada. */
  const quitarFiltros = () => setParams(new URLSearchParams({ ver: 'todo' }))

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
       (brands.length === 1 ? brandOptions.find((b) => b.code === brand)?.name : undefined) ??
       (directorioMarcas ? t('store.catalog.brandsTitle') : undefined) ??
       t('store.catalog.all'))

  /** «Ofertas» es una página con nombre, no un interruptor sobre el catálogo. */
  const paginaOfertas = soloOferta && !search.trim() && !categorySlug && brands.length === 0

  /** Marca o desmarca una marca en la lista de la URL. */
  const alternarMarca = (code: string) =>
    update(
      'b',
      (brands.includes(code) ? brands.filter((otra) => otra !== code) : [...brands, code]).join(',') || null,
    )

  /** Pone o quita el rango de precio de una vez: dos `update` serían dos navegaciones. */
  const ponerPrecio = (min: string | null, max: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (min) next.set('pmin', min)
      else next.delete('pmin')
      if (max) next.set('pmax', max)
      else next.delete('pmax')
      return next
    })

  /**
   * Rejilla o lista (`?vista=lista`). Sin elegir, lo decide el tema: Catálogo
   * abre en lista, que es como compra quien tiene miles de referencias.
   */
  const vistaParam = params.get('vista')
  const vista: CatalogView =
    vistaParam === 'lista'
      ? 'list'
      : vistaParam === 'rejilla'
        ? 'grid'
        : tema.preset === 'catalog'
          ? 'list'
          : 'grid'

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
   *
   * Hasta ahora sobrevivía `promotions`, y la franja de la campaña empujaba la
   * rejilla hacia abajo con algo que la portada ya había contado. Ahora, solo
   * en «Todo el catálogo» sin filtros, va UNA fila de producto: lo más vendido
   * si hay ventas reales; si no, las novedades; si no hay ninguna, nada. Con un
   * filtro puesto no va ninguna: quien filtra ya dijo qué busca.
   */
  const hayMasVendidos = (masVendidos.data?.length ?? 0) > 0
  const filaDelCatalogo: HomeSectionId | null =
    // El directorio de marcas (`#marcas`) es su propia página: sin fila encima.
    // Y con un catálogo que cabe en una pantalla la fila solo repetiría la
    // rejilla que va justo debajo.
    !vistaTodo || directorioMarcas || total <= FILA_CATALOGO_MIN || masVendidos.isPending
      ? null
      : hayMasVendidos
        ? 'best-sellers'
        : novedades.length > 0
          ? 'new-arrivals'
          : null
  const layoutAPintar = useMemo(() => {
    if (!catalogo && !cargandoPortada) return tema.layout
    const secciones: HomeSectionConfig[] = []
    // Mientras la portada carga se conserva la franja de campañas, como antes:
    // es lo único que no depende de las consultas que se están esperando.
    if (!catalogo) {
      const promociones = tema.layout.sections.find((seccion) => seccion.id === 'promotions')
      if (promociones) secciones.push(promociones)
    }
    // Rediseño v3 · el catálogo retail no lleva fila encima (lámina de
    // catálogo): la campaña va DENTRO de la rejilla.
    if (filaDelCatalogo && tema.preset !== 'retail') secciones.push({ id: filaDelCatalogo, enabled: true, maxItems: 6 })
    // «Marcas» de la cabecera lleva a `?ver=todo#marcas`. Sin esto el ancla no
    // tenía destino en el catálogo y el enlace no hacía nada: el directorio de
    // marcas se pinta aquí, con la configuración del comercio si la tiene.
    if (catalogo && hash === '#marcas') {
      const marcas = tema.layout.sections.find((seccion) => seccion.id === 'brands')
      secciones.push({ ...(marcas ?? { id: 'brands' as const }), enabled: true })
    }
    return { version: 1 as const, sections: secciones }
  }, [catalogo, cargandoPortada, tema.layout, tema.preset, hash, filaDelCatalogo])

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

  /**
   * Rediseño v3 · RETAIL presenta las familias como tarjetas altas CON FOTO
   * (lámina «Compra por categoría»). Si el comercio no subió foto a la familia,
   * se usa la de un producto suyo que la portada YA cargó —más vendidos,
   * novedades, ofertas, catálogo—: cero peticiones nuevas y ningún dato
   * inventado. Se busca por la familia RAÍZ, porque los productos cuelgan de las
   * hojas. Sin producto con foto, la puerta cae a su respaldo de siempre.
   */
  const fotoDeRespaldo = useMemo(() => {
    const mapa: Record<string, { imageUrl: string; imageAlt: null; imageFit: 'contain' }> = {}
    if (tema.preset !== 'retail' && tema.preset !== 'universal') return mapa
    const padre = new Map((categories.data ?? []).map((c) => [c.category_id, c.parent_id]))
    // Los productos que llegan de la BÚSQUEDA traen el slug de su familia y no
    // el id: se resuelve con el mismo árbol.
    const idPorSlug = new Map((categories.data ?? []).map((c) => [c.slug, c.category_id]))
    // La hoja y TODOS sus ancestros: la sección automática pinta raíces, pero
    // un bloque del CMS puede apuntar a cualquier nivel del árbol.
    const linaje = (id: string): string[] => {
      const fuera = [id]
      let actual = id
      for (let i = 0; i < 12; i += 1) {
        const p = padre.get(actual)
        if (!p) break
        fuera.push(p)
        actual = p
      }
      return fuera
    }
    const listas: readonly (readonly [readonly PublicProduct[], Record<string, string>])[] = [
      [masVendidos.data ?? [], masVendidoThumbs],
      [novedades, novedadesThumbs],
      [ofertas, rebajadosThumbs],
      [products, thumbnails],
    ]
    for (const [lista, firmas] of listas) {
      for (const producto of lista) {
        const categoria =
          producto.category_id ?? (producto.category_slug ? idPorSlug.get(producto.category_slug) : undefined)
        if (!categoria || !producto.primary_image_path) continue
        const url = firmas[producto.primary_image_path]
        if (!url) continue
        for (const id of linaje(categoria)) {
          if (!mapa[id]) mapa[id] = { imageUrl: url, imageAlt: null, imageFit: 'contain' }
        }
      }
    }
    return mapa
  }, [tema.preset, categories.data, masVendidos.data, masVendidoThumbs, novedades, novedadesThumbs, ofertas, rebajadosThumbs, products, thumbnails])

  const mediaConRespaldo = useMemo(() => {
    const fuera: Record<string, { imageUrl: string | null; imageAlt: string | null; imageFit?: 'contain' }> = {
      ...fotoDeRespaldo,
    }
    for (const [id, media] of Object.entries(categoryMedia)) {
      if (media.imageUrl || !fuera[id]) fuera[id] = media
    }
    return fuera
  }, [categoryMedia, fotoDeRespaldo])

  const familias = useMemo(
    () =>
      (categories.data ?? [])
        .filter((category) => category.parent_id === null)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((category) => ({
          category_id: category.category_id,
          name: category.name,
          slug: category.slug,
          // La foto propia manda; si no hay o su firma no llegó, la prestada.
          ...(categoryMedia[category.category_id]?.imageUrl
            ? categoryMedia[category.category_id]
            : (fotoDeRespaldo[category.category_id] ?? categoryMedia[category.category_id] ?? {})),
        })),
    [categories.data, categoryMedia, fotoDeRespaldo],
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
    // En «Todo el catálogo» la fila no compite con otras secciones por los
    // productos: va la lista entera, sin el reparto de la portada.
    novedades: vistaTodo ? novedades : secciones.novedades,
    masVendido: vistaTodo && hayMasVendidos ? (masVendidos.data ?? []) : secciones.masVendido,
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
    // Rediseño v3 · el CMS recibe también las fotos prestadas (solo retail):
    // la foto propia manda y, sin ella, la de un producto de la familia.
    categoryMedia: mediaConRespaldo,
    paginas: navegacion.data ?? [],
    brands: brandOptions,
    brandSelected: brand,
    // Lo mismo que ya sabe la banda de ofertas, sin preguntarlo dos veces.
    hayOfertas: ofertas.length > 0,
    ofertasTotal: ofertasPages.data?.pages[0]?.total ?? ofertas.length,
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
    // El aire entre secciones es el del tema (`sectionSpacing`): compacto en
    // Retail y Catálogo, amplio en Premium. Universal resuelve 16/24, lo de antes.
    <Stack sx={{ gap: { xs: 'var(--sf-section-gap, 16px)', md: 'var(--sf-section-gap-md, 24px)' } }}>
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
          {/* Rediseño v3 · Retail: migas ARRIBA del título, desde «Inicio»
              (lámina de catálogo). Sustituyen al «Volver a la portada». */}
          {plpMigas ? (
            <Breadcrumbs
              aria-label={t('store.categories.title')}
              separator="/"
              className="sf-plp-crumbs"
              sx={{ fontSize: TS.label, color: 'var(--muted)', mb: 0.5 }}
            >
              <MuiLink component={Link} to={`/s/${storeSlug}`} underline="hover" sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {t('store.nav.home')}
              </MuiLink>
              {trail.length === 0 ? (
                <Box component="span" sx={{ color: 'var(--text)' }}>
                  {t('store.catalog.all')}
                </Box>
              ) : (
                <MuiLink
                  component="button"
                  type="button"
                  underline="hover"
                  onClick={() => irAFamilia(null)}
                  sx={{ fontSize: TS.label, color: 'var(--muted)' }}
                >
                  {t('store.catalog.all')}
                </MuiLink>
              )}
              {trail.map((node, index) =>
                index === trail.length - 1 ? (
                  <Box key={node.category_id} component="span" sx={{ color: 'var(--text)' }}>
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
          ) : (
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
          )}
          {paginaOfertas ? (
            <CatalogOffersBand
              // Resumen v2 · La campaña que antes termina, con su reloj REAL.
              kicker={campanaQueTerminaAntes(promotions.data ?? [])?.name ?? null}
              endsAt={campanaQueTerminaAntes(promotions.data ?? [])?.endsAt ?? null}
              title={t('store.catalog.offersTitle')}
              subtitle={
                results.isSuccess ? t('store.catalog.offersSubtitle').replace('{n}', resultCount) : null
              }
            />
          ) : (
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.25, flexWrap: 'wrap' }}>
              <Typography
                component="h1"
                // Rediseño v3 · cada estilo le pone su voz (versalitas en retail,
                // serif grande en premium) desde storefront.css.
                className="sf-plp-title"
                sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 800, letterSpacing: '-0.02em' }}
              >
                {tituloCatalogo}
              </Typography>
              {/* Retail · el total junto al título, «(48)», como en la lámina. */}
              {plpMigas && results.isSuccess ? (
                <Typography aria-hidden className="tnum" sx={{ fontSize: { xs: 15, md: 18 }, color: 'var(--muted)' }}>
                  {`(${resultCount})`}
                </Typography>
              ) : null}
            </Stack>
          )}
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
          {trail.length > 0 && !plpMigas && (
            <Breadcrumbs
              aria-label={t('store.categories.title')}
              separator="›"
              sx={{ fontSize: TS.label, color: 'var(--muted)' }}
            >
              <MuiLink
                component="button"
                type="button"
                underline="hover"
                onClick={() => irAFamilia(null)}
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
          {sinPildoras ? null : (
          <CategoryBar
            categories={categoryBarItems(categories.data ?? [], categorySlug).filter(
              // Resumen v2 · Con las cantidades a la vista, una familia a CERO es
              // una puerta a una lista vacía: no se enseña (como en el diseño).
              (category) => categorySlug !== null || !hayCuentasDeFamilia || (categoryCounts.get(category.slug) ?? 1) > 0,
            )}
            selected={categorySlug}
            allSlug={categoryBarAllSlug(categories.data ?? [], categorySlug)}
            onSelect={irAFamilia}
            // Las cantidades solo sin familia elegida: con una puesta, las
            // facetas de las demás salen a cero y dirían algo falso.
            counts={categorySlug || !hayCuentasDeFamilia ? null : categoryCounts}
            total={categorySlug || !results.isSuccess ? null : total}
            trailing={
              audiencia !== 'consumer' ? (
                <Button
                  component={Link}
                  to={`/s/${storeSlug}/pedido-rapido`}
                  variant="outlined"
                  size="small"
                  startIcon={<BoltRoundedIcon />}
                  sx={{ borderRadius: 'var(--sf-pill)', textTransform: 'none', fontWeight: 800, whiteSpace: 'nowrap' }}
                >
                  {t('store.catalog.quickOrderSku')}
                </Button>
              ) : null
            }
          />
          )}
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
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {/* Cuántos resultados hay, en qué orden se miran y —en el teléfono—
              cómo se filtran: las preguntas que se hacen antes de empezar a
              recorrer la lista, en una sola barra.

              Sin esqueleto mientras llega su módulo: la barra es una línea, y
              un hueco gris parpadeando encima de la rejilla informa menos que
              el propio retraso. */}
          {/* Rediseño v3 · Universal: la campaña vigente en una franja sobre los
              resultados (lámina de catálogo). */}
          {tema.preset === 'universal' && promosVigentes[0] ? (
            <Stack
              direction="row"
              data-plp-promo
              sx={{
                alignItems: 'center',
                gap: 1.5,
                mb: 1.5,
                px: 2,
                py: 1.25,
                borderRadius: 'var(--sf-radius)',
                bgcolor: 'color-mix(in srgb, var(--accent) 8%, var(--card))',
              }}
            >
              <LocalOfferRoundedIcon aria-hidden sx={{ fontSize: 18, color: 'var(--accent-deep)' }} />
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: TS.body, fontWeight: 700 }}>
                {[promosVigentes[0].name, promosVigentes[0].description].filter(Boolean).join(' · ')}
              </Typography>
              <MuiLink
                component={Link}
                to={
                  promosVigentes[0].categorySlug
                    ? `/s/${storeSlug}?c=${encodeURIComponent(promosVigentes[0].categorySlug)}`
                    : promosVigentes[0].brandCode
                      ? `/s/${storeSlug}?b=${encodeURIComponent(promosVigentes[0].brandCode)}`
                      : `/s/${storeSlug}?ver=todo&oferta=1`
                }
                sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--accent-deep)', flexShrink: 0 }}
              >
                {t('store.promos.see')}
              </MuiLink>
            </Stack>
          ) : null}
          <Suspense fallback={null}>
            <StoreCatalogToolbar
              count={cuentaDeResultados}
              note={
                /* Un resultado por tolerancia a erratas no es lo mismo que uno
                   exacto, y decirlo es la diferencia entre ayudar y fingir. */
                first?.mode === 'fuzzy' ? (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--amber)', fontWeight: 700 }}>
                    {t('store.search.fuzzy')}
                  </Typography>
                ) : null
              }
              sortMenu={<StoreSortMenu value={sort} onChange={(next) => update('sort', next)} />}
              viewToggle={
                plpRetail ? undefined : <CatalogViewToggle
                  value={vista}
                  onChange={(next) => update('vista', next === 'list' ? 'lista' : 'rejilla')}
                />
              }
              activeFilters={filtrosPuestos}
              onOpenFilters={() => setCajonAbierto(true)}
              onClearFilters={quitarFiltros}
              // Rediseño v3 · Retail: sin columna; «Filtros» abre el mismo panel
              // en el cajón y «Solo en oferta» queda a mano en la barra.
              filtersEverywhere={plpRetail}
              quick={
                plpRetail ? (
                  <FormControlLabel
                    className="sf-plp-quick"
                    control={
                      <Switch
                        size="small"
                        checked={soloOferta}
                        onChange={(_, marcado) => update('oferta', marcado ? '1' : null)}
                      />
                    }
                    label={t('store.filter.discounted')}
                    sx={{ ml: 0.5, mr: 0, '& .MuiFormControlLabel-label': { fontSize: TS.label, fontWeight: 700 } }}
                  />
                ) : null
              }
            />
          </Suspense>

          {/* El cajón: el MISMO panel, sin recortar nada. Solo se monta cuando
              se abre, y con él llega su módulo. */}
          {cajonAbierto ? (
            <Suspense fallback={null}>
              <StoreFilterDrawer
                open
                onClose={() => setCajonAbierto(false)}
                resultsLabel={`${t('store.catalog.showResults')} (${resultCount})`}
                onClear={() => {
                  quitarFiltros()
                  setCajonAbierto(false)
                }}
                canClear={filtrosPuestos.length > 0}
              >
                <StoreFilterPanel
                  marco="hoja"
                  brands={brandOptions}
                  categories={categoryOptions}
                  selectedBrands={brands}
                  selectedCategory={categorySlug}
                  inStockOnly={availability === 'in-stock'}
                  discountedOnly={soloOferta}
                  priceMin={priceMin}
                  priceMax={priceMax}
                  priceBounds={priceBounds}
                  onPrice={ponerPrecio}
                  onBrand={alternarMarca}
                  onCategory={(slug) => update('c', slug)}
                  onInStock={(only) => update('d', only ? '1' : null)}
                  onDiscounted={(only) => update('oferta', only ? '1' : null)}
                  onClear={quitarFiltros}
                  currencySymbol={simboloMoneda}
                />
              </StoreFilterDrawer>
            </Suspense>
          ) : null}

          {/* Esqueleto también al CAMBIAR de filtro, no solo la primera vez.
              La consulta guarda la página anterior mientras llega la nueva
              (`keepPreviousData`) y eso dejaba en pantalla los productos de la
              categoría de antes, sin ninguna señal de que algo estaba
              cargando: se pulsaba «Selladores» y parecía que no pasaba nada. */}
          {cargandoResultados && <ProductGridSkeleton />}

          {results.isError && (
            <Card>
              <ErrorState error={results.error} onRetry={() => void results.refetch()} />
            </Card>
          )}

          {resultadosListos && total === 0 && (
            <Card>
              <EmptyState
                title={filtered ? t('store.catalog.noResults') : t('store.catalog.empty')}
                description={filtered ? t('store.catalog.noResultsBody') : t('store.catalog.emptyBody')}
                action={
                  filtered ? (
                    // Quitar filtros deja al comprador en el catálogo completo: la
                    // URL vacía era la portada y lo sacaba de donde estaba.
                    <Button variant="contained" onClick={() => setParams(new URLSearchParams({ ver: 'todo' }))}>
                      {t('store.catalog.clear')}
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          )}

          {resultadosListos && total > 0 && (
            <Box
              // Resumen v2 · Con la columna de filtros al lado, el ancho útil es
              // ~1000 px: cuatro columnas como en el diseño, sea cual sea el tema.
              // Con cinco o seis, la tarjeta de empresa cortaba «Agregar».
              sx={vista === 'grid' ? { '--sf-grid-sm': 3, '--sf-grid-lg': 4 } : undefined}
            >
              <ProductGrid
                products={products}
                storeSlug={storeSlug}
                thumbnails={thumbnails}
                onPrefetch={prefetchProduct}
                onQuickView={(slug) => update('p', slug)}
                favorites={favorites.ids}
                onToggleFavorite={(productId) => void favorites.toggle(productId)}
                view={vista}
              />

          {/* La siguiente página se PIDE al servidor: 24 filas, no las 48 o 72
              que costaba subir el techo y volver a pedir desde cero. */}
          {results.hasNextPage && (
            <Stack sx={{ alignItems: 'center', gap: 1, mt: 2 }}>
              {/* Invisible y sin alto: solo marca el punto a partir del cual
                  vale la pena pedir la siguiente pagina. */}
              <Box ref={sentinel} aria-hidden sx={{ height: 1, width: '100%' }} />

              {/* Resumen v2 · Cuánto se ha visto y cuánto queda, como en el diseño. */}
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {t('store.catalog.showing')
                  .replace('{n}', String(products.length))
                  .replace('{total}', resultCount)}
              </Typography>
              <Box aria-hidden sx={{ width: 260, maxWidth: '80%', height: 4, borderRadius: 999, bgcolor: 'var(--neutral-soft)', overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${Math.min(100, (products.length / Math.max(total, 1)) * 100)}%`, background: 'var(--hero-grad)' }} />
              </Box>
              {results.isFetchingNextPage ? (
                <BrandLoader label={t('store.catalog.loadingMore')} compact />
              ) : (
                <Button
                  variant="outlined"
                  onClick={() => void results.fetchNextPage()}
                  sx={{ borderRadius: 'var(--sf-pill)', textTransform: 'none', fontWeight: 800, px: 2.5 }}
                >
                  {t('store.catalog.loadN').replace('{n}', String(Math.min(PAGE_SIZE, Math.max(total - products.length, 0))))}
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
          {resultadosListos && total > 0 && total <= POCOS_RESULTADOS && (
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
          {resultadosListos && total === 0 && (
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

        {/**
         * La columna de filtros: SOLO en escritorio, y DESPUÉS de los
         * resultados en el árbol (Storefront V3 · P09).
         *
         * Las dos cosas arreglan el mismo fallo. En el teléfono esta columna iba
         * ENCIMA de los productos: quien buscaba «jarabe» recibía primero una
         * lista de marcas y familias con sus interruptores, y los jarabes
         * empezaban pasada la primera pantalla. Ahí el panel entero —sin
         * recortar ninguna opción— vive en el cajón que abre la barra.
         *
         * Y va después en el DOM porque el orden del documento es el que recorre
         * un lector de pantalla y el que sigue el tabulador: con los filtros
         * primero, llegar al primer producto costaba treinta tabulaciones.
         * `order` lo devuelve a la izquierda en escritorio — la vista no cambia,
         * la lectura sí.
         */}
        {plpRetail ? null : (
        <Box
          className="sf-plp-filters"
          sx={{
            display: { xs: 'none', md: 'block' },
            width: { md: 280 },
            flexShrink: 0,
            order: { md: -1 },
          }}
        >
          <Suspense fallback={<FilterPanelSkeleton />}>
            <StoreFilterPanel
              marco="columna"
              brands={brandOptions}
              categories={categoryOptions}
              selectedBrands={brands}
              selectedCategory={categorySlug}
              inStockOnly={availability === 'in-stock'}
              discountedOnly={soloOferta}
              priceMin={priceMin}
              priceMax={priceMax}
              priceBounds={priceBounds}
              onPrice={ponerPrecio}
              onBrand={alternarMarca}
              onCategory={(slug) => update('c', slug)}
              onInStock={(only) => update('d', only ? '1' : null)}
              onDiscounted={(only) => update('oferta', only ? '1' : null)}
              // Quien pulsa «limpiar» quiere verlo todo, no volver a la portada.
              onClear={quitarFiltros}
              currencySymbol={simboloMoneda}
            />
          </Suspense>
        </Box>
        )}
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

/**
 * La columna de filtros mientras llega su módulo.
 *
 * Antes el hueco quedaba en blanco y la rejilla se veía desplazada a la
 * derecha sin nada a su izquierda. Mismas piezas que el panel real —título,
 * dos interruptores, precio y dos listas— para que al llegar no salte nada.
 */
function FilterPanelSkeleton() {
  return (
    <Stack aria-hidden data-testid="filters-skeleton" sx={{ gap: 2.25, pt: 0.5 }}>
      <Skeleton variant="text" width="45%" height={28} />
      <Stack sx={{ gap: 1 }}>
        <Skeleton variant="rounded" height={22} />
        <Skeleton variant="rounded" height={22} />
      </Stack>
      <Stack sx={{ gap: 1 }}>
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="rounded" height={6} />
        <Stack direction="row" sx={{ gap: 1 }}>
          <Skeleton variant="rounded" height={38} sx={{ flex: 1 }} />
          <Skeleton variant="rounded" height={38} sx={{ flex: 1 }} />
        </Stack>
      </Stack>
      {[0, 1].map((grupo) => (
        <Stack key={grupo} sx={{ gap: 1 }}>
          <Skeleton variant="text" width="35%" />
          {[0, 1, 2, 3].map((fila) => (
            <Skeleton key={fila} variant="text" width={`${70 - fila * 8}%`} />
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
