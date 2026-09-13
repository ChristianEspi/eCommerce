import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import { Box, ButtonBase, Menu, MenuItem, Link as MuiLink, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { useStoreAccounts, useSwitchStoreAccount } from './accounts'
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
 *
 * **Varias cuentas en esta tienda (N01).** El nombre se vuelve un selector
 * discreto. Elegir PIDE la cuenta al servidor, que la valida; después se vuelve
 * a preguntar el contexto y todas las cotizaciones, sin tocar el carrito. Con
 * una sola cuenta no hay selector ni petición extra.
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
          {context.accounts_in_store > 1 ? (
            <AccountSwitcher storeSlug={storeSlug} current={context.account_name} label={etiqueta} />
          ) : (
            <Typography component="p" title={context.account_name} sx={NAME_SX}>
              {context.account_name}
            </Typography>
          )}
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

const NAME_SX = {
  fontSize: TS.body,
  fontWeight: 800,
  lineHeight: 1.3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

/**
 * «EMPRESA A ▼». El nombre largo se recorta en el botón y se lee entero en el
 * menú y en `title`. El aviso de después dice para quién se compra ahora y, si
 * alguna cotización a la vista cambió, que los precios se actualizaron.
 */
function AccountSwitcher({ storeSlug, current, label }: { storeSlug: string; current: string; label: string }) {
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const accounts = useStoreAccounts(storeSlug, true)
  const switchAccount = useSwitchStoreAccount(storeSlug)
  const open = anchor !== null
  const menuId = `commerce-accounts-${storeSlug}`

  const elegir = (accountId: string, name: string) => {
    setAnchor(null)
    setAviso(null)
    switchAccount.mutate(accountId, {
      onSuccess: ({ pricesChanged }) =>
        setAviso(t(pricesChanged ? 'store.commerce.switchedPrices' : 'store.commerce.switched').replace('{name}', name)),
      onError: () => setAviso(t('store.commerce.switchFailed')),
    })
  }

  return (
    <>
      <ButtonBase
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${current}. ${t('store.commerce.switchAccount')}`}
        title={current}
        disabled={switchAccount.isPending}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          maxWidth: '100%',
          justifyContent: 'flex-start',
          borderRadius: 'var(--sf-radius-sm)',
          color: 'inherit',
          '&:focus-visible': { outline: '2px solid var(--accent-deep)', outlineOffset: 2 },
        }}
      >
        <Typography component="span" sx={NAME_SX}>
          {current}
        </Typography>
        <ArrowDropDownRoundedIcon aria-hidden sx={{ flexShrink: 0, color: 'var(--accent-deep)' }} />
      </ButtonBase>
      <Menu id={menuId} anchorEl={anchor} open={open} onClose={() => setAnchor(null)}>
        {(accounts.data ?? []).map((account) => (
          <MenuItem
            key={account.account_id}
            selected={account.is_effective}
            onClick={() => (account.is_effective ? setAnchor(null) : elegir(account.account_id, account.name))}
            sx={{ maxWidth: 'min(90vw, 26rem)', whiteSpace: 'normal' }}
          >
            <Box aria-hidden sx={{ width: 28, flexShrink: 0, display: 'flex', color: 'var(--accent-deep)' }}>
              {account.is_effective ? <CheckRoundedIcon fontSize="small" /> : null}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="span" sx={{ display: 'block', fontSize: TS.body, fontWeight: 700 }}>
                {account.name}
              </Typography>
              {account.customer_name && account.customer_name !== account.name && (
                <Typography component="span" sx={{ display: 'block', fontSize: TS.label, color: 'var(--muted)' }}>
                  {account.customer_name}
                </Typography>
              )}
            </Box>
          </MenuItem>
        ))}
      </Menu>
      {aviso && (
        <Typography role="status" component="p" sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.25 }}>
          {aviso}
        </Typography>
      )}
    </>
  )
}
