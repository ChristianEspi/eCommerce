import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import SellOutlinedIcon from '@mui/icons-material/SellOutlined'
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

/** Color del valor: solo las variaciones llevan tono (sube = acento, baja = rojo). */
function deltaColor(key: string, metric: Metric): string {
  if (!key.endsWith('_delta_pct')) return C.ink
  const n = Number(metric.value)
  if (!Number.isFinite(n) || n === 0) return C.ink
  return n > 0 ? C.accentDeep : C.red
}

/** Indicador: etiqueta arriba, cifra grande. */
export function MetricTile({ metricKey, context }: { metricKey: string; context: AnalystContext }) {
  const { t } = useI18n()
  const format = useFormat()
  const metric = Object.hasOwn(context.metrics, metricKey) ? context.metrics[metricKey] : undefined
  const label = metricLabelKey(metricKey)
  if (!metric || !label) return null
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2.5,
        bgcolor: C.neutralSoft,
        minWidth: 0,
        height: '100%',
      }}
    >
      <Typography sx={{ fontSize: T.label, fontWeight: 700, color: C.muted, lineHeight: 1.3 }}>{t(label)}</Typography>
      <Typography
        className="tnum"
        sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.25, mt: 0.5, color: deltaColor(metricKey, metric) }}
      >
        {format(metric)}
      </Typography>
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
