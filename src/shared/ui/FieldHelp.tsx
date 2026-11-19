import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { IconButton, Tooltip } from '@mui/material'
import type { ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'

/**
 * Icono «i» con la explicación de un campo (2026-11-18).
 *
 * Se ve al pasar el ratón, al enfocarlo con el teclado y al tocarlo en el
 * móvil (sin esperar). Es un botón de verdad: se alcanza con Tab y el lector de
 * pantalla lee la ayuda como su descripción. No envía el formulario ni roba el
 * foco del campo al hacer clic.
 */
export function FieldHelp({ text, label }: { text: ReactNode; label?: string }) {
  const { t } = useI18n()
  const name = label ? t('common.help.about').replace('{field}', label) : t('common.help')
  return (
    <Tooltip
      title={text}
      arrow
      placement="top"
      enterTouchDelay={0}
      leaveTouchDelay={5000}
      describeChild
      slotProps={{ tooltip: { sx: { fontSize: 13, lineHeight: 1.45, maxWidth: 300, p: 1.25 } } }}
    >
      <IconButton
        size="small"
        aria-label={name}
        tabIndex={0}
        data-field-help=""
        onMouseDown={(event) => event.preventDefault()}
        sx={{ p: 0.25, color: 'var(--muted)', '&:hover, &:focus-visible': { color: 'var(--accent-deep)' } }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  )
}
