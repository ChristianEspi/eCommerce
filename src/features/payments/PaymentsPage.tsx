import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
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
import { IntentsSection } from './IntentsSection'
import { MethodsSection } from './MethodsSection'
import { ReconciliationSection } from './ReconciliationSection'
import { PaymentsAiSection } from './ai/PaymentsAiSection'

/**
 * Pagos: qué se cobró, con qué se cobra y si cuadra.
 *
 * Tres caras de la misma pregunta —«¿dónde está el dinero?»— y por eso van en
 * tabs centrados con deep-link `#hash` (regla de suite §8) y no en tres
 * entradas de menú. El orden no es alfabético: primero los cobros, que es a lo
 * que se entra el 90 % de las veces; la configuración y la conciliación son
 * visitas de otro día.
 *
 * La ruta está gateada por la capacidad `payments`. Sin el módulo contratado,
 * `CapabilityGate` pinta «no está en tu plan» y esta pantalla no se monta: el
 * tenant sigue vendiendo y sus pedidos siguen naciendo con el pago pendiente,
 * que es lo que hacía antes de P09. Se degrada, no se rompe — igual que el
 * inventario multialmacén y el motor de precios.
 */
export function PaymentsPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  // Fase 08: pestaña de IA solo para los roles de la funcionalidad `payments`.
  const { availability } = useAiFeature('payments')
  const conIA = availability !== 'forbidden' && availability !== 'loading'

  const items = useMemo(
    () => [
      { id: 'cobros', label: t('payments.tab.intents'), content: <IntentsSection /> },
      { id: 'medios', label: t('payments.tab.methods'), content: <MethodsSection /> },
      {
        id: 'conciliacion',
        label: t('payments.tab.reconciliation'),
        content: <ReconciliationSection />,
      },
      ...(conIA ? [{ id: 'analisis-ia', label: t('aiPayments.tab'), content: <PaymentsAiSection /> }] : []),
    ],
    [t, conIA],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay tiendas.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<PaymentsRoundedIcon />} title={t('payments.title')} subtitle={t('payments.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<PaymentsRoundedIcon />} title={t('payments.title')} subtitle={t('payments.subtitle')} />
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
        icon={<PaymentsRoundedIcon />}
        title={t('payments.title')}
        subtitle={activeStore?.name ?? t('payments.subtitle')}
      />
      <SectionTabs items={items} ariaLabel={t('payments.title')} />
    </>
  )
}
