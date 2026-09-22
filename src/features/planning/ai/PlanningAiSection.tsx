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
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type FormEvent, type ReactNode } from 'react'
import { formatMetric, type Metric } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { MarkerText, MotivoNotice, SeverityIcon } from '@/features/orders/ai/parts'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon } from '@/shared/ui/AppIcon'
import { T } from '@/theme/tokens'
import {
  MAX_PLANNING_QUESTION,
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
    <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>
      {label}:{' '}
      <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
        {formatMetric(metric, locale, { days: t('aiOrders.unit.days') })}
      </Box>
    </Typography>
  )
}

/** CÁLCULO DEL SISTEMA: previsión existente frente a venta, por regla. */
function SystemBlock({ system }: { system: ForecastSystem }) {
  const { t } = useI18n()
  if (system.items.length === 0) {
    return <Typography sx={{ fontSize: 13 }}>{t('aiPlanning.system.none')}</Typography>
  }
  const m = system.metrics
  return (
    <Stack spacing={1.25}>
      {system.models.length > 0 && (
        <Typography sx={{ fontSize: 12.5 }}>
          {t('aiPlanning.system.models')}:{' '}
          <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
            {system.models.join(', ')}
          </Box>
        </Typography>
      )}
      <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {system.items.map((item) => (
          <Stack
            component="li"
            key={item.ref}
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'flex-start', borderBottom: '1px solid var(--border)', pb: 1.25 }}
          >
            <SeverityIcon severity={item.severity} />
            <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
                {item.name}{' '}
                {item.sku && (
                  <Box component="span" sx={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400 }}>
                    {item.sku}
                  </Box>
                )}
              </Typography>
              <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                {item.signals.length === 0 ? (
                  <Chip size="small" variant="outlined" label={t('aiPlanning.system.noSignals')} />
                ) : (
                  item.signals.map((s) => (
                    <Chip key={s} size="small" variant="outlined" label={t(`aiPlanning.signal.${s}` as MessageKey)} />
                  ))
                )}
              </Stack>
              <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
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
                <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }} aria-label={t('aiPlanning.system.periods')}>
                  {item.forecasts.map((f) => (
                    <Typography component="li" key={f.ref} sx={{ fontSize: 12 }}>
                      <Box component="span" className="tnum">
                        {system.entities[f.ref]?.label ?? '—'}
                      </Box>{' '}
                      · {t(`aiPlanning.phase.${f.phase}` as MessageKey)} ·{' '}
                      <Cifra label={t('aiPlanning.figure.forecast')} metric={m[`${f.ref}_forecast`]} />{' '}
                      <Cifra label={t('aiPlanning.figure.actual')} metric={m[`${f.ref}_actual`]} />{' '}
                      <Cifra label={t('aiPlanning.figure.error')} metric={m[`${f.ref}_error_pct`]} />
                      {f.anomaly && (
                        <Box component="strong" sx={{ ml: 0.75 }}>
                          {t(`aiPlanning.signal.${f.anomaly}` as MessageKey)}
                        </Box>
                      )}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Stack>
          </Stack>
        ))}
      </Stack>
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
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                    {a.name} · {t(`aiPlanning.signal.${a.signal}` as MessageKey)}
                  </Typography>
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
                <TextField
                  fullWidth
                  size="small"
                  label={t('aiPlanning.ask.label')}
                  placeholder={t('aiPlanning.ask.placeholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiPlanning.costHint')}
                  inputProps={{ maxLength: MAX_PLANNING_QUESTION + 50 }}
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
