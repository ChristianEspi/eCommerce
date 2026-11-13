import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { BehaviorSection } from './BehaviorSection'
import { OverviewSection } from './OverviewSection'
import type { AnalyticsRange } from './types'

/**
 * Analítica: qué se vendió y qué hizo el comprador.
 *
 * Dos caras de la misma pregunta —«¿cómo va la tienda?»— y por eso van en tabs
 * centrados con deep-link `#hash` (regla de suite §8) y no en dos entradas de
 * menú. El orden no es alfabético: primero el dinero, que es a lo que se entra
 * el 90 % de las veces.
 *
 * La ruta está gateada por `analytics.basic`, que es BASELINE: cualquier tenant
 * entra. Lo que se gatea de verdad es la segunda pestaña, y no aquí sino en la
 * base — `ebim.assert_analytics_advanced` levanta `SIN_MODULO` y la pestaña lo
 * reconoce. Un tenant sin el addon ve el resumen completo y una segunda pestaña
 * que le dice qué le falta: se degrada, no se rompe.
 *
 * ## Por qué el rango vive AQUÍ y no en cada pestaña
 *
 * Porque comparar el embudo de 7 días con las ventas de 90 es la forma más
 * barata de sacar una conclusión falsa. El estado es uno y las dos pestañas lo
 * leen.
 */
export function AnalyticsPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  const [days, setDays] = useState<AnalyticsRange>(30)

  const storeId = activeStore?.id ?? null

  const items = useMemo(
    () => [
      {
        id: 'resumen',
        label: t('analytics.tab.overview'),
        content: <OverviewSection storeId={storeId} days={days} onDaysChange={setDays} />,
      },
      {
        id: 'comportamiento',
        label: t('analytics.tab.behavior'),
        content: <BehaviorSection storeId={storeId} days={days} />,
      },
    ],
    [t, storeId, days],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<InsightsRoundedIcon />} title={t('analytics.title')} subtitle={t('analytics.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<InsightsRoundedIcon />} title={t('analytics.title')} subtitle={t('analytics.subtitle')} />
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
        ariaLabel={t('analytics.title')}
        header={(tabs) => (
          <PageHeader
            icon={<InsightsRoundedIcon />}
            title={t('analytics.title')}
            subtitle={activeStore?.name ?? t('analytics.subtitle')}
            center={tabs}
          />
        )}
      />
    </>
  )
}
