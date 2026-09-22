import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { canRetryMotivo } from '@/features/admin/dashboard/aiAnalyst'
import type { AiErrorKind } from '@/features/ai/result'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'

/**
 * Piezas comunes de la IA de contenido (fase 09: promociones, CMS y reseñas).
 *
 * Todo lo que se pinta aquí es un BORRADOR: nada se guarda, publica ni envía
 * desde estas piezas. «Aplicar» escribe en el formulario de la pantalla (que
 * la persona guarda con su botón de siempre) y «Copiar» deja el texto en el
 * portapapeles.
 */

/** Aviso del motivo tipado, con reintento solo cuando tiene sentido. */
export function ContentMotivoNotice({ motivo, onRetry }: { motivo: AiErrorKind; onRetry?: () => void }) {
  const { t } = useI18n()
  const info = motivo === 'sin_proveedor' || motivo === 'sin_contratar' || motivo === 'modulo_no_contratado'
  const key: MessageKey =
    motivo === 'vacia' || motivo === 'bloqueada' ? `aiContent.motivo.${motivo}` : (`ai.motivo.${motivo}` as MessageKey)
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
      {t(key)}
    </Alert>
  )
}

/** Botón «Copiar» con aviso. */
export function CopyTextButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      notify(t('aiContent.copied'), 'success')
    } catch {
      notify(t('aiContent.copyError'), 'error')
    }
  }
  return (
    <Button size="small" variant="text" startIcon={<ContentCopyRoundedIcon fontSize="small" />} onClick={() => void copy()}>
      {label ?? t('aiContent.copy')}
    </Button>
  )
}

export type SuggestionDecision = 'applied' | 'discarded' | null

/**
 * Una sugerencia frente al valor ACTUAL, editable antes de aplicar.
 *
 * `onApply` recibe el texto (quizá editado) y lo escribe en el formulario; si
 * no hay `onApply`, la sugerencia solo se puede copiar (campos sin columna).
 */
export function SuggestionRow({
  label,
  current,
  suggestion,
  multiline,
  onApply,
}: {
  label: string
  current: string | null
  suggestion: string
  multiline?: boolean
  onApply?: (value: string) => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(suggestion)
  const [decision, setDecision] = useState<SuggestionDecision>(null)

  return (
    <Box
      sx={{
        border: '1px solid var(--border)',
        borderRadius: 2,
        p: 1.5,
        opacity: decision === 'discarded' ? 0.55 : 1,
      }}
    >
      <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.75 }}>{label}</Typography>
      {current !== null && (
        <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', mb: 1, whiteSpace: 'pre-line' }}>
          <Box component="span" sx={{ fontWeight: 700 }}>
            {t('aiContent.current')}:
          </Box>{' '}
          {current.trim() ? current : t('aiContent.empty')}
        </Typography>
      )}
      <TextField
        fullWidth
        size="small"
        multiline={multiline}
        minRows={multiline ? 3 : undefined}
        label={t('aiContent.suggestion')}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setDecision(null)
        }}
        disabled={decision === 'discarded'}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {onApply && (
          <Button
            size="small"
            variant={decision === 'applied' ? 'outlined' : 'contained'}
            startIcon={<CheckRoundedIcon fontSize="small" />}
            disabled={!value.trim() || decision === 'discarded'}
            onClick={() => {
              onApply(value.trim())
              setDecision('applied')
            }}
            aria-label={`${t('aiContent.apply')} · ${label}`}
          >
            {decision === 'applied' ? t('aiContent.applied') : t('aiContent.apply')}
          </Button>
        )}
        <CopyTextButton text={value} />
        {decision !== 'discarded' ? (
          <Button
            size="small"
            color="inherit"
            startIcon={<CloseRoundedIcon fontSize="small" />}
            onClick={() => setDecision('discarded')}
            aria-label={`${t('aiContent.discard')} · ${label}`}
          >
            {t('aiContent.discard')}
          </Button>
        ) : (
          <Button size="small" color="inherit" onClick={() => setDecision(null)}>
            {t('aiContent.undo')}
          </Button>
        )}
      </Stack>
    </Box>
  )
}
