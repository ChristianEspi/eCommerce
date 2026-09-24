import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Box, Button, Drawer, IconButton, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'

/**
 * El cajón de filtros del teléfono (Storefront V3 · P09).
 *
 * ## Por qué un cajón y no una pantalla
 *
 * Porque filtrar no es irse a otro sitio: es mirar los mismos resultados con
 * otra pregunta. Una pantalla aparte obliga a volver, y volver es donde se
 * pierde el desplazamiento. El cajón sale de abajo —donde está el pulgar— y
 * deja ver que los resultados siguen ahí detrás.
 *
 * ## Qué aporta `Drawer` de MUI, y por qué no se escribe a mano
 *
 * El foco. Un panel abierto tiene que **atrapar el foco** mientras está abierto
 * y devolverlo al botón al cerrarse, cerrarse con **Escape** y esconder lo de
 * detrás de los lectores de pantalla. Eso es un `role="dialog"` con su gestión
 * de foco, y escribirlo a mano es cómo se acaba con un panel del que no se
 * puede salir con el teclado. `Drawer` ya lo trae probado.
 *
 * ## Las decisiones de esta pieza
 *
 * **Los filtros se aplican al tocarlos, no al pulsar «Aplicar».** El estado vive
 * en la URL y ya funcionaba así: los resultados de detrás cambian mientras se
 * elige. El botón de abajo dice **«Ver resultados»** y cierra, que es lo que de
 * verdad hace; llamarlo «Aplicar» prometería que sin pulsarlo no se aplica nada,
 * y sería mentira.
 *
 * **No se queda a media pantalla.** Hasta un 88 % del alto, con su propio
 * desplazamiento: un catálogo con treinta marcas no cabe en un tercio, y un
 * cajón que se desplaza por dentro es mejor que uno que corta la lista.
 *
 * **No existe en escritorio.** Ahí el panel está a la vista; abrir un cajón
 * sobre un panel visible es tapar la respuesta con la pregunta.
 */
export function StoreFilterDrawer({
  open,
  onClose,
  children,
  resultsLabel,
  onClear,
  canClear,
}: {
  open: boolean
  onClose: () => void
  /** El panel de filtros, tal cual. Aquí no se recorta ninguna opción. */
  children: ReactNode
  /** «24 resultados», ya formateado por quien sabe el singular. */
  resultsLabel: ReactNode
  onClear: () => void
  /** Sin nada puesto, «Quitar filtros» no haría nada: se deshabilita. */
  canClear: boolean
}) {
  const { t } = useI18n()

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      // El cajón vive fuera del árbol de la vitrina, así que sin esto se queda
      // sin los tokens del tema: colores, radios y densidad del comercio.
      PaperProps={{
        className: 'sf-scope',
        'data-filter-drawer': 'true',
        sx: {
          maxHeight: '88vh',
          borderTopLeftRadius: 'var(--sf-radius)',
          borderTopRightRadius: 'var(--sf-radius)',
          bgcolor: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      aria-label={t('store.catalog.filters')}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          borderBottom: '1px solid var(--sf-line)',
          // La cabecera se queda: con la lista desplazándose por dentro, el
          // botón de cerrar tiene que seguir alcanzable.
          position: 'sticky',
          top: 0,
          bgcolor: 'var(--bg)',
          zIndex: 1,
        }}
      >
        <Typography component="h2" sx={{ fontSize: 16, fontWeight: 800 }}>
          {t('store.catalog.filters')}
        </Typography>
        <IconButton onClick={onClose} aria-label={t('common.close')} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box sx={{ overflowY: 'auto', px: 2, py: 1.5, flex: 1 }}>{children}</Box>

      <Stack
        direction="row"
        sx={{
          gap: 1,
          px: 2,
          py: 1.5,
          borderTop: '1px solid var(--sf-line)',
          bgcolor: 'var(--bg)',
          // Y el pie también: es donde está la salida.
          position: 'sticky',
          bottom: 0,
        }}
      >
        <Button
          variant="outlined"
          onClick={onClear}
          disabled={!canClear}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 'var(--sf-pill)', flex: 1 }}
        >
          {t('store.catalog.clear')}
        </Button>
        <Button
          variant="contained"
          onClick={onClose}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 'var(--sf-pill)', flex: 1.4 }}
        >
          {resultsLabel}
        </Button>
      </Stack>
    </Drawer>
  )
}
