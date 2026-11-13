import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { R, T } from '@/theme/tokens'

/**
 * Cabecera de pantalla.
 *
 * La pastilla del icono no es adorno: en una app de dieciséis secciones que se
 * parecen entre sí —tablas con cabecera gris y botones a la derecha— es la
 * única pista de en cuál estás sin leer el título. Va en el acento del tenant,
 * que es lo que le da a cada cliente su color sin repintar nada más.
 *
 * El icono es decorativo (`aria-hidden`): el `h1` de al lado ya nombra la
 * pantalla, y anunciarlo dos veces es ruido.
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  center,
  actions,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  /** Navegación de la pantalla (tabs) en la misma fila del título: ocupa el
   *  hueco libre y se centra en él. En móvil baja debajo del título. */
  center?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}
    >
      <Stack direction="row" spacing={1.75} sx={{ alignItems: 'center', minWidth: 0 }}>
        {icon && (
          <Box
            aria-hidden
            sx={{
              width: 46,
              height: 46,
              flexShrink: 0,
              borderRadius: `${R.lg}px`,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'var(--accent)',
              color: '#fff',
              boxShadow: 'var(--shadow-lg)',
              '& .MuiSvgIcon-root': { fontSize: 24 },
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h1"
            sx={{ fontSize: T.pageTitle, fontWeight: 800, letterSpacing: '-0.4px' }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ color: 'var(--muted)', mt: 0.25, fontSize: T.body }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Stack>
      {center && <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>{center}</Box>}
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  )
}
