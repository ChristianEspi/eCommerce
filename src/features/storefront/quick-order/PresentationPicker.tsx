import { Button, MenuItem } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { SelectField } from '@/shared/ui/SelectField'
import type { IntakeLine } from './intake'

/**
 * «Flucoxin 150 mg Cápsula · Caja x 2» → «Caja x 2»: el nombre del producto ya
 * está en la etiqueta del desplegable.
 */
function shortName(variantName: string, productName: string): string {
  const prefix = `${productName} · `
  return variantName.startsWith(prefix) && variantName.length > prefix.length
    ? variantName.slice(prefix.length)
    : variantName
}

/**
 * La presentación de una línea `variante`, elegida en la misma fila (2026-11-22).
 *
 * Antes la fila solo enlazaba a la ficha del producto y, al volver, la lectura
 * de la IA se había perdido: había que subir el documento otra vez. Ahora las
 * presentaciones llegan con la lectura y se eligen aquí. Si no llegaron (la
 * consulta falló o ninguna tiene SKU), el enlace sigue, en otra pestaña para
 * no perder esta.
 */
export function PresentationPicker({
  storeSlug,
  line,
  value,
  onChange,
}: {
  storeSlug: string
  line: IntakeLine
  value: string | null
  onChange: (sku: string | null) => void
}) {
  const { t } = useI18n()
  const product = line.coincidencia
  if (!product) return null
  const label = t('store.intake.review.presentation').replace('{name}', product.name)

  if (line.presentaciones.length === 0) {
    return (
      <Button
        size="small"
        component={Link}
        to={`/s/${storeSlug}/product/${product.slug}`}
        target="_blank"
        rel="noopener"
      >
        {t('store.intake.review.chooseVariant').replace('{name}', product.name)}
      </Button>
    )
  }

  return (
    <SelectField
      size="small"
      label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      fullWidth
    >
      <MenuItem value="">{t('store.intake.review.pickPresentation')}</MenuItem>
      {line.presentaciones.map((p) => (
        <MenuItem key={p.variant_id} value={p.sku}>
          {shortName(p.name, product.name)} · {p.sku}
        </MenuItem>
      ))}
    </SelectField>
  )
}
