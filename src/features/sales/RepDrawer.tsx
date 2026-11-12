import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, MenuItem, Stack, Tab, Tabs, TextField } from '@mui/material'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { SalesScope } from './api'
import { SalesError } from './errors'
import { useSalesReps, useSaveSalesRep } from './hooks'
import { PortfolioPanel } from './PortfolioPanel'
import {
  MEMBER_STATUSES,
  emptyRepForm,
  managerOptions,
  repToForm,
  salesRepFormSchema,
  type SalesRep,
  type SalesRepFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Alta y edición de un vendedor, con su cartera.
 *
 * ## Dos decisiones de pantalla
 *
 * **La cartera solo aparece cuando el vendedor YA existe.** Sin id no hay a qué
 * colgarla, y una pestaña que se puede abrir para no hacer nada es una pestaña
 * que enseña a desconfiar de las demás.
 *
 * **El desplegable de jefe no ofrece lo que la base va a rechazar.** Excluye al
 * propio vendedor y a toda su descendencia: la jerarquía no admite ciclos
 * (`VENDEDOR_CICLO`) y ofrecer una opción que falla al guardar es peor que no
 * ofrecerla. Es la misma decisión que se tomó con el árbol de categorías.
 *
 * El correo se valida contra `@ebim.pe` antes de enviar — la base lo rechaza
 * igual, pero aquí el mensaje explica por qué (contrato §13: un operador de la
 * suite no es actor de negocio de un tenant).
 */
export function RepDrawer({
  open,
  rep,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  rep: SalesRep | null
  scope: SalesScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [tab, setTab] = useState(0)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const save = useSaveSalesRep()
  const reps = useSalesReps()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SalesRepFormValues>({
    resolver: zodResolver(salesRepFormSchema),
    defaultValues: rep ? repToForm(rep) : emptyRepForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(rep ? repToForm(rep) : emptyRepForm())
    setServerError(null)
    setTab(0)
  }, [open, rep, reset])

  const fieldError = (key: keyof SalesRepFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  const jefes = managerOptions(reps.data ?? [], rep?.id ?? null)

  async function submit(values: SalesRepFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: rep?.id ?? null, values })
      notify(t('sales.toast.saved'), 'success')
      if (rep) return
      onClose()
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={rep ? rep.full_name : t('sales.reps.new')}
      subtitle={rep ? rep.employee_code : t('sales.reps.newHint')}
      onClose={onClose}
      busy={isSubmitting}
      width={640}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {rep ? t('common.close') : t('common.cancel')}
          </Button>
          {tab === 0 && (
            <Button
              type="submit"
              form="sales-rep-form"
              variant="contained"
              disabled={isSubmitting || !canWrite}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <Stack spacing={2}>
        {/* La cartera solo cuando ya existe: sin id no hay a qué colgarla. */}
        {rep && (
          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            variant="fullWidth"
            aria-label={t('sales.reps.tabs')}
            sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
          >
            <Tab label={t('catalog.tab.general')} />
            <Tab label={t('sales.tab.portfolio')} />
          </Tabs>
        )}

        {tab === 0 && (
          <Box component="form" id="sales-rep-form" onSubmit={handleSubmit(submit)} noValidate>
            <Stack spacing={2.5}>
              {serverError && <Alert severity="error">{t(serverError)}</Alert>}

              <FieldRow>
                {/* El código es un puñado de caracteres: ancho fijo y sin
                    encoger, para que el nombre se quede con lo que sobra. */}
                <TextField
                  label={t('sales.field.code')}
                  required
                  disabled={!canWrite}
                  error={Boolean(errors.employee_code)}
                  helperText={fieldError('employee_code') ?? t('sales.field.codeHint')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
                  {...register('employee_code')}
                />
                <TextField
                  fullWidth
                  label={t('sales.field.name')}
                  required
                  disabled={!canWrite}
                  error={Boolean(errors.full_name)}
                  helperText={fieldError('full_name')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...register('full_name')}
                />
              </FieldRow>

              <FieldRow>
                <TextField
                  fullWidth
                  type="email"
                  label={t('sales.field.email')}
                  disabled={!canWrite}
                  error={Boolean(errors.email)}
                  helperText={fieldError('email') ?? t('sales.field.emailHint')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...register('email')}
                />
                <TextField
                  fullWidth
                  label={t('sales.field.phone')}
                  disabled={!canWrite}
                  error={Boolean(errors.phone)}
                  helperText={fieldError('phone')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...register('phone')}
                />
              </FieldRow>

              {/* El jefe va solo en su fila: las opciones son «código · nombre
                  completo» y a media fila se cortan justo por el nombre. */}
              <SelectField
                fullWidth
                label={t('sales.field.manager')}
                disabled={!canWrite}
                defaultValue={rep?.manager_id ?? ''}
                helperText={t('sales.field.managerHint')}
                slotProps={{ inputLabel: { shrink: true } }}
                {...register('manager_id')}
              >
                <MenuItem value="">{t('sales.field.noManager')}</MenuItem>
                {jefes.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {`${option.employee_code} · ${option.full_name}`}
                  </MenuItem>
                ))}
              </SelectField>

              {/* Estado y fecha a mitad y mitad: el input nativo de fecha no
                  baja de ~140 px y a un cuarto de fila se recortaba. */}
              <FieldRow>
                <SelectField
                  fullWidth
                  label={t('common.status')}
                  disabled={!canWrite}
                  defaultValue={rep?.status ?? 'active'}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...register('status')}
                >
                  {MEMBER_STATUSES.map((value) => (
                    <MenuItem key={value} value={value}>
                      {t(`sales.status.${value}` as MessageKey)}
                    </MenuItem>
                  ))}
                </SelectField>
                <TextField
                  fullWidth
                  type="date"
                  label={t('sales.field.hiredAt')}
                  disabled={!canWrite}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...register('hired_at')}
                />
              </FieldRow>

              <TextField
                fullWidth
                multiline
                minRows={2}
                label={t('sales.field.notes')}
                disabled={!canWrite}
                error={Boolean(errors.notes)}
                helperText={fieldError('notes')}
                slotProps={{ inputLabel: { shrink: true } }}
                {...register('notes')}
              />
            </Stack>
          </Box>
        )}

        {tab === 1 && rep && (
          <PortfolioPanel repId={rep.id} scope={scope} canWrite={canWrite} />
        )}
      </Stack>
    </FormDrawer>
  )
}
