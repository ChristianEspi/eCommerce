import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { CapabilityGate } from '@/features/capabilities/CapabilityGate'
import { NetworkSection } from './NetworkSection'
import { QueueSection } from './QueueSection'
import { ReturnsSection } from './ReturnsSection'
import { RoutingSection } from './RoutingSection'
import { FulfillmentAiSection } from './ai/FulfillmentAiSection'

/**
 * Entregas: qué hay que despachar, qué vuelve y cómo se llega.
 *
 * Tres caras de la misma pregunta —«¿dónde está la mercancía?»— y por eso van
 * en tabs centrados con deep-link `#hash` (regla de suite §8) y no en tres
 * entradas de menú. El orden no es alfabético: primero la cola de preparación,
 * que es a lo que se entra el 90 % de las veces; las devoluciones son de otro
 * día y la configuración de otro mes.
 *
 * La ruta está gateada por la capacidad `fulfillment`. Sin el módulo
 * contratado, `CapabilityGate` pinta «no está en tu plan» y esta pantalla no se
 * monta: el tenant sigue vendiendo, sus pedidos siguen naciendo con transporte
 * cero y el backoffice los sigue moviendo por `orders.status`, que es lo que
 * hacía antes de P12. Se degrada, no se rompe — igual que el inventario
 * multialmacén, el motor de precios y las promociones.
 */
export function FulfillmentPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  // Fase 08: pestaña de IA solo para los roles de la funcionalidad `fulfillment`.
  const { availability } = useAiFeature('fulfillment')
  const conIA = availability !== 'forbidden' && availability !== 'loading'

  const items = useMemo(
    () => [
      { id: 'entregas', label: t('fulfillment.tab.queue'), content: <QueueSection /> },
      { id: 'devoluciones', label: t('fulfillment.tab.returns'), content: <ReturnsSection /> },
      // Reparto PROPIO: la flota del distribuidor, no la del transportista. Va
      // gateado por `fulfillment.routing`, que es un addon aparte: un comercio
      // que despacha por courier no necesita hojas de ruta ni firma en puerta.
      {
        id: 'reparto',
        label: t('fulfillment.tab.routing'),
        content: (
          <CapabilityGate capability="fulfillment.routing">
            <RoutingSection />
          </CapabilityGate>
        ),
      },
      { id: 'red', label: t('fulfillment.tab.network'), content: <NetworkSection /> },
      ...(conIA ? [{ id: 'analisis-ia', label: t('aiFulfillment.tab'), content: <FulfillmentAiSection /> }] : []),
    ],
    [t, conIA],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<LocalShippingRoundedIcon />} title={t('fulfillment.title')} subtitle={t('fulfillment.subtitle')} />
        <Card>
          <TableSkeleton columns={6} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<LocalShippingRoundedIcon />} title={t('fulfillment.title')} subtitle={t('fulfillment.subtitle')} />
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
      <PageHeader
        icon={<LocalShippingRoundedIcon />}
        title={t('fulfillment.title')}
        subtitle={activeStore?.name ?? t('fulfillment.subtitle')}
      />
      <SectionTabs items={items} ariaLabel={t('fulfillment.title')} />
    </>
  )
}
