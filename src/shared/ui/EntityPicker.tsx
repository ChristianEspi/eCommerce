import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Autocomplete,
  Box,
  CircularProgress,
  InputAdornment,
  Paper,
  TextField,
  Typography,
  type PaperProps,
} from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { R } from '@/theme/tokens'

/** Una opción del buscador: lo que se lee, y lo que desambigua. */
export interface PickerOption {
  id: string
  /** El nombre. Es lo que la persona busca. */
  primary: string
  /** Código, SKU, documento. Distingue dos «Diego Mendoza». */
  secondary?: string | null
}

/**
 * Buscador de una entidad contra el servidor, en desplegable.
 *
 * ## Por qué desplegable y no una lista debajo
 *
 * Antes esto era un `SearchField` con los resultados volcados como lista dentro
 * del formulario. Con veintiocho clientes el cajón se llenaba de opciones, los
 * campos de abajo se iban fuera de la pantalla y el botón de guardar quedaba a
 * dos pantallazos de scroll. Un desplegable ocupa cero hasta que se usa y se
 * cierra al elegir, que es lo que hace un buscador.
 *
 * ## El servidor ya filtró: aquí no se vuelve a filtrar
 *
 * `filterOptions={(x) => x}` desactiva el filtrado en el navegador. Sin eso, MUI
 * volvería a cribar por su cuenta lo que llega y escondería resultados que el
 * servidor sí considera válidos —piensa en buscar por código cuando la etiqueta
 * visible es el nombre—.
 *
 * ## El tope se dice
 *
 * La consulta trae como mucho `limit` filas. Cuando llegan justo esas, es que
 * puede haber más y no caben: se avisa al pie en vez de dejar creer que eso es
 * todo lo que hay. No es paginación —el servidor no la ofrece todavía—, y
 * decirlo así es más honesto que fingir que la lista está completa.
 */
export function EntityPicker({
  label,
  placeholder,
  term,
  onTermChange,
  options,
  value = null,
  onPick,
  onClear,
  loading = false,
  disabled = false,
  error = false,
  helperText,
  alreadyIn,
  minChars = 2,
  limit = 20,
  clearOnPick = false,
}: {
  label: string
  placeholder?: string
  /** Lo que hay escrito. Lo controla quien llama, que es quien consulta. */
  term: string
  onTermChange: (next: string) => void
  options: readonly PickerOption[]
  /** Lo ya elegido, en los buscadores que se quedan con una elección. */
  value?: PickerOption | null
  onPick: (option: PickerOption) => void
  /**
   * La **✕** del campo. Sin esto, borrar vaciaba el texto y dejaba la elección
   * viva por debajo: el campo se veía vacío y seguía apuntando a lo de antes,
   * así que «Añadir» agregaba algo que ya no estaba a la vista.
   */
  onClear?: () => void
  loading?: boolean
  disabled?: boolean
  error?: boolean
  helperText?: string
  /** Ids que ya están en la lista de destino: se ofrecen apagados y con aviso. */
  alreadyIn?: ReadonlySet<string>
  minChars?: number
  limit?: number
  /** Para los buscadores que AÑADEN a una lista: tras elegir, se vacía. */
  clearOnPick?: boolean
}) {
  const { t } = useI18n()

  const cortoAun = term.trim().length < minChars
  // Sin las letras mínimas no se ofrece nada: la consulta ni siquiera ha salido,
  // y enseñar la lista anterior mientras se reescribe induce a elegir mal.
  const visibles = cortoAun ? [] : options
  const tope = !cortoAun && !loading && options.length >= limit

  /** El pie del desplegable, para avisar de que la lista viene recortada. */
  function PaperConTope(props: PaperProps) {
    const { children, ...resto } = props
    return (
      <Paper {...resto} sx={{ borderRadius: `${R.md}px`, ...(resto.sx ?? {}) }}>
        {children}
        {tope && (
          <Typography
            sx={{
              px: 2,
              py: 1,
              fontSize: 12,
              color: 'var(--muted)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {t('picker.capped').replace('{n}', String(limit))}
          </Typography>
        )}
      </Paper>
    )
  }

  return (
    <Autocomplete<PickerOption, false, false, false>
      options={visibles}
      value={value}
      inputValue={term}
      onInputChange={(_, next, reason) => {
        // `reset` es lo que dispara MUI al fijar un valor: si se propagara,
        // borraría el término justo después de elegir y relanzaría la consulta.
        //
        // `blur` es la otra mitad, y con `blurOnSelect` llega SIEMPRE detrás de
        // una elección: MUI vacía el texto al salir del campo. El resultado era
        // un campo en blanco justo después de haber elegido algo —lo elegido
        // seguía vivo por dentro— y nadie puede confiar en un formulario que no
        // enseña lo que tiene.
        if (reason !== 'reset' && reason !== 'blur') onTermChange(next)
      }}
      onChange={(_, option) => {
        if (!option) {
          // MUI manda `null` al pulsar la ✕. Es la única señal de que se ha
          // soltado la elección, y hay que propagarla: si no, el estado de
          // arriba se queda con lo elegido y el campo dice otra cosa.
          onTermChange('')
          onClear?.()
          return
        }
        onPick(option)
        if (clearOnPick) onTermChange('')
      }}
      // El servidor ya filtró. Volver a filtrar aquí escondería resultados.
      filterOptions={(x) => x}
      getOptionLabel={(option) => option.primary}
      isOptionEqualToValue={(option, elegido) => option.id === elegido.id}
      getOptionDisabled={(option) => alreadyIn?.has(option.id) ?? false}
      loading={loading}
      disabled={disabled}
      blurOnSelect
      handleHomeEndKeys
      noOptionsText={
        cortoAun ? t('picker.typeMore').replace('{n}', String(minChars)) : t('picker.noResults')
      }
      loadingText={t('picker.loading')}
      PaperComponent={PaperConTope}
      slotProps={{ listbox: { sx: { maxHeight: 320, py: 0.5 } } }}
      renderOption={(props, option) => {
        // La clave es el ID y NO la que trae MUI, que es la etiqueta: dos marcas
        // que se llaman igual —las hay— chocaban, y React avisaba de que puede
        // duplicar u omitir opciones. Un identificador es único por definición.
        //
        // Se quita del objeto en vez de dejarla pasar: esparcir una `key` dentro
        // del JSX es otro aviso de React, y silenciarlo escondería este.
        const rest = { ...props } as Record<string, unknown>
        delete rest.key
        const yaEsta = alreadyIn?.has(option.id) ?? false
        return (
          <Box
            component="li"
            key={option.id}
            {...rest}
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 1,
              justifyContent: 'space-between',
              px: 1.5,
              py: 0.875,
              '&[aria-selected="true"]': { bgcolor: 'var(--accent-soft)' },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 700 }}>
                {option.primary}
              </Typography>
              {option.secondary && (
                // Monoespaciada porque es un IDENTIFICADOR, no prosa: así se
                // compara de un vistazo entre dos filas parecidas.
                <Typography
                  sx={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {option.secondary}
                </Typography>
              )}
            </Box>
            {yaEsta && (
              <Typography sx={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                {t('picker.already')}
              </Typography>
            )}
          </Box>
        )
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          size="small"
          error={error}
          helperText={helperText}
          slotProps={{ inputLabel: { shrink: true } }}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" sx={{ color: 'var(--muted)' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <>
                {loading && <CircularProgress size={16} sx={{ color: 'var(--muted)' }} />}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  )
}
