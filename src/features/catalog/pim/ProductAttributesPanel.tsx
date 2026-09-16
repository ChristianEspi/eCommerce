import {
  Alert,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { LoadingState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CatalogError } from '../api/errors'
import { PanelHint } from './VariantsPanel'
import {
  useAttributeValues,
  useAttributes,
  useProductAttributes,
  useSaveProductAttribute,
} from './hooks'
import type { ProductAttributeInput } from './api'
import type { AttributeValue, ProductAttributeValue } from './types'
import type { PimProduct } from '../types'

/**
 * Ficha técnica del producto: un valor por atributo declarado.
 *
 * Se guarda campo a campo al salir del control (`onBlur`) en vez de con un
 * botón «Guardar» propio. El cajón del producto ya tiene su barra de guardar
 * para los datos del producto, y una segunda barra dentro de una pestaña es la
 * forma más fiable de que alguien pulse la que no era y pierda lo escrito.
 *
 * El control cambia con el tipo del atributo: una lista se elige, un número se
 * teclea con teclado numérico y un booleano es un interruptor. Es lo que hace
 * que estos valores sirvan para filtrar de verdad — el motivo por el que no
 * viven en `custom_fields`.
 */
export function ProductAttributesPanel({
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
  const { t } = useI18n()
  const { notify } = useFeedback()

  const productId = product?.id ?? null
  const attributes = useAttributes(Boolean(productId))
  const options = useAttributeValues(Boolean(productId))
  const assigned = useProductAttributes(productId)
  const save = useSaveProductAttribute()
  const [error, setError] = useState<MessageKey | null>(null)

  const byAttribute = useMemo(() => {
    const map = new Map<string, ProductAttributeValue>()
    for (const row of assigned.data ?? []) map.set(row.attribute_id, row)
    return map
  }, [assigned.data])

  const optionsByAttribute = useMemo(() => {
    const map = new Map<string, AttributeValue[]>()
    for (const option of options.data ?? []) {
      map.set(option.attribute_id, [...(map.get(option.attribute_id) ?? []), option])
    }
    return map
  }, [options.data])

  if (!product) {
    return (
      <PanelHint title={t('pim.productAttributes.title')} body={t('pim.productAttributes.saveFirst')} />
    )
  }

  if (attributes.isPending || assigned.isPending) return <LoadingState />

  // Los ejes de variante no se rellenan aquí: los fija cada variante, y
  // permitir un "Color" del producto ADEMÁS del de sus variantes crearía dos
  // verdades sobre el mismo dato.
  const editable = (attributes.data ?? []).filter(
    (attribute) => attribute.is_active && !attribute.is_variant_axis,
  )

  async function write(attributeId: string, value: ProductAttributeInput) {
    if (!product) return
    setError(null)
    try {
      await save.mutateAsync({
        id: byAttribute.get(attributeId)?.id ?? null,
        productId: product.id,
        attributeId,
        scope: { organizationId, companyId, storeId },
        value,
      })
      notify(t('pim.toast.saved'))
    } catch (caught) {
      setError(caught instanceof CatalogError ? caught.key : 'catalog.error.generic')
    }
  }

  return (
    <Stack spacing={2}>
      <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
        {t('pim.productAttributes.title')}
      </Typography>
      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
        {t('pim.productAttributes.help')}
      </Typography>

      {error && <Alert severity="error">{t(error)}</Alert>}

      {editable.length === 0 ? (
        <Typography sx={{ color: 'var(--muted)' }}>{t('pim.productAttributes.empty')}</Typography>
      ) : (
        <Stack spacing={2}>
          {editable.map((attribute) => {
            const row = byAttribute.get(attribute.id)
            const label = attribute.unit ? `${attribute.name} (${attribute.unit})` : attribute.name

            if (attribute.data_type === 'option') {
              return (
                <TextField
                  key={attribute.id}
                  select
                  size="small"
                  fullWidth
                  label={label}
                  disabled={!canWrite}
                  value={row?.value_id ?? ''}
                  onChange={(event) => {
                    if (!event.target.value) return
                    void write(attribute.id, { kind: 'option', optionId: event.target.value })
                  }}
                >
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  {(optionsByAttribute.get(attribute.id) ?? [])
                    .filter((option) => option.is_active)
                    .map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.label}
                      </MenuItem>
                    ))}
                </TextField>
              )
            }

            if (attribute.data_type === 'boolean') {
              return (
                <Stack
                  key={attribute.id}
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center' }}
                >
                  <Switch
                    checked={row?.value_boolean ?? false}
                    disabled={!canWrite}
                    inputProps={{ 'aria-label': label }}
                    onChange={(_, checked) =>
                      void write(attribute.id, { kind: 'boolean', boolean: checked })
                    }
                  />
                  <Typography>{label}</Typography>
                </Stack>
              )
            }

            // El número va como `text` con teclado decimal: `type="number"` en
            // el navegador acepta notación científica y pierde el valor al
            // hacer scroll sobre el campo.
            const type = attribute.data_type === 'date' ? 'date' : 'text'

            return (
              <TextField
                key={attribute.id}
                size="small"
                fullWidth
                type={type}
                label={label}
                disabled={!canWrite}
                InputLabelProps={attribute.data_type === 'date' ? { shrink: true } : undefined}
                defaultValue={
                  attribute.data_type === 'number'
                    ? (row?.value_number ?? '')
                    : attribute.data_type === 'date'
                      ? (row?.value_date ?? '')
                      : (row?.value_text ?? '')
                }
                inputProps={
                  attribute.data_type === 'number' ? { inputMode: 'decimal' } : undefined
                }
                onBlur={(event) => {
                  const raw = event.target.value.trim()
                  if (!raw) return
                  if (attribute.data_type === 'number') {
                    if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(raw)) {
                      setError('pim.error.factor')
                      return
                    }
                    void write(attribute.id, { kind: 'number', number: raw })
                    return
                  }
                  if (attribute.data_type === 'date') {
                    void write(attribute.id, { kind: 'date', date: raw })
                    return
                  }
                  void write(attribute.id, { kind: 'text', text: raw })
                }}
              />
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
