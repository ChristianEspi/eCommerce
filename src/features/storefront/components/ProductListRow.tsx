import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { track } from '../analytics'
import { useAddToCart } from '../cart/useAddToCart'
import type { CommercialPrice } from '../commerce/catalogPrices'
import { discountPercent, type PublicProduct } from '../types'
import { B2BProductMeta } from './B2BProductMeta'
import { ProductMedia } from './ProductMedia'
import { QuantityStepper } from './QuantityStepper'
import { useStorefrontTheme } from '../theme/useStorefrontTheme'

/**
 * Una fila de la vista de LISTA del catálogo.
 *
 * Es la forma en que compra quien ya sabe lo que busca: una empresa que repone
 * treinta referencias no necesita la foto grande, necesita ver en una línea el
 * nombre, el precio que le toca, si hay stock, y poner la cantidad. La rejilla
 * vende; la lista despacha.
 *
 * Mismas reglas que la tarjeta, sin excepción:
 *  - el corazón siempre, con el producto dentro del nombre accesible;
 *  - con precio comercial la cifra grande es la suya y la pública se tacha; sin
 *    él, una oferta tacha el precio de antes;
 *  - agotado se apaga y el botón no compra.
 */
export function ProductListRow({
  product,
  storeSlug,
  imageUrl = null,
  favorite = false,
  onToggleFavorite,
  onQuickView,
  onPrefetch,
  commercialPrice = null,
  b2b = false,
  purchased = false,
}: {
  product: PublicProduct
  storeSlug: string
  imageUrl?: string | null
  favorite?: boolean
  onToggleFavorite?: (productId: string) => void
  onQuickView?: (slug: string) => void
  onPrefetch?: (slug: string) => void
  commercialPrice?: CommercialPrice | null
  b2b?: boolean
  /** Resumen v2 · Su empresa ya lo pidió en esta tienda. Solo se pinta con `b2b`. */
  purchased?: boolean
}) {
  const { t, locale } = useI18n()
  const { agregar, pending } = useAddToCart()
  const [cantidad, setCantidad] = useState(1)
  // Catálogo (lámina B2B, 2026-10-19): la lista es una TABLA de pedido y toda
  // fila pide cantidad, haya o no sesión de empresa.
  const { preset } = useStorefrontTheme()
  const pideCantidad = b2b || preset === 'catalog'
  const discount = discountPercent(product)
  const available = product.in_stock !== false
  const hasVariants = product.kind === 'variant'
  const textoStock = available ? t('store.availability.inStock') : t('store.availability.outOfStock')
  const to = `/s/${storeSlug}/product/${product.slug}`
  const precio = commercialPrice ? commercialPrice.amount : Number(product.price)
  const tachado = commercialPrice
    ? Number(product.price)
    : discount !== null && product.compare_at_price
      ? Number(product.compare_at_price)
      : null

  return (
    <Stack
      component="li"
      direction="row"
      data-list-row={product.product_id}
      onMouseEnter={() => onPrefetch?.(product.slug)}
      sx={{
        position: 'relative',
        alignItems: 'center',
        gap: { xs: 1.25, md: 2 },
        px: { xs: 1.25, md: 2 },
        py: 1.25,
        borderBottom: '1px solid var(--sf-line)',
        '&:last-of-type': { borderBottom: 'none' },
        '&:has(a:focus-visible)': { outline: '2px solid var(--accent)', outlineOffset: -2 },
      }}
    >
      <Box
        className="sf-row-media"
        sx={{
          position: 'relative',
          width: { xs: 56, md: 64 },
          flexShrink: 0,
          borderRadius: 'var(--sf-radius-sm)',
          overflow: 'hidden',
          bgcolor: 'var(--sf-media-bg, var(--neutral-soft))',
          ...(available ? {} : { '& img': { filter: 'grayscale(1)', opacity: 0.5 } }),
        }}
      >
        <ProductMedia url={imageUrl} alt={product.primary_image_alt ?? product.name} fit="contain" ratio="1 / 1" />
        {discount !== null && !commercialPrice ? (
          <Box
            sx={{
              position: 'absolute',
              top: 3,
              left: 3,
              px: 0.5,
              borderRadius: 'var(--sf-pill)',
              bgcolor: 'var(--accent-deep)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            -{discount}%
          </Box>
        ) : null}
      </Box>

      <Stack className="sf-row-info" sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
        {product.brand_name || product.category_name ? (
          <Typography
            className="sf-row-brand"
            sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}
            noWrap
          >
            {product.brand_name ?? product.category_name}
          </Typography>
        ) : null}
        <Typography component="h3" sx={{ fontSize: TS.body, fontWeight: 700, lineHeight: 1.3 }}>
          <Box
            component={Link}
            to={to}
            onClick={(event: React.MouseEvent) => {
              if (!onQuickView || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              onQuickView(product.slug)
            }}
            sx={{
              color: 'inherit',
              textDecoration: 'none',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              '&:hover': { color: 'var(--accent-deep)' },
              '&:focus-visible': { outline: 'none' },
            }}
          >
            {product.name}
          </Box>
        </Typography>
        {b2b ? <B2BProductMeta sku={product.sku} purchased={purchased} /> : null}
        {/* Rediseño v3 · el SKU en la fila técnica. Oculto por defecto: lo
            enciende el estilo catálogo (storefront.css), que vende por código.
            En B2B ya lo pinta `B2BProductMeta`. */}
        {!b2b && product.sku ? (
          <Typography
            component="span"
            className="sf-row-sku"
            sx={{ display: 'none', fontSize: 11, fontWeight: 600, color: 'var(--muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          >
            {product.sku}
          </Typography>
        ) : null}
        <Typography
          data-stock={available ? 'in' : 'out'}
          className="sf-row-stock-inline"
          sx={{ fontSize: 11.5, fontWeight: 700, color: available ? 'var(--sf-ok, var(--accent-deep))' : 'var(--muted)' }}
        >
          {textoStock}
        </Typography>
      </Stack>

      {/* La disponibilidad en SU columna: solo la enciende el estilo que pinta
          la lista como tabla (catálogo). Oculta, no está en el árbol accesible,
          así que no se anuncia dos veces. */}
      <Typography
        className="sf-row-stock"
        sx={{ display: 'none', fontSize: 13, fontWeight: 700, color: available ? 'var(--sf-ok, var(--accent-deep))' : 'var(--muted)' }}
      >
        {textoStock}
      </Typography>

      <Stack className="sf-row-price" sx={{ alignItems: 'flex-end', flexShrink: 0, minWidth: { xs: 84, md: 120 } }}>
        {tachado !== null ? (
          <Typography component="s" className="tnum" sx={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            {formatMoney(tachado, product.currency, locale)}
          </Typography>
        ) : null}
        <Typography
          className="tnum"
          sx={{
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: tachado !== null ? 'var(--accent-deep)' : 'var(--text)',
          }}
        >
          {formatMoney(precio, product.currency, locale)}
        </Typography>
        {commercialPrice ? (
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-deep)' }}>
            {commercialPrice.label === 'enterprise' ? t('store.product.agreementPriceCard') : t('store.product.tradePriceCard')}
          </Typography>
        ) : null}
      </Stack>

      <Stack direction="row" className="sf-row-actions" sx={{ alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
        {onToggleFavorite ? (
          <IconButton
            size="small"
            aria-pressed={favorite}
            aria-label={`${favorite ? t('store.favorite.remove') : t('store.favorite.add')}: ${product.name}`}
            title={favorite ? t('store.favorite.remove') : t('store.favorite.add')}
            onClick={() => onToggleFavorite(product.product_id)}
            sx={{
              border: '1px solid var(--sf-line)',
              borderRadius: 'var(--sf-radius-sm)',
              color: favorite ? 'var(--sf-heart)' : 'var(--muted)',
            }}
          >
            {favorite ? <FavoriteRoundedIcon sx={{ fontSize: 18 }} /> : <FavoriteBorderRoundedIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        ) : null}
        {pideCantidad && available && !hasVariants ? (
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <QuantityStepper value={cantidad} onChange={setCantidad} size="sm" disabled={pending} />
          </Box>
        ) : null}
        <Button
          variant={available ? 'contained' : 'outlined'}
          size="small"
          disabled={!available || pending}
          onClick={() => {
            if (hasVariants) {
              onQuickView?.(product.slug)
              return
            }
            void agregar(product, cantidad, null).then((ok) => {
              if (ok) setCantidad(1)
            })
            track(storeSlug, { type: 'add_to_cart', product_id: product.product_id, quantity: cantidad })
          }}
          aria-label={`${hasVariants ? t('store.product.chooseOptions') : t('store.product.addToCart')}: ${product.name}`}
          sx={{ minWidth: 0, px: 1.25, boxShadow: 'none', borderRadius: 'var(--sf-radius-sm)', textTransform: 'none', fontWeight: 700 }}
        >
          {hasVariants ? (
            <TuneRoundedIcon fontSize="small" />
          ) : pending ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            <ShoppingCartRoundedIcon fontSize="small" />
          )}
          {/* «Agregar» con letra: lo enciende el estilo que tiene sitio (catálogo). */}
          <Box component="span" aria-hidden className="sf-row-add-label" sx={{ display: 'none', ml: 0.75 }}>
            {hasVariants ? t('store.list.choose') : t('store.list.add')}
          </Box>
        </Button>
      </Stack>
    </Stack>
  )
}
