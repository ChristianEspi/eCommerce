import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { AiBlock, PendingList, ProductNotes } from '@/features/customers/ai/CustomerAiPanel'
import { CustomerSystemBlock } from '@/features/customers/ai/CustomerSystemBlock'
import { MarkerText, MotivoNotice } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import {
  FOLLOW_UP_TONES,
  MAX_FOLLOW_UP_NOTES,
  toPlainText,
  type FollowUpDraft,
  type FollowUpTone,
  type VisitPrep,
} from './salesAi'
import { useFollowUp, useVisitPrep, useVisitSignals } from './useSalesAi'

function PrepView({ data }: { data: VisitPrep }) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.75}>
      {data.summary && (
        <AiBlock title={t('aiSales.section.summary')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.summary} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.recent_activity && (
        <AiBlock title={t('aiSales.section.recent')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.recent_activity} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.pending.length > 0 && (
        <AiBlock title={t('aiSales.section.pending')}>
          <PendingList items={data.pending} context={data} />
        </AiBlock>
      )}
      {data.products.length > 0 && (
        <AiBlock title={t('aiSales.section.products')}>
          <ProductNotes items={data.products} context={data} />
        </AiBlock>
      )}
      {data.questions.length > 0 && (
        <AiBlock title={t('aiSales.section.questions')}>
          <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {data.questions.map((q, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 13 }}>
                <MarkerText text={q} context={data} />
              </Typography>
            ))}
          </Stack>
        </AiBlock>
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
 * El borrador, EDITABLE. No hay botón de enviar: se copia y la persona decide
 * dónde y si lo manda.
 */
function DraftEditor({ draft }: { draft: FollowUpDraft }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const days = t('aiOrders.unit.days')
  const [subject, setSubject] = useState(() => toPlainText(draft.subject, draft, locale, days))
  const [body, setBody] = useState(() => toPlainText(draft.body, draft, locale, days))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`)
      notify(t('aiSales.draft.copied'), 'success')
    } catch {
      notify(t('aiSales.draft.copyError'), 'error')
    }
  }

  return (
    <Stack spacing={1.5}>
      <Alert severity="info" icon={<EditNoteRoundedIcon fontSize="small" />}>
        {t('aiSales.draft.notice')}
      </Alert>
      <TextField
        fullWidth
        size="small"
        label={t('aiSales.draft.subject')}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <TextField
        fullWidth
        multiline
        minRows={6}
        label={t('aiSales.draft.body')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {draft.points.length > 0 && (
        <AiBlock title={t('aiSales.draft.points')}>
          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
            {draft.points.map((p, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 12.5 }}>
                <MarkerText text={p} context={draft} />
              </Typography>
            ))}
          </Stack>
        </AiBlock>
      )}
      {draft.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiOrders.discarded').replace('{n}', String(draft.discarded))}
        </Typography>
      )}
      <Button
        variant="outlined"
        startIcon={<ContentCopyRoundedIcon />}
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => void copy()}
      >
        {t('aiSales.draft.copy')}
      </Button>
    </Stack>
  )
}

/**
 * Asistente de visita (fase 06): Preparar visita y Generar seguimiento.
 *
 *  - **Cálculo del sistema** al abrir (sin cuota): la visita, el 360 reducido
 *    del cliente y sus señales.
 *  - **Preparar visita** (una consulta): resumen, últimos movimientos,
 *    pendientes, productos relevantes y preguntas sugeridas.
 *  - **Generar seguimiento** (una consulta): BORRADOR editable. No se envía.
 *
 * Quien lo monta le pone `key={visitId}`: otra visita = estado limpio.
 */
export function VisitAiDrawer({
  open,
  visitId,
  customerName,
  onClose,
}: {
  open: boolean
  visitId: string | null
  customerName: string | null
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { availability } = useAiFeature('sales')
  const visible = availability !== 'forbidden' && availability !== 'loading'
  const signals = useVisitSignals(visitId, locale, open && visible)
  const prep = useVisitPrep(locale)
  const followUp = useFollowUp(locale)
  const [notes, setNotes] = useState('')
  const [tone, setTone] = useState<FollowUpTone>('formal')

  const canAsk = availability === 'available'
  const notesTooLong = notes.trim().length > MAX_FOLLOW_UP_NOTES
  const system = signals.data ?? null
  const visit = system?.visit ?? null
  const prepResult = prep.data?.result
  const draftResult = followUp.data?.result

  const runPrep = () => {
    if (!visitId || !canAsk || prep.isPending) return
    prep.mutate(visitId)
  }
  const runFollowUp = () => {
    if (!visitId || !canAsk || followUp.isPending || notesTooLong) return
    followUp.mutate({ visitId, tone, notes: notes.trim() || null })
  }

  return (
    <FormDrawer
      open={open}
      title={t('aiSales.title')}
      subtitle={customerName ?? undefined}
      onClose={onClose}
      width={680}
      actions={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {!visible || !visitId ? null : (
        <Stack spacing={2}>
          <Card variant="outlined" component="section" aria-labelledby="ai-visit-system">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Typography id="ai-visit-system" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
                {t('aiCustomers.system.title')}
              </Typography>
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
                    {t('aiCustomers.system.error')}
                  </Alert>
                )}
                {signals.isSuccess && !system && <Alert severity="warning">{t('aiCustomers.system.error')}</Alert>}
                {system && (
                  <Stack spacing={1.5}>
                    {visit && (
                      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                        <Chip size="small" label={t(`sales.outcome.${visit.outcome}` as MessageKey)} />
                        {visit.route && <Chip size="small" variant="outlined" label={visit.route} />}
                        {visit.tasks.map((task, i) => (
                          <Chip
                            key={i}
                            size="small"
                            variant="outlined"
                            label={`${task.done ? '✓' : '○'} ${task.label}`}
                          />
                        ))}
                      </Stack>
                    )}
                    <CustomerSystemBlock system={system} />
                  </Stack>
                )}
              </Box>
            </CardContent>
          </Card>

          <Divider />

          {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
          {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

          <Stack spacing={1.25} component="section" aria-labelledby="ai-visit-prep">
            <Typography id="ai-visit-prep" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
              {t('aiSales.prep.title')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiSales.prep.help')}</Typography>
            {canAsk && (
              <Button
                variant="contained"
                startIcon={<AutoAwesomeRoundedIcon />}
                sx={{ alignSelf: 'flex-start' }}
                disabled={prep.isPending}
                onClick={runPrep}
              >
                {t('aiSales.prep.run')}
              </Button>
            )}
            <Box aria-live="polite" aria-busy={prep.isPending}>
              {prep.isPending && <Skeleton variant="rounded" height={120} />}
              {!prep.isPending && prep.isError && (
                <Alert
                  severity="error"
                  action={
                    <Button color="inherit" size="small" onClick={runPrep}>
                      {t('common.retry')}
                    </Button>
                  }
                >
                  {t('aiCustomers.networkError')}
                </Alert>
              )}
              {!prep.isPending && !prep.isError && prepResult?.motivo && (
                <MotivoNotice motivo={prepResult.motivo} onRetry={runPrep} />
              )}
              {!prep.isPending && !prep.isError && prepResult?.data && (
                <Card variant="outlined">
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <PrepView data={prepResult.data} />
                    <AiFeedbackButtons interactionId={prepResult.interactionId} />
                  </CardContent>
                </Card>
              )}
            </Box>
          </Stack>

          <Divider />

          <Stack spacing={1.25} component="section" aria-labelledby="ai-visit-follow-up">
            <Typography id="ai-visit-follow-up" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
              {t('aiSales.followUp.title')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiSales.followUp.help')}</Typography>
            {canAsk && (
              <Stack spacing={1.25}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                  label={t('aiSales.followUp.notes')}
                  placeholder={t('aiSales.followUp.notesPlaceholder')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  error={notesTooLong}
                  helperText={notesTooLong ? t('aiSales.followUp.notesTooLong') : t('aiSales.costHint')}
                  inputProps={{ maxLength: MAX_FOLLOW_UP_NOTES + 50 }}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                  <TextField
                    select
                    size="small"
                    label={t('aiSales.followUp.tone')}
                    value={tone}
                    onChange={(e) => setTone(e.target.value as FollowUpTone)}
                    sx={{ minWidth: 180 }}
                  >
                    {FOLLOW_UP_TONES.map((option) => (
                      <MenuItem key={option} value={option}>
                        {t(`aiSales.tone.${option}` as MessageKey)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    startIcon={<EditNoteRoundedIcon />}
                    disabled={followUp.isPending || notesTooLong}
                    onClick={runFollowUp}
                  >
                    {t('aiSales.followUp.run')}
                  </Button>
                </Stack>
              </Stack>
            )}
            <Box aria-live="polite" aria-busy={followUp.isPending}>
              {followUp.isPending && <Skeleton variant="rounded" height={160} />}
              {!followUp.isPending && followUp.isError && (
                <Alert
                  severity="error"
                  action={
                    <Button color="inherit" size="small" onClick={runFollowUp}>
                      {t('common.retry')}
                    </Button>
                  }
                >
                  {t('aiCustomers.networkError')}
                </Alert>
              )}
              {!followUp.isPending && !followUp.isError && draftResult?.motivo && (
                <MotivoNotice motivo={draftResult.motivo} onRetry={runFollowUp} />
              )}
              {!followUp.isPending && !followUp.isError && draftResult?.data && (
                <Card variant="outlined">
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {/* Un borrador nuevo = editor nuevo (sus campos arrancan del texto del servidor). */}
                    <DraftEditor key={draftResult.interactionId ?? draftResult.data.body} draft={draftResult.data} />
                    <AiFeedbackButtons interactionId={draftResult.interactionId} />
                  </CardContent>
                </Card>
              )}
            </Box>
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiSales.disclaimer')}</Typography>
        </Stack>
      )}
    </FormDrawer>
  )
}
