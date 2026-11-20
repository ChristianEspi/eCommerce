import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { offerBadge, vigenciaTexto } from '../offer'
import { promotionHref, type StorePromotion } from '../promotions'

/**
 * Las campañas como DOS BANNERS lado a lado (Resumen v2 · contrato V5,
 * `promotions: 'banners'`).
 *
 * La primera sobre el tinte suave del acento y la segunda sobre el fondo
 * invertido: dos pesos para dos campañas, sin un color que no sea de la tienda.
 * Con una sola campaña ocupa el ancho entero. Más de dos no caben en esta
 * composición: la tienda que quiera enseñarlas todas elige el carrusel.
 */
export function PromoBanners({
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
  const dos = promotions.slice(0, 2)
  if (dos.length === 0) return null

  return (
    <Box
      component="section"
      id="ofertas"
      aria-label={t('store.promos.title')}
      data-promotions-presentation="banners"
      sx={{
        display: 'grid',
        gap: { xs: 1.5, md: 2 },
        gridTemplateColumns: { xs: '1fr', md: dos.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr' },
        scrollMarginTop: 96,
      }}
    >
      {dos.map((promo, indice) => (
        <Banner
          key={promo.id}
          promo={promo}
          storeSlug={storeSlug}
          currency={currency}
          oscuro={indice === 1}
          imageSrc={fuenteDe(promo.imageUrl, assets)}
        />
      ))}
    </Box>
  )
}

function fuenteDe(referencia: string | null, firmadas: Record<string, string>) {
  if (!referencia) return null
  if (/^https?:\/\//i.test(referencia)) return referencia
  return firmadas[referencia] ?? null
}

function Banner({
  promo,
  storeSlug,
  currency,
  oscuro,
  imageSrc,
}: {
  promo: StorePromotion
  storeSlug: string
  currency: string
  oscuro: boolean
  imageSrc: string | null
}) {
  const { t, locale } = useI18n()
  const badge = offerBadge(promo, t, locale, currency)
  const vigencia = vigenciaTexto(promo.endsAt, t, locale)
  // A los productos que alcanza la campaña; al catálogo si es de pedido entero.
  const destino = promotionHref(promo, storeSlug)

  /*
   * Una FRANJA, no un cartel. Antes era una caja de 184 px de alto con el
   * texto a la izquierda, el medallón pegado al borde derecho y un descampado
   * entre los dos: a ancho completo se leía como una sección vacía. Ahora el
   * cuánto va primero —es lo que se mira—, luego de qué y hasta cuándo, y la
   * puerta al final de la misma línea.
   */
  return (
    <Stack
      direction="row"
      data-banner={oscuro ? 'contrast' : 'soft'}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        alignItems: 'center',
        gap: { xs: 1.5, md: 2.25 },
        py: { xs: 1.5, md: 1.75 },
        px: { xs: 1.5, md: 2.25 },
        borderRadius: 'var(--sf-radius)',
        bgcolor: oscuro ? 'var(--text)' : 'var(--sf-soft, var(--neutral-soft))',
        color: oscuro ? 'var(--card)' : 'var(--text)',
        border: '1px solid',
        borderColor: oscuro ? 'transparent' : 'var(--sf-line)',
        transition: 'box-shadow .2s ease, transform .2s ease',
        '&:hover': { boxShadow: 'var(--sf-shadow-hover)', transform: 'translateY(-1px)' },
        '&:has(a:focus-visible)': { outline: '2px solid var(--accent)', outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          alt=""
          loading="lazy"
          sx={{
            width: { xs: 56, md: 72 },
            height: { xs: 56, md: 72 },
            objectFit: 'cover',
            borderRadius: 'var(--sf-radius-sm)',
            flexShrink: 0,
          }}
        />
      ) : badge ? (
        <Box
          aria-hidden
          sx={{
            flexShrink: 0,
            width: { xs: 56, md: 72 },
            height: { xs: 56, md: 72 },
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            borderRadius: '50%',
            background: 'var(--hero-grad)',
            color: '#fff',
            fontSize: { xs: 14, md: 18 },
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            px: 0.75,
            boxShadow: '0 8px 18px -10px rgba(0,0,0,.5)',
          }}
        >
          {badge}
        </Box>
      ) : null}

      <Stack sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, flexWrap: 'wrap', rowGap: 0 }}>
          <Typography
            component="h3"
            sx={{ fontSize: { xs: 16, md: 18 }, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.015em' }}
          >
            {promo.name}
          </Typography>
          {vigencia ? (
            <Typography
              sx={{
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: oscuro ? 'inherit' : 'var(--accent-deep)',
                opacity: oscuro ? 0.8 : 1,
              }}
            >
              {vigencia.texto}
            </Typography>
          ) : null}
        </Stack>
        {promo.description ? (
          <Typography
            sx={{
              fontSize: 13,
              opacity: 0.8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {promo.description}
          </Typography>
        ) : null}
      </Stack>

      <Box
        component={Link}
        to={destino}
        aria-label={`${t('store.promos.see')}: ${promo.name}`}
        sx={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: { xs: 1, md: 1.75 },
          py: { xs: 1, md: 0.875 },
          borderRadius: 'var(--sf-pill)',
          fontSize: 13.5,
          fontWeight: 800,
          bgcolor: oscuro ? 'var(--card)' : 'var(--accent-deep)',
          color: oscuro ? 'var(--text)' : '#fff',
          textDecoration: 'none',
          // Toda la franja es la puerta; el botón es solo lo que se ve.
          '&::after': { content: '""', position: 'absolute', inset: 0 },
          '&:focus-visible': { outline: 'none' },
        }}
      >
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {t('store.promos.see')}
        </Box>
        <ArrowForwardRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
      </Box>
    </Stack>
  )
}
