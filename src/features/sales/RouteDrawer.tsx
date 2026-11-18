import { zodResolver } from '@hookform/resolvers/zod'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
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
import { useCustomerOptions } from '@/features/customers/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { RowActions } from '@/shared/ui/RowActions'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { SalesScope } from './api'
import { SalesError } from './errors'
import {
  useAddRouteStop,
  useRemoveRouteStop,
  useRouteStops,
  useSalesReps,
  useSaveRoute,
  useTerritories,
} from './hooks'
import {
  WEEKDAYS,
  emptyRouteForm,
  nextSequence,
  routeFormSchema,
  type Route,
  type RouteFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * La ruta: cabecera y paradas en orden.
 *
 * ## El orden lo propone la pantalla
 *
 * `sales_route_stops_sequence_unique` impide dos paradas con el mismo número.
 * La pantalla propone el primer hueco libre en vez de dejar que quien está
 * delante lo adivine: un alta normal que revienta contra un único no es un
 * error que nadie pueda explicar sin leer el esquema.
 *
 * ## El vendedor es obligatorio y el territorio no
 *
 * Una ruta sin dueño no la recorre nadie. El territorio es opcional a propósito:
 * hay rutas que cruzan zonas, y forzarlo obligaría a inventarse un territorio
 * para poder guardarlas.
 */
export function RouteDrawer({
  open,
  route,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  route: Route | null
  scope: SalesScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')

  const reps = useSalesReps()
  const territories = useTerritories()
  const stops = useRouteStops(route?.id ?? null)
  const save = useSaveRoute()
  const addStop = useAddRouteStop()
  const removeStop = useRemoveRouteStop()

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
    formState: { errors, isSubmitting },
  } = useForm<RouteFormValues>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: emptyRouteForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(
      route
        ? {
            code: route.code,
            name: route.name,
            sales_rep_id: route.sales_rep_id,
            territory_id: route.territory_id ?? '',
            weekday: String(route.weekday),
            frequency_weeks: String(route.frequency_weeks),
            is_active: route.is_active,
          }
        : emptyRouteForm(),
    )
    setCustomerSearch('')
    setServerError(null)
  }, [open, route, reset])

  const paradas = stops.data ?? []
  const yaEstan = new Set(paradas.map((stop) => stop.customer_id))

  async function submit(values: RouteFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: route?.id ?? null, values })
      notify(t('sales.toast.routeSaved'), 'success')
      if (!route) onClose()
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  async function añadirParada(customerId: string) {
    if (!scope || !route) return
    setServerError(null)
    try {
      await addStop.mutateAsync({
        scope,
        routeId: route.id,
        customerId,
        sequence: nextSequence(paradas),
      })
      setCustomerSearch('')
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  async function quitarParada(id: string) {
    setServerError(null)
    try {
      await removeStop.mutateAsync(id)
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={route ? route.name : t('sales.routes.new')}
      subtitle={route?.code}
      onClose={onClose}
      busy={isSubmitting}
      width={640}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {route ? t('common.close') : t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="route-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="route-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <FieldRow>
            {/* El código son unas pocas letras: ancho fijo y sin encoger, para
                que el nombre se quede con el resto de la fila. */}
            <TextField
              label={t('sales.field.code')}
              required
              disabled={!canWrite}
              error={Boolean(errors.code)}
              helperText={
                errors.code ? t(errors.code.message as MessageKey) : t('sales.field.codeHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
              {...register('code')}
            />
            <TextField
              fullWidth
              label={t('sales.field.name')}
              required
              disabled={!canWrite}
              error={Boolean(errors.name)}
              helperText={errors.name ? t(errors.name.message as MessageKey) : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('name')}
            />
          </FieldRow>

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
                    errors.sales_rep_id
                      ? t(errors.sales_rep_id.message as MessageKey)
                      : t('sales.field.repHint')
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
            <Controller
              control={control}
              name="territory_id"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  label={t('sales.field.territory')}
                  disabled={!canWrite}
                  helperText={t('sales.field.territoryHint')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  {(territories.data ?? []).map((territory) => (
                    <MenuItem key={territory.id} value={territory.id}>
                      {`${territory.code} · ${territory.name}`}
                    </MenuItem>
                  ))}
                </SelectField>
              )}
            />
          </FieldRow>

          <FieldRow>
            <Controller
              control={control}
              name="weekday"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  label={t('sales.field.weekday')}
                  disabled={!canWrite}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {WEEKDAYS.map((day) => (
                    <MenuItem key={day} value={String(day)}>
                      {t(`sales.weekday.${day}` as MessageKey)}
                    </MenuItem>
                  ))}
                </SelectField>
              )}
            />
            <Controller
              control={control}
              name="frequency_weeks"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  label={t('sales.field.frequency')}
                  disabled={!canWrite}
                  helperText={t('sales.field.frequencyHint')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {[1, 2, 3, 4].map((weeks) => (
                    <MenuItem key={weeks} value={String(weeks)}>
                      {weeks === 1
                        ? t('sales.frequency.weekly')
                        : t('sales.frequency.every').replace('{n}', String(weeks))}
                    </MenuItem>
                  ))}
                </SelectField>
              )}
            />
          </FieldRow>

          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    disabled={!canWrite}
                    onChange={(event) => field.onChange(event.target.checked)}
                  />
                }
                label={t('sales.field.isActive')}
              />
            )}
          />

          {/* Las paradas solo cuando la ruta ya existe: sin id no hay a qué
              colgarlas. */}
          {route && (
            <Box>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>{t('sales.routes.stops')}</Typography>
              <Typography sx={{ color: 'var(--muted)', fontSize: 13, mb: 1 }}>
                {t('sales.routes.stopsHint')}
              </Typography>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('sales.field.sequence')}</TableCell>
                    <TableCell>{t('sales.field.customerName')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paradas.map((stop) => (
                    <TableRow key={stop.id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{stop.sequence}</TableCell>
                      <TableCell>
                        <Box>
                          <Typography sx={{ fontSize: 13 }}>{stop.customer_name ?? '—'}</Typography>
                          <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                            {stop.customer_code ?? ''}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <RowActions
                          actions={[
                            {
                              id: 'del',
                              icon: <DeleteRoundedIcon fontSize="small" />,
                              label: `${t('sales.routes.removeStop')}: ${stop.customer_name ?? ''}`,
                              tone: 'danger',
                              disabled: !canWrite || removeStop.isPending,
                              onClick: () => void quitarParada(stop.id),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {canWrite && (
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <EntityPicker
          minChars={0}
                    label={t('sales.field.customerName')}
                    placeholder={t('sales.routes.searchCustomer')}
                    term={customerSearch}
                    onTermChange={setCustomerSearch}
                    options={opcionesCliente}
                    loading={customers.isFetching}
                    alreadyIn={yaEstan}
                    clearOnPick
                    onPick={(option) => void añadirParada(option.id)}
                  />
                </Stack>
              )}
            </Box>
          )}
        </Stack>
      </Box>
    </FormDrawer>
  )
}
