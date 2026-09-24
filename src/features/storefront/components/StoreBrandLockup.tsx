import { Box, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { R, TS } from '@/theme/tokens'
import { initials } from '../branding'
import { resolveBrandLockup } from '../identity'

/**
 * La marca de la tienda en la cabecera (Storefront V3 · P03).
 *
 * ## Por qué es una pieza y no tres cabeceras
 *
 * Las tres composiciones de cabecera —`standard`, `compact`, `brand`— enseñan la
 * MISMA marca con distinto protagonismo. Si cada una pintara su propio logotipo,
 * el día que el lockup gane un cuarto modo habría que acertar en tres sitios, y
 * el primero que se olvidara dejaría una tienda con el nombre duplicado.
 *
 * Aquí se resuelve una vez: qué se enseña (`resolveBrandLockup`) y con qué
 * tamaño (`size`). La composición decide el tamaño; nunca el contenido.
 *
 * ## El caso que de verdad importaba
 *
 * La mayoría de los logotipos comerciales **ya llevan el nombre dentro**. Hasta
 * V3 la cabecera pintaba logotipo *y* nombre siempre, así que esas tiendas
 * enseñaban su nombre dos veces, uno al lado del otro. Con `logo` se pinta solo
 * el logotipo; y si no hay logotipo, se enseña el nombre en vez de dejar el
 * hueco — esa corrección vive en `resolveBrandLockup`, del lado que pinta.
 */
export function StoreBrandLockup({
  store,
  storeSlug,
  size = 'md',
  center = false,
}: {
  store: {
    readonly name: string
    readonly logo_url?: string | null
    readonly brand_lockup?: string | null
  }
  /**
   * La tienda a la que lleva al pulsarlo.
   *
   * Cadena VACÍA = no lleva a ningún sitio y se pinta sin enlace. Lo usa la
   * vista previa del backoffice (V3 · P13): allí el lockup se mira, no se
   * navega, y un enlace a la vitrina dentro del taller sacaría al comercio de
   * la pantalla que está configurando.
   */
  storeSlug: string
  /**
   * Cuánto protagonismo le da la composición.
   *
   * `lg` es el de la cabecera de marca, donde el logotipo es el argumento de la
   * primera pantalla. `sm` es el de la compacta, donde lo que manda es el
   * buscador y la marca solo tiene que identificar la tienda.
   */
  size?: 'sm' | 'md' | 'lg'
  /** La de marca lo centra; las otras dos lo alinean a la izquierda. */
  center?: boolean
}) {
  const tieneLogo = Boolean(store.logo_url)
  const lockup = resolveBrandLockup(store.brand_lockup, tieneLogo)

  const altura = { sm: 26, md: 30, lg: 40 }[size]
  const anchoMaximo = { sm: 132, md: 160, lg: 240 }[size]
  const cuerpo = { sm: 14, md: 15, lg: 19 }[size]

  return (
    <Box
      {...(storeSlug ? { component: Link, to: `/s/${storeSlug}` } : {})}
      data-brand-lockup={lockup}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: center ? 'center' : 'flex-start',
        gap: 1.25,
        textDecoration: 'none',
        color: 'inherit',
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      {lockup !== 'name' && store.logo_url && (
        <Box
          component="img"
          src={store.logo_url}
          // El logotipo ES el nombre accesible del enlace cuando va solo; con el
          // nombre al lado sería repetirlo, y un lector de pantalla anunciaría
          // «Botica del Centro Botica del Centro».
          alt={lockup === 'logo' ? store.name : ''}
          {...(lockup === 'logo' ? {} : { 'aria-hidden': true })}
          sx={{ height: altura, maxWidth: anchoMaximo, objectFit: 'contain' }}
        />
      )}

      {lockup === 'name' && !tieneLogo && (
        // Sin logotipo: iniciales sobre el acento del tenant. Neutro y suyo, en
        // vez de plantar el isotipo de la suite como si fuera su marca.
        <Box
          aria-hidden
          sx={{
            width: altura + 4,
            height: altura + 4,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: `${R.sm}px`,
            bgcolor: 'var(--accent-soft)',
            color: 'var(--accent-deep)',
            fontWeight: 800,
            fontSize: TS.label,
          }}
        >
          {initials(store.name)}
        </Box>
      )}

      {lockup !== 'logo' && (
        <Typography
          component="span"
          sx={{
            fontWeight: 800,
            fontSize: cuerpo,
            letterSpacing: size === 'lg' ? '-0.02em' : undefined,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {store.name}
        </Typography>
      )}
    </Box>
  )
}
