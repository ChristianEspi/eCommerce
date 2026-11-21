import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { HORIZONTE_RELOJ_MS } from '../feria'
import { offerBadge, vigenciaTexto } from '../offer'
import { promotionHref, type StorePromotion } from '../promotions'
import { Countdown } from './Countdown'
import { PromoBackgroundVideo } from './PromoBackgroundVideo'

/**
 * Rediseño v3 · Las campañas de RETAIL (lámina «01 — Retail · Home»).
 *
 * El diseño no las enseña como dos tarjetas lado a lado sino en dos piezas de
 * portada con peso propio:
 *
 *  1. **La banda**: la primera campaña a todo el ancho, en tinta, con el título
 *     en versalitas enormes, el reloj si está en la recta final y la puerta en
 *     blanco. Es el «−30% EN CÁRDIGANS» del diseño.
 *  2. **La campaña partida**: la segunda, con su foto sobre papel a un lado y el
 *     texto con la puerta en tinta al otro. Es el «REGALA ABRIGO».
 *
 * Los DATOS son los de siempre —nombre, texto, vigencia, foto y a dónde lleva—:
 * lo que cambia es la composición. Más de dos no caben aquí, igual que en
 * `banners`; quien quiera enseñarlas todas elige el carrusel.
 */
export function PromoRetail({
  promotions,
  storeSlug,
  currency,
  assets = {},
}: {
  promotions: readonly StorePromotion[]
  storeSlug: string
  currency: string
  assets?: Record<string, string>
}) {
  const { t } = useI18n()
  const [primera, segunda] = promotions
  if (!primera) return null

  return (
    <Stack
      component="section"
      id="ofertas"
      aria-label={t('store.promos.title')}
      data-promotions-presentation="retail"
      sx={{ gap: 'var(--sf-section-gap-md)', scrollMarginTop: 96 }}
    >
      <Banda
        promo={primera}
        storeSlug={storeSlug}
        currency={currency}
        imageSrc={primera.videoUrl ? fuenteDe(primera.imageUrl, assets) : null}
      />
      {segunda ? (
        <Partida
          promo={segunda}
          storeSlug={storeSlug}
          currency={currency}
          imageSrc={fuenteDe(segunda.imageUrl, assets)}
        />
      ) : null}
    </Stack>
  )
}

function fuenteDe(referencia: string | null, firmadas: Record<string, string>) {
  if (!referencia) return null
  if (/^https?:\/\//i.test(referencia)) return referencia
  return firmadas[referencia] ?? null
}

/** A los productos que alcanza la campaña; al catálogo si es de pedido entero. */
function destinoDe(promo: StorePromotion, storeSlug: string) {
  return promotionHref(promo, storeSlug)
}

/** El reloj solo en la recta final, como en la portada de ofertas. */
function enRectaFinal(endsAt: string | null) {
  if (!endsAt) return false
  const restante = new Date(endsAt).getTime() - Date.now()
  return restante > 0 && restante <= HORIZONTE_RELOJ_MS
}

const TITULO = {
  fontFamily: 'var(--sf-display, inherit)',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '-0.03em',
  lineHeight: 0.95,
} as const

const ANTETITULO = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
} as const

function Puerta({ to, label, invertida }: { to: string; label: string; invertida: boolean }) {
  const { t } = useI18n()
  return (
    <Box
      component={Link}
      to={to}
      aria-label={`${t('store.promos.see')}: ${label}`}
      sx={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 2.5,
        py: 1.25,
        borderRadius: 'var(--sf-pill)',
        fontSize: 14,
        fontWeight: 700,
        textDecoration: 'none',
        bgcolor: invertida ? 'var(--card)' : 'var(--text)',
        color: invertida ? 'var(--text)' : 'var(--card)',
        '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 3 },
      }}
    >
      {t('store.promos.see')}
      <ArrowForwardRoundedIcon aria-hidden sx={{ fontSize: 17 }} />
    </Box>
  )
}

function Banda({
  promo,
  storeSlug,
  currency,
  imageSrc,
}: {
  promo: StorePromotion
  storeSlug: string
  currency: string
  /** Solo con video: la imagen es su respaldo, de fondo. Sin video la banda es de tinta. */
  imageSrc: string | null
}) {
  const { t, locale } = useI18n()
  const badge = offerBadge(promo, t, locale, currency)
  const vigencia = vigenciaTexto(promo.endsAt, t, locale)
  const reloj = enRectaFinal(promo.endsAt)
  const antetitulo = [badge, vigencia?.texto].filter(Boolean).join(' · ')
  // 2026-10-04 · Con video, la banda lo lleva de fondo (y la imagen debajo).
  const conFondo = Boolean(promo.videoUrl)

  return (
    <Box
      data-promo-retail="band"
      data-promo-background={conFondo ? 'video' : undefined}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        // A sangre: el fondo llega a los bordes y el contenido se queda en el
        // ancho de la tienda (la misma fórmula que el marco de sección).
        marginInline: 'calc(50% - 50vw)',
        paddingInline: 'calc(50vw - 50%)',
        bgcolor: 'var(--sf-band)',
        color: '#fff',
      }}
    >
      {conFondo ? (
        <>
          {imageSrc ? (
            <Box
              component="img"
              src={imageSrc}
              alt=""
              aria-hidden
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
            />
          ) : null}
          <PromoBackgroundVideo path={promo.videoUrl as string} />
          {/* El velo va siempre que hay fondo, se mueva o no: con movimiento
              reducido se ve la imagen, y el texto blanco tiene que leerse igual. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              background: 'linear-gradient(90deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.5) 55%, rgba(0,0,0,.35) 100%)',
            }}
          />
        </>
      ) : null}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{
          position: 'relative',
          zIndex: 1,
          // Con video, más alto: el fondo también se tiene que ver.
          minHeight: conFondo ? { xs: 360, md: 420 } : undefined,
          py: { xs: 5, md: 7 },
          gap: { xs: 3, md: 4 },
          alignItems: { xs: 'flex-start', md: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Stack sx={{ gap: 1.5, minWidth: 0 }}>
          {antetitulo ? <Typography sx={{ ...ANTETITULO, opacity: 0.8 }}>{antetitulo}</Typography> : null}
          <Typography component="h3" sx={{ ...TITULO, fontSize: { xs: 36, md: 60 } }}>
            {promo.name}
          </Typography>
          {promo.description ? (
            <Typography sx={{ fontSize: 14.5, opacity: 0.8, maxWidth: 560 }}>{promo.description}</Typography>
          ) : null}
        </Stack>

        <Stack sx={{ gap: 2.5, alignItems: { xs: 'flex-start', md: 'flex-end' }, flexShrink: 0 }}>
          {reloj ? (
            <Box
              sx={{
                '& [data-countdown="boxes"] > *': {
                  bgcolor: 'transparent',
                  borderColor: 'rgba(255, 255, 255, 0.35)',
                  boxShadow: 'none',
                  borderRadius: 0,
                },
              }}
            >
              <Countdown endsAt={promo.endsAt} />
            </Box>
          ) : null}
          <Puerta to={destinoDe(promo, storeSlug)} label={promo.name} invertida />
        </Stack>
      </Stack>
    </Box>
  )
}

function Partida({
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

  return (
    <Box
      data-promo-retail="split"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
        bgcolor: 'var(--sf-soft)',
        minHeight: { md: 320 },
      }}
    >
      {/* La foto de la campaña, o la cifra como imagen si no la hay. */}
      <Box
        aria-hidden
        sx={{
          position: 'relative',
          minHeight: { xs: 200, md: 'auto' },
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'var(--sf-photo-bg, var(--neutral-soft))',
          overflow: 'hidden',
        }}
      >
        {imageSrc ? (
          <Box
            component="img"
            src={imageSrc}
            alt=""
            loading="lazy"
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              p: { xs: 3, md: 5 },
              mixBlendMode: 'var(--sf-media-blend, normal)',
            }}
          />
        ) : badge ? (
          <Typography sx={{ ...TITULO, fontSize: { xs: 56, md: 96 }, color: 'var(--text)', px: 3, textAlign: 'center' }}>
            {badge}
          </Typography>
        ) : null}
        {/* 2026-10-04 · El video, encima de la foto, en todo el hueco. */}
        {promo.videoUrl ? <PromoBackgroundVideo path={promo.videoUrl} /> : null}
      </Box>

      <Stack sx={{ gap: 1.5, justifyContent: 'center', p: { xs: 3, md: 6 } }}>
        {vigencia ? <Typography sx={{ ...ANTETITULO, color: 'var(--muted)' }}>{vigencia.texto}</Typography> : null}
        <Typography component="h3" sx={{ ...TITULO, fontSize: { xs: 32, md: 48 } }}>
          {promo.name}
        </Typography>
        {promo.description ? (
          <Typography sx={{ fontSize: 14.5, color: 'var(--muted)', maxWidth: 420 }}>{promo.description}</Typography>
        ) : null}
        <Box sx={{ mt: 1 }}>
          <Puerta to={destinoDe(promo, storeSlug)} label={promo.name} invertida={false} />
        </Box>
      </Stack>
    </Box>
  )
}

