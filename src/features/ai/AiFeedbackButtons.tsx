import ThumbDownRoundedIcon from '@mui/icons-material/ThumbDownRounded'
import ThumbUpRoundedIcon from '@mui/icons-material/ThumbUpRounded'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useAiFeedback } from './hooks'

/**
 * Fase 12 (a11y): `aria-disabled` y no `disabled` —un botón deshabilitado
 * suelta el foco de teclado al pulsarlo— y el «gracias» se anuncia.
 *
 * El pulgar DONDE se usa la IA (D8), no solo en la traza de Diagnóstico.
 *
 * Solo aparece cuando hay `interactionId`, que es la prueba de que la
 * respuesta dejó traza. Opinar no gasta cuota ni cambia nada del negocio: es la
 * señal más barata que existe, así que un fallo al guardarla no molesta a nadie.
 */
export function AiFeedbackButtons({ interactionId }: { interactionId: string | null }) {
  const { t } = useI18n()
  const feedback = useAiFeedback()
  const [enviado, setEnviado] = useState<1 | -1 | null>(null)

  if (!interactionId) return null

  const opinar = (value: 1 | -1) => {
    if (enviado !== null) return
    setEnviado(value)
    // Si no se pudo guardar, no se dice «gracias»: se deja volver a opinar.
    feedback.mutate({ id: interactionId, value }, { onError: () => setEnviado(null) })
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" role="group" aria-label={t('ai.feedback.prompt')}>
      <Typography component="span" role="status" sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {enviado ? t('ai.feedback.thanks') : t('ai.feedback.prompt')}
      </Typography>
      <Tooltip title={t('ai.feedback.up')}>
        <span>
          <IconButton
            size="small"
            aria-label={t('ai.feedback.up')}
            aria-pressed={enviado === 1}
            color={enviado === 1 ? 'primary' : 'default'}
            aria-disabled={enviado !== null}
            onClick={() => opinar(1)}
          >
            <ThumbUpRoundedIcon fontSize="inherit" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('ai.feedback.down')}>
        <span>
          <IconButton
            size="small"
            aria-label={t('ai.feedback.down')}
            aria-pressed={enviado === -1}
            color={enviado === -1 ? 'primary' : 'default'}
            aria-disabled={enviado !== null}
            onClick={() => opinar(-1)}
          >
            <ThumbDownRoundedIcon fontSize="inherit" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )
}
