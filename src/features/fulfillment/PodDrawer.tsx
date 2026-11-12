import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, MenuItem, Stack, TextField } from '@mui/material'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { FulfillmentError } from './errors'
import type { RoutingScope } from './routing-api'
import { useRecordPod } from './routing-hooks'
import {
  POD_OUTCOMES,
  emptyPodForm,
  podFormSchema,
  type PodFormValues,
} from './routing-types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Firmar una entrega.
 *
 * ## Se avisa de que no hay vuelta atrás
 *
 * `pod_is_immutable` rechaza cualquier update o delete sobre esta tabla. Un
 * formulario que no lo dice deja que alguien firme con un nombre mal escrito
 * pensando que luego lo corrige — y luego no puede. Se corrige con una entrega
 * nueva, no editando la prueba.
 *
 * ## El motivo es obligatorio cuando NO se entregó
 *
 * `proof_of_delivery_reason_when_failed` lo impone. Aquí se comprueba antes
 * para señalar el campo: un rechazo sin motivo es una entrega fallida que nadie
 * puede reclamar ni corregir, y como la fila no se edita, el motivo tiene que
 * entrar bien a la primera.
 */
export function PodDrawer({
  open,
  fulfillmentId,
  stopId,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  fulfillmentId: string | null
  stopId: string | null
  scope: RoutingScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const record = useRecordPod()

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PodFormValues>({
    resolver: zodResolver(podFormSchema),
    defaultValues: emptyPodForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(emptyPodForm())
    setServerError(null)
  }, [open, reset])

  const outcome = watch('outcome')

  async function submit(values: PodFormValues) {
    if (!scope || !fulfillmentId) return
    setServerError(null)
    try {
      await record.mutateAsync({ scope, fulfillmentId, stopId, values })
      notify(t('fulfillment.toast.podRecorded'), 'success')
      onClose()
    } catch (error) {
      setServerError(error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={t('fulfillment.pod.title')}
      subtitle={t('fulfillment.pod.subtitle')}
      onClose={onClose}
      busy={isSubmitting}
      width={520}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="pod-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('fulfillment.pod.sign')}
          </Button>
        </>
      }
    >
      <Box component="form" id="pod-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          {/* No hay vuelta atrás, y se dice ANTES de firmar. */}
          <Alert severity="warning">{t('fulfillment.pod.immutableWarning')}</Alert>

          {/* El resultado va solo y arriba: es la decision de la que dependen
              los demas campos. */}
          <Controller
            control={control}
            name="outcome"
            render={({ field }) => (
              <SelectField
                fullWidth
                label={t('fulfillment.field.outcome')}
                disabled={!canWrite}
                slotProps={{ inputLabel: { shrink: true } }}
                value={field.value}
                onChange={field.onChange}
              >
                {POD_OUTCOMES.map((option) => (
                  <MenuItem key={option} value={option}>
                    {t(`fulfillment.outcome.${option}` as MessageKey)}
                  </MenuItem>
                ))}
              </SelectField>
            )}
          />

          <FieldRow>
            <TextField
              fullWidth
              label={t('fulfillment.field.receivedBy')}
              disabled={!canWrite}
              helperText={t('fulfillment.field.receivedByHint')}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('received_by')}
            />
            {/* Un DNI son ocho digitos: no necesita mas, y asi el nombre de
                quien firma se queda con el ancho que si le hace falta. */}
            <TextField
              label={t('fulfillment.field.documentId')}
              disabled={!canWrite}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
              {...register('document_id')}
            />
          </FieldRow>

          {/* El motivo solo cuando NO se entregó: en una entrega correcta
              sería una casilla que invita a rellenar ruido. */}
          {outcome !== 'delivered' && (
            <TextField
              fullWidth
              multiline
              minRows={2}
              required
              label={t('fulfillment.field.reason')}
              disabled={!canWrite}
              error={Boolean(errors.reason)}
              helperText={
                errors.reason
                  ? t(errors.reason.message as MessageKey)
                  : t('fulfillment.field.reasonHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('reason')}
            />
          )}
        </Stack>
      </Box>
    </FormDrawer>
  )
}
