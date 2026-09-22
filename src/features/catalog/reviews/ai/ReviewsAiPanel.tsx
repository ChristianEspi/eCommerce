import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded'
import { Alert, Box, Button, Card, Chip, Skeleton, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatMetric } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { ContentMotivoNotice } from '@/features/ai/content/contentParts'
import { aiEntitlementKey, useAiFeature } from '@/features/ai/hooks'
import { MarkerText, SeverityIcon } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import {
  MAX_REVIEWS_QUESTION,
  REVIEW_HIGHLIGHTS,
  fetchReviewSignals,
  requestReviewsInsight,
  type ReviewsInsight,
  type ReviewsSystem,
} from './reviewsAi'

const QUESTIONS = ['aiReviews.q.themes', 'aiReviews.q.negative', 'aiReviews.q.attention', 'aiReviews.q.product'] as const

/**
 * Reseñas con IA (fase 09): CÁLCULO DEL SISTEMA + INTERPRETACIÓN IA agregada.
 *
 * Plegado por defecto: abrir la cola no pide nada. Al desplegar se cargan las
 * cifras y señales del sistema (sin cuota); el análisis se pide con un botón.
 * Las reseñas señaladas ofrecen «Borrador de respuesta» (que se copia) — nunca
 * publicar, rechazar, ocultar ni borrar: eso sigue en los botones de la cola.
 */
export function ReviewsAiPanel({
  storeId,
  onReply,
}: {
  storeId: string
  /** Abre el borrador de respuesta de una reseña (por su id). */
  onReply: (reviewId: string) => void
}) {
  const { t } = useI18n()
  const { availability } = useAiFeature('reviews')
  const [open, setOpen] = useState(false)
  if (availability === 'forbidden' || availability === 'loading') return null

  return (
    <Card sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <AutoAwesomeRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)' }} aria-hidden />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{t('aiReviews.title')}</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiReviews.subtitle')}</Typography>
        </Box>
        <Button
          size="small"
          onClick={() => setOpen((v) => !v)}
          endIcon={open ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
          aria-expanded={open}
        >
          {open ? t('aiContent.hide') : t('aiContent.show')}
        </Button>
      </Stack>
      {open && <Body storeId={storeId} availability={availability} onReply={onReply} />}
    </Card>
  )
}

function Body({
  storeId,
  availability,
  onReply,
}: {
  storeId: string
  availability: ReturnType<typeof useAiFeature>['availability']
  onReply: (reviewId: string) => void
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [question, setQuestion] = useState('')

  const signals = useQuery({
    queryKey: ['ai', 'reviews', 'signals', storeId, locale],
    queryFn: () => fetchReviewSignals(storeId, locale),
    staleTime: 60_000,
  })
  const insight = useMutation({
    mutationFn: (q: string | null) => requestReviewsInsight({ storeId, locale, question: q }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })

  const system = insight.data?.system ?? signals.data ?? null
  const result = insight.data?.result
  const canAsk = availability === 'available'
  const empty = system !== null && system.sample.length === 0

  const ask = (q: string | null) => insight.mutate(q)

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Alert severity="info">{t('aiReviews.disclaimer')}</Alert>

      {signals.isPending ? (
        <Skeleton variant="rounded" height={80} />
      ) : signals.isError ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void signals.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('aiContent.networkError')}
        </Alert>
      ) : system ? (
        <SystemBlock system={system} />
      ) : null}

      {availability === 'not_entitled' && <ContentMotivoNotice motivo="sin_contratar" />}
      {availability === 'quota_exhausted' && <ContentMotivoNotice motivo="sin_cuota" />}

      {canAsk && !empty && system && (
        <Stack spacing={1}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {QUESTIONS.map((key) => (
              <Chip
                key={key}
                label={t(key)}
                variant="outlined"
                onClick={() => {
                  setQuestion(t(key))
                  ask(t(key))
                }}
                disabled={insight.isPending}
              />
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              label={t('aiReviews.ask.label')}
              placeholder={t('aiReviews.ask.placeholder')}
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, MAX_REVIEWS_QUESTION))}
              inputProps={{ maxLength: MAX_REVIEWS_QUESTION }}
            />
            <Button
              variant="contained"
              startIcon={<AutoAwesomeRoundedIcon />}
              disabled={insight.isPending}
              onClick={() => ask(question.trim() || null)}
              sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {t('aiReviews.analyze')}
            </Button>
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiContent.costHint')}</Typography>
        </Stack>
      )}
      {empty && <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiReviews.empty')}</Typography>}

      <Box aria-live="polite">
        {insight.isPending && (
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiContent.generating')}</Typography>
            <Skeleton variant="rounded" height={120} />
          </Stack>
        )}
        {insight.isError && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => ask(question.trim() || null)}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiContent.networkError')}
          </Alert>
        )}
        {!insight.isPending && result?.motivo && (
          <ContentMotivoNotice motivo={result.motivo} onRetry={() => ask(question.trim() || null)} />
        )}
      </Box>

      {!insight.isPending && result?.data && (
        <InsightView insight={result.data} onReply={onReply} interactionId={result.interactionId} />
      )}
    </Stack>
  )
}

function SystemBlock({ system }: { system: ReviewsSystem }) {
  const { t, locale } = useI18n()
  const days = t('aiOrders.unit.days')
  return (
    <Stack spacing={1}>
      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{t('aiReviews.system.title')}</Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiReviews.system.help')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 1 }}>
        {REVIEW_HIGHLIGHTS.filter((k) => k in system.metrics).map((k) => (
          <Box key={k} sx={{ border: '1px solid var(--border)', borderRadius: 1.5, px: 1.25, py: 0.75 }}>
            <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t(`aiReviews.metric.${k}` as MessageKey)}</Typography>
            <Typography className="tnum" sx={{ fontWeight: 800 }}>
              {formatMetric(system.metrics[k]!, locale, { days })}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: 13 }}>
        {t('aiReviews.systemTone')}: <strong>{t(`aiReviews.tone.${system.system_tone}` as MessageKey)}</strong>
      </Typography>
      {system.signals.length > 0 && (
        <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
          {system.signals.map((s, i) => (
            <Stack component="li" key={`${s.code}-${s.ref ?? i}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <SeverityIcon severity={s.severity} />
              <Typography sx={{ fontSize: 13 }}>
                {t(`aiReviews.signal.${s.code}` as MessageKey)}
                {s.ref && system.entities[s.ref] ? ` · ${system.entities[s.ref]!.label}` : ''}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

function InsightView({
  insight,
  onReply,
  interactionId,
}: {
  insight: ReviewsInsight
  onReply: (reviewId: string) => void
  interactionId: string | null
}) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.5}>
      {insight.overview && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiReviews.section.overview')}</Typography>
          <Typography sx={{ fontSize: 14 }}>
            <MarkerText text={insight.overview} context={insight} />
          </Typography>
        </Box>
      )}
      <Typography sx={{ fontSize: 13 }}>
        {t('aiReviews.aiTone')}: <strong>{t(`aiReviews.tone.${insight.tone}` as MessageKey)}</strong>
        {insight.tone_overridden && (
          <Box component="span" sx={{ color: 'var(--muted)' }}>
            {' '}
            — {t('aiReviews.toneOverridden')}
          </Box>
        )}
      </Typography>
      {insight.answer && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiReviews.section.answer')}</Typography>
          <Typography sx={{ fontSize: 14 }}>
            <MarkerText text={insight.answer} context={insight} />
          </Typography>
        </Box>
      )}
      {insight.themes.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiReviews.section.themes')}</Typography>
          <Stack spacing={1}>
            {insight.themes.map((theme) => (
              <Box key={theme.label} sx={{ border: '1px solid var(--border)', borderRadius: 1.5, p: 1.25 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 700 }}>{theme.label}</Typography>
                  <Chip size="small" label={t(`aiReviews.sentiment.${theme.sentiment}` as MessageKey)} />
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                    {t('aiReviews.evidence').replace('{n}', String(theme.refs.length))}
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: 13.5, mt: 0.5 }}>
                  <MarkerText text={theme.text} context={insight} />
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
      {insight.attention.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiReviews.section.attention')}</Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mb: 0.5 }}>{t('aiReviews.attention.help')}</Typography>
          <Stack spacing={1}>
            {insight.attention.map((a) => (
              <Stack
                key={a.ref}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ border: '1px solid var(--border)', borderRadius: 1.5, p: 1.25, alignItems: { sm: 'center' } }}
              >
                <Box sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{insight.entities[a.ref]?.label ?? a.ref}</Typography>
                    <Chip size="small" variant="outlined" label={t(`aiReviews.reason.${a.reason}` as MessageKey)} />
                  </Stack>
                  <Typography sx={{ fontSize: 13 }}>
                    <MarkerText text={a.text} context={insight} />
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<RateReviewRoundedIcon fontSize="small" />}
                  onClick={() => onReply(a.review_id)}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {t('aiReviews.reply.open')}
                </Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
      {insight.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiContent.discarded').replace('{n}', String(insight.discarded))}
        </Typography>
      )}
      <AiFeedbackButtons interactionId={interactionId} />
    </Stack>
  )
}
