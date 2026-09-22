import { Button, Stack } from '@mui/material'
import { useMemo, useState } from 'react'
import { ExplainPanel } from '@/features/ai/explain/ExplainPanel'
import { useI18n } from '@/shared/i18n/i18n-context'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { OPS_COMPANY_QUESTIONS, OPS_INCIDENT_QUESTIONS, opsAi } from './opsAi'

/** Panel IA de UN incidente (su hilo incluido). */
export function OpsIncidentAiPanel({ eventId, onNavigate }: { eventId: string; onNavigate?: () => void }) {
  const params = useMemo(() => ({ event_id: eventId }), [eventId])
  return (
    <ExplainPanel
      feature="operations"
      ns="aiOps"
      client={opsAi}
      params={params}
      questions={OPS_INCIDENT_QUESTIONS}
      onNavigate={onNavigate}
    />
  )
}

/**
 * Pestaña «Análisis IA» de Operaciones (fase 10): la salud de la sociedad y
 * los incidentes AGRUPADOS por el sistema. Abrir un grupo lleva al incidente
 * más reciente con su hilo, en un cajón. Nada se resuelve desde aquí.
 */
export function OpsAiSection() {
  const { t } = useI18n()
  const params = useMemo(() => ({}), [])
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null)
  return (
    <Stack spacing={2}>
      <ExplainPanel
        feature="operations"
        ns="aiOps"
        client={opsAi}
        params={params}
        questions={OPS_COMPANY_QUESTIONS}
        onOpenItem={(item) => setOpen({ id: item.id, label: item.label })}
      />
      <FormDrawer
        open={open !== null}
        title={t('aiOps.drawer.title')}
        subtitle={open?.label}
        onClose={() => setOpen(null)}
        width={680}
        actions={<Button onClick={() => setOpen(null)}>{t('common.close')}</Button>}
      >
        {open && <OpsIncidentAiPanel key={open.id} eventId={open.id} onNavigate={() => setOpen(null)} />}
      </FormDrawer>
    </Stack>
  )
}
