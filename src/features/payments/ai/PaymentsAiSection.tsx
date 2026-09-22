import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import { Button, Stack } from '@mui/material'
import { useMemo, useState } from 'react'
import { ExplainPanel } from '@/features/ai/explain/ExplainPanel'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { PAYMENT_INTENT_QUESTIONS, PAYMENT_NOTE_TOKENS, PAYMENT_STORE_QUESTIONS, paymentsAi } from './paymentsAi'

function useNoteLabel() {
  const { t } = useI18n()
  return (note: string) =>
    (PAYMENT_NOTE_TOKENS as readonly string[]).includes(note) ? t(`aiPayments.note.${note}` as MessageKey) : note
}

/** Panel IA de UN cobro (para el detalle del cobro y el cajón de la pestaña). */
export function PaymentIntentAiPanel({
  storeId,
  intentId,
  onNavigate,
}: {
  storeId: string
  intentId: string
  onNavigate?: () => void
}) {
  const params = useMemo(() => ({ store_id: storeId, intent_id: intentId }), [storeId, intentId])
  const noteLabel = useNoteLabel()
  return (
    <ExplainPanel
      feature="payments"
      ns="aiPayments"
      client={paymentsAi}
      params={params}
      questions={PAYMENT_INTENT_QUESTIONS}
      onNavigate={onNavigate}
      noteLabel={noteLabel}
    />
  )
}

/**
 * Sección plegada «Explicar con IA» dentro del detalle de un cobro. No pide
 * nada hasta que la persona la abre; solo para los roles de `payments`.
 */
export function PaymentIntentAiToggle({
  storeId,
  intentId,
  onNavigate,
}: {
  storeId: string | null
  intentId: string
  onNavigate?: () => void
}) {
  const { t } = useI18n()
  const { availability } = useAiFeature('payments')
  const [open, setOpen] = useState(false)
  if (!storeId || availability === 'forbidden' || availability === 'loading') return null
  if (!open) {
    return (
      <Button variant="outlined" startIcon={<AutoAwesomeRoundedIcon />} onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
        {t('aiPayments.rowAction')}
      </Button>
    )
  }
  return <PaymentIntentAiPanel storeId={storeId} intentId={intentId} onNavigate={onNavigate} />
}

/**
 * Pestaña «Análisis IA» de Pagos (fase 08): la tienda activa. Un cobro se abre
 * en su cajón de IA; una liquidación lleva a la pestaña de conciliación.
 */
export function PaymentsAiSection() {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const storeId = activeStore?.id ?? null
  const params = useMemo(() => ({ store_id: storeId }), [storeId])
  const noteLabel = useNoteLabel()
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null)
  if (!storeId) return null
  return (
    <Stack spacing={2}>
      <ExplainPanel
        feature="payments"
        ns="aiPayments"
        client={paymentsAi}
        params={params}
        questions={PAYMENT_STORE_QUESTIONS}
        noteLabel={noteLabel}
        onOpenItem={(item) => {
          if (item.ref.startsWith('I')) setOpen({ id: item.id, label: item.label })
          else window.location.hash = 'conciliacion'
        }}
      />
      <FormDrawer
        open={open !== null}
        title={t('aiPayments.drawer.title')}
        subtitle={open?.label}
        onClose={() => setOpen(null)}
        width={680}
        actions={<Button onClick={() => setOpen(null)}>{t('common.close')}</Button>}
      >
        {open && <PaymentIntentAiPanel key={open.id} storeId={storeId} intentId={open.id} onNavigate={() => setOpen(null)} />}
      </FormDrawer>
    </Stack>
  )
}
