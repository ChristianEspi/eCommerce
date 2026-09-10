import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import InventoryRoundedIcon from '@mui/icons-material/Inventory2Rounded'
import SellRoundedIcon from '@mui/icons-material/SellRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { discountPercent, type PublicProduct } from '../types'
import { ProductMedia } from './ProductMedia'

/** Cada cuánto pasa sola. Seis segundos: lo que se tarda en leer un cartel. */
const INTERVALO_MS = 6000

/**
 * La portada de la tienda: UN producto, con su precio y su rebaja.
 *
 * ## Por qué un producto y no un cartel
 *
 * El hero anterior era un degradado con el lema del comercio. Se ve bonito y no
 * vende nada: no dice qué se compra, ni cuánto cuesta, ni por qué hoy. Una
 * botica en línea abre con una oferta concreta —producto, precio antes, precio
 * ahora— porque eso es lo que hace entrar al catálogo.
 *
 * ## De dónde sale
 *
 * De los productos REBAJADOS del propio catálogo: los que tienen precio
 * anterior mayor que el actual. No hay lista curada que mantener ni bloque que
 * escribir; el día que la rebaja acaba, el producto deja de salir aquí solo.
 *
 * Los tres hechos de la izquierda —marca, categoría, disponibilidad— son datos
 * que el producto YA declara. No se inventan reclamos: si el catálogo no dice
 * «sin azúcar», la portada tampoco.
 */
export function StoreFeaturedHero({
  products,
  storeSlug,
  thumbnails,
}: {
  products: readonly PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
}) {
  const { t, locale } = useI18n()
  const [actual, setActual] = useState(0)
  const [parado, setParado] = useState(false)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const total = products.length
  const ir = useCallback((i: number) => setActual(((i % total) + total) % total), [total])

  useEffect(() => {
    if (total <= 1 || parado) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setActual((i) => (i + 1) % total), INTERVALO_MS)
    return () => window.clearInterval(id)
  }, [total, parado])

  useEffect(() => {
    if (actual >= total) setActual(0)
  }, [actual, total])

  const product = products[actual]
  if (!product) return null

  const descuento = discountPercent(product)
  const imagen = product.primary_image_path ? (thumbnails[product.primary_image_path] ?? null) : null

  const hechos = [
    product.brand_name ? { icon: VerifiedRoundedIcon, text: product.brand_name } : null,
    product.category_name ? { icon: SellRoundedIcon, text: product.category_name } : null,
    {
      icon: InventoryRoundedIcon,
      text: product.in_stock === false
        ? t('store.availability.outOfStock')
        : t('store.availability.inStock'),
    },
  ].filter((hecho): hecho is { icon: typeof VerifiedRoundedIcon; text: string } => hecho !== null)

  return (
    <Box
      ref={contenedor}
      component="section"
      aria-roledescription="carousel"
      aria-label={t('store.hero.featured')}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      onFocusCapture={() => setParado(true)}
      onBlurCapture={(event) => {
        if (!contenedor.current?.contains(event.relatedTarget as Node | null)) setParado(false)
      }}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        // Fondo claro con un lavado del acento: la foto del producto manda, y
        // sobre un panel oscuro una caja blanca de medicamento se recorta fatal.
        background:
          'linear-gradient(130deg, color-mix(in srgb, var(--accent) 10%, var(--card)) 0%, var(--card) 55%, color-mix(in srgb, var(--accent) 6%, var(--card)) 100%)',
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{
          alignItems: 'center',
          gap: { xs: 2, md: 4 },
          px: { xs: 2.5, md: 6 },
          py: { xs: 3, md: 4 },
        }}
      >
        {/* 1 · Qué es */}
        <Stack sx={{ gap: 1.25, flex: 1, minWidth: 0 }}>
          {product.category_name ? (
            <Typography
              sx={{
                fontSize: TS.label,
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--accent-deep)',
              }}
            >
              {product.category_name}
            </Typography>
          ) : null}

          {/* El nombre del producto ES el `<h1>` de la portada cuando la
              cubierta es una oferta concreta. La escala la pone el tema —una
              portada editorial pide más cuerpo que un catálogo denso— pero el
              NIVEL no se toca: la jerarquía del documento no es decoración. */}
          <Typography
            component="h1"
            sx={{
              fontSize: {
                xs: 'var(--sf-featured-title, 26px)',
                md: 'var(--sf-featured-title-md, 38px)',
              },
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
            }}
          >
            {product.name}
          </Typography>

          {product.description ? (
            <Typography
              sx={{
                fontSize: { xs: 14, md: 15 },
                color: 'var(--muted)',
                maxWidth: '46ch',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {product.description}
            </Typography>
          ) : null}

          {/* Tres hechos, no tres reclamos: lo que el catálogo declara. */}
          <Stack direction="row" sx={{ gap: { xs: 1.5, md: 3 }, flexWrap: 'wrap', pt: 0.5 }}>
            {hechos.map(({ icon: Icono, text }) => (
              <Stack key={text} direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 26,
                    height: 26,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    bgcolor: 'var(--accent-soft)',
                    color: 'var(--accent-deep)',
                  }}
                >
                  <Icono sx={{ fontSize: 14 }} />
                </Box>
                <Typography sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--muted)' }}>
                  {text}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>

        {/* 2 · Cómo es */}
        <Box
          sx={{
            position: 'relative',
            width: { xs: 200, md: 260 },
            flexShrink: 0,
            // El disco de detrás es lo que hace que una foto sobre blanco no
            // flote sin apoyo en medio del panel.
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: '8%',
              borderRadius: '50%',
              bgcolor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            },
          }}
        >
          <Box
            sx={{
              position: 'relative',
              p: 1.5,
              // `ProductMedia` trae su propio fondo neutro, que aquí tapaba el
              // disco de acento y devolvía la caja gris que se venía a quitar.
              '& > div': { bgcolor: 'transparent' },
            }}
          >
            <ProductMedia url={imagen} alt={product.primary_image_alt ?? product.name} fit="contain" />
          </Box>
        </Box>

        {/* 3 · Cuánto cuesta */}
        <Stack sx={{ gap: 1, alignItems: { xs: 'flex-start', md: 'center' }, flexShrink: 0 }}>
          {descuento !== null ? (
            <Box
              sx={{
                width: 68,
                height: 68,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: 'var(--accent-deep)',
                color: '#FFFFFF',
                fontSize: 19,
                fontWeight: 900,
                letterSpacing: '-0.02em',
                boxShadow: '0 10px 24px -12px rgba(0,0,0,.45)',
              }}
            >
              {`-${descuento}%`}
            </Box>
          ) : null}

          {product.compare_at_price ? (
            <Typography
              component="s"
              className="tnum"
              sx={{ fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}
            >
              {formatMoney(Number(product.compare_at_price), product.currency, locale)}
            </Typography>
          ) : null}

          <Typography
            className="tnum"
            sx={{ fontSize: { xs: 28, md: 34 }, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1 }}
          >
            {formatMoney(Number(product.price), product.currency, locale)}
          </Typography>

          <Button
            component={Link}
            to={`/s/${storeSlug}/product/${product.slug}`}
            variant="contained"
            sx={{
              mt: 0.5,
              textTransform: 'none',
              fontWeight: 800,
              borderRadius: 'var(--sf-pill)',
              px: 3,
              py: 1,
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' },
            }}
          >
            {t('store.hero.buyNow')}
          </Button>
        </Stack>
      </Stack>

      {total > 1 ? (
        <>
          <Flecha lado="left" label={t('store.promos.prev')} onClick={() => ir(actual - 1)} />
          <Flecha lado="right" label={t('store.promos.next')} onClick={() => ir(actual + 1)} />

          <Stack
            direction="row"
            sx={{ gap: 0.75, justifyContent: 'center', pb: 1.5, position: 'relative' }}
          >
            {products.map((item, index) => (
              <Box
                key={item.product_id}
                component="button"
                type="button"
                aria-label={t('store.promos.goTo').replace('{name}', item.name)}
                aria-current={index === actual ? 'true' : undefined}
                onClick={() => ir(index)}
                sx={{
                  border: 0,
                  p: 0,
                  cursor: 'pointer',
                  height: 6,
                  width: index === actual ? 22 : 6,
                  borderRadius: 999,
                  bgcolor: index === actual ? 'var(--accent-deep)' : 'var(--sf-line-strong)',
                  transition: 'width .2s ease',
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}
              />
            ))}
          </Stack>
        </>
      ) : null}
    </Box>
  )
}

function Flecha({
  lado,
  label,
  onClick,
}: {
  lado: 'left' | 'right'
  label: string
  onClick: () => void
}) {
  return (
    <IconButton
      aria-label={label}
      onClick={onClick}
      sx={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        [lado]: 8,
        display: { xs: 'none', sm: 'inline-flex' },
        bgcolor: 'var(--card)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
        '&:hover': { bgcolor: 'var(--card)' },
      }}
    >
      {lado === 'left' ? (
        <ChevronLeftRoundedIcon fontSize="small" />
      ) : (
        <ChevronRightRoundedIcon fontSize="small" />
      )}
    </IconButton>
  )
}
