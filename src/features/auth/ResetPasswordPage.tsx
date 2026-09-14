import { zodResolver } from '@hookform/resolvers/zod'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom'
import { z } from 'zod'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { LoadingState } from '@/shared/ui/states'
import { R } from '@/theme/tokens'
import { AuthShell, CTA_SX, FieldLabel, ROUNDED_FIELD_SX } from './AuthShell'
import { AuthActionError, updatePassword } from './authApi'
import { MIN_PASSWORD_LENGTH } from './passwordPolicy'
import { returnPathOr } from './returnTo'
import { useSessionContext } from './session-context'

const schema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, 'auth.reset.tooShort'),
    confirm: z.string().min(1, 'auth.reset.confirmRequired'),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'auth.reset.mismatch',
  })

type FormValues = z.infer<typeof schema>

/**
 * Recuperación de contraseña — paso 2: fijar la clave nueva.
 *
 * Solo se llega aquí con la sesión especial que emite el enlace del correo
 * (`PASSWORD_RECOVERY`). Con esa sesión el resto del backoffice está cerrado:
 * mientras no haya contraseña nueva, el guard devuelve a esta pantalla.
 *
 * Al terminar va a `?returnTo=` si es una ruta interna (la cuenta de la tienda
 * de la que se pidió el enlace, N02) y a `/app` si no, como siempre.
 */
export function ResetPasswordPage() {
  const { t } = useI18n()
  const { status, clearRecovery } = useSessionContext()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      await updatePassword(values.password)
      setDone(true)
      // A partir de aquí la sesión deja de ser "de recuperación" y vale como
      // sesión normal: el guard ya puede dejar pasar al backoffice.
      clearRecovery()
    } catch (error) {
      setServerError(error instanceof AuthActionError ? error.key : 'auth.error.generic')
    }
  }

  if (status === 'loading') return <LoadingState />
  if (done) return <Navigate to={returnPathOr(null, location.search, '/app', 'returnTo')} replace />

  // Sin sesión no hay nada que cambiar: el enlace caducó o se abrió suelto.
  const linkExpired = status === 'anonymous'

  const fieldError = (key: keyof FormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  return (
    <AuthShell
      title={t('auth.reset.title')}
      subtitle={linkExpired ? t('auth.reset.expired') : t('auth.reset.subtitle')}
      secondary={
        <Box component={RouterLink} to="/recuperar" sx={{ fontWeight: 600, color: 'var(--accent-deep)' }}>
          {t('auth.reset.requestAgain')}
        </Box>
      }
    >
      {linkExpired ? (
        <Alert severity="warning" sx={{ borderRadius: `${R.md}px` }}>
          {t('auth.error.linkExpired')}
        </Alert>
      ) : (
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {serverError && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: `${R.md}px` }}>
              {t(serverError)}
            </Alert>
          )}

          <Stack spacing={2.25}>
            <Box>
              <FieldLabel htmlFor="reset-password">{t('auth.reset.newPassword')}</FieldLabel>
              <TextField
                id="reset-password"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                autoComplete="new-password"
                error={Boolean(errors.password)}
                helperText={fieldError('password')}
                sx={ROUNDED_FIELD_SX}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword((v) => !v)}
                        edge="end"
                        aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      >
                        {showPassword ? (
                          <VisibilityOffRoundedIcon fontSize="small" />
                        ) : (
                          <VisibilityRoundedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                {...register('password')}
              />
            </Box>

            <Box>
              <FieldLabel htmlFor="reset-confirm">{t('auth.reset.confirm')}</FieldLabel>
              <TextField
                id="reset-confirm"
                type="password"
                fullWidth
                autoComplete="new-password"
                error={Boolean(errors.confirm)}
                helperText={fieldError('confirm')}
                sx={ROUNDED_FIELD_SX}
                {...register('confirm')}
              />
            </Box>

            <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={CTA_SX}>
              {t('auth.reset.submit')}
            </Button>
          </Stack>
        </Box>
      )}
    </AuthShell>
  )
}
