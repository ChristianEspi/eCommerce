import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { SalesScope } from './api'
import { SalesError } from './errors'
import { useSalesReps, useSaveGoal, useTerritories } from './hooks'
import {
  GOAL_METRICS,
  emptyGoalForm,
  goalFormSchema,
  type Goal,
  type GoalFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Alta y edición de una meta.
 *
 * ## De uno, y solo de uno
 *
 * `sales_goals_one_owner` obliga a que la meta sea de un vendedor **o** de un
 * territorio, nunca de los dos ni de ninguno: sin dueño, «vendiste 1.200» no
 * tiene a quién atribuirse; con dos, se atribuye dos veces. El formulario lo
 * comprueba antes de enviar para poder señalar el campo — la base solo puede
 * decir que la fila entera no vale.
 *
 * ## La moneda aparece cuando hace falta y desaparece cuando no
 *
 * Una meta en importe sin moneda es una cifra incomparable; una meta en cajas
 * con moneda es ruido que `sales_goals_currency_when_amount` rechaza.
 */
export function GoalDrawer({
  open,
  goal,
  scope,
  currency,
  canWrite,
  onClose,
}: {
  open: boolean
  goal: Goal | null
  scope: SalesScope | null
  currency: string
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const reps = useSalesReps()
  const territories = useTerritories()
  const save = useSaveGoal()

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: emptyGoalForm(currency),
  })

  useEffect(() => {
    if (!open) return
    reset(
      goal
        ? {
            sales_rep_id: goal.sales_rep_id ?? '',
            territory_id: goal.territory_id ?? '',
            metric: goal.metric,
            currency: goal.currency ?? currency,
            period_start: goal.period_start,
            period_end: goal.period_end,
            target_value: goal.target_value,
          }
        : emptyGoalForm(currency),
    )
    setServerError(null)
  }, [open, goal, currency, reset])

  const metric = watch('metric')
  const repId = watch('sales_rep_id')
  const territoryId = watch('territory_id')

  async function submit(values: GoalFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: goal?.id ?? null, values })
      notify(t('sales.toast.goalSaved'), 'success')
      onClose()
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={goal ? t('sales.goals.edit') : t('sales.goals.new')}
      subtitle={t('sales.goals.newHint')}
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
            form="goal-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="goal-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
            {t('sales.goals.ownerHint')}
          </Typography>

          <FieldRow>
            <Controller
              control={control}
              name="sales_rep_id"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  label={t('sales.field.rep')}
                  // Elegir uno apaga el otro: la base rechaza los dos llenos,
                  // y apagarlo lo dice antes de intentarlo.
                  disabled={!canWrite || territoryId !== ''}
                  error={Boolean(errors.sales_rep_id)}
                  helperText={
                    errors.sales_rep_id ? t(errors.sales_rep_id.message as MessageKey) : undefined
                  }
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  {(reps.data ?? []).map((rep) => (
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
                  disabled={!canWrite || repId !== ''}
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
              name="metric"
              render={({ field }) => (
                <SelectField
                  fullWidth
                  label={t('sales.field.metric')}
                  disabled={!canWrite}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {GOAL_METRICS.map((option) => (
                    <MenuItem key={option} value={option}>
                      {t(`sales.metric.${option}` as MessageKey)}
                    </MenuItem>
                  ))}
                </SelectField>
              )}
            />

            {/* La moneda solo cuando la métrica es importe. Va a ancho fijo:
                son tres letras, y así métrica y objetivo se reparten solos lo
                que sobra tanto si aparece como si no. */}
            {metric === 'amount' && (
              <TextField
                label={t('sales.field.currency')}
                disabled={!canWrite}
                error={Boolean(errors.currency)}
                helperText={errors.currency ? t(errors.currency.message as MessageKey) : undefined}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: { xs: '100%', sm: 140 }, flexShrink: 0 }}
                {...register('currency')}
              />
            )}

            <TextField
              fullWidth
              label={t('sales.field.target')}
              required
              disabled={!canWrite}
              error={Boolean(errors.target_value)}
              helperText={
                errors.target_value
                  ? t(errors.target_value.message as MessageKey)
                  : t('sales.field.targetHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('target_value')}
            />
          </FieldRow>

          {/* Las dos fechas a mitad y mitad: el input nativo de fecha no baja
              de ~140 px y a menos de media fila se recortaba. */}
          <FieldRow>
            <TextField
              fullWidth
              type="date"
              label={t('sales.field.periodStart')}
              disabled={!canWrite}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('period_start')}
            />
            <TextField
              fullWidth
              type="date"
              label={t('sales.field.periodEnd')}
              disabled={!canWrite}
              error={Boolean(errors.period_end)}
              helperText={
                errors.period_end ? t(errors.period_end.message as MessageKey) : undefined
              }
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('period_end')}
            />
          </FieldRow>
        </Stack>
      </Box>
    </FormDrawer>
  )
}
