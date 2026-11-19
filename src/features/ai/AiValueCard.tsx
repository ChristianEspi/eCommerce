import { Card, CardContent, Skeleton, Stack, Typography } from '@mui/material'
import { useContext } from 'react'
import { TenantCtx } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useAiValue } from './aiValue'

/**
 * «Lo que aportó la IA» (2026-11-19): lo que se pidió de productos que
 * llegaron al carrito con ayuda de la IA (mismo comprador, 7 días) y las
 * acciones de la IA ejecutadas. Lo calcula la base (`ai_value_summary`).
 */
export function AiValueCard() {
  const { t, locale } = useI18n()
  // Opcional: fuera de una sociedad (p. ej. una pantalla de prueba aislada) la
  // tarjeta simplemente no se pinta.
  const tenant = useContext(TenantCtx)
  const storeId = tenant?.activeStore?.id ?? null
  const canSee = Boolean(tenant?.can('tenant.manage'))
  const query = useAiValue(storeId, canSee)

  if (!storeId || !canSee || query.isError) return null
  const money = (n: number | null, currency: string | null) =>
    n === null || !currency ? '—' : n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 2 })

  return (
    <Card>
      <CardContent>
        <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 0.5 }}>{t('aiValue.title')}</Typography>
        <Typography sx={{ color: 'var(--muted)', fontSize: 12.5, mb: 1.5 }}>{t('aiValue.subtitle')}</Typography>
        {query.isPending ? (
          <Skeleton variant="rounded" height={64} />
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} className="tnum">
            <Stack>
              <Typography sx={{ fontSize: 22, fontWeight: 800 }}>
                {money(query.data.attributed_revenue, query.data.currency)}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {t('aiValue.revenue').replace('{orders}', String(query.data.attributed_orders))}
              </Typography>
            </Stack>
            <Stack>
              <Typography sx={{ fontSize: 22, fontWeight: 800 }}>{query.data.actions_executed}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {t('aiValue.actions').replace('{pending}', String(query.data.actions_pending))}
              </Typography>
            </Stack>
            <Stack>
              <Typography sx={{ fontSize: 22, fontWeight: 800 }}>{query.data.marked_lines}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiValue.marked')}</Typography>
            </Stack>
          </Stack>
        )}
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 1.5 }}>{t('aiValue.note')}</Typography>
      </CardContent>
    </Card>
  )
}
