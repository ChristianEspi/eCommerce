import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, MenuItem, Stack } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { SalesScope } from './api'
import { SalesError } from './errors'
import { useRoutes, useSalesReps, useSaveVisit } from './hooks'
import { emptyVisitForm, visitFormSchema, type VisitFormValues } from './types'
import { SelectField } from '@/shared/ui/SelectField'
import { Field } from '@/shared/ui/Field'

/**
 * Agendar una visita.
 *
 * Solo se AGENDA: la entrada, la salida y el resultado se registran desde la
 * lista, cuando ocurren. Dejar que se creen ya cerradas convertiría la agenda en
 * un formulario de relleno a posteriori, que es exactamente lo que hace inútil
 * medir la cobertura de una fuerza de campo.
 */
export function VisitDrawer({
  open,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  scope: SalesScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  // El cliente elegido se guarda ENTERO, no solo su id: el desplegable tiene
  // que seguir enseñando su nombre aunque la siguiente búsqueda ya no lo traiga.
  const [elegido, setElegido] = useState<PickerOption | null>(null)

  const reps = useSalesReps()
  const routes = useRoutes()
  const save = useSaveVisit()

  const customers = useCustomerOptions({
    term: customerSearch,
    enabled: open,
  })

  const opcionesCliente = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<VisitFormValues>({
    resolver: zodResolver(visitFormSchema),
    defaultValues: emptyVisitForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(emptyVisitForm())
    setCustomerSearch('')
    setElegido(null)
    setServerError(null)
  }, [open, reset])

  async function submit(values: VisitFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, values })
      notify(t('sales.toast.visitSaved'), 'success')
      onClose()
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={t('sales.visits.new')}
      subtitle={t('sales.visits.newHint')}
      onClose={onClose}
      busy={isSubmitting}
      width={560}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="visit-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="visit-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          {/* Vendedor y fecha a mitad y mitad: el input nativo de fecha y hora
              ronda los 200 px y por debajo de media fila se recorta. */}
          <FieldRow>
            <Controller
              control={control}
              name="sales_rep_id"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  required
                  label={t('sales.field.rep')}
                  disabled={!canWrite}
                  error={Boolean(errors.sales_rep_id)}
                  helperText={
                    errors.sales_rep_id ? t(errors.sales_rep_id.message as MessageKey) : undefined
                  }
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {(reps.data ?? [])
                    .filter((rep) => rep.status !== 'disabled')
                    .map((rep) => (
                      <MenuItem key={rep.id} value={rep.id}>
                        {`${rep.employee_code} · ${rep.full_name}`}
                      </MenuItem>
                    ))}
                </SelectField>
              )}
            />
            <Field
              fullWidth
              type="datetime-local"
              label={t('sales.field.plannedAt')}
              required
              disabled={!canWrite}
              error={Boolean(errors.planned_at)}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('planned_at')}
            />
          </FieldRow>

          <Controller
            control={control}
            name="route_id"
            render={({ field }) => (
              <SelectField
                fullWidth
                label={t('sales.field.route')}
                disabled={!canWrite}
                helperText={t('sales.field.routeHint')}
                slotProps={{ inputLabel: { shrink: true } }}
                value={field.value}
                onChange={field.onChange}
              >
                <MenuItem value="">{t('common.none')}</MenuItem>
                {(routes.data ?? []).map((route) => (
                  <MenuItem key={route.id} value={route.id}>
                    {`${route.code} · ${route.name}`}
                  </MenuItem>
                ))}
              </SelectField>
            )}
          />

          <Box>
            {/* El id viaja en un campo oculto: el formulario lo valida como un
                campo más, y el desplegable solo decide cuál se escribe. */}
            <input type="hidden" {...register('customer_id')} />
            <EntityPicker
          minChars={0}
              label={t('sales.field.customerName')}
              term={customerSearch}
              onTermChange={setCustomerSearch}
              options={opcionesCliente}
              loading={customers.isFetching}
              value={elegido}
              onPick={(option) => {
                setElegido(option)
                setValue('customer_id', option.id, { shouldValidate: true })
              }}
              error={Boolean(errors.customer_id)}
              helperText={
                errors.customer_id ? t(errors.customer_id.message as MessageKey) : undefined
              }
            />
          </Box>

          <Field
            fullWidth
            multiline
            minRows={2}
            rule="longText"
            maxLength={500}
            label={t('sales.field.notes')}
            disabled={!canWrite}
            error={Boolean(errors.notes)}
            helperText={errors.notes ? t(errors.notes.message as MessageKey) : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            {...register('notes')}
          />
        </Stack>
      </Box>
    </FormDrawer>
  )
}
