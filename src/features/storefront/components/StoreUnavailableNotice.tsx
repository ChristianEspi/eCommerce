import { Alert, AlertTitle } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useStoreOperational } from '../availability'

/**
 * «Tienda no disponible temporalmente» (lifecycle.v1): la cuenta del comercio
 * está suspendida. El catálogo se sigue viendo; comprar no. Solo UX: el
 * servidor rechaza carrito, checkout y pedido aunque este aviso no salga.
 */
export function StoreUnavailableNotice({ storeSlug }: { storeSlug: string }) {
  const { t } = useI18n()
  const { data: operational } = useStoreOperational(storeSlug)
  if (operational !== false) return null

  return (
    <Alert severity="warning" role="status" data-testid="store-unavailable-notice" sx={{ mb: 2 }}>
      <AlertTitle>{t('tenantLifecycle.store.title')}</AlertTitle>
      {t('tenantLifecycle.store.body')}
    </Alert>
  )
}
