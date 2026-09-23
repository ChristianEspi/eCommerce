import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import SellOutlinedIcon from '@mui/icons-material/SellOutlined'
import SouthEastRoundedIcon from '@mui/icons-material/SouthEastRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { C, SH, T } from '@/theme/tokens'
import {
  ANALYST_ROUTE_CAPABILITY,
  ANALYST_ROUTES,
  formatMetric,
  metricLabelKey,
  type AnalystContext,
  type AnalystModule,
  type Metric,
} from './aiAnalyst'

/**
 * Indicadores del Analista IA. Todo lo que se pinta aquí sale de `metrics` (la
 * base), nunca del texto del modelo.
 */

function useFormat() {
  const { t, locale } = useI18n()
  return (metric: Metric) => formatMetric(metric, locale, { days: t('aiAnalyst.unit.days') })
}

type TileTone = 'danger' | 'warning' | 'accent' | 'info' | 'neutral'

/** Pares de tokens por tono: texto/icono y fondo suave. Conmutan con el tema. */
const TONE_COLORS: Record<TileTone, { fg: string; soft: string }> = {
  danger: { fg: C.red, soft: C.redSoft },
  warning: { fg: C.amber, soft: C.amberSoft },
  accent: { fg: C.accentDeep, soft: C.accentSoft },
  info: { fg: C.blue, soft: C.blueSoft },
  neutral: { fg: C.muted, soft: C.neutralSoft },
}

/** Lo que pide acción hoy (rojo) y lo que conviene mirar (ámbar). El resto informa. */
const DANGER_KEYS = new Set([
  'fulfillment.overdue',
  'fulfillment.failed',
  'credit.overdue_balance',
  'credit.overdue_documents',
  'credit.accounts_blocked',
  'inventory.negative',
])
const WARNING_KEYS = new Set([
  'orders.pending',
  'orders.awaiting_approval',
  'orders.unpaid_over_3d',
  'orders.paid_unshipped_over_2d',
  'inventory.below_reorder',
  'inventory.stale',
  'credit.accounts_watch',
  'catalog.unpublished',
])

const AREA_ICON: Record<string, ReactNode> = {
  sales: <TrendingUpRoundedIcon />,
  orders: <ReceiptLongOutlinedIcon />,
  inventory: <Inventory2OutlinedIcon />,
  fulfillment: <LocalShippingOutlinedIcon />,
  credit: <AccountBalanceWalletOutlinedIcon />,
  catalog: <SellOutlinedIcon />,
  period: <CalendarTodayOutlinedIcon />,
}

function metricNumber(metric: Metric): number {
  return typeof metric.value === 'number' ? metric.value : Number(metric.value)
}

/** Tono del indicador. Una alerta en cero no alarma: pasa a neutro. */
function metricTone(key: string, metric: Metric): TileTone {
  const n = metricNumber(metric)
  const attention = DANGER_KEYS.has(key) ? 'danger' : WARNING_KEYS.has(key) ? 'warning' : null
  if (attention) return Number.isFinite(n) && n === 0 ? 'neutral' : attention
  if (key === 'inventory.idle') return 'neutral'
  return 'accent'
}

/** Variación: sube = acento, baja = rojo, sin cambio = nada. */
function deltaDirection(key: string, metric: Metric): 'up' | 'down' | null {
  if (!key.endsWith('_delta_pct')) return null
  const n = metricNumber(metric)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 'up' : 'down'
}

/**
 * Indicador: icono del área en un círculo tenue, cifra grande y su nombre
 * debajo; una franja lateral del mismo tono lo ancla. El color acompaña, no
 * informa solo: la etiqueta siempre dice qué es.
 */
export function MetricTile({
  metricKey,
  context,
  compact = false,
  module,
  subKey,
}: {
  metricKey: string
  context: Pick<AnalystContext, 'metrics'>
  compact?: boolean
  /** Si se da y está contratado, la tarjeta entera lleva a ese módulo. */
  module?: AnalystModule
  /** Cifra de apoyo bajo la etiqueta (variación, documentos…). */
  subKey?: string
}) {
  const { t } = useI18n()
  const { has } = useCapabilities()
  const format = useFormat()
  const metric = Object.hasOwn(context.metrics, metricKey) ? context.metrics[metricKey] : undefined
  const label = metricLabelKey(metricKey)
  if (!metric || !label) return null
  const tone = TONE_COLORS[metricTone(metricKey, metric)]
  const delta = deltaDirection(metricKey, metric)
  const valueColor = delta === 'up' ? C.accentDeep : delta === 'down' ? C.red : C.ink
  const area = metricKey.split('.')[0] ?? ''
  const icon = Object.hasOwn(AREA_ICON, area) ? AREA_ICON[area] : AREA_ICON.sales
  const iconSize = compact ? 26 : 32
  const sub = subKey && Object.hasOwn(context.metrics, subKey) ? context.metrics[subKey] : undefined
  const subLabel = subKey ? metricLabelKey(subKey) : null
  const subDelta = sub && subKey ? deltaDirection(subKey, sub) : null
  const href = module && has(ANALYST_ROUTE_CAPABILITY[module]) ? ANALYST_ROUTES[module] : null
  const linkProps = href
    ? {
        component: RouterLink,
        to: href,
        'aria-label': `${t(label)}: ${format(metric)}`,
      }
    : {}

  return (
    <Box
      {...linkProps}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0.75 : 1.25,
        p: compact ? 1.25 : 1.75,
        pl: compact ? 1.5 : 2,
        borderRadius: 3,
        bgcolor: C.card,
        border: `1px solid ${C.line}`,
        color: 'inherit',
        textDecoration: 'none',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          bgcolor: tone.fg,
          opacity: 0.85,
        },
        ...(href
          ? {
              cursor: 'pointer',
              transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
              '&:hover': { borderColor: tone.fg, boxShadow: SH.lg, transform: 'translateY(-1px)' },
              '&:focus-visible': { outline: `2px solid ${C.accent}`, outlineOffset: 2 },
              '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
            }
          : {}),
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box
          aria-hidden
          sx={{
            width: iconSize,
            height: iconSize,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: tone.soft,
            color: tone.fg,
            flexShrink: 0,
            '& .MuiSvgIcon-root': { fontSize: compact ? 15 : 18 },
          }}
        >
          {icon}
        </Box>
        {delta && (
          <Box aria-hidden sx={{ display: 'flex', color: valueColor, '& .MuiSvgIcon-root': { fontSize: 20 } }}>
            {delta === 'up' ? <NorthEastRoundedIcon /> : <SouthEastRoundedIcon />}
          </Box>
        )}
        {!delta && href && (
          <Box aria-hidden sx={{ display: 'flex', color: C.muted, '& .MuiSvgIcon-root': { fontSize: 18 } }}>
            <ArrowForwardRoundedIcon />
          </Box>
        )}
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          className="tnum"
          sx={{
            fontSize: compact ? 18 : T.kpiCard,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -0.3,
            color: valueColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {format(metric)}
        </Typography>
        <Typography
          sx={{ fontSize: compact ? T.label : 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.3, mt: 0.5 }}
        >
          {t(label)}
        </Typography>
        {sub && subLabel && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.75 }}>
            {subDelta && (
              <Box
                aria-hidden
                sx={{
                  display: 'flex',
                  color: subDelta === 'up' ? C.accentDeep : C.red,
                  '& .MuiSvgIcon-root': { fontSize: 15 },
                }}
              >
                {subDelta === 'up' ? <NorthEastRoundedIcon /> : <SouthEastRoundedIcon />}
              </Box>
            )}
            <Typography sx={{ fontSize: 11.5, color: C.muted, lineHeight: 1.3 }}>
              <Box
                component="span"
                className="tnum"
                sx={{ fontWeight: 800, color: subDelta === 'up' ? C.accentDeep : subDelta === 'down' ? C.red : C.ink }}
              >
                {format(sub)}
              </Box>{' '}
              · {t(subLabel)}
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  )
}

/** Rejilla adaptable: 1 columna en móvil, hasta 3 en escritorio. */
export function CardGrid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.25,
        gridTemplateColumns: { xs: '1fr', sm: `repeat(auto-fill, minmax(${min}px, 1fr))` },
      }}
    >
      {children}
    </Box>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="h4"
      sx={{ fontSize: T.label, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}
    >
      {children}
    </Typography>
  )
}
