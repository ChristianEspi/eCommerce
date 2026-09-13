import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded'
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/shared/i18n/i18n-context'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { checkoutProfileKey, fetchCheckoutProfile, formatSavedAddress, isMissingFunction } from '../consumer'

/**
 * Mis direcciones (H04).
 *
 * Son las direcciones a las que la persona YA pidió con su cuenta en esta
 * tienda, la más reciente primero. No hay libreta editable, y es a propósito:
 * el modelo de direcciones que existe es el de la ficha de cliente B2B, que
 * administra el comercio. Una libreta propia del consumidor necesita su propia
 * tabla, y eso queda escrito como follow-up en vez de improvisarse aquí.
 *
 * Lo que sí resuelve hoy: no volver a escribir la dirección en cada compra. El
 * checkout propone estas mismas.
 */
export function ConsumerAddressesSection({ storeSlug }: { storeSlug: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: checkoutProfileKey(storeSlug),
    queryFn: () => fetchCheckoutProfile(storeSlug),
    retry: (count, error) => !isMissingFunction(error) && count < 2,
  })

  if (query.isPending) return <BrandLoader />
  if (query.isError && isMissingFunction(query.error)) {
    return (
      <EmptyState
        title={t('account.consumer.unavailable')}
        description={t('account.consumer.unavailableBody')}
        icon={<PlaceRoundedIcon fontSize="small" />}
      />
    )
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const addresses = query.data?.addresses ?? []
  if (addresses.length === 0) {
    return (
      <EmptyState
        title={t('account.consumer.addresses.empty')}
        description={t('account.consumer.addresses.emptyBody')}
        icon={<PlaceRoundedIcon fontSize="small" />}
      />
    )
  }

  return (
    <Stack spacing={1.5}>
      {addresses.map((address, index) => (
        <Card
          key={`${formatSavedAddress(address)}-${index}`}
          sx={{ borderRadius: 'var(--sf-radius)', border: '1px solid var(--sf-line)' }}
        >
          <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <PlaceRoundedIcon fontSize="small" sx={{ color: 'var(--accent-deep)', mt: 0.25 }} aria-hidden />
            <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.5}>
              <Typography sx={{ fontWeight: 700, fontSize: TS.body, overflowWrap: 'anywhere' }}>
                {address.address}
              </Typography>
              <Typography sx={{ color: 'var(--muted)', fontSize: TS.label, overflowWrap: 'anywhere' }}>
                {[address.reference, address.city, address.region, address.postal_code, address.country]
                  .filter(Boolean)
                  .join(', ')}
              </Typography>
            </Stack>
            {index === 0 && <Chip size="small" label={t('account.consumer.addresses.latest')} />}
          </CardContent>
        </Card>
      ))}
    </Stack>
  )
}
