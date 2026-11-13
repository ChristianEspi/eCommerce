import PriceChangeRoundedIcon from '@mui/icons-material/PriceChangeRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { DiagnosticsSection } from './DiagnosticsSection'
import { PriceListsSection } from './PriceListsSection'
import { SegmentsSection } from './SegmentsSection'
import { SimulatorSection } from './SimulatorSection'

/**
 * Precios: listas, a quién se le aplican, con qué se comprueban y qué se
 * cambió.
 *
 * Cuatro asuntos de la misma decisión comercial, así que van en tabs centrados
 * con deep-link `#hash` (regla de suite §8) y no en cuatro entradas de menú.
 * El simulador está aquí y no escondido en un rincón por una razón concreta:
 * una precedencia mal puesta no se ve mirando la lista, se ve preguntando
 * «¿cuánto le costaría a este?», y esa pregunta tiene que estar al lado de
 * donde se responde.
 *
 * La ruta está gateada por `pricing.lists`: sin el módulo contratado,
 * `CapabilityGate` pinta «no está en tu plan» y esta pantalla no se monta. La
 * autoridad, como siempre, es la RLS.
 */
export function PricingPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()

  const items = useMemo(
    () => [
      { id: 'listas', label: t('pricing.tab.lists'), content: <PriceListsSection /> },
      { id: 'segmentos', label: t('pricing.tab.segments'), content: <SegmentsSection /> },
      { id: 'simulador', label: t('pricing.tab.simulator'), content: <SimulatorSection /> },
      { id: 'diagnostico', label: t('pricing.tab.diagnostics'), content: <DiagnosticsSection /> },
    ],
    [t],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<PriceChangeRoundedIcon />} title={t('pricing.title')} subtitle={t('pricing.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<PriceChangeRoundedIcon />} title={t('pricing.title')} subtitle={t('pricing.subtitle')} />
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
        ariaLabel={t('pricing.title')}
        header={(tabs) => (
          <PageHeader icon={<PriceChangeRoundedIcon />} title={t('pricing.title')} subtitle={activeStore?.name ?? t('pricing.subtitle')} center={tabs} />
        )}
      />
    </>
  )
}
