import { Box } from '@mui/material'
import { useState } from 'react'
import { initials } from '@/shared/lib/initials'
import { tintFor } from '../tint'

/**
 * El logo de una marca en la vitrina, con su respaldo.
 *
 * ## Una sola implementación para los dos sitios
 *
 * Lo usan «Compra por marca» (`BrandRow`) y el cierre de la portada
 * (`BrandTrustStrip`). Tener la misma decisión escrita dos veces significa que
 * un día una de las dos arregla el respaldo y la otra no, y la misma marca se
 * ve de dos formas en la misma página.
 *
 * ## Las tres decisiones, y las tres son concretas
 *
 * **`object-fit: contain`, nunca `cover`.** Un logo no se recorta: `cover` en un
 * logotipo apaisado le corta los lados y lo que queda es un trozo de letra,
 * peor que no enseñarlo. La foto de un producto sí se recorta —ahí importa
 * llenar el hueco—; un logo, no.
 *
 * **Hueco de tamaño FIJO.** El alto no depende de la imagen que subió cada
 * quien: sin esto, una fila de marcas con un logo cuadrado y otro panorámico
 * cambia de alto al cargar, y eso es desplazamiento de contenido (CLS) en la
 * primera pantalla de la tienda.
 *
 * **`onError` cae al monograma.** Una firma caducada, un objeto borrado a mano o
 * una URL externa que el CSP bloquea dejarían el icono roto del navegador en
 * medio de la portada. Con el respaldo, la fila sigue leyéndose.
 *
 * ## Y por qué el respaldo son dos letras y no un icono genérico
 *
 * Porque una fila de doce marcas con el mismo icono de etiqueta no se recorre:
 * ninguna se distingue de la de al lado. Con las iniciales sobre el tinte que
 * le toca a su nombre —el mismo tinte siempre, asignado por el nombre— cada
 * marca tiene sitio propio y se vuelve a encontrar por el rabillo del ojo.
 */
export function BrandLogo({
  name,
  url,
  size,
  marco = 'tarjeta',
}: {
  name: string
  /** URL ya firmada, o `null` si la marca no tiene logo. */
  url: string | null
  size: number
  /**
   * Cómo se enmarca el logo (Storefront V3 · P07).
   *
   * `tarjeta` es el de siempre: hueco con fondo de tarjeta y línea alrededor.
   * Es lo correcto dentro de una tarjeta de marca, donde el logo es un dato más
   * junto al nombre y la cuenta, y la línea lo separa de ellos.
   *
   * `limpio` quita la línea y el fondo. Lo pide el muro de logotipos: un muro
   * es reconocimiento, y doce recuadros de 1 px alrededor de doce identidades
   * ajenas convierten el muro en una tabla. El hueco sigue siendo del mismo
   * tamaño y el logo sigue `contain` — lo que se va es la caja, no la
   * protección contra el estirado ni contra el salto de contenido.
   *
   * Lo que NO hace `limpio` es tocar los colores del archivo: si el logotipo
   * trae su propio fondo, ese fondo se ve. Recortarlo o pasarlo a monocromo
   * sería editar la identidad de un tercero.
   */
  marco?: 'tarjeta' | 'limpio'
}) {
  const [roto, setRoto] = useState(false)
  const tinte = tintFor(name)
  const limpio = marco === 'limpio'

  if (url && !roto) {
    return (
      <Box
        aria-hidden
        sx={{
          width: size,
          height: size,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--sf-radius-sm)',
          // Fondo de la tarjeta y no el tinte: un logo viene casi siempre sobre
          // blanco, y ponerlo sobre un pastel lo deja con un halo cuadrado.
          // En el muro no hay caja: el azulejo ya da el aire, y la línea sobraba.
          bgcolor: limpio ? 'transparent' : 'var(--card)',
          border: limpio ? 'none' : '1px solid var(--sf-line)',
          overflow: 'hidden',
          p: limpio ? 0 : 0.5,
        }}
      >
        {/* Un `<img>` de verdad y no `Box component="img"`: MUI se queda
            `width` y `height` como atajos de su sistema de estilos y no llegan
            al DOM, y son justo los dos atributos que le dicen al navegador
            cuánto sitio reservar antes de descargar la imagen. Sin ellos, la
            fila de marcas se mueve al cargar. */}
        <img
          src={url}
          alt=""
          // Perezosa: las marcas van a media portada y más abajo, así que no
          // compiten con la imagen del hero por el ancho de banda.
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          onError={() => setRoto(true)}
        />
      </Box>
    )
  }

  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        bgcolor: tinte.fg,
        color: tinte.bg,
        fontSize: Math.max(10, Math.round(size * 0.35)),
        fontWeight: 800,
        letterSpacing: '0.02em',
        lineHeight: 1,
        boxShadow: `0 6px 16px -8px ${tinte.fg}`,
      }}
    >
      {initials(name)}
    </Box>
  )
}
