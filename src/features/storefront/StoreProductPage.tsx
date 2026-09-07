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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import { useCart } from './cart/cart-context'
import { ProductGallery } from './components/ProductGallery'
import { ProductGrid } from './components/ProductGrid'
import { QuantityStepper } from './components/QuantityStepper'
import {
  useGallery,
  usePublicProduct,
  usePublicProducts,
  usePublicVariants,
  useStorefront,
  useThumbnails,
} from './hooks'
import {
  defaultVariant,
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

  // Relacionados «simples»: el resto de su categoría. Si no tiene categoría o
  // no llega para llenar la fila, `pickRelated` completa con el catálogo.
  const relatedQuery: CatalogQuery = useMemo(
    () => ({
      storeId: product.data ? store.store_id : null,
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
    [product.data, store.store_id],
  )
  const catalog = usePublicProducts(relatedQuery)
  const related = product.data ? pickRelated(catalog.data ?? [], product.data) : []
  const relatedThumbs = useThumbnails(related)

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

  return (
    <Stack sx={{ gap: { xs: 2.5, md: 4 } }}>
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
        {/* Cada mitad en su tarjeta: sobre el fondo desnudo, la foto y los datos
            parecían dos cosas que están cerca por casualidad. */}
        <Card
          sx={{
            p: { xs: 1.5, md: 2 },
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <ProductGallery images={gallery.data ?? []} alt={item.name} />
        </Card>

        {/* La compra y la ficha de datos, en la MISMA columna y pegadas arriba.
            Antes los datos iban abajo a lo ancho y la columna de compra se
            quedaba flotando sobre medio metro de fondo vacio: la mirada acababa
            en un hueco justo al lado del boton que hay que pulsar. */}
        <Stack sx={{ gap: 2, position: { md: 'sticky' }, top: { md: 88 } }}>
        <Card
          sx={{
            p: { xs: 2, md: 2.5 },
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
        <Stack sx={{ gap: 1.25 }}>
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
              {formatMoney(
                Number(hasVariants ? (item.price_from ?? item.price) : item.price),
                item.currency,
                locale,
              )}
            </Typography>
            {!hasVariants && discount !== null && item.compare_at_price && (
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
        </Card>

        <Card
          sx={{
            p: { xs: 2, md: 2.5 },
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Typography
            component="h2"
            sx={{
              fontSize: TS.label,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              mb: 1,
            }}
          >
            {t('store.product.sheet')}
          </Typography>
          <Stack>
            <SheetRow label={t('store.filter.brand')} value={item.brand_name} />
            <SheetRow label={t('store.filter.category')} value={item.category_name} />
            <SheetRow
              label={t('store.product.availabilityLabel')}
              value={
                available ? t('store.availability.inStock') : t('store.availability.outOfStock')
              }
            />
          </Stack>
        </Card>
        </Stack>
      </Box>

      {/* La descripción, a lo ancho y debajo: es texto corrido, y en una columna
          estrecha al lado de la foto se lee peor que en una línea larga. */}
      <Card
        sx={{
          p: { xs: 2, md: 3 },
          borderRadius: 'var(--sf-radius)',
          border: '1px solid var(--sf-line)',
          boxShadow: 'var(--sf-shadow)',
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontSize: TS.label,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            mb: 1,
          }}
        >
          {t('store.product.description')}
        </Typography>
        <Typography
          sx={{
            fontSize: 15,
            color: item.description ? 'var(--text)' : 'var(--muted)',
            whiteSpace: 'pre-line',
            lineHeight: 1.7,
            maxWidth: '72ch',
          }}
        >
          {item.description?.trim() || t('store.product.noDescription')}
        </Typography>
      </Card>

      {related.length > 0 && (
        <Box component="section">
          <Typography
            component="h2"
            sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 800, letterSpacing: '-0.02em', mb: 2 }}
          >
            {t('store.product.related')}
          </Typography>
          <ProductGrid products={related} storeSlug={storeSlug} thumbnails={relatedThumbs} />
        </Box>
      )}
    </Stack>
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
 * Con variantes, el botón exige elegir una. NO se elige "la primera" en
 * silencio: preseleccionar es cómodo, pero comprar sin haber elegido es recibir
 * la talla que no era.
 */
function AddToCart({
  product,
  available,
  variants,
  variantsPending,
}: {
  product: PublicProduct
  available: boolean
  variants: PublicVariant[]
  variantsPending: boolean
}) {
  const { t, locale } = useI18n()
  const { storeSlug } = useStorefront()
  const { add } = useCart()
  const [quantity, setQuantity] = useState(1)
  const [variantId, setVariantId] = useState('')

  const hasVariants = product.kind === 'variant'

  // Preselección: la marcada por defecto, o la primera disponible. Se aplica
  // cuando llegan las variantes y no antes, para no fijar una elección sobre
  // una lista vacía.
  useEffect(() => {
    if (!hasVariants || variants.length === 0) return
    setVariantId((current) =>
      current && variants.some((variant) => variant.variant_id === current)
        ? current
        : (defaultVariant(variants)?.variant_id ?? ''),
    )
  }, [hasVariants, variants])

  const selected = variants.find((variant) => variant.variant_id === variantId) ?? null
  const canBuy = available && (!hasVariants || (selected !== null && selected.in_stock !== false))

  return (
    // `role="group"` con nombre: la variante, la cantidad y el botón son UNA
    // sola decisión, y anunciarlos sueltos deja al lector de pantalla leyendo
    // tres controles sin relación. Además distingue este botón de los que ahora
    // llevan las tarjetas de «también te puede interesar», que se llaman igual.
    <Stack
      role="group"
      aria-label={t('store.product.buyGroup')}
      sx={{ gap: 1.5, mt: 1 }}
    >
      {hasVariants && (
        <TextField
          select
          size="small"
          label={t('store.product.chooseVariant')}
          value={variantId}
          disabled={variantsPending || variants.length === 0}
          onChange={(event) => setVariantId(event.target.value)}
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value="">{t('store.product.variantRequired')}</MenuItem>
          {variants.map((variant) => (
            <MenuItem
              key={variant.variant_id}
              value={variant.variant_id}
              disabled={variant.in_stock === false}
            >
              {variant.name} · {formatMoney(Number(variant.price), variant.currency, locale)}
              {variant.in_stock === false && ` · ${t('store.product.variantOutOfStock')}`}
            </MenuItem>
          ))}
        </TextField>
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
          startIcon={<ShoppingCartRoundedIcon />}
          disabled={!canBuy}
          onClick={() => {
            add(product, quantity, selected)
            // `add_to_cart` es el ÚNICO de los tres hechos de vitrina que
            // corresponde a una decisión y no a una visita, y por eso se emite
            // aquí y no en el carrito: el carrito se reescribe entero al
            // recotizar (P07) y contar allí convertiría un refresco de precio
            // en una intención de compra.
            track(storeSlug, {
              type: 'add_to_cart',
              product_id: product.product_id,
              ...(selected ? { variant_id: selected.variant_id } : {}),
              quantity,
            })
          }}
        >
          {t('store.product.addToCart')}
        </Button>
      </Stack>
    </Stack>
  )
}
