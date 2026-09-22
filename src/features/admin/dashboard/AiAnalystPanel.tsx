import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import type { AiErrorKind } from '@/features/ai/result'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon, type AppIconTone } from '@/shared/ui/AppIcon'
import { T } from '@/theme/tokens'
import {
  ANALYST_ROUTE_CAPABILITY,
  ANALYST_ROUTES,
  MAX_QUESTION,
  SUGGESTED_QUESTIONS,
  canRetryMotivo,
  renderAnalystText,
  type AnalystContext,
  type AnalystInsight,
  type AnalystModule,
  type Severity,
} from './aiAnalyst'
import { useAnalystSummary, useAskAnalyst } from './useAiAnalyst'

const SEVERITY_TONE: Record<Severity, AppIconTone> = { high: 'danger', medium: 'warning', low: 'info' }
const SEVERITY_ICON: Record<Severity, ReactNode> = {
  high: <ErrorOutlineRoundedIcon fontSize="small" />,
  medium: <ReportProblemOutlinedIcon fontSize="small" />,
  low: <InfoOutlinedIcon fontSize="small" />,
}

/** Texto del analista: las cifras salen de `metrics` y se marcan como dato. */
function AnalystText({ text, context }: { text: string; context: AnalystContext }) {
  const { t, locale } = useI18n()
  const parts = renderAnalystText(text, context, locale, { days: t('aiAnalyst.unit.days') })
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <Box
            key={i}
            component="strong"
            className={part.type === 'metric' ? 'tnum' : undefined}
            sx={{ fontWeight: 800 }}
          >
            {part.text}
          </Box>
        ),
      )}
    </>
  )
}

/** Enlace al módulo, solo si la sociedad lo tiene contratado. */
function ModuleLink({ module }: { module: AnalystModule }) {
  const { t } = useI18n()
  const { has } = useCapabilities()
  if (!has(ANALYST_ROUTE_CAPABILITY[module])) return null
  return (
    <Button
      component={RouterLink}
      to={ANALYST_ROUTES[module]}
      size="small"
      variant="outlined"
      endIcon={<ArrowForwardRoundedIcon />}
      sx={{ alignSelf: 'flex-start' }}
    >
      {`${t('aiAnalyst.goTo')} ${t(`aiAnalyst.module.${module}` as MessageKey)}`}
    </Button>
  )
}

/** Por qué no hay resultado, con salida accionable cuando la hay. */
function MotivoNotice({ motivo, onRetry }: { motivo: AiErrorKind; onRetry?: () => void }) {
  const { t } = useI18n()
  const info = motivo === 'sin_proveedor' || motivo === 'sin_contratar' || motivo === 'modulo_no_contratado'
  return (
    <Alert
      severity={info ? 'info' : 'warning'}
      action={
        onRetry && canRetryMotivo(motivo) ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    >
      {t(`ai.motivo.${motivo}` as MessageKey)}
    </Alert>
  )
}

function InsightCard({
  insight,
  context,
}: {
  insight: AnalystInsight
  context: AnalystContext
}) {
  const { t } = useI18n()
  const entity = insight.entity_ref ? context.entities[insight.entity_ref] : undefined
  return (
    <Card variant="outlined" sx={{ height: '100%' }} component="article">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <AppIcon tone={SEVERITY_TONE[insight.severity]} size="sm">
            {SEVERITY_ICON[insight.severity]}
          </AppIcon>
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" sx={{ fontSize: T.body, fontWeight: 800, lineHeight: 1.35 }}>
              <AnalystText text={insight.title} context={context} />
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>
              {t(`aiAnalyst.severity.${insight.severity}` as MessageKey)}
            </Typography>
          </Stack>
        </Stack>
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <AnalystText text={insight.explanation} context={context} />
        </Typography>
        {entity && (
          <Chip
            size="small"
            variant="outlined"
            label={`${t(`aiAnalyst.entity.${entity.kind}` as MessageKey)}: ${entity.label}`}
            sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
          />
        )}
        {insight.action_label && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
            <Box component="span" sx={{ fontWeight: 700 }}>
              {t('aiAnalyst.suggestion')}:
            </Box>{' '}
            <AnalystText text={insight.action_label} context={context} />
          </Typography>
        )}
        <Box sx={{ mt: 'auto', pt: 0.5 }}>
          <ModuleLink module={insight.module} />
        </Box>
      </CardContent>
    </Card>
  )
}

function SummarySkeleton() {
  return (
    <Grid container spacing={1.5} aria-hidden>
      {[0, 1, 2].map((i) => (
        <Grid item xs={12} md={4} key={i}>
          <Skeleton variant="rounded" height={132} />
        </Grid>
      ))}
    </Grid>
  )
}

function SummarySection({ storeId }: { storeId: string | null }) {
  const { t, locale } = useI18n()
  const summary = useAnalystSummary(storeId, locale)
  const result = summary.data
  const data = result?.data ?? null
  const busy = summary.isFetching
  const run = () => void summary.refetch()

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography component="h3" sx={{ fontSize: T.body, fontWeight: 800 }}>
          {t('aiAnalyst.subtitle')}
        </Typography>
        <Button
          variant={result ? 'text' : 'contained'}
          size="small"
          startIcon={<AutoAwesomeRoundedIcon />}
          onClick={run}
          disabled={busy}
        >
          {result ? t('aiAnalyst.regenerate') : t('aiAnalyst.generate')}
        </Button>
      </Stack>

      <Box aria-live="polite" aria-busy={busy}>
        {busy && (
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiAnalyst.generating')}</Typography>
            <SummarySkeleton />
          </Stack>
        )}

        {!busy && summary.isError && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={run}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiAnalyst.networkError')}
          </Alert>
        )}

        {!busy && !summary.isError && result?.motivo && <MotivoNotice motivo={result.motivo} onRetry={run} />}

        {!busy && !summary.isError && result && data && (
          <Stack spacing={1.25}>
            <Grid container spacing={1.5}>
              {data.insights.map((insight, i) => (
                <Grid item xs={12} md={6} lg={4} key={`${i}-${insight.title}`}>
                  <InsightCard insight={insight} context={data} />
                </Grid>
              ))}
            </Grid>
            <AiFeedbackButtons interactionId={result.interactionId} />
          </Stack>
        )}

        {!busy && !summary.isError && !result && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiAnalyst.costHint')}</Typography>
        )}
      </Box>
    </Stack>
  )
}

function AskSection({ storeId }: { storeId: string | null }) {
  const { t, locale } = useI18n()
  const ask = useAskAnalyst(storeId, locale)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const result = ask.data
  const tooLong = question.trim().length > MAX_QUESTION

  const send = (text: string) => {
    const q = text.trim()
    if (!q || q.length > MAX_QUESTION || ask.isPending) return
    setAsked(q)
    ask.mutate(q)
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(question)
  }

  return (
    <Stack spacing={1.25}>
      <Typography component="h3" sx={{ fontSize: T.body, fontWeight: 800 }}>
        {t('aiAnalyst.ask.title')}
      </Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiAnalyst.ask.suggested')}>
        {SUGGESTED_QUESTIONS.map((id) => {
          const label = t(`aiAnalyst.ask.q.${id}` as MessageKey)
          return (
            <Chip
              key={id}
              label={label}
              variant="outlined"
              clickable
              disabled={ask.isPending}
              onClick={() => {
                setQuestion(label)
                send(label)
              }}
            />
          )
        })}
      </Stack>
      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            fullWidth
            size="small"
            label={t('aiAnalyst.ask.label')}
            placeholder={t('aiAnalyst.ask.placeholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            error={tooLong}
            helperText={tooLong ? t('aiAnalyst.ask.tooLong') : undefined}
            inputProps={{ maxLength: MAX_QUESTION + 50 }}
          />
          <Button
            type="submit"
            variant="contained"
            endIcon={<SendRoundedIcon />}
            disabled={ask.isPending || !question.trim() || tooLong}
            sx={{ flexShrink: 0 }}
          >
            {t('aiAnalyst.ask.send')}
          </Button>
        </Stack>
      </Box>

      <Box aria-live="polite" aria-busy={ask.isPending}>
        {ask.isPending && (
          <Stack spacing={0.75}>
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiAnalyst.ask.thinking')}</Typography>
            <Skeleton variant="rounded" height={64} />
          </Stack>
        )}
        {!ask.isPending && ask.isError && (
          <Alert
            severity="error"
            action={
              asked ? (
                <Button color="inherit" size="small" onClick={() => send(asked)}>
                  {t('common.retry')}
                </Button>
              ) : undefined
            }
          >
            {t('aiAnalyst.networkError')}
          </Alert>
        )}
        {!ask.isPending && !ask.isError && result?.motivo && (
          <MotivoNotice motivo={result.motivo} onRetry={asked ? () => send(asked) : undefined} />
        )}
        {!ask.isPending && !ask.isError && result?.data && (
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {asked && (
                <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic' }}>{asked}</Typography>
              )}
              {!result.data.answerable && (
                <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{t('aiAnalyst.ask.notAnswerable')}</Typography>
              )}
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                <AnalystText text={result.data.answer} context={result.data} />
              </Typography>
              {result.data.module && <ModuleLink module={result.data.module} />}
              <AiFeedbackButtons interactionId={result.interactionId} />
            </CardContent>
          </Card>
        )}
      </Box>
    </Stack>
  )
}

/**
 * «Resumen inteligente» del dashboard (fase 02, Analista IA).
 *
 * Complementa —no sustituye— los KPIs y avisos deterministas: se monta DEBAJO
 * del `InsightBanner` y nada de la pantalla depende de él. Estados:
 *  - rol sin la funcionalidad `insights` → no se pinta (no se ofrece lo que no
 *    se puede usar);
 *  - no contratado / sin cuota → aviso, sin botón que gaste;
 *  - disponible → botón bajo demanda (cada análisis gasta cuota), carga,
 *    error de red con reintento y motivo tipado con reintento si procede.
 */
export function AiAnalystPanel({ storeId }: { storeId: string | null }) {
  const { t } = useI18n()
  const { availability } = useAiFeature('insights')

  if (availability === 'forbidden' || availability === 'loading') return null

  return (
    <Card component="section" aria-labelledby="ai-analyst-title" sx={{ borderColor: 'var(--accent)' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <AppIcon tone="accent" size="sm">
            <AutoAwesomeRoundedIcon fontSize="small" />
          </AppIcon>
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography id="ai-analyst-title" component="h2" sx={{ fontSize: T.cardTitle, fontWeight: 800 }}>
                {t('aiAnalyst.title')}
              </Typography>
              <Chip size="small" label={t('aiAnalyst.badge')} color="primary" variant="outlined" />
            </Stack>
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiAnalyst.description')}</Typography>
          </Stack>
        </Stack>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

        {availability === 'available' && (
          <>
            <SummarySection storeId={storeId} />
            <Divider />
            <AskSection storeId={storeId} />
            <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiAnalyst.disclaimer')}</Typography>
          </>
        )}
      </CardContent>
    </Card>
  )
}
