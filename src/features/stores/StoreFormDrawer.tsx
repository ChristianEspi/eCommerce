import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useCurrencies } from '@/shared/lib/currencies'
import { slugify } from '@/shared/lib/slug'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { StoreAdminError } from './errors'
import { useCreateStore, useUpdateStore } from './hooks'
import {
  emptyStoreForm,
  storeFormSchema,
  storeToForm,
  type ManagedStore,
  type StoreFormValues,
} from './types'

/**
 * Alta y edición de una tienda.
 *
 * ## Lo que no se pregunta
 *
 * Ni la organización ni la sociedad: la tienda nace en la sociedad ACTIVA de la
 * sesión, que se ve arriba del formulario. Tampoco el estado: nace en borrador y
 * se activa desde el listado, con una acción explícita.
 *
 * ## El slug se propone, no se impone
 *
 * Al escribir el nombre de una tienda NUEVA se sugiere la dirección. En cuanto
 * alguien toca el campo, deja de seguir al nombre: pisar lo que la persona
 * escribió sería peor que no sugerir nada. Al editar no se sugiere: cambiar la
 * dirección de una tienda publicada cambia sus enlaces.
 *
 * ## El dominio propio solo con marca blanca
 *
 * Es un addon (`content.white_label`) y la base lo exige. Sin él, el campo no se
 * pinta: un campo que siempre falla al guardar es un formulario que miente.
 */
export function StoreFormDrawer({
  open,
  store,
  companyLabel,
  domainEnabled,
  onClose,
  onCreated,
}: {
  open: boolean
  store: ManagedStore | null
  companyLabel: string
  domainEnabled: boolean
  onClose: () => void
  onCreated?: (store: ManagedStore) => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const currencies = useCurrencies()
  const create = useCreateStore()
  const update = useUpdateStore()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const slugTouched = useRef(false)

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: emptyStoreForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(store ? storeToForm(store) : emptyStoreForm())
    slugTouched.current = Boolean(store)
    setServerError(null)
  }, [open, store, reset])

  const nameField = register('name')
  const slugField = register('slug')

  function onNameChange(event: ChangeEvent<HTMLInputElement>) {
    void nameField.onChange(event)
    if (!store && !slugTouched.current) {
      setValue('slug', slugify(event.target.value).slice(0, 62), { shouldValidate: false })
    }
  }

  async function submit(values: StoreFormValues) {
    setServerError(null)
    try {
      if (store) {
        await update.mutateAsync({ store, values: domainEnabled ? values : { ...values, domain: store.domain ?? '' } })
        notify(t('storesAdmin.toast.saved'), 'success')
      } else {
        const created = await create.mutateAsync(domainEnabled ? values : { ...values, domain: '' })
        notify(t('storesAdmin.toast.created'), 'success')
        onCreated?.(created)
      }
      onClose()
    } catch (error) {
      setServerError(error instanceof StoreAdminError ? error.key : 'storesAdmin.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={store ? store.name : t('storesAdmin.new')}
      subtitle={store ? `/s/${store.slug}` : companyLabel}
      onClose={onClose}
      busy={isSubmitting}
      width={560}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="store-form" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? t('common.saving') : store ? t('common.save') : t('storesAdmin.create')}
          </Button>
        </>
      }
    >
      <Box component="form" id="store-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}
          {!store && <Alert severity="info">{t('storesAdmin.draftNotice')}</Alert>}

          <TextField
            label={t('storesAdmin.field.name')}
            required
            error={Boolean(errors.name)}
            helperText={errors.name ? t(errors.name.message as MessageKey) : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            {...nameField}
            onChange={onNameChange}
          />

          <FieldRow>
            <TextField
              fullWidth
              label={t('storesAdmin.field.slug')}
              required
              error={Boolean(errors.slug)}
              helperText={errors.slug ? t(errors.slug.message as MessageKey) : t('storesAdmin.field.slugHint')}
              slotProps={{ inputLabel: { shrink: true } }}
              {...slugField}
              onChange={(event) => {
                slugTouched.current = true
                void slugField.onChange(event)
              }}
            />
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <TextField
                  select
                  label={t('storesAdmin.field.currency')}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  error={Boolean(errors.currency)}
                  helperText={errors.currency ? t(errors.currency.message as MessageKey) : undefined}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: { xs: '100%', sm: 170 }, flexShrink: 0 }}
                >
                  {(currencies.data ?? []).map((currency) => (
                    <MenuItem key={currency.code} value={currency.code}>
                      {currency.code} · {currency.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </FieldRow>
          {store && (
            <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('storesAdmin.field.currencyHint')}</Typography>
          )}

          {domainEnabled && (
            <TextField
              label={t('storesAdmin.field.domain')}
              error={Boolean(errors.domain)}
              helperText={errors.domain ? t(errors.domain.message as MessageKey) : t('storesAdmin.field.domainHint')}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('domain')}
            />
          )}
        </Stack>
      </Box>
    </FormDrawer>
  )
}
