import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
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
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { LoadingState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CatalogError } from '../api/errors'
import { PanelHint } from './VariantsPanel'
import { useAddBundleItem, useBundleItems, useUnits, useVariants } from './hooks'
import {
  assemblableUnits,
  bundleItemFormSchema,
  type BundleItemFormValues,
} from './types'
import type { PimProduct, ProductCandidate } from '../types'

/**
 * Componentes del kit.
 *
 * Un kit no tiene existencia propia: la receta dice qué lleva y `create_order`
 * descuenta cada componente al vender. Por eso la cifra que se enseña arriba no
 * es un stock guardado, sino cuántos kits SE PUEDEN ARMAR con lo que hay ahora
 * mismo — que es la única respuesta honesta a "cuántos tengo".
 *
 * Los componentes elegibles son los productos simples y los maestros de
 * variantes de la tienda; los kits NO, porque la base no admite kits dentro de
 * kits. Al elegir un maestro de variantes aparece el selector de variante: la
 * receta tiene que decir CUÁL, si no el pedido descontaría de un maestro que no
 * lleva existencia.
 */
export function BundlePanel({
  product,
  products,
  organizationId,
  companyId,
  storeId,
  canWrite,
}: {
  product: PimProduct | null
  /** Catálogo de la tienda, ya cargado por el listado que abrió este cajón. */
  products: ProductCandidate[]
  organizationId: string
  companyId: string
  storeId: string
  canWrite: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()

  const productId = product?.id ?? null
  const items = useBundleItems(productId)
  const units = useUnits(Boolean(productId))
  const add = useAddBundleItem()
  const [open, setOpen] = useState(false)

  const candidates = useMemo(
    () => products.filter((candidate) => candidate.kind !== 'bundle' && candidate.id !== productId),
    [products, productId],
  )

  const byId = useMemo(() => new Map(products.map((item) => [item.id, item])), [products])
  const unitLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const unit of units.data ?? []) map.set(unit.id, unit.code)
    return map
  }, [units.data])

  const list = items.data ?? []
  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!product) {
    return <PanelHint title={t('pim.bundle.title')} body={t('pim.bundle.saveFirst')} />
  }

  if (product.kind !== 'bundle') {
    return <PanelHint title={t('pim.bundle.title')} body={t('pim.bundle.needsKind')} />
  }

  if (items.isPending) return <LoadingState />


  // Cuántos kits salen con lo que hay. Se omite el componente que esta pantalla
  // no puede evaluar: el que no está en la página cargada del listado, y el que
  // es una variante —su existencia vive en `product_variants`, no en el
  // producto—. Por eso el número se enseña como estimación de la pantalla; la
  // cuenta que manda la hace `create_order` con las filas bloqueadas.
  const evaluable = list.flatMap((item) => {
    if (item.component_variant_id) return []
    const component = byId.get(item.component_product_id)
    if (!component) return []
    return [{ requiredPerUnit: Number(item.quantity), available: component.stock }]
  })
  const assemblable = assemblableUnits(evaluable)
  const partial = evaluable.length < list.length

  async function onSubmit(values: BundleItemFormValues) {
    if (!product) return
    await add.mutateAsync({
      bundleProductId: product.id,
      scope: { organizationId, companyId, storeId },
      values,
      componentKind: values.component_variant_id ? 'variant' : 'simple',
    })
    notify(t('pim.toast.saved'))
    setOpen(false)
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
          {t('pim.bundle.title')}
        </Typography>
        {canWrite && candidates.length > 0 && (
          <Button size="small" variant="outlined" onClick={() => setOpen((value) => !value)}>
            {t('pim.bundle.new')}
          </Button>
        )}
      </Stack>

      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('pim.bundle.help')}</Typography>

      {list.length === 0 ? (
        <Alert severity="warning">{t('pim.bundle.noComponents')}</Alert>
      ) : (
        <Chip
          color="success"
          variant="outlined"
          label={`${t('pim.bundle.assemblable')}: ${partial ? `≤ ${assemblable}` : assemblable}`}
          sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
        />
      )}

      <Collapse in={open} unmountOnExit>
        <BundleItemForm
          candidates={candidates}
          units={(units.data ?? []).filter((unit) => unit.is_active)}
          onCancel={() => setOpen(false)}
          onSubmit={onSubmit}
        />
      </Collapse>

      {list.length === 0 ? (
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.bundle.empty')}</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('pim.field.component')}</TableCell>
              <TableCell align="right">{t('pim.field.quantity')}</TableCell>
              <TableCell>{t('pim.tab.units')}</TableCell>
              <TableCell align="right">{t('catalog.field.stock')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((item) => {
              const component = byId.get(item.component_product_id)
              return (
                <TableRow key={item.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>
                    {component?.name ?? t('common.none')}
                    {item.component_variant_id && (
                      <Chip size="small" sx={{ ml: 1 }} label={t('pim.field.variant')} />
                    )}
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {item.quantity}
                  </TableCell>
                  <TableCell sx={{ color: 'var(--muted)' }}>
                    {item.uom_id ? (unitLabel.get(item.uom_id) ?? '') : t('pim.field.base')}
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {component && !item.component_variant_id ? component.stock : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
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

function BundleItemForm({
  candidates,
  units,
  onCancel,
  onSubmit,
}: {
  candidates: ProductCandidate[]
  units: Array<{ id: string; code: string; name: string }>
  onCancel: () => void
  onSubmit: (values: BundleItemFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BundleItemFormValues>({
    resolver: zodResolver(bundleItemFormSchema),
    defaultValues: {
      component_product_id: '',
      component_variant_id: '',
      quantity: '1',
      uom_id: '',
    },
  })

  const componentId = watch('component_product_id')
  const component = candidates.find((candidate) => candidate.id === componentId) ?? null
  const needsVariant = component?.kind === 'variant'
  const componentVariants = useVariants(needsVariant ? componentId : null)

  const fieldError = (key: keyof BundleItemFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: BundleItemFormValues) {
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
      aria-label={t('pim.bundle.new')}
      sx={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md, 10px)', p: 2, mb: 1 }}
    >
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{t(serverError)}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            size="small"
            fullWidth
            label={t('pim.field.component')}
            value={componentId}
            error={Boolean(errors.component_product_id)}
            helperText={fieldError('component_product_id')}
            {...register('component_product_id', {
              // Cambiar de componente invalida la variante elegida: una
              // variante del producto anterior sería una referencia cruzada que
              // la FK rechaza al guardar.
              onChange: () => setValue('component_variant_id', ''),
            })}
          >
            <MenuItem value="">{t('common.none')}</MenuItem>
            {candidates.map((candidate) => (
              <MenuItem key={candidate.id} value={candidate.id}>
                {candidate.sku} · {candidate.name}
              </MenuItem>
            ))}
          </TextField>

          {needsVariant && (
            <TextField
              select
              size="small"
              fullWidth
              label={t('pim.field.variant')}
              value={watch('component_variant_id')}
              {...register('component_variant_id')}
            >
              <MenuItem value="">{t('common.none')}</MenuItem>
              {(componentVariants.data ?? []).map((variant) => (
                <MenuItem key={variant.id} value={variant.id}>
                  {variant.sku} · {variant.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            size="small"
            fullWidth
            label={t('pim.field.quantity')}
            error={Boolean(errors.quantity)}
            helperText={fieldError('quantity')}
            inputProps={{ inputMode: 'decimal' }}
            {...register('quantity')}
          />

          <TextField
            select
            size="small"
            fullWidth
            label={t('pim.tab.units')}
            value={watch('uom_id')}
            helperText={t('common.optional')}
            {...register('uom_id')}
          >
            <MenuItem value="">{t('pim.field.base')}</MenuItem>
            {units.map((unit) => (
              <MenuItem key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          {/* Un componente que se vende por variantes SIN variante elegida
              violaría la FK a `products (id, kind)` y devolvería un error de
              integridad sin explicación. Se corta antes. */}
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting || (needsVariant && !watch('component_variant_id'))}
          >
            {isSubmitting ? t('common.saving') : t('common.add')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
