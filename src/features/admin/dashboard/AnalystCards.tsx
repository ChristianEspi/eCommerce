import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded'
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import SellOutlinedIcon from '@mui/icons-material/SellOutlined'
import SouthEastRoundedIcon from '@mui/icons-material/SouthEastRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import {
  FULFILLMENT_COLOR,
  FULFILLMENT_LABEL,
  PAYMENT_COLOR,
  PAYMENT_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from '@/features/orders/status'
import { FULFILLMENT_ICON, PAYMENT_ICON, STATUS_ICON } from '@/features/orders/statusIcons'
import {
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@/features/orders/types'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon, type AppIconTone } from '@/shared/ui/AppIcon'
import { StatusChip } from '@/shared/ui/StatusChip'
import { C, SH, T } from '@/theme/tokens'
import {
  ANALYST_ROUTE_CAPABILITY,
  entityMetrics,
  formatMetric,
  metricLabelKey,
  orderHref,
  type AnalystContext,
  type AnalystEntity,
  type EntityField,
  type Metric,
} from './aiAnalyst'

/**
 * Tarjetas del Analista IA: lo que la respuesta CITA se enseña como ficha, no
 * como prosa. Todo lo que se pinta aquí sale de `metrics`/`entities` (la base),
 * nunca del texto del modelo: el modelo solo eligió QUÉ citar.
 */

const FIELD_LABEL: Readonly<Record<EntityField, MessageKey>> = {
  total: 'aiAnalyst.field.total',
  placed_at: 'aiAnalyst.field.placed_at',
  age_days: 'aiAnalyst.field.age_days',
  available: 'aiAnalyst.field.available',
  reorder_point: 'aiAnalyst.field.reorder_point',
  days_late: 'aiAnalyst.field.days_late',
  documents: 'aiAnalyst.field.documents',
  max_days_overdue: 'aiAnalyst.field.max_days_overdue',
  units: 'aiAnalyst.field.units',
  revenue: 'aiAnalyst.field.revenue',
}

/** Motivos y tipos (`detail`) con texto propio; los demás no se enseñan crudos. */
const DETAIL_LABEL: Readonly<Record<string, MessageKey>> = {
  unpaid: 'aiAnalyst.detail.unpaid',
  awaiting_approval: 'aiAnalyst.detail.awaiting_approval',
  paid_unshipped: 'aiAnalyst.detail.paid_unshipped',
  below_reorder: 'aiAnalyst.detail.below_reorder',
  negative: 'aiAnalyst.detail.negative',
}

const KIND_ICON: Record<AnalystEntity['kind'], ReactNode> = {
  order: <ReceiptLongOutlinedIcon fontSize="small" />,
  stock_low: <Inventory2OutlinedIcon fontSize="small" />,
  stock_idle: <Inventory2OutlinedIcon fontSize="small" />,
  delivery: <LocalShippingOutlinedIcon fontSize="small" />,
  customer: <PersonOutlineRoundedIcon fontSize="small" />,
  product: <SellOutlinedIcon fontSize="small" />,
}

const KIND_TONE: Record<AnalystEntity['kind'], AppIconTone> = {
  order: 'accent',
  stock_low: 'warning',
  stock_idle: 'neutral',
  delivery: 'info',
  customer: 'info',
  product: 'accent',
}

const isOrderStatus = (v: string | null | undefined): v is OrderStatus =>
  (ORDER_STATUSES as readonly string[]).includes(v ?? '')
const isPaymentStatus = (v: string | undefined): v is PaymentStatus =>
  (PAYMENT_STATUSES as readonly string[]).includes(v ?? '')
const isFulfillmentStatus = (v: string | undefined): v is FulfillmentStatus =>
  (FULFILLMENT_STATUSES as readonly string[]).includes(v ?? '')

/** Superficie común: borde fino, esquinas amplias y realce suave al pasar. */
const cardSx = {
  position: 'relative',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  p: 1.75,
  borderRadius: 3,
  border: `1px solid ${C.line}`,
  bgcolor: C.card,
  transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
  '&:hover': {
    borderColor: C.accent,
    boxShadow: SH.lg,
    transform: 'translateY(-1px)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    '&:hover': { transform: 'none' },
  },
} as const

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
}: {
  metricKey: string
  context: AnalystContext
  compact?: boolean
}) {
  const { t } = useI18n()
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

  return (
    <Box
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
      </Box>
    </Box>
  )
}

function OpenLink({ to, label }: { to: string; label: string }) {
  return (
    <Button
      component={RouterLink}
      to={to}
      size="small"
      endIcon={<ArrowForwardRoundedIcon />}
      sx={{ alignSelf: 'flex-start', mt: 'auto', px: 1, ml: -1 }}
    >
      {label}
    </Button>
  )
}

/** Ficha de pedido: número, fecha, total y los tres ejes de estado. */
function OrderCard({
  entityRef,
  entity,
  context,
}: {
  entityRef: string
  entity: AnalystEntity
  context: AnalystContext
}) {
  const { t } = useI18n()
  const { has } = useCapabilities()
  const format = useFormat()
  const metrics = entityMetrics(entityRef, context)
  const total = metrics.find((m) => m.field === 'total')?.metric
  const placedAt = metrics.find((m) => m.field === 'placed_at')?.metric
  const age = metrics.find((m) => m.field === 'age_days')?.metric
  const status = isOrderStatus(entity.detail) ? entity.detail : null
  const payment = isPaymentStatus(entity.facets?.payment) ? entity.facets?.payment : undefined
  const fulfillment = isFulfillmentStatus(entity.facets?.fulfillment) ? entity.facets?.fulfillment : undefined
  const reason = entity.detail && Object.hasOwn(DETAIL_LABEL, entity.detail) ? DETAIL_LABEL[entity.detail] : undefined
  const href = has('orders') ? orderHref(entity) : null

  return (
    <Box component="article" sx={cardSx} aria-label={`${t('aiAnalyst.entity.order')} ${entity.label}`}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
        <AppIcon tone="accent" size="sm">
          {KIND_ICON.order}
        </AppIcon>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{ fontSize: T.bodyStrong, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {entity.label}
          </Typography>
          {placedAt && (
            <Typography sx={{ fontSize: T.label, color: C.muted }}>
              {format(placedAt)}
              {age ? ` · ${format(age)}` : ''}
            </Typography>
          )}
        </Box>
        {entityRef === 'R1' && <StatusChip tone="success" label={t('aiAnalyst.card.latest')} />}
      </Stack>

      {total && (
        <Typography className="tnum" sx={{ fontSize: T.kpiCard, fontWeight: 800, lineHeight: 1.2 }}>
          {format(total)}
        </Typography>
      )}

      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap' }}>
        {status && <StatusChip tone={STATUS_COLOR[status]} icon={STATUS_ICON[status]} label={t(STATUS_LABEL[status])} />}
        {payment && <StatusChip tone={PAYMENT_COLOR[payment]} icon={PAYMENT_ICON[payment]} label={t(PAYMENT_LABEL[payment])} />}
        {fulfillment && (
          <StatusChip
            tone={FULFILLMENT_COLOR[fulfillment]}
            icon={FULFILLMENT_ICON[fulfillment]}
            label={t(FULFILLMENT_LABEL[fulfillment])}
          />
        )}
        {!status && reason && <StatusChip tone="warning" label={t(reason)} />}
      </Stack>

      {href && <OpenLink to={href} label={t('aiAnalyst.card.openOrder')} />}
    </Box>
  )
}

/** Ficha genérica (stock, entrega, cliente, producto): título y sus cifras. */
function GenericEntityCard({
  entityRef,
  entity,
  context,
}: {
  entityRef: string
  entity: AnalystEntity
  context: AnalystContext
}) {
  const { t } = useI18n()
  const { has } = useCapabilities()
  const format = useFormat()
  const metrics = entityMetrics(entityRef, context)
  const detail = entity.detail && Object.hasOwn(DETAIL_LABEL, entity.detail) ? DETAIL_LABEL[entity.detail] : undefined
  const kindLabel = t(`aiAnalyst.entity.${entity.kind}` as MessageKey)

  return (
    <Box component="article" sx={cardSx} aria-label={`${kindLabel} ${entity.label}`}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
        <AppIcon tone={KIND_TONE[entity.kind]} size="sm">
          {KIND_ICON[entity.kind]}
        </AppIcon>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: T.label, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {kindLabel}
          </Typography>
          <Typography
            sx={{
              fontSize: T.bodyStrong,
              fontWeight: 800,
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {entity.label}
          </Typography>
        </Box>
      </Stack>

      {detail && (
        <Box>
          <StatusChip tone={entity.detail === 'negative' ? 'error' : 'warning'} label={t(detail)} />
        </Box>
      )}

      {metrics.length > 0 && (
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 0.5, columnGap: 1.5 }}>
          {metrics.map(({ field, metric }) => (
            <Box key={field} sx={{ display: 'contents' }}>
              <Typography component="dt" sx={{ fontSize: 12.5, color: C.muted }}>
                {t(FIELD_LABEL[field])}
              </Typography>
              <Typography component="dd" className="tnum" sx={{ m: 0, fontSize: 13, fontWeight: 800, textAlign: 'right' }}>
                {format(metric)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {has(ANALYST_ROUTE_CAPABILITY[entity.module]) && (
        <OpenLink
          to={entity.route}
          label={`${t('aiAnalyst.goTo')} ${t(`aiAnalyst.module.${entity.module}` as MessageKey)}`}
        />
      )}
    </Box>
  )
}

export function EntityCard({ entityRef, context }: { entityRef: string; context: AnalystContext }) {
  const entity = Object.hasOwn(context.entities, entityRef) ? context.entities[entityRef] : undefined
  if (!entity) return null
  return entity.kind === 'order' ? (
    <OrderCard entityRef={entityRef} entity={entity} context={context} />
  ) : (
    <GenericEntityCard entityRef={entityRef} entity={entity} context={context} />
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

/** Cabecera de la respuesta: marca IA + si responde del todo o solo en parte. */
export function AnswerHeader({ answerable, question }: { answerable: boolean; question: string | null }) {
  const { t } = useI18n()
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
        <AppIcon tone="accent" size="sm">
          <AutoAwesomeRoundedIcon fontSize="small" />
        </AppIcon>
        <Typography sx={{ fontSize: T.cardTitle, fontWeight: 800 }}>{t('aiAnalyst.answer.label')}</Typography>
        {!answerable && <StatusChip tone="warning" label={t('aiAnalyst.answer.partial')} />}
      </Stack>
      {question && (
        <Typography
          sx={{
            fontSize: 12.5,
            color: C.muted,
            fontStyle: 'italic',
            pl: 1.25,
            borderLeft: `3px solid ${C.accentSoft}`,
          }}
        >
          {question}
        </Typography>
      )}
    </Stack>
  )
}
