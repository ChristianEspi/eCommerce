import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo, useState } from 'react'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { AuditSection } from './AuditSection'
import { HealthSection } from './HealthSection'
import { IncidentsSection } from './IncidentsSection'
import { TraceSection } from './TraceSection'
import { OpsAiSection } from './ai/OpsAiSection'

/**
 * Operación: salud, incidentes, rastro y auditoría.
 *
 * Cuatro caras de la misma pregunta —«¿qué está pasando y qué pasó?»— y por eso
 * van en tabs centrados con deep-link `#hash` (regla de suite §8). El orden es
 * el de un incidente real: se entra por la salud, se baja al incidente, se
 * rastrea el hilo y, si hace falta, se mira quién tocó qué.
 *
 * ## Esta ruta NO está gateada por capacidad, y es deliberado
 *
 * Es la misma decisión que Ajustes y Diagnóstico llevan desde P02: un tenant que
 * no pudiera ver por qué fallan sus cobros porque no pagó un addon de
 * observabilidad es un tenant que llama por teléfono. Lo que sí decide quién
 * entra es el ROL —`owner` y `admin`—, y lo decide la base: la policy de
 * `ops_events` y de `audit_log`, y una comprobación dentro de `ops_health`. La
 * pantalla lo reconoce y pinta «no tienes permiso» en vez de un listado vacío,
 * que le haría creer a un `viewer` que su tienda está sana.
 *
 * ## El hilo es estado de la PÁGINA
 *
 * Se levanta aquí y no dentro de la pestaña de rastro porque el camino que la
 * fase describe cruza dos pestañas: se ve un incidente, se pulsa «rastrear» y se
 * salta al hilo ya cargado. Si el estado viviera dentro de la pestaña, ese salto
 * perdería el identificador justo al cambiar de pestaña.
 */
export function OperationsPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  const [correlationId, setCorrelationId] = useState('')
  // Fase 10: pestaña de IA solo para los roles de la funcionalidad `operations`.
  const { availability } = useAiFeature('operations')
  const conIA = availability !== 'forbidden' && availability !== 'loading'

  const storeId = activeStore?.id ?? null

  function traceIncident(id: string): void {
    setCorrelationId(id)
    if (typeof window !== 'undefined') window.location.hash = 'rastro'
  }

  const items = useMemo(
    () => [
      { id: 'salud', label: t('ops.tab.health'), content: <HealthSection storeId={storeId} /> },
      {
        id: 'incidentes',
        label: t('ops.tab.incidents'),
        content: <IncidentsSection onTrace={traceIncident} />,
      },
      {
        id: 'rastro',
        label: t('ops.tab.trace'),
        content: (
          <TraceSection correlationId={correlationId} onCorrelationChange={setCorrelationId} />
        ),
      },
      { id: 'auditoria', label: t('ops.tab.audit'), content: <AuditSection /> },
      ...(conIA ? [{ id: 'analisis-ia', label: t('aiOps.tab'), content: <OpsAiSection /> }] : []),
    ],
    [t, storeId, correlationId, conIA],
  )

  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<HealthAndSafetyRoundedIcon />} title={t('ops.title')} subtitle={t('ops.subtitle')} />
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<HealthAndSafetyRoundedIcon />} title={t('ops.title')} subtitle={t('ops.subtitle')} />
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
      <PageHeader icon={<HealthAndSafetyRoundedIcon />} title={t('ops.title')} subtitle={activeStore?.name ?? t('ops.subtitle')} />
      <SectionTabs items={items} ariaLabel={t('ops.title')} />
    </>
  )
}
