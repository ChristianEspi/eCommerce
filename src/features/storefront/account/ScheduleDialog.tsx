import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { SCHEDULE_INTERVALS, isoDateFromToday, scheduleFormError } from '../scheduledOrders'

export interface ScheduleFormValues {
  readonly name: string
  readonly intervalDays: number
  readonly nextRunOn: string
  readonly endsOn: string | null
}

const FIELD_ERROR: Record<NonNullable<ReturnType<typeof scheduleFormError>>, MessageKey> = {
  name: 'account.schedules.form.error.name',
  interval: 'account.schedules.form.error.interval',
  nextRunOn: 'account.schedules.form.error.nextRunOn',
  endsOn: 'account.schedules.form.error.endsOn',
}

/**
 * El formulario de una programación: nombre, cada cuánto, primera fecha y fin.
 *
 * La primera fecha mínima es MAÑANA y no hoy: la base compara con su fecha
 * (UTC), y a última hora de la tarde en Lima «hoy» ya es ayer para el servidor.
 * Pedir mañana evita un rechazo que el comprador no entendería.
 */
export function ScheduleDialog({
  open,
  title,
  intro,
  initial,
  saving,
  submitLabel,
  notice,
  submitDisabled = false,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  intro?: string
  initial?: ScheduleFormValues
  saving: boolean
  submitLabel: string
  /** Aviso previo a cualquier acción: qué no se podrá programar y por qué. */
  notice?: ReactNode
  /** `true` cuando se sabe de antemano que no hay nada que programar. */
  submitDisabled?: boolean
  onClose: () => void
  onSubmit: (values: ScheduleFormValues) => void
}) {
  const { t } = useI18n()
  const minDate = isoDateFromToday(1)
  const [name, setName] = useState(initial?.name ?? '')
  const [intervalDays, setIntervalDays] = useState(initial?.intervalDays ?? 7)
  const [nextRunOn, setNextRunOn] = useState(initial?.nextRunOn ?? minDate)
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? '')
  const [touched, setTouched] = useState(false)

  const values: ScheduleFormValues = {
    name,
    intervalDays,
    nextRunOn,
    endsOn: endsOn === '' ? null : endsOn,
  }
  // Al editar, una primera fecha ya pasada que no se tocó es la de la programación
  // viva: no se exige mañana hasta que la cambien.
  const floor = initial && initial.nextRunOn === nextRunOn ? nextRunOn : minDate
  const error = scheduleFormError({ ...values, today: floor })
  const intervals = SCHEDULE_INTERVALS.includes(intervalDays as (typeof SCHEDULE_INTERVALS)[number])
    ? SCHEDULE_INTERVALS
    : [...SCHEDULE_INTERVALS, intervalDays].sort((a, b) => a - b)

  function enviar() {
    setTouched(true)
    if (error) return
    onSubmit(values)
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {intro && (
            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
              {intro}
            </Typography>
          )}
          {notice}
          <TextField
            label={t('account.schedules.form.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
            required
            error={touched && error === 'name'}
            helperText={touched && error === 'name' ? t(FIELD_ERROR.name) : undefined}
            slotProps={{ htmlInput: { maxLength: 120 }, inputLabel: { shrink: true } }}
          />
          <TextField
            select
            label={t('account.schedules.form.interval')}
            value={intervalDays}
            onChange={(event) => setIntervalDays(Number(event.target.value))}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          >
            {intervals.map((days) => (
              <MenuItem key={days} value={days}>
                {t('account.schedules.every').replace('{days}', String(days))}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              type="date"
              label={t('account.schedules.form.nextRunOn')}
              value={nextRunOn}
              onChange={(event) => setNextRunOn(event.target.value)}
              fullWidth
              required
              error={touched && error === 'nextRunOn'}
              helperText={touched && error === 'nextRunOn' ? t(FIELD_ERROR.nextRunOn) : undefined}
              slotProps={{ htmlInput: { min: floor }, inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label={t('account.schedules.form.endsOn')}
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
              fullWidth
              error={touched && error === 'endsOn'}
              helperText={touched && error === 'endsOn' ? t(FIELD_ERROR.endsOn) : t('account.schedules.form.endsOnHelp')}
              slotProps={{ htmlInput: { min: nextRunOn }, inputLabel: { shrink: true } }}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
            {t('account.schedules.form.hint')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={enviar} disabled={saving || submitDisabled}>
          {saving ? t('account.schedules.saving') : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
