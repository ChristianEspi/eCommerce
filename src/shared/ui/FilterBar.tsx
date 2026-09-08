import FilterAltOffRoundedIcon from '@mui/icons-material/FilterAltOffRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Card, IconButton, Stack, Tooltip } from '@mui/material'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'

/**
 * Barra de filtros de un listado.
 *
 * Los controles sueltos sobre el fondo de la pagina no se leen como un grupo:
 * parecen tres cosas que casualmente estan cerca. En su propia tarjeta se leen
 * como «esto acota la tabla de abajo», que es lo que son.
 *
 * **No admite un panel multi-campo a proposito.** La regla de suite es un
 * buscador general mas tabs de estado, no una fila de cajas por columna: con
 * seis campos nadie sabe cual rellenar y el resultado vacio no dice cual sobra.
 * Este componente coloca los controles que le pasen, y quien lo use se atiene a
 * esa regla.
 *
 * ## Dos zonas, y la barra decide donde va cada una
 *
 * Izquierda lo que ACOTA (buscador, selects, interruptores), derecha lo que
 * HACE (crear, exportar, limpiar). La separacion la impone la barra y no el
 * orden en que llegan los hijos: antes el boton primario se pasaba como un hijo
 * mas y quedaba pegado al ultimo filtro; si ademas el buscador llevaba `flex:1`
 * —lo hacia media docena de modulos— ese `flex` competia con el espaciador y se
 * repartian el hueco a partes iguales, dejando el boton flotando en mitad de la
 * barra.
 *
 * Por eso los filtros van en su propio grupo SIN crecer (`flex: '0 1 auto'`):
 * un `flex: 1` de un hijo ya solo reparte dentro de ese grupo, nunca contra las
 * acciones. Y las acciones se anclan con `ml: 'auto'`, que en una barra sin
 * nadie creciendo se lleva todo el hueco libre. Consecuencia practica: **el
 * boton primario va en `actions`, nunca como hijo**, y un filtro que quiera
 * ancho lo pide con `minWidth`, no con `flex`.
 *
 * `onClear` solo aparece cuando hay algo que limpiar: un boton que no hace nada
 * ensena a no pulsarlo.
 *
 * ## Actualizar vive AQUI y no en cada pantalla
 *
 * Treinta y cuatro listados usan esta barra, y ninguno tenia forma de releer sus
 * datos sin recargar el navegador entero — que ademas pierde el filtro escrito.
 * Cablearlo pantalla por pantalla serian treinta y cuatro `refetch` distintos y
 * treinta y cuatro sitios donde uno se queda sin poner.
 *
 * Se invalida lo que esta MONTADO (`invalidateQueries` sin filtro): quien mira
 * un listado tiene en pantalla las consultas de ese listado, asi que «todo lo
 * activo» y «lo que estoy viendo» son la misma cosa. No hay que saber el nombre
 * de ninguna clave, y una consulta nueva queda cubierta el dia que nace.
 */
export function FilterBar({
  children,
  actions,
  onClear,
  disableGutter = false,
}: {
  children: ReactNode
  /** Crear, exportar y demas: ancladas a la derecha, separadas de los filtros. */
  actions?: ReactNode
  onClear?: () => void
  /** Cuando quien llama ya separa sus bloques (un `Stack` con `gap`): sin él,
   *  el margen propio se suma al del contenedor y la barra queda flotando. */
  disableGutter?: boolean
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const fetching = useIsFetching() > 0

  return (
    <Card sx={{ p: 1.5, mb: disableGutter ? 0 : 2 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 1.25, flexWrap: 'wrap', rowGap: 1.25 }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 1.25,
            flexWrap: 'wrap',
            rowGap: 1.25,
            // Sin crecer: lo que un filtro pida con `flex` se reparte aqui
            // dentro y no contra las acciones de la derecha.
            flex: '0 1 auto',
            minWidth: 0,
          }}
        >
          {children}
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexShrink: 0, ml: 'auto' }}>
          {/* El giro es la única señal de que pulsar hizo algo: los datos suelen
              volver iguales, y sin movimiento el botón parece roto. */}
          <Tooltip title={t('common.refresh')}>
            <IconButton
              size="small"
              onClick={() => void queryClient.invalidateQueries()}
              aria-label={t('common.refresh')}
              sx={{
                color: 'var(--muted)',
                '@keyframes girar': { to: { transform: 'rotate(360deg)' } },
                ...(fetching
                  ? {
                      // Quien pide menos movimiento no recibe un icono girando
                      // sin parar; el estado sigue diciéndose por el color.
                      '@media (prefers-reduced-motion: no-preference)': {
                        animation: 'girar 900ms linear infinite',
                      },
                      color: 'var(--accent-deep)',
                    }
                  : {}),
              }}
            >
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {onClear && (
            <Tooltip title={t('common.filters.clear')}>
              <IconButton
                size="small"
                onClick={onClear}
                aria-label={t('common.filters.clear')}
                sx={{ color: 'var(--muted)' }}
              >
                <FilterAltOffRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {actions}
        </Stack>
      </Stack>
    </Card>
  )
}
