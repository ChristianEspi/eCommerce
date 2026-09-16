import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
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
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoneyOrDash } from '@/shared/lib/format'
import { LoadingState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CatalogError } from '../api/errors'
import { PanelHint } from './VariantsPanel'
import { useProductUoms, useSaveProductUom, useUnits } from './hooks'
import {
  effectiveUomPrice,
  productUomFormSchema,
  type ProductUom,
  type ProductUomFormValues,
} from './types'
import type { PimProduct } from '../types'

/**
 * Unidades de venta del producto.
 *
 * El `factor` es la única cifra que importa aquí: cuántas unidades base entrega
 * una de esta. Se enseña el precio EFECTIVO al lado, porque «factor 12, precio
 * vacío» y «factor 12, precio 100» son dos negocios distintos y la diferencia
 * no se ve mirando el formulario.
 *
 * Un producto sin filas se vende en su unidad implícita, exactamente como antes
 * del PIM: esta pestaña no es obligatoria para nadie.
 */
export function UomsPanel({
  product,
  organizationId,
  companyId,
  storeId,
  canWrite,
}: {
  product: PimProduct | null
  organizationId: string
  companyId: string
  storeId: string
  canWrite: boolean
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()

  const productId = product?.id ?? null
  const uoms = useProductUoms(productId)
  const units = useUnits(Boolean(productId))
  const save = useSaveProductUom()

  const [editing, setEditing] = useState<{ open: boolean; uom: ProductUom | null }>({
    open: false,
    uom: null,
  })

  const unitName = useMemo(() => {
    const map = new Map<string, string>()
    for (const unit of units.data ?? []) map.set(unit.id, `${unit.code} · ${unit.name}`)
    return map
  }, [units.data])

  const list = uoms.data ?? []
  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!product) {
    return <PanelHint title={t('pim.uoms.title')} body={t('pim.uoms.saveFirst')} />
  }

  if (uoms.isPending) return <LoadingState />

  const available = (units.data ?? []).filter((unit) => unit.is_active)

  async function onSubmit(values: ProductUomFormValues) {
    if (!product) return
    await save.mutateAsync({
      id: editing.uom?.id ?? null,
      productId: product.id,
      scope: { organizationId, companyId, storeId },
      values,
    })
    notify(t('pim.toast.saved'))
    setEditing({ open: false, uom: null })
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
          {t('pim.uoms.title')}
        </Typography>
        {canWrite && available.length > 0 && (
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              setEditing((state) =>
                state.open ? { open: false, uom: null } : { open: true, uom: null },
              )
            }
          >
            {t('pim.uoms.new')}
          </Button>
        )}
      </Stack>

      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('pim.uoms.help')}</Typography>

      {available.length === 0 && !units.isPending && (
        <Alert severity="info">{t('pim.uoms.noUnits')}</Alert>
      )}

      <Collapse in={editing.open} unmountOnExit>
        <UomForm
          key={editing.uom?.id ?? 'nueva'}
          uom={editing.uom}
          units={available.map((unit) => ({ id: unit.id, label: `${unit.code} · ${unit.name}` }))}
          currency={product.currency}
          onCancel={() => setEditing({ open: false, uom: null })}
          onSubmit={onSubmit}
        />
      </Collapse>

      {list.length === 0 ? (
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.uoms.empty')}</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('pim.tab.units')}</TableCell>
              <TableCell align="right">{t('pim.field.factor')}</TableCell>
              <TableCell align="right">{t('pim.uoms.effective')}</TableCell>
              <TableCell>{t('pim.field.sellable')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((uom) => (
              <TableRow key={uom.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>
                  {unitName.get(uom.uom_id) ?? uom.uom_id}
                  {uom.is_base && (
                    <Chip size="small" sx={{ ml: 1 }} label={t('pim.field.base')} />
                  )}
                </TableCell>
                <TableCell align="right" className="tnum">
                  {uom.factor}
                </TableCell>
                <TableCell align="right" className="tnum">
                  {formatMoneyOrDash(effectiveUomPrice(uom, product.price), product.currency, locale)}
                </TableCell>
                <TableCell>{uom.is_sellable ? t('common.yes') : t('common.no')}</TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: '0',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${unitName.get(uom.uom_id) ?? uom.uom_id}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => setEditing({ open: true, uom }),
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {/* El paginador solo aparece cuando hay algo que paginar: un
          "0-0 de 0" bajo un estado vacio es ruido que contradice al
          propio estado vacio. */}
      {pager.total > 0 && (
        <TablePager
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          onPageChange={pager.setPage}
        />
      )}
    </Stack>
  )
}

function UomForm({
  uom,
  units,
  currency,
  onCancel,
  onSubmit,
}: {
  uom: ProductUom | null
  units: Array<{ id: string; label: string }>
  currency: string
  onCancel: () => void
  onSubmit: (values: ProductUomFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductUomFormValues>({
    resolver: zodResolver(productUomFormSchema),
    defaultValues: {
      uom_id: uom?.uom_id ?? '',
      factor: uom?.factor ?? '1',
      is_base: uom?.is_base ?? false,
      is_sellable: uom?.is_sellable ?? true,
      price: uom?.price ?? '',
    },
  })

  const isBase = watch('is_base')

  const fieldError = (key: keyof ProductUomFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: ProductUomFormValues) {
    setServerError(null)
    try {
      await onSubmit(values)
    } catch (error) {
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(submit)}
      noValidate
      aria-label={t('pim.uoms.new')}
      sx={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md, 10px)', p: 2, mb: 1 }}
    >
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{t(serverError)}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            size="small"
            fullWidth
            label={t('pim.tab.units')}
            value={watch('uom_id')}
            error={Boolean(errors.uom_id)}
            helperText={fieldError('uom_id')}
            {...register('uom_id')}
          >
            <MenuItem value="">{t('common.none')}</MenuItem>
            {units.map((unit) => (
              <MenuItem key={unit.id} value={unit.id}>
                {unit.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            fullWidth
            label={t('pim.field.factor')}
            // La unidad base es factor 1 por CHECK en la base; el campo se
            // bloquea en vez de dejar escribir algo que se va a rechazar.
            disabled={isBase}
            error={Boolean(errors.factor)}
            helperText={fieldError('factor')}
            inputProps={{ inputMode: 'decimal' }}
            {...register('factor')}
          />

          <TextField
            size="small"
            fullWidth
            label={`${t('common.price')} (${currency})`}
            error={Boolean(errors.price)}
            helperText={fieldError('price') ?? t('pim.uoms.priceHelp')}
            inputProps={{ inputMode: 'decimal' }}
            {...register('price')}
          />
        </Stack>

        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch
                checked={isBase}
                onChange={(_, checked) => {
                  setValue('is_base', checked)
                  if (checked) setValue('factor', '1')
                }}
              />
            }
            label={t('pim.field.base')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={watch('is_sellable')}
                onChange={(_, checked) => setValue('is_sellable', checked)}
              />
            }
            label={t('pim.field.sellable')}
          />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
