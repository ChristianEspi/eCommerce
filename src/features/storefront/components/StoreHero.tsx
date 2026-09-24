import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useT } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { resolveHeroKicker } from '../identity'
import type { PublicStore } from '../types'

/**
 * La portada EDITORIAL: la marca primero, el catálogo después.
 *
 * ## Qué es y qué no
 *
 * Es la composición que el contrato llama `heroVariant: 'statement'`. Hasta
 * V2 · P04 no se podía elegir —existía solo como reserva de
 * `StoreFeaturedHero`, cuando el catálogo no tenía nada rebajado—; desde
 * entonces es una de las dos portadas que el comercio elige, y la diferencia
 * con la otra es de composición, no de relleno:
 *
 *  · `product` abre con UN producto: foto, precio antes, precio ahora, botón de
 *    comprar. Vende por la oferta concreta.
 *  · `statement` (esto) abre con la MARCA: una imagen, el lema del comercio a
 *    cuerpo grande y dos puertas —el catálogo y, si hay algo rebajado, las
 *    ofertas—.
 *
 * ## Por qué aquí NO hay precios
 *
 * Porque el precio de un producto se resuelve con lista de precios, canal,
 * promociones y condiciones comerciales de la sesión. Hacerlo dos veces, en dos
 * componentes, es cómo se llega a una portada que anuncia un precio que el
 * carrito no respeta. El enlace a ofertas es un ENLACE: lleva al catálogo
 * filtrado, y allí manda el mismo resolvedor de siempre.
 *
 * ## Los respaldos visuales, en orden (Storefront V3 · P04)
 *
 * Hasta V3 eran dos: banner o degradado. Una tienda con catálogo y sin banner
 * —que es la mayoría el primer día— abría con un rectángulo de color, y eso se
 * lee como una tienda a medio montar aunque tenga quinientas fotos dentro.
 *
 *   1. `banner_url`, si el comercio subió uno. Manda siempre.
 *   2. **Collage de 1 a 3 fotos reales** de productos publicados. Salen de datos
 *      que la portada YA cargó: ni una consulta más.
 *   3. La foto de una familia, si alguna tiene.
 *   4. El degradado del acento del tenant, como último recurso.
 *
 * Los tres primeros son fotos que el comercio subió. Ninguno es una imagen de
 * archivo ni una marca ajena: si no hay fotos, se enseña color, no un almacén
 * de stock que no es suyo.
 *
 * ## Y la regla de no repetirse
 *
 * Hasta V3 el antetítulo pintaba SIEMPRE el nombre de la tienda y el titular
 * caía al nombre cuando no había `hero_title`. Resultado: el nombre dos veces,
 * uno encima del otro, en toda tienda que no hubiera escrito un lema.
 *
 * Ahora el antetítulo es el `hero_kicker` que el comercio escribió; si no
 * escribió ninguno, es el nombre **solo cuando el titular dice otra cosa**. Y la
 * bajada es su `hero_subtitle`, sin reserva: la plataforma no redacta copy
 * comercial en la tienda de nadie.
 */

/** Cuántas fotos caben en el collage sin que deje de leerse como una imagen. */
const TOPE_COLLAGE = 3

export function StoreHero({
  store,
  storeSlug,
  hasOffers = false,
  media = [],
  categoryImage = null,
}: {
  store: PublicStore
  /**
   * Para construir los enlaces. Opcional para no romper a quien ya montaba
   * este componente sin él —una prueba, la reserva de otra sección—: sin slug
   * no hay adónde enlazar y la portada se queda solo con su lema.
   */
  storeSlug?: string
  /**
   * ¿Hay algo rebajado ahora mismo? Lo sabe la página, que ya lo consultó para
   * su banda de ofertas. Aquí NO se vuelve a preguntar: una segunda consulta
   * para decidir si se pinta un botón es una petición por visita.
   */
  hasOffers?: boolean
  /**
   * Fotos de producto YA firmadas, para el collage (Storefront V3 · P04).
   *
   * Llegan resueltas desde la portada, que las tiene cargadas para sus filas.
   * Este componente no consulta nada: decorar el hero no puede costar una
   * petición por visita, y menos una por foto.
   */
  media?: readonly string[]
  /** La foto de una familia, si alguna tiene. Mismo origen: ya cargada. */
  categoryImage?: string | null
}) {
  const t = useT()

  const title = store.hero_title?.trim() || store.name
  const kicker = resolveHeroKicker(store.hero_kicker)
  /**
   * El nombre como antetítulo solo si NO se repite.
   *
   * Con kicker manda el kicker. Sin kicker, el nombre sirve de contexto —«en qué
   * tienda estoy»— pero únicamente si el titular dice otra cosa; si el titular
   * ES el nombre, escribirlo encima es la misma palabra dos veces.
   */
  const eyebrow = kicker !== '' ? kicker : title !== store.name ? store.name : ''
  // Sin reserva: si el comercio no escribió bajada, no hay bajada.
  const subtitle = store.hero_subtitle?.trim() ?? ''

  const collage = media.filter((url) => url.trim() !== '').slice(0, TOPE_COLLAGE)

  /**
   * De dónde sale el fondo, en el orden de respaldo. `data-hero-media` lo
   * declara en el DOM para que sea comprobable sin mirar píxeles.
   */
  const fondo: 'banner' | 'collage' | 'category' | 'gradient' = store.banner_url
    ? 'banner'
    : collage.length > 0
      ? 'collage'
      : categoryImage
        ? 'category'
        : 'gradient'

  const imagenAsangre = fondo === 'banner' ? store.banner_url : fondo === 'category' ? categoryImage : null

  return (
    <Box
      component="section"
      aria-label={title}
      // Qué composición y con qué respaldo. Es lo que hace comprobables
      // `heroVariant` y la cadena de respaldos sin comparar capturas.
      data-hero-variant="statement"
      data-hero-media={fondo}
      sx={{
        position: 'relative',
        borderRadius: 'var(--sf-radius)',
        overflow: 'hidden',
        background: imagenAsangre ? 'var(--neutral-soft)' : 'var(--hero-grad)',
        minHeight: { xs: 'var(--sf-hero-min)', md: 'var(--sf-hero-min-md)' },
        display: 'flex',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      {imagenAsangre ? (
        <>
          <Box
            component="img"
            src={imagenAsangre}
            alt=""
            aria-hidden
            // Lo primero que se ve de la portada, y por tanto el candidato a
            // LCP: se pide con prioridad alta y sin `lazy`. Las miniaturas del
            // catálogo, que van debajo, sí son perezosas.
            loading="eager"
            fetchPriority="high"
            decoding="async"
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {/* Degradado vertical en vez de velo plano: garantiza el contraste AA
              donde va el texto sin apagar la foto entera. No controlamos qué
              imagen sube el tenant, así que el suelo es opaco de verdad. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.78) 100%)',
            }}
          />
        </>
      ) : (
        /* Halo del acento del tenant sobre el degradado de suite. Da profundidad
           sin introducir un solo color que no sea suyo. */
        <>
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(120% 90% at 85% 15%, color-mix(in srgb, var(--accent) 55%, transparent) 0%, transparent 60%)',
              mixBlendMode: 'screen',
              opacity: 0.85,
            }}
          />
          {/* Texto blanco tambien sin foto: negro sobre el verde del degradado
              era el peor contraste de la portada. El velo garantiza el suelo
              con cualquier acento del tenant. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(6,20,16,0.25) 0%, rgba(6,20,16,0.55) 60%, rgba(6,20,16,0.72) 100%)',
            }}
          />
        </>
      )}

      {/**
       * El reparto: texto a sangre sobre la imagen, o texto y collage en dos
       * columnas (Storefront V3 · P04).
       *
       * Con banner o foto de familia el texto va ENCIMA, porque la imagen es de
       * la tienda y está pensada para eso. Con collage no: son fotos de producto
       * sobre fondo claro, y poner texto blanco encima las estropea y no se lee.
       * Ahí el collage se coloca al lado —debajo en el teléfono, donde el texto
       * y el botón van primero—.
       */}
      <Box
        sx={{
          position: 'relative',
          flex: 1,
          display: 'grid',
          gap: { xs: 2, md: 3 },
          alignItems: 'end',
          gridTemplateColumns:
            fondo === 'collage' ? { xs: '1fr', md: 'minmax(0, 1.05fr) minmax(0, 1fr)' } : '1fr',
          p: { xs: 'var(--sf-hero-pad)', md: 'var(--sf-hero-pad-md)' },
        }}
      >
        <Stack sx={{ gap: 1.25, maxWidth: 680, color: '#FFFFFF', minWidth: 0 }}>
          {eyebrow !== '' && (
            <Typography
              data-hero-kicker={kicker !== '' ? 'merchant' : 'store-name'}
              sx={{
                fontSize: TS.label,
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                opacity: 0.75,
              }}
            >
              {eyebrow}
            </Typography>
          )}
          <Typography
            component="h1"
            sx={{
              // Escala fluida: llena la portada en escritorio sin desbordar en
              // móvil, que es donde compra el canal B2C.
              fontSize: { xs: 'var(--sf-hero-title)', md: 'var(--sf-hero-title-md)' },
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              textWrap: 'balance',
            }}
          >
            {title}
          </Typography>
          {subtitle !== '' && (
            <Typography
              sx={{
                fontSize: { xs: TS.bodyStrong, md: 17 },
                lineHeight: 1.55,
                maxWidth: 560,
                opacity: 0.92,
              }}
            >
              {subtitle}
            </Typography>
          )}

          {/* Las puertas. Sin ellas, la portada editorial era un cartel bonito
              del que no se salía: había que bajar hasta la primera fila para
              entrar al catálogo. La de ofertas solo aparece si hay algo
              rebajado — un botón que lleva a una lista vacía es peor que no
              tenerlo. */}
          {storeSlug && (
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', rowGap: 1, mt: 0.5 }}>
              <Button
                component={Link}
                to={`/s/${storeSlug}?ver=todo`}
                variant="contained"
                endIcon={<ArrowForwardRoundedIcon />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 'var(--sf-pill)',
                  px: 2.25,
                  // Blanco sobre el velo y tinta al revés: es el único par que
                  // garantiza contraste con cualquier foto y con cualquier
                  // acento del tenant.
                  bgcolor: '#FFFFFF',
                  color: 'var(--accent-deep)',
                  boxShadow: 'none',
                  '&:hover': { bgcolor: '#FFFFFF', boxShadow: 'none' },
                }}
              >
                {t('store.hero.browseCatalog')}
              </Button>
              {hasOffers && (
                <Button
                  component={Link}
                  to={`/s/${storeSlug}?oferta=1`}
                  variant="outlined"
                  startIcon={<LocalOfferRoundedIcon />}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: 'var(--sf-pill)',
                    px: 2,
                    color: '#FFFFFF',
                    borderColor: 'color-mix(in srgb, #FFFFFF 70%, transparent)',
                    '&:hover': {
                      borderColor: '#FFFFFF',
                      bgcolor: 'color-mix(in srgb, #FFFFFF 12%, transparent)',
                    },
                  }}
                >
                  {t('store.hero.seeOffers')}
                </Button>
              )}
            </Stack>
          )}
        </Stack>

        {fondo === 'collage' && <HeroCollage urls={collage} />}
      </Box>
    </Box>
  )
}

/**
 * El collage: de una a tres fotos reales del catálogo (Storefront V3 · P04).
 *
 * ## Por qué cambia de forma con el número
 *
 * Porque una foto estirada al ancho de dos no es una composición, es una foto
 * mal encajada. Con una se pinta una sola pieza alta; con dos, dos columnas; con
 * tres, una grande y dos apiladas al lado — que es la forma en que tres imágenes
 * de proporciones distintas se leen como un conjunto.
 *
 * Es el mismo criterio que sigue la portada desde V2 · P06 con las filas de
 * producto: la composición se adapta a cuánto hay, en vez de dejar huecos donde
 * debería haber contenido.
 *
 * ## Y por qué son decorativas
 *
 * Porque no son enlaces ni identifican nada: el nombre de cada producto está en
 * el catálogo, a un botón de distancia. Anunciarlas con `alt` obligaría a quien
 * usa un lector de pantalla a escuchar tres nombres de producto antes de llegar
 * al botón «Ver catálogo», que es lo que la portada quiere que se pulse.
 */
function HeroCollage({ urls }: { urls: readonly string[] }) {
  const [primera, ...resto] = urls

  return (
    <Box
      aria-hidden
      data-hero-collage={urls.length}
      sx={{
        display: 'grid',
        gap: 1,
        // Con tres, la primera manda: una columna ancha y dos piezas apiladas.
        gridTemplateColumns: urls.length >= 3 ? 'minmax(0, 1.4fr) minmax(0, 1fr)' : `repeat(${urls.length}, minmax(0, 1fr))`,
        alignSelf: 'stretch',
        minHeight: { xs: 160, md: 0 },
      }}
    >
      <Foto url={primera as string} destacada={urls.length >= 3} />
      {resto.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateRows: `repeat(${resto.length}, minmax(0, 1fr))`,
          }}
        >
          {resto.map((url) => (
            <Foto key={url} url={url} />
          ))}
        </Box>
      )}
    </Box>
  )
}

function Foto({ url, destacada = false }: { url: string; destacada?: boolean }) {
  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 'var(--sf-radius-sm)',
        overflow: 'hidden',
        bgcolor: '#FFFFFF',
        minHeight: destacada ? { xs: 160, md: 220 } : { xs: 76, md: 104 },
      }}
    >
      <Box
        component="img"
        src={url}
        alt=""
        aria-hidden
        // La primera del collage compite con el titular por ser el LCP, así que
        // no es perezosa; las demás sí.
        loading={destacada ? 'eager' : 'lazy'}
        decoding="async"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          // `contain` y no `cover`: son fotos de producto, casi siempre sobre
          // fondo claro, y recortarlas se come justo lo que identifica la
          // referencia. Aquí no manda `--sf-media-fit` —eso es de la tarjeta—
          // porque un collage recortado deja de enseñar productos.
          objectFit: 'contain',
          p: 0.75,
        }}
      />
    </Box>
  )
}
