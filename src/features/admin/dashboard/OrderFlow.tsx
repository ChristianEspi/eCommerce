import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import { Box, Button, Card, CardContent, Stack, Tooltip, Typography } from '@mui/material'
import { Fragment } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { STATUS_COLOR, type StatusColor } from '@/features/orders/status'
import { ORDER_STATUSES, type OrderStatus } from '@/features/orders/types'
import type { WatchFinding } from '@/features/watch/api'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { C, T } from '@/theme/tokens'
import type { DashboardKpis } from '../useDashboardKpis'

/**
 * Color por RESULTADO, no por marca (2026-11-24): entregado en verde semántico
 * aunque el acento del tenant sea rojo; si no, «entregado» y «reembolsado» se
 * leían iguales en la barra.
 */
const STATUS_VAR: Record<StatusColor, { fg: string; soft: string }> = {
  default: { fg: C.muted, soft: C.neutralSoft },
  info: { fg: C.blue, soft: C.blueSoft },
  success: { fg: C.green, soft: C.greenSoft },
  warning: { fg: C.amber, soft: C.amberSoft },
  error: { fg: C.red, soft: C.redSoft },
}

/** Orden de la barra: primero el camino del pedido, luego lo que salió de él. */
const BAR_ORDER: readonly OrderStatus[] = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']

const isOrderStatus = (v: string): v is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(v)

/** El camino feliz de un pedido. Anulado y reembolsado salen del flujo. */
const FLOW: ReadonlyArray<{ status: OrderStatus; late: string | null }> = [
  { status: 'pending', late: 'orders.unpaid' },
  { status: 'paid', late: 'orders.paid_unshipped' },
  { status: 'fulfilled', late: null },
]

/**
 * Flujo de pedidos: Pendiente → Pagado → Entregado, y dónde se atascan.
 *
 * Los conteos salen de `dashboard_kpis.by_status`; el «atascado» de cada etapa,
 * del centro de vigilancia (`orders.unpaid`, `orders.paid_unshipped`), que ya
 * está en caché porque el carril lo pintó. Una sola regla de «qué es tarde» para
 * toda la pantalla: si el panel dice 12 y el flujo dijera 13 nadie creería a
 * ninguno de los dos.
 *
 * La barra de proporciones es una imagen con nombre: el color acompaña, la
 * etiqueta dice qué es cada tramo.
 */
export function OrderFlow({ kpis, findings }: { kpis: DashboardKpis; findings: readonly WatchFinding[] }) {
  const { t } = useI18n()
  const count = (status: string) => kpis.by_status.find((r) => r.status === status)?.count ?? 0
  const lateOf = (key: string | null) => (key ? findings.find((f) => f.key === key)?.count ?? 0 : 0)

  const visibles = BAR_ORDER.flatMap((status) => {
    const n = kpis.by_status.find((r) => isOrderStatus(r.status) && r.status === status)?.count ?? 0
    return n > 0 ? [{ status, count: n }] : []
  })
  const barTotal = visibles.reduce((sum, r) => sum + r.count, 0)
  const pctOf = (n: number) => (barTotal > 0 ? Math.round((n / barTotal) * 100) : 0)
  const statusLabel = (status: string) => t(`orders.status.${status}` as MessageKey)
  const segmentText = (status: string, n: number) =>
    t('admin.dashboard.flow.segment')
      .replace('{label}', statusLabel(status))
      .replace('{n}', String(n))
      .replace('{pct}', String(pctOf(n)))

  return (
    <Card component="section" aria-labelledby="order-flow-title" sx={{ height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 2.25, height: '100%' }}>
        <Stack direction="row" sx={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 1 }}>
          <Box>
            <Typography id="order-flow-title" component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
              {t('admin.dashboard.flow.title')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: C.muted }}>
              {t('admin.dashboard.flow.subtitle').replace('{n}', String(kpis.orders))}
            </Typography>
          </Box>
          <Button component={RouterLink} to="/app/orders" size="small" endIcon={<ArrowForwardRoundedIcon />}>
            {t('admin.dashboard.seeOrders')}
          </Button>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: 'stretch', gap: 1.25 }}>
          {FLOW.map(({ status, late }, index) => {
            const tone = STATUS_VAR[STATUS_COLOR[status]]
            const n = count(status)
            const lateCount = lateOf(late)
            const share = kpis.orders > 0 ? Math.round((n / kpis.orders) * 100) : null
            const note =
              status === 'fulfilled'
                ? share === null
                  ? null
                  : t('admin.dashboard.flow.share').replace('{pct}', String(share))
                : lateCount > 0
                  ? t(`admin.dashboard.flow.${status}.late` as MessageKey).replace('{n}', String(lateCount))
                  : t('admin.dashboard.flow.onTrack')
            const warn = status !== 'fulfilled' && lateCount > 0
            return (
              <Fragment key={status}>
                {index > 0 && (
                  <Box
                    aria-hidden
                    sx={{ display: { xs: 'none', sm: 'grid' }, placeItems: 'center', color: C.muted, flexShrink: 0 }}
                  >
                    <ChevronRightRoundedIcon fontSize="small" />
                  </Box>
                )}
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    borderRadius: 1,
                    bgcolor: tone.soft,
                    px: 2,
                    py: 1.75,
                  }}
                >
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tone.fg }} />
                    <Typography
                      sx={{ fontSize: T.label, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: tone.fg }}
                    >
                      {statusLabel(status)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 0.5 }}>
                    <Typography className="tnum" sx={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                      {n}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: C.muted }}>
                      {t(`admin.dashboard.flow.${status}.desc` as MessageKey)}
                    </Typography>
                  </Stack>
                  {note && (
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.5, color: warn ? tone.fg : C.green }}>
                      {warn ? (
                        <ScheduleRoundedIcon aria-hidden sx={{ fontSize: 14 }} />
                      ) : (
                        <CheckCircleOutlineRoundedIcon aria-hidden sx={{ fontSize: 14 }} />
                      )}
                      <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{note}</Typography>
                    </Stack>
                  )}
                </Box>
              </Fragment>
            )
          })}
        </Stack>

        {kpis.orders > 0 && visibles.length > 0 && (
          <Stack spacing={1} sx={{ mt: 'auto' }}>
            {/* Cada tramo dice qué es al pasar el ratón; la leyenda lo dice sin ratón. */}
            <Box
              role="img"
              aria-label={visibles.map((r) => `${statusLabel(r.status)}: ${r.count}`).join(', ')}
              sx={{ display: 'flex', height: 12, gap: '2px' }}
            >
              {visibles.map((r) => (
                <Tooltip key={r.status} title={segmentText(r.status, r.count)} placement="top" arrow disableInteractive>
                  <Box
                    sx={{
                      flexGrow: r.count,
                      flexBasis: 0,
                      minWidth: 6,
                      borderRadius: '3px',
                      bgcolor: STATUS_VAR[STATUS_COLOR[r.status]].fg,
                      transition: 'transform 120ms ease',
                      '&:hover': { transform: 'scaleY(1.4)' },
                      '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
            <Stack
              component="ul"
              direction="row"
              aria-label={t('admin.dashboard.flow.legend')}
              sx={{ listStyle: 'none', m: 0, p: 0, flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}
            >
              {visibles.map((r) => (
                <Stack component="li" key={r.status} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: STATUS_VAR[STATUS_COLOR[r.status]].fg }} />
                  <Typography sx={{ fontSize: 12, color: C.muted }}>{statusLabel(r.status)}</Typography>
                  <Typography className="tnum" sx={{ fontSize: 12, fontWeight: 700 }}>
                    {r.count}
                  </Typography>
                  <Typography className="tnum" sx={{ fontSize: 12, color: C.muted }}>
                    {pctOf(r.count)} %
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
