import { Button } from '@mui/material'
import { useMemo, useState } from 'react'
import { ExplainPanel } from '@/features/ai/explain/ExplainPanel'
import { useI18n } from '@/shared/i18n/i18n-context'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { CREDIT_CUSTOMER_QUESTIONS, CREDIT_PORTFOLIO_QUESTIONS, creditAi } from './creditAi'

/**
 * Cobranza con IA de UN cliente (fase 08): cálculo del sistema (deuda, tramos,
 * documentos, cobros), interpretación IA con acciones de seguimiento y el
 * BORRADOR de recordatorio (editable, se copia; nunca se envía).
 *
 * Quien lo monta le pone `key={customerId}`: otro cliente = estado limpio.
 */
export function CreditCustomerAiDrawer({
  customerId,
  customerName,
  onClose,
}: {
  customerId: string | null
  customerName: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const params = useMemo(() => ({ customer_id: customerId }), [customerId])
  return (
    <FormDrawer
      open={customerId !== null}
      title={t('aiCredit.drawer.title')}
      subtitle={customerName ?? undefined}
      onClose={onClose}
      width={680}
      actions={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {customerId && (
        <ExplainPanel
          feature="credit"
          ns="aiCredit"
          client={creditAi}
          params={params}
          questions={CREDIT_CUSTOMER_QUESTIONS}
          draft={{ mode: 'reminder', actionKind: 'prepare_reminder' }}
          onNavigate={onClose}
        />
      )}
    </FormDrawer>
  )
}

/**
 * Pestaña «Análisis IA» de Crédito (fase 08): la cartera de la sociedad.
 * Cada cliente con mora se abre en su cajón de cobranza con IA.
 */
export function CreditAiSection() {
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null)
  const params = useMemo(() => ({}), [])
  return (
    <>
      <ExplainPanel
        feature="credit"
        ns="aiCredit"
        client={creditAi}
        params={params}
        questions={CREDIT_PORTFOLIO_QUESTIONS}
        onOpenItem={(item) => setOpen({ id: item.id, name: item.label })}
      />
      <CreditCustomerAiDrawer
        key={open?.id ?? 'none'}
        customerId={open?.id ?? null}
        customerName={open?.name ?? null}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
