import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { SalesScope } from './api'
import { SalesError } from './errors'
import { useSaveTerritory } from './hooks'
import {
  emptyTerritoryForm,
  parentTerritoryOptions,
  territoryFormSchema,
  type Territory,
  type TerritoryFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Alta y edición de un territorio.
 *
 * El desplegable de padre no ofrece al propio territorio ni a su descendencia:
 * la base rechaza el ciclo con `TERRITORIO_CICLO` y una opción que falla al
 * guardar es un desplegable que miente. Misma decisión que con la jefatura de
 * vendedores y con el árbol de categorías.
 */
export function TerritoryDrawer({
  open,
  territory,
  territories,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  territory: Territory | null
  territories: readonly Territory[]
  scope: SalesScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const save = useSaveTerritory()

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TerritoryFormValues>({
    resolver: zodResolver(territoryFormSchema),
    defaultValues: emptyTerritoryForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(
      territory
        ? {
            code: territory.code,
            name: territory.name,
            parent_id: territory.parent_id ?? '',
            is_active: territory.is_active,
          }
        : emptyTerritoryForm(),
    )
    setServerError(null)
  }, [open, territory, reset])

  const padres = parentTerritoryOptions(territories, territory?.id ?? null)

  async function submit(values: TerritoryFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: territory?.id ?? null, values })
      notify(t('sales.toast.territorySaved'), 'success')
      onClose()
    } catch (error) {
      setServerError(error instanceof SalesError ? error.key : 'sales.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={territory ? territory.name : t('sales.territories.new')}
      subtitle={territory?.code}
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
            form="territory-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="territory-form" onSubmit={handleSubmit(submit)} noValidate>
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

          <Controller
            control={control}
            name="parent_id"
            render={({ field }) => (
              <SelectField
                fullWidth
                label={t('sales.field.parent')}
                disabled={!canWrite}
                helperText={t('sales.field.parentHint')}
                slotProps={{ inputLabel: { shrink: true } }}
                value={field.value}
                onChange={field.onChange}
              >
                <MenuItem value="">{t('sales.field.noParent')}</MenuItem>
                {padres.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {`${option.code} · ${option.name}`}
                  </MenuItem>
                ))}
              </SelectField>
            )}
          />

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
        </Stack>
      </Box>
    </FormDrawer>
  )
}
