import HubRoundedIcon from '@mui/icons-material/HubRounded'
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
import { ApiClientsSection } from './ApiClientsSection'
import { HealthSection } from './HealthSection'
import { QueueSection } from './QueueSection'
import { WebhooksSection } from './WebhooksSection'
import { IntegrationsAiSection } from './ai/IntegrationsAiSection'

/**
 * Monitor de Integraciones: salud, cola, webhooks y credenciales de la API.
 *
 * Cuatro caras de la misma pregunta —«¿qué está saliendo de aquí y qué no?»— y
 * por eso van en tabs centrados con deep-link `#hash` (regla de suite §8). El
 * orden es el de un incidente real: se entra por la salud, se baja a la cola, se
 * mira la entrega concreta y, si el problema es de acceso, se revisa la
 * credencial.
 *
 * ## Esta ruta NO está gateada por capacidad, y es deliberado
 *
 * Es la misma decisión que `/app/operations` lleva desde P13. Un tenant que no
 * pudiera ver por qué fallan sus integraciones porque no pagó un addon de
 * observabilidad es un tenant que llama por teléfono. Lo que sí decide quién
 * entra es el ROL —`owner` y `admin`— y lo decide la BASE: la policy de las
 * tablas y la comprobación dentro de `integration_health`.
 *
 * Lo vendible es PUBLICAR: crear credenciales, endpoints y suscripciones exige
 * `integrations.enterprise`, y ese gate vive también en la base (policy y
 * `SIN_MODULO`), no aquí. Por eso las dos pestañas de publicación dicen «no
 * contratado» en vez de fallar: el mensaje se recibe del servidor, así que el
 * comportamiento es el mismo si alguien llama a la función desde fuera de la
 * aplicación.
 */
export function IntegrationsPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  // Fase 10: pestaña de IA solo para los roles de la funcionalidad `integrations`.
  const { availability } = useAiFeature('integrations')
  const conIA = availability !== 'forbidden' && availability !== 'loading'

  const items = useMemo(
    () => [
      { id: 'salud', label: t('integrations.tab.health'), content: <HealthSection /> },
      { id: 'cola', label: t('integrations.tab.queue'), content: <QueueSection /> },
      { id: 'webhooks', label: t('integrations.tab.webhooks'), content: <WebhooksSection /> },
      { id: 'api', label: t('integrations.tab.api'), content: <ApiClientsSection /> },
      ...(conIA ? [{ id: 'analisis-ia', label: t('aiIntegrations.tab'), content: <IntegrationsAiSection /> }] : []),
    ],
    [t, conIA],
  )

  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<HubRoundedIcon />} title={t('integrations.title')} subtitle={t('integrations.subtitle')} />
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<HubRoundedIcon />} title={t('integrations.title')} subtitle={t('integrations.subtitle')} />
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
        icon={<HubRoundedIcon />}
        title={t('integrations.title')}
        subtitle={activeStore?.name ?? t('integrations.subtitle')}
      />
      <SectionTabs items={items} ariaLabel={t('integrations.title')} />
    </>
  )
}
