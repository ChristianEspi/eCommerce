import { zodResolver } from '@hookform/resolvers/zod'
import PersonAddAlt1RoundedIcon from '@mui/icons-material/PersonAddAlt1Rounded'
import { Alert, Box, Button, Card, CardContent, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { z } from 'zod'
import { AuthActionError, signUpConsumer } from '@/features/auth/authApi'
import { MIN_PASSWORD_LENGTH } from '@/features/auth/passwordPolicy'
import { returnPathFrom, storefrontSlugOf } from '@/features/auth/returnTo'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { LoadingState } from '@/shared/ui/states'
import { useStorefront } from './hooks'
import { privateMeta } from './seo'

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'store.register.nameRequired').max(120, 'account.consumer.profile.nameTooLong'),
    email: z.string().trim().min(1, 'store.register.emailRequired').email('auth.invalid.email'),
    phone: z
      .string()
      .trim()
      .max(40, 'account.consumer.profile.phoneInvalid')
      .refine((value) => value === '' || /^[+\d][\d\s()-]{5,39}$/.test(value), 'account.consumer.profile.phoneInvalid'),
    password: z.string().min(MIN_PASSWORD_LENGTH, 'auth.reset.tooShort'),
    confirm: z.string().min(1, 'auth.reset.confirmRequired'),
  })
  .refine((values) => values.password === values.confirm, { path: ['confirm'], message: 'auth.reset.mismatch' })

type FormValues = z.infer<typeof schema>

/**
 * Crear cuenta de CONSUMIDOR desde la vitrina (N02).
 *
 * Vive dentro de la tienda —con su marca, su cabecera y su pie— porque quien
 * llega aquí está comprando en ELLA, no dando de alta una empresa en EBIM. Crea
 * una cuenta de acceso y nada más: el alta de tenant sigue siendo `/onboarding`.
 *
 * A dónde vuelve: a la ruta de ESTA tienda de la que vino (`from`), o a «Mi
 * cuenta» de esta tienda. Un `from` de otra tienda o fuera de la vitrina no se
 * respeta: registrarse en `marathon` no puede dejar a nadie en otro sitio.
 *
 * Si el proyecto exige confirmar el correo, se dice y el enlace del correo
 * vuelve aquí; si no, la sesión ya está abierta y se entra directamente.
 */
export function StoreRegisterPage() {
  const { t, locale } = useI18n()
  const { store, storeSlug } = useStorefront()
  const { status } = useSessionContext()
  const location = useLocation()
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  useDocumentMeta(
    privateMeta({ store, storeSlug, locale, pathname: `/s/${storeSlug}` }, t('store.register.title'), '/register'),
  )

  const pedido = returnPathFrom(location.state, location.search)
  const vuelta = pedido !== null && storefrontSlugOf(pedido) === storeSlug ? pedido : `/s/${storeSlug}/account`

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', confirm: '' },
  })

  if (status === 'loading') return <LoadingState />
  if (status === 'authenticated' && pendingEmail === null) return <Navigate to={vuelta} replace />

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      const { needsConfirmation } = await signUpConsumer({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        phone: values.phone,
        returnTo: vuelta,
      })
      if (needsConfirmation) setPendingEmail(values.email.trim().toLowerCase())
    } catch (error) {
      setServerError(
        error instanceof AuthActionError && error.key !== 'auth.error.generic' ? error.key : 'store.register.failed',
      )
    }
  }

  const message = (key: string | undefined) => (key ? t(key as MessageKey) : undefined)
  const entrar = (
    <MuiLink component={Link} to="/login" state={{ from: vuelta }} sx={{ fontWeight: 700, color: 'var(--accent-deep)' }}>
      {t('store.register.haveAccount')}
    </MuiLink>
  )

  return (
    <Box sx={{ display: 'grid', placeItems: 'start center', py: { xs: 1, md: 3 } }}>
      <Card sx={{ width: '100%', maxWidth: 520, borderRadius: 'var(--sf-radius)', border: '1px solid var(--sf-line)' }}>
        <CardContent sx={{ p: { xs: 2.25, sm: 3.5 } }}>
          <Stack spacing={2.25}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box
                aria-hidden
                sx={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 'var(--sf-pill)',
                  bgcolor: 'var(--accent-soft)',
                  color: 'var(--accent-deep)',
                }}
              >
                <PersonAddAlt1RoundedIcon fontSize="small" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
                  {t('store.register.title')}
                </Typography>
                <Typography sx={{ color: 'var(--muted)', fontSize: 14 }}>
                  {t('store.register.subtitle').replace('{store}', store.name)}
                </Typography>
              </Box>
            </Stack>

            {pendingEmail !== null ? (
              <Stack spacing={2}>
                <Alert severity="success" role="status">
                  {t('store.register.checkEmail').replace('{email}', pendingEmail)}
                </Alert>
                {entrar}
              </Stack>
            ) : (
              <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
                <Stack spacing={2}>
                  {serverError && (
                    <Alert severity="error">
                      {t(serverError)}
                    </Alert>
                  )}
                  <TextField
                    id="register-name"
                    label={t('account.consumer.profile.name')}
                    autoComplete="name"
                    required
                    error={Boolean(errors.fullName)}
                    helperText={message(errors.fullName?.message)}
                    fullWidth
                    {...register('fullName')}
                  />
                  <TextField
                    id="register-email"
                    label={t('account.consumer.profile.email')}
                    type="email"
                    autoComplete="email"
                    required
                    error={Boolean(errors.email)}
                    helperText={message(errors.email?.message)}
                    fullWidth
                    {...register('email')}
                  />
                  <TextField
                    id="register-phone"
                    label={t('account.consumer.profile.phone')}
                    type="tel"
                    autoComplete="tel"
                    error={Boolean(errors.phone)}
                    helperText={message(errors.phone?.message) ?? t('account.consumer.profile.phoneHint')}
                    fullWidth
                    {...register('phone')}
                  />
                  <TextField
                    id="register-password"
                    label={t('auth.password')}
                    type="password"
                    autoComplete="new-password"
                    required
                    error={Boolean(errors.password)}
                    helperText={message(errors.password?.message) ?? t('auth.reset.tooShort')}
                    fullWidth
                    {...register('password')}
                  />
                  <TextField
                    id="register-confirm"
                    label={t('auth.reset.confirm')}
                    type="password"
                    autoComplete="new-password"
                    required
                    error={Boolean(errors.confirm)}
                    helperText={message(errors.confirm?.message)}
                    fullWidth
                    {...register('confirm')}
                  />
                  <Button type="submit" variant="contained" size="large" disabled={isSubmitting} fullWidth>
                    {t('store.register.submit')}
                  </Button>
                  <Typography sx={{ textAlign: 'center', fontSize: 14 }}>{entrar}</Typography>
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
