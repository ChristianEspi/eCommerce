import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import { Box, Link as MuiLink, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { useCommerceContext } from './context'

/**
 * Para quién se está comprando, dicho una vez y sin estorbar (H05-H06).
 *
 * Solo aparece con una cuenta de empresa activa en la sociedad de esta tienda:
 *
 *  · `trade`      → «Cuenta comercial · BODEGA ESPERANZA»
 *  · `enterprise` → «Comprando para · CORPORACIÓN ANDINA SAC»
 *
 * y, SOLO si el servidor dice que hay una lista vigente asignada a su cliente o
 * a su segmento, «Condiciones comerciales activas» o «Precio convenio activo».
 * Tener cuenta no es tener convenio, y prometerlo sin que exista se descubre en
 * la factura.
 *
 * No pinta nada para el consumidor —la tienda de siempre— ni cuando la consulta
 * falla: una barra de contexto rota no puede costar una venta.
 */
export function CommerceContextBar({ storeSlug }: { storeSlug: string }) {
  const { t } = useI18n()
  const { status } = useSessionContext()
  const { audience, context } = useCommerceContext(storeSlug, status === 'authenticated')

  if (audience === 'consumer' || context === null) return null

  const enterprise = audience === 'enterprise'
  const etiqueta = enterprise ? t('store.commerce.buyingFor') : t('store.commerce.tradeAccount')
  const condiciones = context.has_commercial_pricing
    ? enterprise
      ? t('store.commerce.agreementActive')
      : t('store.commerce.tradeTermsActive')
    : null

  return (
    <Box
      component="aside"
      aria-label={t('store.commerce.region')}
      data-commerce-audience={audience}
      sx={{
        mb: { xs: 2, md: 2.5 },
        px: { xs: 1.5, md: 2 },
        py: 1,
        borderRadius: 'var(--sf-radius-sm)',
        border: '1px solid var(--sf-line)',
        bgcolor: 'var(--card)',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, flexWrap: 'wrap', minWidth: 0 }}>
        <Box
          aria-hidden
          sx={{
            width: 28,
            height: 28,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 'var(--sf-pill)',
            bgcolor: 'var(--accent-soft)',
            color: 'var(--accent-deep)',
            '& .MuiSvgIcon-root': { fontSize: 17 },
          }}
        >
          {enterprise ? <ApartmentRoundedIcon /> : <StorefrontRoundedIcon />}
        </Box>

        <Box sx={{ minWidth: 0, flex: '1 1 12rem' }}>
          <Typography
            component="p"
            sx={{ fontSize: TS.label, color: 'var(--muted)', fontWeight: 700, lineHeight: 1.2 }}
          >
            {etiqueta}
          </Typography>
          <Typography
            component="p"
            title={context.account_name}
            sx={{
              fontSize: TS.body,
              fontWeight: 800,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {context.account_name}
          </Typography>
        </Box>

        {condiciones && (
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 0.5, color: 'var(--accent-deep)', flexShrink: 0 }}
          >
            <VerifiedRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
            <Typography component="p" sx={{ fontSize: TS.label, fontWeight: 700 }}>
              {condiciones}
            </Typography>
          </Stack>
        )}

        <MuiLink
          component={Link}
          to={`/s/${storeSlug}/account`}
          sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--accent-deep)', flexShrink: 0 }}
        >
          {t('store.commerce.viewAccount')}
        </MuiLink>
      </Stack>
    </Box>
  )
}
