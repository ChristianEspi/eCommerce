import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { Alert, Box, Button, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { ContentMotivoNotice, SuggestionRow } from '@/features/ai/content/contentParts'
import { aiEntitlementKey, useAiFeature } from '@/features/ai/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import { LOCALES, type Locale, type MessageKey } from '@/shared/i18n/messages'
import {
  CMS_FIELDS,
  CMS_TASKS_BY_TARGET,
  CMS_TONES,
  MAX_CMS_BRIEF,
  requestCmsDraft,
  type CmsDraft,
  type CmsField,
  type CmsTask,
  type CmsTone,
} from './contentAi'

/**
 * Borradores del CMS con IA (fase 09): banner, landing, SEO y traducción.
 *
 * Plegado por defecto: abrir el formulario no pide nada. La IA redacta sobre
 * lo que la persona YA escribió (campos actuales + instrucción) y devuelve un
 * borrador: cada campo se aplica al formulario, se edita o se descarta, y se
 * guarda con «Guardar» como si se hubiera tecleado. NUNCA publica: el estado y
 * la vigencia siguen siendo los controles de siempre.
 *
 * `applicable` dice qué campos tiene el formulario; el resto (p. ej. el cuerpo
 * de una landing, que va en un bloque de texto enriquecido) se copia.
 */
export function ContentAiAssistant({
  target,
  pageId,
  blockId,
  blockType,
  current,
  applicable,
  onApply,
}: {
  target: 'block' | 'page'
  pageId?: string | null
  blockId?: string | null
  blockType?: string | null
  current: Readonly<Partial<Record<CmsField, string>>>
  applicable: readonly CmsField[]
  onApply: (field: CmsField, value: string) => void
}) {
  const { t } = useI18n()
  const { availability } = useAiFeature('content')
  const [open, setOpen] = useState(false)
  if (availability === 'forbidden' || availability === 'loading') return null

  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <AutoAwesomeRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)' }} aria-hidden />
        <Typography sx={{ fontWeight: 700, flex: 1 }}>{t('aiCms.title')}</Typography>
        <Button
          size="small"
          onClick={() => setOpen((v) => !v)}
          endIcon={open ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
          aria-expanded={open}
        >
          {open ? t('aiContent.hide') : t('aiContent.show')}
        </Button>
      </Stack>
      {open && (
        <Body
          target={target}
          pageId={pageId ?? null}
          blockId={blockId ?? null}
          blockType={blockType ?? null}
          current={current}
          applicable={applicable}
          onApply={onApply}
          availability={availability}
        />
      )}
    </Box>
  )
}

function Body({
  target,
  pageId,
  blockId,
  blockType,
  current,
  applicable,
  onApply,
  availability,
}: {
  target: 'block' | 'page'
  pageId: string | null
  blockId: string | null
  blockType: string | null
  current: Readonly<Partial<Record<CmsField, string>>>
  applicable: readonly CmsField[]
  onApply: (field: CmsField, value: string) => void
  availability: ReturnType<typeof useAiFeature>['availability']
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const tasks = CMS_TASKS_BY_TARGET[target]
  const [task, setTask] = useState<CmsTask>(tasks[0])
  const [brief, setBrief] = useState('')
  const [tone, setTone] = useState<CmsTone>('neutral')
  const [sourceLocale, setSourceLocale] = useState<Locale>(locale)
  const targetLocale: Locale = LOCALES.find((l) => l !== sourceLocale) ?? 'en'

  const draft = useMutation({
    mutationFn: () =>
      requestCmsDraft({
        task,
        target,
        pageId,
        blockId,
        blockType,
        fields: current,
        brief: task === 'translate' ? null : brief,
        tone,
        locale: task === 'translate' ? sourceLocale : locale,
        targetLocale: task === 'translate' ? targetLocale : null,
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiEntitlementKey() }),
  })

  const hasText = CMS_FIELDS.some((f) => (current[f] ?? '').trim().length > 0)
  const ready = task === 'translate' ? hasText : hasText || brief.trim().length > 0
  const canAsk = availability === 'available'
  const result = draft.data

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Alert severity="info">{t('aiCms.disclaimer')}</Alert>
      {availability === 'not_entitled' && <ContentMotivoNotice motivo="sin_contratar" />}
      {availability === 'quota_exhausted' && <ContentMotivoNotice motivo="sin_cuota" />}

      {canAsk && (
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              select
              size="small"
              label={t('aiCms.task')}
              value={task}
              onChange={(event) => {
                setTask(event.target.value as CmsTask)
                draft.reset()
              }}
              sx={{ minWidth: 180 }}
            >
              {tasks.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`aiCms.task.${value}` as MessageKey)}
                </MenuItem>
              ))}
            </TextField>
            {task === 'translate' ? (
              <TextField
                select
                size="small"
                label={t('aiCms.sourceLocale')}
                value={sourceLocale}
                onChange={(event) => setSourceLocale(event.target.value as Locale)}
                helperText={t('aiCms.translateTo').replace('{locale}', t(`aiCms.locale.${targetLocale}` as MessageKey))}
                sx={{ minWidth: 180 }}
              >
                {LOCALES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(`aiCms.locale.${value}` as MessageKey)}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                select
                size="small"
                label={t('aiContent.tone')}
                value={tone}
                onChange={(event) => setTone(event.target.value as CmsTone)}
                sx={{ minWidth: 160 }}
              >
                {CMS_TONES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(`aiContent.tone.${value}` as MessageKey)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
          {task !== 'translate' && (
            <TextField
              size="small"
              multiline
              minRows={2}
              label={t('aiCms.brief')}
              placeholder={t(`aiCms.briefPlaceholder.${task}` as MessageKey)}
              helperText={t('aiCms.briefHelp')}
              value={brief}
              onChange={(event) => setBrief(event.target.value.slice(0, MAX_CMS_BRIEF))}
              inputProps={{ maxLength: MAX_CMS_BRIEF }}
            />
          )}
          {!ready && (
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {t(task === 'translate' ? 'aiCms.needText' : 'aiCms.needBrief')}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<AutoAwesomeRoundedIcon />}
              disabled={!ready || draft.isPending}
              onClick={() => draft.mutate()}
            >
              {t('aiCms.generate')}
            </Button>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiContent.costHint')}</Typography>
          </Stack>
        </Stack>
      )}

      <Box aria-live="polite">
        {draft.isPending && (
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiContent.generating')}</Typography>
            <Skeleton variant="rounded" height={96} />
          </Stack>
        )}
        {draft.isError && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => draft.mutate()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiContent.networkError')}
          </Alert>
        )}
        {!draft.isPending && result?.motivo && <ContentMotivoNotice motivo={result.motivo} onRetry={() => draft.mutate()} />}
      </Box>

      {!draft.isPending && result?.data && (
        <DraftView
          draft={result.data}
          current={current}
          applicable={applicable}
          onApply={onApply}
          interactionId={result.interactionId}
        />
      )}
    </Stack>
  )
}

function DraftView({
  draft,
  current,
  applicable,
  onApply,
  interactionId,
}: {
  draft: CmsDraft
  current: Readonly<Partial<Record<CmsField, string>>>
  applicable: readonly CmsField[]
  onApply: (field: CmsField, value: string) => void
  interactionId: string | null
}) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.25}>
      <Alert severity="info">
        {t('aiCms.draftNotice')}
        {draft.task === 'translate' && ` ${t('aiCms.translateNotice')}`}
      </Alert>
      {CMS_FIELDS.map((field) => {
        const text = draft.fields[field]
        if (!text) return null
        const canApply = applicable.includes(field)
        return (
          <SuggestionRow
            key={`${draft.task}-${field}`}
            label={t(`aiCms.field.${field}` as MessageKey)}
            current={canApply ? (current[field] ?? '') : null}
            suggestion={text}
            multiline={field === 'body' || field === 'subtitle' || field === 'seo_description'}
            onApply={canApply ? (value) => onApply(field, value) : undefined}
          />
        )
      })}
      {draft.notes.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{t('aiCms.notes')}</Typography>
          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
            {draft.notes.map((n, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 12.5 }}>
                {n}
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
