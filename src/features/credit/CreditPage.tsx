import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Card } from '@mui/material'
import { useMemo } from 'react'
import { useAiFeature } from '@/features/ai/hooks'
import { CapabilityGate } from '@/features/capabilities/CapabilityGate'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState } from '@/shared/ui/states'
import { CollectionsSection } from './CollectionsSection'
import { InvoicesSection } from './InvoicesSection'
import { CreditAiSection } from './ai/CreditAiSection'

/**
 * Crédito: lo que se debe y lo que se factura.
 *
 * Dos pestañas y no dos entradas de menú porque son el mismo asunto en dos
 * momentos: la factura crea la deuda y el cobro la cierra. Separarlas obligaría
 * a saltar de módulo para responder «¿esto ya lo pagó?».
 *
 * La ruta va gateada por `credit.management`; la pestaña de comprobantes lleva
 * su propio `CapabilityGate` sobre `invoicing`, porque son dos addons distintos:
 * un distribuidor puede llevar su cobranza sin emitir comprobante electrónico.
 */
export function CreditPage() {
  const { t } = useI18n()
  const { activeStore, activeCompanyId, tenant, status } = useTenant()
  // Fase 08: la pestaña de IA solo existe para los roles de la funcionalidad
  // `credit` (owner/admin). Sin contrato o sin cuota se ve igual (el cálculo
  // del sistema no gasta), con el aviso correspondiente.
  const { availability } = useAiFeature('credit')
  const conIA = availability !== 'forbidden' && availability !== 'loading'

  const items = useMemo(
    () => [
      { id: 'cobranza', label: t('credit.tab.collections'), content: <CollectionsSection /> },
      {
        id: 'comprobantes',
        label: t('credit.tab.invoices'),
        content: (
          <CapabilityGate capability="invoicing">
            <InvoicesSection />
          </CapabilityGate>
        ),
      },
      ...(conIA ? [{ id: 'analisis-ia', label: t('aiCredit.tab'), content: <CreditAiSection /> }] : []),
    ],
    [t, conIA],
  )

  if (status === 'loading') {
    return (
      <>
        <PageHeader
          icon={<AccountBalanceRoundedIcon />}
          title={t('credit.title')}
          subtitle={t('credit.subtitle')}
        />
        <Card>
          <TableSkeleton columns={6} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        <PageHeader
          icon={<AccountBalanceRoundedIcon />}
          title={t('credit.title')}
          subtitle={t('credit.subtitle')}
        />
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
        icon={<AccountBalanceRoundedIcon />}
        title={t('credit.title')}
        subtitle={activeStore?.name ?? t('credit.subtitle')}
      />
      <SectionTabs items={items} ariaLabel={t('credit.title')} />
    </>
  )
}
