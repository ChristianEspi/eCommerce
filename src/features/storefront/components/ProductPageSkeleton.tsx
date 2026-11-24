import { Box, Card, Skeleton, Stack } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useT } from '@/shared/i18n/i18n-context'
import { R } from '@/theme/tokens'

/**
 * Esqueleto de la ficha de producto (P15-SaaS).
 *
 * Sustituye al `LoadingState` genérico —un aro girando centrado— por la MISMA
 * retícula que la ficha real: galería a la izquierda, columna de compra a la
 * derecha, y en móvil una encima de otra. La diferencia no es estética: el
 * `LoadingState` ocupa unos 120 px de alto y la ficha ocupa la pantalla, así
 * que al llegar los datos la página daba un salto de varios cientos de píxeles
 * —el mismo desplazamiento de diseño que la fase se propone quitar—.
 *
 * `aria-busy` con el texto de carga en un `aria-live`: quien no ve la pantalla
 * necesita que le digan que hay algo en camino; las cajas grises no le dicen
 * nada. Y el propio esqueleto va `aria-hidden` para que no se lean veinte
 * huecos vacíos uno por uno.
 */
export function ProductPageSkeleton() {
  const t = useT()

  return (
    <Stack sx={{ gap: { xs: 2.5, md: 4 } }} aria-busy data-testid="product-skeleton">
      {/* `visuallyHidden`: en `sx`, `width: 1` es 100 %, no 1 px (2026-11-24). */}
      <Box sx={visuallyHidden}>
        <span role="status" aria-live="polite">
          {t('common.loading')}
        </span>
      </Box>

      {/* Migas + «volver», la misma fila que la ficha real. */}
      <Stack aria-hidden direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Skeleton variant="rounded" width={220} height={20} />
        <Skeleton variant="rounded" width={120} height={32} />
      </Stack>

      <Box
        aria-hidden
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 4 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        {/* Las dos mitades van en tarjeta, como en la ficha: si el esqueleto se
            dibuja sobre el fondo desnudo y luego aparecen dos tarjetas, la
            pagina cambia de forma justo cuando termina de cargar. */}
        <Card sx={{ p: { xs: 1.5, md: 2 } }}>
          <Skeleton
            variant="rectangular"
            sx={{ width: '100%', aspectRatio: '4 / 3', borderRadius: `${R.md}px` }}
          />
        </Card>

        <Card sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack sx={{ gap: 1.25 }}>
            {/* Marca, nombre y disponibilidad. El PRECIO no se dibuja: es la
                unica cifra de la ficha, y un rectangulo gris del tamano de un
                precio se lee como un precio que todavia no se sabe. Prefiere
                el hueco: cuando llega, llega y ya esta. */}
            <Skeleton width="30%" height={14} />
            <Skeleton width="80%" height={34} />
            <Skeleton width="25%" height={18} />
            <Skeleton variant="rounded" width={220} height={40} sx={{ mt: 1 }} />
          </Stack>
        </Card>
      </Box>

      {/* Panel de descripcion y datos. */}
      <Card aria-hidden sx={{ p: { xs: 2, md: 3 } }}>
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 2, md: 4 },
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
          }}
        >
          <Stack sx={{ gap: 1 }}>
            <Skeleton width="35%" height={22} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="95%" height={14} />
            <Skeleton width="60%" height={14} />
          </Stack>
          <Stack sx={{ gap: 1 }}>
            <Skeleton width="55%" height={22} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="100%" height={14} />
          </Stack>
        </Box>
      </Card>
    </Stack>
  )
}
