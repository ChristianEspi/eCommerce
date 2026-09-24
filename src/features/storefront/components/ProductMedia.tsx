import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import { Box } from '@mui/material'
import { R } from '@/theme/tokens'
import { tintFor } from '../tint'

/**
 * Imagen de producto con un hueco que parece INTENCIONADO.
 *
 * El catálogo casi nunca llega con todas las fotos puestas, y el bucket es
 * privado, así que una firma caducada también deja el `src` vacío. Lo que se
 * pinta entonces no puede ser —y hasta P07 era— un rectángulo gris con un icono
 * de imagen en medio: eso es exactamente lo que dibuja un esqueleto de carga, y
 * media rejilla así se lee como una tienda que no terminó de cargar.
 *
 * ## Qué se pinta ahora
 *
 * Un panel con el tinte que le toca al NOMBRE del producto —los mismos seis
 * tintes de orientación que usan las puertas de categoría y las marcas— y el
 * icono como marca de agua grande en la esquina, que es la misma gramática que
 * el resto de la vitrina. Se lee como una pieza diseñada, no como un fallo.
 *
 * El tinte sale del nombre y no al azar: el mismo producto cae siempre en el
 * mismo color, así que una rejilla sin fotos se puede recorrer —cada hueco
 * tiene sitio propio— y recargar no lo baraja.
 *
 * ## Lo que sigue sin pintarse
 *
 * Ni un logotipo, ni una imagen de archivo, ni una marca de agua de la suite:
 * nada que le ponga a la tienda una identidad que no eligió. Los tintes son
 * señalización, no marca — el acento del comercio sigue siendo el único color
 * de acción.
 */
export function ProductMedia({
  url,
  alt,
  ratio = '1 / 1',
  sizePx = 28,
  eager = false,
  fit = 'cover',
}: {
  url: string | null
  alt: string
  /** `1 / 1` en la rejilla; `4 / 3` en la ficha, donde hay más ancho. */
  ratio?: string
  sizePx?: number
  /** La primera imagen de la ficha se carga sin `lazy`: es lo que se ve. */
  eager?: boolean
  /**
   * Cómo encaja la foto en su caja.
   *
   *  - `cover` en la REJILLA: recorta, y ese recorte es lo que mantiene todas
   *    las tarjetas del mismo tamaño. Una rejilla con fotos de proporciones
   *    distintas se lee como una tabla mal cuadrada.
   *  - `contain` en la FICHA: ahí se ha venido a mirar el producto, y recortarlo
   *    esconde justo lo que se quería ver. Se nota sobre todo con lo que no es
   *    una foto de estudio —un logotipo apaisado, una imagen con márgenes—: con
   *    `cover` sale ampliado y descentrado, y parece un fallo de la tienda.
   */
  /**
   * Cómo encaja la foto. Además de los dos literales acepta una VARIABLE de CSS
   * (Storefront V3 · P02): así la decisión la toma el tema en la frontera
   * —`--sf-media-fit`— y este componente no tiene que preguntar qué tema hay
   * puesto. Sigue habiendo reserva, por si la variable no existe.
   */
  fit?: 'cover' | 'contain' | (string & {})
}) {
  const tinte = tintFor(alt)

  return (
    <Box
      data-media={url ? 'photo' : 'placeholder'}
      sx={{
        position: 'relative',
        aspectRatio: ratio,
        width: '100%',
        // Con foto, el gris de siempre: solo se ve el instante anterior a que
        // la imagen pinte. Sin foto, el tinte del producto.
        ...(url
          ? { bgcolor: 'var(--neutral-soft)', color: 'var(--muted)' }
          : {
              background: `linear-gradient(150deg, ${tinte.bg} 0%, color-mix(in srgb, ${tinte.fg} 10%, ${tinte.bg}) 100%)`,
              color: tinte.fg,
            }),
        borderRadius: `${R.md}px`,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {url ? (
        <Box
          component="img"
          src={url}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          sx={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            // Centrada de verdad: con `contain` el hueco sobrante se reparte a
            // los dos lados en vez de quedarse todo abajo.
            objectPosition: 'center',
            display: 'block',
          }}
        />
      ) : (
        <>
          {/* Marca de agua: el mismo icono, enorme y casi transparente en la
              esquina. Es lo que convierte el hueco en una pieza con intención
              en vez de en un esqueleto que no terminó. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              right: '-8%',
              bottom: '-12%',
              opacity: 0.14,
              pointerEvents: 'none',
              lineHeight: 0,
            }}
          >
            <ImageRoundedIcon sx={{ fontSize: sizePx * 3.2 }} />
          </Box>
          <ImageRoundedIcon sx={{ position: 'relative', fontSize: sizePx, opacity: 0.7 }} aria-hidden />
        </>
      )}
    </Box>
  )
}
