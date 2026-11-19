import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import { Box, Skeleton, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { usePromotionImpact } from './impact'

/**
 * ¿Funcionó la campaña? (2026-11-19). Ventas de SUS productos durante la
 * vigencia frente al mismo número de días justo antes, más canjes y descuento
 * dado. Lo calcula la base (`promotion_impact`); aquí solo se pinta.
 */
export function PromotionImpact({ promotionId, currency }: { promotionId: string; currency: string }) {
  const { t, locale } = useI18n()
  const query = usePromotionImpact(promotionId)

  // Sin permiso o sin datos todavía, el bloque no se pinta: no es un error de la campaña.
  if (query.isError) return null
  if (query.isPending) return <Skeleton variant="rounded" height={72} />
  const d = query.data
  if (!d.started || !d.during || !d.before) {
    return <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('promotions.impact.notStarted')}</Typography>
  }
  const money = (n: number) => n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
  const cambio = d.units_change_pct

  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <InsightsRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)' }} aria-hidden />
        <Typography sx={{ fontWeight: 700 }}>{t('promotions.impact.title')}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13 }} className="tnum">
        {t('promotions.impact.during')
          .replace('{days}', String(Math.round(d.days ?? 0)))
          .replace('{units}', String(d.during.units))
          .replace('{revenue}', money(d.during.revenue))}
      </Typography>
      <Typography sx={{ fontSize: 13 }} className="tnum">
        {t('promotions.impact.before').replace('{units}', String(d.before.units)).replace('{revenue}', money(d.before.revenue))}
      </Typography>
      {cambio !== null && cambio !== undefined && (
        <Typography sx={{ fontSize: 13, fontWeight: 700, mt: 0.5 }} className="tnum">
          {t(cambio >= 0 ? 'promotions.impact.up' : 'promotions.impact.down').replace('{pct}', String(Math.abs(cambio)))}
        </Typography>
      )}
      {d.redemptions && (
        <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', mt: 0.5 }} className="tnum">
          {t('promotions.impact.redemptions')
            .replace('{count}', String(d.redemptions.count))
            .replace('{discount}', money(d.redemptions.discount))}
        </Typography>
      )}
      {d.partial_scope && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 0.5 }}>{t('promotions.impact.partial')}</Typography>
      )}
      <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 0.5 }}>{t('promotions.impact.note')}</Typography>
    </Box>
  )
}
