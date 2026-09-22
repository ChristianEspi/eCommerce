import { Button, Stack } from '@mui/material'
import { useMemo, useState } from 'react'
import { ExplainPanel } from '@/features/ai/explain/ExplainPanel'
import { useI18n } from '@/shared/i18n/i18n-context'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { INTEGRATION_COMPANY_QUESTIONS, INTEGRATION_MESSAGE_QUESTIONS, integrationsAi } from './integrationsAi'

/** Panel IA de UN mensaje de la cola (sus intentos incluidos). */
export function IntegrationMessageAiPanel({ outboxId, onNavigate }: { outboxId: string; onNavigate?: () => void }) {
  const params = useMemo(() => ({ outbox_id: outboxId }), [outboxId])
  return (
    <ExplainPanel
      feature="integrations"
      ns="aiIntegrations"
      client={integrationsAi}
      params={params}
      questions={INTEGRATION_MESSAGE_QUESTIONS}
      onNavigate={onNavigate}
    />
  )
}

/**
 * Pestaña «Análisis IA» de Integraciones (fase 10): proveedores, errores
 * AGRUPADOS por el sistema, disyuntores, webhooks y API. Abrir un grupo lleva
 * al mensaje más reciente con sus intentos, en un cajón. Nada se reintenta ni
 * se modifica desde aquí.
 */
export function IntegrationsAiSection() {
  const { t } = useI18n()
  const params = useMemo(() => ({}), [])
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null)
  return (
    <Stack spacing={2}>
      <ExplainPanel
        feature="integrations"
        ns="aiIntegrations"
        client={integrationsAi}
        params={params}
        questions={INTEGRATION_COMPANY_QUESTIONS}
        onOpenItem={(item) => setOpen({ id: item.id, label: item.label })}
      />
      <FormDrawer
        open={open !== null}
        title={t('aiIntegrations.drawer.title')}
        subtitle={open?.label}
        onClose={() => setOpen(null)}
        width={680}
        actions={<Button onClick={() => setOpen(null)}>{t('common.close')}</Button>}
      >
        {open && <IntegrationMessageAiPanel key={open.id} outboxId={open.id} onNavigate={() => setOpen(null)} />}
      </FormDrawer>
    </Stack>
  )
}
