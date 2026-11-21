import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { StorePreferencesSection } from '@/features/notifications/StorePreferencesSection'
import { useStorefrontOptional } from '../hooks'
import { resolveShowThemeToggle } from '../identity'
import { useI18n } from '@/shared/i18n/i18n-context'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TS } from '@/theme/tokens'
import { FavoritesView } from '../StoreFavoritesPage'
import { greetingName, profileFromSession } from '../consumer'
import { ConsumerAddressesSection } from './ConsumerAddressesSection'
import { ConsumerProfileSection } from './ConsumerProfileSection'
import { MyCouponsSection } from './MyCouponsSection'
import { MyOrdersSection } from './MyOrdersSection'

/**
 * «Mi cuenta» del consumidor registrado (hardening H02).
 *
 * Es lo que ve quien entra con su usuario y NO compra para una empresa. Antes
 * esta persona leía «tu usuario no está vinculado a ninguna empresa»: cierto,
 * pero dicho a alguien que nunca quiso comprar para una empresa es decirle que
 * su cuenta está rota.
 *
 * La misma ruta `/account` resuelve las dos experiencias y quien decide cuál es
 * el SERVIDOR (`my_business_accounts`): con cuenta de empresa activa, el portal
 * B2B de siempre, intacto; sin ella, esto.
 *
 * Seis pestañas y no seis pantallas, con `SectionTabs` y `#hash` como el resto
 * de la suite: «mira mis pedidos» se comparte como enlace.
 */
export function ConsumerAccount({
  storeSlug,
  storeId,
  pendingAccountNames,
}: {
  /** `null` cuando la pantalla se monta sin tienda resuelta. */
  storeSlug: string | null
  storeId: string | null
  /** Empresas que vincularon a la persona y todavía no activaron su acceso. */
  pendingAccountNames: readonly string[]
}) {
  const { t } = useI18n()
  const { session } = useSessionContext()
  const storefront = useStorefrontOptional()
  const profile = profileFromSession(session)
  const nombre = greetingName(profile)

  const items = [
    ...(storeSlug
      ? [
          {
            id: 'pedidos',
            label: t('account.tab.orders'),
            content: <MyOrdersSection storeSlug={storeSlug} source="consumer" storeId={storeId} />,
          },
          {
            id: 'favoritos',
            label: t('account.consumer.tab.favorites'),
            content: storeId ? (
              <FavoritesView storeId={storeId} storeSlug={storeSlug} headingComponent="h2" />
            ) : null,
          },
        ]
      : []),
    {
      id: 'datos',
      label: t('account.consumer.tab.profile'),
      // 2026-11-20 · Preferencias (claro/oscuro, recordatorios) bajo «Mis datos».
      content: (
        <Stack spacing={3}>
          <ConsumerProfileSection />
          <StorePreferencesSection showThemeOption={resolveShowThemeToggle(storefront?.store.show_theme_toggle)} />
        </Stack>
      ),
    },
    ...(storeSlug
      ? [
          {
            id: 'direcciones',
            label: t('account.consumer.tab.addresses'),
            content: <ConsumerAddressesSection storeSlug={storeSlug} />,
          },
        ]
      : []),
    // 2026-11-18 · Los cupones que le sirven a quien compra para sí: los
    // abiertos a todos y a su canal (`my_coupons` ya distingue consumidor de
    // empresa). Es la misma sección del portal B2B. `cupones` es el mismo
    // #hash que allí, para que un enlace «mira tus cupones» valga para los dos.
    ...(storeId
      ? [{ id: 'cupones', label: t('account.tab.coupons'), content: <MyCouponsSection storeId={storeId} /> }]
      : []),
  ]

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800 }}>
            {t('account.consumer.title')}
          </Typography>
          <Typography sx={{ color: 'var(--muted)', fontSize: TS.body, overflowWrap: 'anywhere' }}>
            {nombre
              ? t('account.consumer.greeting').replace('{name}', nombre)
              : t('account.consumer.greetingNoName').replace('{email}', profile.email)}
          </Typography>
        </Box>

        {storeSlug && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, flexShrink: 0 }}>
            {/* Pedido rápido también para el consumidor: una lista de SKU hacia
                el carrito. Sin cuenta de empresa no hay surtido que recorte. */}
            <Button
              variant="outlined"
              size="small"
              component={Link}
              to={`/s/${storeSlug}/pedido-rapido`}
              startIcon={<BoltRoundedIcon fontSize="small" />}
            >
              {t('store.quickOrder.open')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              component={Link}
              to={`/s/${storeSlug}`}
              startIcon={<StorefrontRoundedIcon fontSize="small" />}
            >
              {t('account.keepShopping')}
            </Button>
          </Stack>
        )}
      </Stack>

      {/* Vinculado a una empresa y todavía sin activar. Se dice, pero no tapa la
          cuenta: mientras tanto compra como consumidor y lo suyo sigue aquí. */}
      {pendingAccountNames.length > 0 && (
        <Alert severity="info" icon={<ApartmentRoundedIcon fontSize="small" />}>
          <strong>
            {t('account.pendingAccounts').replace('{names}', pendingAccountNames.join(', '))}
          </strong>
          <br />
          {t('account.pendingAccountsBody')}
        </Alert>
      )}

      <SectionTabs ariaLabel={t('account.consumer.title')} items={items} />
    </Stack>
  )
}
