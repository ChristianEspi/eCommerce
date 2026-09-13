import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { z } from 'zod'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R } from '@/theme/tokens'
import { AuthShell, CTA_SX, FieldLabel, ROUNDED_FIELD_SX } from './AuthShell'
import { AuthActionError, requestPasswordReset } from './authApi'
import { returnPathFrom } from './returnTo'

const schema = z.object({
  email: z.string().min(1, 'auth.required.email').email('auth.invalid.email'),
})

type FormValues = z.infer<typeof schema>

/**
 * Recuperación de contraseña — paso 1: pedir el enlace.
 *
 * El mensaje de éxito es el mismo exista o no la cuenta. Decir "ese correo no
 * está registrado" convierte esta pantalla en un enumerador de usuarios del
 * cliente, que es justo lo que no debe salir de aquí.
 *
 * Si se vino de una tienda (N02), la vuelta viaja en el enlace del correo como
 * `returnTo` —solo si es ruta interna— y «Volver» regresa al login con ella.
 */
export function ForgotPasswordPage() {
  const { t } = useI18n()
  const location = useLocation()
  const from = returnPathFrom(location.state, location.search)
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      await requestPasswordReset(values.email, from)
      setSent(true)
    } catch (error) {
      setServerError(error instanceof AuthActionError ? error.key : 'auth.error.generic')
    }
  }

  return (
    <AuthShell
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      secondary={
        <Box
          component={RouterLink}
          to="/login"
          state={from ? { from } : undefined}
          sx={{ fontWeight: 600, color: 'var(--accent-deep)' }}
        >
          {t('auth.backToLogin')}
        </Box>
      }
    >
      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {sent && (
          <Alert severity="success" sx={{ mb: 2, borderRadius: `${R.md}px` }}>
            {t('auth.forgot.sent')}
          </Alert>
        )}
        {serverError && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: `${R.md}px` }}>
            {t(serverError)}
          </Alert>
        )}

        <Stack spacing={2.25}>
          <Box>
            <FieldLabel htmlFor="forgot-email">{t('auth.email')}</FieldLabel>
            <TextField
              id="forgot-email"
              type="email"
              fullWidth
              autoComplete="email"
              error={Boolean(errors.email)}
              helperText={errors.email?.message ? t(errors.email.message as MessageKey) : undefined}
              sx={ROUNDED_FIELD_SX}
              {...register('email')}
            />
          </Box>

          <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={CTA_SX}>
            {t('auth.forgot.submit')}
          </Button>
        </Stack>
      </Box>
    </AuthShell>
  )
}
