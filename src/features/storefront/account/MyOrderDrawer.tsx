import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import { Box, Button, Drawer, IconButton, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useContext } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { useFeedback } from '@/shared/ui/feedback-context'
import { ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { addLinesToCart } from '../cart/addLinesToCart'
import { CartContext } from '../cart/cart-context'
import { consumerOrderDetailKey, fetchConsumerOrderDetail, formatSavedAddress } from '../consumer'
import { fetchMyOrderDetail, myOrderDetailKey } from '../portal'
import { EstadoChip } from './EstadoChip'

/** De quién son los pedidos que se enseñan: de la empresa o de la persona. */
export type OrdersSource = 'business' | 'consumer'

/**
 * El detalle de un pedido del portal del comprador.
 *
 * El listado dice QUÉ pasó con cada pedido —estado, cobro, total— y con eso se
 * resuelve la pregunta frecuente («¿ya salió?»). La que no se podía responder
 * era la otra: «¿qué pedí exactamente y por qué suma eso?». La respuesta
 * completa ya existía en el servidor (`my_business_order_detail` devuelve
 * líneas y desglose) y no la miraba nadie.
 *
 * Va en un panel lateral y no en una página propia por una razón concreta: se
 * consulta un pedido para compararlo con otro —lo que llegó contra lo que se
 * pidió— y un panel deja la lista detrás, así que cerrar y abrir el siguiente
 * no cuesta una navegación ni pierde el sitio en la tabla.
 *
 * ## `sf-scope` en el papel del panel, y no es un detalle
 *
 * Las variables de piel de la vitrina —radios, líneas, sombras— viven bajo
 * `.sf-scope`, que cuelga del layout. Un `Drawer` de MUI se monta en un PORTAL
 * colgado de `body`, o sea fuera de ese ámbito: sin la clase, cada
 * `var(--sf-line)` de aquí dentro resolvía a nada y el panel salía con el
 * aspecto por defecto de MUI en medio de una tienda que no lo usa.
 *
 * ## El desglose se pinta tal y como lo devuelve el servidor
 *
 * Ni una suma se rehace aquí: el total de un pedido es el que se cobró, y un
 * número recalculado en el navegador es una segunda verdad que puede discrepar.
 */
export function MyOrderDrawer({
  orderId,
  orderNumber,
  onClose,
  source = 'business',
  storeSlug = '',
  storeId = null,
}: {
  /** `null` cierra el panel. Es también la clave de la consulta. */
  orderId: string | null
  orderNumber: string | null
  onClose: () => void
  source?: OrdersSource
  storeSlug?: string
  storeId?: string | null
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const cart = useContext(CartContext)
  const consumer = source === 'consumer'
  const query = useQuery({
    queryKey: consumer ? consumerOrderDetailKey(storeSlug, orderId ?? '') : myOrderDetailKey(orderId ?? ''),
    queryFn: () =>
      consumer ? fetchConsumerOrderDetail(storeSlug, orderId as string) : fetchMyOrderDetail(orderId as string),
    enabled: orderId !== null,
  })

  const detail = query.data ?? null
  const money = (value: string) => formatMoney(Number(value), detail?.currency ?? 'PEN', locale)

  /**
   * Volver a comprar (H03).
   *
   * Manda al carrito QUÉ y CUÁNTO, nunca a cuánto: `addLinesToCart` vuelve a
   * leer cada producto del catálogo y el carrito lo recotiza con el servidor.
   * El precio del pedido viejo se queda en el pedido viejo. Solo se ofrece
   * cuando el detalle trae los productos y hay carrito y tienda a mano.
   */
  const reorderable = Boolean(
    cart && storeId && detail?.items.some((item) => typeof item.product_id === 'string' && item.product_id),
  )
  const reorder = useMutation({
    mutationFn: async () =>
      cart && storeId && detail ? addLinesToCart(cart, storeId, detail.items) : { added: 0, skipped: 0 },
    onSuccess: ({ added, skipped }) => {
      if (added === 0) {
        notify(t('account.orders.reorderNone'), 'warning')
        return
      }
      notify(
        skipped > 0
          ? t('account.orders.reorderPartial').replace('{added}', String(added)).replace('{skipped}', String(skipped))
          : t('account.orders.reorderDone'),
        skipped > 0 ? 'warning' : 'success',
      )
      onClose()
      cart?.openCart()
    },
    onError: () => notify(t('account.orders.reorderError'), 'error'),
  })

  const direccion =
    detail?.shipping_address && typeof detail.shipping_address.address === 'string'
      ? formatSavedAddress(detail.shipping_address as { address: string })
      : null
  const entrega = detail?.deliveries?.find((d) => d.method_name)?.method_name ?? null

  return (
    <Drawer
      anchor="right"
      open={orderId !== null}
      onClose={onClose}
      slotProps={{
        paper: {
          className: 'sf-scope',
          sx: {
            width: { xs: '100%', sm: 480 },
            bgcolor: 'var(--card)',
            backgroundImage: 'none',
            borderLeft: '1px solid var(--sf-line-strong)',
            // Columna: cabecera y totales fijos, y las líneas —lo único que
            // puede crecer— con su propio desplazamiento. Sin esto, un pedido
            // de veinte líneas empujaba el total fuera de la pantalla.
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      {/* --- Cabecera ------------------------------------------------------ */}
      <Stack
        direction="row"
        sx={{
          alignItems: 'flex-start',
          gap: 1.5,
          px: 2.5,
          py: 2,
          borderBottom: '1px solid var(--sf-line)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: 'var(--sf-radius-sm)',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'var(--accent-soft)',
            color: 'var(--accent-deep)',
          }}
        >
          <ReceiptLongRoundedIcon fontSize="small" />
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: TS.cardTitle, fontWeight: 800, letterSpacing: '-0.2px' }}>
            {orderNumber ?? t('account.orders.number')}
          </Typography>
          {detail && (
            <>
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.25 }}>
                {formatDate(new Date(detail.placed_at), locale)}
              </Typography>
              {/* El estado también aquí: se abre el detalle justo para saber si
                  ya salió, y obligar a cerrarlo para leerlo en la lista es
                  hacer trabajar al comprador por nada. */}
              <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
                <EstadoChip valor={detail.status} clave="orders.status" />
                <EstadoChip valor={detail.payment_status} clave="orders.payment" />
              </Stack>
            </>
          )}
        </Box>

        <IconButton onClick={onClose} aria-label={t('common.close')} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      {/* --- Líneas -------------------------------------------------------- */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2.5, py: 1 }}>
        {query.isPending && <BrandLoader />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

        {detail?.items.map((item, index) => (
          <Stack
            key={`${item.sku ?? item.name}-${index}`}
            direction="row"
            sx={{
              gap: 1.5,
              alignItems: 'flex-start',
              py: 1.75,
              borderBottom: index === detail.items.length - 1 ? 'none' : '1px solid var(--sf-line)',
            }}
          >
            {/* La cantidad, en pastilla y delante. Es el dato que se comprueba
                contra la caja que llegó, y en una columna de la derecha se
                pierde entre dos importes. */}
            <Box
              sx={{
                minWidth: 30,
                height: 30,
                px: 0.75,
                flexShrink: 0,
                borderRadius: 'var(--sf-pill)',
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'var(--neutral-soft)',
                color: 'var(--text)',
                fontSize: TS.label,
                fontWeight: 800,
              }}
            >
              ×{item.quantity}
            </Box>

            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: TS.body, fontWeight: 600, lineHeight: 1.4 }}>
                {item.name}
              </Typography>
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.25 }}>
                {[item.sku, item.variant_label].filter(Boolean).join(' · ')}
              </Typography>
            </Box>

            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography className="tnum" sx={{ fontSize: TS.body, fontWeight: 800 }}>
                {money(item.total)}
              </Typography>
              {/* El precio unitario solo dice algo cuando hay más de uno: con
                  cantidad 1 repite el importe de al lado. */}
              {item.quantity > 1 && (
                <Typography className="tnum" sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {money(item.unit_price)} c/u
                </Typography>
              )}
            </Box>
          </Stack>
        ))}
      </Box>

      {/* --- Totales, anclados abajo --------------------------------------- */}
      {detail && (
        <Stack
          sx={{
            gap: 0.75,
            px: 2.5,
            py: 2,
            borderTop: '1px solid var(--sf-line-strong)',
            bgcolor: 'var(--sf-media-bg)',
          }}
        >
          <Linea etiqueta={t('account.orders.subtotal')} valor={money(detail.subtotal)} />
          {/* Descuento y envío solo cuando dicen algo: una fila de cero en un
              resumen se lee como un cargo que no se entiende. */}
          {Number(detail.discount_total) > 0 && (
            <Linea
              etiqueta={t('account.orders.discount')}
              valor={`− ${money(detail.discount_total)}`}
              tono="var(--accent-deep)"
            />
          )}
          <Linea etiqueta={t('account.orders.tax')} valor={money(detail.tax_total)} />
          {Number(detail.shipping_total) > 0 && (
            <Linea etiqueta={t('account.orders.shipping')} valor={money(detail.shipping_total)} />
          )}
          <Box sx={{ height: '1px', bgcolor: 'var(--sf-line)', my: 0.75 }} />
          <Linea etiqueta={t('account.orders.total')} valor={money(detail.grand_total)} fuerte />

          {/* Cómo y dónde se entrega, cuando el detalle lo trae. Es la otra
              pregunta con la que se abre un pedido: «¿a dónde lo mandé?». */}
          {(entrega || direccion) && (
            <Box sx={{ mt: 0.75 }}>
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', fontWeight: 700 }}>
                {t('account.orders.delivery')}
              </Typography>
              <Typography sx={{ fontSize: TS.body, overflowWrap: 'anywhere' }}>
                {[entrega, direccion].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
          )}

          {reorderable && (
            <Button
              variant="contained"
              startIcon={<ReplayRoundedIcon />}
              onClick={() => reorder.mutate()}
              disabled={reorder.isPending}
              sx={{ mt: 1 }}
            >
              {t('account.orders.reorder')}
            </Button>
          )}
          {reorderable && (
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
              {t('account.orders.reorderHint')}
            </Typography>
          )}
        </Stack>
      )}
    </Drawer>
  )
}

function Linea({
  etiqueta,
  valor,
  fuerte = false,
  tono,
}: {
  etiqueta: string
  valor: string
  fuerte?: boolean
  tono?: string
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, alignItems: 'baseline' }}>
      <Typography
        sx={{
          fontSize: fuerte ? TS.bodyStrong : TS.body,
          color: fuerte ? 'var(--text)' : 'var(--muted)',
          fontWeight: fuerte ? 800 : 500,
        }}
      >
        {etiqueta}
      </Typography>
      <Typography
        className="tnum"
        sx={{
          fontSize: fuerte ? TS.figure : TS.body,
          fontWeight: fuerte ? 800 : 600,
          letterSpacing: fuerte ? '-0.02em' : undefined,
          color: tono ?? 'var(--text)',
          whiteSpace: 'nowrap',
        }}
      >
        {valor}
      </Typography>
    </Stack>
  )
}
