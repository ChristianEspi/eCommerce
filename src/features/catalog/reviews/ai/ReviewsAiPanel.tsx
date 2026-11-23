import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded'
import { Alert, Box, Button, Card, Chip, Skeleton, Stack, Typography } from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatMetric } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { ContentMotivoNotice } from '@/features/ai/content/contentParts'
import { aiEntitlementKey, useAiFeature } from '@/features/ai/hooks'
import { MarkerText, SeverityIcon } from '@/features/orders/ai/parts'
import { proposeAction } from '@/features/ai/actions/api'
import { AI_ACTIONS_QUERY_KEY } from '@/features/ai/actions/keys'
import { useTenant } from '@/features/tenant/tenant-context'
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
            <Field
              size="small"
              fullWidth
              rule="text"
              maxLength={MAX_REVIEWS_QUESTION}
              label={t('aiReviews.ask.label')}
              placeholder={t('aiReviews.ask.placeholder')}
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, MAX_REVIEWS_QUESTION))}
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

      {/* El alcance de la IA, una vez y en voz baja: antes era un aviso azul
          arriba que competía con el de «no contratado» (2026-11-22). */}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'var(--muted)' }}>
        <InfoOutlinedIcon sx={{ fontSize: 16, mt: '2px', flexShrink: 0 }} aria-hidden />
        <Typography sx={{ fontSize: 12, lineHeight: 1.5 }}>{t('aiReviews.disclaimer')}</Typography>
      </Stack>
    </Stack>
  )
}

/**
 * Las nueve cifras en tres grupos que se leen de un vistazo (2026-11-22):
 * cuántas hay, cómo puntúan y qué falta atender. Antes eran nueve cajitas
 * sueltas de anchos distintos.
 */
const METRIC_GROUPS = [
  { key: 'volume', metrics: ['total', 'average', 'published_average'] },
  { key: 'stars', metrics: ['positive', 'neutral', 'negative'] },
  { key: 'attention', metrics: ['pending', 'pending_stale', 'contact_like'] },
] as const satisfies ReadonlyArray<{ key: string; metrics: ReadonlyArray<(typeof REVIEW_HIGHLIGHTS)[number]> }>

/** Lo que, distinto de cero, pide que alguien mire. Solo decora: la cifra y su etiqueta lo dicen igual. */
const ALERT_METRICS: ReadonlySet<string> = new Set(['negative', 'pending_stale', 'contact_like'])

const TONE_STYLE: Record<string, { bg: string; fg: string }> = {
  positive: { bg: 'var(--accent-soft)', fg: 'var(--accent-deep)' },
  mixed: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  negative: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  insufficient: { bg: 'transparent', fg: 'var(--muted)' },
}

function SystemBlock({ system }: { system: ReviewsSystem }) {
  const { t, locale } = useI18n()
  const days = t('aiOrders.unit.days')
  const tone = TONE_STYLE[system.system_tone] ?? { bg: 'transparent', fg: 'var(--muted)' }
  // «Pocas reseñas» ya lo dice el tono: la señal repetida debajo era ruido.
  const signals = system.signals.filter((s) => !(s.code === 'few_reviews' && system.system_tone === 'insufficient'))
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography component="h3" sx={{ fontWeight: 800, fontSize: 13 }}>
          {t('aiReviews.system.title')}
        </Typography>
        <Box
          component="span"
          sx={{
            px: 1,
            py: 0.25,
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            bgcolor: tone.bg,
            color: tone.fg,
            border: '1px solid var(--border)',
          }}
        >
          {t('aiReviews.systemTone')}: {t(`aiReviews.tone.${system.system_tone}` as MessageKey)}
        </Box>
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: -0.5 }}>{t('aiReviews.system.help')}</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
        {METRIC_GROUPS.map((group) => {
          const shown = group.metrics.filter((k) => k in system.metrics)
          if (shown.length === 0) return null
          const title = t(`aiReviews.group.${group.key}` as MessageKey)
          return (
            <Box
              key={group.key}
              component="section"
              aria-label={title}
              sx={{ border: '1px solid var(--border)', borderRadius: 2, px: 1.5, py: 1.25, minWidth: 0 }}
            >
              <Typography
                sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75 }}
              >
                {title}
              </Typography>
              <Box
                component="dl"
                sx={{ m: 0, display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: 1 }}
              >
                {shown.map((k) => {
                  const metric = system.metrics[k]!
                  const n = Number(metric.value)
                  const zero = Number.isFinite(n) && n === 0
                  const alert = !zero && ALERT_METRICS.has(k)
                  return (
                    <Box key={k} sx={{ minWidth: 0 }}>
                      <Typography component="dt" sx={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.3 }}>
                        {t(`aiReviews.metric.${k}` as MessageKey)}
                      </Typography>
                      <Typography
                        component="dd"
                        className="tnum"
                        sx={{
                          m: 0,
                          mt: 0.25,
                          fontSize: 20,
                          lineHeight: 1.2,
                          fontWeight: zero ? 600 : 800,
                          color: alert ? 'var(--red)' : zero ? 'var(--muted)' : 'var(--text)',
                        }}
                      >
                        {formatMetric(metric, locale, { days })}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          )
        })}
      </Box>

      {signals.length > 0 && (
        <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
          {signals.map((s, i) => (
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

/**
 * 2026-11-19 · Motivos que justifican RECHAZAR una reseña. Lo demás (queja del
 * producto, de la entrega…) se responde, no se esconde.
 */
const MODERATION_REASONS: ReadonlySet<string> = new Set(['personal_data', 'offensive_language', 'possible_spam', 'off_topic'])

/**
 * Deja armado el rechazo para que alguien con rol de catálogo lo apruebe en
 * «Acciones de la IA». La base comprueba que la reseña es de esta sociedad y
 * sigue pendiente; aprobar usa la moderación de siempre.
 */
function ProposeRejectButton({
  reviewId,
  label,
  reason,
  interactionId,
}: {
  reviewId: string
  label: string
  reason: string
  interactionId: string | null
}) {
  const { t } = useI18n()
  const { can } = useTenant()
  const queryClient = useQueryClient()
  const propose = useMutation({
    mutationFn: () =>
      proposeAction({
        kind: 'review.moderate',
        storeId: null,
        title: t('aiActions.review.title').replace('{label}', label).slice(0, 160),
        rationale: reason,
        sourceFeature: 'reviews',
        interactionId,
        payload: { review_id: reviewId, decision: 'reject', reason },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: AI_ACTIONS_QUERY_KEY }),
  })
  if (!can('catalog.write')) return null
  if (propose.isSuccess) {
    return <Chip size="small" color="success" variant="outlined" label={t('aiActions.review.proposed')} />
  }
  return (
    <Button size="small" color="inherit" onClick={() => propose.mutate()} disabled={propose.isPending} sx={{ whiteSpace: 'nowrap' }}>
      {propose.isError ? t('aiActions.review.retry') : t('aiActions.review.propose')}
    </Button>
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
                {MODERATION_REASONS.has(a.reason) && (
                  <ProposeRejectButton
                    reviewId={a.review_id}
                    label={insight.entities[a.ref]?.label ?? a.ref}
                    reason={t(`aiReviews.reason.${a.reason}` as MessageKey)}
                    interactionId={interactionId}
                  />
                )}
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
