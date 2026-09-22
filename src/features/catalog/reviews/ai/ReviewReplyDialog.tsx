import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { plainAnalystText } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { ContentMotivoNotice, CopyTextButton } from '@/features/ai/content/contentParts'
import { aiEntitlementKey, useAiFeature } from '@/features/ai/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { MAX_REPLY_NOTES, REPLY_TONES, requestReviewReply, type ReplyTone, type ReviewReply } from './reviewsAi'

/**
 * Borrador de respuesta a UNA reseña (fase 09).
 *
 * Se monta solo mientras está abierto (cerrar descarta el borrador). Nada se
 * envía ni se publica: la vitrina no tiene respuestas públicas y la IA no
 * responde por nadie. La persona lo edita y lo copia; si decide usarlo, lo
 * hace ella, por el canal que elija.
 */
export function ReviewReplyDialog({
  storeId,
  reviewId,
  label,
  onClose,
}: {
  storeId: string
  reviewId: string
  /** Producto · estrellas, para que se sepa a qué reseña se responde. */
  label: string
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const { availability } = useAiFeature('reviews')
  const [tone, setTone] = useState<ReplyTone>('formal')
  const [notes, setNotes] = useState('')

  const reply = useMutation({
    mutationFn: () => requestReviewReply({ storeId, reviewId, locale, tone, notes }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })
  const result = reply.data

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="review-reply-title">
      <DialogTitle id="review-reply-title">{t('aiReviews.reply.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{label}</Typography>
          <Alert severity="info">{t('aiReviews.reply.notice')}</Alert>
          {availability === 'not_entitled' && <ContentMotivoNotice motivo="sin_contratar" />}
          {availability === 'quota_exhausted' && <ContentMotivoNotice motivo="sin_cuota" />}
          {availability === 'available' && (
            <>
              <TextField
                select
                size="small"
                label={t('aiContent.tone')}
                value={tone}
                onChange={(event) => setTone(event.target.value as ReplyTone)}
              >
                {REPLY_TONES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(`aiReviews.reply.tone.${value}` as MessageKey)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                multiline
                minRows={2}
                label={t('aiReviews.reply.notes')}
                helperText={t('aiReviews.reply.notesHelp')}
                value={notes}
                onChange={(event) => setNotes(event.target.value.slice(0, MAX_REPLY_NOTES))}
                inputProps={{ maxLength: MAX_REPLY_NOTES }}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  startIcon={<AutoAwesomeRoundedIcon />}
                  disabled={reply.isPending}
                  onClick={() => reply.mutate()}
                >
                  {t('aiReviews.reply.generate')}
                </Button>
                <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiContent.costHint')}</Typography>
              </Stack>
            </>
          )}
          <Box aria-live="polite">
            {reply.isPending && <Skeleton variant="rounded" height={120} />}
            {reply.isError && (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => reply.mutate()}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiContent.networkError')}
              </Alert>
            )}
            {!reply.isPending && result?.motivo && <ContentMotivoNotice motivo={result.motivo} onRetry={() => reply.mutate()} />}
          </Box>
          {!reply.isPending && result?.data && (
            <ReplyEditor key={result.interactionId ?? 'draft'} draft={result.data} interactionId={result.interactionId} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

function ReplyEditor({ draft, interactionId }: { draft: ReviewReply; interactionId: string | null }) {
  const { t, locale } = useI18n()
  const days = t('aiOrders.unit.days')
  const [body, setBody] = useState(() => plainAnalystText(draft.body, draft, locale, { days }))
  return (
    <Stack spacing={1.25}>
      <TextField fullWidth multiline minRows={5} label={t('aiReviews.reply.body')} value={body} onChange={(e) => setBody(e.target.value)} />
      {draft.points.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiReviews.reply.points')}</Typography>
          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
            {draft.points.map((p, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 12.5 }}>
                {plainAnalystText(p, draft, locale, { days })}
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <CopyTextButton text={body} label={t('aiReviews.reply.copy')} />
        <AiFeedbackButtons interactionId={interactionId} />
      </Stack>
    </Stack>
  )
}
