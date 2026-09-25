import { Box, Stack } from '@mui/material'
import { THEME_PRESETS } from '@/features/storefront/theme/presets'
import type { ThemePreset } from '@/features/storefront/theme/types'

/**
 * La miniatura de un tema, dibujada con su PROPIA definición (P12).
 *
 * ## Por qué no es una imagen
 *
 * Cuatro capturas de pantalla serían más bonitas y estarían mal el mismo día que
 * alguien cambie un valor de un preset. Una imagen no se entera de que `retail`
 * pasó de cinco columnas a seis, y entonces el comercio elige su tienda mirando
 * algo que ya no existe. Es el mismo argumento que sostiene la vista previa
 * grande desde que se escribió, aplicado al sitio donde se toma la decisión.
 *
 * Aquí se lee `THEME_PRESETS[id]` y se dibuja lo que dice: cuántas columnas,
 * qué proporción de foto, cuánto aire, qué portada, qué categorías, qué barra.
 * Si mañana `premium` pasa a cuatro columnas, esta miniatura pasa a cuatro
 * columnas sin que nadie la toque.
 *
 * ## Qué se dibuja y qué no
 *
 * Se dibuja la SILUETA: proporciones relativas, no píxeles de la tienda. Una
 * miniatura de 150 px no puede enseñar que la portada mide 340 px de alto, pero
 * sí que en `premium` la portada pesa el doble que en `catalog`. Lo que hace
 * comparables las cuatro tarjetas es que las cuatro se dibujan con la misma
 * regla.
 *
 * No lleva texto ni datos de la tienda: es `aria-hidden`, y lo que un lector de
 * pantalla anuncia es el nombre del tema, su descripción y el resumen de
 * diferencias que va al lado — que sí son texto.
 */

/** Cuánto pesa la portada sobre el resto, por variante. */
const ALTO_PORTADA: Record<string, number> = { product: 34, statement: 46 }

/** El aire entre bandas, en píxeles de miniatura. */
const AIRE: Record<string, number> = { compact: 3, comfortable: 5, spacious: 8 }

/** La proporción de la foto de cada tarjeta. */
const PROPORCION: Record<string, string> = {
  square: '1 / 1',
  portrait: '3 / 4',
  landscape: '4 / 3',
}

export function ThemeMiniPreview({ preset }: { preset: ThemePreset }) {
  const definicion = THEME_PRESETS[preset]
  const aire = AIRE[definicion.sectionSpacing] ?? 5
  const columnas = definicion.gridColumns.lg

  return (
    <Box
      aria-hidden
      data-theme-mini={preset}
      sx={{
        display: 'grid',
        gap: `${aire}px`,
        p: `${aire}px`,
        borderRadius: 1,
        border: '1px solid var(--border)',
        bgcolor: 'var(--card)',
        // Alto fijo para que las cuatro se comparen entre sí y no entre lo que
        // cada una decida ocupar. Lo que cambia dentro es el REPARTO.
        height: 132,
        gridTemplateRows: 'auto auto auto 1fr',
        overflow: 'hidden',
      }}
    >
      {/**
       * La barra.
       *
       * `compact` la recorta, que es media razón de ser de Catalog. Y `brand`
       * (V3 · P02) no es «una barra más alta»: es otra composición, con la marca
       * centrada y la navegación en su propia fila. La miniatura lo dibuja como
       * dos franjas, porque es lo que se ve de lejos.
       */}
      {definicion.headerVariant === 'brand' ? (
        <Stack sx={{ gap: `${Math.max(aire - 2, 2)}px`, alignItems: 'center' }}>
          <Box
            sx={{ height: 5, width: '34%', borderRadius: 4, bgcolor: 'var(--accent-soft)' }}
          />
          <Box
            sx={{ height: 3, width: '68%', borderRadius: 4, bgcolor: 'var(--neutral-soft)' }}
          />
        </Stack>
      ) : (
        <Box
          sx={{
            height: definicion.headerVariant === 'compact' ? 6 : 9,
            borderRadius: 0.5,
            bgcolor: 'var(--neutral-soft)',
          }}
        />
      )}

      {/**
       * La portada.
       *
       * `product` enseña producto —una caja grande y una tarjeta al lado—;
       * `statement` es una banda entera con el lema. Son dos árboles distintos
       * en la tienda y aquí son dos siluetas distintas, no dos tonos de gris.
       */}
      {definicion.heroVariant === 'statement' ? (
        <Box
          sx={{
            height: ALTO_PORTADA.statement,
            borderRadius: 0.5,
            bgcolor: 'var(--accent-soft)',
            display: 'grid',
            alignContent: 'center',
            justifyItems: 'center',
            gap: '3px',
            px: 1,
          }}
        >
          <Box sx={{ height: 5, width: '62%', borderRadius: 4, bgcolor: 'var(--accent)' }} />
          <Box sx={{ height: 3, width: '40%', borderRadius: 4, bgcolor: 'var(--accent)', opacity: 0.5 }} />
        </Box>
      ) : (
        <Stack direction="row" sx={{ gap: `${aire}px`, height: ALTO_PORTADA.product }}>
          <Box sx={{ flex: 1, borderRadius: 0.5, bgcolor: 'var(--accent-soft)' }} />
          <Box
            sx={{
              width: '28%',
              borderRadius: 0.5,
              border: '1px solid var(--border)',
              bgcolor: 'var(--card)',
            }}
          />
        </Stack>
      )}

      {/**
       * Las categorías: azulejos, píldoras o mosaico.
       *
       * El mosaico (V3 · P02) reparte tamaños DISTINTOS —la primera familia
       * ocupa el doble— y eso es justo lo que no se puede transmitir con cuatro
       * cajas iguales: azulejos iguales dicen que ninguna manda; un mosaico dice
       * cuál manda.
       */}
      <Stack direction="row" sx={{ gap: `${aire}px` }} data-mini-cats={definicion.categoryVariant}>
        {Array.from({ length: definicion.categoryVariant === 'mosaic' ? 3 : 4 }, (_, i) => (
          <Box
            key={i}
            sx={{
              flex: definicion.categoryVariant === 'mosaic' && i === 0 ? 2 : 1,
              height: definicion.categoryVariant === 'pills' ? 5 : 11,
              borderRadius: definicion.categoryVariant === 'pills' ? 999 : 0.5,
              bgcolor: 'var(--neutral-soft)',
            }}
          />
        ))}
      </Stack>

      {/**
       * La rejilla: tantas columnas como diga el preset.
       *
       * Es la diferencia que más se nota entre `catalog` y `premium` y la que
       * una descripción de una línea no consigue transmitir.
       */}
      <Box
        data-mini-columns={columnas}
        sx={{
          display: 'grid',
          gap: `${aire}px`,
          gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`,
          alignContent: 'start',
        }}
      >
        {Array.from({ length: columnas }, (_, i) => (
          <Stack key={i} sx={{ gap: '2px' }}>
            <Box
              sx={{
                aspectRatio: PROPORCION[definicion.imageRatio] ?? '1 / 1',
                borderRadius: 0.5,
                bgcolor: 'var(--neutral-soft)',
                /**
                 * Lo que distingue a las tres, en lo único que cabe a este
                 * tamaño: el borde.
                 *
                 *  · `comfortable` lo lleva — es una tarjeta con marco;
                 *  · `compact` no, porque el marco se come el ancho útil;
                 *  · `editorial` (V3 · P02) tampoco, y a propósito: suelta el
                 *    recuadro para que mande la fotografía. Se distingue de la
                 *    compacta por el aire de debajo, no por el borde.
                 */
                border:
                  definicion.productCardVariant === 'comfortable'
                    ? '1px solid var(--border)'
                    : 'none',
              }}
            />
            <Box
              sx={{
                height: 2,
                // La editorial pone el texto debajo de la foto con aire, no
                // pegado: es su jerarquía —imagen, nombre, precio— y es lo que
                // la separa de la compacta a este tamaño.
                mt: definicion.productCardVariant === 'editorial' ? '2px' : 0,
                borderRadius: 4,
                bgcolor: 'var(--border)',
              }}
            />
          </Stack>
        ))}
      </Box>
    </Box>
  )
}
