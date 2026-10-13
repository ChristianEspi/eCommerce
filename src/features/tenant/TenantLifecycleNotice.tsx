import PauseCircleRoundedIcon from '@mui/icons-material/PauseCircleRounded'
import { Box, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { suspensionMessageKey, useTenantLifecycle } from './lifecycle'

/**
 * Aviso FIJO «Cuenta suspendida» en la cabecera del contenido del backoffice
 * (lifecycle.v1). Con impago dice «regularice el pago con su proveedor».
 *
 * Es UX: no deshabilita nada por sí mismo. Si alguien intenta escribir igual, la
 * base responde `TENANT_SUSPENDED` y la pantalla lo traduce con
 * `tenantLifecycle.error`. Se calla mientras la consulta no ha respondido y
 * cuando la cuenta está activa.
 */
export function TenantLifecycleNotice() {
  const { t } = useI18n()
  const lifecycle = useTenantLifecycle()
  const data = lifecycle.data
  if (!data || data.state !== 'SUSPENDED') return null

  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="tenant-lifecycle-notice"
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        mb: 2,
        px: 1.5,
        py: 1,
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--red)',
        bgcolor: 'var(--red-soft)',
      }}
    >
      <PauseCircleRoundedIcon fontSize="small" sx={{ color: 'var(--red)', mt: '2px' }} aria-hidden />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>
          {t('tenantLifecycle.suspended.title')}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--text)' }}>{t(suspensionMessageKey(data.reason))}</Typography>
      </Box>
    </Box>
  )
}
