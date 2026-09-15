import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { ChannelScope } from './api'
import { ChannelError } from './errors'
import { useSaveChannel } from './hooks'
import {
  CHANNEL_KINDS,
  channelFormSchema,
  emptyChannelForm,
  requiresAuthFor,
  type Channel,
  type ChannelFormValues,
} from './types'

/**
 * Alta y edicion de un canal.
 *
 * ## La sesion no se pregunta: la decide el tipo
 *
 * B2C no pide sesion; B2B e Interno la exigen. La base lo impone con un CHECK,
 * asi que aqui se ENSEÑA como consecuencia en vez de ofrecerse como casilla: un
 * formulario que deja marcar lo que la base rechaza es un formulario que falla
 * al guardar.
 *
 * ## El canal por defecto no se apaga ni se cierra desde aqui
 *
 * Es la puerta de la tienda publica. Su interruptor de activo y los tipos
 * cerrados salen deshabilitados con el motivo escrito debajo; el trigger de la
 * base aplica la misma regla por si alguien llega sin pasar por esta pantalla.
 *
 * `settings` (jsonb) no se edita: no hay una forma documentada de ese campo, y
 * un editor de JSON libre seria configurar a ciegas.
 */
export function ChannelDrawer({
  open,
  channel,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  channel: Channel | null
  scope: ChannelScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const save = useSaveChannel()

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChannelFormValues>({
    resolver: zodResolver(channelFormSchema),
    defaultValues: emptyChannelForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(
      channel
        ? { code: channel.code, name: channel.name, kind: channel.kind, is_active: channel.is_active }
        : emptyChannelForm(),
    )
    setServerError(null)
  }, [open, channel, reset])

  const esDefecto = channel?.is_default ?? false
  const kind = watch('kind')
  const exigeSesion = requiresAuthFor(kind)

  async function submit(values: ChannelFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: channel?.id ?? null, values })
      notify(t('channels.toast.saved'), 'success')
      onClose()
    } catch (error) {
      setServerError(error instanceof ChannelError ? error.key : 'channels.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={channel ? channel.name : t('channels.new')}
      subtitle={channel?.code}
      onClose={onClose}
      busy={isSubmitting}
      width={560}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="channel-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="channel-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}
          {esDefecto && <Alert severity="info">{t('channels.defaultLocked')}</Alert>}

          <FieldRow>
            <TextField
              label={t('channels.field.code')}
              required
              disabled={!canWrite}
              error={Boolean(errors.code)}
              helperText={
                errors.code ? t(errors.code.message as MessageKey) : t('channels.field.codeHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 190 }, flexShrink: 0 }}
              {...register('code')}
            />
            <TextField
              fullWidth
              label={t('channels.field.name')}
              required
              disabled={!canWrite}
              error={Boolean(errors.name)}
              helperText={errors.name ? t(errors.name.message as MessageKey) : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('name')}
            />
          </FieldRow>

          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <TextField
                select
                label={t('channels.field.kind')}
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                disabled={!canWrite}
                slotProps={{ inputLabel: { shrink: true } }}
              >
                {CHANNEL_KINDS.map((option) => (
                  <MenuItem
                    key={option}
                    value={option}
                    // El canal por defecto solo puede ser B2C: los tipos cerrados
                    // se ven, pero no se eligen.
                    disabled={esDefecto && requiresAuthFor(option)}
                  >
                    {t(`channels.kind.${option}` as MessageKey)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <Box>
            <FormControlLabel
              control={<Switch checked={exigeSesion} disabled />}
              label={t('channels.field.requiresAuth')}
            />
            <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
              {exigeSesion
                ? t('channels.requiresAuthHelp.session')
                : t('channels.requiresAuthHelp.public')}
            </Typography>
          </Box>

          <Box>
            <Controller
              control={control}
              name="is_active"
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      disabled={!canWrite || esDefecto}
                      onChange={(event) => field.onChange(event.target.checked)}
                    />
                  }
                  label={t('channels.field.isActive')}
                />
              )}
            />
            {esDefecto && (
              <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                {t('channels.blocker.deactivateDefault')}
              </Typography>
            )}
          </Box>
        </Stack>
      </Box>
    </FormDrawer>
  )
}