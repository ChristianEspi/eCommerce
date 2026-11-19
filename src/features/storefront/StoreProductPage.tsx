import InventoryRoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Link as MuiLink,
  Rating,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAgreementPrice } from '@/features/pricing/useAgreementPrice'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { AppBreadcrumbs } from '@/shared/ui/AppBreadcrumbs'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { StorefrontNotFoundError, type PriceTier } from './api'
import { ProductPageSkeleton } from './components/ProductPageSkeleton'
import { notFoundMeta, productMeta } from './seo'
import { track } from './analytics'
import { useAddToCart } from './cart/useAddToCart'
import { useAssortmentBlocked } from './commerce/assortment'
import { PriceTiers } from './components/PriceTiers'
import {
  DeliveryAside,
  FrequentlyBoughtTogether,
  InstallmentLine,
  ProductHighlights,
  StoreAvailability,
} from './components/ProductDetailBlocks'
import { installmentFor, readInstallments, useProductDetail } from './productDetail'
import { ProductGallery } from './components/ProductGallery'
import { ProductRow } from './components/ProductRow'
import { StoreProductDetails } from './components/StoreProductDetails'
import { StoreProductPurchaseBar } from './components/StoreProductPurchaseBar'
import { QuantityStepper } from './components/QuantityStepper'
import { VariantPicker } from './components/VariantPicker'
import { useRelatedSections } from './relations'
import { useProductReviews } from './reviews/hooks'
import { useFavorites } from './useFavorites'
import { useVariantChoice } from './useVariantChoice'
import { galleryForVariant, galleryKey } from './variantGallery'
import { useStorefrontTheme } from './theme/useStorefrontTheme'

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
  usePriceTiers,
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
  const { preset } = useStorefrontTheme()
  /** Rediseño v3 · la ficha retail con la composición de su lámina. */
  const retail = preset === 'retail'
  /** Rediseño v3 · la ficha universal: tres columnas (lámina de ficha). */
  const universal = preset === 'universal'
  const { store, storeSlug } = useStorefront()
  const { productSlug } = useParams<{ productSlug: string }>()

  const product = usePublicProduct(store.store_id, productSlug)
  const gallery = useGallery(product.data?.product_id ?? null)
  // Lámina 31 · El corazón también en la ficha, donde se decide guardar para
  // luego. Es el mismo estado que el de las tarjetas.
  const favorites = useFavorites(store.store_id)
  // Lámina 31 · Las escalas por cantidad, solo sin variantes (con variantes el
  // precio todavía es un «desde»).
  const tiers = usePriceTiers(
    storeSlug,
    product.data && product.data.kind !== 'variant' ? product.data.product_id : null,
  )
  const variants = usePublicVariants(product.data)
  // La variante elegida vive en la pagina y no en la caja de compra: la
  // galeria tambien la necesita, para ensenar las fotos de ESE color.
  const choice = useVariantChoice(variants.data ?? [], product.data?.kind === 'variant')
  // La ficha completa (2026-10-13): SKU, destacados, especificaciones, stock
  // por tienda y entrega. Con variante elegida, el SKU y el stock son SUYOS.
  const detail = useProductDetail(
    storeSlug,
    product.data?.product_id ?? null,
    choice.selected?.variant_id ?? null,
  )

  /**
   * El precio del acuerdo, si quien mira tiene uno.
   *
   * Con variantes se cotiza la ELEGIDA (2026-11-18). Antes no se preguntaba
   * nunca y el comprador con convenio veía «Desde S/ 9.07» en la ficha y su
   * S/ 8.16 recién en el carrito: dos precios para el mismo frasco. Sin
   * variante elegida todavía no hay qué cotizar y queda el «desde» público.
   */
  const conAcuerdo = useAgreementPrice(
    storeSlug,
    product.data && (product.data.kind !== 'variant' || choice.selected) ? product.data : null,
    product.data?.kind === 'variant' ? choice.selected : null,
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
  const extra = detail.data ?? null
  const sku = extra?.sku ?? item.sku ?? null
  /**
   * Las cuotas sobre el precio que el comprador va a pagar: el del acuerdo, el
   * de la variante elegida o el de la ficha. Sin configuración, nada.
   */
  const plan = installmentFor(
    readInstallments(store.installments),
    conAcuerdo
      ? conAcuerdo.amount
      : Number(choice.selected?.price ?? (hasVariants ? (item.price_from ?? item.price) : item.price)),
  )
  /** Lo que entra en «Frecuentemente comprados juntos» y no se repite abajo. */
  const juntos = universal
    ? new Set(
        curated.sections.complete
          .filter((p) => p.kind !== 'variant' && p.in_stock !== false)
          .slice(0, 2)
          .map((p) => p.product_id),
      )
    : new Set<string>()
  const puedeComprar =
    available && (!hasVariants || (choice.selected !== null && choice.selected.in_stock !== false))
  const esFavorito = favorites.ids.has(item.product_id)
  /**
   * Lámina 31 · Cuánto se ahorra, dicho en dinero y no solo en porcentaje.
   *
   * Solo con la oferta abierta a todos (`compare_at_price`) y sin variantes: con
   * acuerdo el tachado es otro, y con variantes el precio aún es un «desde».
   */
  const ahorro =
    !conAcuerdo && !hasVariants && discount !== null && item.compare_at_price
      ? Number(item.compare_at_price) - Number(item.price)
      : null

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
      : Number(hasVariants ? (choice.selected?.price ?? item.price_from ?? item.price) : item.price),
    conAcuerdo?.currency ?? item.currency,
    locale,
  )

  const salidaAlCatalogo = item.category_slug
    ? `/s/${storeSlug}?c=${encodeURIComponent(item.category_slug)}`
    : `/s/${storeSlug}?ver=todo`

  /** La ficha de datos: va en su pestaña y, resumida, junto a la descripción. */
  const fichaDeDatos = (
    <Stack>
      {/* El SKU solo cuando llega: no todas las lecturas públicas lo traen, y
          una fila fija con «—» diría que no tiene código. */}
      {sku ? <SheetRow label="SKU" value={sku} /> : null}
      <SheetRow label={t('store.filter.brand')} value={item.brand_name} />
      {/* Las especificaciones que el comercio cargó en la pestaña «Ficha» del
          producto (atributos que no son eje de variante), en su orden. */}
      {(extra?.specs ?? []).map((spec) => (
        <SheetRow
          key={spec.label}
          label={spec.label}
          value={
            spec.type === 'boolean'
              ? spec.value === 'true'
                ? t('store.product.specs.yes')
                : t('store.product.specs.no')
              : spec.value
          }
        />
      ))}
      <SheetRow label={t('store.filter.category')} value={item.category_name} />
      <SheetRow
        label={t('store.product.availabilityLabel')}
        value={available ? t('store.availability.inStock') : t('store.availability.outOfStock')}
      />
    </Stack>
  )

  /**
   * El detalle plegado. En retail vive EN la columna de compra, bajo los
   * beneficios (lámina de ficha); en los demás estilos, debajo y a lo ancho.
   */
  /**
   * Las tres dudas que frenan un «añadir al carrito», junto al botón. Son
   * lo que la plataforma SÍ garantiza. En universal viven en su propia
   * columna, en tarjeta (lámina de ficha); en los demás, bajo la compra.
   */
  const confianza = (
          <Stack
            component="ul"
            data-pdp-trust
            sx={{
              listStyle: 'none',
              m: 0,
              mt: 1,
              p: 0,
              border: '1px solid var(--sf-line)',
              borderRadius: 'var(--sf-radius-sm)',
              bgcolor: 'var(--card)',
            }}
          >
            {([
              ['store.product.trust.delivery', LocalShippingRoundedIcon],
              ['store.product.trust.payment', LockRoundedIcon],
              ['store.product.trust.stock', InventoryRoundedIcon],
            ] as const).map(([clave, Icono]) => (
              <Stack
                key={clave}
                component="li"
                direction="row"
                sx={{
                  alignItems: 'center',
                  gap: 1.25,
                  px: 1.75,
                  py: 1.25,
                  '& + &': { borderTop: '1px solid var(--sf-line)' },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    borderRadius: '50%',
                    bgcolor: 'var(--accent-soft)',
                    color: 'var(--accent-deep)',
                  }}
                >
                  <Icono sx={{ fontSize: 16 }} />
                </Box>
                <Typography sx={{ fontSize: TS.body, fontWeight: 600 }}>{t(clave)}</Typography>
              </Stack>
            ))}
          </Stack>
  )

  const detalles = (
      <StoreProductDetails
        ariaLabel={t('store.product.detailsSection')}
        panels={[
          ...(item.description?.trim()
            ? [
                {
                  id: 'description',
                  title: t('store.product.description'),
                  /**
                   * SOLO el texto. Antes llevaba al lado la ficha de datos
                   * entera, y la pestaña «Datos del producto» repetía la misma
                   * tabla: dos pestañas para leer lo mismo (visto 2026-11-16).
                   * Cada dato vive en un sitio. El texto va en una columna de
                   * lectura centrada bajo las pestañas, también centradas.
                   */
                  content: (
                    <Typography
                      data-pdp-description
                      sx={{
                        fontSize: { xs: 15, md: 17 },
                        color: 'var(--text)',
                        whiteSpace: 'pre-line',
                        lineHeight: 1.7,
                        // Una línea de lectura cómoda, no a lo ancho de la página.
                        maxWidth: '72ch',
                        mx: 'auto',
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
            // En la misma columna centrada que la descripción: al cambiar de
            // pestaña el contenido no salta de sitio.
            content: <Box sx={{ maxWidth: 760, mx: 'auto' }}>{fichaDeDatos}</Box>,
          },
        ]}
      />
  )

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
        {/* A la FAMILIA del producto, que es a donde vuelve quien lo descarta
            y busca otro parecido. Sin familia, al catálogo. */}
        <Button
          component={Link}
          to={salidaAlCatalogo}
          startIcon={<ArrowBackRoundedIcon />}
          // Rediseño v3 · retail no lo pinta: las migas ya dicen cómo subir.
          className="sf-pdp-back"
          sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
        >
          {item.category_name
            ? t('store.product.backTo').replace('{name}', item.category_name)
            : t('store.product.back')}
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 4 },
          gridTemplateColumns: universal
            ? { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)', lg: 'minmax(0, 1.05fr) minmax(0, 1fr) 280px' }
            : { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)' },
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
          <ProductGallery
            // Otro color es otra galeria: se monta de nuevo y empieza en su
            // primera foto, no en el indice que tenia la anterior.
            key={galleryKey(choice.selected)}
            images={galleryForVariant(gallery.data ?? [], variants.data ?? [], choice.selected)}
            loading={gallery.isPending}
            alt={item.name}
            badge={!conAcuerdo && !hasVariants && discount !== null ? `−${discount} %` : null}
            // Rediseño v3 · retail: todas las fotos grandes en rejilla (lámina).
            layout={retail ? 'grid' : 'viewer'}
            {...(retail
              ? {}
              : {
                  favorite: {
                    active: esFavorito,
                    onToggle: () => void favorites.toggle(item.product_id),
                    label: `${esFavorito ? t('store.favorite.remove') : t('store.favorite.add')}: ${item.name}`,
                  },
                })}
          />
          {/* Lo destacado, bajo las fotos (lámina de ficha). */}
          <ProductHighlights items={extra?.highlights ?? []} />
        </Box>

        {/* La compra y la ficha de datos, en la MISMA columna y pegadas arriba.
            Antes los datos iban abajo a lo ancho y la columna de compra se
            quedaba flotando sobre medio metro de fondo vacio: la mirada acababa
            en un hueco justo al lado del boton que hay que pulsar. */}
        <Stack
          data-pdp-purchase="true"
          sx={{ gap: 1.25, position: { md: 'sticky' }, top: { md: 88 } }}
        >
          {/* Marca y SKU en una línea: el comprador de empresa verifica por
              código, y en Catálogo es lo primero que busca. */}
          {(item.brand_name || sku) && (
            <Typography
              data-pdp-eyebrow
              sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--accent-deep)', letterSpacing: '0.04em' }}
            >
              {[item.brand_name, sku ? `SKU ${sku}` : null].filter(Boolean).join('  ·  ')}
            </Typography>
          )}
          {/* La categoría YA la dicen las migas, y allí además es un enlace al
              catálogo filtrado. Repetirla aquí encima del título la ponía tres
              veces en la misma pantalla —migas, encabezado y ficha de datos—,
              que es ruido, no énfasis. Aquí manda la marca, que no está en
              ningún otro sitio de esta columna. */}
          <Typography
            component="h1"
            className="sf-pdp-title"
            sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 700, lineHeight: 1.18, letterSpacing: '-0.015em' }}
          >
            {item.name}
          </Typography>

          <ReviewsSummaryLine storeSlug={storeSlug} productId={item.product_id} />

          <Stack
            direction="row"
            data-pdp-price
            sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}
          >
            {/* Con variantes el precio de la ficha es un "desde" hasta que el
                comprador elige: el maestro puede costar 60 y la talla XL 70,
                y anunciar 60 a secas es un precio que no se va a cobrar. */}
            {hasVariants && item.variant_count > 1 && !choice.selected && (
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
                  {formatMoney(conAcuerdo.reference, item.currency, locale)}
                </Typography>
                {/* El mismo «−10 %» que el carrito: si la ficha no lo dice, el
                    comprador lo descubre al abrir el carrito y desconfía. */}
                <Chip
                  label={`${t('store.cart.listPrice')} −${conAcuerdo.percent} %`}
                  size="small"
                  sx={{ bgcolor: 'var(--accent)', color: '#FFFFFF', fontWeight: 800 }}
                />
              </>
            )}
            {!conAcuerdo && !hasVariants && discount !== null && item.compare_at_price && (
              <>
                {/* Solo el tachado: el porcentaje ya lo dicen la pastilla de la
                    foto y «Ahorras…». Tres veces el mismo −20 % es ruido. */}
                <Typography component="s" sx={{ color: 'var(--muted)', fontWeight: 600, fontSize: { xs: 15, md: 17 } }}>
                  {formatMoney(Number(item.compare_at_price), item.currency, locale)}
                </Typography>
              </>
            )}
            {/* Universal · el ahorro en la MISMA fila del precio (lámina). */}
            {universal && ahorro !== null && ahorro > 0 ? (
              <Box
                data-pdp-savings
                component="span"
                sx={{ alignSelf: 'center', px: 1, py: 0.25, fontSize: TS.label, fontWeight: 800 }}
              >
                {t('store.product.youSave')
                  .replace('{amount}', formatMoney(ahorro, item.currency, locale))
                  .replace('{percent}', `−${discount} %`)}
              </Box>
            ) : null}
          </Stack>

          <InstallmentLine plan={plan} currency={conAcuerdo?.currency ?? item.currency} />

          {/* Por qué ese precio y no el de la etiqueta. Sin esta línea, un
              número más bajo que el del catálogo parece un error de la tienda
              —o peor, un precio que va a cambiar en la caja. */}
          {conAcuerdo && (
            <Typography sx={{ fontSize: TS.label, color: 'var(--accent-deep)', fontWeight: 700 }}>
              {t('store.product.agreementPrice')}
            </Typography>
          )}

          {!universal && ahorro !== null && ahorro > 0 && (
            <Box
              data-pdp-savings
              sx={{
                alignSelf: 'flex-start',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.5,
                borderRadius: 'var(--sf-pill)',
                bgcolor: 'var(--accent-soft)',
                color: 'var(--accent-deep)',
                fontSize: TS.body,
                fontWeight: 700,
              }}
            >
              <LocalOfferRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
              {t('store.product.youSave')
                .replace('{amount}', formatMoney(ahorro, item.currency, locale))
                .replace('{percent}', `−${discount} %`)}
            </Box>
          )}

          {/* Disponible con un punto de color y no con una pastilla: la
              pastilla competía con la de ahorro, que es la que vende. */}
          <Stack direction="row" data-pdp-stock sx={{ alignItems: 'center', gap: 0.875 }}>
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: available ? 'var(--sf-ok, var(--accent-deep))' : 'var(--muted)',
              }}
            />
            <Typography
              sx={{
                fontSize: TS.body,
                fontWeight: 700,
                color: available ? 'var(--sf-ok, var(--accent-deep))' : 'var(--muted)',
              }}
            >
              {available ? t('store.availability.inStock') : t('store.availability.outOfStock')}
            </Typography>
          </Stack>

          <AddToCart
            product={item}
            choice={choice}
            available={available}
            variants={hasVariants ? (variants.data ?? []) : []}
            variantsPending={hasVariants && variants.isPending}
            priceLabel={precioDeLaFicha}
            // Con convenio el precio de la sesión manda sobre las escalas
            // públicas: enseñarlas ahí sería anunciar un precio que no es el suyo.
            tiers={conAcuerdo ? [] : (tiers.data ?? [])}
            {...(conAcuerdo
              ? { priceNote: t('store.product.agreementPrice') }
              : hasVariants && item.variant_count > 1 && !choice.selected
                ? { priceNote: t('store.product.priceFrom') }
                : {})}
          />

          {universal ? null : confianza}
          {universal ? null : <StoreAvailability stores={extra?.stores ?? []} />}

          {/* Rediseño v3 · Retail: guardar como botón bajo la compra y el
              detalle plegado en la misma columna (lámina de ficha). */}
          {retail ? (
            <Button
              variant="outlined"
              fullWidth
              className="sf-pdp-fav"
              aria-pressed={esFavorito}
              onClick={() => void favorites.toggle(item.product_id)}
              endIcon={esFavorito ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
            >
              {esFavorito ? t('store.favorite.remove') : t('store.favorite.add')}
            </Button>
          ) : null}
          {retail ? <Box className="sf-pdp-details">{detalles}</Box> : null}
        </Stack>

        {/* Universal · la tercera columna: entrega, tiendas, quién vende y el
            envío gratis (lámina de ficha, 2026-10-13). */}
        {universal ? (
          <Box sx={{ gridColumn: { md: '1 / -1', lg: 'auto' } }}>
            <DeliveryAside detail={extra} currency={item.currency} storeName={store.name} />
          </Box>
        ) : null}
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
      {retail ? null : detalles}

      {/* Opiniones (cierre): solo lo moderado, más la reseña propia con su
          estado. Ver `reviews/ProductReviews.tsx`. */}
      <Suspense fallback={null}>
        <ProductReviews storeSlug={storeSlug} productId={item.product_id} />
      </Suspense>

      {/* Primero lo que completa la compra —es lo que suma al carrito que ya se
          está decidiendo—, después la mejora y al final lo parecido. */}
      {universal ? (
        <FrequentlyBoughtTogether
          product={item}
          variant={choice.selected}
          complements={complete}
          thumbnails={relatedThumbs}
          mainImage={
            galleryForVariant(gallery.data ?? [], variants.data ?? [], choice.selected).find((image) => image.url)
              ?.url ?? null
          }
          storeSlug={storeSlug}
          canBuy={puedeComprar}
        />
      ) : null}
      <RelatedRow
        title={t('store.product.relations.complete')}
        products={complete.filter((p) => !juntos.has(p.product_id))}
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
      // Lámina 31 · Compactos: 5 por fila en escritorio, en todos los temas.
      fixedColumns={{ xs: 2, sm: 3, lg: 5 }}
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
      className="sf-sheet-row"
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
  choice,
  available,
  variants,
  variantsPending,
  priceLabel,
  priceNote,
  tiers = [],
}: {
  product: PublicProduct
  /** La variante elegida y como cambiarla: la lleva la pagina (ver arriba). */
  choice: ReturnType<typeof useVariantChoice>
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
  /** Escalas públicas por cantidad; vacías si no las hay. */
  tiers?: readonly PriceTier[]
}) {
  const { t, locale } = useI18n()
  const { storeSlug } = useStorefront()
  const { agregar, pending } = useAddToCart()
  const [quantity, setQuantity] = useState(1)
  const { preset } = useStorefrontTheme()
  const navigate = useNavigate()

  const hasVariants = product.kind === 'variant'
  const { selected, select } = choice
  // 2026-11-16 · Fuera del surtido de la empresa: se ve, pero no se compra.
  const fueraDeSurtido = useAssortmentBlocked(storeSlug, [product.product_id]).has(product.product_id)
  const canBuy =
    !fueraDeSurtido && available && (!hasVariants || (selected !== null && selected.in_stock !== false))

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

      <PriceTiers tiers={tiers} currency={product.currency} quantity={quantity} onChoose={setQuantity} />

      {fueraDeSurtido && (
        <Alert severity="info" data-pdp-out-of-assortment>
          {t('store.assortment.productBlocked')}
        </Alert>
      )}

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <QuantityStepper value={quantity} onChange={setQuantity} />

        <Button
          variant="contained"
          size="large"
          startIcon={
            pending ? <CircularProgress size={16} color="inherit" /> : <ShoppingCartRoundedIcon />
          }
          disabled={!canBuy || pending}
          onClick={añadirAlCarrito}
          className="sf-pdp-buy"
          // Lámina 31 · El botón ocupa lo que queda de la fila: es la acción de
          // la página y no puede medir lo mismo que el selector de cantidad.
          sx={{ flex: 1, minWidth: 200, minHeight: 50, fontSize: 16, fontWeight: 700 }}
        >
          {t('store.product.addToCart')}
        </Button>
      </Stack>
      {/* Rediseño v3 · Universal: «Comprar ahora» (lámina). Es el mismo añadir
          y, si sale bien, directo al pago: no hay flujo nuevo. */}
      {preset === 'universal' ? (
        <Button
          variant="outlined"
          fullWidth
          className="sf-pdp-buynow"
          disabled={!canBuy || pending}
          onClick={() => {
            track(storeSlug, {
              type: 'add_to_cart',
              product_id: product.product_id,
              ...(selected ? { variant_id: selected.variant_id } : {}),
              quantity,
            })
            void agregar(product, quantity, selected).then((ok) => {
              if (ok) navigate(`/s/${storeSlug}/checkout`)
            })
          }}
          sx={{ minHeight: 46, textTransform: 'none', fontWeight: 700 }}
        >
          {t('store.product.buyNow')}
        </Button>
      ) : null}
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
    {available && !fueraDeSurtido ? (
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

/**
 * Lámina 31 · La valoración bajo el título: «★★★★½ 4,5 · 12 opiniones», o
 * «Sin opiniones aún · Sé el primero» si no hay ninguna.
 *
 * Usa la MISMA consulta que la sección de opiniones (primera página, misma
 * clave), así que no cuesta una petición más. Si falla o aún no llega, no se
 * pinta: una línea de estrellas vacías mientras carga diría que no hay
 * opiniones cuando no se sabe.
 */
function ReviewsSummaryLine({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const { t, locale } = useI18n()
  const reviews = useProductReviews(storeSlug, productId, 1)
  const summary = reviews.data?.summary
  if (!summary) return null

  const average = summary.average === null ? 0 : Number(summary.average)
  const hay = summary.count > 0
  return (
    <Stack direction="row" data-pdp-rating sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Rating
        value={average}
        precision={0.5}
        readOnly
        size="small"
        getLabelText={() =>
          t('store.reviews.average').replace(
            '{average}',
            new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(average),
          )
        }
        sx={{ color: 'var(--accent-deep)' }}
      />
      <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
        {hay
          ? summary.count === 1
            ? t('store.reviews.countOne')
            : t('store.reviews.count').replace('{count}', String(summary.count))
          : t('store.reviews.none')}
      </Typography>
      <MuiLink
        href="#opiniones"
        underline="hover"
        sx={{ fontSize: TS.body, fontWeight: 700, color: 'var(--accent-deep)' }}
      >
        {hay ? t('store.reviews.readAll') : t('store.reviews.beFirst')}
      </MuiLink>
    </Stack>
  )
}
