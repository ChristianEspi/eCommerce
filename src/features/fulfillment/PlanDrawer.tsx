import { zodResolver } from '@hookform/resolvers/zod'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import DrawRoundedIcon from '@mui/icons-material/DrawRounded'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { RowActions, type RowAction } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { PodDrawer } from './PodDrawer'
import { FulfillmentError } from './errors'
import { useFulfillments } from './hooks'
import type { RoutingScope } from './routing-api'
import {
  useAddPlanStop,
  usePlanStops,
  usePods,
  useRemovePlanStop,
  useSavePlan,
  useVehicles,
} from './routing-hooks'
import {
  emptyPlanForm,
  nextStopSequence,
  planFormSchema,
  type Plan,
  type PlanFormValues,
  type PlanStop,
} from './routing-types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * La hoja de ruta: cabecera, paradas y firma de cada entrega.
 *
 * ## Las paradas se toman de la cola, no se inventan
 *
 * Solo se ofrecen despachos **listos para salir** y que no estén ya en otra
 * hoja: `delivery_plan_stops_fulfillment_unique` lo impone, y ofrecerlos aquí
 * haría que el camión saliera dos veces con la misma mercadería.
 *
 * ## La firma es de una sola vez
 *
 * `pod_is_immutable` rechaza cualquier update o delete sobre una prueba de
 * entrega. Por eso una parada ya firmada no vuelve a ofrecer el botón: no es
 * que el segundo intento falle, es que no debería llegar a intentarse.
 */
export function PlanDrawer({
  open,
  plan,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  plan: Plan | null
  scope: RoutingScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [firmando, setFirmando] = useState<{ fulfillmentId: string; stopId: string } | null>(null)

  const vehicles = useVehicles()
  const stops = usePlanStops(plan?.id ?? null)
  const pods = usePods()
  const save = useSavePlan()
  const addStop = useAddPlanStop()
  const removeStop = useRemovePlanStop()

  // La cola real: lo que está listo para salir. `ready` es el estado en el que
  // el almacén ya lo preparó y todavía no salió.
  const queue = useFulfillments({
    storeId: open && plan ? (scope?.storeId ?? null) : null,
    state: 'ready',
    term: '',
  })

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: emptyPlanForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(
      plan
        ? {
            code: plan.code,
            plan_date: plan.plan_date,
            vehicle_id: plan.vehicle_id ?? '',
            driver_name: plan.driver_name ?? '',
          }
        : emptyPlanForm(),
    )
    setFirmando(null)
    setServerError(null)
  }, [open, plan, reset])

  const paradas = useMemo(() => stops.data ?? [], [stops.data])

  /** Los despachos que ya tienen firma: su parada no vuelve a ofrecerla. */
  const firmados = useMemo(
    () => new Set((pods.data ?? []).map((pod) => pod.fulfillment_id)),
    [pods.data],
  )

  const disponibles = useMemo(() => {
    const yaEnRuta = new Set(paradas.map((stop) => stop.fulfillment_id))
    return (queue.data ?? []).filter((row) => !yaEnRuta.has(row.fulfillment_id))
  }, [queue.data, paradas])

  /** Se edita mientras no haya salido: después, la hoja es un documento. */
  const editable = plan === null || plan.status === 'draft'
  const puedeEditar = canWrite && editable

  async function submit(values: PlanFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: plan?.id ?? null, values })
      notify(t('fulfillment.toast.planSaved'), 'success')
      if (!plan) onClose()
    } catch (error) {
      setServerError(error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic')
    }
  }

  async function añadir(fulfillmentId: string) {
    if (!scope || !plan) return
    setServerError(null)
    try {
      await addStop.mutateAsync({
        scope,
        planId: plan.id,
        fulfillmentId,
        sequence: nextStopSequence(paradas),
      })
    } catch (error) {
      setServerError(error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic')
    }
  }

  async function quitar(id: string) {
    setServerError(null)
    try {
      await removeStop.mutateAsync(id)
    } catch (error) {
      setServerError(error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic')
    }
  }

  /**
   * Las acciones de una parada, en un solo sitio.
   *
   * Se arma fuera del JSX porque firmar es condicional: un `.filter(Boolean)`
   * dentro del array dejaría el tipo como `(RowAction | false)[]` y no compila.
   */
  function accionesParada(stop: PlanStop): RowAction[] {
    const acciones: RowAction[] = []

    // Firmada una vez, no se vuelve a ofrecer: la tabla no admite correcciones.
    if (!firmados.has(stop.fulfillment_id)) {
      acciones.push({
        id: 'sign',
        icon: <DrawRoundedIcon fontSize="small" />,
        label: `${t('fulfillment.pod.sign')}: ${stop.sequence}`,
        tone: 'accent',
        disabled: !canWrite,
        onClick: () => setFirmando({ fulfillmentId: stop.fulfillment_id, stopId: stop.id }),
      })
    }

    acciones.push({
      id: 'del',
      icon: <DeleteRoundedIcon fontSize="small" />,
      label: `${t('fulfillment.routing.removeStop')}: ${stop.sequence}`,
      tone: 'danger',
      disabled: !puedeEditar || removeStop.isPending,
      onClick: () => void quitar(stop.id),
    })

    return acciones
  }

  return (
    <FormDrawer
      open={open}
      title={plan ? plan.code : t('fulfillment.routing.new')}
      subtitle={plan?.plan_date}
      onClose={onClose}
      busy={isSubmitting}
      width={720}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {plan ? t('common.close') : t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="plan-form"
            variant="contained"
            disabled={isSubmitting || !puedeEditar}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="plan-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          {plan && !editable && <Alert severity="info">{t('fulfillment.routing.dispatched')}</Alert>}

          <FieldRow>
            {/* Codigo corto a la izquierda y la fecha con su mitad: el input
                nativo de fecha no baja de unos 140 px sin recortarse. */}
            <TextField
              label={t('fulfillment.field.planCode')}
              required
              disabled={!puedeEditar}
              error={Boolean(errors.code)}
              helperText={errors.code ? t(errors.code.message as MessageKey) : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}
              {...register('code')}
            />
            <TextField
              fullWidth
              type="date"
              label={t('fulfillment.field.planDate')}
              disabled={!puedeEditar}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('plan_date')}
            />
          </FieldRow>

          <FieldRow>
            <Controller
              control={control}
              name="vehicle_id"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  label={t('fulfillment.field.vehicle')}
                  disabled={!puedeEditar}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  {(vehicles.data ?? [])
                    .filter((vehicle) => vehicle.is_active)
                    .map((vehicle) => (
                      <MenuItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.plate ? `${vehicle.code} · ${vehicle.plate}` : vehicle.code}
                      </MenuItem>
                    ))}
                </SelectField>
              )}
            />
            <TextField
              fullWidth
              label={t('fulfillment.field.driver')}
              disabled={!puedeEditar}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('driver_name')}
            />
          </FieldRow>

          {plan && (
            <Box>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>
                {t('fulfillment.routing.stops')}
              </Typography>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('fulfillment.field.sequence')}</TableCell>
                    <TableCell>{t('fulfillment.field.fulfillment')}</TableCell>
                    <TableCell>{t('fulfillment.field.pod')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paradas.map((stop) => (
                    <TableRow key={stop.id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{stop.sequence}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {stop.fulfillment_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        {firmados.has(stop.fulfillment_id) ? (
                          <StatusChip tone="success" label={t('fulfillment.pod.signed')} />
                        ) : (
                          <StatusChip tone="default" label={t('fulfillment.pod.unsigned')} />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <RowActions actions={accionesParada(stop)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {puedeEditar && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                    {t('fulfillment.routing.addStop')}
                  </Typography>
                  <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                    {t('fulfillment.routing.addStopHint')}
                  </Typography>

                  {disponibles.length === 0 && (
                    <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                      {t('fulfillment.routing.nothingReady')}
                    </Typography>
                  )}

                  {disponibles.map((row) => (
                    <Stack
                      key={row.fulfillment_id}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 700, fontSize: 13 }}>
                          {row.order_number}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                          {row.contact_name ?? row.method_name}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        disabled={addStop.isPending}
                        onClick={() => void añadir(row.fulfillment_id)}
                      >
                        {t('fulfillment.routing.addToPlan')}
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          )}
        </Stack>
      </Box>

      <PodDrawer
        open={firmando !== null}
        fulfillmentId={firmando?.fulfillmentId ?? null}
        stopId={firmando?.stopId ?? null}
        scope={scope}
        canWrite={canWrite}
        onClose={() => setFirmando(null)}
      />
    </FormDrawer>
  )
}
