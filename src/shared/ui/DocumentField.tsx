import { MenuItem, Stack } from '@mui/material'
import { forwardRef } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { DOC_TYPES, type DocType } from '@/shared/lib/fieldRules'
import { Field, type FieldProps } from './Field'

/**
 * Documento de identidad: tipo + número (2026-11-18).
 *
 * El número sigue al tipo elegido: con RUC solo entran 11 dígitos, con DNI 8,
 * con carné o pasaporte letras y dígitos. Cada parte trae su icono de ayuda.
 *
 * El número se cablea como cualquier campo (`register('tax_id')` o
 * `value`/`onChange`) a través de `numberProps`; el tipo va controlado.
 */
export interface DocumentFieldProps {
  docType: DocType | ''
  onDocTypeChange: (type: DocType) => void
  /** Tipos que se ofrecen, en orden. Por defecto los cuatro. */
  types?: readonly DocType[]
  numberProps?: FieldProps
  typeError?: string
  disabled?: boolean
  required?: boolean
  size?: FieldProps['size']
}

export const DocumentField = forwardRef<HTMLDivElement, DocumentFieldProps>(function DocumentField(
  { docType, onDocTypeChange, types = DOC_TYPES, numberProps, typeError, disabled, required, size },
  ref,
) {
  const { t } = useI18n()
  const rule = docType || 'document'
  return (
    <Stack ref={ref} direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, width: '100%' }}>
      <Field
        select
        label={t('field.docType')}
        value={docType}
        onChange={(event) => onDocTypeChange(event.target.value as DocType)}
        disabled={disabled}
        required={required}
        size={size}
        error={Boolean(typeError)}
        helperText={typeError}
        help={t('field.help.docType')}
        sx={{ minWidth: { sm: 200 }, flexShrink: 0 }}
      >
        {types.map((type) => (
          <MenuItem key={type} value={type}>
            {t(`field.docType.${type}`)}
          </MenuItem>
        ))}
      </Field>
      <Field
        label={t('field.docNumber')}
        fullWidth
        disabled={disabled}
        required={required}
        size={size}
        help={docType ? t(`field.help.${docType}`) : t('field.help.docType')}
        {...numberProps}
        rule={rule}
        inputProps={{ spellCheck: false, ...numberProps?.inputProps }}
      />
    </Stack>
  )
})
