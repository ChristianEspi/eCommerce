import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded'
import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import { ScheduleDialog, type ScheduleFormValues } from '../account/ScheduleDialog'
import { useCommerceContext } from '../commerce/context'
import { newRequestKey } from '../quotes'
import {
  checkMyOrderScheduleLines,
  mapScheduleCode,
  myOrderSchedulesKey,
  saveMyOrderSchedule,
  scheduleErrorCode,
  scheduleReasonKey,
  type ScheduleLine,
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
 * ## Aviso ANTES de programar
 *
 * Al abrir el diálogo se pide la revisión de líneas a la base (la misma regla
 * que el guardado) y se dice qué producto no se podrá programar y por qué —fuera
 * del surtido de la cuenta, despublicado, sin presentación—, antes de pulsar
 * nada. Se programan solo las líneas que pasan; si no pasa ninguna, no se deja
 * enviar. Si la revisión falla por red, no bloquea: el guardado valida igual y
 * su error ya dice el motivo.
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

  const payload: ScheduleLine[] = lines.map((line) => ({
    product_id: line.product_id,
    variant_id: line.variant_id,
    quantity: line.quantity,
  }))

  const review = useQuery({
    queryKey: ['storefront', 'schedule-check', storeSlug, payload],
    queryFn: () => checkMyOrderScheduleLines(storeSlug, payload),
    enabled: open && payload.length > 0,
    staleTime: 0,
    retry: false,
  })

  const rejected = (review.data?.lines ?? []).filter((line) => line.status === 'rejected')
  const acceptedIndexes = new Set(
    (review.data?.lines ?? []).filter((line) => line.status === 'ok').map((line) => line.index),
  )
  // Con revisión: solo las que pasan. Sin ella (cargando o error): todas, y decide la base.
  const toSave = review.data ? payload.filter((_, index) => acceptedIndexes.has(index)) : payload
  const noneValid = Boolean(review.data) && toSave.length === 0

  const save = useMutation({
    mutationFn: (values: ScheduleFormValues) =>
      saveMyOrderSchedule({
        storeSlug,
        templateId: null,
        name: values.name,
        lines: toSave,
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

  const nombreDe = (index: number) => {
    const line = lines[index]
    if (!line) return ''
    return line.variant_name ? `${line.name} · ${line.variant_name}` : line.name
  }

  const notice = review.isFetching ? (
    <Box>
      <Typography variant="body2" sx={{ color: 'var(--muted)', mb: 0.5 }}>
        {t('store.cart.schedule.checking')}
      </Typography>
      <LinearProgress />
    </Box>
  ) : rejected.length > 0 ? (
    <Alert severity={noneValid ? 'error' : 'warning'}>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {noneValid
          ? t('store.cart.schedule.noneValid')
          : t('store.cart.schedule.someRejected')
              .replace('{rejected}', String(rejected.length))
              .replace('{total}', String(lines.length))}
      </Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {rejected.map((line) => (
          <li key={line.index}>
            <Typography variant="body2">
              <strong>{nombreDe(line.index)}</strong> — {t(scheduleReasonKey(line.reason))}
            </Typography>
          </li>
        ))}
      </Box>
      {!noneValid && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {t('store.cart.schedule.onlyValid').replace('{accepted}', String(toSave.length))}
        </Typography>
      )}
    </Alert>
  ) : null

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
          notice={notice}
          submitDisabled={noneValid || review.isFetching}
          saving={save.isPending}
          submitLabel={
            rejected.length > 0 && !noneValid
              ? t('store.cart.schedule.submitSome').replace('{count}', String(toSave.length))
              : t('store.cart.schedule.submit')
          }
          onClose={() => setOpen(false)}
          onSubmit={(values) => save.mutate(values)}
        />
      )}
    </>
  )
}
