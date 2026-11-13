import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { CapabilityGate } from '@/features/capabilities/CapabilityGate'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { BusinessAccountsSection } from './BusinessAccountsSection'
import { CustomersSection } from './CustomersSection'

/**
 * Clientes: la ficha comercial y, encima de ella, la cuenta B2B.
 *
 * Dos pestañas y no dos entradas de menú porque son el mismo asunto visto a
 * dos distancias: la cuenta de empresa no existe sin su cliente, y buscar
 * «Acme» tiene que llevar al mismo sitio se pregunte por la ficha o por su
 * portal.
 *
 * **La ruta NO está gateada.** La ficha de cliente es baseline: hasta un tenant
 * sin nada contratado necesita saber a quién le vendió para atender una
 * devolución. Lo que sí está gateado es la pestaña de cuentas B2B, con
 * `CapabilityGate` sobre `customers.b2b` — y quien entre sin el módulo lee qué
 * le falta en vez de una tabla vacía que parece un fallo.
 */
export function CustomersPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()

  const items = useMemo(
    () => [
      { id: 'clientes', label: t('customers.tab.customers'), content: <CustomersSection /> },
      {
        id: 'cuentas',
        label: t('customers.tab.accounts'),
        content: (
          <CapabilityGate capability="customers.b2b">
            <BusinessAccountsSection />
          </CapabilityGate>
        ),
      },
    ],
    [t],
  )

  // Mismo criterio que el resto del backoffice: mientras el espacio de trabajo
  // se resuelve NO se afirma que no hay nada.
  if (status === 'loading') {
    return (
      <>
        <PageHeader icon={<PeopleAltRoundedIcon />} title={t('customers.title')} subtitle={t('customers.subtitle')} />
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader icon={<PeopleAltRoundedIcon />} title={t('customers.title')} subtitle={t('customers.subtitle')} />
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
        ariaLabel={t('customers.title')}
        header={(tabs) => (
          <PageHeader
            icon={<PeopleAltRoundedIcon />}
            title={t('customers.title')}
            subtitle={activeStore?.name ?? t('customers.subtitle')}
            center={tabs}
          />
        )}
      />
    </>
  )
}
