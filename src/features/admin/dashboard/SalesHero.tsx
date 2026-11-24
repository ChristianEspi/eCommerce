import PaidRoundedIcon from '@mui/icons-material/PaidRounded'
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import { Box, Card, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { Locale, MessageKey } from '@/shared/i18n/messages'
import { formatCalendarDate, formatMoney } from '@/shared/lib/format'
import { C, SH, T } from '@/theme/tokens'
import type { DashboardKpis } from '../useDashboardKpis'
import { SALES_PERIODS, salesDelta, type SalesPeriod, type SalesTrend } from '../useSalesTrend'

/**
 * Tarjeta en pastel del acento del tenant (2026-11-24): combina con la marca sin
 * teñirse entera de su color. Texto oscuro, barras y detalles en el acento.
 */
const TEXT_SOFT = C.muted
const TINT = (pct: number) => `color-mix(in srgb, ${C.accent} ${pct}%, transparent)`
const LINE = TINT(22)

const bucketLabel = (date: string, unit: SalesTrend['unit'], locale: Locale) =>
  formatCalendarDate(date, unit === 'month' ? 'month' : 'day', locale)

/**
 * Barras por día o por mes. Se dibujan con cajas y no con una librería de
 * gráficos: son treinta rectángulos, y así heredan los tokens y el modo oscuro
 * sin configurar nada.
 *
 * El gráfico es UNA imagen con nombre (`role="img"`), no treinta: quien usa
 * lector de pantalla recibe el resumen —tipo de serie y mejor punto—, y las
 * cifras exactas de cada barra van en su tooltip para quien pasa el ratón.
 * El último punto (hoy / este mes) se resalta: es el que todavía se mueve.
 *
 * 2026-11-24: el gráfico ocupa TODO el alto libre de la tarjeta (antes tenía
 * alto fijo y, junto a la vigilancia, dejaba un hueco en blanco encima). Cada
 * barra reparte su columna con `flex-grow` (vacío + relleno) en vez de un
 * `height: %`, que no resuelve dentro de un flex de alto no fijo. Las guías
 * horizontales y el tope escrito dan escala a las barras.
 */
function TrendBars({ trend, label }: { trend: SalesTrend; label: string }) {
  const { t, locale } = useI18n()
  const max = Math.max(...trend.series.map((p) => Number(p.sales)), 0)
  const currency = trend.currency ?? 'PEN'
  const last = trend.series.length - 1
  const middle = Math.floor(last / 2)
  const guide = TINT(14)

  return (
    <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0 }}>
      {max > 0 && (
        <Typography aria-hidden className="tnum" sx={{ fontSize: 11, color: TEXT_SOFT, lineHeight: 1 }}>
          {formatMoney(max, currency, locale)}
        </Typography>
      )}
      <Box
        role="img"
        aria-label={label}
        sx={{
          flex: 1,
          minHeight: { xs: 110, md: 150 },
          display: 'flex',
          alignItems: 'stretch',
          gap: { xs: '3px', md: '5px' },
          // Guías al 100 / 75 / 50 / 25 % y la base.
          backgroundImage: `linear-gradient(to bottom, ${guide} 1px, transparent 1px)`,
          backgroundSize: '100% 25%',
          borderBottom: `1px solid ${TINT(35)}`,
        }}
      >
        {trend.series.map((point, index) => {
          const value = Number(point.sales)
          // Un día sin ventas se ve como una raya, no como un hueco: el hueco
          // se lee como «falta el dato».
          const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 1.5
          return (
            <Tooltip
              key={point.date}
              title={`${bucketLabel(point.date, trend.unit, locale)} · ${formatMoney(value, currency, locale)}`}
              placement="top"
              arrow
              disableInteractive
            >
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'default',
                  '&:hover > .bar': { bgcolor: index === last ? C.accentDeep : TINT(70) },
                }}
              >
                <Box sx={{ flexGrow: 100 - pct, flexBasis: 0 }} />
                <Box
                  className="bar"
                  sx={{
                    flexGrow: pct,
                    flexBasis: 0,
                    minHeight: 2,
                    borderRadius: '3px 3px 0 0',
                    bgcolor: index === last ? C.accent : TINT(42),
                    transition: 'flex-grow 240ms ease, background-color 120ms ease',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  }}
                />
              </Box>
            </Tooltip>
          )
        })}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }} aria-hidden>
        {[0, middle, last].map((index) => (
          <Typography key={index} sx={{ fontSize: 11, color: TEXT_SOFT }}>
            {index === last
              ? t(trend.unit === 'month' ? 'admin.dashboard.sales.thisMonth' : 'admin.dashboard.sales.today')
              : bucketLabel(trend.series[index]?.date ?? '', trend.unit, locale)}
          </Typography>
        ))}
      </Stack>
    </Stack>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: TEXT_SOFT }}>{label}</Typography>
      <Typography
        className="tnum"
        sx={{ fontSize: T.kpiCard, fontWeight: 800, color: C.ink, lineHeight: 1.15, whiteSpace: 'nowrap' }}
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: 12, color: TEXT_SOFT }}>{hint}</Typography>
    </Stack>
  )
}

/**
 * La protagonista del Resumen: cuánto se vendió en el periodo y cómo va contra
 * el anterior.
 *
 * Todo sale de `dashboard_sales_trend`. Si esa función todavía no existe en la
 * base (migración sin aplicar) o falla, la tarjeta NO se cae: enseña las ventas
 * acumuladas de `dashboard_kpis` y lo dice, en vez de dejar un hueco rojo en
 * el sitio más visible de la pantalla.
 *
 * La variación solo aparece con base: con el periodo anterior en cero, «+∞ %»
 * no informa de nada.
 */
export function SalesHero({
  trend,
  trendFailed,
  period,
  onPeriodChange,
  kpis,
}: {
  trend: SalesTrend | undefined
  trendFailed: boolean
  period: SalesPeriod
  onPeriodChange: (period: SalesPeriod) => void
  kpis: DashboardKpis
}) {
  const { t, locale } = useI18n()

  const money = (raw: string | null, currency: string | null) =>
    raw !== null && currency ? formatMoney(Number(raw), currency, locale) : '—'

  const fallback = trendFailed || !trend
  const title = fallback ? t('admin.dashboard.sales.allTime') : t(`admin.dashboard.sales.title.${period}` as MessageKey)
  const amount = fallback ? money(kpis.sales, kpis.currency) : money(trend.sales, trend.currency)
  const delta = fallback ? null : salesDelta(trend)
  const up = (delta ?? 0) >= 0
  const deltaText = delta === null ? null : `${up ? '+' : '−'}${Math.abs(delta).toFixed(1)} %`

  const chartLabel = (() => {
    if (!trend || trend.series.length === 0) return ''
    const serie = t(trend.unit === 'month' ? 'admin.dashboard.sales.chart.month' : 'admin.dashboard.sales.chart.day')
    if (!trend.best || !trend.currency) return serie
    const best = t(trend.unit === 'month' ? 'admin.dashboard.sales.best.month' : 'admin.dashboard.sales.best.day')
    return `${serie}. ${best}: ${bucketLabel(trend.best.date, trend.unit, locale)}, ${formatMoney(Number(trend.best.sales), trend.currency, locale)}`
  })()

  return (
    <Card
      component="section"
      aria-labelledby="sales-hero-title"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        borderRadius: 1.25,
        // 2026-11-24: pastel del acento, no su degradado saturado. Con un
        // acento rojo la tarjeta entera parecía una alerta; la cifra de ventas
        // no es buena ni mala por el color de la marca.
        // Funciona en claro y oscuro: se mezcla con la superficie de tarjeta.
        background: `linear-gradient(135deg, color-mix(in srgb, ${C.accent} 20%, ${C.card}) 0%, color-mix(in srgb, ${C.accent} 7%, ${C.card}) 100%)`,
        color: C.ink,
        border: `1px solid ${LINE}`,
        boxShadow: SH.sm,
        p: { xs: 2.25, md: 3.5 },
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: { xs: 2.5, md: 4 },
        // Resplandor decorativo, del mismo acento del tenant.
        '&::after': {
          content: '""',
          position: 'absolute',
          right: -120,
          top: -160,
          width: 420,
          height: 420,
          borderRadius: '50%',
          background: `radial-gradient(closest-side, color-mix(in srgb, ${C.card} 55%, transparent), transparent)`,
          pointerEvents: 'none',
        },
      }}
    >
      <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: C.accent,
                color: C.white,
                '& .MuiSvgIcon-root': { fontSize: 17 },
              }}
            >
              <PaidRoundedIcon />
            </Box>
            <Typography
              id="sales-hero-title"
              component="h2"
              sx={{ fontSize: T.label, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT_SOFT }}
            >
              {title}
            </Typography>
          </Stack>

          {!trendFailed && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={period}
              aria-label={t('admin.dashboard.period.label')}
              onChange={(_, next: SalesPeriod | null) => next && onPeriodChange(next)}
              sx={{
                bgcolor: TINT(12),
                borderRadius: 999,
                p: 0.4,
                '& .MuiToggleButton-root': {
                  border: 'none',
                  borderRadius: '999px !important',
                  px: 1.4,
                  py: 0.4,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'none',
                  color: TEXT_SOFT,
                  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: C.card, color: C.accentDeep, boxShadow: SH.sm },
                },
              }}
            >
              {SALES_PERIODS.map((p) => (
                <ToggleButton key={p} value={p}>
                  {t(`admin.dashboard.period.${p}` as MessageKey)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </Stack>

        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography
            className="tnum"
            sx={{ fontSize: { xs: 34, md: 46 }, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05 }}
          >
            {amount}
          </Typography>
          {deltaText && (
            <Stack
              direction="row"
              spacing={0.5}
              aria-label={t('admin.dashboard.sales.delta').replace('{pct}', deltaText)}
              sx={{
                alignItems: 'center',
                px: 1.1,
                py: 0.35,
                borderRadius: 999,
                bgcolor: C.card,
                color: up ? C.green : C.red,
                '& .MuiSvgIcon-root': { fontSize: 16 },
              }}
            >
              {up ? <TrendingUpRoundedIcon aria-hidden /> : <TrendingDownRoundedIcon aria-hidden />}
              <Typography className="tnum" aria-hidden sx={{ fontSize: 13, fontWeight: 800 }}>
                {deltaText}
              </Typography>
            </Stack>
          )}
        </Stack>

        <Typography sx={{ fontSize: 13, color: TEXT_SOFT }}>
          {fallback
            ? kpis.sales === null
              ? t('admin.kpi.sales.none')
              : t('admin.dashboard.sales.unavailable')
            : delta === null
              ? t('admin.dashboard.sales.noPrevious')
              : t('admin.dashboard.sales.vsPrevious').replace('{amount}', money(trend.previous_sales, trend.currency))}
        </Typography>

        {!fallback && trend.series.length > 0 && <TrendBars trend={trend} label={chartLabel} />}
      </Stack>

      <Stack
        sx={{
          position: 'relative',
          zIndex: 1,
          width: { md: 230 },
          flexShrink: 0,
          // Las cifras se reparten todo el alto: arriba alineadas con el título,
          // abajo con el eje del gráfico. Centradas dejaban huecos en los dos extremos.
          justifyContent: { md: 'space-between' },
          gap: 2,
          pl: { md: 3.5 },
          pt: { xs: 2, md: 0 },
          borderLeft: { md: `1px solid ${LINE}` },
          borderTop: { xs: `1px solid ${LINE}`, md: 'none' },
          display: { xs: 'grid', md: 'flex' },
          gridTemplateColumns: { xs: 'repeat(auto-fit, minmax(140px, 1fr))' },
        }}
      >
        <Stat
          label={t('admin.kpi.avgTicket')}
          value={fallback ? money(kpis.avg_ticket, kpis.currency) : money(trend.avg_ticket, trend.currency)}
          hint={t('admin.kpi.avgTicket.hint')}
        />
        <Stat
          label={t('admin.kpi.orders')}
          value={String(fallback ? kpis.orders : trend.orders)}
          hint={fallback ? t('admin.dashboard.sales.allTime') : t('admin.dashboard.sales.ordersHint')}
        />
        {!fallback && (
          <Stat
            label={t(trend.unit === 'month' ? 'admin.dashboard.sales.avg.month' : 'admin.dashboard.sales.avg.day')}
            value={
              trend.currency && trend.series.length > 0
                ? formatMoney(Number(trend.sales) / trend.series.length, trend.currency, locale)
                : '—'
            }
            hint={t('admin.dashboard.sales.avg.hint')}
          />
        )}
        {!fallback && (
          <Stat
            label={t(trend.unit === 'month' ? 'admin.dashboard.sales.best.month' : 'admin.dashboard.sales.best.day')}
            value={trend.best && trend.currency ? formatMoney(Number(trend.best.sales), trend.currency, locale) : '—'}
            hint={trend.best ? bucketLabel(trend.best.date, trend.unit, locale) : t('admin.dashboard.sales.noBest')}
          />
        )}
      </Stack>
    </Card>
  )
}
