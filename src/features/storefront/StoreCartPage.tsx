import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import { Alert, Box, Button, Card, Chip, Divider, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { CartLineList } from './cart/CartLineList'
import { useCart } from './cart/cart-context'
import { useQuotedCart } from './cart/useQuotedCart'
import { useStorefront } from './hooks'
import { privateMeta } from './seo'

/**
 * Carrito a página completa: revisar con calma lo que el panel lateral enseña
 * de pasada. Las líneas son el mismo componente, así que sumar, restar y quitar
 * se comportan igual en los dos sitios.
 *
 * El resumen **le pregunta el total al servidor** (P04-SaaS). Hasta aquí sumaba
 * los precios guardados en el carrito, que son de escaparate; con listas por
 * canal y escalas por cantidad, ese subtotal puede no ser lo que se cobra —y un
 * carrito que dice 100 y cobra 92 es tan malo como el que dice 92 y cobra 100—.
 * Si la cotización falla, se enseña el subtotal local y se avisa: no poder
 * adelantar el total no es motivo para impedir la compra.
 */
export function StoreCartPage() {
  const { t, locale } = useI18n()
  const { store, storeSlug } = useStorefront()
  const { cart, count, subtotal, currency } = useCart()

  // Carrito, checkout, cuenta y seguimiento NO se indexan (P15-SaaS). No es
  // pudor: son estado de una sesión, no contenido, y el seguimiento además
  // lleva el token del pedido en la URL. `robots.txt` pide que no se rastreen;
  // esto impide que se indexen si alguien las enlaza desde fuera.
  useDocumentMeta(
    privateMeta({ store, storeSlug, locale, pathname: `/s/${storeSlug}` }, t('store.cart.title'), '/cart'),
  )

  const { quote, quoted, discounted } = useQuotedCart(storeSlug)

  if (cart.lines.length === 0) {
    return (
      <>
        <PageHeader title={t('store.cart.title')} />
        <Card>
          <EmptyState
            title={t('store.cart.empty')}
            description={t('store.cart.emptyBody')}
            icon={<ShoppingCartRoundedIcon fontSize="small" />}
            action={
              <Button component={Link} to={`/s/${storeSlug}`} variant="contained">
                {t('store.cart.continue')}
              </Button>
            }
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('store.cart.title')}
        subtitle={`${count} ${count === 1 ? t('store.cart.unit') : t('store.cart.units')}`}
      />

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 3 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        <Card sx={{ p: { xs: 1.5, md: 2.5 } }}>
          <CartLineList cart={cart} storeSlug={storeSlug} quoted={quoted} />
        </Card>

        <Card sx={{ p: { xs: 1.5, md: 2.5 } }}>
          <Typography component="h2" sx={{ fontSize: TS.cardTitle, fontWeight: 800, mb: 1.5 }}>
            {t('store.cart.summary')}
          </Typography>

          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography sx={{ fontWeight: 700 }}>{t('store.cart.subtotal')}</Typography>
            <Typography sx={{ fontWeight: 800 }}>
              {formatMoney(
                Number(quoted?.netTotal ?? subtotal),
                quoted?.currency ?? currency,
                locale,
              )}
            </Typography>
          </Stack>

          {/* Impuesto y total tienen su ALTO RESERVADO desde el primer pintado
              (P15-SaaS). Hasta P14 las dos filas nacían al llegar la
              cotización y empujaban hacia abajo el separador y los dos
              botones: quien ya tenía el dedo sobre «Finalizar compra» acababa
              pulsando «Seguir comprando». Reservar 56 px cuesta un hueco gris
              medio segundo; no reservarlos cuesta un pedido. */}
          <Box sx={{ minHeight: 56 }}>
            {quoted && Number(quoted.taxTotal) > 0 && (
              <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
                <Typography sx={{ color: 'var(--muted)' }}>{t('store.cart.tax')}</Typography>
                <Typography sx={{ color: 'var(--muted)' }}>
                  {formatMoney(Number(quoted.taxTotal), quoted.currency, locale)}
                </Typography>
              </Stack>
            )}

            {quoted && (
              <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
                <Typography sx={{ fontWeight: 800 }}>{t('store.cart.total')}</Typography>
                <Typography sx={{ fontWeight: 800 }}>
                  {formatMoney(Number(quoted.grossTotal), quoted.currency, locale)}
                </Typography>
              </Stack>
            )}
          </Box>

          {discounted && (
            <Chip size="small" color="success" label={t('store.cart.listPrice')} sx={{ mt: 1 }} />
          )}

          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.5 }}>
            {quote.isPending
              ? t('store.cart.quoting')
              : quoted
                ? t('store.cart.quoted')
                : t('store.cart.taxNote')}
          </Typography>

          {quote.isError && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {t('store.cart.quoteFailed')}
            </Alert>
          )}

          <Divider sx={{ my: 2 }} />
          <Stack sx={{ gap: 1 }}>
            <Button component={Link} to={`/s/${storeSlug}/checkout`} variant="contained" fullWidth>
              {t('store.cart.checkout')}
            </Button>
            <Button component={Link} to={`/s/${storeSlug}`} fullWidth>
              {t('store.cart.continue')}
            </Button>
          </Stack>
        </Card>
      </Box>
    </>
  )
}
