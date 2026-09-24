import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useT } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import type { PublicStore } from '../types'

/**
 * La portada EDITORIAL: la marca primero, el catálogo después.
 *
 * ## Qué es y qué no, desde Storefront V2 · P04
 *
 * Es la composición que el contrato llama `heroVariant: 'statement'`, y hasta
 * P04 no se podía elegir: existía solo como RESERVA de
 * `StoreFeaturedHero` —se pintaba cuando el catálogo no tenía nada rebajado—.
 * Un tema podía declarar `statement` y no pasaba nada.
 *
 * Ahora es una de las dos portadas que el comercio elige, y la diferencia con
 * la otra es de composición, no de padding:
 *
 *  · `product` abre con UN producto: foto, precio antes, precio ahora, botón de
 *    comprar. Vende por la oferta concreta.
 *  · `statement` (esto) abre con la MARCA: una imagen a sangre o el degradado
 *    del acento, el lema del comercio a cuerpo grande y dos puertas —el
 *    catálogo y, si hay algo rebajado, las ofertas—.
 *
 * ## Por qué aquí NO hay precios
 *
 * A propósito, y el contrato de P04 lo pide con esas palabras: «no duplicar
 * lógica de pricing ni promociones dentro del hero». El precio de un producto
 * se resuelve con lista de precios, canal, promociones y condiciones
 * comerciales de la sesión; hacerlo dos veces, en dos componentes, es cómo se
 * llega a una portada que anuncia un precio que el carrito no respeta. El enlace
 * a ofertas es un ENLACE: lleva al catálogo filtrado y allí manda el mismo
 * resolvedor de siempre.
 *
 * ## Los fallbacks, en orden
 *
 *   · sin `banner_url` → degradado de tokens (`--hero-grad`), que ya lleva el
 *     acento del tenant; nunca una foto de archivo ni una marca ajena.
 *   · sin `hero_title` → el nombre de la tienda.
 *   · sin `hero_subtitle` → una frase neutra de suite.
 *
 * El peso visual lo dan capas de color y tipografía, NO colores nuevos: el
 * acento sigue siendo 100 % del tenant (contrato §4.4). Sobre el degradado se
 * superpone un halo radial con el mismo acento y una viñeta inferior; sobre una
 * foto, un degradado vertical en vez de un velo plano, que oscurece donde está
 * el texto y deja respirar la parte alta de la imagen.
 *
 * Sin animación de entrada: es lo primero que se ve y un fundido solo retrasa
 * la lectura (y molesta con `prefers-reduced-motion`).
 */
export function StoreHero({
  store,
  storeSlug,
  hasOffers = false,
}: {
  store: PublicStore
  /**
   * Para construir los enlaces. Opcional para no romper a quien ya montaba
   * este componente sin él —una prueba, la reserva de otra sección—: sin slug
   * no hay adónde enlazar y la portada se queda solo con su lema, que es
   * exactamente lo que hacía antes de P04.
   */
  storeSlug?: string
  /**
   * ¿Hay algo rebajado ahora mismo? Lo sabe la página, que ya lo consultó para
   * su banda de ofertas. Aquí NO se vuelve a preguntar: una segunda consulta
   * para decidir si se pinta un botón es una petición por visita.
   */
  hasOffers?: boolean
}) {
  const t = useT()
  const title = store.hero_title?.trim() || store.name
  const subtitle = store.hero_subtitle?.trim() || t('store.hero.fallbackSubtitle')
  const hasImage = Boolean(store.banner_url)

  return (
    <Box
      component="section"
      aria-label={title}
      // La marca de qué composición se está pintando. Es lo que hace que
      // `heroVariant` sea comprobable sin mirar píxeles.
      data-hero-variant="statement"
      sx={{
        position: 'relative',
        borderRadius: 'var(--sf-radius)',
        overflow: 'hidden',
        background: hasImage ? 'var(--neutral-soft)' : 'var(--hero-grad)',
        minHeight: { xs: 'var(--sf-hero-min)', md: 'var(--sf-hero-min-md)' },
        display: 'flex',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      {hasImage ? (
        <>
          <Box
            component="img"
            src={store.banner_url ?? undefined}
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

      <Stack
        sx={{
          position: 'relative',
          justifyContent: 'flex-end',
          gap: 1.25,
          p: { xs: 'var(--sf-hero-pad)', md: 'var(--sf-hero-pad-md)' },
          maxWidth: 680,
          color: '#FFFFFF',
        }}
      >
        <Typography
          sx={{
            fontSize: TS.label,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            opacity: 0.75,
          }}
        >
          {store.name}
        </Typography>
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

        {/* Las puertas. Sin ellas, la portada editorial era un cartel bonito
            del que no se salía: había que bajar hasta la primera fila para
            entrar al catálogo. La de ofertas solo aparece si hay algo
            rebajado — un botón que lleva a una lista vacía es peor que no
            tenerlo. */}
        {storeSlug && (
          <Stack
            direction="row"
            sx={{ gap: 1, flexWrap: 'wrap', rowGap: 1, mt: 0.5 }}
          >
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
    </Box>
  )
}
