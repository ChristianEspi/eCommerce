import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { InputAdornment, ListSubheader, TextField, Typography, type TextFieldProps } from '@mui/material'
import { Children, cloneElement, forwardRef, isValidElement, useState, type ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'

/**
 * Desplegable con buscador (2026-11-12).
 *
 * Es un `TextField select` de MUI con lo mismo de siempre —props, `register`
 * de react-hook-form, `value`/`onChange`— más un buscador fijo arriba del menú
 * en cuanto la lista pasa de unas pocas opciones. Un menú de cuarenta
 * productos o veinte categorías sin buscador obliga a hacer scroll y leer
 * fila por fila.
 *
 * Detalles que importan:
 *  · Las opciones que no coinciden se OCULTAN, no se quitan: el Select pinta
 *    el valor elegido buscándolo entre sus hijos, y quitarlo dejaría el campo
 *    en blanco mientras se busca.
 *  · El buscador vive en un `ListSubheader`, que MUI salta al navegar con
 *    flechas. El Select le pone igualmente un `onClick` de «elegir opción», así
 *    que el clic y las teclas del buscador no se dejan subir (salvo Escape, que
 *    cierra el menú).
 *  · Con `SelectProps.native` no hay menú propio que tocar: se deja tal cual.
 *  · La búsqueda ignora mayúsculas y tildes, y mira todo el texto de la opción
 *    (SKU y nombre a la vez).
 */
export const SEARCH_FROM_OPTIONS = 7

export type SelectFieldProps = Omit<TextFieldProps, 'select'>

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export const SelectField = forwardRef<HTMLDivElement, SelectFieldProps>(function SelectField(
  { children, SelectProps, ...props },
  ref,
) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const options = Children.toArray(children)
  const searchable = !SelectProps?.native && options.length >= SEARCH_FROM_OPTIONS

  if (!searchable) {
    return (
      <TextField ref={ref} select SelectProps={SelectProps} {...props}>
        {children}
      </TextField>
    )
  }

  const term = fold(query.trim())
  let visibles = 0
  const shown = options.map((child) => {
    if (!term || !isValidElement<{ style?: React.CSSProperties }>(child)) return child
    if (fold(textOf(child)).includes(term)) {
      visibles += 1
      return child
    }
    return cloneElement(child, { style: { ...child.props.style, display: 'none' } })
  })

  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <TextField
      ref={ref}
      select
      {...props}
      SelectProps={{
        ...SelectProps,
        onClose: (event) => {
          setQuery('')
          SelectProps?.onClose?.(event)
        },
        MenuProps: {
          ...SelectProps?.MenuProps,
          // El foco va al buscador, no a la primera opción.
          autoFocus: false,
          slotProps: { paper: { sx: { maxHeight: 380 } } },
        },
      }}
    >
      <ListSubheader sx={{ px: 1.5, pt: 1, pb: 1, bgcolor: 'background.paper', lineHeight: 'normal' }}>
        <TextField
          size="small"
          fullWidth
          autoFocus
          value={query}
          placeholder={t('common.searchOption')}
          onChange={(event) => setQuery(event.target.value)}
          onClick={stop}
          onMouseDown={stop}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') event.stopPropagation()
          }}
          inputProps={{ 'aria-label': t('common.searchOption') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        {term && visibles === 0 && (
          <Typography sx={{ fontSize: 13, color: 'var(--muted)', pt: 1, px: 0.5 }}>
            {t('common.noMatches')}
          </Typography>
        )}
      </ListSubheader>
      {shown}
    </TextField>
  )
})
