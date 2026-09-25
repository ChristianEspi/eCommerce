import InventoryRoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAgreementPrice } from '@/features/pricing/useAgreementPrice'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { AppBreadcrumbs } from '@/shared/ui/AppBreadcrumbs'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { StorefrontNotFoundError } from './api'
import { ProductPageSkeleton } from './components/ProductPageSkeleton'
import { notFoundMeta, productMeta } from './seo'
import { track } from './analytics'
import { useAddToCart } from './cart/useAddToCart'
import { ProductGallery } from './components/ProductGallery'
import { ProductRow } from './components/ProductRow'
import { StoreProductDetails } from './components/StoreProductDetails'
import { StoreProductPurchaseBar } from './components/StoreProductPurchaseBar'
import { QuantityStepper } from './components/QuantityStepper'
import { VariantPicker } from './components/VariantPicker'
import { useRelatedSections } from './relations'
import { useVariantChoice } from './useVariantChoice'

/**
 * Las opiniones van por `lazy`: están debajo del pliegue y traen el formulario
 * (`Rating`, `LinearProgress`…), que ya no cabía en el techo de la ficha
 * (`docs/performance-budget.md`). El primer pintado —foto, precio, comprar— no
 * espera por ellas.
 */
const ProductReviews = lazy(() =>
  import('./reviews/ProductReviews').then((module) => ({ default: module.ProductReviews })),
)
import {
  useGallery,
  usePublicProduct,
  usePublicProducts,
  usePublicVariants,
  useStorefront,
  useThumbnails,
} from './hooks'
import {
  discountPercent,
  pickRelated,
  type CatalogQuery,
  type PublicProduct,
  type PublicVariant,
} from './types'

/**
 * Ficha de producto: galería, precio, disponibilidad, descripción, cantidad,
 * botón de compra y relacionados.
 *
 * El botón añade al carrito de ESTA tienda con el precio que el catálogo acaba
 * de devolver. Ese precio es de escaparate: el que se cobra lo vuelve a leer la
 * base al confirmar el pedido.
 */
/** Filas que se piden para escoger los cuatro relacionados que se pintan. */
const RELATED_FETCH = 12

export function StoreProductPage() {
  const { t, locale } = useI18n()
  const { store, storeSlug } = useStorefront()
  const { productSlug } = useParams<{ productSlug: string }>()

  const product = usePublicProduct(store.store_id, productSlug)
  const gallery = useGallery(product.data?.product_id ?? null)
  const variants = usePublicVariants(product.data)

  /**
   * El precio del acuerdo, si quien mira tiene uno.
   *
   * Con variantes NO se pregunta: la ficha anuncia un «desde» hasta que el
   * comprador elige talla, y cotizar el maestro daría un número que no se
   * corresponde con lo que va a comprar.
   */
  const conAcuerdo = useAgreementPrice(
    storeSlug,
    product.data && product.data.kind !== 'variant' ? product.data : null,
  )

  // Relaciones CURADAS por el comercio (cierre): «Completa tu compra», «Mejora
  // tu elección» y «También te puede interesar». Ver `relations.ts`.
  const curated = useRelatedSections(storeSlug, store.store_id, product.data?.product_id ?? null)
  // El relleno por categoría solo entra cuando ya se sabe que el comercio no
  // curó relacionados: pedirlo a la vez sería descargar doce productos por
  // ficha para tirarlos en cuanto llegan los de verdad.
  const needsFallback = curated.settled && curated.sections.related.length === 0

  // Relacionados «simples»: el resto de su categoría. Si no tiene categoría o
  // no llega para llenar la fila, `pickRelated` completa con el catálogo.
  const relatedQuery: CatalogQuery = useMemo(
    () => ({
      storeId: product.data && needsFallback ? store.store_id : null,
      search: '',
      categorySlug: product.data?.category_slug ?? null,
      availability: 'all',
      sort: 'recent',
      // Se piden doce para escoger cuatro. Hasta P14 esta consulta iba SIN
      // techo: para pintar una fila de relacionados el navegador se descargaba
      // la categoría entera —en un catálogo de dos mil referencias, dos mil
      // filas por ficha visitada—. Doce da margen de sobra para descartar el
      // producto abierto y sigue eligiendo los mismos cuatro, porque el orden
      // (`published_at desc`) no cambia al recortar.
      limit: RELATED_FETCH,
    }),
    [product.data, store.store_id, needsFallback],
  )
  const catalog = usePublicProducts(relatedQuery)
  const { complete, upgrade } = curated.sections
  // Lo que ya sale en otra fila curada no se repite en el relleno: la misma
  // tarjeta dos veces en la misma ficha parece un error de la tienda.
  const shownElsewhere = new Set([...complete, ...upgrade].map((item) => item.product_id))
  const related =
    curated.sections.related.length > 0
      ? curated.sections.related
      : product.data && needsFallback
        ? pickRelated(
            (catalog.data ?? []).filter((item) => !shownElsewhere.has(item.product_id)),
            product.data,
          )
        : []
  const relatedThumbs = useThumbnails([...complete, ...upgrade, ...related])

  // `product_view` (P13-SaaS). Se emite cuando la ficha ya se resolvió y por
  // producto, no por render: sin la dependencia en el id, cada cambio de
  // variante o de galería contaría una vista nueva y el numerador del embudo
  // subiría solo. Dispara y olvida: si falla, la ficha no se entera.
  const viewedProductId = product.data?.product_id ?? null
  useEffect(() => {
    if (!storeSlug || !viewedProductId) return
    track(storeSlug, { type: 'product_view', product_id: viewedProductId })
  }, [storeSlug, viewedProductId])

  /**
   * SEO de la ficha (P15-SaaS).
   *
   * La imagen que se declara es la PRIMARIA ya firmada, si llegó: una URL de
   * bucket privado sin firmar no la puede leer ni un buscador ni el previo de
   * un chat, y anunciarla sería prometer una foto que nadie va a ver.
   *
   * Y una ficha que no resuelve —despublicada, de otra tienda, inventada— se
   * marca `noindex`: la SPA responde 200 igual, y sin esto el «no encontramos
   * este producto» entraría al índice como si fuera catálogo.
   */
  const heroImage = gallery.data?.find((image) => image.url)?.url ?? null
  useDocumentMeta(
    product.data
      ? productMeta({ store, storeSlug, locale, pathname: `/s/${storeSlug}` }, product.data, heroImage)
      : product.isError
        ? notFoundMeta({
            title: t('store.product.notFound'),
            pathname: `/s/${storeSlug}/product/${productSlug ?? ''}`,
            siteName: store.name,
            locale,
          })
        : null,
  )

  // Esqueleto con la FORMA de la ficha, no un aro girando en el centro: al
  // llegar los datos la galería y la columna de compra caen donde ya estaba el
  // hueco, en vez de empujar la página hacia abajo.
  if (product.isPending) return <ProductPageSkeleton />

  if (product.isError || !product.data) {
    if (product.error instanceof StorefrontNotFoundError) {
      return (
        <Card>
          <EmptyState
            title={t('store.product.notFound')}
            description={t('store.product.notFoundBody')}
            action={
              <Button component={Link} to={`/s/${storeSlug}`} variant="contained">
                {t('store.product.back')}
              </Button>
            }
          />
        </Card>
      )
    }
    return (
      <Card>
        <ErrorState error={product.error} onRetry={() => void product.refetch()} />
      </Card>
    )
  }

  const item = product.data
  const discount = discountPercent(item)
  const available = item.in_stock !== false
  const hasVariants = item.kind === 'variant'

  /**
   * A dónde lleva el «ver todo» de las filas de sugerencias.
   *
   * Al catálogo filtrado por la familia del producto cuando la tiene: es a
   * donde quiere ir quien descarta esto y busca otro parecido. Sin familia, al
   * catálogo entero — y nunca a una lista inventada de «recomendados», que no
   * existe como consulta.
   */
  /**
   * El precio que se enseña en la ficha, calculado UNA vez (V3 · P10).
   *
   * Manda el acuerdo comercial si la sesión lo tiene; si no, el precio del
   * producto —y con variantes, el «desde», porque el maestro puede costar 60 y
   * la talla XL 70, y anunciar 60 a secas es un precio que no se va a cobrar.
   *
   * Sale a una constante porque ahora lo dicen DOS sitios: la columna de compra
   * y la barra del teléfono. Calcularlo dos veces es cómo se acaba enseñando un
   * número arriba y otro abajo.
   */
  const precioDeLaFicha = formatMoney(
    conAcuerdo
      ? conAcuerdo.amount
      : Number(hasVariants ? (item.price_from ?? item.price) : item.price),
    conAcuerdo?.currency ?? item.currency,
    locale,
  )

  const salidaAlCatalogo = item.category_slug
    ? `/s/${storeSlug}?c=${encodeURIComponent(item.category_slug)}`
    : `/s/${storeSlug}?ver=todo`

  return (
    <Stack
      sx={{
        gap: { xs: 2.5, md: 4 },
        /**
         * Hueco para la barra de compra del teléfono (V3 · P10).
         *
         * Sin él, la barra tapa la última fila de sugerencias: una barra fija
         * no ocupa sitio en el flujo, así que el sitio hay que dárselo. Va
         * condicionado a que la barra exista —solo se pinta si se puede
         * comprar— para no dejar un hueco en blanco al pie de un producto
         * agotado.
         */
        pb: available ? { xs: 'calc(84px + env(safe-area-inset-bottom, 0px))', md: 0 } : 0,
      }}
    >
      {/* Migas ADEMÁS del «volver»: dicen dónde estás —de qué categoría cuelga
          esto— y no solo por dónde salir. La categoría es un enlace al catálogo
          ya filtrado, que es a donde se quiere ir tras descartar un producto. */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <AppBreadcrumbs
          ariaLabel={t('store.product.breadcrumb')}
          items={[
            { label: t('store.catalog.title'), to: `/s/${storeSlug}` },
            ...(item.category_name && item.category_slug
              ? [
                  {
                    label: item.category_name,
                    to: `/s/${storeSlug}?c=${encodeURIComponent(item.category_slug)}`,
                  },
                ]
              : []),
            { label: item.name },
          ]}
        />
        <Button
          component={Link}
          to={`/s/${storeSlug}`}
          startIcon={<ArrowBackRoundedIcon />}
          sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
        >
          {t('store.product.back')}
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 4 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        {/**
         * La galería, SIN tarjeta (V3 · P10).
         *
         * Iba en una `Card` con borde y sombra, y con la columna de compra en
         * otra la ficha se leía como dos paneles de backoffice puestos uno al
         * lado del otro. Lo que une una foto con su precio no es que las dos
         * tengan marco: es que están a la misma altura y comparten el aire.
         *
         * La caja no desaparece del todo —la galería tiene su propio fondo para
         * el hueco de la imagen, que es lo que evita el salto al cargar— pero
         * deja de dibujar un recuadro alrededor del producto.
         */}
        <Box data-pdp-gallery="true">
          <ProductGallery images={gallery.data ?? []} alt={item.name} />
        </Box>

        {/* La compra y la ficha de datos, en la MISMA columna y pegadas arriba.
            Antes los datos iban abajo a lo ancho y la columna de compra se
            quedaba flotando sobre medio metro de fondo vacio: la mirada acababa
            en un hueco justo al lado del boton que hay que pulsar. */}
        <Stack
          data-pdp-purchase="true"
          sx={{ gap: 1.25, position: { md: 'sticky' }, top: { md: 88 } }}
        >
          {item.brand_name && (
            <Typography sx={{ fontSize: TS.label, fontWeight: 800, color: 'var(--accent-deep)' }}>
              {item.brand_name}
            </Typography>
          )}
          {/* La categoría YA la dicen las migas, y allí además es un enlace al
              catálogo filtrado. Repetirla aquí encima del título la ponía tres
              veces en la misma pantalla —migas, encabezado y ficha de datos—,
              que es ruido, no énfasis. Aquí manda la marca, que no está en
              ningún otro sitio de esta columna. */}
          <Typography component="h1" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 800 }}>
            {item.name}
          </Typography>

          <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {/* Con variantes el precio de la ficha es un "desde" hasta que el
                comprador elige: el maestro puede costar 60 y la talla XL 70,
                y anunciar 60 a secas es un precio que no se va a cobrar. */}
            {hasVariants && item.variant_count > 1 && (
              <Typography sx={{ color: 'var(--muted)', fontWeight: 700 }}>
                {t('store.product.priceFrom')}
              </Typography>
            )}
            {/* Mas grande que el h1, y a proposito.

                El nombre y el precio competian a 26 y 24 px: en una ficha de
                producto el ojo busca UNA cosa primero, y no es como se llama.
                Quien llega aqui ya sabe que producto esta mirando —hizo clic
                en el— y lo que viene a averiguar es cuanto cuesta.

                `tabular-nums` para que el importe no baile al cambiar de
                variante: con cifras de ancho distinto, elegir otra talla mueve
                el precio de sitio y parece que cambio mas de lo que cambio. */}
            <Typography
              sx={{
                fontSize: { xs: 28, md: 34 },
                fontWeight: 900,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {precioDeLaFicha}
            </Typography>
            {/* Con acuerdo, el tachado es el precio PÚBLICO —de eso se ahorra— y
                no el `compare_at_price`, que es la referencia de la oferta
                abierta a todos. Enseñar los dos tachados en la misma línea
                obligaría al comprador a averiguar cuál de los dos es el suyo. */}
            {conAcuerdo && (
              <>
                <Typography component="s" sx={{ color: 'var(--muted)', fontWeight: 600 }}>
                  {formatMoney(Number(item.price), item.currency, locale)}
                </Typography>
                <Chip
                  label={t('store.cart.listPrice')}
                  size="small"
                  sx={{ bgcolor: 'var(--accent)', color: '#FFFFFF', fontWeight: 800 }}
                />
              </>
            )}
            {!conAcuerdo && !hasVariants && discount !== null && item.compare_at_price && (
              <>
                <Typography component="s" sx={{ color: 'var(--muted)', fontWeight: 600 }}>
                  {formatMoney(Number(item.compare_at_price), item.currency, locale)}
                </Typography>
                <Chip
                  label={`-${discount}%`}
                  size="small"
                  sx={{ bgcolor: 'var(--accent)', color: '#FFFFFF', fontWeight: 800 }}
                />
              </>
            )}
          </Stack>

          {/* Por qué ese precio y no el de la etiqueta. Sin esta línea, un
              número más bajo que el del catálogo parece un error de la tienda
              —o peor, un precio que va a cambiar en la caja. */}
          {conAcuerdo && (
            <Typography sx={{ fontSize: TS.label, color: 'var(--accent-deep)', fontWeight: 700 }}>
              {t('store.product.agreementPrice')}
            </Typography>
          )}

          <Box
            sx={{
              alignSelf: 'flex-start',
              px: 1,
              py: 0.25,
              borderRadius: 'var(--sf-pill)',
              fontSize: TS.body,
              fontWeight: 700,
              bgcolor: available ? 'var(--accent-soft)' : 'var(--neutral-soft)',
              color: available ? 'var(--accent-deep)' : 'var(--muted)',
            }}
          >
            {available ? t('store.availability.inStock') : t('store.availability.outOfStock')}
          </Box>

          <AddToCart
            product={item}
            available={available}
            variants={hasVariants ? (variants.data ?? []) : []}
            variantsPending={hasVariants && variants.isPending}
            priceLabel={precioDeLaFicha}
            {...(conAcuerdo
              ? { priceNote: t('store.product.agreementPrice') }
              : hasVariants && item.variant_count > 1
                ? { priceNote: t('store.product.priceFrom') }
                : {})}
          />

          {/* Las tres dudas que frenan un «anadir al carrito», justo donde se
              frena: al lado del boton. La franja de servicios ya las contaba,
              pero vive al final de la portada, a media docena de pantallas de
              distancia del unico momento en que importan.

              Son afirmaciones sobre lo que la plataforma SI hace —entrega
              calculada al comprar, pago por medios de la tienda, stock real
              del almacen—: nada de politicas de devolucion que no existan. */}
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, pt: 0.5 }}>
            {([
              ['store.product.trust.delivery', LocalShippingRoundedIcon],
              ['store.product.trust.payment', LockRoundedIcon],
              ['store.product.trust.stock', InventoryRoundedIcon],
            ] as const).map(([clave, Icono]) => (
              <Stack
                key={clave}
                direction="row"
                sx={{ alignItems: 'center', gap: 0.625 }}
              >
                <Icono aria-hidden sx={{ fontSize: 16, color: 'var(--accent-deep)' }} />
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {t(clave)}
                </Typography>
              </Stack>
            ))}
          </Stack>

        </Stack>
      </Box>

      {/**
       * El detalle, plegado y debajo (V3 · P10).
       *
       * La descripción y la ficha de datos eran dos tarjetas con su rótulo en
       * versalitas: en el teléfono, dos pantallas de texto entre el botón de
       * comprar y las sugerencias. Plegadas, la información sigue entera y se
       * elige cuál se abre.
       *
       * Y los apartados se construyen aquí, no dentro del componente: solo esta
       * página sabe qué dato existe de verdad. Una descripción vacía no se
       * ofrece —no hay apartado que decir «sin descripción»— y no hay ni un
       * apartado de envíos o devoluciones, porque la plataforma no conoce esas
       * políticas y escribirlas sería inventarlas.
       */}
      <StoreProductDetails
        ariaLabel={t('store.product.detailsSection')}
        panels={[
          ...(item.description?.trim()
            ? [
                {
                  id: 'description',
                  title: t('store.product.description'),
                  content: (
                    <Typography
                      sx={{
                        fontSize: 15,
                        color: 'var(--text)',
                        whiteSpace: 'pre-line',
                        lineHeight: 1.7,
                        // Texto corrido a lo ancho de la página se lee peor que
                        // en una línea larga pero acotada.
                        maxWidth: '72ch',
                      }}
                    >
                      {item.description.trim()}
                    </Typography>
                  ),
                },
              ]
            : []),
          {
            id: 'sheet',
            title: t('store.product.sheet'),
            content: (
              <Stack sx={{ maxWidth: '60ch' }}>
                <SheetRow label={t('store.filter.brand')} value={item.brand_name} />
                <SheetRow label={t('store.filter.category')} value={item.category_name} />
                <SheetRow
                  label={t('store.product.availabilityLabel')}
                  value={
                    available ? t('store.availability.inStock') : t('store.availability.outOfStock')
                  }
                />
              </Stack>
            ),
          },
        ]}
      />

      {/* Opiniones (cierre): solo lo moderado, más la reseña propia con su
          estado. Ver `reviews/ProductReviews.tsx`. */}
      <Suspense fallback={null}>
        <ProductReviews storeSlug={storeSlug} productId={item.product_id} />
      </Suspense>

      {/* Primero lo que completa la compra —es lo que suma al carrito que ya se
          está decidiendo—, después la mejora y al final lo parecido. */}
      <RelatedRow
        title={t('store.product.relations.complete')}
        products={complete}
        storeSlug={storeSlug}
        thumbnails={relatedThumbs}
        seeAllHref={salidaAlCatalogo}
      />
      <RelatedRow
        title={t('store.product.relations.upgrade')}
        products={upgrade}
        storeSlug={storeSlug}
        thumbnails={relatedThumbs}
        seeAllHref={salidaAlCatalogo}
      />
      <RelatedRow
        title={t('store.product.related')}
        products={related}
        storeSlug={storeSlug}
        thumbnails={relatedThumbs}
        seeAllHref={salidaAlCatalogo}
      />
    </Stack>
  )
}

/**
 * Una fila de productos sugeridos. Sin productos no se pinta ni el título.
 *
 * ## Por qué es una FILA y no una rejilla (V3 · P10)
 *
 * Usaba `ProductGrid`, la del catálogo: cuatro tarjetas a lo ancho con el
 * mismo peso que los resultados de una búsqueda. Tres rejillas seguidas al pie
 * de una ficha —completa, mejora, parecidos— son doce tarjetas que compiten con
 * el producto que se está mirando.
 *
 * `ProductRow` es la fila de la portada, y trae tres cosas que aquí importan:
 * se desplaza de lado en vez de crecer hacia abajo, su tarjeta y su ancho de
 * hueco los decide el TEMA —así que en Premium son piezas editoriales y en
 * Catalog compactas, sin una sola rama por tema aquí— y lleva su salida al
 * catálogo.
 *
 * El destino de esa salida es el catálogo filtrado por la familia del producto
 * cuando la tiene: es a donde quiere ir quien descarta esto y busca otro
 * parecido. Sin familia, el catálogo entero.
 */
function RelatedRow({
  title,
  products,
  storeSlug,
  thumbnails,
  seeAllHref,
}: {
  title: string
  products: PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
  seeAllHref: string
}) {
  if (products.length === 0) return null
  return (
    <ProductRow
      title={title}
      products={products}
      storeSlug={storeSlug}
      thumbnails={thumbnails}
      seeAllHref={seeAllHref}
    />
  )
}

/**
 * Una fila de la ficha de datos.
 *
 * Lo que no se sabe se dice con una raya, y la fila NO se esconde: una ficha a
 * la que le faltan filas según el producto no se puede recorrer con la vista,
 * porque cada producto la tiene en otro sitio.
 */
function SheetRow({ label, value }: { label: string; value: string | null }) {
  return (
    <Stack
      direction="row"
      sx={{
        justifyContent: 'space-between',
        gap: 2,
        py: 0.85,
        borderBottom: '1px solid var(--border)',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>{label}</Typography>
      <Typography sx={{ fontSize: TS.body, fontWeight: 700, textAlign: 'right' }}>
        {value ?? '—'}
      </Typography>
    </Stack>
  )
}

/**
 * Elección de variante + cantidad + «Agregar al carrito».
 *
 * Sin stock no hay botón habilitado: la disponibilidad la manda `in_stock`, que
 * la vista pública deriva del inventario real —de la variante o de los
 * componentes del kit, según el tipo—. Y aunque alguien lo forzara, la base
 * vuelve a comprobar el stock al crear el pedido.
 *
 * Con variantes, se elige con botones de opción por eje (talla, color) y llega
 * preseleccionada la de por defecto. Preseleccionar es aceptable porque la
 * elección está A LA VISTA, marcada y con su precio, justo encima del botón; lo
 * que no se hace es cambiarla a espaldas del comprador (ver `chooseValue`).
 */
function AddToCart({
  product,
  available,
  variants,
  variantsPending,
  priceLabel,
  priceNote,
}: {
  product: PublicProduct
  available: boolean
  variants: PublicVariant[]
  variantsPending: boolean
  /**
   * El precio de la ficha, YA formateado (V3 · P10).
   *
   * Lo calcula la página, que es quien sabe del acuerdo comercial, del «desde»
   * de las variantes y de la moneda. Llega hecho porque la barra del teléfono
   * tiene que decir el MISMO número que la columna de arriba: calcularlo dos
   * veces es cómo se acaba enseñando un precio en un sitio y otro en el otro.
   */
  priceLabel: string
  /** «Desde», «precio de acuerdo»… si hace falta decirlo. */
  priceNote?: string
}) {
  const { t, locale } = useI18n()
  const { storeSlug } = useStorefront()
  const { agregar, pending } = useAddToCart()
  const [quantity, setQuantity] = useState(1)

  const hasVariants = product.kind === 'variant'
  const { selected, select } = useVariantChoice(variants, hasVariants)
  const canBuy = available && (!hasVariants || (selected !== null && selected.in_stock !== false))

  /**
   * El grupo de compra, para poder volver a él desde la barra del teléfono.
   *
   * Cuando hay variantes y no se ha elegido ninguna, la barra no puede añadir
   * nada: lo honesto es llevar a donde se elige, no apagar un botón sin decir
   * por qué.
   */
  const grupoDeCompra = useRef<HTMLDivElement | null>(null)

  /** Añade al carrito con lo elegido, y cuenta el hecho una sola vez. */
  function añadirAlCarrito() {
    void agregar(product, quantity, selected)
    // `add_to_cart` es el ÚNICO de los tres hechos de vitrina que corresponde a
    // una decisión y no a una visita, y por eso se emite aquí y no en el
    // carrito: el carrito se reescribe entero al recotizar (P07) y contar allí
    // convertiría un refresco de precio en una intención de compra.
    track(storeSlug, {
      type: 'add_to_cart',
      product_id: product.product_id,
      ...(selected ? { variant_id: selected.variant_id } : {}),
      quantity,
    })
  }

  /** Lleva al selector de variante y deja el foco dentro. */
  function irAElegir() {
    const grupo = grupoDeCompra.current
    if (!grupo) return
    try {
      grupo.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      // jsdom no implementa `scrollIntoView`. Que no haya a dónde desplazarse
      // no puede impedir que el foco llegue, que es la mitad que importa.
    }
    const primero = grupo.querySelector<HTMLElement>(
      'button, [role="combobox"], select, input, [tabindex]:not([tabindex="-1"])',
    )
    primero?.focus()
  }

  return (
    <>
    {/* `role="group"` con nombre: la variante, la cantidad y el botón son UNA
        sola decisión, y anunciarlos sueltos deja al lector de pantalla leyendo
        tres controles sin relación. Además distingue este botón de los que ahora
        llevan las tarjetas de «también te puede interesar», que se llaman igual.

        Y va con llaves: dentro de un fragmento, `//` NO es un comentario — es
        texto, y se pinta. Antes de V3 · P10 este mismo comentario estaba justo
        después del `return (`, donde sí era código; al envolver el retorno en
        un fragmento para añadir la barra de compra, pasó a ser contenido. Lo
        cazó la matriz visual de P13 en la ficha, en los tres anchos. */}
    <Stack
      ref={grupoDeCompra}
      role="group"
      aria-label={t('store.product.buyGroup')}
      sx={{ gap: 1.5, mt: 1 }}
    >
      {hasVariants &&
        (variantsPending ? (
          <Skeleton variant="rounded" height={44} sx={{ maxWidth: 320 }} />
        ) : (
          <VariantPicker
            productName={product.name}
            variants={variants}
            selected={selected}
            onSelect={select}
          />
        ))}

      {/* Elegida y agotada: el botón ya se deshabilita, pero un botón gris sin
          motivo parece una tienda rota. */}
      {hasVariants && selected?.in_stock === false && (
        <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', fontWeight: 600 }}>
          {t('store.product.combinationOutOfStock')}
        </Typography>
      )}

      {hasVariants && selected && (
        <Typography sx={{ fontSize: 20, fontWeight: 800 }}>
          {formatMoney(Number(selected.price), selected.currency, locale)}
        </Typography>
      )}

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <QuantityStepper value={quantity} onChange={setQuantity} />

        <Button
          variant="contained"
          startIcon={
            pending ? <CircularProgress size={16} color="inherit" /> : <ShoppingCartRoundedIcon />
          }
          disabled={!canBuy || pending}
          onClick={añadirAlCarrito}
        >
          {t('store.product.addToCart')}
        </Button>
      </Stack>
    </Stack>

    {/**
      * La barra de compra del teléfono (V3 · P10).
      *
      * Vive aquí y no en la página, y esa es la decisión que importa: el precio
      * de la variante elegida, la cantidad, si se puede comprar y el propio
      * `agregar` ya están en este componente. Sacarla arriba habría obligado a
      * subir ese estado y a tener DOS caminos hacia el carrito — y dos caminos
      * con dos reglas es cómo se acaba cobrando un precio distinto del que se
      * enseñó.
      *
      * No se pinta si no se puede comprar por STOCK: una barra pegada abajo con
      * un botón apagado ocupa sitio para no ofrecer nada. Sí se pinta cuando
      * falta elegir variante, porque ahí tiene algo que hacer: llevar a
      * elegirla.
      */}
    {available ? (
      <StoreProductPurchaseBar
        priceLabel={
          selected ? formatMoney(Number(selected.price), selected.currency, locale) : priceLabel
        }
        // El nombre de la variante elegida —«Talla XL»— dice más que «desde»,
        // y cuando no hay ninguna elegida vale la nota de la página.
        note={selected?.name ?? priceNote}
        ctaLabel={canBuy ? t('store.product.addToCart') : t('store.product.chooseOptions')}
        onCta={canBuy ? añadirAlCarrito : irAElegir}
        pending={pending}
        // Elegida y agotada: no hay nada que añadir ni nada que elegir.
        disabled={hasVariants && selected !== null && selected.in_stock === false}
      />
    ) : null}
    </>
  )
}
