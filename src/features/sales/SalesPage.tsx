import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { CapabilityGate } from '@/features/capabilities/CapabilityGate'
import { DueCustomersSection } from './DueCustomersSection'
import { PerformanceSection } from './PerformanceSection'
import { RepsSection } from './RepsSection'
import { RoutesSection } from './RoutesSection'
import { TerritoriesSection } from './TerritoriesSection'
import { VisitsSection } from './VisitsSection'

/**
 * Fuerza de ventas: quién vende, dónde, cuándo y con qué meta.
 *
 * Cinco pestañas y una sola pantalla porque responden a la misma pregunta en
 * distintos planos: quién vende (vendedores), dónde (territorios), siguiendo qué
 * recorrido (rutas), qué pasó de verdad (visitas) y con qué resultado (metas y
 * comisiones). Repartirlas en cinco entradas de menú obligaría a saltar de
 * módulo para armar una conversación que en la práctica es una sola.
 *
 * **Cada pestaña lleva su propio gate.** `sales.force` abre la ruta; territorios
 * y rutas piden `sales.territory`, y visitas, metas y comisiones piden
 * `sales.performance`. Son addons distintos: se puede tener una fuerza de ventas
 * sin llevar territorios, y llevar territorios sin medir comisiones.
 */
export function SalesPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()

  const items = useMemo(
    () => [
      { id: 'vendedores', label: t('sales.tab.reps'), content: <RepsSection /> },
      // 2026-11-19 · A quién llamar hoy: clientes atrasados según su ritmo.
      { id: 'agenda', label: t('sales.tab.due'), content: <DueCustomersSection /> },
      {
        id: 'territorios',
        label: t('sales.tab.territories'),
        content: (
          <CapabilityGate capability="sales.territory">
            <TerritoriesSection />
          </CapabilityGate>
        ),
      },
      {
        id: 'rutas',
        label: t('sales.tab.routes'),
        content: (
          <CapabilityGate capability="sales.territory">
            <RoutesSection />
          </CapabilityGate>
        ),
      },
      {
        id: 'visitas',
        label: t('sales.tab.visits'),
        content: (
          <CapabilityGate capability="sales.performance">
            <VisitsSection />
          </CapabilityGate>
        ),
      },
      {
        id: 'desempeno',
        label: t('sales.tab.performance'),
        content: (
          <CapabilityGate capability="sales.performance">
            <PerformanceSection />
          </CapabilityGate>
        ),
      },
    ],
    [t],
  )

  // Mientras el espacio de trabajo se resuelve NO se afirma que no hay nada:
  // mismo criterio que el resto del backoffice.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<BadgeRoundedIcon />} title={t('sales.title')} subtitle={t('sales.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<BadgeRoundedIcon />} title={t('sales.title')} subtitle={t('sales.subtitle')} />
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
        ariaLabel={t('sales.title')}
        header={(tabs) => (
          <PageHeader
            icon={<BadgeRoundedIcon />}
            title={t('sales.title')}
            subtitle={activeStore?.name ?? t('sales.subtitle')}
            center={tabs}
          />
        )}
      />
    </>
  )
}
