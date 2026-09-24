import AddShoppingCartRoundedIcon from '@mui/icons-material/AddShoppingCartRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { track } from '../analytics'
import { useAddToCart } from '../cart/useAddToCart'
import { discountPercent, type PublicProduct } from '../types'
import { useCatalogCommercialPrices } from '../commerce/catalogPrices'
import { ProductCard } from './ProductCard'
import { ProductMedia } from './ProductMedia'
import { SectionHeading } from './SectionHeading'

/**
 * La banda que ocupa el centro de la portada: lo REBAJADO y lo DESTACADO.
 *
 * ## Por qué las dos juntas y en dos anchos distintos
 *
 * Son dos preguntas seguidas y no la misma: «¿qué está de oferta?» se responde
 * con tres productos y su porcentaje —una lista corta que se compara— y «¿qué
 * vendéis?» necesita ver variedad, que son seis y en rejilla. Puestas en dos
 * columnas de distinto ancho, cada una se lee por lo que es; apiladas en dos
 * filas iguales, la segunda parecía «más de lo mismo».
 *
 * En móvil se apilan, claro: dos columnas de 190 px no son dos columnas.
 */
export function OffersFeaturedBand({
  offers,
  featured,
  storeSlug,
  offersThumbs,
  featuredThumbs,
  favorites,
  onToggleFavorite,
  onQuickView,
}: {
  offers: readonly PublicProduct[]
  featured: readonly PublicProduct[]
  storeSlug: string
  offersThumbs: Record<string, string>
  featuredThumbs: Record<string, string>
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (productId: string) => void
  onQuickView?: (slug: string) => void
}) {
  const { t } = useI18n()
  if (offers.length === 0 && featured.length === 0) return null

  /**
   * Storefront V2 · P06 · Dos columnas SOLO si hay dos cosas que poner.
   *
   * La banda repartía siempre 5fr para lo rebajado y 7fr para lo destacado. Con
   * las dos mitades llenas está bien; con una sola —una tienda que empieza, o
   * un comercio que separó lo destacado a su propia fila— la mitad vacía se
   * quedaba reservada y la banda salía con un 40 % o un 58 % de blanco al lado
   * de su contenido.
   *
   * No es un caso raro: es el estado normal de una tienda con pocos productos,
   * que es justo cuando peor sienta.
   */
  const ambas = offers.length > 0 && featured.length > 0

  return (
    <Box
      data-offers-band={ambas ? 'both' : offers.length > 0 ? 'offers' : 'featured'}
      sx={{
        display: 'grid',
        gap: { xs: 2.5, md: 3 },
        gridTemplateColumns: {
          xs: '1fr',
          md: ambas ? 'minmax(0, 5fr) minmax(0, 7fr)' : '1fr',
        },
        alignItems: 'start',
      }}
    >
      {offers.length > 0 ? (
        <Stack component="section" aria-label={t('store.row.weekDeals')} sx={{ gap: 1.25 }}>
          <SectionHeading
            title={t('store.row.weekDeals')}
            action={
              // «Ver todo» de las OFERTAS lleva al catálogo filtrado por lo
              // rebajado, no al catálogo entero: soltar al visitante en los 568
              // productos es hacerle perder justo la oferta que estaba mirando.
              <Box
                component={Link}
                to={`/s/${storeSlug}?ver=todo&oferta=1`}
                sx={{
                  fontSize: TS.label,
                  fontWeight: 800,
                  color: 'var(--accent-deep)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {t('store.row.seeAll')}
                <Box component="span" aria-hidden sx={{ ml: 0.5 }}>
                  →
                </Box>
              </Box>
            }
          />

          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              // Tantas columnas como ofertas haya, hasta tres. Con una sola, un
              // `repeat(3)` fijo dejaba dos huecos a su derecha — y con la
              // banda ya en una columna, esos huecos ocupaban media pantalla.
              gridTemplateColumns: {
                xs: offers.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                sm: `repeat(${Math.min(offers.length, 3)}, minmax(0, 1fr))`,
              },
            }}
          >
            {offers.slice(0, 3).map((product) => (
              <OfferCard
                key={product.product_id}
                product={product}
                storeSlug={storeSlug}
                imageUrl={
                  product.primary_image_path ? (offersThumbs[product.primary_image_path] ?? null) : null
                }
              />
            ))}
          </Box>
        </Stack>
      ) : null}

      {featured.length > 0 ? (
        <Stack component="section" aria-label={t('store.row.highlighted')} sx={{ gap: 1.25 }}>
          <SectionHeading
            title={t('store.row.highlighted')}
            action={
              <Box
                component={Link}
                to={`/s/${storeSlug}?ver=todo`}
                sx={{
                  fontSize: TS.label,
                  fontWeight: 800,
                  color: 'var(--accent-deep)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {t('store.row.seeAll')}
                <Box component="span" aria-hidden sx={{ ml: 0.5 }}>
                  →
                </Box>
              </Box>
            }
          />

          <FeaturedCarousel
            products={featured}
            storeSlug={storeSlug}
            thumbnails={featuredThumbs}
            {...(favorites ? { favorites } : {})}
            {...(onToggleFavorite ? { onToggleFavorite } : {})}
            {...(onQuickView ? { onQuickView } : {})}
          />
        </Stack>
      ) : null}
    </Box>
  )
}

/**
 * La tarjeta de OFERTA: el porcentaje manda.
 *
 * No es la tarjeta del catálogo con otro color. Aquí lo que decide es cuánto se
 * ahorra, así que el sello va arriba a la izquierda —donde empieza la lectura—
 * y el precio anterior viaja pegado al nuevo, que es como se compara sin
 * calcular.
 */
function OfferCard({
  product,
  storeSlug,
  imageUrl,
}: {
  product: PublicProduct
  storeSlug: string
  imageUrl: string | null
}) {
  const { t, locale } = useI18n()
  const { agregar, pending } = useAddToCart()
  const descuento = discountPercent(product)
  const disponible = product.in_stock !== false

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 1,
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        bgcolor: 'var(--card)',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      {descuento !== null ? (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 1,
            px: 0.875,
            borderRadius: 'var(--sf-pill)',
            bgcolor: 'var(--accent-deep)',
            color: '#FFFFFF',
            fontSize: TS.label,
            fontWeight: 800,
            lineHeight: 1.8,
          }}
        >
          {`-${descuento}%`}
        </Box>
      ) : null}

      <ProductMedia url={imageUrl} alt={product.primary_image_alt ?? product.name} fit="contain" />

      <Typography
        component={Link}
        to={`/s/${storeSlug}/product/${product.slug}`}
        sx={{
          fontSize: 12.5,
          fontWeight: 700,
          lineHeight: 1.3,
          color: 'var(--text)',
          textDecoration: 'none',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          // La capa que hace pulsable la tarjeta entera; el botón de comprar va
          // por encima, así que pulsarlo compra en vez de navegar.
          '&::after': { content: '""', position: 'absolute', inset: 0 },
        }}
      >
        {product.name}
      </Typography>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 'auto' }}>
        <Stack sx={{ minWidth: 0 }}>
          <Typography className="tnum" sx={{ fontSize: 15, fontWeight: 900, lineHeight: 1.2 }}>
            {formatMoney(Number(product.price), product.currency, locale)}
          </Typography>
          {product.compare_at_price ? (
            <Typography
              component="s"
              className="tnum"
              sx={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}
            >
              {formatMoney(Number(product.compare_at_price), product.currency, locale)}
            </Typography>
          ) : null}
        </Stack>

        <IconButton
          size="small"
          disabled={!disponible || pending}
          aria-label={t('store.product.addToCart')}
          onClick={() => {
            void agregar(product, 1, null)
            track(storeSlug, { type: 'add_to_cart', product_id: product.product_id, quantity: 1 })
          }}
          sx={{
            position: 'relative',
            zIndex: 1,
            ml: 'auto',
            bgcolor: 'var(--accent-soft)',
            color: 'var(--accent-deep)',
            '&:hover': { bgcolor: 'var(--accent-soft)' },
          }}
        >
          <AddShoppingCartRoundedIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Stack>
    </Box>
  )
}

/** Cada cuánto avanza el escaparate. */
const PASO_MS = 5000
/** Cuántos productos entran en cada vuelta. */
const POR_VUELTA = 3

/**
 * El escaparate de destacados, pasando solo de tres en tres.
 *
 * Antes eran seis en rejilla de dos filas, y la columna de al lado —tres
 * ofertas— terminaba antes: quedaba un rectángulo blanco a la izquierda que no
 * decía nada. Con una sola fila que rota, las dos columnas acaban a la misma
 * altura y además caben más productos sin ocupar más sitio.
 *
 * Se para al pasar el ratón y con el foco dentro, y no se mueve si el sistema
 * pide menos movimiento: mismas reglas que el carrusel de ofertas, porque es el
 * mismo trato — contenido que se mueve sin que nadie lo pida.
 */
function FeaturedCarousel({
  products,
  storeSlug,
  thumbnails,
  favorites,
  onToggleFavorite,
  onQuickView,
}: {
  products: readonly PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (productId: string) => void
  onQuickView?: (slug: string) => void
}) {
  const { t } = useI18n()
  const [vuelta, setVuelta] = useState(0)
  const [parado, setParado] = useState(false)

  const vueltas: PublicProduct[][] = []
  for (let i = 0; i < products.length; i += POR_VUELTA) {
    vueltas.push(products.slice(i, i + POR_VUELTA))
  }
  const total = vueltas.length

  useEffect(() => {
    if (total <= 1 || parado) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setVuelta((v) => (v + 1) % total), PASO_MS)
    return () => window.clearInterval(id)
  }, [total, parado])

  useEffect(() => {
    if (vuelta >= total) setVuelta(0)
  }, [vuelta, total])

  // Toda la banda en UNA cotización, no una por vuelta (N03).
  const commercial = useCatalogCommercialPrices(storeSlug, products)
  const actuales = vueltas[Math.min(vuelta, Math.max(total - 1, 0))] ?? []
  if (actuales.length === 0) return null

  return (
    <Stack
      sx={{ gap: 1 }}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      onFocusCapture={() => setParado(true)}
      onBlurCapture={() => setParado(false)}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: `repeat(${POR_VUELTA}, minmax(0, 1fr))`,
          },
          gridAutoRows: '1fr',
        }}
      >
        {actuales.map((product) => (
          <ProductCard
            key={product.product_id}
            reduced
            product={product}
            storeSlug={storeSlug}
            commercialPrice={commercial.get(product.product_id) ?? null}
            {...(onQuickView ? { onQuickView } : {})}
            {...(onToggleFavorite ? { onToggleFavorite } : {})}
            favorite={favorites?.has(product.product_id) ?? false}
            imageUrl={
              product.primary_image_path ? (thumbnails[product.primary_image_path] ?? null) : null
            }
          />
        ))}
      </Box>

      {total > 1 ? (
        <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center', justifyContent: 'center' }}>
          <IconButton
            size="small"
            aria-label={t('store.promos.prev')}
            onClick={() => setVuelta((v) => (v - 1 + total) % total)}
          >
            <ChevronLeftRoundedIcon fontSize="small" />
          </IconButton>

          {vueltas.map((grupo, index) => (
            <Box
              key={grupo[0]?.product_id ?? index}
              component="button"
              type="button"
              aria-label={t('store.row.page').replace('{n}', String(index + 1))}
              aria-current={index === vuelta ? 'true' : undefined}
              onClick={() => setVuelta(index)}
              sx={{
                border: 0,
                p: 0,
                cursor: 'pointer',
                height: 6,
                width: index === vuelta ? 20 : 6,
                borderRadius: 999,
                bgcolor: index === vuelta ? 'var(--accent-deep)' : 'var(--sf-line-strong)',
                transition: 'width .2s ease',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            />
          ))}

          <IconButton
            size="small"
            aria-label={t('store.promos.next')}
            onClick={() => setVuelta((v) => (v + 1) % total)}
          >
            <ChevronRightRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ) : null}
    </Stack>
  )
}
