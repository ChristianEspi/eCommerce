import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { consumerOrdersKey, fetchConsumerOrders, isMissingFunction } from '../consumer'
import { fetchMyOrders, myOrdersKey, type MyOrder } from '../portal'
import { EstadoChip } from './EstadoChip'
import { MyOrderDrawer, type OrdersSource } from './MyOrderDrawer'

/**
 * Mis pedidos.
 *
 * Un comprador B2B no busca «el pedido de ayer»: busca «el que todavía no me
 * llega» y «el que tengo que pagar». Por eso las dos columnas que mandan son
 * ESTADO y PAGO, y no la fecha: la fecha ordena, pero no es lo que se viene a
 * consultar.
 *
 * La lista sale de `my_business_orders`, que resuelve por vínculo qué pedidos
 * son suyos. Aquí no se filtra por cuenta ni se pasa ningún id: si la persona
 * compra para dos empresas, ve las dos, y cada fila dice de cuál es.
 *
 * ## `source="consumer"` (hardening H03)
 *
 * El consumidor registrado usa la MISMA lista y el mismo detalle, con otra
 * fuente: `my_consumer_orders`, que devuelve los pedidos que hizo con sesión en
 * esta tienda. La pantalla no cambia de forma; cambia de quién son las filas.
 */
export function MyOrdersSection({
  storeSlug,
  source = 'business',
  storeId = null,
}: {
  storeSlug: string
  source?: OrdersSource
  /** Para volver a comprar desde el detalle. Sin tienda resuelta no se ofrece. */
  storeId?: string | null
}) {
  const { t, locale } = useI18n()
  const consumer = source === 'consumer'
  const query = useQuery({
    queryKey: consumer ? consumerOrdersKey(storeSlug) : myOrdersKey(),
    queryFn: () => (consumer ? fetchConsumerOrders(storeSlug) : fetchMyOrders(50)),
    enabled: !consumer || storeSlug !== '',
    // Una función que la base todavía no tiene no aparece por reintentar.
    retry: (count, error) => !isMissingFunction(error) && count < 2,
  })
  const [abierto, setAbierto] = useState<MyOrder | null>(null)

  if (consumer && storeSlug === '') return null
  if (query.isPending) return <BrandLoader />
  if (query.isError && isMissingFunction(query.error)) {
    return (
      <EmptyState
        title={t('account.consumer.unavailable')}
        description={t('account.consumer.unavailableBody')}
        icon={<ReceiptLongRoundedIcon fontSize="small" />}
      />
    )
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const orders = query.data ?? []
  if (orders.length === 0) {
    return (
      <EmptyState
        title={t('account.orders.empty')}
        description={t('account.orders.emptyBody')}
        icon={<ReceiptLongRoundedIcon fontSize="small" />}
      />
    )
  }

  return (
    <Card sx={{ borderRadius: 'var(--sf-radius)', border: '1px solid var(--sf-line)', overflow: 'hidden' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('account.orders.number')}</TableCell>
            <TableCell>{t('account.orders.date')}</TableCell>
            <TableCell>{t('account.orders.state')}</TableCell>
            <TableCell align="right">{t('account.orders.total')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.order_id}
              hover
              // La fila entera abre el detalle: el objetivo mas grande de la
              // pantalla es el que se pulsa, y un enlace de dos palabras en la
              // ultima columna se falla en movil.
              role="button"
              tabIndex={0}
              aria-label={`${t('account.orders.detail')}: ${order.order_number}`}
              onClick={() => setAbierto(order)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setAbierto(order)
                }
              }}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>
                <Typography sx={{ fontSize: TS.body, fontWeight: 800 }}>
                  {order.order_number}
                </Typography>
                {/* De qué empresa es. Solo dice algo cuando se compra para más
                    de una, pero cuando lo dice es lo primero que se mira. Un
                    consumidor compra para sí: no hay empresa que nombrar. */}
                {order.account_name && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {order.account_name}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {formatDate(new Date(order.placed_at), locale)}
              </TableCell>
              <TableCell>
                <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
                  <EstadoChip valor={order.status} clave="orders.status" />
                  <EstadoChip valor={order.payment_status} clave="orders.payment" />
                  {order.approval_status === 'pending' && (
                    <Chip
                      size="small"
                      label={t('account.needsApproval')}
                      sx={{ bgcolor: 'var(--amber-soft)', color: 'var(--text)', fontWeight: 700 }}
                    />
                  )}
                </Stack>
              </TableCell>
              <TableCell align="right" className="tnum" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                {formatMoney(Number(order.grand_total), order.currency, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Box sx={{ px: 2, py: 1.25, borderTop: '1px solid var(--sf-line)' }}>
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {t('account.orders.tracking').replace('{store}', storeSlug)}
        </Typography>
      </Box>

      <MyOrderDrawer
        orderId={abierto?.order_id ?? null}
        orderNumber={abierto?.order_number ?? null}
        onClose={() => setAbierto(null)}
        source={source}
        storeSlug={storeSlug}
        storeId={storeId}
      />
    </Card>
  )
}

export type { MyOrder }
