import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import ReceiptRoundedIcon from '@mui/icons-material/ReceiptRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Avatar,
  Box,
  Button,
  Card,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatMoney, formatRelative, formatTime } from '@/shared/lib/format'
import { STATUS_ICON, PAYMENT_ICON, FULFILLMENT_ICON } from './statusIcons'
import { RowActions } from '@/shared/ui/RowActions'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import { FilterBar } from '@/shared/ui/FilterBar'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { OrderDrawer } from './OrderDrawer'
import { OrdersAiBar } from './ai/OrdersAiBar'
import type { OrderDrawerTab } from './ai/ordersAi'
import { fetchOrder, fetchOrdersForExport } from './api'
import { downloadCsv, ordersToCsv } from './exportCsv'
import {
  FULFILLMENT_COLOR,
  FULFILLMENT_LABEL,
  PAYMENT_COLOR,
  PAYMENT_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from './status'
import {
  ORDERS_PAGE_SIZE,
  ORDER_DATE_RANGES,
  ORDER_STATUSES,
  type Order,
  type OrderDateRange,
  type OrderStatusFilter,
} from './types'
import { useOrders } from './useOrders'

const TABS: Array<{ value: OrderStatusFilter; label: MessageKey }> = [
  { value: 'all', label: 'common.all' },
  ...ORDER_STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] })),
  // Última y aparte: no es un estado más, es una cola de trabajo pendiente.
  { value: 'awaiting_approval', label: 'orders.tab.awaitingApproval' },
]

const RANGE_LABEL: Record<OrderDateRange, MessageKey> = {
  all: 'orders.range.all',
  today: 'orders.range.today',
  week: 'orders.range.week',
  month: 'orders.range.month',
  quarter: 'orders.range.quarter',
}

/** `YYYY-MM-DD` local: el filtro de fecha no puede depender del huso del servidor. */
function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Listado de pedidos del backoffice.
 *
 * Un buscador general + tabs de estado + Exportar (regla de suite §8). El
 * encargo pide además filtrar por fecha: se resuelve con UN control de rangos
 * cerrados, no con un panel de filtros multi-campo.
 *
 * **Pagina en el SERVIDOR** desde P08: `range()` + `count: 'exact'`. Traerse
 * todo y cortar en el navegador es una consulta que crece con el negocio del
 * cliente hasta que un día no vuelve — y hasta ese día no da ninguna señal.
 *
 * La pantalla no toca Supabase para escribir ni cambia estados: pide a los
 * hooks y delega las acciones en el panel de detalle, que llama al comando.
 */
export function OrdersPage() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, status: tenantStatus, can } = useTenant()
  const canWrite = can('orders.write')
  const canExport = can('orders.export')

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderStatusFilter>('all')
  const [range, setRange] = useState<OrderDateRange>('all')
  const [page, setPage] = useState(0)
  const [selected, setSelectedOrder] = useState<Order | null>(null)
  // Pestaña con la que se abre el detalle: solo la fija la IA del listado.
  const [drawerTab, setDrawerTab] = useState<OrderDrawerTab | undefined>(undefined)
  const setSelected = (order: Order | null) => {
    setDrawerTab(undefined)
    setSelectedOrder(order)
  }
  const [exporting, setExporting] = useState(false)
  const [params, setParams] = useSearchParams()
  const pedidoEnlazado = params.get('order')

  /**
   * Abrir un pedido desde un aviso.
   *
   * La campanita enlaza a `/app/orders?order=<id>`. El pedido puede no estar en
   * la página que se está viendo —es nuevo, o está en otra tienda del filtro—,
   * así que se pide por id en vez de buscarlo en la tabla. La RLS decide si se
   * puede ver: un id ajeno no devuelve nada y no se abre nada.
   */
  useEffect(() => {
    if (!pedidoEnlazado || selected?.id === pedidoEnlazado) return
    let vigente = true
    void fetchOrder(pedidoEnlazado)
      .then((order) => {
        if (!vigente || !order) return
        setDrawerTab(undefined)
        setSelectedOrder(order)
      })
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [pedidoEnlazado, selected?.id])

  /**
   * Abrir un pedido que propone la IA (búsqueda o cola de atención).
   *
   * Se relee por id —igual que el enlace de un aviso—: la RLS decide si se
   * puede ver, y la pestaña es la del flujo normal donde la persona actúa.
   */
  function abrirDesdeIa(orderId: string, tab?: OrderDrawerTab) {
    void fetchOrder(orderId)
      .then((order) => {
        if (!order) return
        setSelectedOrder(order)
        setDrawerTab(tab)
      })
      .catch(() => notify(t('orders.error.generic'), 'error'))
  }

  function cerrarPedido() {
    setSelected(null)
    if (pedidoEnlazado) {
      const siguiente = new URLSearchParams(params)
      siguiente.delete('order')
      setParams(siguiente, { replace: true })
    }
  }

  const storeId = activeStore?.id ?? null
  const today = useMemo(todayKey, [])
  // Igual que en Productos: el listado pregunta al servidor, así que el término
  // se deja reposar antes de viajar. Sin esto, buscar un número de pedido son
  // tantas peticiones como dígitos tiene.
  const termino = useDebouncedValue(search, 300)

  const filter = { storeId, search: termino, status, range, today, page }
  const orders = useOrders(filter)
  const rows = orders.data?.rows ?? []
  const total = orders.data?.total ?? 0

  const currencies = new Set(rows.map((order) => order.currency))
  const pageTotal =
    currencies.size === 1
      ? {
          amount: rows.reduce((sum, order) => sum + Number(order.grand_total), 0),
          currency: [...currencies][0] as string,
        }
      : null

  // Cambiar de filtro con la página 4 abierta deja al operador mirando una
  // página que ya no existe y una tabla vacía que parece un error.
  useEffect(() => {
    setPage(0)
  }, [termino, status, range, storeId])

  async function exportCsv() {
    setExporting(true)
    try {
      // Se exporta LO FILTRADO, no la página. La consulta se repite sin
      // `range`: exportar 25 filas cuando el filtro tiene 900 es un error que
      // nadie nota hasta abrir el archivo.
      const all = await fetchOrdersForExport(filter)
      if (all.length === 0) {
        notify(t('orders.export.empty'), 'error')
        return
      }
      downloadCsv(`pedidos-${today}.csv`, ordersToCsv(all))
    } catch {
      notify(t('orders.error.generic'), 'error')
    } finally {
      setExporting(false)
    }
  }

  // Mientras el espacio de trabajo se resuelve NO se dice "no tienes tiendas":
  // sería afirmar algo que todavía no se sabe (criterio P04 #37).
  if (tenantStatus === 'loading') {
    return (
      <>
        <PageHeader icon={<ReceiptLongRoundedIcon />} title={t('admin.orders.title')} />
        <Card>
          <TableSkeleton columns={6} />
        </Card>
      </>
    )
  }

  if (!storeId) {
    return (
      <>
        <PageHeader icon={<ReceiptLongRoundedIcon />} title={t('admin.orders.title')} />
        <Card>
          <EmptyState
            title={t('admin.store.none')}
            description={t('admin.store.noneBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('admin.orders.title')}
        subtitle={t('admin.orders.subtitle')}
        icon={<ReceiptLongRoundedIcon />}
        actions={
          canExport ? (
            <Button
              variant="outlined"
              startIcon={<FileDownloadRoundedIcon />}
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              {t('common.export')}
            </Button>
          ) : undefined
        }
      />
      <Stack spacing={2}>
        <OrdersAiBar storeId={storeId} onOpenOrder={abrirDesdeIa} />
        <Tabs
          value={status}
          onChange={(_, next: OrderStatusFilter) => setStatus(next)}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label={t('common.status')}
          sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
        >
          {TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={t(tab.label)} />
          ))}
        </Tabs>

        <FilterBar
          onClear={
            search !== '' || range !== 'all'
              ? () => {
                  setSearch('')
                  setRange('all')
                  setPage(0)
                }
              : undefined
          }
        >
          <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
            <SearchField value={search} onChange={setSearch} placeholder={t('admin.orders.search')} />
          </Box>
          <TextField
            select
            size="small"
            label={t('orders.range')}
            value={range}
            onChange={(event) => setRange(event.target.value as OrderDateRange)}
            sx={{ minWidth: 190 }}
          >
            {ORDER_DATE_RANGES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(RANGE_LABEL[value])}
              </MenuItem>
            ))}
          </TextField>
        </FilterBar>

        <Card>
          {orders.isPending && <TableSkeleton columns={6} />}
          {orders.isError && (
            <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
          )}
          {orders.isSuccess && rows.length === 0 && (
            <EmptyState
              title={t('admin.orders.empty')}
              description={t('admin.orders.emptyBody')}
              icon={<ReceiptLongRoundedIcon fontSize="small" />}
            />
          )}
          {/* Si la seleccion mezcla monedas no hay total que ensenar: sumar
              soles con dolares es peor que no dar cifra. Mismo criterio que
              `dashboard_kpis`. */}
          {orders.isSuccess && rows.length > 0 && (
            <>
              {/* Resumen de lo que se esta viendo. Una tabla sin cabecera de
                  contexto obliga a contar filas para saber cuanto hay, y el
                  importe total solo se puede sacar sumando a mano. */}
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center', gap: 2, flexWrap: 'wrap',
                  px: 2, py: 1.5, borderBottom: '1px solid var(--border)',
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 800 }}>
                  {rows.length} {t('orders.summary.shown')}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
                  <Typography sx={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {t('orders.summary.total')}
                  </Typography>
                  <Typography className="tnum" sx={{ fontSize: 15, fontWeight: 800 }}>
                    {pageTotal === null ? '—' : formatMoney(pageTotal.amount, pageTotal.currency, locale)}
                  </Typography>
                </Stack>
              </Stack>
              {/* El gris de cabecera y las lineas horizontales ya no viven
                  aqui: los pone el tema para las ~56 tablas de la app. */}
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.number')}</TableCell>
                    <TableCell>{t('common.customer')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell>{t('orders.axis.payment')}</TableCell>
                    <TableCell>{t('orders.axis.fulfillment')}</TableCell>
                    <TableCell>{t('common.date')}</TableCell>
                    <TableCell align="right">{t('common.total')}</TableCell>
                    {/* Acciones: sin encabezado, porque no es un dato. */}
                    <TableCell sx={{ width: 96 }} aria-hidden />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((order) => (
                    <TableRow
                      key={order.id}
                      hover
                      tabIndex={0}
                      role="button"
                      aria-label={`${t('orders.open')} ${order.order_number}`}
                      onClick={() => setSelected(order)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelected(order)
                        }
                      }}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                          <span>{order.order_number}</span>
                          {order.approval_status === 'pending' && (
                            <StatusChip
                              tone="warning"
                              label={t('orders.approval.pendingShort')}
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                          {/* Ancla visual: recorrer 50 filas de texto plano cuesta
                              mas que recorrerlas con un punto de apoyo por fila. */}
                          <Avatar
                            aria-hidden
                            sx={{
                              width: 30, height: 30, fontSize: 12, fontWeight: 800,
                              bgcolor: 'var(--accent-soft)', color: 'var(--accent-deep)',
                            }}
                          >
                            {(order.customer_name ?? order.customer_email ?? '?').trim().charAt(0).toUpperCase()}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {order.customer_name ?? order.customer_email}
                            </Typography>
                            <Typography sx={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {order.customer_email}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          tone={STATUS_COLOR[order.status]}
                          icon={STATUS_ICON[order.status]}
                          label={t(STATUS_LABEL[order.status])}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          tone={PAYMENT_COLOR[order.payment_status]}
                          icon={PAYMENT_ICON[order.payment_status]}
                          label={t(PAYMENT_LABEL[order.payment_status])}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          tone={FULFILLMENT_COLOR[order.fulfillment_status]}
                          icon={FULFILLMENT_ICON[order.fulfillment_status]}
                          label={t(FULFILLMENT_LABEL[order.fulfillment_status])}
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography sx={{ fontSize: 13 }}>{formatDate(order.placed_at, locale)}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                          {formatTime(order.placed_at, locale)} · {formatRelative(order.placed_at, locale)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" className="tnum" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {formatMoney(Number(order.grand_total), order.currency, locale)}
                      </TableCell>
                      <TableCell sx={{ width: 96, py: 0.5 }}>
                        <RowActions
                          actions={[
                            {
                              id: 'open',
                              icon: <VisibilityRoundedIcon fontSize="small" />,
                              label: t('orders.open'),
                              tone: 'neutral',
                              onClick: () => setSelected(order),
                            },
                            {
                              id: 'invoice',
                              icon: <ReceiptRoundedIcon fontSize="small" />,
                              label: t('orders.action.invoice'),
                              tone: 'accent',
                              // Solo tiene sentido sobre un pedido cobrado.
                              disabled: order.payment_status !== 'paid',
                              onClick: () => setSelected(order),
                            },
                            {
                              id: 'cancel',
                              icon: <CancelRoundedIcon fontSize="small" />,
                              label: t('orders.action.cancel'),
                              tone: 'danger',
                              // Un pedido ya cerrado no se anula desde el listado.
                              disabled: order.status === 'cancelled' || order.status === 'refunded',
                              onClick: () => setSelected(order),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePager
                page={page}
                pageSize={ORDERS_PAGE_SIZE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      </Stack>

      <OrderDrawer
        order={selected}
        open={selected !== null}
        canWrite={canWrite}
        onClose={cerrarPedido}
        initialTab={drawerTab}
      />
    </>
  )
}
