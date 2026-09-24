import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { Badge, Box, Button, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'

/** Un filtro puesto, con la forma en que se quita. */
export interface FiltroActivo {
  readonly id: string
  readonly label: string
  readonly onRemove: () => void
}

/**
 * La barra del catálogo: cuántos hay, cómo se ordenan y cómo se filtran.
 *
 * ## El problema que resuelve, y era grave en el teléfono
 *
 * El catálogo ponía el panel de filtros en una columna que en escritorio va al
 * lado y en el teléfono va **encima**: al entrar desde una búsqueda, lo primero
 * que se veía era una lista de marcas y familias con sus interruptores, y los
 * productos empezaban pasada la primera pantalla. Quien busca «jarabe» quiere
 * ver jarabes, no elegir por dónde empezar a filtrar.
 *
 * Aquí el teléfono recibe lo mismo que recibe una tienda de verdad: una barra
 * con **Filtros** y **Ordenar**, y los productos justo debajo. El panel entero
 * sigue existiendo —no se recorta ninguna opción— pero se abre cuando se pide.
 *
 * ## Las decisiones
 *
 * **El contador de filtros va en el botón.** Un botón que dice «Filtros» no
 * distingue entre un catálogo entero y uno con tres filtros puestos, y esa es
 * justo la duda de quien vuelve atrás y no reconoce los resultados.
 *
 * **Las píldoras de lo puesto van DEBAJO, y se quitan de una.** Abrir un cajón
 * para desmarcar una casilla es tres gestos para deshacer uno. En escritorio no
 * se pintan: ahí el panel está a la vista y las píldoras dirían lo mismo dos
 * veces.
 *
 * **Se queda pegada arriba en el teléfono**, bajo la cabecera, porque en una
 * lista de 568 productos el momento de querer ordenar o filtrar llega cuando ya
 * se ha bajado, y volver a subir a por la barra es perder el sitio.
 *
 * **El conteo es el de los RESULTADOS y nada más.** Ni recomendados, ni
 * sugerencias, ni lo que enseñe la salida de abajo: lo que dice el buscador que
 * cumple el filtro.
 */
export function StoreCatalogToolbar({
  count,
  note,
  sortMenu,
  activeFilters,
  onOpenFilters,
  onClearFilters,
}: {
  /** Ya formateado por quien sabe si es «1 resultado» o «24 resultados». */
  count: ReactNode
  /** Aviso sobre el resultado —tolerancia a erratas—, si lo hay. */
  note?: ReactNode
  sortMenu: ReactNode
  activeFilters: readonly FiltroActivo[]
  /** Abre el cajón. Solo se pinta el botón si hay quien lo atienda. */
  onOpenFilters?: () => void
  onClearFilters?: () => void
}) {
  const { t } = useI18n()
  const puestos = activeFilters.length

  return (
    <Stack
      data-catalog-toolbar={puestos}
      sx={{
        gap: 1,
        mb: 2,
        // Pegada arriba SOLO en el teléfono: en escritorio la barra convive con
        // el panel lateral, que ya es pegajoso, y dos cosas pegadas a la vez
        // dejan la rejilla mirando por una rendija.
        position: { xs: 'sticky', md: 'static' },
        top: { xs: 'var(--sf-anchor-offset, 96px)' },
        zIndex: 2,
        // El fondo es obligatorio: sin él, los productos pasan por detrás.
        bgcolor: 'var(--bg)',
        py: { xs: 1, md: 0 },
      }}
    >
      <Stack
        direction="row"
        sx={{ gap: 1.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography
            aria-live="polite"
            sx={{
              fontSize: TS.label,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}
          >
            {count}
          </Typography>
          {note}
        </Stack>

        <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
          {onOpenFilters ? (
            <Badge
              badgeContent={puestos}
              color="primary"
              // El cero no se pinta: un globo con un cero es ruido.
              invisible={puestos === 0}
              sx={{ display: { md: 'none' } }}
            >
              <Button
                variant="outlined"
                size="small"
                startIcon={<TuneRoundedIcon fontSize="small" />}
                onClick={onOpenFilters}
                aria-label={
                  puestos > 0
                    ? `${t('store.catalog.filters')} (${puestos} ${t('store.catalog.filtersActive')})`
                    : t('store.catalog.filters')
                }
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 'var(--sf-pill)',
                  borderColor: puestos > 0 ? 'var(--accent)' : 'var(--sf-line-strong)',
                  color: puestos > 0 ? 'var(--accent-deep)' : 'var(--text)',
                }}
              >
                {t('store.catalog.filters')}
              </Button>
            </Badge>
          ) : null}
          {sortMenu}
        </Stack>
      </Stack>

      {/* Lo puesto, y cómo se quita. Solo en el teléfono: ver arriba. */}
      {puestos > 0 ? (
        <Stack
          direction="row"
          data-active-filters={puestos}
          sx={{ gap: 0.75, flexWrap: 'wrap', display: { md: 'none' } }}
        >
          {activeFilters.map((filtro) => (
            /**
             * Un BOTÓN, y su nombre dice lo que hace: «Quitar Mesas».
             *
             * La primera versión era un `Chip` con su aspa, y el nombre
             * accesible que quedaba era «Mesas» — el mismo que la píldora de la
             * barra de familias, que hace lo contrario: una pone el filtro y
             * esta lo quita. Dos controles con el mismo nombre y efectos
             * opuestos en la misma pantalla no se distinguen ni con un lector
             * de pantalla ni con el teclado.
             */
            <Box
              key={filtro.id}
              component="button"
              type="button"
              onClick={filtro.onRemove}
              aria-label={`${t('store.catalog.removeFilter')} ${filtro.label}`}
              data-active-filter={filtro.id}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                height: 28,
                px: 1.25,
                borderRadius: 'var(--sf-pill)',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: TS.label,
                fontWeight: 700,
                bgcolor: 'var(--accent-soft)',
                color: 'var(--accent-deep)',
                border: '1px solid var(--accent)',
                '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
              }}
            >
              {filtro.label}
              <CloseRoundedIcon aria-hidden sx={{ fontSize: 15 }} />
            </Box>
          ))}
          {onClearFilters && puestos > 1 ? (
            <Box
              component="button"
              type="button"
              onClick={onClearFilters}
              sx={{
                border: 'none',
                bgcolor: 'transparent',
                cursor: 'pointer',
                px: 1,
                fontSize: TS.label,
                fontWeight: 800,
                color: 'var(--muted)',
                textDecoration: 'underline',
              }}
            >
              {t('store.catalog.clear')}
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  )
}
