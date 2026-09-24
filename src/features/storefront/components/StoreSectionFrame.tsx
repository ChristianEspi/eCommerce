import { Box } from '@mui/material'
import type { ReactNode } from 'react'
import type { ResolvedPresentation } from '../theme/presentation'

/**
 * El marco de una sección de la portada (Storefront V3 · P06).
 *
 * ## Qué hace, y por qué es una pieza y no un `sx` repetido
 *
 * Dos cosas: pone la superficie —el fondo sobre el que va la sección— y decide
 * si la sección llega al ancho del contenido o al de la ventana.
 *
 * Lo segundo es la razón de que exista. Sacar una sección a sangre dentro de un
 * contenedor centrado se hace con un truco —`margin-inline: calc(50% - 50vw)`—
 * que es fácil de escribir y fácil de escribir mal: con `100vw` en vez de `50vw`
 * aparece una barra de desplazamiento horizontal en cuanto hay barra vertical,
 * porque `vw` incluye el ancho de esa barra. Repetido en seis secciones, es
 * cuestión de tiempo que una de las seis lo tenga mal, y la tienda entera se
 * arrastre de lado por una de ellas.
 *
 * Aquí está escrito una vez, con su defensa:
 *
 *  · el margen negativo usa `50%` y `50vw`, que es la forma que no suma el ancho
 *    de la barra dos veces;
 *  · el marco recorta lo que se le salga (`overflow-x: clip`), así que un
 *    descuido de un píxel dentro de una sección no puede empujar la página;
 *  · y `clip` y no `hidden`, porque `hidden` convierte la caja en contenedor de
 *    desplazamiento y eso **rompe** la cabecera pegajosa y los anclas de
 *    navegación.
 *
 * ## Lo que NO hace
 *
 * No elige la presentación —eso lo resolvió el tema— ni pinta contenido. Y no
 * acepta un color: `soft` y `contrast` son relaciones con el acento del tenant,
 * porque el color sigue siendo 100 % suyo (contrato §4.4).
 */

/** Los tres fondos, como relación con el acento del tenant. Nunca un color suelto. */
const SUPERFICIE: Record<ResolvedPresentation['surface'], string | undefined> = {
  plain: undefined,
  // Un tinte del acento: separa la banda del fondo sin competir con las fotos.
  soft: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
  // Con peso, para la banda que tiene que romper el ritmo de la portada.
  contrast: 'color-mix(in srgb, var(--accent) 14%, var(--card))',
}

export function StoreSectionFrame({
  presentation,
  sectionId,
  children,
}: {
  presentation: ResolvedPresentation
  /** Para poder mirar en el DOM qué sección se pintó con qué ritmo. */
  sectionId: string
  children: ReactNode
}) {
  const aSangre = presentation.width === 'bleed'
  const fondo = SUPERFICIE[presentation.surface]

  /**
   * Sin superficie y sin sangre no hay marco.
   *
   * Es el caso de casi todas las secciones de casi todas las tiendas —`plain` y
   * `contained` son los defectos— y envolverlas en un `div` extra sería añadir
   * trece nodos a la portada para no hacer nada. Los atributos de datos van al
   * hijo por el mismo motivo: se resuelven en la sección, que ya tiene el suyo.
   */
  if (!aSangre && !fondo) return <>{children}</>

  return (
    <Box
      data-section-frame={sectionId}
      data-section-width={presentation.width}
      data-section-surface={presentation.surface}
      sx={{
        ...(fondo ? { bgcolor: fondo } : {}),
        ...(aSangre
          ? {
              /**
               * A sangre: el fondo llega a los bordes de la ventana y el
               * contenido se queda dentro del ancho del contenido.
               *
               * `50%` y `50vw` —y no `100vw`— es lo que evita la barra de
               * desplazamiento horizontal cuando hay barra vertical.
               */
              marginInline: 'calc(50% - 50vw)',
              paddingInline: 'calc(50vw - 50%)',
              // Y el recorte, que es la red de seguridad: un descuido de un
              // píxel dentro no puede arrastrar la página entera.
              overflowX: 'clip',
            }
          : {}),
        // El aire vertical solo donde hay fondo: sin él, la banda se pega al
        // contenido de arriba y de abajo y deja de leerse como una banda.
        ...(fondo ? { py: { xs: 'var(--sf-section-gap)', md: 'var(--sf-section-gap-md)' } } : {}),
      }}
    >
      {children}
    </Box>
  )
}
