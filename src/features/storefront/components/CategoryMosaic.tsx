import { Box } from '@mui/material'
import { CategoryDoor, type CategoryDoorItem } from './CategoryDoors'

/**
 * Las familias en MOSAICO (Storefront V3 · P07).
 *
 * ## Qué aporta sobre los azulejos
 *
 * Los azulejos reparten la atención a partes iguales: cuatro puertas del mismo
 * tamaño dicen «estas cuatro cosas valen lo mismo». Es la respuesta correcta
 * cuando ninguna familia manda, y es la que sigue teniendo Universal.
 *
 * Un mosaico dice **cuál manda**. La primera familia ocupa el doble de área, y
 * eso es lo que convierte una fila de puertas en una portada editorial: hay una
 * entrada principal y las demás la acompañan.
 *
 * ## Lo que NO cambia
 *
 * El ORDEN de los datos. La primera del mosaico es la primera que el comercio
 * ordenó en su catálogo: reordenar aquí para que «quede mejor» sería decidir por
 * él cuál es su familia principal.
 *
 * Y el contenido de cada puerta: es el mismo `CategoryDoor` de los azulejos, con
 * su foto si la hay, su tinte de orientación si no, su icono y su enlace con el
 * filtro. Un mosaico con otro tipo de puerta serían dos componentes que hay que
 * arreglar dos veces.
 *
 * ## Y por qué el teléfono no lleva mosaico
 *
 * Porque en 390 px de ancho, «el doble de área» es una puerta que ocupa media
 * pantalla y dos que no se leen. El mosaico es una composición de escritorio:
 * en el teléfono vuelve a la rejilla de dos columnas, que es legible. Copiar la
 * composición de escritorio a 390 px es el error clásico de los mosaicos.
 */

/**
 * Cómo se reparte el mosaico según cuántas familias hay.
 *
 * Con una o dos no hay mosaico posible —una sola puerta «destacada» sobre nada
 * no destaca— así que se dejan iguales. De tres en adelante, la primera manda.
 *
 * El tope es seis: un mosaico de diez piezas deja de tener jerarquía y se
 * convierte en una cuadrícula irregular. Lo que pase de seis se queda fuera del
 * mosaico, y la sección sigue teniendo su enlace al catálogo.
 */
const TOPE_MOSAICO = 6

export function CategoryMosaic({
  categories,
  storeSlug,
  ariaLabel,
}: {
  categories: readonly CategoryDoorItem[]
  storeSlug: string
  ariaLabel?: string
}) {
  const visibles = categories.slice(0, TOPE_MOSAICO)
  const destacada = visibles.length >= 3

  return (
    <Box
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      data-category-mosaic={visibles.length}
      sx={{
        display: 'grid',
        gap: { xs: 1.25, md: 2 },
        /**
         * Dos columnas en el teléfono —rejilla legible, sin mosaico— y cuatro en
         * escritorio, que es lo que permite que una pieza ocupe dos sin dejar
         * huecos.
         */
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(4, minmax(0, 1fr))',
        },
        // Filas de alto igual: sin esto, la pieza destacada estira su fila y las
        // pequeñas de al lado se deforman.
        gridAutoRows: { md: 'minmax(150px, auto)' },
      }}
    >
      {visibles.map((category, indice) => (
        <Box
          key={category.category_id}
          data-mosaic-cell={indice === 0 && destacada ? 'lead' : 'follow'}
          sx={{
            display: 'flex',
            minWidth: 0,
            // La primera ocupa dos columnas y dos filas: el doble de área en
            // las dos direcciones, que es lo que se lee como jerarquía. Solo en
            // escritorio.
            ...(indice === 0 && destacada
              ? { gridColumn: { md: 'span 2' }, gridRow: { md: 'span 2' } }
              : {}),
          }}
        >
          <CategoryDoor category={category} storeSlug={storeSlug} />
        </Box>
      ))}
    </Box>
  )
}
