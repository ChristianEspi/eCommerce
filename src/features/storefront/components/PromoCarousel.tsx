import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, Button, Card, IconButton, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { SectionHeading } from './SectionHeading'
import { moneyCorto, offerBadge, vigenciaTexto } from '../offer'
import type { StorePromotion } from '../promotions'

/** Cada cuánto pasa sola. Seis segundos: lo que se tarda en leer un cartel. */
const INTERVALO_MS = 6000

/**
 * Las ofertas vigentes, pasando solas.
 *
 * Tres campañas apiladas ocupan tres pantallas y solo se ve la primera; en
 * carrusel ocupan una y se ven las tres. El precio de esa decisión es que el
 * contenido se mueve sin que nadie lo pida, así que aquí se paga entero:
 *
 *  · **se para al pasar el ratón y al recibir el foco** — nada se escapa
 *    mientras se está leyendo o tabulando;
 *  · **no se mueve si el sistema pide menos movimiento** (`prefers-reduced-
 *    motion`): quien marcó esa preferencia lo hizo por algo, y entonces el
 *    carrusel es una lista que se pasa a mano;
 *  · **todas las láminas están en el DOM**, las ocultas con `aria-hidden`: un
 *    lector de pantalla las recorre por los puntos, no por el tiempo.
 */
export function PromoCarousel({
  promotions,
  storeSlug,
  currency,
  assets = {},
}: {
  promotions: readonly StorePromotion[]
  storeSlug: string
  currency: string
  /**
   * Rutas de `store-assets` ya firmadas, como las que recibe el contenido
   * del CMS.
   *
   * Firmar AQUI seria mas corto y esta descartado: este componente no pide
   * datos, los pinta. La pagina ya firma un lote para el CMS y este entra
   * en el mismo, que ademas evita dos peticiones para el mismo bucket.
   */
  assets?: Record<string, string>
}) {
  const { t } = useI18n()
  const [actual, setActual] = useState(0)
  const [parado, setParado] = useState(false)
  // Hacia donde va, para que la lamina entre por el lado del que viene. Una
  // transicion que siempre entra por la derecha contradice a «anterior»: se
  // pulsa para volver y el movimiento dice que se avanza.
  const [sentido, setSentido] = useState(1)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const total = promotions.length
  const ir = useCallback(
    (indice: number) => {
      setSentido(indice < actual ? -1 : 1)
      setActual(((indice % total) + total) % total)
    },
    [total, actual],
  )

  useEffect(() => {
    // Una sola oferta no es un carrusel: no hay a dónde pasar.
    if (total <= 1 || parado) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const id = window.setInterval(() => {
      setSentido(1)
      setActual((i) => (i + 1) % total)
    }, INTERVALO_MS)
    return () => window.clearInterval(id)
  }, [total, parado])

  // Si el comercio retira campañas mientras la pestaña está abierta, el índice
  // puede quedar apuntando a una lámina que ya no existe.
  useEffect(() => {
    if (actual >= total) setActual(0)
  }, [actual, total])

  if (total === 0) return null

  const promo = promotions[actual]
  if (!promo) return null

  return (
    <Stack
      component="section"
      // Destino del enlace «Ofertas» de la barra de navegación. `scroll-margin`
      // porque la cabecera es pegajosa: sin él, el salto deja el título debajo
      // de la cabecera y parece que no ha ido a ninguna parte.
      id="ofertas"
      aria-roledescription="carousel"
      aria-label={t('store.promos.title')}
      ref={contenedor}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      onFocusCapture={() => setParado(true)}
      onBlurCapture={(event) => {
        if (!contenedor.current?.contains(event.relatedTarget as Node | null)) setParado(false)
      }}
      sx={{ gap: 1.25, scrollMarginTop: 96 }}
    >
      {/* El nombre de la seccion era una versalita de 12 px: en una portada que
          ya lleva titulares grandes, eso se lee como el pie de la fila anterior
          y no como el principio de esta. Ahora es un titular como los demas. */}
      <SectionHeading
        title={t('store.promos.title')}
        action={
          total > 1 ? (
            <Stack direction="row" sx={{ gap: 0.5 }}>
              <IconButton
                size="small"
                aria-label={t('store.promos.prev')}
                onClick={() => ir(actual - 1)}
                sx={{ border: '1px solid var(--sf-line)', bgcolor: 'var(--card)' }}
              >
                <ChevronLeftRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                aria-label={t('store.promos.next')}
                onClick={() => ir(actual + 1)}
                sx={{ border: '1px solid var(--sf-line)', bgcolor: 'var(--card)' }}
              >
                <ChevronRightRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          ) : undefined
        }
      />

      {/* Los fotogramas viven aquí, no en la lámina: son dos nombres fijos y
          no una animación distinta por render. */}
      <Box
        sx={{
          position: 'relative',
          '@keyframes sfPromoDesdeDerecha': {
            from: { opacity: 0, transform: 'translateX(28px)' },
            to: { opacity: 1, transform: 'translateX(0)' },
          },
          '@keyframes sfPromoDesdeIzquierda': {
            from: { opacity: 0, transform: 'translateX(-28px)' },
            to: { opacity: 1, transform: 'translateX(0)' },
          },
        }}
      >
        {promotions.map((item, indice) => (
          <Box
            key={item.id}
            aria-hidden={indice === actual ? undefined : true}
            sx={
              indice === actual
                ? {
                    // La lámina que entra ES la que acaba de recibir esta
                    // clase, y por eso la animación se dispara sola: el
                    // elemento no la tenía en el render anterior. Sin cambiar
                    // de elemento no habría transición que ver.
                    animation: `${
                      sentido < 0 ? 'sfPromoDesdeIzquierda' : 'sfPromoDesdeDerecha'
                    } .42s cubic-bezier(.22,.61,.36,1) both`,
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                  }
                : // Fuera de la vista pero en el DOM: así el alto no salta al
                  // pasar de una lámina corta a una larga.
                  { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }
            }
          >
            <PromoSlide
              promo={item}
              storeSlug={storeSlug}
              currency={currency}
              imageSrc={fuenteDe(item.imageUrl, assets)}
            />
          </Box>
        ))}
      </Box>

      {total > 1 ? (
        <Stack direction="row" sx={{ gap: 0.75, justifyContent: 'center' }}>
          {promotions.map((item, indice) => (
            <Box
              key={item.id}
              component="button"
              type="button"
              aria-label={t('store.promos.goTo').replace('{name}', item.name)}
              aria-current={indice === actual ? 'true' : undefined}
              onClick={() => ir(indice)}
              sx={{
                border: 0,
                p: 0,
                cursor: 'pointer',
                height: 6,
                width: indice === actual ? 22 : 6,
                borderRadius: 999,
                transition: 'width .2s ease, background-color .2s ease',
                bgcolor: indice === actual ? 'var(--accent-deep)' : 'var(--sf-line-strong)',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

/**
 * Una oferta, con la misma anatomía que la tarjeta de campaña del CMS:
 * **cuánto** (el medallón), **de qué** (nombre y frase) y **hasta cuándo**.
 */
/**
 * De la referencia guardada a algo que un `<img>` pueda cargar.
 *
 * Una ruta del bucket solo sirve firmada, y la firma llega despues que la
 * fila: hasta que llega se devuelve `null` y no la ruta en crudo, porque una
 * ruta en el `src` es una peticion segura al dominio de la tienda que siempre
 * termina en 404.
 */
function fuenteDe(referencia: string | null, firmadas: Record<string, string>) {
  if (!referencia) return null
  if (/^https?:\/\//i.test(referencia)) return referencia
  return firmadas[referencia] ?? null
}

function PromoSlide({
  promo,
  storeSlug,
  currency,
  imageSrc,
}: {
  promo: StorePromotion
  storeSlug: string
  currency: string
  imageSrc: string | null
}) {
  const { t, locale } = useI18n()
  const badge = offerBadge(promo, t, locale, currency)
  const vigencia = vigenciaTexto(promo.endsAt, t, locale)

  /**
   * A dónde lleva.
   *
   * A los productos que ALCANZA la promoción cuando se sabe —su categoría o su
   * marca—; al catálogo cuando la campaña es de pedido entero. Un botón que
   * lleva a una lista donde no se ve la oferta es peor que no ponerlo.
   */
  const destino = promo.categorySlug
    ? `/s/${storeSlug}?c=${encodeURIComponent(promo.categorySlug)}`
    : promo.brandCode
      ? `/s/${storeSlug}?b=${encodeURIComponent(promo.brandCode)}`
      : `/s/${storeSlug}`

  return (
    <Card
      sx={{
        p: 0,
        overflow: 'hidden',
        display: 'flex',
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
        bgcolor: 'var(--card)',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ width: '100%', alignItems: 'stretch', minWidth: 0 }}
      >
        {/* La CARA de la oferta, a sangre y recortando.
            Antes era una miniatura de 132×96 con `contain` sobre un gris: la
            foto salía con dos franjas vacías a los lados y el resto de la
            tarjeta era un descampado blanco entre el medallón, el texto y un
            botón pegado al borde derecho. Una oferta que ocupa el ancho de la
            página y no enseña nada en 200 px no se mira.

            `cover` y no `contain` porque esto NO es la foto de un producto —ahí
            recortar borra el envase, y por eso la ficha usa `contain`—: es la
            imagen de una campaña, y de una campaña lo que se quiere es que
            llene. */}
        <Box
          sx={{
            position: 'relative',
            flexShrink: 0,
            overflow: 'hidden',
            width: { xs: '100%', sm: 236, md: 268 },
            // Alto FIJO, no mínimo.
            //
            // Con `minHeight` la caja no tenía altura definida, así que el
            // `height: 100%` de la foto se resolvía a `auto` y la imagen se
            // pintaba a su proporción natural: una foto vertical estiraba la
            // tarjeta a 340 px y el texto se quedaba flotando en el centro de
            // un rectángulo enorme. El marco lo pone la tarjeta y la foto se
            // recorta dentro, que es justo para lo que está el `cover`.
            height: { xs: 168, sm: 184 },
            bgcolor: 'var(--sf-media-bg)',
          }}
        >
          {imageSrc ? (
            <Box
              component="img"
              src={imageSrc}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            // Sin foto no se deja el hueco: el medallón se hace grande y ocupa
            // ese sitio. Una campaña sin imagen tiene que seguir pareciendo una
            // tarjeta y no una tarjeta rota.
            <Stack
              aria-hidden
              sx={{
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                color: 'var(--accent-deep)',
                background:
                  'linear-gradient(150deg, color-mix(in srgb, var(--accent) 16%, var(--card)) 0%, color-mix(in srgb, var(--accent2) 12%, var(--card)) 100%)',
              }}
            >
              <LocalOfferRoundedIcon sx={{ fontSize: 40, opacity: 0.6 }} />
              {badge ? (
                <Typography sx={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em' }}>
                  {badge}
                </Typography>
              ) : null}
            </Stack>
          )}

          {/* El cuánto, SOBRE la foto y no en una casilla aparte.
              Es el mismo distintivo que llevan las tarjetas de producto
              rebajado: el comprador ya sabe leerlo, y colocarlo encima de la
              imagen ahorra la tercera columna que dejaba el hueco del medio. */}
          {imageSrc && badge ? (
            <Box
              sx={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                px: 1.5,
                py: 0.5,
                borderRadius: 'var(--sf-pill)',
                bgcolor: 'var(--accent-deep)',
                color: '#FFFFFF',
                fontSize: 20,
                fontWeight: 900,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                boxShadow: 'var(--sf-shadow-hover)',
              }}
            >
              {badge}
            </Box>
          ) : null}
        </Box>

        <Stack
          sx={{
            flex: 1,
            minWidth: 0,
            gap: 0.75,
            p: { xs: 2, md: 2.75 },
            justifyContent: 'center',
          }}
        >
          {/* Hasta cuándo, ARRIBA y en versalitas.
              Es lo que decide si se entra ahora o luego, y abajo entre dos
              líneas grises no lo leía nadie. En rojo del acento solo cuando
              queda poco: si urge siempre, no urge nunca. */}
          {vigencia ? (
            <Typography
              sx={{
                fontSize: TS.label,
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: vigencia.urgente ? 'var(--accent-deep)' : 'var(--muted)',
              }}
            >
              {vigencia.texto}
            </Typography>
          ) : null}

          {/* Dos líneas como mucho, igual que la descripción: el comercio
              escribe el nombre de la campaña y uno largo —«Semana Mamá y Bebé:
              20 % en fórmulas infantiles»— estiraba la tarjeta y, con ella, el
              alto del carrusel entero. Lo que no cabe en dos líneas no es un
              titular, es un párrafo. */}
          <Typography
            component="h3"
            sx={{
              fontSize: { xs: 20, md: 25 },
              fontWeight: 800,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {promo.name}
          </Typography>

          {promo.description ? (
            <Typography
              sx={{
                fontSize: TS.body,
                color: 'var(--muted)',
                maxWidth: '62ch',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {promo.description}
            </Typography>
          ) : null}

          {/* El botón DEBAJO del texto y no al final de la fila: pegado al
              borde derecho quedaba a media pantalla de lo que lo justifica, y
              entre medias no había nada. */}
          <Stack
            direction="row"
            sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.75 }}
          >
            <Button
              component={Link}
              to={destino}
              variant="contained"
              sx={{
                flexShrink: 0,
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: 'var(--sf-pill)',
                px: 2.5,
                py: 1,
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              }}
            >
              {t('store.promos.see')}
            </Button>

            {promo.minSubtotal ? (
              <Typography sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--muted)' }}>
                {t('store.content.offer.minSubtotal').replace(
                  '{amount}',
                  moneyCorto(promo.minSubtotal, currency, locale),
                )}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </Stack>
    </Card>
  )
}
