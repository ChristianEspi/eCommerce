import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { ContentMotivoNotice, SuggestionRow } from '@/features/ai/content/contentParts'
import { aiEntitlementKey, useAiFeature } from '@/features/ai/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import {
  MAX_PROMO_BRIEF,
  PROMO_TEXT_FIELDS,
  PROMO_TONES,
  TERM_METRIC,
  fetchPromotionRules,
  formatPromoMetric,
  requestPromotionCopy,
  resolvePromoText,
  type PromoDraft,
  type PromoSystem,
  type PromoTextField,
  type PromoTone,
} from './promotionsAi'

/** Campos del formulario de la promoción que un borrador puede rellenar. */
export type PromoApplicableField = 'name' | 'description'

const APPLICABLE: ReadonlySet<PromoTextField> = new Set(['name', 'description'])

/**
 * Redactar la promoción con IA (fase 09).
 *
 * Plegado por defecto: abrir el cajón de una promoción no pide nada. Al
 * desplegarlo se carga el CÁLCULO DEL SISTEMA (condiciones y candidatos por
 * regla, sin cuota); el borrador se pide con un botón (una consulta).
 *
 * Nombre y descripción se APLICAN al formulario y se guardan con «Guardar»,
 * como si se hubieran tecleado; titular, copy, CTA y términos no tienen
 * columna en la promoción: se editan y se copian (por ejemplo, a un bloque del
 * CMS). Los candidatos son sugerencias: se añaden en «Alcance» o en la
 * audiencia con los controles de siempre. Las reglas del descuento no se
 * tocan desde aquí.
 */
export function PromotionAiAssistant({
  promotionId,
  current,
  onApply,
}: {
  promotionId: string
  current: { name: string; description: string }
  onApply: (field: PromoApplicableField, value: string) => void
}) {
  const { t } = useI18n()
  const { availability } = useAiFeature('promotions')
  const [open, setOpen] = useState(false)

  // Rol sin la funcionalidad: nada se pinta ni se pide.
  if (availability === 'forbidden' || availability === 'loading') return null

  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <AutoAwesomeRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)' }} aria-hidden />
        <Typography sx={{ fontWeight: 700, flex: 1 }}>{t('aiPromotions.title')}</Typography>
        <Button
          size="small"
          onClick={() => setOpen((v) => !v)}
          endIcon={open ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
          aria-expanded={open}
        >
          {open ? t('aiContent.hide') : t('aiContent.show')}
        </Button>
      </Stack>
      {open && <AssistantBody promotionId={promotionId} current={current} onApply={onApply} availability={availability} />}
    </Box>
  )
}

function AssistantBody({
  promotionId,
  current,
  onApply,
  availability,
}: {
  promotionId: string
  current: { name: string; description: string }
  onApply: (field: PromoApplicableField, value: string) => void
  availability: ReturnType<typeof useAiFeature>['availability']
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [brief, setBrief] = useState('')
  const [tone, setTone] = useState<PromoTone>('neutral')

  const rules = useQuery({
    queryKey: ['ai', 'promotions', 'rules', promotionId, locale],
    queryFn: () => fetchPromotionRules(promotionId, locale),
    staleTime: 60_000,
  })
  const copy = useMutation({
    mutationFn: () => requestPromotionCopy({ promotionId, locale, tone, brief }),
    // Cada intento gasta (o no) cuota en el servidor: el saldo se vuelve a leer.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })

  const system = copy.data?.system ?? rules.data ?? null
  const result = copy.data?.result
  const canAsk = availability === 'available'
  const days = t('aiOrders.unit.days')

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Alert severity="info">{t('aiPromotions.disclaimer')}</Alert>

      {rules.isPending ? (
        <Skeleton variant="rounded" height={64} />
      ) : rules.isError ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void rules.refetch()}>
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

      {canAsk && (
        <Stack spacing={1.25}>
          <TextField
            size="small"
            multiline
            minRows={2}
            label={t('aiPromotions.brief')}
            placeholder={t('aiPromotions.briefPlaceholder')}
            helperText={t('aiPromotions.briefHelp')}
            value={brief}
            onChange={(event) => setBrief(event.target.value.slice(0, MAX_PROMO_BRIEF))}
            inputProps={{ maxLength: MAX_PROMO_BRIEF }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              select
              size="small"
              label={t('aiContent.tone')}
              value={tone}
              onChange={(event) => setTone(event.target.value as PromoTone)}
              sx={{ minWidth: 160 }}
            >
              {PROMO_TONES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`aiContent.tone.${value}` as MessageKey)}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<AutoAwesomeRoundedIcon />}
              disabled={copy.isPending}
              onClick={() => copy.mutate()}
            >
              {t('aiPromotions.generate')}
            </Button>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiContent.costHint')}</Typography>
          </Stack>
        </Stack>
      )}

      <Box aria-live="polite">
        {copy.isPending && (
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiContent.generating')}</Typography>
            <Skeleton variant="rounded" height={96} />
          </Stack>
        )}
        {copy.isError && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => copy.mutate()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiContent.networkError')}
          </Alert>
        )}
        {!copy.isPending && result?.motivo && <ContentMotivoNotice motivo={result.motivo} onRetry={() => copy.mutate()} />}
      </Box>

      {!copy.isPending && result?.data && (
        <DraftView draft={result.data} current={current} onApply={onApply} days={days} interactionId={result.interactionId} />
      )}
    </Stack>
  )
}

function SystemBlock({ system }: { system: PromoSystem }) {
  const { t, locale } = useI18n()
  const days = t('aiOrders.unit.days')
  return (
    <Stack spacing={1}>
      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{t('aiPromotions.system.title')}</Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiPromotions.system.help')}</Typography>
      {system.terms.length === 0 ? (
        <Typography sx={{ fontSize: 13 }}>{t('aiPromotions.system.noTerms')}</Typography>
      ) : (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {system.terms.map((term) => {
            const key = TERM_METRIC[term]
            const metric = key ? system.metrics[key] : undefined
            const value = metric ? formatPromoMetric(metric, locale, days) : null
            return (
              <Chip
                key={term}
                size="small"
                variant="outlined"
                label={value ? `${t(`aiPromotions.term.${term}` as MessageKey)}: ${value}` : t(`aiPromotions.term.${term}` as MessageKey)}
              />
            )
          })}
        </Stack>
      )}
      {system.candidates.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiPromotions.candidates.system')}</Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
            {system.candidates.map((c) => (
              <Typography component="li" key={c.ref} sx={{ fontSize: 13 }}>
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {c.label}
                </Box>{' '}
                · {t(`aiPromotions.reason.${c.reason}` as MessageKey)}
                {c.metrics.length > 0 && (
                  <Box component="span" sx={{ color: 'var(--muted)' }}>
                    {' '}
                    ({c.metrics
                      .map((k) => {
                        const m = system.metrics[k]
                        return m ? `${t(`aiPromotions.metric.${k.replace(/^[A-Z]\d{1,2}_/, '')}` as MessageKey)}: ${formatPromoMetric(m, locale, days)}` : null
                      })
                      .filter(Boolean)
                      .join(' · ')}
                    )
                  </Box>
                )}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}

function DraftView({
  draft,
  current,
  onApply,
  days,
  interactionId,
}: {
  draft: PromoDraft
  current: { name: string; description: string }
  onApply: (field: PromoApplicableField, value: string) => void
  days: string
  interactionId: string | null
}) {
  const { t, locale } = useI18n()
  const resolve = (text: string) => resolvePromoText(text, draft, locale, days)
  return (
    <Stack spacing={1.25}>
      <Alert severity="info">{t('aiPromotions.draftNotice')}</Alert>
      {PROMO_TEXT_FIELDS.map((field) => {
        const text = draft.texts[field]
        if (!text) return null
        const applicable = APPLICABLE.has(field)
        return (
          <SuggestionRow
            key={field}
            label={t(`aiPromotions.field.${field}` as MessageKey)}
            current={applicable ? current[field as PromoApplicableField] : null}
            suggestion={resolve(text)}
            multiline={field !== 'name' && field !== 'cta'}
            onApply={applicable ? (value) => onApply(field as PromoApplicableField, value) : undefined}
          />
        )
      })}
      {draft.candidates.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiPromotions.candidates.ai')}</Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mb: 0.5 }}>{t('aiPromotions.candidates.help')}</Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
            {draft.candidates.map((c) => (
              <Typography component="li" key={c.ref} sx={{ fontSize: 13 }}>
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {c.label}
                </Box>{' '}
                <Chip size="small" label={t(`aiPromotions.reason.${c.reason}` as MessageKey)} sx={{ ml: 0.5 }} />
                {c.text && <Box component="span"> — {resolve(c.text)}</Box>}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}
      {draft.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiContent.discarded').replace('{n}', String(draft.discarded))}
        </Typography>
      )}
      <AiFeedbackButtons interactionId={interactionId} />
    </Stack>
  )
}
