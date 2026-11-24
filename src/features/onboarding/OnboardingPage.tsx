import { zodResolver } from '@hookform/resolvers/zod'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate } from 'react-router-dom'
import { z } from 'zod'
import { useSessionContext } from '@/features/auth/session-context'
import { useTenant } from '@/features/tenant/tenant-context'
import { WORKSPACE_KEY_ROOT } from '@/features/tenant/workspace'
import { useCurrencies } from '@/shared/lib/currencies'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { BrandLockup } from '@/shared/ui/BrandLockup'
import { ErrorState, LoadingState, UnauthorizedState } from '@/shared/ui/states'
import { R } from '@/theme/tokens'
import {
  BootstrapError,
  STORE_SLUG_RE,
  bootstrapTenant,
  slugify,
} from './bootstrapTenant'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * La lista de monedas vive en `public.currencies`, no aquí: cablearla obligaba
 * a desplegar para dar de alta un país nuevo (BOB no estaba, así que ninguna
 * tienda boliviana podía crearse). El schema solo valida la FORMA —tres letras
 * mayúsculas—; que el código exista lo garantiza la FK contra el catálogo.
 */
const CURRENCY_CODE_RE = /^[A-Z]{3}$/

const schema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, 'onboarding.error.nameShort')
    .max(200, 'onboarding.error.nameLong'),
  storeSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(STORE_SLUG_RE, 'onboarding.error.slugFormat'),
  currency: z.string().regex(CURRENCY_CODE_RE, 'onboarding.error.currency'),
})

type FormValues = z.infer<typeof schema>

/**
 * Alta mínima del espacio del negocio.
 *
 * Tres campos y ni uno más: nombre, dirección de la tienda y moneda. Todo lo
 * que el servidor puede saber por sí mismo —quién eres, a qué cuenta perteneces
 * y con qué correo— NO se pregunta: sale del token. El correo del administrador
 * que exige el contrato §3.2 es el de esta misma sesión, y se muestra para que
 * quede claro quién queda como dueño del espacio.
 */
export function OnboardingPage() {
  const { t } = useI18n()
  const { session } = useSessionContext()
  const { status, email, error: tenantError, refetch } = useTenant()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [slugEdited, setSlugEdited] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { businessName: '', storeSlug: '', currency: '' },
  })

  const { data: currencies = [] } = useCurrencies()

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      await bootstrapTenant({
        tenant_name: values.businessName,
        store_slug: values.storeSlug,
        currency: values.currency,
      })
      // El espacio ya existe: se invalida el workspace para que el guard deje
      // pasar al backoffice con datos frescos, no con el cache del "sin tenant".
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_KEY_ROOT })
      refetch()
    } catch (error) {
      setServerError(error instanceof BootstrapError ? error.key : 'onboarding.error.generic')
    }
  }

  if (status === 'loading') return <LoadingState />
  if (status === 'error') return <ErrorState error={tenantError} onRetry={refetch} />
  if (status === 'unauthorized') {
    return (
      <UnauthorizedState
        title={t('tenant.unauthorized.title')}
        description={t('tenant.unauthorized.body')}
      />
    )
  }
  // Quien ya tiene espacio no pasa por aquí, ni escribiendo la URL a mano.
  if (status === 'ready') return <Navigate to="/app" replace />

  const fieldError = (key: keyof FormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  const slugPreview = `${typeof window === 'undefined' ? '' : window.location.origin}/s/${
    watch('storeSlug') || 'mi-tienda'
  }`

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'var(--bg)', display: 'grid', placeItems: 'center', p: { xs: 2, md: 4 } }}>
      <Box sx={{ width: '100%', maxWidth: 560 }}>
        <Stack spacing={2} sx={{ alignItems: 'center', mb: 3 }}>
          <BrandLockup size={30} />
        </Stack>

        <Card>
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
              <Box
                sx={{
                  width: 38,
                  height: 38,
                  borderRadius: `${R.md}px`,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'var(--accent-soft)',
                  color: 'var(--accent-deep)',
                }}
                aria-hidden
              >
                <StorefrontRoundedIcon fontSize="small" />
              </Box>
              <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px' }}>
                {t('onboarding.title')}
              </Typography>
            </Stack>

            <Typography sx={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.6, mb: 3 }}>
              {t('onboarding.subtitle')}
            </Typography>

            <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
              {serverError && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: `${R.md}px` }}>
                  {t(serverError)}
                </Alert>
              )}

              <Stack spacing={2.5}>
                <Field
                  rule="text" maxLength={200}
                  label={t('onboarding.businessName')}
                  fullWidth
                  autoFocus
                  error={Boolean(errors.businessName)}
                  helperText={fieldError('businessName') ?? t('onboarding.businessName.help')}
                  {...register('businessName', {
                    onChange: (event: ChangeEvent<HTMLInputElement>) => {
                      // La sugerencia se deja de tocar en cuanto el usuario
                      // escribe su propio slug: no se le pisa lo que eligió.
                      if (!slugEdited) setValue('storeSlug', slugify(event.target.value))
                    },
                  })}
                />

                <Field
                  rule="slug" maxLength={62} help={t('help.onboarding.storeSlug')}
                  label={t('onboarding.storeSlug')}
                  fullWidth
                  error={Boolean(errors.storeSlug)}
                  helperText={fieldError('storeSlug') ?? slugPreview}
                  inputProps={{ spellCheck: false }}
                  {...register('storeSlug', { onChange: () => setSlugEdited(true) })}
                />

                <SelectField
                  label={t('onboarding.currency')}
                  fullWidth
                  error={Boolean(errors.currency)}
                  helperText={fieldError('currency') ?? t('onboarding.currency.help')}
                  {...register('currency')}
                >
                  {currencies.map((currency) => (
                    <MenuItem key={currency.code} value={currency.code}>
                      {currency.code} — {currency.name}
                    </MenuItem>
                  ))}
                </SelectField>

                <Alert severity="info" icon={false} sx={{ borderRadius: `${R.md}px` }}>
                  {t('onboarding.owner')}{' '}
                  <Box component="strong">{email || session?.user?.email || '—'}</Box>
                </Alert>

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={isSubmitting}
                  sx={{ borderRadius: '11px', py: '13px', fontWeight: 700 }}
                >
                  {isSubmitting ? t('common.loading') : t('onboarding.submit')}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>

        <Typography sx={{ textAlign: 'center', mt: 2, fontSize: 12, color: 'var(--muted)' }}>
          {t('onboarding.changeLater')}
        </Typography>
      </Box>
    </Box>
  )
}
