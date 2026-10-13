import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { useAddToCart } from '../cart/useAddToCart'
import type { ProductDetail, StoreStock } from '../productDetail'
import type { PublicProduct, PublicVariant } from '../types'

/**
 * Los bloques de la ficha completa (lámina de ficha universal, 2026-10-13).
 *
 * Cada uno se calla si no tiene dato: un recuadro de «Disponibilidad en
 * tiendas» vacío diría que no hay tiendas, y un «Gratis desde —» promete algo
 * que el comercio no configuró. Ninguno inventa texto.
 */

/** Lo destacado del producto, bajo la galería, con un ✓ por frase. */
export function ProductHighlights({ items }: { items: readonly string[] }) {
  const { t } = useI18n()
  if (items.length === 0) return null
  return (
    <Stack
      component="ul"
      aria-label={t('store.product.highlights')}
      data-pdp-highlights
      sx={{ listStyle: 'none', m: 0, mt: 2, p: 0, gap: 0.75 }}
    >
      {items.map((texto) => (
        <Stack key={texto} component="li" direction="row" sx={{ gap: 1, alignItems: 'flex-start' }}>
          <CheckRoundedIcon aria-hidden sx={{ fontSize: 17, mt: '2px', color: 'var(--sf-buy-deep, var(--accent-deep))' }} />
          <Typography sx={{ fontSize: TS.body, color: 'var(--text)' }}>{texto}</Typography>
        </Stack>
      ))}
    </Stack>
  )
}

/** «o 3 cuotas de S/ 7.30 sin intereses con Tarjeta Andes». */
export function InstallmentLine({
  plan,
  currency,
}: {
  plan: { count: number; amount: number; provider: string | null } | null
  currency: string
}) {
  const { t, locale } = useI18n()
  if (!plan) return null
  return (
    <Typography data-pdp-installments sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
      {t('store.product.installments')
        .replace('{count}', String(plan.count))
        .replace('{amount}', formatMoney(plan.amount, currency, locale))}
      {plan.provider ? (
        <>
          {' '}
          {t('store.product.installmentsWith').replace('{provider}', '')}
          <Box component="strong" sx={{ color: 'var(--text)' }}>
            {plan.provider}
          </Box>
        </>
      ) : null}
    </Typography>
  )
}

function FilaDeEntrega({
  icon,
  title,
  badge,
  detail,
}: {
  icon: ReactNode
  title: string
  badge: string | null
  detail: string | null
}) {
  return (
    <Stack direction="row" sx={{ gap: 1.25, py: 1.25, '& + &': { borderTop: '1px solid var(--sf-line)' } }}>
      <Box aria-hidden sx={{ color: 'var(--accent-deep)', display: 'grid', pt: '1px' }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{title}</Typography>
          {badge ? (
            <Typography sx={{ fontSize: TS.label, fontWeight: 800, color: 'var(--sf-buy-deep, var(--accent-deep))' }}>
              {badge}
            </Typography>
          ) : null}
        </Stack>
        {detail ? <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{detail}</Typography> : null}
      </Box>
    </Stack>
  )
}

const ESTADO_COLOR: Record<StoreStock['status'], string> = {
  available: 'var(--sf-buy-deep, var(--accent-deep))',
  low: 'var(--danger, #b3261e)',
  out: 'var(--muted)',
}

/** Las tiendas físicas con su ESTADO (nunca cantidades: ver la migración). */
export function StoreAvailability({ stores }: { stores: readonly StoreStock[] }) {
  const { t } = useI18n()
  if (stores.length === 0) return null
  return (
    <Box data-pdp-stores>
      <Typography component="h2" sx={{ fontSize: TS.body, fontWeight: 800, mb: 0.75 }}>
        {t('store.product.stores.title')}
      </Typography>
      <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 0.5 }}>
        {stores.map((tienda) => (
          <Stack
            key={tienda.name}
            component="li"
            direction="row"
            sx={{ justifyContent: 'space-between', gap: 1.5, fontSize: TS.label }}
          >
            <Typography sx={{ fontSize: 'inherit', color: 'var(--text)', minWidth: 0 }}>
              {tienda.name}
            </Typography>
            <Typography sx={{ fontSize: 'inherit', fontWeight: 800, color: ESTADO_COLOR[tienda.status], flexShrink: 0 }}>
              {t(`store.product.stores.${tienda.status}`)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

/**
 * La columna de la derecha de la ficha universal: entrega, tiendas, quién
 * vende y, si el comercio tiene umbral de gratuidad, la tarjeta de envío gratis.
 */
export function DeliveryAside({
  detail,
  currency,
  storeName,
}: {
  detail: ProductDetail | null | undefined
  currency: string
  storeName: string
}) {
  const { t, locale } = useI18n()
  const ship = detail?.delivery.ship ?? null
  const pickup = detail?.delivery.pickup ?? null
  const freeOver = ship?.free_over ?? null
  const tarjeta = {
    p: 2,
    border: '1px solid var(--sf-line)',
    borderRadius: 'var(--sf-radius)',
    bgcolor: 'var(--card)',
  } as const

  const plazo =
    ship && ship.max_days !== null
      ? ship.max_days <= 1
        ? t('store.product.delivery.oneDay')
        : t('store.product.delivery.days')
            .replace('{min}', String(Math.max(ship.min_days ?? 1, 1)))
            .replace('{max}', String(ship.max_days))
      : null
  const listo =
    pickup && pickup.min_days !== null
      ? pickup.min_days <= 0
        ? t('store.product.delivery.pickupToday')
        : t('store.product.delivery.pickupDays').replace('{n}', String(pickup.min_days))
      : null
  const puntos =
    pickup && pickup.points > 0
      ? pickup.points === 1
        ? t('store.product.delivery.pickupPointsOne')
        : t('store.product.delivery.pickupPoints').replace('{count}', String(pickup.points))
      : null

  return (
    <Stack className="sf-pdp-aside" sx={{ gap: 2 }}>
      {ship || pickup || (detail?.stores.length ?? 0) > 0 ? (
        <Box sx={tarjeta}>
          {ship || pickup ? (
            <Box role="group" aria-label={t('store.product.delivery.title')}>
              {ship ? (
                <FilaDeEntrega
                  icon={<LocalShippingOutlinedIcon sx={{ fontSize: 20 }} />}
                  title={t('store.product.delivery.home')}
                  badge={
                    freeOver !== null
                      ? t('store.product.delivery.freeOver').replace('{amount}', formatMoney(freeOver, currency, locale))
                      : null
                  }
                  detail={plazo}
                />
              ) : null}
              {pickup ? (
                <FilaDeEntrega
                  icon={<StorefrontOutlinedIcon sx={{ fontSize: 20 }} />}
                  title={t('store.product.delivery.pickup')}
                  badge={t('store.product.delivery.free')}
                  detail={[listo, puntos].filter(Boolean).join(' ') || null}
                />
              ) : null}
            </Box>
          ) : null}
          {detail && detail.stores.length > 0 ? (
            <Box sx={{ pt: ship || pickup ? 1.5 : 0, mt: ship || pickup ? 0.5 : 0, borderTop: ship || pickup ? '1px solid var(--sf-line)' : 0 }}>
              <StoreAvailability stores={detail.stores} />
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Stack direction="row" sx={{ ...tarjeta, gap: 1, alignItems: 'center' }}>
        <VerifiedUserOutlinedIcon aria-hidden sx={{ fontSize: 18, color: 'var(--muted)' }} />
        <Typography className="sf-pdp-soldby" sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {t('store.product.soldBy').replace('{name}', storeName)}
        </Typography>
      </Stack>

      {freeOver !== null ? (
        <Box
          data-pdp-free-shipping
          sx={{
            p: 2.5,
            borderRadius: 'var(--sf-radius)',
            bgcolor: 'color-mix(in srgb, var(--sf-buy, var(--accent)) 14%, var(--card))',
          }}
        >
          <Typography
            sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sf-buy-deep, var(--accent-deep))' }}
          >
            {t('store.product.freeShipping.kicker')}
          </Typography>
          <Typography sx={{ mt: 1, fontSize: 18, fontWeight: 800, lineHeight: 1.25 }}>
            {t('store.product.freeShipping.body').replace('{amount}', formatMoney(freeOver, currency, locale))}
          </Typography>
        </Box>
      ) : null}
    </Stack>
  )
}

/**
 * «Frecuentemente comprados juntos»: el producto abierto y hasta dos que el
 * comercio curó como complemento (`cross_sell`/`accessory`/`spare_part`).
 *
 * Solo entran complementos SIN variantes y con stock: «Agregar los 3» no puede
 * preguntar talla a mitad de camino. El total es el de escaparate; el que se
 * cobra lo recalcula el carrito, como siempre.
 */
export function FrequentlyBoughtTogether({
  product,
  variant,
  complements,
  thumbnails,
  storeSlug,
  canBuy,
}: {
  product: PublicProduct
  variant: PublicVariant | null
  complements: readonly PublicProduct[]
  thumbnails: Record<string, string>
  storeSlug: string
  canBuy: boolean
}) {
  const { t, locale } = useI18n()
  const { agregar, pending } = useAddToCart()
  const otros = complements.filter((item) => item.kind !== 'variant' && item.in_stock !== false).slice(0, 2)
  if (otros.length === 0 || !canBuy) return null

  const precioPrincipal = Number(variant ? variant.price : product.price)
  const piezas = [
    { item: product, price: precioPrincipal, name: variant ? `${product.name} · ${variant.name}` : product.name },
    ...otros.map((item) => ({ item, price: Number(item.price), name: item.name })),
  ]
  const total = piezas.reduce((suma, pieza) => suma + pieza.price, 0)
  const cuantos = String(piezas.length)

  async function agregarTodos() {
    await agregar(product, 1, variant)
    for (const otro of otros) await agregar(otro, 1, null)
  }

  return (
    <Box component="section" aria-labelledby="sf-pdp-together" data-pdp-together>
      <Typography id="sf-pdp-together" component="h2" sx={{ fontSize: { xs: 20, md: 22 }, fontWeight: 800, mb: 1.5 }}>
        {t('store.product.together.title')}
      </Typography>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{
          gap: 2,
          alignItems: { md: 'center' },
          p: 2,
          border: '1px solid var(--sf-line)',
          borderRadius: 'var(--sf-radius)',
          bgcolor: 'var(--card)',
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ flex: 1, gap: 1.5, alignItems: { sm: 'center' }, minWidth: 0 }}>
          {piezas.map((pieza, index) => (
            <Stack key={pieza.item.product_id} direction="row" sx={{ alignItems: 'center', gap: 1.5, flex: { sm: 1 }, minWidth: 0 }}>
              {index > 0 ? (
                <AddRoundedIcon aria-hidden sx={{ color: 'var(--muted)', display: { xs: 'none', sm: 'block' } }} />
              ) : null}
              <Box
                component={index === 0 ? 'div' : Link}
                {...(index === 0 ? {} : { to: `/s/${storeSlug}/product/${pieza.item.slug}` })}
                sx={{
                  width: 64,
                  height: 64,
                  flexShrink: 0,
                  borderRadius: 'var(--sf-radius-sm)',
                  bgcolor: 'var(--neutral-soft)',
                  overflow: 'hidden',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {thumbnails[pieza.item.product_id] ? (
                  <Box
                    component="img"
                    src={thumbnails[pieza.item.product_id]}
                    alt=""
                    loading="lazy"
                    sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : null}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{ fontSize: TS.label, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                >
                  {pieza.name}
                </Typography>
                <Typography sx={{ fontSize: TS.label, fontWeight: 800 }}>
                  {formatMoney(pieza.price, product.currency, locale)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
        <Stack sx={{ gap: 1, alignItems: { xs: 'stretch', md: 'flex-end' }, flexShrink: 0 }}>
          <Typography sx={{ fontSize: TS.body }}>
            {t('store.product.together.total').replace('{count}', cuantos)}{' '}
            <Box component="strong" sx={{ fontSize: 18 }}>
              {formatMoney(total, product.currency, locale)}
            </Box>
          </Typography>
          <Button
            variant="contained"
            className="sf-pdp-buy"
            disabled={pending}
            onClick={() => void agregarTodos()}
            startIcon={pending ? <CircularProgress size={16} color="inherit" /> : <ShoppingCartRoundedIcon />}
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 700 }}
          >
            {t('store.product.together.add').replace('{count}', cuantos)}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
