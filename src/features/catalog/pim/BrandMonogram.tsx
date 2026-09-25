import { Box } from '@mui/material'
import { initials } from '@/shared/lib/initials'
import { R } from '@/theme/tokens'

/**
 * Las iniciales de una marca, para cuando no hay logo.
 *
 * ## Por qué esto y no un rectángulo gris
 *
 * Una tabla de cuarenta marcas sin logo con cuarenta rectángulos grises es una
 * columna que no aporta nada y encima parece que algo no cargó. Con dos letras,
 * cada fila se distingue y —lo importante— el backoffice enseña **lo mismo que
 * verá el comprador**: la vitrina también cae al monograma. Quien administra la
 * tienda ve el respaldo real, no una promesa de imagen.
 *
 * ## Qué comparte con la vitrina y qué no
 *
 * Las LETRAS: `initials` vive en `shared/lib` justo para que no haya dos
 * cálculos de lo mismo. El COLOR no: la vitrina usa sus tintes de orientación
 * (`--sf-tint-*`, que solo existen dentro de `.sf-scope`) y aquí manda el acento
 * de suite. Repetir los tintes en el backoffice obligaría a mantener dos copias
 * de la misma paleta.
 */
export function BrandMonogram({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: `${R.sm}px`,
        bgcolor: 'var(--accent-soft)',
        color: 'var(--accent-deep)',
        fontWeight: 800,
        // Proporcional al hueco: a tamaño fijo, las letras de un monograma de
        // 104 px se ven perdidas dentro de la caja.
        fontSize: Math.max(10, Math.round(size * 0.36)),
        letterSpacing: '0.02em',
        lineHeight: 1,
      }}
    >
      {initials(name)}
    </Box>
  )
}
