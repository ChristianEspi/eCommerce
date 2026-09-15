import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded'
import { Button } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import { ScheduleDialog, type ScheduleFormValues } from '../account/ScheduleDialog'
import { useCommerceContext } from '../commerce/context'
import { newRequestKey } from '../quotes'
import {
  mapScheduleCode,
  myOrderSchedulesKey,
  saveMyOrderSchedule,
  scheduleErrorCode,
} from '../scheduledOrders'
import type { CartLine } from './cart'

/**
 * «Programar este pedido» desde el carrito (cierre, item 4).
 *
 * Solo para quien compra para una EMPRESA en esta tienda, igual que «Solicitar
 * cotización»: sin cuenta B2B no hay programación posible y el botón no se pinta.
 *
 * Guarda QUÉ y CUÁNTO del carrito y CADA CUÁNTO. No vacía el carrito ni crea un
 * pedido: la compra de hoy sigue su curso, y cuando la programación venza el
 * comprador recibirá una propuesta para pasar al carrito.
 *
 * La clave de alta se genera UNA vez por diálogo: un doble clic o un reintento
 * devuelven la misma programación en vez de crear dos.
 */
export function ScheduleCartButton({ storeSlug, lines }: { storeSlug: string; lines: readonly CartLine[] }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { status } = useSessionContext()
  const authenticated = status === 'authenticated'
  const { context } = useCommerceContext(storeSlug, authenticated)
  const [open, setOpen] = useState(false)
  const requestKey = useRef('')

  const save = useMutation({
    mutationFn: (values: ScheduleFormValues) =>
      saveMyOrderSchedule({
        storeSlug,
        templateId: null,
        name: values.name,
        lines: lines.map((line) => ({
          product_id: line.product_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
        })),
        intervalDays: values.intervalDays,
        nextRunOn: values.nextRunOn,
        endsOn: values.endsOn,
        requestKey: requestKey.current,
      }),
    onSuccess: () => {
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: myOrderSchedulesKey(storeSlug) })
      notify(t('store.cart.schedule.done'), 'success')
      navigate(`/s/${storeSlug}/account#programados`)
    },
    onError: (error) => notify(t(mapScheduleCode(scheduleErrorCode(error))), 'error'),
  })

  if (!authenticated || context === null || lines.length === 0) return null

  function abrir() {
    requestKey.current = newRequestKey()
    save.reset()
    setOpen(true)
  }

  return (
    <>
      <Button fullWidth variant="outlined" startIcon={<EventRepeatRoundedIcon />} onClick={abrir}>
        {t('store.cart.schedule.button')}
      </Button>
      {open && (
        <ScheduleDialog
          open
          title={t('store.cart.schedule.title')}
          intro={t('store.cart.schedule.body').replace('{count}', String(lines.length))}
          saving={save.isPending}
          submitLabel={t('store.cart.schedule.submit')}
          onClose={() => setOpen(false)}
          onSubmit={(values) => save.mutate(values)}
        />
      )}
    </>
  )
}
