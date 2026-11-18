import { zodResolver } from '@hookform/resolvers/zod'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { Controller, useForm } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { RowActions } from '@/shared/ui/RowActions'
import { useFeedback } from '@/shared/ui/feedback-context'
import { Field } from '@/shared/ui/Field'
import type { TradeScope } from './api'
import { AssortmentAssignmentsPanel } from './AssortmentAssignmentsPanel'
import { TradeError } from './errors'
import {
  useAddAssortmentItem,
  useAssortmentItems,
  useRemoveAssortmentItem,
  useSaveAssortment,
  useTradeProductSearch,
} from './hooks'
import {
  assortmentFormSchema,
  emptyAssortmentForm,
  type Assortment,
  type AssortmentFormValues,
} from './types'

/**
 * El surtido: la cabecera y su contenido.
 *
 * El interruptor «lista blanca» cambia el SIGNO de todo lo que hay dentro, así
 * que se avisa en palabras y no solo con una casilla: los mismos cinco
 * productos significan «solo estos cinco» o «todos menos estos cinco», y
 * confundirlo invierte el catálogo entero de un cliente.
 *
 * El contenido solo se puede tocar cuando el surtido ya existe: sin id no hay
 * a qué colgar las líneas.
 */
export function AssortmentDrawer({
  open,
  assortment,
  scope,
  canWrite,
  onClose,
}: {
  open: boolean
  assortment: Assortment | null
  scope: TradeScope | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [productSearch, setProductSearch] = useState('')

  const items = useAssortmentItems(assortment?.id ?? null)
  const save = useSaveAssortment()
  const addItem = useAddAssortmentItem()
  const removeItem = useRemoveAssortmentItem()

  const products = useTradeProductSearch(
    open ? (scope?.storeId ?? null) : null,
    productSearch,
  )

  const opcionesProducto = useMemo<PickerOption[]>(
    () => (products.data ?? []).map((p) => ({ id: p.id, primary: p.name, secondary: p.sku })),
    [products.data],
  )

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AssortmentFormValues>({
    resolver: zodResolver(assortmentFormSchema),
    defaultValues: emptyAssortmentForm(),
  })

  useEffect(() => {
    if (!open) return
    reset(
      assortment
        ? {
            code: assortment.code,
            name: assortment.name,
            is_allow_list: assortment.is_allow_list,
            is_active: assortment.is_active,
          }
        : emptyAssortmentForm(),
    )
    setProductSearch('')
    setServerError(null)
  }, [open, assortment, reset])

  const esBlanca = watch('is_allow_list')
  const lineas = items.data ?? []
  const yaEstan = new Set(lineas.map((linea) => linea.product_id))

  async function submit(values: AssortmentFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: assortment?.id ?? null, values })
      notify(t('trade.toast.assortmentSaved'), 'success')
      if (!assortment) onClose()
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  async function añadir(productId: string) {
    if (!scope || !assortment) return
    setServerError(null)
    try {
      await addItem.mutateAsync({ scope, assortmentId: assortment.id, productId })
      setProductSearch('')
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  async function quitar(id: string) {
    setServerError(null)
    try {
      await removeItem.mutateAsync(id)
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={assortment ? assortment.name : t('trade.assortments.new')}
      subtitle={assortment?.code}
      onClose={onClose}
      busy={isSubmitting}
      width={640}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.close')}
          </Button>
          <Button
            type="submit"
            form="assortment-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="assortment-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <FieldRow>
            {/* Un codigo de surtido son dos palabras cortas: a ancho fijo, para
                que el nombre —que si es largo— se quede con el resto. */}
            <Field
              rule="code"
              maxLength={41}
              help={t('help.trade.assortmentCode')}
              label={t('trade.field.code')}
              required
              disabled={!canWrite}
              error={Boolean(errors.code)}
              helperText={
                errors.code ? t(errors.code.message as MessageKey) : t('trade.field.codeHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 190 }, flexShrink: 0 }}
              {...register('code')}
            />
            <Field
              fullWidth
              rule="text"
              maxLength={120}
              label={t('trade.field.name')}
              required
              disabled={!canWrite}
              error={Boolean(errors.name)}
              helperText={errors.name ? t(errors.name.message as MessageKey) : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('name')}
            />
          </FieldRow>

          <Box>
            <Controller
              control={control}
              name="is_allow_list"
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      disabled={!canWrite}
                      onChange={(event) => field.onChange(event.target.checked)}
                    />
                  }
                  label={t('trade.field.isAllowList')}
                />
              )}
            />
            {/* Qué significa AHORA mismo, en palabras. La casilla sola obliga
                a acordarse de qué lado es cuál. */}
            <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
              {esBlanca ? t('trade.list.allowHelp') : t('trade.list.blockHelp')}
            </Typography>
          </Box>

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
                label={t('trade.field.isActive')}
              />
            )}
          />

          {assortment && (
            <Box>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>
                {t('trade.assortments.contents')}
              </Typography>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('trade.field.sku')}</TableCell>
                    <TableCell>{t('trade.field.product')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lineas.map((linea) => (
                    <TableRow key={linea.id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{linea.product_sku ?? '—'}</TableCell>
                      <TableCell>{linea.product_name ?? '—'}</TableCell>
                      <TableCell align="right">
                        <RowActions
                          actions={[
                            {
                              id: 'del',
                              icon: <DeleteRoundedIcon fontSize="small" />,
                              label: `${t('trade.assortments.removeItem')}: ${linea.product_name ?? ''}`,
                              tone: 'danger',
                              disabled: !canWrite || removeItem.isPending,
                              onClick: () => void quitar(linea.id),
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
                    label={t('trade.field.product')}
                    placeholder={t('trade.assortments.searchProduct')}
                    term={productSearch}
                    onTermChange={setProductSearch}
                    options={opcionesProducto}
                    loading={products.isFetching}
                    alreadyIn={yaEstan}
                    clearOnPick
                    onPick={(option) => void añadir(option.id)}
                  />
                </Stack>
              )}
            </Box>
          )}

          {/* 2026-11-16 · A quién se aplica. Sin asignación el surtido no actúa. */}
          {assortment && <AssortmentAssignmentsPanel assortment={assortment} scope={scope} canWrite={canWrite} />}
        </Stack>
      </Box>
    </FormDrawer>
  )
}
