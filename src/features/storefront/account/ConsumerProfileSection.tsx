import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthActionError, updateProfile } from '@/features/auth/authApi'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { TS } from '@/theme/tokens'
import { profileFromSession } from '../consumer'

const schema = z.object({
  fullName: z.string().trim().max(120, 'account.consumer.profile.nameTooLong'),
  phone: z
    .string()
    .trim()
    .max(40, 'account.consumer.profile.phoneInvalid')
    .refine((value) => value === '' || /^[+\d][\d\s()-]{5,39}$/.test(value), 'account.consumer.profile.phoneInvalid'),
})

type FormValues = z.infer<typeof schema>

/**
 * Mis datos (H04).
 *
 * El correo se ENSEÑA y no se edita: es la identidad con la que se entra, y
 * cambiarla desde un formulario de perfil sería cambiar de cuenta sin darse
 * cuenta. Nombre y teléfono sí, y son los que el checkout propone después.
 */
export function ConsumerProfileSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { session } = useSessionContext()
  const profile = profileFromSession(session)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: profile.fullName, phone: profile.phone },
  })

  // Cuando la sesión trae los datos nuevos (tras guardar, o al hidratar), el
  // formulario parte de ellos y deja de estar «sucio».
  useEffect(() => {
    reset({ fullName: profile.fullName, phone: profile.phone })
  }, [profile.fullName, profile.phone, reset])

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      await updateProfile(values)
      notify(t('account.consumer.profile.saved'), 'success')
      reset(values)
    } catch (error) {
      setServerError(error instanceof AuthActionError ? error.key : 'auth.error.generic')
    }
  }

  const message = (key: string | undefined) => (key ? t(key as MessageKey) : undefined)

  return (
    <Card sx={{ borderRadius: 'var(--sf-radius)', border: '1px solid var(--sf-line)', maxWidth: 560 }}>
      <CardContent>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2}>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
              {t('account.consumer.tab.profile')}
            </Typography>

            {serverError && <Alert severity="error">{t(serverError)}</Alert>}

            <TextField
              label={t('account.consumer.profile.email')}
              value={profile.email}
              slotProps={{ input: { readOnly: true } }}
              helperText={t('account.consumer.profile.emailHint')}
              fullWidth
            />
            <TextField
              label={t('account.consumer.profile.name')}
              autoComplete="name"
              error={Boolean(errors.fullName)}
              helperText={message(errors.fullName?.message)}
              fullWidth
              {...register('fullName')}
            />
            <TextField
              label={t('account.consumer.profile.phone')}
              autoComplete="tel"
              type="tel"
              error={Boolean(errors.phone)}
              helperText={message(errors.phone?.message) ?? t('account.consumer.profile.phoneHint')}
              fullWidth
              {...register('phone')}
            />

            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={isSubmitting || !isDirty}>
                {t('account.consumer.profile.save')}
              </Button>
            </Stack>
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
              {t('account.consumer.profile.usedAtCheckout')}
            </Typography>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}
