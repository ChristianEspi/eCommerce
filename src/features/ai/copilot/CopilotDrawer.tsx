import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { canRetryMotivo, renderAnalystText } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import type { AiErrorKind } from '@/features/ai/result'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon } from '@/shared/ui/AppIcon'
import { T } from '@/theme/tokens'
import {
  COPILOT_LINK_CAPABILITY,
  COPILOT_MAX_QUESTION,
  linkTarget,
  markerContextOf,
  screenFromPath,
  suggestionsFor,
  type CopilotAnswer,
  type CopilotLink,
  type CopilotToolStatus,
} from './copilot'
import { useCopilot, type CopilotMessage } from './copilot-context'

const TITLE_ID = 'ebim-copilot-title'

/** Texto con marcadores → cifras y entidades de la base. */
function CopilotText({ text, answer }: { text: string; answer: CopilotAnswer }) {
  const { t, locale } = useI18n()
  const parts = renderAnalystText(text, markerContextOf(answer), locale, { days: t('copilot.days') })
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <Box key={i} component="strong" className={part.type === 'metric' ? 'tnum' : undefined} sx={{ fontWeight: 800 }}>
            {part.text}
          </Box>
        ),
      )}
    </>
  )
}

function statusIcon(status: CopilotToolStatus): ReactNode {
  if (status === 'ok') return <CheckCircleOutlineRoundedIcon fontSize="small" />
  if (status === 'denied' || status === 'not_entitled') return <LockOutlinedIcon fontSize="small" />
  return <RemoveCircleOutlineRoundedIcon fontSize="small" />
}

function ToolsConsulted({ answer }: { answer: CopilotAnswer }) {
  const { t } = useI18n()
  if (answer.tools.length === 0) return null
  return (
    <Stack spacing={0.5}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>{t('copilot.consulted')}</Typography>
      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap' }}>
        {answer.tools.map((tool, i) => (
          <Chip
            key={`${tool.tool}-${i}`}
            size="small"
            variant="outlined"
            icon={<Box component="span" sx={{ display: 'inline-flex', ml: 0.5 }}>{statusIcon(tool.status)}</Box>}
            label={`${t(`copilot.tool.${tool.tool}` as MessageKey)} · ${t(`copilot.status.${tool.status}` as MessageKey)}`}
          />
        ))}
      </Stack>
    </Stack>
  )
}

function LinkButton({ link }: { link: CopilotLink }) {
  const { t } = useI18n()
  const { has } = useCapabilities()
  const { setOpen } = useCopilot() ?? {}
  const capability = COPILOT_LINK_CAPABILITY[link.module]
  if (capability && !has(capability)) return null
  return (
    <Button
      component={RouterLink}
      to={linkTarget(link)}
      size="small"
      variant="outlined"
      endIcon={<ArrowForwardRoundedIcon />}
      onClick={() => setOpen?.(false)}
      sx={{ alignSelf: 'flex-start', maxWidth: '100%', textAlign: 'left' }}
    >
      {`${t('copilot.openLink')}: ${link.label}`}
    </Button>
  )
}

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

function AssistantMessage({
  message,
  onAsk,
  disabled,
}: {
  message: Extract<CopilotMessage, { role: 'assistant' }>
  onAsk: (q: string) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  if (message.failed) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" disabled={disabled} onClick={() => onAsk(message.question)}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('copilot.networkError')}
      </Alert>
    )
  }
  const result = message.result
  if (!result) return null
  if (result.motivo || !result.data) {
    return <MotivoNotice motivo={result.motivo ?? 'esquema'} onRetry={disabled ? undefined : () => onAsk(message.question)} />
  }
  const answer = result.data
  return (
    <Stack spacing={1.25}>
      {answer.kind === 'no_data' ? (
        <Stack spacing={0.5}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{t('copilot.noData.title')}</Typography>
          {answer.tools.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('copilot.noData.discarded')}</Typography>
          )}
        </Stack>
      ) : (
        <>
          {answer.kind === 'answer' && !answer.answerable && (
            <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{t('copilot.notAnswerable')}</Typography>
          )}
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
            <CopilotText text={answer.answer} answer={answer} />
          </Typography>
        </>
      )}
      {answer.highlights.length > 0 && (
        <Box component="ul" aria-label={t('copilot.highlights')} sx={{ m: 0, pl: 2.5, fontSize: 13 }}>
          {answer.highlights.map((h, i) => (
            <li key={i}>
              <CopilotText text={h} answer={answer} />
            </li>
          ))}
        </Box>
      )}
      {answer.links.length > 0 && (
        <Stack spacing={0.75}>
          {answer.links.map((l) => (
            <LinkButton key={l.ref} link={l} />
          ))}
        </Stack>
      )}
      <ToolsConsulted answer={answer} />
      {answer.discarded > 0 && answer.kind === 'answer' && (
        <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('copilot.discarded')}</Typography>
      )}
      {answer.follow_ups.length > 0 && (
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('copilot.followUps')}>
          {answer.follow_ups.map((f) => (
            <Chip key={f} label={f} size="small" clickable variant="outlined" disabled={disabled} onClick={() => onAsk(f)} />
          ))}
        </Stack>
      )}
      <AiFeedbackButtons interactionId={result.interactionId} />
    </Stack>
  )
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: ReactNode }) {
  const { t } = useI18n()
  const mine = role === 'user'
  return (
    <Box
      component="article"
      aria-label={mine ? t('copilot.you') : t('copilot.assistant')}
      sx={{
        alignSelf: mine ? 'flex-end' : 'stretch',
        maxWidth: mine ? '85%' : '100%',
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        border: '1px solid var(--border)',
        bgcolor: mine ? 'var(--accent-soft)' : 'var(--card)',
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </Box>
  )
}

/**
 * El panel del Copilot. Cajón a la derecha (pantalla completa en móvil), con
 * sugerencias según la pantalla y la entidad abierta, y SOLO las que la
 * persona puede usar (rol + módulos). Cada pregunta gasta una consulta de
 * IA; nada se pide al abrir.
 */
export function CopilotDrawer() {
  const { t } = useI18n()
  const copilot = useCopilot()
  const { role } = useTenant()
  const { has } = useCapabilities()
  const location = useLocation()
  const { availability } = useAiFeature('copilot')
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const open = copilot?.open ?? false
  const messages = copilot?.messages ?? []
  const pending = copilot?.pending ?? false

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, pending])

  if (!copilot) return null

  const screen = screenFromPath(location.pathname)
  const suggestions = suggestionsFor(screen, copilot.entity, { role, has })
  const tooLong = question.trim().length > COPILOT_MAX_QUESTION
  const canAsk = availability === 'available'

  const ask = (text: string) => {
    const q = text.trim()
    if (!q || q.length > COPILOT_MAX_QUESTION || pending || !canAsk) return
    copilot.send(q)
    setQuestion('')
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    ask(question)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      ask(question)
    }
  }

  const contextLabel = [
    t(`copilot.screen.${screen}` as MessageKey),
    copilot.entity ? t(`copilot.entity.${copilot.entity.type}` as MessageKey) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => copilot.setOpen(false)}
      PaperProps={{
        role: 'dialog',
        'aria-labelledby': TITLE_ID,
        sx: { width: { xs: '100%', sm: 440 }, maxWidth: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--bg)' },
      }}
      SlideProps={{ onEntered: () => inputRef.current?.focus() }}
    >
      {/* Cabecera */}
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: 'center', px: 2, py: 1.5, bgcolor: 'var(--card)', borderBottom: '1px solid var(--border)' }}
      >
        <AppIcon tone="accent" size="sm">
          <AutoAwesomeRoundedIcon fontSize="small" />
        </AppIcon>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography id={TITLE_ID} component="h2" sx={{ fontSize: T.cardTitle, fontWeight: 800 }}>
              {t('copilot.title')}
            </Typography>
            <Chip size="small" label={t('copilot.badge')} color="primary" variant="outlined" />
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }} noWrap>
            {`${t('copilot.context.label')}: ${contextLabel}`}
          </Typography>
        </Box>
        <Tooltip title={t('copilot.newChat')}>
          <span>
            <IconButton aria-label={t('copilot.newChat')} onClick={copilot.reset} disabled={pending || messages.length === 0}>
              <RestartAltRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton aria-label={t('copilot.close')} onClick={() => copilot.setOpen(false)}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      {/* Conversación */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2 }}>
        <Stack spacing={1.5} role="log" aria-live="polite" aria-busy={pending} aria-label={t('copilot.title')}>
          {messages.length === 0 && (
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>{t('copilot.intro')}</Typography>
              {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
              {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}
              {canAsk && suggestions.length > 0 && (
                <Stack spacing={0.75}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>{t('copilot.suggested')}</Typography>
                  <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('copilot.suggested')}>
                    {suggestions.map((s) => {
                      const label = t(`copilot.q.${s.id}` as MessageKey)
                      return <Chip key={s.id} label={label} variant="outlined" clickable disabled={pending} onClick={() => ask(label)} />
                    })}
                  </Stack>
                </Stack>
              )}
            </Stack>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <Bubble key={m.id} role="user">
                <Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-line' }}>{m.text}</Typography>
              </Bubble>
            ) : (
              <Bubble key={m.id} role="assistant">
                <AssistantMessage message={m} onAsk={ask} disabled={pending || !canAsk} />
              </Bubble>
            ),
          )}
          {pending && (
            <Stack spacing={0.75}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('copilot.thinking')}</Typography>
              <Skeleton variant="rounded" height={72} />
            </Stack>
          )}
          <div ref={endRef} />
        </Stack>
      </Box>

      {/* Pregunta */}
      <Divider />
      <Box component="form" onSubmit={onSubmit} noValidate sx={{ px: 2, pt: 1.5, pb: 2, bgcolor: 'var(--card)' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            size="small"
            label={t('copilot.input.label')}
            placeholder={t('copilot.input.placeholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!canAsk}
            error={tooLong}
            helperText={tooLong ? t('copilot.input.tooLong') : t('copilot.input.hint')}
            inputProps={{ maxLength: COPILOT_MAX_QUESTION + 50 }}
          />
          <IconButton
            type="submit"
            color="primary"
            aria-label={t('copilot.send')}
            disabled={!canAsk || pending || !question.trim() || tooLong}
            sx={{ mb: 3 }}
          >
            <SendRoundedIcon />
          </IconButton>
        </Stack>
        <Typography sx={{ fontSize: 11, color: 'var(--muted)', mt: 0.5 }}>{t('copilot.disclaimer')}</Typography>
      </Box>
    </Drawer>
  )
}

/**
 * Botón global, discreto, en la barra superior. No se pinta para quien no
 * tiene rol ni mientras se sabe si puede usarlo.
 */
export function CopilotButton() {
  const { t } = useI18n()
  const copilot = useCopilot()
  const { availability } = useAiFeature('copilot')
  if (!copilot || availability === 'forbidden' || availability === 'loading') return null
  return (
    <Tooltip title={t('copilot.open')}>
      <IconButton
        onClick={() => copilot.setOpen(true)}
        aria-label={t('copilot.open')}
        aria-haspopup="dialog"
        aria-expanded={copilot.open}
        sx={{ color: 'var(--accent-deep)' }}
      >
        <AutoAwesomeRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
