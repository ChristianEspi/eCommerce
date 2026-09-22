import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import { Button, Stack } from '@mui/material'
import { useMemo, useState } from 'react'
import { ExplainPanel } from '@/features/ai/explain/ExplainPanel'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { FULFILLMENT_ITEM_QUESTIONS, FULFILLMENT_STORE_QUESTIONS, fulfillmentAi } from './fulfillmentAi'

/**
 * Panel IA de UNA entrega: cálculo del sistema, interpretación con acciones y
 * el BORRADOR de mensaje al cliente (editable, se copia; nunca se envía).
 */
export function FulfillmentAiPanel({
  storeId,
  fulfillmentId,
  onNavigate,
}: {
  storeId: string
  fulfillmentId: string
  onNavigate?: () => void
}) {
  const params = useMemo(() => ({ store_id: storeId, fulfillment_id: fulfillmentId }), [storeId, fulfillmentId])
  return (
    <ExplainPanel
      feature="fulfillment"
      ns="aiFulfillment"
      client={fulfillmentAi}
      params={params}
      questions={FULFILLMENT_ITEM_QUESTIONS}
      draft={{ mode: 'message', actionKind: 'prepare_customer_message' }}
      onNavigate={onNavigate}
    />
  )
}

/**
 * Sección plegada «Analizar con IA» dentro del detalle de una entrega. No
 * pide nada hasta que la persona la abre; solo para los roles de `fulfillment`.
 */
export function FulfillmentAiToggle({
  storeId,
  fulfillmentId,
  onNavigate,
}: {
  storeId: string | null
  fulfillmentId: string
  onNavigate?: () => void
}) {
  const { t } = useI18n()
  const { availability } = useAiFeature('fulfillment')
  const [open, setOpen] = useState(false)
  if (!storeId || availability === 'forbidden' || availability === 'loading') return null
  if (!open) {
    return (
      <Button variant="outlined" startIcon={<AutoAwesomeRoundedIcon />} onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
        {t('aiFulfillment.rowAction')}
      </Button>
    )
  }
  return <FulfillmentAiPanel storeId={storeId} fulfillmentId={fulfillmentId} onNavigate={onNavigate} />
}

/**
 * Pestaña «Análisis IA» de Fulfillment (fase 08): la tienda activa. Cada
 * entrega con señales se abre en su cajón de IA.
 */
export function FulfillmentAiSection() {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const storeId = activeStore?.id ?? null
  const params = useMemo(() => ({ store_id: storeId }), [storeId])
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null)
  if (!storeId) return null
  return (
    <Stack spacing={2}>
      <ExplainPanel
        feature="fulfillment"
        ns="aiFulfillment"
        client={fulfillmentAi}
        params={params}
        questions={FULFILLMENT_STORE_QUESTIONS}
        onOpenItem={(item) => setOpen({ id: item.id, label: item.label })}
      />
      <FormDrawer
        open={open !== null}
        title={t('aiFulfillment.drawer.title')}
        subtitle={open?.label}
        onClose={() => setOpen(null)}
        width={680}
        actions={<Button onClick={() => setOpen(null)}>{t('common.close')}</Button>}
      >
        {open && <FulfillmentAiPanel key={open.id} storeId={storeId} fulfillmentId={open.id} onNavigate={() => setOpen(null)} />}
      </FormDrawer>
    </Stack>
  )
}
