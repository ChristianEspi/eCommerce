import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { AssignmentsPanel } from './AssignmentsPanel'
import { PriceItemsPanel } from './PriceItemsPanel'
import { PricingError } from './errors'
import { useSavePriceList } from './hooks'
import { priceListFormSchema, priceListToForm, type PriceList, type PriceListFormValues } from './types'

/**
 * Alta y edición de una lista, por pestañas.
 *
 * General · Precios · Asignaciones. Las tres partes de un acuerdo comercial, y
 * las tres se guardan por separado a propósito: un renglón de precio y una
 * asignación son filas distintas de tablas distintas, y guardarlas juntas
 * obligaría a inventar una transacción en el cliente. Es la misma decisión que
 * tomó el cajón de producto del PIM.
 *
 * Precios y Asignaciones solo aparecen cuando la lista YA existe: sin id no hay
 * a qué colgarlas, y una pestaña que solo dice «guarda primero» es una pestaña
 * que sobra.
 */
export function PriceListDrawer({
  open,
  list,
  canWrite,
  onClose,
  onCreated,
}: {
  open: boolean
  list: PriceList | null
  canWrite: boolean
  onClose: () => void
  /** Alta hecha: quien abrió el cajón lo pasa a editar la lista nueva. */
  onCreated?: (list: PriceList) => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore } = useTenant()
  const save = useSavePriceList()

  const [tab, setTab] = useState(0)
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PriceListFormValues>({
    resolver: zodResolver(priceListFormSchema),
    defaultValues: priceListToForm(list),
  })

  useEffect(() => {
    if (!open) return
    reset({
      ...priceListToForm(list),
      currency: list?.currency ?? activeStore?.currency ?? '',
    })
    setTab(0)
    setServerError(null)
  }, [open, list, reset, activeStore?.currency])

  const fieldError = (key: keyof PriceListFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: PriceListFormValues) {
    if (!tenant || !activeCompanyId || !activeStore) return
    setServerError(null)
    try {
      const saved = await save.mutateAsync({
        id: list?.id ?? null,
        scope: {
          organizationId: tenant.organization_id,
          companyId: activeCompanyId,
          storeId: activeStore.id,
        },
        values,
      })
      notify(t('pricing.toast.saved'))
      if (list) onClose()
      else onCreated?.(saved)
    } catch (error) {
      setServerError(error instanceof PricingError ? error.key : 'pricing.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={list ? list.name : t('pricing.lists.new')}
      subtitle={list ? list.code : t('pricing.lists.newHint')}
      onClose={onClose}
      busy={isSubmitting}
      width={640}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {list ? t('common.close') : t('common.cancel')}
          </Button>
          {tab === 0 && (
            <Button
              type="submit"
              form="price-list-form"
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
        {list && (
          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            variant="fullWidth"
            aria-label={t('pricing.lists.tabs')}
            sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
          >
            <Tab label={t('catalog.tab.general')} />
            <Tab label={t('pricing.tab.prices')} />
            <Tab label={t('pricing.tab.assignments')} />
          </Tabs>
        )}

        {tab === 0 && (
          <Box component="form" id="price-list-form" onSubmit={handleSubmit(submit)} noValidate>
            <Stack spacing={2.5}>
              {serverError && <Alert severity="error">{t(serverError)}</Alert>}

              <TextField
                label={t('pricing.field.name')}
                fullWidth
                autoFocus
                disabled={!canWrite}
                error={Boolean(errors.name)}
                helperText={fieldError('name')}
                {...register('name')}
              />

              <TextField
                label={t('pricing.field.code')}
                fullWidth
                disabled={!canWrite || Boolean(list)}
                error={Boolean(errors.code)}
                helperText={fieldError('code') ?? t('pricing.field.codeHint')}
                inputProps={{ spellCheck: false }}
                {...register('code')}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={t('pricing.field.currency')}
                  fullWidth
                  disabled={!canWrite}
                  error={Boolean(errors.currency)}
                  helperText={fieldError('currency') ?? t('pricing.field.currencyHint')}
                  inputProps={{ maxLength: 3, style: { textTransform: 'uppercase' } }}
                  {...register('currency')}
                />
                <TextField
                  label={t('pricing.field.priority')}
                  fullWidth
                  type="number"
                  disabled={!canWrite}
                  error={Boolean(errors.priority)}
                  helperText={fieldError('priority') ?? t('pricing.field.priorityHint')}
                  inputProps={{ min: 0, max: 1000 }}
                  {...register('priority')}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={t('pricing.field.validFrom')}
                  fullWidth
                  type="datetime-local"
                  disabled={!canWrite}
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.valid_from)}
                  helperText={fieldError('valid_from')}
                  {...register('valid_from')}
                />
                <TextField
                  label={t('pricing.field.validTo')}
                  fullWidth
                  type="datetime-local"
                  disabled={!canWrite}
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.valid_to)}
                  helperText={fieldError('valid_to') ?? t('pricing.field.validToHint')}
                  {...register('valid_to')}
                />
              </Stack>

              <TextField
                label={t('pricing.field.notes')}
                fullWidth
                multiline
                minRows={2}
                disabled={!canWrite}
                error={Boolean(errors.notes)}
                helperText={fieldError('notes')}
                {...register('notes')}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={watch('is_active')}
                    disabled={!canWrite}
                    onChange={(_, checked) => setValue('is_active', checked)}
                  />
                }
                label={t('pricing.field.active')}
              />
            </Stack>
          </Box>
        )}

        {tab === 1 && list && <PriceItemsPanel list={list} canWrite={canWrite} />}
        {tab === 2 && list && <AssignmentsPanel list={list} canWrite={canWrite} />}
      </Stack>
    </FormDrawer>
  )
}
