import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { formatMetric, type Metric } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { MarkerText, MotivoNotice, SeverityIcon } from '@/features/orders/ai/parts'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon } from '@/shared/ui/AppIcon'
import { Field } from '@/shared/ui/Field'
import { StatusChip, type StatusTone } from '@/shared/ui/StatusChip'
import { T } from '@/theme/tokens'
import {
  MAX_PLANNING_QUESTION,
  type PlanningAiSeverity,
  type PlanningAiSignal,
  type ForecastInsight,
  type ForecastSystem,
  type PlanningAiContext,
} from './planningAi'
import { useForecastInsight, useForecastSignals } from './usePlanningAi'

export const PLANNING_QUESTIONS = ['summary', 'why_off', 'seasonality', 'trend'] as const
type PlanningQuestion = (typeof PLANNING_QUESTIONS)[number]

function Bloque({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography
        component="h4"
        sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  )
}

function Cifra({ label, metric }: { label: string; metric: Metric | undefined }) {
  const { t, locale } = useI18n()
  if (!metric) return null
  return (
    <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
      {label}{' '}
      <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
        {formatMetric(metric, locale, { days: t('aiOrders.unit.days') })}
      </Box>
    </Typography>
  )
}

/** Tono de cada señal: el texto nombra, el color solo acompaña. */
const SIGNAL_TONE: Readonly<Record<PlanningAiSignal, StatusTone>> = {
  forecast_over: 'warning',
  forecast_under: 'warning',
  no_recent_sales: 'error',
  trend_up: 'success',
  trend_down: 'warning',
  no_forecast: 'default',
  seasonal_peak: 'info',
  seasonal_low: 'info',
  low_confidence: 'default',
}

/** Qué le pasa a cada producto: así se agrupa la lista del sistema. */
const GROUPS = ['deviation', 'stalled', 'trend', 'coverage'] as const
type Group = (typeof GROUPS)[number]
function groupOf(signals: readonly PlanningAiSignal[]): Group {
  if (signals.includes('forecast_over') || signals.includes('forecast_under')) return 'deviation'
  if (signals.includes('no_recent_sales')) return 'stalled'
  if (signals.some((s) => s === 'trend_up' || s === 'trend_down' || s === 'seasonal_peak' || s === 'seasonal_low')) {
    return 'trend'
  }
  return 'coverage'
}
const SEVERITY_ORDER: Readonly<Record<PlanningAiSeverity, number>> = { high: 0, medium: 1, low: 2 }

type SystemItem = ForecastSystem['items'][number]

/** El nombre del producto, enlazado a su ficha en Catálogo. */
function ProductName({ item }: { item: Pick<SystemItem, 'product_id' | 'name'> & { sku?: string | null } }) {
  const { t } = useI18n()
  return (
    <Stack direction="row" useFlexGap spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
      <Link
        component={RouterLink}
        to={`/app/products?producto=${item.product_id}`}
        title={t('aiPlanning.openProduct')}
        underline="hover"
        sx={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', '&:hover': { color: 'var(--accent-deep)' } }}
      >
        {item.name}
      </Link>
      {item.sku && (
        <Typography component="span" className="tnum" sx={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {item.sku}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * Lleva a la pestaña Previsión filtrada por ESE producto (2026-11-23). Solo
 * aparece si el producto tiene previsión: sin ella no hay nada que abrir y el
 * nombre ya lleva a la ficha.
 */
function ViewForecastButton({ item }: { item: SystemItem }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  if (!item.has_forecast) return null
  return (
    <Button
      size="small"
      variant="outlined"
      endIcon={<ArrowForwardRoundedIcon />}
      title={t('aiPlanning.viewForecastHint')}
      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
      onClick={() => {
        // SectionTabs escucha `hashchange`: cambiar el hash ES cambiar de pestaña.
        navigate({ search: `?buscar=${encodeURIComponent(item.name)}` })
        window.location.hash = 'prevision'
      }}
    >
      {t('aiPlanning.viewForecast')}
    </Button>
  )
}

/** Un periodo previsto: fechas, fase y previsto/real/desvío en una línea. */
function PeriodRow({ forecast, system }: { forecast: SystemItem['forecasts'][number]; system: ForecastSystem }) {
  const { t } = useI18n()
  const m = system.metrics
  return (
    <Stack
      component="li"
      direction="row"
      useFlexGap
      spacing={1.25}
      sx={{ alignItems: 'center', flexWrap: 'wrap', px: 1, py: 0.5, borderRadius: 1.5, bgcolor: 'var(--neutral-soft)' }}
    >
      <Typography component="span" className="tnum" sx={{ fontSize: 12, fontWeight: 700 }}>
        {system.entities[forecast.ref]?.label ?? '—'}
      </Typography>
      <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>
        {t(`aiPlanning.phase.${forecast.phase}` as MessageKey)}
      </Typography>
      <Cifra label={t('aiPlanning.figure.forecast')} metric={m[`${forecast.ref}_forecast`]} />
      <Cifra label={t('aiPlanning.figure.actual')} metric={m[`${forecast.ref}_actual`]} />
      <Cifra label={t('aiPlanning.figure.error')} metric={m[`${forecast.ref}_error_pct`]} />
    </Stack>
  )
}

/**
 * CÁLCULO DEL SISTEMA: previsión existente frente a venta, por regla.
 *
 * 2026-11-23 · Agrupado por lo que le pasa al producto (previsión desviada,
 * sin ventas, cambio de ritmo, sin previsión) y, dentro, de más a menos grave.
 * Antes era una lista corrida con el modelo técnico arriba y los periodos en
 * una viñeta ilegible. Cada fila: nombre enlazado a la ficha, señales en
 * chips tonales, cifras en una línea y «Ver previsión» a la derecha.
 */
function SystemBlock({ system }: { system: ForecastSystem }) {
  const { t } = useI18n()
  if (system.items.length === 0) {
    return <Typography sx={{ fontSize: 13 }}>{t('aiPlanning.system.none')}</Typography>
  }
  const m = system.metrics
  const grupos = GROUPS.map((g) => ({
    group: g,
    items: system.items
      .filter((i) => groupOf(i.signals) === g)
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
  })).filter((g) => g.items.length > 0)

  return (
    <Stack spacing={2.5}>
      {grupos.map(({ group, items }) => (
        <Box component="section" key={group} aria-labelledby={`ai-plan-group-${group}`}>
          <Typography
            id={`ai-plan-group-${group}`}
            component="h4"
            sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', mb: 1 }}
          >
            {t(`aiPlanning.group.${group}` as MessageKey)}{' '}
            <Box component="span" className="tnum" sx={{ color: 'var(--text)' }}>
              · {items.length}
            </Box>
          </Typography>
          <Box
            component="ul"
            sx={{ m: 0, p: 0, listStyle: 'none', border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}
          >
            {items.map((item, index) => (
              <Box
                component="li"
                key={item.ref}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'auto 1fr', sm: 'auto 1fr auto' },
                  columnGap: 1.5,
                  rowGap: 1,
                  alignItems: 'center',
                  px: 1.5,
                  py: 1.25,
                  borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <SeverityIcon severity={item.severity} />
                <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                  <ProductName item={item} />
                  <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {item.signals.length === 0 ? (
                      <StatusChip label={t('aiPlanning.system.noSignals')} />
                    ) : (
                      item.signals.map((s) => (
                        <StatusChip key={s} tone={SIGNAL_TONE[s]} label={t(`aiPlanning.signal.${s}` as MessageKey)} />
                      ))
                    )}
                    <Cifra label={t('aiPlanning.figure.sold_30d')} metric={m[`${item.ref}_sold_30d`]} />
                    <Cifra label={t('aiPlanning.figure.prev_30d')} metric={m[`${item.ref}_prev_30d`]} />
                    <Cifra label={t('aiPlanning.figure.trend')} metric={m[`${item.ref}_trend_pct`]} />
                    {item.seasonal.applied ? (
                      <Cifra label={t('aiPlanning.figure.season')} metric={m[`${item.ref}_season_factor`]} />
                    ) : (
                      item.seasonal.reason && (
                        <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>
                          {t('aiPlanning.figure.noSeason')}: {t(`planning.v2.seasonalWhy.${item.seasonal.reason}` as MessageKey)}
                        </Typography>
                      )
                    )}
                  </Stack>
                  {item.forecasts.length > 0 && (
                    <Stack
                      component="ul"
                      spacing={0.5}
                      sx={{ m: 0, p: 0, listStyle: 'none' }}
                      aria-label={t('aiPlanning.system.periods')}
                    >
                      {item.forecasts.map((f) => (
                        <PeriodRow key={f.ref} forecast={f} system={system} />
                      ))}
                    </Stack>
                  )}
                </Stack>
                <Box sx={{ gridColumn: { xs: '2', sm: 'auto' }, justifySelf: { xs: 'start', sm: 'end' } }}>
                  <ViewForecastButton item={item} />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  )
}

function InsightView({ data, context }: { data: ForecastInsight; context: PlanningAiContext }) {
  const { t } = useI18n()
  const textos: Array<[MessageKey, string]> = [
    ['aiPlanning.section.answer', data.answer],
    ['aiPlanning.section.overview', data.overview],
    ['aiPlanning.section.trend', data.trend],
    ['aiPlanning.section.seasonality', data.seasonality],
    ['aiPlanning.section.forecastVsSales', data.forecast_vs_sales],
  ]
  return (
    <Stack spacing={1.75}>
      {textos
        .filter(([, text]) => text)
        .map(([key, text]) => (
          <Bloque key={key} title={t(key)}>
            <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
              <MarkerText text={text} context={context} />
            </Typography>
          </Bloque>
        ))}
      {data.anomalies.length > 0 && (
        <Bloque title={t('aiPlanning.section.anomalies')}>
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {data.anomalies.map((a) => (
              <Stack component="li" key={`${a.ref}-${a.signal}`} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <SeverityIcon severity={a.severity} />
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" useFlexGap spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <ProductName item={a} />
                    <StatusChip tone={SIGNAL_TONE[a.signal]} label={t(`aiPlanning.signal.${a.signal}` as MessageKey)} />
                  </Stack>
                  <Typography sx={{ fontSize: 13 }}>
                    <MarkerText text={a.explanation} context={context} />
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Bloque>
      )}
      {data.factors.length > 0 && (
        <Bloque title={t('aiPlanning.section.factors')}>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {data.factors.map((f, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 13 }}>
                <MarkerText text={f} context={context} />
              </Typography>
            ))}
          </Stack>
        </Bloque>
      )}
      {data.limitations && (
        <Bloque title={t('aiPlanning.section.limitations')}>
          <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
            <MarkerText text={data.limitations} context={context} />
          </Typography>
        </Bloque>
      )}
      {data.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiOrders.discarded').replace('{n}', String(data.discarded))}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * Pestaña «Análisis IA» de Planificación (fase 05).
 *
 *  - **Cálculo del sistema** (al abrir, sin cuota): la previsión existente
 *    frente a la venta real, tendencia, temporada (regla de
 *    `history_seasonal_v2`) y señales por regla.
 *  - **Interpretación IA** (bajo demanda): tendencia, estacionalidad,
 *    anomalías, previsión frente a venta y factores observables.
 *
 * La IA no produce previsiones ni cantidades; no hay nada que guardar aquí.
 */
export function PlanningAiSection() {
  const { t, locale } = useI18n()
  const { activeStore } = useTenant()
  const storeId = activeStore?.id ?? null
  const { availability } = useAiFeature('planning')
  const visible = availability !== 'forbidden' && availability !== 'loading'
  const signals = useForecastSignals(storeId, locale, visible)
  const insight = useForecastInsight(locale)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{ q: string | null } | null>(null)

  if (!visible || !storeId) return null

  const canAsk = availability === 'available'
  const tooLong = question.trim().length > MAX_PLANNING_QUESTION
  const run = (q: string | null) => {
    if (!canAsk || insight.isPending) return
    setAsked({ q })
    insight.mutate({ storeId, question: q })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const q = question.trim()
    if (!q || tooLong) return
    run(q)
  }
  const result = insight.data?.result
  const vacio = signals.isSuccess && signals.data !== null && signals.data.items.length === 0

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <AppIcon tone="accent" size="sm">
          <AutoAwesomeRoundedIcon fontSize="small" />
        </AppIcon>
        <Stack sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography component="h2" sx={{ fontSize: T.body, fontWeight: 800 }}>
              {t('aiPlanning.title')}
            </Typography>
            <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiPlanning.description')}</Typography>
        </Stack>
      </Stack>

      <Card variant="outlined" component="section" aria-labelledby="ai-planning-system">
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography id="ai-planning-system" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
            {t('aiPlanning.system.title')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiPlanning.system.help')}</Typography>
          <Box aria-live="polite" aria-busy={signals.isPending}>
            {signals.isPending && <Skeleton variant="rounded" height={96} />}
            {signals.isError && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void signals.refetch()}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiPlanning.system.error')}
              </Alert>
            )}
            {signals.isSuccess && signals.data && <SystemBlock system={signals.data} />}
            {signals.isSuccess && !signals.data && <Alert severity="warning">{t('aiPlanning.system.error')}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Divider />

      <Stack spacing={1.5} component="section" aria-labelledby="ai-planning-ai">
        <Typography id="ai-planning-ai" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
          {t('aiPlanning.ai.title')}
        </Typography>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}
        {canAsk && vacio && <Typography sx={{ fontSize: 13 }}>{t('aiPlanning.ai.nothing')}</Typography>}

        {canAsk && !vacio && (
          <>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiOrders.suggested')}>
              {PLANNING_QUESTIONS.map((id: PlanningQuestion) => {
                const label = t(`aiPlanning.q.${id}` as MessageKey)
                return (
                  <Chip
                    key={id}
                    label={label}
                    variant="outlined"
                    clickable
                    icon={id === 'summary' ? <AutoAwesomeRoundedIcon fontSize="small" /> : undefined}
                    disabled={insight.isPending}
                    onClick={() => run(id === 'summary' ? null : label)}
                  />
                )
              })}
            </Stack>
            <Box component="form" onSubmit={onSubmit} noValidate>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <Field
                  fullWidth
                  size="small"
                  rule="text"
                  maxLength={MAX_PLANNING_QUESTION + 50}
                  label={t('aiPlanning.ask.label')}
                  placeholder={t('aiPlanning.ask.placeholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiPlanning.costHint')}
                />
                <Button
                  type="submit"
                  variant="contained"
                  endIcon={<SendRoundedIcon />}
                  disabled={insight.isPending || !question.trim() || tooLong}
                  sx={{ flexShrink: 0 }}
                >
                  {t('aiOrders.ask.send')}
                </Button>
              </Stack>
            </Box>
          </>
        )}

        <Box aria-live="polite" aria-busy={insight.isPending}>
          {insight.isPending && (
            <Stack spacing={0.75}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiPlanning.generating')}</Typography>
              <Skeleton variant="rounded" height={120} />
            </Stack>
          )}
          {!insight.isPending && insight.isError && (
            <Alert
              severity="error"
              action={
                asked ? (
                  <Button color="inherit" size="small" onClick={() => run(asked.q)}>
                    {t('common.retry')}
                  </Button>
                ) : undefined
              }
            >
              {t('aiPlanning.networkError')}
            </Alert>
          )}
          {!insight.isPending && !insight.isError && result?.motivo && (
            <MotivoNotice motivo={result.motivo} onRetry={asked ? () => run(asked.q) : undefined} />
          )}
          {!insight.isPending && !insight.isError && result?.data && (
            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {asked?.q && (
                  <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic' }}>{asked.q}</Typography>
                )}
                <InsightView data={result.data} context={result.data} />
                <AiFeedbackButtons interactionId={result.interactionId} />
              </CardContent>
            </Card>
          )}
        </Box>
        <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiPlanning.disclaimer')}</Typography>
      </Stack>
    </Stack>
  )
}
