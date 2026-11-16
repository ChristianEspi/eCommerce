import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import { Alert, Box, Button, Card, Chip, Drawer, IconButton, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { EmptyState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { useSessionContext } from '@/features/auth/session-context'
import { BuyerTermsNotice } from '../commerce/BuyerTermsNotice'
import { useAssortmentBlocked } from '../commerce/assortment'
import { useCommerceContext } from '../commerce/context'
import { CartLineList } from './CartLineList'
import { RequestQuoteButton } from './RequestQuoteButton'
import { ScheduleCartButton } from './ScheduleCartButton'
import { useCart } from './cart-context'
import { themeDataAttributes } from '../theme/theme-context'
import { useStorefrontTheme } from '../theme/useStorefrontTheme'
import { useQuotedCart } from './useQuotedCart'

/**
 * Panel lateral del carrito: el mismo carrito que la página, y por tanto el
 * mismo precio.
 *
 * Cotiza contra el servidor igual que `/cart`. No es un lujo: sin ello el panel
 * sumaba los precios de escaparate y la página los del acuerdo, así que un
 * comprador con convenio veía «S/ 79.60» aquí y «S/ 71.64» un clic después. La
 * consulta es la misma —misma clave, misma caché—, así que enseñarlo bien no
 * cuesta una llamada de más.
 */
export function CartDrawer({ storeSlug }: { storeSlug: string }) {
  const { t, locale } = useI18n()
  const { cart, count, subtotal, currency, isOpen, closeCart } = useCart()
  const { quoted, discounted } = useQuotedCart(storeSlug)
  const empty = cart.lines.length === 0
  // 2026-11-16 · Con líneas fuera del surtido de la empresa no se pasa a pagar.
  const fueraDeSurtido = useAssortmentBlocked(storeSlug, cart.lines.map((l) => l.product_id)).size > 0
  // La cuenta con la que se compra, arriba: en B2B el total depende de ella.
  const { status } = useSessionContext()
  const { context } = useCommerceContext(storeSlug, status === 'authenticated')
  const moneda = quoted?.currency ?? currency
  const total = quoted?.grossTotal ?? null
  // Rediseño v3 · El cajón vive en un portal, FUERA de la vitrina: sin la
  // frontera del tema no recibe ni los neutros ni la voz del estilo.
  const tema = useStorefrontTheme()
  const compacto = tema.preset === 'retail'

  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={closeCart}
      slotProps={{
        paper: {
          className: 'sf-scope',
          ...themeDataAttributes(tema),
          'data-cart-drawer': 'true',
          // Retail: 440 px, como su lámina; el resto, los 400 de siempre.
          sx: { width: { xs: '100%', sm: tema.preset === 'retail' ? 440 : 400 }, bgcolor: 'var(--card)' },
        } as object,
      }}
      aria-label={t('store.cart.title')}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: 1.5,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Typography component="h2" className="sf-drawer-title" sx={{ fontSize: 16, fontWeight: 800 }}>
            {t('store.cart.title')}
            {count > 0 && (
              <Box component="span" sx={{ color: 'var(--muted)', fontWeight: 700 }}>
                {' '}
                ({count})
              </Box>
            )}
          </Typography>
          <IconButton onClick={closeCart} aria-label={t('common.cancel')} size="small">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        {context && !empty ? (
          <Stack
            direction="row"
            data-cart-account
            sx={{
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              bgcolor: 'color-mix(in srgb, var(--accent) 7%, var(--card))',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <ApartmentRoundedIcon aria-hidden sx={{ fontSize: 17, color: 'var(--accent-deep)' }} />
            <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: TS.label, fontWeight: 800 }}>
              {context.account_name}
            </Typography>
            {context.has_commercial_pricing ? (
              <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <VerifiedRoundedIcon aria-hidden sx={{ fontSize: 15, color: 'var(--accent-deep)' }} />
                <Typography sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--accent-deep)' }}>
                  {t('store.cart.agreementActive')}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {/* `--bg` y no `--card`: la zona de las líneas se hunde un tono y las
            líneas se ven sobre ella, en vez de flotar en un panel blanco donde
            un carrito de un solo producto parece medio vacío. */}
        <Box className="sf-drawer-body" sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, bgcolor: 'var(--bg)' }}>
          {empty ? (
            <EmptyState
              title={t('store.cart.empty')}
              description={t('store.cart.emptyBody')}
              icon={<ShoppingCartRoundedIcon fontSize="small" />}
            />
          ) : (
            <Card className="sf-drawer-lines" sx={{ p: 1.5 }}>
              <CartLineList
                cart={cart}
                storeSlug={storeSlug}
                onNavigate={closeCart}
                compact
                quoted={quoted}
              />
            </Card>
          )}
        </Box>

        {!empty && (
          /* El pie se ancla abajo con su propia sombra: sin ella, con una sola
             línea, el subtotal y el botón quedaban colgando al final de un
             hueco y no se leían como el cierre del panel. */
          <Box
            className="sf-drawer-foot"
            sx={{
              px: 2,
              py: 2,
              bgcolor: 'var(--card)',
              borderTop: '1px solid var(--border)',
              boxShadow: '0 -8px 20px -18px rgba(0,0,0,0.45)',
            }}
          >
            {compacto ? (
              /* Rediseño v3 · Retail: el resumen COMPACTO. El total manda y el
                 desglose va en una sola línea pequeña debajo; el completo sigue
                 en la bolsa grande. Nada se oculta: se dice más corto. */
              <Stack sx={{ gap: 0.25, mb: 1 }} data-cart-total>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: TS.bodyStrong }}>
                    {quoted ? t('store.cart.total') : t('store.cart.subtotal')}
                  </Typography>
                  <Typography className="tnum sf-drawer-total" sx={{ fontWeight: 800, fontSize: 22 }}>
                    {formatMoney(
                      Number(quoted ? quoted.grossTotal : subtotal),
                      moneda,
                      locale,
                    )}
                  </Typography>
                </Stack>
                <Typography className="tnum" sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {[
                    quoted
                      ? `${t('store.cart.subtotal')} ${formatMoney(Number(quoted.netTotal), moneda, locale)}`
                      : null,
                    quoted && Number(quoted.discountTotal) > 0
                      ? `${t('store.cart.discount')} − ${formatMoney(Number(quoted.discountTotal), moneda, locale)}`
                      : null,
                    quoted ? `${t('store.cart.tax')} ${formatMoney(Number(quoted.taxTotal), moneda, locale)}` : null,
                    quoted ? t('store.cart.shippingNote') : t('store.cart.taxNote'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Stack>
            ) : (
            <>
            <Stack
              direction="row"
              sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: TS.bodyStrong }}>
                {t('store.cart.subtotal')}
              </Typography>
              <Typography className="tnum sf-drawer-subtotal" sx={{ fontWeight: 800, fontSize: 20 }}>
                {formatMoney(
                  Number(quoted?.netTotal ?? subtotal),
                  quoted?.currency ?? currency,
                  locale,
                )}
              </Typography>
            </Stack>
            {quoted && Number(quoted.discountTotal) > 0 && (
              <Stack
                direction="row"
                sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}
              >
                <Typography sx={{ fontSize: TS.label, color: 'var(--accent-deep)', fontWeight: 700 }}>
                  {t('store.cart.discount')}
                </Typography>
                <Typography sx={{ fontSize: TS.label, color: 'var(--accent-deep)', fontWeight: 700 }}>
                  {`- ${formatMoney(Number(quoted.discountTotal), quoted.currency, locale)}`}
                </Typography>
              </Stack>
            )}
            {/* Que el precio es del acuerdo se dice AQUI y no solo en la
                página: es donde el comprador ve el número por primera vez. */}
            {discounted && (
              <Chip
                size="small"
                color="success"
                className="sf-drawer-special"
                label={t('store.cart.listPrice')}
                sx={{ mt: 1 }}
              />
            )}
            {/* Con la cotización del servidor el total YA es el de cobro —con su
                impuesto—, y se dice. Sin ella se avisa, como antes, de que el
                número final lo confirma la tienda. El envío se elige al pagar. */}
            {quoted ? (
              <>
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.cart.tax')}</Typography>
                  <Typography className="tnum" sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {formatMoney(Number(quoted.taxTotal), moneda, locale)}
                  </Typography>
                </Stack>
                <Stack
                  direction="row"
                  data-cart-total
                  sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2, mt: 0.75 }}
                >
                  <Typography sx={{ fontWeight: 800, fontSize: TS.bodyStrong }}>{t('store.cart.total')}</Typography>
                  <Typography className="tnum sf-drawer-total" sx={{ fontWeight: 800, fontSize: 22, color: 'var(--accent-deep)' }}>
                    {formatMoney(Number(quoted.grossTotal), moneda, locale)}
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.25, mb: 1.25 }}>
                  {t('store.cart.shippingNote')}
                </Typography>
              </>
            ) : (
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.5, mb: 1.75 }}>
                {t('store.cart.taxNote')}
              </Typography>
            )}
            </>
            )}
            <Box sx={{ mb: compacto ? 1 : 1.25 }} className="sf-drawer-terms">
              <BuyerTermsNotice storeSlug={storeSlug} total={total} currency={moneda} compact />
            </Box>
            {fueraDeSurtido && (
              <Alert severity="warning" sx={{ mb: 1 }} data-cart-assortment-blocked>
                {t('store.assortment.cartBlocked')}
              </Alert>
            )}
            <Stack sx={{ gap: 0.5 }} className="sf-drawer-actions">
              <Button
                component={Link}
                to={`/s/${storeSlug}/checkout`}
                variant="contained"
                size="large"
                onClick={closeCart}
                fullWidth
                disabled={fueraDeSurtido}
                className="sf-cart-checkout"
                sx={{ textTransform: 'none', fontWeight: 800 }}
              >
                {t('store.cart.checkout')}
              </Button>
              {/* Cotizar y programar también desde aquí: son el flujo B2B más
                  usado y exigían pasar por la página del carrito. Se callan
                  solos para quien no compra con cuenta de empresa. */}
              <Stack direction="row" className="sf-drawer-b2b" sx={{ gap: 1, '& > *': { flex: 1, minWidth: 0 } }}>
                <RequestQuoteButton storeSlug={storeSlug} lines={cart.lines} />
                <ScheduleCartButton storeSlug={storeSlug} lines={cart.lines} />
              </Stack>
              <Button
                component={Link}
                to={`/s/${storeSlug}/cart`}
                onClick={closeCart}
                fullWidth
                className="sf-drawer-view"
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {t('store.cart.view')}
              </Button>
            </Stack>
          </Box>
        )}
      </Stack>
    </Drawer>
  )
}
