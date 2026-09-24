import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import type { UseFormReturn } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import { R, TS } from '@/theme/tokens'
import {
  VALUE_PROPS_LIMITS,
  VALUE_PROP_COPY,
  VALUE_PROP_ICON_KEYS,
  type StoreValueProp,
  type ValuePropIconKey,
} from '@/features/storefront/valueProps'
import type { StoreFormValues } from './types'

/**
 * Las propuestas de valor de la tienda: hasta cuatro promesas cortas.
 *
 * ## Por qué esta pantalla existe
 *
 * La franja bajo la portada tenía cuatro servicios escritos en el código, y dos
 * afirmaban cosas de un rubro concreto —asesoría farmacéutica— o del local del
 * comercio —retiro en tienda—. Cualquier tienda las anunciaba. Esto es lo que
 * devuelve esas afirmaciones a quien puede hacerlas.
 *
 * ## Por qué va en General y NO en Diseño
 *
 * Porque es CONTENIDO, no disposición. En Diseño se elige cómo se presenta lo
 * que se vende —qué cabecera, cuánto ancho, cuánta foto—; aquí se escribe una
 * promesa comercial, que es de la misma naturaleza que el teléfono de contacto
 * o la descripción de la tienda. Mezclarla con los siete ajustes geométricos
 * del tema habría obligado a bajar por un selector de proporción de imagen para
 * llegar a escribir «Garantía de 12 meses».
 *
 * ## Qué se puede hacer y qué no
 *
 * Se puede elegir el icono de una lista cerrada, escribir el título y una línea
 * de apoyo, ordenar, apagar y quitar. No se puede escribir HTML, ni una URL, ni
 * un color: el título y el apoyo se pintan como TEXTO y los topes de longitud
 * son los del CHECK de la base, no una sugerencia de esta pantalla.
 *
 * ## Y por qué el título llega escrito
 *
 * Al añadir una fila se rellena con la sugerencia neutra de ese icono. Una fila
 * nueva con el título en blanco obliga a inventarse la frase desde cero, y lo
 * que se inventa desde cero se queda sin escribir — que es como se llega a una
 * franja configurable que nadie configuró. La sugerencia es editable y, en
 * cuanto se guarda, la afirma el comercio.
 */
export function ValuePropsSection({
  form,
  busy = false,
}: {
  form: UseFormReturn<StoreFormValues>
  busy?: boolean
}) {
  const { t } = useI18n()
  const propuestas = form.watch('value_props') ?? []

  function guardar(siguiente: readonly StoreValueProp[]) {
    form.setValue('value_props', siguiente, { shouldDirty: true })
  }

  /** El primer icono que esta tienda no esté usando ya. */
  function iconoLibre(): ValuePropIconKey | null {
    const usados = new Set(propuestas.map((prop) => prop.iconKey))
    return VALUE_PROP_ICON_KEYS.find((clave) => !usados.has(clave)) ?? null
  }

  function anadir() {
    const iconKey = iconoLibre()
    if (iconKey === null) return
    guardar([
      ...propuestas,
      {
        iconKey,
        title: t(VALUE_PROP_COPY[iconKey].title),
        body: t(VALUE_PROP_COPY[iconKey].body),
        enabled: true,
      },
    ])
  }

  function cambiar(indice: number, parche: Partial<StoreValueProp>) {
    guardar(propuestas.map((prop, i) => (i === indice ? { ...prop, ...parche } : prop)))
  }

  /**
   * Cambiar el icono no puede producir un duplicado: el CHECK de la base lo
   * rechaza y el formulario también, así que el propio selector deja fuera los
   * que ya están en uso — mejor una opción que no aparece que una que se elige
   * y luego no guarda.
   */
  function cambiarIcono(indice: number, iconKey: ValuePropIconKey) {
    if (propuestas.some((prop, i) => i !== indice && prop.iconKey === iconKey)) return
    cambiar(indice, { iconKey })
  }

  function escribir(indice: number, campo: 'title' | 'body', valor: string) {
    // El apoyo vacío se QUITA en vez de guardarse como cadena vacía: el CHECK
    // exige 1..90 si la clave viene, y «sin apoyo» y «apoyo en blanco» son la
    // misma cosa dicha de dos formas.
    if (campo === 'body' && valor.trim() === '') {
      guardar(
        propuestas.map((prop, i) =>
          i === indice
            ? { iconKey: prop.iconKey, title: prop.title, enabled: prop.enabled }
            : prop,
        ),
      )
      return
    }
    cambiar(indice, { [campo]: valor })
  }

  function mover(indice: number, delta: number) {
    const destino = indice + delta
    if (destino < 0 || destino >= propuestas.length) return
    const copia = [...propuestas]
    const [movida] = copia.splice(indice, 1)
    if (movida) copia.splice(destino, 0, movida)
    guardar(copia)
  }

  function quitar(indice: number) {
    guardar(propuestas.filter((_, i) => i !== indice))
  }

  const lleno = propuestas.length >= VALUE_PROPS_LIMITS.max

  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.valueProps.help')}
      </Typography>

      {/* Sin ninguna configurada se explica QUÉ se está viendo en la tienda. Un
          bloque vacío sin explicación hace pensar que la franja no existe. */}
      {propuestas.length === 0 && (
        <Alert severity="info" icon={false} sx={{ fontSize: TS.label }}>
          {t('settings.valueProps.defaults')}
        </Alert>
      )}

      <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1.5 }}>
        {propuestas.map((propuesta, indice) => {
          const sinTitulo = propuesta.title.trim() === ''
          const nombre = propuesta.title.trim() || t(VALUE_PROP_COPY[propuesta.iconKey].title)

          return (
            <Box
              key={`${propuesta.iconKey}-${indice}`}
              component="li"
              sx={{
                p: 1.5,
                borderRadius: `${R.md}px`,
                border: '1px solid var(--border)',
                bgcolor: 'var(--card)',
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 200px) minmax(0, 1fr) auto' },
                alignItems: 'start',
              }}
            >
              <TextField
                select
                fullWidth
                size="small"
                label={t('settings.valueProps.icon')}
                disabled={busy}
                value={propuesta.iconKey}
                onChange={(event) => cambiarIcono(indice, event.target.value as ValuePropIconKey)}
                inputProps={{ 'aria-label': `${t('settings.valueProps.icon')}: ${nombre}` }}
              >
                {VALUE_PROP_ICON_KEYS.filter(
                  (clave) =>
                    clave === propuesta.iconKey ||
                    !propuestas.some((otra) => otra.iconKey === clave),
                ).map((clave) => (
                  <MenuItem key={clave} value={clave}>
                    {t(VALUE_PROP_COPY[clave].title)}
                  </MenuItem>
                ))}
              </TextField>

              <Stack spacing={1.25} sx={{ minWidth: 0 }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('settings.valueProps.itemTitle')}
                  disabled={busy}
                  error={sinTitulo}
                  helperText={sinTitulo ? t('settings.error.valuePropTitle') : undefined}
                  value={propuesta.title}
                  onChange={(event) => escribir(indice, 'title', event.target.value)}
                  inputProps={{
                    maxLength: VALUE_PROPS_LIMITS.titleMax,
                    'aria-label': `${t('settings.valueProps.itemTitle')}: ${nombre}`,
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label={t('settings.valueProps.itemBody')}
                  disabled={busy}
                  value={propuesta.body ?? ''}
                  onChange={(event) => escribir(indice, 'body', event.target.value)}
                  inputProps={{
                    maxLength: VALUE_PROPS_LIMITS.bodyMax,
                    'aria-label': `${t('settings.valueProps.itemBody')}: ${nombre}`,
                  }}
                />
              </Stack>

              <Stack
                direction="row"
                sx={{ gap: 0.25, alignItems: 'center', justifyContent: 'flex-end' }}
              >
                {/* Cada control dice a qué propuesta pertenece. En una lista de
                    cuatro filas con cuatro botones cada una, dieciséis controles
                    llamados «Subir» no se distinguen de ninguna manera. */}
                <Switch
                  size="small"
                  checked={propuesta.enabled}
                  disabled={busy}
                  onChange={(event) => cambiar(indice, { enabled: event.target.checked })}
                  inputProps={{
                    'aria-label': `${t('settings.valueProps.enabled')}: ${nombre}`,
                  }}
                />
                <IconButton
                  type="button"
                  size="small"
                  disabled={busy || indice === 0}
                  aria-label={`${t('settings.valueProps.up')}: ${nombre}`}
                  onClick={() => mover(indice, -1)}
                >
                  <ArrowUpwardRoundedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  type="button"
                  size="small"
                  disabled={busy || indice === propuestas.length - 1}
                  aria-label={`${t('settings.valueProps.down')}: ${nombre}`}
                  onClick={() => mover(indice, 1)}
                >
                  <ArrowDownwardRoundedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  type="button"
                  size="small"
                  disabled={busy}
                  aria-label={`${t('settings.valueProps.remove')}: ${nombre}`}
                  onClick={() => quitar(indice)}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          )
        })}
      </Stack>

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          type="button"
          size="small"
          startIcon={<AddRoundedIcon />}
          disabled={busy || lleno}
          onClick={anadir}
        >
          {t('settings.valueProps.add')}
        </Button>
        {propuestas.length > 0 && (
          <Button type="button" size="small" disabled={busy} onClick={() => guardar([])}>
            {t('settings.valueProps.reset')}
          </Button>
        )}
        {lleno && (
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {t('settings.valueProps.full')}
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}
