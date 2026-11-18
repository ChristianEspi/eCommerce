import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useEffect, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'

/**
 * El diálogo del MOTIVO, compartido por las tres acciones manuales del monitor:
 * reintentar un mensaje, reproducir una entrega y cerrar un disyuntor.
 *
 * Es un componente y no tres diálogos copiados porque las tres comparten la
 * misma regla, y la regla es de la BASE y no de la pantalla: los tres comandos
 * rechazan un motivo vacío (`MOTIVO_REQUERIDO`) y los tres escriben en
 * `audit_log`. Reenviar datos a un tercero o reintentar una operación que ya
 * falló seis veces son actos que tienen que tener autor y explicación; la
 * pantalla solo se asegura de que nadie los intente sin ella y se lleve un
 * error del servidor por respuesta.
 *
 * El mínimo de tres caracteres es el MISMO que el de la base a propósito: un
 * botón que se habilita para algo que el servidor va a rechazar enseña a la
 * gente a desconfiar de los botones.
 */
export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  pending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')

  // Se vacía al abrir, no al cerrar: si se conservara, el motivo del incidente
  // anterior acabaría firmando el siguiente.
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ color: 'var(--muted)', mb: 2 }}>{body}</Typography>
        <Field
          rule="longText" maxLength={500}
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label={t('integrations.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={reason.trim().length < 3 || pending}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
