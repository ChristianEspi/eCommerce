import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { AuditSection } from './AuditSection'
import { CampaignsSection } from './CampaignsSection'
import { CouponsSection } from './CouponsSection'
import { GiftCardsSection } from './GiftCardsSection'
import { SimulatorSection } from './SimulatorSection'

/**
 * Promociones: qué se descuenta, con qué código, con qué saldo y por qué.
 *
 * Cinco caras de la misma pregunta —«¿por qué este carrito cuesta esto?»— y por
 * eso van en tabs centrados con deep-link `#hash` (regla de suite §8) y no en
 * cinco entradas de menú. El orden no es alfabético: primero las campañas, que
 * es a lo que se entra el 90 % de las veces; el simulador y la bitácora son la
 * respuesta a un problema, no la visita del lunes.
 *
 * La ruta está gateada por la capacidad `promotions`. Sin el módulo contratado,
 * `CapabilityGate` pinta «no está en tu plan» y esta pantalla no se monta: el
 * tenant sigue vendiendo y sus pedidos siguen costando el precio de lista, que
 * es lo que hacían antes de P10. Se degrada, no se rompe — igual que el
 * inventario multialmacén, el motor de precios y los pagos.
 */
export function PromotionsPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()

  const items = useMemo(
    () => [
      { id: 'campanas', label: t('promotions.tab.campaigns'), content: <CampaignsSection /> },
      { id: 'cupones', label: t('promotions.tab.coupons'), content: <CouponsSection /> },
      { id: 'tarjetas', label: t('promotions.tab.giftCards'), content: <GiftCardsSection /> },
      { id: 'simulador', label: t('promotions.tab.simulator'), content: <SimulatorSection /> },
      { id: 'bitacora', label: t('promotions.tab.audit'), content: <AuditSection /> },
    ],
    [t],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<LocalOfferRoundedIcon />} title={t('promotions.title')} subtitle={t('promotions.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<LocalOfferRoundedIcon />} title={t('promotions.title')} subtitle={t('promotions.subtitle')} />
        <Card>
          <EmptyState
            title={t('admin.store.none')}
            description={t('admin.store.noneBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <SectionTabs
        items={items}
        ariaLabel={t('promotions.title')}
        header={(tabs) => (
          <PageHeader
            icon={<LocalOfferRoundedIcon />}
            title={t('promotions.title')}
            subtitle={activeStore?.name ?? t('promotions.subtitle')}
            center={tabs}
          />
        )}
      />
    </>
  )
}
