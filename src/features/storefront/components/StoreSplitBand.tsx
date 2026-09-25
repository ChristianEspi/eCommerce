import { Box } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * Una banda partida: el mensaje a un lado y el contenido al otro (V3 · P08).
 *
 * ## Qué problema resuelve, y por qué es una pieza
 *
 * La portada encadenaba título-contenido, título-contenido: el mensaje SIEMPRE
 * encima y el contenido siempre debajo. Con cuatro secciones seguidas, todas se
 * leen como la misma, y una colección que viene con una razón escrita —«Rebajas
 * de fin de temporada · hasta el domingo»— la pierde en un subtítulo gris de
 * dos líneas.
 *
 * Poniéndolos al lado, el mensaje deja de ser un pie y pasa a ser la mitad del
 * argumento. Es la misma composición que piden tres sitios distintos —la banda
 * de rebajados de la portada, un banner del CMS y una colección de productos con
 * copy—, así que vive una vez: tres versiones de dos columnas es cómo se acaba
 * con tres proporciones distintas y una que no se apila bien en el teléfono.
 *
 * ## Las decisiones
 *
 * **En el teléfono se APILA, y el mensaje va primero.** No es un detalle de
 * maquetación: el mensaje explica lo que viene después, así que leerlo antes es
 * el orden correcto. Y dos columnas de 195 px no son dos columnas.
 *
 * **El reparto no es mitad y mitad.** El mensaje pide menos sitio que una
 * rejilla de productos, y dándole la mitad queda una columna de texto con
 * demasiado blanco al lado. `5fr / 7fr` es el mismo reparto que ya usaba la
 * banda de rebajados, que es donde se afinó.
 *
 * **No pone fondo ni color.** La superficie la decide la sección —el marco de
 * P06— o el bloque. Aquí un color sería la plataforma eligiendo un color en la
 * tienda de otro.
 */
export function StoreSplitBand({
  copy,
  content,
  reverse = false,
  label,
}: {
  /** El mensaje: titular, bajada, botón. */
  copy: ReactNode
  /** Lo que se enseña: productos, una foto, una lista. */
  content: ReactNode
  /**
   * El contenido a la izquierda y el mensaje a la derecha.
   *
   * Solo en escritorio: en el teléfono el mensaje sigue yendo primero, porque
   * lo que ordena la lectura ahí es el sentido, no la simetría.
   */
  reverse?: boolean
  /** Nombre accesible, si esta banda ES la sección. */
  label?: string
}) {
  return (
    <Box
      {...(label ? { 'aria-label': label } : {})}
      data-split-band={reverse ? 'reverse' : 'normal'}
      sx={{
        display: 'grid',
        gap: { xs: 2, md: 3 },
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          md: reverse ? '7fr 5fr' : '5fr 7fr',
        },
        alignItems: 'center',
      }}
    >
      <Box
        data-split-part="copy"
        sx={{
          minWidth: 0,
          display: 'grid',
          gap: 1,
          alignContent: 'center',
          // El mensaje primero en el teléfono, a su lado en escritorio.
          order: { xs: 0, md: reverse ? 1 : 0 },
        }}
      >
        {copy}
      </Box>
      <Box
        data-split-part="content"
        sx={{ minWidth: 0, order: { xs: 1, md: reverse ? 0 : 1 } }}
      >
        {content}
      </Box>
    </Box>
  )
}
