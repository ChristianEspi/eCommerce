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
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoneyOrDash } from '@/shared/lib/format'
import { LoadingState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CatalogError } from '../api/errors'
import {
  useAttributeValues,
  useAttributes,
  useSaveVariant,
  useSetVariantAxes,
  useVariantAxes,
  useVariants,
} from './hooks'
import {
  effectiveVariantPrice,
  suggestVariantName,
  suggestVariantSku,
  variantFormSchema,
  variantToForm,
  type Attribute,
  type AttributeValue,
  type ProductVariant,
  type VariantFormValues,
} from './types'
import type { PimProduct } from '../types'

/**
 * Variantes del producto.
 *
 * La variante es lo que de verdad se vende cuando el producto tiene ejes: lleva
 * su SKU, su existencia y, si quiere, su precio. El precio vacío HEREDA el del
 * maestro y se enseña como «hereda» en vez de repetir la cifra, para que se vea
 * cuál va a cambiar sola cuando cambie el precio del producto.
 *
 * Los ejes se eligen aquí mismo y sugieren nombre y SKU. Solo sugieren: el
 * usuario manda, igual que con el slug del producto.
 */
export function VariantsPanel({
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
  const variants = useVariants(productId)
  const axes = useVariantAxes(productId)
  const attributes = useAttributes(Boolean(productId))
  const attributeValues = useAttributeValues(Boolean(productId))
  const saveVariant = useSaveVariant()
  const setAxes = useSetVariantAxes()

  const [editing, setEditing] = useState<{ open: boolean; variant: ProductVariant | null }>({
    open: false,
    variant: null,
  })

  const axisAttributes = useMemo(
    () => (attributes.data ?? []).filter((attribute) => attribute.is_variant_axis && attribute.is_active),
    [attributes.data],
  )

  const valuesByAttribute = useMemo(() => {
    const map = new Map<string, AttributeValue[]>()
    for (const value of attributeValues.data ?? []) {
      map.set(value.attribute_id, [...(map.get(value.attribute_id) ?? []), value])
    }
    return map
  }, [attributeValues.data])

  const axesByVariant = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const axis of axes.data ?? []) {
      const inner = map.get(axis.variant_id) ?? new Map<string, string>()
      inner.set(axis.attribute_id, axis.value_id)
      map.set(axis.variant_id, inner)
    }
    return map
  }, [axes.data])

  const valueLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const value of attributeValues.data ?? []) map.set(value.id, value.label)
    return map
  }, [attributeValues.data])

  const list = variants.data ?? []
  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!product) {
    return <PanelHint title={t('pim.variants.title')} body={t('pim.variants.saveFirst')} />
  }

  if (product.kind !== 'variant') {
    return <PanelHint title={t('pim.variants.title')} body={t('pim.variants.needsKind')} />
  }

  if (variants.isPending) return <LoadingState />


  async function onSubmit(values: VariantFormValues, selected: Record<string, string>) {
    if (!product) return
    const saved = await saveVariant.mutateAsync({
      id: editing.variant?.id ?? null,
      productId: product.id,
      scope: { organizationId, companyId, storeId },
      values,
    })

    const chosen = Object.entries(selected)
      .filter(([, valueId]) => Boolean(valueId))
      .map(([attribute_id, value_id]) => ({ attribute_id, value_id }))

    // Los ejes se escriben después de la variante porque necesitan su id. Si
    // esta segunda escritura fallara, la variante queda sin ejes y el listado
    // lo enseña vacío — visible y arreglable, en vez de una variante perdida.
    await setAxes.mutateAsync({
      variantId: saved.id || (editing.variant?.id ?? ''),
      scope: { organizationId, companyId, storeId },
      axes: chosen,
    })

    notify(t('pim.toast.saved'))
    setEditing({ open: false, variant: null })
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
          {t('pim.variants.title')}
        </Typography>
        {canWrite && (
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              setEditing((state) => (state.open ? { open: false, variant: null } : { open: true, variant: null }))
            }
          >
            {t('pim.variants.new')}
          </Button>
        )}
      </Stack>

      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('pim.variants.help')}</Typography>

      <Collapse in={editing.open} unmountOnExit>
        <VariantForm
          key={editing.variant?.id ?? 'nueva'}
          variant={editing.variant}
          productSku={product.sku}
          axisAttributes={axisAttributes}
          valuesByAttribute={valuesByAttribute}
          initialAxes={editing.variant ? (axesByVariant.get(editing.variant.id) ?? new Map()) : new Map()}
          currency={product.currency}
          onCancel={() => setEditing({ open: false, variant: null })}
          onSubmit={onSubmit}
        />
      </Collapse>

      {list.length === 0 ? (
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.variants.empty')}</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('catalog.field.sku')}</TableCell>
              <TableCell>{t('pim.field.name')}</TableCell>
              <TableCell>{t('pim.field.axes')}</TableCell>
              <TableCell align="right">{t('common.price')}</TableCell>
              <TableCell align="right">{t('catalog.field.stock')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((variant) => (
              <TableRow key={variant.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>
                  {variant.sku}
                  {variant.is_default && (
                    <Chip size="small" sx={{ ml: 1 }} label={t('pim.variants.default')} />
                  )}
                </TableCell>
                <TableCell>
                  {variant.name}
                  {!variant.is_active && (
                    <Chip size="small" sx={{ ml: 1 }} label={t('common.no')} variant="outlined" />
                  )}
                </TableCell>
                <TableCell sx={{ color: 'var(--muted)', fontSize: 13 }}>
                  {[...(axesByVariant.get(variant.id)?.values() ?? [])]
                    .map((valueId) => valueLabel.get(valueId) ?? '')
                    .filter(Boolean)
                    .join(' · ') || t('common.none')}
                </TableCell>
                <TableCell align="right" className="tnum">
                  {formatMoneyOrDash(effectiveVariantPrice(variant, product.price), product.currency, locale)}
                  {variant.price === null && (
                    <Typography component="span" sx={{ color: 'var(--muted)', fontSize: 11, ml: 0.5 }}>
                      {t('pim.variants.inherited')}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right" className="tnum">
                  {variant.stock}
                </TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: '0',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${variant.name}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => setEditing({ open: true, variant }),
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

/** Encabezado + explicación. Los tres motivos por los que el panel no aplica. */
export function PanelHint({ title, body }: { title: string; body: string }) {
  return (
    <Stack spacing={1}>
      <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
        {title}
      </Typography>
      <Typography sx={{ color: 'var(--muted)' }}>{body}</Typography>
    </Stack>
  )
}

function VariantForm({
  variant,
  productSku,
  axisAttributes,
  valuesByAttribute,
  initialAxes,
  currency,
  onCancel,
  onSubmit,
}: {
  variant: ProductVariant | null
  productSku: string
  axisAttributes: Attribute[]
  valuesByAttribute: Map<string, AttributeValue[]>
  initialAxes: Map<string, string>
  currency: string
  onCancel: () => void
  onSubmit: (values: VariantFormValues, axes: Record<string, string>) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialAxes.entries()),
  )
  const [touchedName, setTouchedName] = useState(Boolean(variant))

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<VariantFormValues>({
    resolver: zodResolver(variantFormSchema),
    defaultValues: variantToForm(variant),
  })

  // Nombre y SKU se sugieren a partir de los ejes elegidos, mientras el usuario
  // no los haya escrito a mano. Es la misma regla que el slug del producto.
  useEffect(() => {
    if (touchedName) return
    const labels: string[] = []
    const codes: string[] = []
    for (const attribute of axisAttributes) {
      const valueId = selected[attribute.id]
      const value = (valuesByAttribute.get(attribute.id) ?? []).find((item) => item.id === valueId)
      if (value) {
        labels.push(value.label)
        codes.push(value.code)
      }
    }
    if (labels.length === 0) return
    setValue('name', suggestVariantName(labels))
    setValue('sku', suggestVariantSku(productSku, codes))
  }, [selected, axisAttributes, valuesByAttribute, productSku, setValue, touchedName])

  const fieldError = (key: keyof VariantFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: VariantFormValues) {
    setServerError(null)
    try {
      await onSubmit(values, selected)
    } catch (error) {
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(submit)}
      noValidate
      // Nombre accesible: el cajon tiene varios formularios a la vez (los datos
      // del producto siguen montados detras de la pestana) y sin nombre un
      // lector de pantalla anuncia dos campos "SKU" indistinguibles.
      aria-label={t('pim.variants.new')}
      sx={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md, 10px)',
        p: 2,
        mb: 1,
      }}
    >
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{t(serverError)}</Alert>}

        {axisAttributes.length > 0 && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {axisAttributes.map((attribute) => (
              <TextField
                key={attribute.id}
                select
                size="small"
                fullWidth
                label={attribute.name}
                value={selected[attribute.id] ?? ''}
                onChange={(event) =>
                  setSelected((state) => ({ ...state, [attribute.id]: event.target.value }))
                }
              >
                <MenuItem value="">{t('common.none')}</MenuItem>
                {(valuesByAttribute.get(attribute.id) ?? [])
                  .filter((value) => value.is_active)
                  .map((value) => (
                    <MenuItem key={value.id} value={value.id}>
                      {value.label}
                    </MenuItem>
                  ))}
              </TextField>
            ))}
          </Stack>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            size="small"
            fullWidth
            label={t('pim.field.name')}
            error={Boolean(errors.name)}
            helperText={fieldError('name')}
            {...register('name', { onChange: () => setTouchedName(true) })}
          />
          <TextField
            size="small"
            fullWidth
            label={t('catalog.field.sku')}
            error={Boolean(errors.sku)}
            helperText={fieldError('sku')}
            inputProps={{ spellCheck: false }}
            {...register('sku', { onChange: () => setTouchedName(true) })}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            size="small"
            fullWidth
            label={`${t('common.price')} (${currency})`}
            error={Boolean(errors.price)}
            helperText={fieldError('price') ?? t('pim.variants.priceHelp')}
            inputProps={{ inputMode: 'decimal' }}
            {...register('price')}
          />
          <TextField
            size="small"
            fullWidth
            label={t('catalog.field.stock')}
            error={Boolean(errors.stock)}
            helperText={fieldError('stock')}
            inputProps={{ inputMode: 'numeric' }}
            {...register('stock')}
          />
          <TextField
            size="small"
            fullWidth
            label={t('pim.field.barcode')}
            error={Boolean(errors.barcode)}
            helperText={fieldError('barcode') ?? t('common.optional')}
            inputProps={{ spellCheck: false }}
            {...register('barcode')}
          />
        </Stack>

        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch
                checked={watch('is_active')}
                onChange={(_, checked) => setValue('is_active', checked)}
              />
            }
            label={t('pim.field.active')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={watch('is_default')}
                onChange={(_, checked) => setValue('is_default', checked)}
              />
            }
            label={t('pim.variants.makeDefault')}
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
